import { getGroqClient } from "./ai/groq";
import {
  parseTaggedSyllabusChunk,
  type SyllabusAnalysis,
  type SyllabusPipelineChunk,
} from "./syllabus-analysis-pipeline";

export const TARGETED_SYLLABUS_MODE = "ai-layout-aware-v7-repair-first";

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
- Be especially careful with multi-column schedule grids and use [x=...] coordinates to keep cells aligned.
- Do not infer detailed topics that the syllabus does not explicitly state.

CALENDAR
- Extract major exams, explicitly scheduled quizzes, assignment/project deadlines, presentations, required events, and explicit no-class/break dates.
- Do not turn ordinary lecture dates into important calendar events.
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

const structurePrompt = `Read ONLY the supplied schedule evidence from a college syllabus.
The evidence may use [x=...] markers. Those are horizontal PDF coordinates and reveal table columns.
Reconstruct the schedule grid first, then build the study hierarchy.

Rules:
- Week labels are schedule metadata, never study units.
- Major tests define study blocks unless the professor explicitly gives a better academic unit hierarchy.
- If there are Midterm 1, Midterm 2, and Final Exam boundaries, create Midterm 1, Midterm 2, and Final Exam assessment_block units.
- Put each instructional topic into the test block it leads up to.
- An exam row is an assessment boundary, not a topic.
- Preserve each explicit topic exactly once with the correct date, reading, and assignment.
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
  return /grading\s+scale/i.test(text) && /\bA[-+]?\b/i.test(text) && /\bF\b/i.test(text);
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

function buildScheduleEvidence(sourceText: string) {
  const pages = splitPages(sourceText);
  const firstSchedule = pages.findIndex((page) =>
    /course\s+schedule|class\s+schedule|weekly\s+schedule|\bweek\b[\s\S]{0,500}\btopic/i.test(
      page.text,
    ),
  );

  if (firstSchedule >= 0) {
    return pages
      .slice(firstSchedule)
      .map((page) => page.text)
      .join("\n\n")
      .slice(0, 14000);
  }

  const relevant = pages.filter((page) =>
    /\bmidterm\b|\bfinal\s+exam\b|\btest\s*\d+\b|\btopic\b/i.test(page.text),
  );
  return (relevant.length ? relevant : pages)
    .map((page) => page.text)
    .join("\n\n")
    .slice(0, 14000);
}

function topicCount(analysis: SyllabusAnalysis) {
  return (
    analysis.unassignedTopics.length +
    analysis.units.reduce((sum, unit) => sum + unit.topics.length, 0)
  );
}

function majorAssessmentCount(analysis: SyllabusAnalysis, sourceText: string) {
  const names = new Set<string>();
  for (const assessment of analysis.assessments) {
    const text = `${assessment.name} ${assessment.type}`.toLowerCase();
    const midterm = text.match(/midterm\s*(\d+)/);
    const test = text.match(/test\s*(\d+)/);
    if (midterm) names.add(`midterm-${midterm[1]}`);
    if (test) names.add(`test-${test[1]}`);
    if (/final\s+exam/.test(text)) names.add("final");
  }

  for (const match of sourceText.matchAll(/\bmidterm\s*(\d+)\b/gi)) {
    names.add(`midterm-${match[1]}`);
  }
  for (const match of sourceText.matchAll(/\btest\s*(\d+)\b/gi)) {
    names.add(`test-${match[1]}`);
  }
  if (/\bfinal\s+exam\b/i.test(sourceText)) names.add("final");

  return names.size;
}

function isWeekUnit(name: string) {
  return /^\s*(?:week|wk)\s*(?:\d+|[ivxlcdm]+)\b/i.test(name);
}

function structureNeedsRepair(analysis: SyllabusAnalysis, sourceText: string) {
  const totalTopics = topicCount(analysis);
  if (totalTopics === 0) return true;

  const exams = majorAssessmentCount(analysis, sourceText);
  if (exams < 2) return analysis.units.some((unit) => isWeekUnit(unit.name));

  const nonEmptyUnits = analysis.units.filter((unit) => unit.topics.length > 0);
  if (nonEmptyUnits.length < 2) return true;
  if (analysis.units.some((unit) => isWeekUnit(unit.name))) return true;

  const largest = Math.max(...nonEmptyUnits.map((unit) => unit.topics.length));
  return totalTopics >= 6 && largest / totalTopics > 0.82;
}

function hasVisibleGradingWeights(sourceText: string) {
  return /grading[\s\S]{0,1600}\d+(?:\.\d+)?\s*%/i.test(sourceText);
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
  return runTaggedExtraction(
    MODELS,
    structurePrompt,
    `SYLLABUS SCHEDULE EVIDENCE:\n${buildScheduleEvidence(sourceText)}`,
    1800,
    "Focused schedule-structure",
    (analysis) => {
      if (structureNeedsRepair(analysis, sourceText)) {
        throw Object.assign(
          new Error(
            "Focused AI still did not distribute syllabus topics across assessment blocks correctly.",
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
      new Error("AI syllabus structure is still invalid after focused schedule repair."),
      { status: 422 },
    );
  }

  if (hasVisibleGradingWeights(sourceText) && analysis.gradingCategories.length === 0) {
    throw Object.assign(new Error("AI missed explicitly stated grading weights."), {
      status: 422,
    });
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

  // Repair the schedule before final validation. A zero-topic main extraction is
  // exactly the case this focused schedule reader exists to recover from.
  if (structureNeedsRepair(analysis, sourceText)) {
    const repaired = await recoverStructure(sourceText);
    analysis.assessments = repaired.analysis.assessments;
    analysis.units = repaired.analysis.units;
    analysis.unassignedTopics = repaired.analysis.unassignedTopics;
    if (repaired.analysis.importantDates.length > 0) {
      analysis.importantDates = repaired.analysis.importantDates;
    }
    structureModel = repaired.model;
    structureAttempts = repaired.failures.length + 1;
  }

  if (hasVisibleGradeScale(sourceText) && !hasUsableGradeScale(analysis)) {
    const repaired = await recoverGradeScale(sourceText);
    analysis.gradingScale = repaired.analysis.gradingScale;
    gradeScaleModel = repaired.model;
    gradeScaleAttempts = repaired.failures.length + 1;
  }

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
      text: "Focused AI schedule-grid recovery",
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
