import { getGroqClient } from "./ai/groq";
import {
  parseTaggedSyllabusChunk,
  type SyllabusAnalysis,
  type SyllabusPipelineChunk,
} from "./syllabus-analysis-pipeline";

export const TARGETED_SYLLABUS_MODE = "ai-targeted-v1";

type TaskName = "grading" | "structure" | "calendar" | "metadata";

type TaskDefinition = {
  name: TaskName;
  prompt: string;
  models: readonly string[];
  maxTokens: number;
  accepts: (analysis: SyllabusAnalysis, raw: string) => boolean;
};

const sharedRules = `You are searching a college syllabus for a specific set of facts.
Use ONLY the supplied syllabus text. Search the entire document before answering.
Do not infer missing facts from conventions. Do not repair, calculate, or invent unsupported information.
The text contains PAGE markers. Preserve wording and dates as closely as possible.
Return only the requested tagged lines with literal TAB characters between fields, plus CONFIDENCE<TAB>0-100.
Do not output markdown, JSON, commentary, or code fences.`;

const gradingPrompt = `${sharedRules}

TASK: GRADING ONLY.
Find the grading section and the exact letter-grade cutoff table, if one is stated.

Required behavior:
- GRADE_CATEGORY is a TOP-LEVEL gradebook category only.
- If a parent category says something like "Midterm Exams 30% total, 15% each", output ONE GRADE_CATEGORY for Midterm Exams at 30%. The individual midterms are assessments, not extra grading categories.
- Search specifically for letter grades such as A, A-, B+, B, etc. If a cutoff table exists, output EVERY stated row, including the exact lower and upper bounds. Do not stop after finding the percentage weights.
- Never assume a standard grading scale.
- Before answering, re-scan the document once for any additional grade-scale rows you may have missed.

Allowed tags:
GRADE_CATEGORY<TAB>name<TAB>weight percent number<TAB>notes
GRADE_SCALE<TAB>letter grade<TAB>minimum percent<TAB>maximum percent<TAB>notes
ASSESSMENT<TAB>name<TAB>type<TAB>date exactly as written<TAB>notes
WARNING<TAB>warning
CONFIDENCE<TAB>0-100`;

const structurePrompt = `${sharedRules}

TASK: COURSE STRUCTURE AND SCHEDULE TOPICS ONLY.
Read the syllabus schedule in order and build the academic study structure.

Required behavior:
- Preserve an explicit unit/module/section hierarchy if the professor actually provides one.
- If there is no explicit unit hierarchy but exams divide the scheduled material, create assessment_block units by READING the schedule and exam boundaries semantically.
- In that case, Unit 1 contains the scheduled instructional topics before the first midterm, Unit 2 contains topics after the first midterm and before the second midterm, and so on. The final instructional block contains material after the last midterm leading to the final exam.
- Do not use ordinary calendar-date arithmetic as the basis. Follow the syllabus's sequence and exam rows.
- Exam rows themselves are assessments, not TOPIC rows.
- If the syllabus lists multiple section-specific final exam times, those are alternative dates for the same final assessment, not extra units.
- Every scheduled instructional topic should appear exactly once. Keep its date, reading, and assignment in the same row.
- Do not create units from holidays, breaks, project due dates, or final-exam date options.

Allowed tags:
UNIT<TAB>name<TAB>description<TAB>explicit_unit or assessment_block<TAB>basis<TAB>assessment name<TAB>coverage
TOPIC<TAB>unit name or UNASSIGNED<TAB>topic name<TAB>date<TAB>reading<TAB>assignment
WARNING<TAB>warning
CONFIDENCE<TAB>0-100`;

const calendarPrompt = `${sharedRules}

TASK: ASSESSMENTS AND IMPORTANT CALENDAR DATES ONLY.
Find the dates a student would reasonably need on the course calendar.

Required behavior:
- Extract exams, quizzes if explicitly scheduled, project deadlines, assignment deadlines, presentations, required course events, and explicit no-class/holiday dates when relevant.
- Do NOT turn every lecture/topic date into an important calendar event. Normal class-meeting dates belong in TOPIC rows from the structure task, not here.
- Preserve alternative or section-specific final exam dates distinctly and label them clearly.
- Do not duplicate the same assessment under several names.

Allowed tags:
ASSESSMENT<TAB>name<TAB>type<TAB>date exactly as written<TAB>notes
DATE<TAB>name<TAB>date exactly as written<TAB>type
WARNING<TAB>warning
CONFIDENCE<TAB>0-100`;

const metadataPrompt = `${sharedRules}

TASK: COURSE IDENTITY, POLICIES, AND SCHEDULE NOTES ONLY.
Find explicit course metadata and useful policies.

Allowed tags:
COURSE<TAB>course code<TAB>course name<TAB>professor<TAB>term<TAB>credits
POLICY<TAB>category<TAB>summary
SCHEDULE_NOTE<TAB>note
WARNING<TAB>warning
CONFIDENCE<TAB>0-100`;

const TASKS: readonly TaskDefinition[] = [
  {
    name: "grading",
    prompt: gradingPrompt,
    models: [
      "openai/gpt-oss-120b",
      "groq/compound-mini",
      "openai/gpt-oss-20b",
      "qwen/qwen3.6-27b",
    ],
    maxTokens: 2200,
    accepts: (analysis, raw) =>
      analysis.gradingCategories.length > 0 ||
      analysis.gradingScale.length > 0 ||
      /^WARNING\t/m.test(raw),
  },
  {
    name: "structure",
    prompt: structurePrompt,
    models: [
      "groq/compound",
      "openai/gpt-oss-120b",
      "openai/gpt-oss-20b",
      "qwen/qwen3.6-27b",
    ],
    maxTokens: 3200,
    accepts: (analysis, raw) =>
      analysis.units.length > 0 ||
      analysis.unassignedTopics.length > 0 ||
      /^WARNING\t/m.test(raw),
  },
  {
    name: "calendar",
    prompt: calendarPrompt,
    models: [
      "openai/gpt-oss-20b",
      "groq/compound-mini",
      "openai/gpt-oss-120b",
      "qwen/qwen3.6-27b",
    ],
    maxTokens: 1800,
    accepts: (analysis, raw) =>
      analysis.assessments.length > 0 ||
      analysis.importantDates.length > 0 ||
      /^WARNING\t/m.test(raw),
  },
  {
    name: "metadata",
    prompt: metadataPrompt,
    models: [
      "groq/compound-mini",
      "openai/gpt-oss-20b",
      "openai/gpt-oss-120b",
      "qwen/qwen3.6-27b",
    ],
    maxTokens: 1600,
    accepts: (analysis, raw) =>
      Boolean(analysis.courseInfo.courseCode || analysis.courseInfo.courseName) ||
      analysis.policies.length > 0 ||
      /^WARNING\t/m.test(raw),
  },
] as const;

function emptyAnalysis(): SyllabusAnalysis {
  return {
    courseInfo: {
      courseCode: "",
      courseName: "",
      professor: "",
      term: "",
      credits: 0,
    },
    gradingCategories: [],
    gradingScale: [],
    assessments: [],
    units: [],
    unassignedTopics: [],
    importantDates: [],
    policies: [],
    scheduleNotes: [],
    warnings: [],
    overallConfidence: 0,
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error ?? "Unknown error");
}

function errorStatus(error: unknown) {
  const status = Number((error as { status?: number })?.status);
  return Number.isFinite(status) ? status : null;
}

function isRetryableModelError(error: unknown) {
  const status = errorStatus(error);
  const message = errorMessage(error).toLowerCase();
  return (
    status === 400 ||
    status === 403 ||
    status === 404 ||
    status === 408 ||
    status === 409 ||
    status === 413 ||
    status === 422 ||
    status === 424 ||
    status === 429 ||
    (status !== null && status >= 500) ||
    message.includes("rate limit") ||
    message.includes("rate_limit") ||
    message.includes("tokens per") ||
    message.includes("do not have access") ||
    message.includes("model_not_found") ||
    message.includes("temporarily unavailable") ||
    message.includes("capacity") ||
    message.includes("timeout") ||
    message.includes("truncated")
  );
}

function validateTaggedResponse(content: string) {
  return /^CONFIDENCE\t/m.test(content);
}

async function runTask(task: TaskDefinition, sourceText: string) {
  const failures: Array<{ model: string; error: string; status: number | null }> = [];

  for (const model of task.models) {
    try {
      const completion = await getGroqClient().chat.completions.create({
        model,
        messages: [
          { role: "system", content: task.prompt },
          {
            role: "user",
            content: `FULL SYLLABUS WITH PAGE MARKERS:\n${sourceText}`,
          },
        ],
        temperature: 0,
        max_completion_tokens: task.maxTokens,
      });

      const choice = completion.choices[0];
      const content = choice?.message?.content?.trim();
      if (!content) {
        throw Object.assign(new Error("AI returned an empty extraction."), {
          status: 422,
        });
      }
      if (choice.finish_reason === "length") {
        throw Object.assign(new Error("AI extraction was truncated."), {
          status: 422,
        });
      }
      if (!validateTaggedResponse(content)) {
        throw Object.assign(new Error("AI extraction did not follow the tagged format."), {
          status: 422,
        });
      }

      const analysis = parseTaggedSyllabusChunk(content);
      if (!task.accepts(analysis, content)) {
        throw Object.assign(
          new Error(`AI ${task.name} search did not return usable evidence.`),
          { status: 422 },
        );
      }

      return { task: task.name, model, analysis, raw: content, failures };
    } catch (error) {
      failures.push({
        model,
        error: errorMessage(error),
        status: errorStatus(error),
      });
      console.warn("Targeted syllabus AI task failed:", {
        task: task.name,
        model,
        status: errorStatus(error),
        error: errorMessage(error),
      });
      if (!isRetryableModelError(error)) throw error;
    }
  }

  const finalFailure = failures[failures.length - 1];
  const error = Object.assign(
    new Error(
      `AI could not finish the ${task.name} syllabus search. ${finalFailure?.error ?? "No model was available."}`,
    ),
    { status: finalFailure?.status ?? 503, task: task.name, failures },
  );
  throw error;
}

function dedupeBy<T>(items: T[], identity: (item: T) => string) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const id = identity(item).toLowerCase().replace(/\s+/g, " ").trim();
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function mergeTargetedResults(
  results: Awaited<ReturnType<typeof runTask>>[],
): SyllabusAnalysis {
  const merged = emptyAnalysis();

  for (const result of results) {
    const analysis = result.analysis;
    if (result.task === "grading") {
      merged.gradingCategories.push(...analysis.gradingCategories);
      merged.gradingScale.push(...analysis.gradingScale);
    } else if (result.task === "structure") {
      merged.units.push(...analysis.units);
      merged.unassignedTopics.push(...analysis.unassignedTopics);
    } else if (result.task === "calendar") {
      merged.assessments.push(...analysis.assessments);
      merged.importantDates.push(...analysis.importantDates);
    } else if (result.task === "metadata") {
      merged.courseInfo = { ...analysis.courseInfo };
      merged.policies.push(...analysis.policies);
      merged.scheduleNotes.push(...analysis.scheduleNotes);
    }
    merged.warnings.push(...analysis.warnings);
  }

  merged.gradingCategories = dedupeBy(
    merged.gradingCategories,
    (item) => item.name,
  );
  merged.gradingScale = dedupeBy(
    merged.gradingScale,
    (item) => item.letterGrade,
  );
  merged.assessments = dedupeBy(
    merged.assessments,
    (item) => `${item.name}|${item.date}`,
  );
  merged.importantDates = dedupeBy(
    merged.importantDates,
    (item) => `${item.name}|${item.date}`,
  );
  merged.policies = dedupeBy(
    merged.policies,
    (item) => `${item.category}|${item.summary}`,
  );
  merged.scheduleNotes = dedupeBy(merged.scheduleNotes, (item) => item);
  merged.warnings = dedupeBy(merged.warnings, (item) => item);

  const confidences = results
    .map((result) => result.analysis.overallConfidence)
    .filter((value) => value > 0);
  merged.overallConfidence = confidences.length
    ? Math.round(confidences.reduce((sum, value) => sum + value, 0) / confidences.length)
    : 0;

  return merged;
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
  const results = await Promise.all(TASKS.map((task) => runTask(task, sourceText)));
  const analysis = mergeTargetedResults(results);

  return {
    analysis,
    pipelineChunks: results.map((result, index) => ({
      index,
      text: `AI search task: ${result.task}`,
      status: "ready",
      memory: result.analysis,
      attempts: result.failures.length + 1,
      lastError: null,
    })),
    modelsUsed: [...new Set(results.map((result) => result.model))],
    taskModels: Object.fromEntries(
      results.map((result) => [result.task, result.model]),
    ),
  };
}
