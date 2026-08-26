import { getGroqClient } from "./ai/groq";
import {
  parseTaggedSyllabusChunk,
  type SyllabusAnalysis,
  type SyllabusPipelineChunk,
} from "./syllabus-analysis-pipeline";

export const TARGETED_SYLLABUS_MODE = "ai-whole-document-v2";

const MODELS = [
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "qwen/qwen3.6-27b",
] as const;

const systemPrompt = `Read this college syllabus as one document and extract its course setup.
Use only facts explicitly supported by the syllabus. Do not invent missing information.

COURSE IDENTITY
- Extract the explicit course code, course name, professor/instructor, term, and credits if stated.

GRADING
- Extract only TOP-LEVEL gradebook categories and their full weights.
- If a syllabus says "Midterm Exams: 30% total; 15% each", output ONE 30% Midterm Exams category. Midterm 1 and Midterm 2 are assessments, not extra grade categories.
- If the syllabus states a letter-grade scale, output EVERY stated row exactly. Do not stop after finding category percentages. Preserve decimal cutoffs such as 92.9 and 89.9.
- Never assume a standard grading scale.

ACADEMIC STRUCTURE
- If the professor explicitly names units/modules/sections, preserve them.
- If there is no explicit unit hierarchy but the schedule is divided by major exams, create assessment_block units by READING the schedule in sequence.
- In that case, the first block contains instructional material before the first midterm, the next contains material after that midterm and before the next midterm, and the final block contains material after the last midterm leading to the final exam.
- Do not use holidays, breaks, due dates, presentation dates, or final-exam options as units.
- Exam rows are assessments, not topics.
- Preserve every explicit scheduled instructional topic exactly once. Keep the correct date, reading, and assignment with the correct class-meeting row. Be especially careful with multi-column schedule tables.
- Do not infer detailed topics that the syllabus does not explicitly state.

CALENDAR
- Extract major exams, quizzes if explicitly scheduled, project/assignment deadlines, presentations, required events, and explicit no-class/break dates that belong on a student's course calendar.
- Do not turn every ordinary lecture date into an important calendar event.
- Preserve alternative final-exam dates as distinct options for the same final assessment.

POLICIES
- Extract useful explicit course policies and schedule notes without inventing rules.

Return ONLY lines in this tagged format using literal TAB characters between fields:
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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error ?? "Unknown error");
}

function errorStatus(error: unknown) {
  const status = Number((error as { status?: number })?.status);
  return Number.isFinite(status) ? status : null;
}

function hasVisibleGradeScale(sourceText: string) {
  const text = sourceText.replace(/[–—]/g, "-");
  return (
    /grading\s+scale/i.test(text) &&
    /\bA[-+]?\s+\d/i.test(text) &&
    /\bF\s+\d/i.test(text)
  );
}

function hasVisibleGradingWeights(sourceText: string) {
  return /(?:grading|assessment|components|weights)[\s\S]{0,1800}\d+(?:\.\d+)?\s*%/i.test(
    sourceText,
  );
}

function hasVisibleSchedule(sourceText: string) {
  return /(?:course\s+schedule|week\s*[|]|\bcontent\b[\s\S]{0,500}\bmidterm\b)/i.test(
    sourceText,
  );
}

function hasVisibleMajorAssessments(sourceText: string) {
  return /\b(?:midterm|final\s+exam|exam\s+date|project\s+presentation)\b/i.test(
    sourceText,
  );
}

function validateAnalysis(analysis: SyllabusAnalysis, sourceText: string) {
  if (hasVisibleGradingWeights(sourceText) && analysis.gradingCategories.length === 0) {
    throw Object.assign(
      new Error("AI missed an explicitly stated grading-weight section."),
      { status: 422 },
    );
  }

  if (hasVisibleGradeScale(sourceText) && analysis.gradingScale.length < 5) {
    throw Object.assign(
      new Error("AI missed an explicitly stated letter-grade scale."),
      { status: 422 },
    );
  }

  const topicCount =
    analysis.unassignedTopics.length +
    analysis.units.reduce((sum, unit) => sum + unit.topics.length, 0);
  if (hasVisibleSchedule(sourceText) && topicCount === 0) {
    throw Object.assign(
      new Error("AI missed the explicit course schedule topics."),
      { status: 422 },
    );
  }

  if (
    hasVisibleMajorAssessments(sourceText) &&
    analysis.assessments.length === 0 &&
    analysis.importantDates.length === 0
  ) {
    throw Object.assign(
      new Error("AI missed explicitly stated major assessment dates."),
      { status: 422 },
    );
  }
}

function buildRequest(model: string, sourceText: string) {
  const base = {
    model,
    messages: [
      { role: "system" as const, content: systemPrompt },
      {
        role: "user" as const,
        content: `FULL SYLLABUS WITH PAGE MARKERS:\n${sourceText}`,
      },
    ],
    temperature: 0,
    max_completion_tokens: 2800,
  };

  if (model.startsWith("openai/gpt-oss-")) {
    return {
      ...base,
      reasoning_effort: "low" as const,
    };
  }

  return base;
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
  const failures: Array<{ model: string; error: string; status: number | null }> = [];

  for (const model of MODELS) {
    try {
      console.log("Whole-syllabus AI attempt:", {
        model,
        characters: sourceText.length,
        maxCompletionTokens: 2800,
      });

      const completion = await getGroqClient().chat.completions.create(
        buildRequest(model, sourceText),
      );
      const choice = completion.choices[0];
      const content = choice?.message?.content?.trim();

      if (!content) {
        throw Object.assign(new Error("AI returned an empty syllabus extraction."), {
          status: 422,
        });
      }
      if (choice.finish_reason === "length") {
        throw Object.assign(new Error("AI syllabus extraction was truncated."), {
          status: 422,
        });
      }
      if (!/^CONFIDENCE\t/m.test(content)) {
        throw Object.assign(
          new Error("AI syllabus extraction did not follow the tagged format."),
          { status: 422 },
        );
      }

      const analysis = parseTaggedSyllabusChunk(content);
      validateAnalysis(analysis, sourceText);

      return {
        analysis,
        pipelineChunks: [
          {
            index: 0,
            text: "Whole-document AI syllabus extraction",
            status: "ready",
            memory: analysis,
            attempts: failures.length + 1,
            lastError: null,
          },
        ],
        modelsUsed: [model],
        taskModels: { whole_document: model },
      };
    } catch (error) {
      const failure = {
        model,
        error: errorMessage(error),
        status: errorStatus(error),
      };
      failures.push(failure);
      console.warn("Whole-syllabus AI attempt failed:", failure);
    }
  }

  const last = failures[failures.length - 1];
  throw Object.assign(
    new Error(
      `AI could not finish the syllabus extraction. ${last?.error ?? "No model was available."}`,
    ),
    {
      status: last?.status ?? 503,
      failures,
    },
  );
}
