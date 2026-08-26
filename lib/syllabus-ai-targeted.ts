import { getGroqClient } from "./ai/groq";
import {
  parseTaggedSyllabusChunk,
  type SyllabusAnalysis,
  type SyllabusPipelineChunk,
} from "./syllabus-analysis-pipeline";

export const TARGETED_SYLLABUS_MODE = "ai-layout-aware-v9-tpm-bounded";

const MODELS = [
  "openai/gpt-oss-20b",
  "openai/gpt-oss-120b",
  "qwen/qwen3.6-27b",
] as const;

/*
 * Groq's current on-demand lanes expose an 8k TPM ceiling for the models used
 * here. Keep requests comfortably below that ceiling instead of discovering
 * the limit after sending a large PDF-expanded prompt.
 */
const MAIN_EVIDENCE_CHAR_BUDGET = 10_000;
const FOCUSED_EVIDENCE_CHAR_BUDGET = 7_000;
const MAIN_COMPLETION_TOKENS = 1_450;
const FOCUSED_STRUCTURE_TOKENS = 1_650;
const FOCUSED_GRADING_TOKENS = 550;

const systemPrompt = `Read the supplied evidence from one college syllabus and extract its course setup.
Use only facts explicitly supported by the syllabus. Do not invent missing information.

PDF LAYOUT
- Table/grid rows may contain markers such as [x=72], [x=210], [x=430]. They are horizontal PDF coordinates.
- Text at similar x coordinates on successive rows belongs to the same visual column.
- Reconstruct grading and schedule tables before interpreting them.

COURSE IDENTITY
- Extract explicit course code, course name, professor/instructor, term, and credits if stated.

GRADING
- Extract only top-level gradebook categories and their full weights.
- If "Midterm Exams" are 30% total and 15% each, output one 30% category.
- If a letter-grade scale is present, preserve every stated row and decimal.
- Printed A 100-93 means min 93, max 100. Never assume a standard scale.

ACADEMIC STRUCTURE
- Study units normally represent major test/assessment blocks, not calendar weeks.
- Week labels and date ranges are schedule metadata, never study units.
- Exam rows are assessment boundaries, never topics.
- Preserve genuine professor-defined academic units when explicitly present.
- Preserve explicit instructional topics only. Do not infer detailed topics.

CALENDAR
- Extract major exams, explicitly scheduled quizzes, deadlines, presentations, required events, and explicit breaks/no-class dates.
- Ordinary lecture dates are not important-date rows.
- Never duplicate an event as both ASSESSMENT and DATE.

POLICIES
- Extract useful explicit course policies and schedule notes.

Return ONLY tagged lines using literal TAB characters:
COURSE<TAB>course code<TAB>course name<TAB>professor<TAB>term<TAB>credits
GRADE_CATEGORY<TAB>name<TAB>weight percent number<TAB>notes
GRADE_SCALE<TAB>letter grade<TAB>minimum percent<TAB>maximum percent<TAB>notes
ASSESSMENT<TAB>name<TAB>type<TAB>date exactly as written<TAB>notes
UNIT<TAB>name<TAB>description<TAB>explicit_unit or assessment_block<TAB>basis<TAB>assessment name<TAB>coverage
TOPIC<TAB>unit name or UNASSIGNED<TAB>topic name<TAB>date<TAB>reading<TAB>assignment
DATE<TAB>name<TAB>date exactly as written<TAB>type
POLICY<TAB>category<TAB>summary
SCHEDULE_NOTE<TAB>note
WARNING<TAB>warning
CONFIDENCE<TAB>0-100

Omit unsupported lines. No JSON, markdown, headings, commentary, or code fences.`;

const gradingPrompt = `Read ONLY the supplied grading evidence from a college syllabus.
The evidence may contain [x=...] PDF column coordinates.

Extract:
- every explicitly stated TOP-LEVEL grading category and full weight
- every explicitly stated letter-grade cutoff row

Rules:
- Read visual grids by matching repeated x positions.
- Do not split a total category weight into sub-items.
- Convert printed reversed ranges to minimum then maximum. A 100-93 means min 93, max 100.
- Preserve decimals exactly.
- Never invent or assume a grading scale.

Return ONLY:
GRADE_CATEGORY<TAB>name<TAB>weight percent number<TAB>notes
GRADE_SCALE<TAB>letter grade<TAB>minimum percent<TAB>maximum percent<TAB>notes
CONFIDENCE<TAB>0-100`;

const structurePrompt = `Read ONLY the supplied chronological schedule evidence from a college syllabus.
The evidence may contain [x=...] PDF column coordinates.

Rules:
- Read every supplied schedule row before answering.
- Week labels are schedule metadata, never study units.
- Major tests define study blocks unless the professor explicitly provides a better academic hierarchy.
- Put each instructional topic into the assessment block it leads up to.
- Exam rows are assessment boundaries, not topics.
- Preserve every explicit instructional topic exactly once with its date, reading, and assignment when stated.
- Preserve topics after the first test, between later tests, and through the end of instruction.
- Holidays/no-class rows are DATE events, not TOPIC rows.
- Never duplicate an event as both ASSESSMENT and DATE.
- Do not invent topics or dates.

Return ONLY:
ASSESSMENT<TAB>name<TAB>type<TAB>date exactly as written<TAB>notes
UNIT<TAB>name<TAB>description<TAB>assessment_block<TAB>basis<TAB>assessment name<TAB>coverage
TOPIC<TAB>unit name or UNASSIGNED<TAB>topic name<TAB>date<TAB>reading<TAB>assignment
DATE<TAB>name<TAB>date exactly as written<TAB>type
CONFIDENCE<TAB>0-100`;

type PageEvidence = {
  pageNumber: number;
  text: string;
};

type TaggedRun = {
  analysis: SyllabusAnalysis;
  model: string;
  failures: Array<{
    model: string;
    error: string;
    status: number | null;
  }>;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error ?? "Unknown error");
}

function errorStatus(error: unknown) {
  const status = Number((error as { status?: number })?.status);
  return Number.isFinite(status) ? status : null;
}

function isRequestTooLarge(error: unknown) {
  const message = errorMessage(error).toLowerCase();
  return (
    errorStatus(error) === 413 ||
    message.includes("request too large") ||
    (message.includes("tokens per minute") && message.includes("requested"))
  );
}

function normalizeTaggedContent(content: string, defaultConfidence: number) {
  let cleaned = content
    .trim()
    .replace(/^```(?:text|txt)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  if (!/^CONFIDENCE\t/m.test(cleaned)) {
    cleaned = `${cleaned}\nCONFIDENCE\t${defaultConfidence}`;
  }

  return cleaned;
}

function splitPages(sourceText: string): PageEvidence[] {
  const matches = [...sourceText.matchAll(/===== PAGE (\d+) =====/g)];
  if (matches.length === 0) {
    return [{ pageNumber: 1, text: sourceText.trim() }];
  }

  return matches.map((match, index) => {
    const start = match.index ?? 0;
    const end = matches[index + 1]?.index ?? sourceText.length;
    return {
      pageNumber: Number(match[1]),
      text: sourceText.slice(start, end).trim(),
    };
  });
}

function compactLayoutEvidence(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function fitText(text: string, budget: number) {
  if (text.length <= budget) return text;
  const head = Math.max(1, Math.floor(budget * 0.64));
  const tail = Math.max(1, budget - head - 80);
  return `${text.slice(0, head)}\n[page middle omitted only for request-size budget]\n${text.slice(-tail)}`;
}

function pageBlock(page: PageEvidence) {
  const body = compactLayoutEvidence(page.text)
    .replace(/^===== PAGE \d+ =====\s*/i, "")
    .trim();
  return `===== PAGE ${page.pageNumber} =====\n${body}`;
}

function boundedMainEvidence(sourceText: string) {
  const compactFull = compactLayoutEvidence(sourceText);
  if (compactFull.length <= MAIN_EVIDENCE_CHAR_BUDGET) {
    return compactFull;
  }

  const pages = splitPages(sourceText);
  const ranked = pages
    .map((page, index) => {
      const text = page.text;
      let score = index === 0 ? 100 : 0;
      if (/grading|evaluation|grade\s+scale|percentage|weight/i.test(text)) score += 70;
      if (/midterm|final\s+exam|exam\s*\d+|test\s*\d+/i.test(text)) score += 55;
      if (/attendance|late\s+work|academic|integrity|accommodation|policy|office\s+hours/i.test(text)) {
        score += 30;
      }
      if (/course\s+description|learning\s+objectives?|instructor|professor/i.test(text)) score += 35;
      if (index === pages.length - 1) score += 5;
      return { page, score, index };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const selected: PageEvidence[] = [];
  let used = 0;

  for (const candidate of ranked) {
    const remaining = MAIN_EVIDENCE_CHAR_BUDGET - used;
    if (remaining < 700) break;

    const block = pageBlock(candidate.page);
    const fitted = fitText(block, Math.min(3_400, remaining));
    selected.push({ ...candidate.page, text: fitted });
    used += fitted.length + 2;
  }

  return selected
    .sort((a, b) => a.pageNumber - b.pageNumber)
    .map((page) => page.text)
    .join("\n\n")
    .slice(0, MAIN_EVIDENCE_CHAR_BUDGET);
}

const MONTH_TOKEN =
  "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";

function scheduleDateTokens(text: string) {
  const shortPattern = new RegExp(`\\b\\d{1,2}\\s*[-‑–]\\s*${MONTH_TOKEN}\\b`, "gi");
  const longPattern = new RegExp(`\\b${MONTH_TOKEN}\\s+\\d{1,2}\\b`, "gi");
  const numericPattern = /\b\d{1,2}\s*\/\s*\d{1,2}\b/g;

  return [
    ...text.matchAll(shortPattern),
    ...text.matchAll(longPattern),
    ...text.matchAll(numericPattern),
  ].map((match) =>
    match[0]
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/[‑–]/g, "-"),
  );
}

function selectSchedulePages(sourceText: string) {
  const pages = splitPages(sourceText);
  const scored = pages.map((page) => {
    const dateCount = scheduleDateTokens(page.text).length;
    const layoutMarkers = page.text.match(/\[x=/g)?.length ?? 0;
    const scheduleLanguage = /(?:course|class|weekly)\s+schedule|\bdate\b[\s\S]{0,250}\b(?:topic|content|reading|assignment)\b/i.test(
      page.text,
    );
    return { page, dateCount, layoutMarkers, scheduleLanguage };
  });

  let selected = scored.filter(
    ({ dateCount, layoutMarkers, scheduleLanguage }) =>
      dateCount >= 4 && (layoutMarkers >= 6 || scheduleLanguage),
  );

  if (selected.length === 0) {
    selected = scored
      .filter(({ dateCount }) => dateCount >= 3)
      .sort(
        (a, b) =>
          b.dateCount + Math.min(b.layoutMarkers, 20) -
          (a.dateCount + Math.min(a.layoutMarkers, 20)),
      )
      .slice(0, 6);
  }

  if (selected.length === 0) {
    selected = scored.filter(({ page }) =>
      /\bmidterm\b|\bfinal\s+exam\b|\bexam\s*\d+\b|\btest\s*\d+\b|\btopic\b/i.test(
        page.text,
      ),
    );
  }

  return selected
    .sort((a, b) => a.page.pageNumber - b.page.pageNumber)
    .map(({ page }) => page);
}

function splitLargeBlock(block: string, budget: number) {
  if (block.length <= budget) return [block];
  const lines = block.split(/\r?\n/);
  const parts: string[] = [];
  let current = "";

  for (const line of lines) {
    if (current && current.length + line.length + 1 > budget) {
      parts.push(current);
      current = "";
    }
    current = current ? `${current}\n${line}` : line;
  }

  if (current) parts.push(current);
  return parts;
}

function packPageBatches(pages: PageEvidence[], budget = FOCUSED_EVIDENCE_CHAR_BUDGET) {
  const blocks = pages.flatMap((page) =>
    splitLargeBlock(pageBlock(page), budget - 250),
  );

  const batches: string[] = [];
  let current = "";

  for (const block of blocks) {
    const next = current ? `${current}\n\n${block}` : block;
    if (current && next.length > budget) {
      batches.push(current);
      current = block;
    } else {
      current = next;
    }
  }

  if (current) batches.push(current);
  return batches;
}

function selectGradingPages(sourceText: string) {
  const pages = splitPages(sourceText);
  const hits = pages
    .map((page, index) => ({ page, index }))
    .filter(({ page }) =>
      /grading|evaluation|grade\s+scale|percentage|weight|points?\s+possible/i.test(page.text),
    );

  if (hits.length === 0) return pages.slice(0, 2);

  const indexes = new Set<number>();
  for (const hit of hits) {
    if (hit.index > 0) indexes.add(hit.index - 1);
    indexes.add(hit.index);
    if (hit.index + 1 < pages.length) indexes.add(hit.index + 1);
  }

  return [...indexes]
    .sort((a, b) => a - b)
    .map((index) => pages[index]);
}

function hasVisibleGradeScale(sourceText: string) {
  const text = sourceText.replace(/[\u2013\u2014]/g, "-");
  return (
    /grading\s+scale|letter\s+grade|grade\s+cutoff/i.test(text) &&
    /\bA(?:[+-])?\s+\d/i.test(text) &&
    /\bF\s+\d/i.test(text)
  );
}

function hasVisibleGradingWeights(sourceText: string) {
  return /(?:grading|evaluation|weight|components)[\s\S]{0,2200}\d+(?:\.\d+)?\s*%/i.test(
    sourceText,
  );
}

function hasUsableGradeScale(analysis: SyllabusAnalysis) {
  return (
    analysis.gradingScale.length >= 5 &&
    analysis.gradingScale.every(
      (row) =>
        Number.isFinite(row.minPercent) &&
        Number.isFinite(row.maxPercent) &&
        row.minPercent <= row.maxPercent,
    )
  );
}

function topicCount(analysis: SyllabusAnalysis) {
  return (
    analysis.unassignedTopics.length +
    analysis.units.reduce((sum, unit) => sum + unit.topics.length, 0)
  );
}

function majorAssessmentKeys(analysis: SyllabusAnalysis, sourceText: string) {
  const names = new Set<string>();
  const add = (value: string) => {
    for (const match of value.matchAll(/\bmidterm\s*(\d+)\b/gi)) names.add(`midterm-${match[1]}`);
    for (const match of value.matchAll(/\btest\s*(\d+)\b/gi)) names.add(`test-${match[1]}`);
    for (const match of value.matchAll(/\bexam\s*(\d+)\b/gi)) names.add(`exam-${match[1]}`);
    if (/\bfinal\s+exam\b/i.test(value)) names.add("final");
  };

  for (const assessment of analysis.assessments) {
    add(`${assessment.name} ${assessment.type}`);
  }
  add(sourceText);
  return names;
}

function unitAssessmentKey(name: string) {
  const midterm = name.match(/\bmidterm\s*(\d+)\b/i);
  if (midterm) return `midterm-${midterm[1]}`;
  const test = name.match(/\btest\s*(\d+)\b/i);
  if (test) return `test-${test[1]}`;
  const exam = name.match(/\bexam\s*(\d+)\b/i);
  if (exam) return `exam-${exam[1]}`;
  if (/\bfinal\s+exam\b/i.test(name)) return "final";
  return "";
}

function isWeekUnit(name: string) {
  return /^\s*(?:week|wk)\s*(?:\d+|[ivxlcdm]+)\b/i.test(name);
}

function visibleScheduleRowCount(sourceText: string) {
  const text = selectSchedulePages(sourceText)
    .map((page) => page.text)
    .join("\n");
  return new Set(scheduleDateTokens(text)).size;
}

function structureNeedsRepair(analysis: SyllabusAnalysis, sourceText: string) {
  const totalTopics = topicCount(analysis);
  const scheduleRows = visibleScheduleRowCount(sourceText);

  if (scheduleRows >= 3 && totalTopics === 0) return true;
  if (scheduleRows >= 12 && totalTopics < Math.floor(scheduleRows * 0.62)) return true;
  if (analysis.units.some((unit) => isWeekUnit(unit.name))) return true;

  const assessmentKeys = majorAssessmentKeys(analysis, sourceText);
  if (assessmentKeys.size < 2) return false;

  const nonEmptyAssessmentUnits = new Set(
    analysis.units
      .filter((unit) => unit.topics.length > 0)
      .map((unit) => unitAssessmentKey(unit.name))
      .filter(Boolean),
  );

  const requiredBlocks = Math.min(assessmentKeys.size, 3);
  if (nonEmptyAssessmentUnits.size < requiredBlocks) return true;

  const nonEmptyUnits = analysis.units.filter((unit) => unit.topics.length > 0);
  const largest = nonEmptyUnits.length
    ? Math.max(...nonEmptyUnits.map((unit) => unit.topics.length))
    : totalTopics;

  return totalTopics >= 8 && largest / Math.max(1, totalTopics) > 0.75;
}

function normalizeEventValue(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u2013\u2014\u2011]/g, "-")
    .replace(/[^a-z0-9:+.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeFinalAnalysis(analysis: SyllabusAnalysis) {
  for (const unit of analysis.units) {
    if (unitAssessmentKey(unit.name)) unit.basisType = "assessment_block";
  }

  const assessmentDates = new Set(
    analysis.assessments
      .map((assessment) => normalizeEventValue(assessment.date))
      .filter(Boolean),
  );

  const seen = new Set<string>();
  analysis.importantDates = analysis.importantDates.filter((item) => {
    const date = normalizeEventValue(item.date);
    if (date && assessmentDates.has(date)) return false;
    const identity = `${date}|${normalizeEventValue(item.name)}|${normalizeEventValue(item.type)}`;
    if (!identity.replace(/\|/g, "") || seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function buildRequest(model: string, evidence: string, maxTokens: number, prompt: string) {
  const base = {
    model,
    messages: [
      { role: "system" as const, content: prompt },
      { role: "user" as const, content: evidence },
    ],
    temperature: 0,
    max_completion_tokens: maxTokens,
  };

  return model.startsWith("openai/gpt-oss-")
    ? { ...base, reasoning_effort: "low" as const }
    : base;
}

async function runTaggedExtraction(
  models: readonly string[],
  prompt: string,
  evidence: string,
  maxTokens: number,
  label: string,
  validate?: (analysis: SyllabusAnalysis) => void,
): Promise<TaggedRun> {
  const failures: TaggedRun["failures"] = [];

  for (const model of models) {
    try {
      console.log(`${label} AI attempt:`, {
        model,
        evidenceCharacters: evidence.length,
        maxCompletionTokens: maxTokens,
      });

      const completion = await getGroqClient().chat.completions.create(
        buildRequest(model, evidence, maxTokens, prompt),
      );
      const choice = completion.choices[0];
      const content = choice?.message?.content?.trim();

      if (!content) {
        throw Object.assign(new Error("AI returned an empty extraction."), { status: 422 });
      }

      const analysis = parseTaggedSyllabusChunk(
        normalizeTaggedContent(content, choice.finish_reason === "length" ? 70 : 90),
      );
      validate?.(analysis);
      return { analysis, model, failures };
    } catch (error) {
      const failure = {
        model,
        error: errorMessage(error),
        status: errorStatus(error),
      };
      failures.push(failure);
      console.warn(`${label} AI attempt failed:`, failure);

      /* Same oversized payload will not become smaller by switching models. */
      if (isRequestTooLarge(error)) break;
    }
  }

  const last = failures[failures.length - 1];
  throw Object.assign(
    new Error(`${label} AI extraction failed. ${last?.error ?? "No model was available."}`),
    { status: last?.status ?? 503, failures },
  );
}

function mergeGrading(target: SyllabusAnalysis, source: SyllabusAnalysis) {
  const categoryKeys = new Set(
    target.gradingCategories.map((item) => normalizeEventValue(item.name)),
  );
  for (const item of source.gradingCategories) {
    const key = normalizeEventValue(item.name);
    if (key && !categoryKeys.has(key)) {
      target.gradingCategories.push(item);
      categoryKeys.add(key);
    }
  }

  const scaleKeys = new Set(
    target.gradingScale.map((item) => item.letterGrade.trim().toUpperCase()),
  );
  for (const item of source.gradingScale) {
    const key = item.letterGrade.trim().toUpperCase();
    if (key && !scaleKeys.has(key)) {
      target.gradingScale.push(item);
      scaleKeys.add(key);
    }
  }
}

function topicIdentity(topic: { name: string; date: string }) {
  return `${normalizeEventValue(topic.date)}|${normalizeEventValue(topic.name)}`;
}

function mergeStructure(target: SyllabusAnalysis, source: SyllabusAnalysis) {
  const assessmentKeys = new Set(
    target.assessments.map((item) =>
      `${normalizeEventValue(item.name)}|${normalizeEventValue(item.date)}`,
    ),
  );
  for (const item of source.assessments) {
    const key = `${normalizeEventValue(item.name)}|${normalizeEventValue(item.date)}`;
    if (!assessmentKeys.has(key)) {
      target.assessments.push(item);
      assessmentKeys.add(key);
    }
  }

  for (const sourceUnit of source.units) {
    const key = normalizeEventValue(sourceUnit.name);
    let unit = target.units.find((candidate) => normalizeEventValue(candidate.name) === key);
    if (!unit) {
      unit = { ...sourceUnit, topics: [] };
      target.units.push(unit);
    }

    const existing = new Set(unit.topics.map(topicIdentity));
    for (const topic of sourceUnit.topics) {
      const identity = topicIdentity(topic);
      if (!existing.has(identity)) {
        unit.topics.push(topic);
        existing.add(identity);
      }
    }
  }

  const unassigned = new Set(target.unassignedTopics.map(topicIdentity));
  for (const topic of source.unassignedTopics) {
    const identity = topicIdentity(topic);
    if (!unassigned.has(identity)) {
      target.unassignedTopics.push(topic);
      unassigned.add(identity);
    }
  }

  const dateKeys = new Set(
    target.importantDates.map((item) =>
      `${normalizeEventValue(item.name)}|${normalizeEventValue(item.date)}`,
    ),
  );
  for (const item of source.importantDates) {
    const key = `${normalizeEventValue(item.name)}|${normalizeEventValue(item.date)}`;
    if (!dateKeys.has(key)) {
      target.importantDates.push(item);
      dateKeys.add(key);
    }
  }
}

async function recoverGrading(sourceText: string) {
  const batches = packPageBatches(selectGradingPages(sourceText));
  let merged: SyllabusAnalysis | null = null;
  let model = "";
  let attempts = 0;

  for (let index = 0; index < batches.length; index += 1) {
    const run = await runTaggedExtraction(
      MODELS,
      gradingPrompt,
      `SYLLABUS GRADING EVIDENCE ${index + 1} OF ${batches.length}:\n${batches[index]}`,
      FOCUSED_GRADING_TOKENS,
      "Focused grading",
    );
    attempts += run.failures.length + 1;
    model = run.model;

    if (!merged) merged = run.analysis;
    else mergeGrading(merged, run.analysis);
  }

  if (!merged) {
    throw Object.assign(new Error("No grading evidence could be read."), { status: 422 });
  }

  if (hasVisibleGradingWeights(sourceText) && merged.gradingCategories.length === 0) {
    throw Object.assign(new Error("Focused AI missed explicitly stated grading weights."), {
      status: 422,
    });
  }
  if (hasVisibleGradeScale(sourceText) && !hasUsableGradeScale(merged)) {
    throw Object.assign(new Error("Focused AI did not return a usable grading scale."), {
      status: 422,
    });
  }

  return { analysis: merged, model, attempts };
}

async function recoverStructure(sourceText: string) {
  const pages = selectSchedulePages(sourceText);
  const batches = packPageBatches(pages);

  if (batches.length === 0) {
    throw Object.assign(new Error("No explicit schedule-table evidence was found."), {
      status: 422,
    });
  }

  let merged: SyllabusAnalysis | null = null;
  let model = "";
  let attempts = 0;

  for (let index = 0; index < batches.length; index += 1) {
    const run = await runTaggedExtraction(
      MODELS,
      structurePrompt,
      `SYLLABUS SCHEDULE EVIDENCE ${index + 1} OF ${batches.length}. This is one chronological portion of the same syllabus schedule.\n${batches[index]}`,
      FOCUSED_STRUCTURE_TOKENS,
      "Focused schedule-structure",
    );
    attempts += run.failures.length + 1;
    model = run.model;

    if (!merged) merged = run.analysis;
    else mergeStructure(merged, run.analysis);
  }

  if (!merged || structureNeedsRepair(merged, sourceText)) {
    throw Object.assign(
      new Error("Focused AI still did not recover the complete schedule across assessment blocks."),
      { status: 422 },
    );
  }

  return { analysis: merged, model, attempts };
}

function validateFinalAnalysis(analysis: SyllabusAnalysis, sourceText: string) {
  if (hasVisibleGradingWeights(sourceText) && analysis.gradingCategories.length === 0) {
    throw Object.assign(new Error("AI missed explicitly stated grading weights."), {
      status: 422,
    });
  }

  if (hasVisibleGradeScale(sourceText) && !hasUsableGradeScale(analysis)) {
    throw Object.assign(new Error("AI missed the explicitly stated letter-grade scale."), {
      status: 422,
    });
  }

  if (visibleScheduleRowCount(sourceText) >= 3 && structureNeedsRepair(analysis, sourceText)) {
    throw Object.assign(
      new Error("AI syllabus structure is still incomplete after focused schedule recovery."),
      { status: 422 },
    );
  }
}

export type TargetedSyllabusAIResult = {
  analysis: SyllabusAnalysis;
  pipelineChunks: SyllabusPipelineChunk[];
  modelsUsed: string[];
  taskModels: Record<string, string>;
};

export async function analyzeSyllabusWithTargetedAI(
  sourceText: string,
): Promise<TargetedSyllabusAIResult> {
  const mainEvidence = boundedMainEvidence(sourceText);
  const main = await runTaggedExtraction(
    MODELS,
    systemPrompt,
    `BOUNDED SYLLABUS EVIDENCE WITH PAGE MARKERS:\n${mainEvidence}`,
    MAIN_COMPLETION_TOKENS,
    "Bounded whole-syllabus",
  );

  const analysis = main.analysis;
  let gradingModel = "";
  let structureModel = "";
  let gradingAttempts = 0;
  let structureAttempts = 0;

  const gradingNeedsRecovery =
    (hasVisibleGradingWeights(sourceText) && analysis.gradingCategories.length === 0) ||
    (hasVisibleGradeScale(sourceText) && !hasUsableGradeScale(analysis));

  if (gradingNeedsRecovery) {
    const repaired = await recoverGrading(sourceText);
    mergeGrading(analysis, repaired.analysis);
    gradingModel = repaired.model;
    gradingAttempts = repaired.attempts;
  }

  const longDocument = compactLayoutEvidence(sourceText).length > MAIN_EVIDENCE_CHAR_BUDGET;
  const hasScheduleEvidence = selectSchedulePages(sourceText).length > 0;
  if (
    hasScheduleEvidence &&
    (longDocument || structureNeedsRepair(analysis, sourceText))
  ) {
    const repaired = await recoverStructure(sourceText);
    analysis.assessments = repaired.analysis.assessments;
    analysis.units = repaired.analysis.units;
    analysis.unassignedTopics = repaired.analysis.unassignedTopics;
    analysis.importantDates = repaired.analysis.importantDates;
    structureModel = repaired.model;
    structureAttempts = repaired.attempts;
  }

  normalizeFinalAnalysis(analysis);
  validateFinalAnalysis(analysis, sourceText);

  const modelsUsed = [
    ...new Set([main.model, gradingModel, structureModel].filter(Boolean)),
  ];

  const pipelineChunks: SyllabusPipelineChunk[] = [
    {
      index: 0,
      text: "TPM-bounded syllabus AI extraction",
      status: "ready",
      memory: analysis,
      attempts: main.failures.length + 1,
      lastError: null,
    },
  ];

  if (gradingModel) {
    pipelineChunks.push({
      index: pipelineChunks.length,
      text: "Focused bounded grading recovery",
      status: "ready",
      memory: { ...analysis, units: [], unassignedTopics: [], assessments: [] },
      attempts: gradingAttempts,
      lastError: null,
    });
  }

  if (structureModel) {
    pipelineChunks.push({
      index: pipelineChunks.length,
      text: "Focused bounded schedule recovery",
      status: "ready",
      memory: analysis,
      attempts: structureAttempts,
      lastError: null,
    });
  }

  return {
    analysis,
    pipelineChunks,
    modelsUsed,
    taskModels: {
      whole_document: main.model,
      ...(gradingModel ? { grading_verification: gradingModel } : {}),
      ...(structureModel ? { schedule_structure_verification: structureModel } : {}),
    },
  };
}
