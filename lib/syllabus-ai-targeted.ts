import { getGroqClient } from "./ai/groq";
import {
  parseTaggedSyllabusChunk,
  type SyllabusAnalysis,
  type SyllabusPipelineChunk,
} from "./syllabus-analysis-pipeline";

export const TARGETED_SYLLABUS_MODE = "ai-layout-aware-v8-complete-schedule";

const MODELS = [
  "openai/gpt-oss-20b",
  "openai/gpt-oss-120b",
  "qwen/qwen3.6-27b",
] as const;

const systemPrompt = `Read this college syllabus as one document and extract its course setup.
Use only facts explicitly supported by the syllabus. Do not invent missing information.

IMPORTANT PDF LAYOUT NOTE
- Some table/grid rows include markers such as [x=72], [x=210], [x=430]. These are horizontal PDF coordinates.
- Treat text with similar x coordinates on successive rows as belonging to the same visual column.
- Use those coordinates to reconstruct grading tables and schedule tables before interpreting them.
- Do not concatenate neighboring table columns just because they appear on the same text line.

COURSE IDENTITY
- Extract the explicit course code, course name, professor/instructor, term, and credits if stated.

GRADING
- Extract only TOP-LEVEL gradebook categories and their full weights.
- If a syllabus says "Midterm Exams: 30% total; 15% each", output ONE 30% Midterm Exams category. Midterm 1 and Midterm 2 are assessments, not extra grade categories.
- If the syllabus states a letter-grade scale, output EVERY stated row exactly.
- Convert printed ranges to minimum then maximum. Example: A 100-93 means min 93, max 100.
- Preserve decimals such as 92.9, 89.9, and 59.9.
- Never assume a standard grading scale.

ACADEMIC STRUCTURE
- Study units should normally represent MAJOR TEST / ASSESSMENT BLOCKS, not calendar weeks.
- Week 1, Week 2, Wk 3, date ranges, and similar schedule labels are NOT units.
- If the course has Midterm 1, Midterm 2, and a Final Exam, normally create three assessment_block units named Midterm 1, Midterm 2, and Final Exam.
- Midterm 1 contains instructional topics before Midterm 1.
- Midterm 2 contains instructional topics after Midterm 1 and before Midterm 2.
- Final Exam contains instructional topics after Midterm 2.
- Exam rows are assessment boundaries, never topics.
- Preserve genuine professor-defined content units/modules only when they are actually academic groupings.
- Preserve every explicit scheduled instructional topic exactly once with its correct date, reading, and assignment.
- Read the ENTIRE schedule through the end of the semester before answering. Do not stop after the first exam block.
- Be especially careful with multi-column schedule grids and use [x=...] coordinates to keep cells aligned.
- Do not infer detailed topics that the syllabus does not explicitly state.

CALENDAR
- Extract major exams, explicitly scheduled quizzes, assignment/project deadlines, presentations, required events, and explicit no-class/break dates.
- Do not turn ordinary lecture dates into important calendar events.
- Do not output a DATE row for an event already emitted as an ASSESSMENT. Each event should exist once.
- Preserve alternative final-exam dates as distinct options.

POLICIES
- Extract useful explicit course policies and schedule notes without inventing rules.

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

Omit unsupported lines. Do not output JSON, markdown, headings, commentary, or code fences.`;

const gradeScalePrompt = `Read ONLY the supplied grading evidence from a college syllabus.
The evidence may use [x=...] markers. Those are horizontal PDF coordinates and reveal table columns.

Extract every explicitly stated letter-grade cutoff row.
- Read the visual grid by matching repeated x positions.
- Convert printed ranges to minimum then maximum. A 100-93 means min 93, max 100.
- Preserve decimals exactly.
- Never invent or assume a standard scale.

Return ONLY:
GRADE_SCALE<TAB>letter grade<TAB>minimum percent<TAB>maximum percent<TAB>notes
CONFIDENCE<TAB>0-100`;

const structurePrompt = `Read ONLY the supplied schedule-table evidence from a college syllabus.
The evidence may use [x=...] markers. Those are horizontal PDF coordinates and reveal table columns.
Reconstruct every supplied schedule page first, then build the study hierarchy.

Rules:
- Read all supplied pages through the end of the semester before answering.
- Week labels are schedule metadata, never study units.
- Major tests define study blocks unless the professor explicitly gives a better academic unit hierarchy.
- If there are Midterm 1, Midterm 2, and Final Exam boundaries, create Midterm 1, Midterm 2, and Final Exam assessment_block units.
- Put each instructional topic into the test block it leads up to.
- An exam row is an assessment boundary, not a topic.
- Preserve each explicit instructional topic exactly once with the correct date, reading, and assignment.
- Include topics after Midterm 1 and before Midterm 2. Include topics after Midterm 2 through the end of instruction.
- Holidays and no-class rows are DATE events, not TOPIC rows.
- Do not output a DATE row for an event already emitted as an ASSESSMENT.
- Do not invent topics or dates.

Return ONLY:
ASSESSMENT<TAB>name<TAB>type<TAB>date exactly as written<TAB>notes
UNIT<TAB>name<TAB>description<TAB>assessment_block<TAB>basis<TAB>assessment name<TAB>coverage
TOPIC<TAB>unit name or UNASSIGNED<TAB>topic name<TAB>date<TAB>reading<TAB>assignment
DATE<TAB>name<TAB>date exactly as written<TAB>type
CONFIDENCE<TAB>0-100`;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error ?? "Unknown error");
}

function errorStatus(error: unknown) {
  const status = Number((error as { status?: number })?.status);
  return Number.isFinite(status) ? status : null;
}

function normalizeTaggedContent(content: string, defaultConfidence: number) {
  let cleaned = content.trim();
  cleaned = cleaned
    .replace(/^```(?:text|txt)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  if (!/^CONFIDENCE\t/m.test(cleaned)) {
    cleaned = `${cleaned}\nCONFIDENCE\t${defaultConfidence}`;
  }
  return cleaned;
}

function splitPages(sourceText: string) {
  const matches = [...sourceText.matchAll(/===== PAGE (\d+) =====/g)];
  if (matches.length === 0) return [{ pageNumber: 1, text: sourceText }];

  return matches.map((match, index) => {
    const start = match.index ?? 0;
    const end = matches[index + 1]?.index ?? sourceText.length;
    return {
      pageNumber: Number(match[1]),
      text: sourceText.slice(start, end).trim(),
    };
  });
}

function hasVisibleGradeScale(sourceText: string) {
  const text = sourceText.replace(/[–—]/g, "-");
  return /grading\s+scale/i.test(text) && /\bA(?:[+-])?\s+\d/i.test(text) && /\bF\s+\d/i.test(text);
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

function buildGradeScaleEvidence(sourceText: string) {
  const pages = splitPages(sourceText);
  const hits = pages
    .map((page, index) => ({ page, index }))
    .filter(({ page }) => /grading\s+scale|evaluation\s*&?\s*grading/i.test(page.text))
    .map(({ index }) => index);

  if (hits.length === 0) return sourceText.slice(0, 5500);

  const selected = new Set<number>();
  for (const index of hits) {
    if (index > 0) selected.add(index - 1);
    selected.add(index);
    if (index + 1 < pages.length) selected.add(index + 1);
  }

  return [...selected]
    .sort((a, b) => a - b)
    .map((index) => pages[index].text)
    .join("\n\n")
    .slice(0, 7500);
}

const MONTH_TOKEN =
  "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";

function scheduleDateTokens(text: string) {
  const shortPattern = new RegExp(`\\b\\d{1,2}\\s*[-‑–]\\s*${MONTH_TOKEN}\\b`, "gi");
  const longPattern = new RegExp(`\\b${MONTH_TOKEN}\\s+\\d{1,2}\\b`, "gi");
  return [...text.matchAll(shortPattern), ...text.matchAll(longPattern)].map((match) =>
    match[0].toLowerCase().replace(/\s+/g, "").replace(/[‑–]/g, "-"),
  );
}

function compactLayoutEvidence(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function buildScheduleEvidence(sourceText: string) {
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
      dateCount >= 5 && (layoutMarkers >= 8 || scheduleLanguage),
  );

  if (selected.length === 0) {
    selected = scored
      .filter(({ dateCount }) => dateCount >= 3)
      .sort(
        (left, right) =>
          right.dateCount + Math.min(right.layoutMarkers, 20) -
          (left.dateCount + Math.min(left.layoutMarkers, 20)),
      )
      .slice(0, 4);
  }

  if (selected.length === 0) {
    selected = scored.filter(({ page }) =>
      /\bmidterm\b|\bfinal\s+exam\b|\btopic\b|\bcontent\b/i.test(page.text),
    );
  }

  return selected
    .sort((left, right) => left.page.pageNumber - right.page.pageNumber)
    .map(({ page }) => compactLayoutEvidence(page.text))
    .join("\n\n");
}

function visibleScheduleRowCount(sourceText: string) {
  const evidence = buildScheduleEvidence(sourceText);
  return new Set(scheduleDateTokens(evidence)).size;
}

function topicCount(analysis: SyllabusAnalysis) {
  return (
    analysis.unassignedTopics.length +
    analysis.units.reduce((sum, unit) => sum + unit.topics.length, 0)
  );
}

function majorAssessmentKeys(analysis: SyllabusAnalysis, sourceText: string) {
  const names = new Set<string>();
  const addFromText = (value: string) => {
    for (const match of value.matchAll(/\bmidterm\s*(\d+)\b/gi)) {
      names.add(`midterm-${match[1]}`);
    }
    for (const match of value.matchAll(/\btest\s*(\d+)\b/gi)) {
      names.add(`test-${match[1]}`);
    }
    if (/\bfinal\s+exam\b/i.test(value)) names.add("final");
  };

  for (const assessment of analysis.assessments) {
    addFromText(`${assessment.name} ${assessment.type}`);
  }
  addFromText(sourceText);
  return names;
}

function unitAssessmentKey(name: string) {
  const midterm = name.match(/\bmidterm\s*(\d+)\b/i);
  if (midterm) return `midterm-${midterm[1]}`;
  const test = name.match(/\btest\s*(\d+)\b/i);
  if (test) return `test-${test[1]}`;
  if (/\bfinal\s+exam\b/i.test(name)) return "final";
  return "";
}

function isWeekUnit(name: string) {
  return /^\s*(?:week|wk)\s*(?:\d+|[ivxlcdm]+)\b/i.test(name);
}

function structureNeedsRepair(analysis: SyllabusAnalysis, sourceText: string) {
  const totalTopics = topicCount(analysis);
  if (totalTopics === 0) return true;

  const visibleRows = visibleScheduleRowCount(sourceText);
  if (visibleRows >= 12 && totalTopics < Math.floor(visibleRows * 0.65)) {
    return true;
  }

  const assessmentKeys = majorAssessmentKeys(analysis, sourceText);
  if (assessmentKeys.size < 2) {
    return analysis.units.some((unit) => isWeekUnit(unit.name));
  }

  if (analysis.units.some((unit) => isWeekUnit(unit.name))) return true;

  const nonEmptyAssessmentUnits = new Set(
    analysis.units
      .filter((unit) => unit.topics.length > 0)
      .map((unit) => unitAssessmentKey(unit.name))
      .filter(Boolean),
  );

  const requiredBlocks = Math.min(assessmentKeys.size, 3);
  if (nonEmptyAssessmentUnits.size < requiredBlocks) return true;

  for (const key of [...assessmentKeys].slice(0, requiredBlocks)) {
    if (!nonEmptyAssessmentUnits.has(key)) return true;
  }

  const nonEmptyUnits = analysis.units.filter((unit) => unit.topics.length > 0);
  const largest = Math.max(...nonEmptyUnits.map((unit) => unit.topics.length));
  return totalTopics >= 8 && largest / totalTopics > 0.75;
}

function hasVisibleGradingWeights(sourceText: string) {
  return /grading[\s\S]{0,1600}\d+(?:\.\d+)?\s*%/i.test(sourceText);
}

function normalizeEventValue(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[–—‑]/g, "-")
    .replace(/[^a-z0-9:+.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeFinalAnalysis(analysis: SyllabusAnalysis) {
  for (const unit of analysis.units) {
    if (unitAssessmentKey(unit.name)) {
      unit.basisType = "assessment_block";
    }
    if (/^(?:basis|coverage|description|assessment name)$/i.test(unit.basis.trim())) {
      unit.basis = "";
    }
    if (/^(?:basis|coverage|description|assessment name)$/i.test(unit.coverage.trim())) {
      unit.coverage = "";
    }
    if (/^(?:basis|coverage|description|assessment name)$/i.test(unit.description.trim())) {
      unit.description = "";
    }
  }

  const assessmentDates = new Set(
    analysis.assessments
      .map((assessment) => normalizeEventValue(assessment.date))
      .filter(Boolean),
  );
  const seenDates = new Set<string>();
  analysis.importantDates = analysis.importantDates.filter((item) => {
    const date = normalizeEventValue(item.date);
    if (date && assessmentDates.has(date)) return false;
    const identity = `${date}|${normalizeEventValue(item.name)}|${normalizeEventValue(item.type)}`;
    if (!identity.replace(/\|/g, "")) return false;
    if (seenDates.has(identity)) return false;
    seenDates.add(identity);
    return true;
  });
}

function buildRequest(model: string, sourceText: string, maxTokens: number, prompt: string) {
  const base = {
    model,
    messages: [
      { role: "system" as const, content: prompt },
      { role: "user" as const, content: sourceText },
    ],
    temperature: 0,
    max_completion_tokens: maxTokens,
  };

  if (model.startsWith("openai/gpt-oss-")) {
    return { ...base, reasoning_effort: "low" as const };
  }
  return base;
}

async function runTaggedExtraction(
  models: readonly string[],
  prompt: string,
  evidence: string,
  maxTokens: number,
  label: string,
  validate?: (analysis: SyllabusAnalysis) => void,
) {
  const failures: Array<{ model: string; error: string; status: number | null }> = [];

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
    }
  }

  const last = failures[failures.length - 1];
  throw Object.assign(
    new Error(`${label} AI extraction failed. ${last?.error ?? "No model was available."}`),
    { status: last?.status ?? 503, failures },
  );
}

async function recoverGradeScale(sourceText: string) {
  return runTaggedExtraction(
    MODELS,
    gradeScalePrompt,
    `SYLLABUS GRADING EVIDENCE:\n${buildGradeScaleEvidence(sourceText)}`,
    500,
    "Focused grade-scale",
    (analysis) => {
      if (!hasUsableGradeScale(analysis)) {
        throw Object.assign(
          new Error("Focused AI did not return a usable grading scale."),
          { status: 422 },
        );
      }
    },
  );
}

async function recoverStructure(sourceText: string) {
  const scheduleEvidence = buildScheduleEvidence(sourceText);
  return runTaggedExtraction(
    MODELS,
    structurePrompt,
    `SYLLABUS SCHEDULE TABLE PAGES:\n${scheduleEvidence}`,
    2700,
    "Focused schedule-structure",
    (analysis) => {
      if (structureNeedsRepair(analysis, sourceText)) {
        throw Object.assign(
          new Error(
            "Focused AI still did not recover the complete schedule across assessment blocks.",
          ),
          { status: 422 },
        );
      }
    },
  );
}

function validateMainCandidate(analysis: SyllabusAnalysis, sourceText: string) {
  if (hasVisibleGradingWeights(sourceText) && analysis.gradingCategories.length === 0) {
    throw Object.assign(new Error("AI missed explicitly stated grading weights."), {
      status: 422,
    });
  }
}

function validateFinalAnalysis(analysis: SyllabusAnalysis, sourceText: string) {
  if (topicCount(analysis) === 0 && /schedule|topic|week/i.test(sourceText)) {
    throw Object.assign(new Error("AI missed the explicit course schedule topics after repair."), {
      status: 422,
    });
  }

  if (structureNeedsRepair(analysis, sourceText)) {
    throw Object.assign(
      new Error("AI syllabus structure is still incomplete after focused schedule repair."),
      { status: 422 },
    );
  }

  if (hasVisibleGradingWeights(sourceText) && analysis.gradingCategories.length === 0) {
    throw Object.assign(new Error("AI missed explicitly stated grading weights."), {
      status: 422 },
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
  const main = await runTaggedExtraction(
    MODELS,
    systemPrompt,
    `FULL SYLLABUS WITH PAGE MARKERS:\n${sourceText}`,
    2200,
    "Whole-syllabus",
    (analysis) => validateMainCandidate(analysis, sourceText),
  );

  const analysis = main.analysis;

  let gradeScaleModel = "";
  let structureModel = "";
  let gradeScaleAttempts = 0;
  let structureAttempts = 0;

  if (structureNeedsRepair(analysis, sourceText)) {
    const repaired = await recoverStructure(sourceText);
    analysis.assessments = repaired.analysis.assessments;
    analysis.units = repaired.analysis.units;
    analysis.unassignedTopics = repaired.analysis.unassignedTopics;
    analysis.importantDates = repaired.analysis.importantDates;
    structureModel = repaired.model;
    structureAttempts = repaired.failures.length + 1;
  }

  if (hasVisibleGradeScale(sourceText) && !hasUsableGradeScale(analysis)) {
    const repaired = await recoverGradeScale(sourceText);
    analysis.gradingScale = repaired.analysis.gradingScale;
    gradeScaleModel = repaired.model;
    gradeScaleAttempts = repaired.failures.length + 1;
  }

  normalizeFinalAnalysis(analysis);
  validateFinalAnalysis(analysis, sourceText);

  const modelsUsed = [
    ...new Set([main.model, gradeScaleModel, structureModel].filter(Boolean)),
  ];

  const pipelineChunks: SyllabusPipelineChunk[] = [
    {
      index: 0,
      text: "Layout-aware whole-document AI syllabus extraction",
      status: "ready",
      memory: analysis,
      attempts: main.failures.length + 1,
      lastError: null,
    },
  ];

  if (gradeScaleModel) {
    pipelineChunks.push({
      index: pipelineChunks.length,
      text: "Focused AI grading-grid recovery",
      status: "ready",
      memory: { ...analysis, units: [], unassignedTopics: [], assessments: [] },
      attempts: gradeScaleAttempts,
      lastError: null,
    });
  }

  if (structureModel) {
    pipelineChunks.push({
      index: pipelineChunks.length,
      text: "Focused AI complete schedule-grid recovery",
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
      ...(gradeScaleModel ? { grade_scale_verification: gradeScaleModel } : {}),
      ...(structureModel ? { schedule_structure_verification: structureModel } : {}),
    },
  };
}
