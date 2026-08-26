import { getGroqClient } from "./ai/groq";
import {
  parseTaggedSyllabusChunk,
  type SyllabusAnalysis,
  type SyllabusPipelineChunk,
} from "./syllabus-analysis-pipeline";

export const TARGETED_SYLLABUS_MODE = "ai-whole-document-v4-assessment-units";

const MODELS = [
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "qwen/qwen3.6-27b",
] as const;

const GRADE_SCALE_MODELS = [
  "openai/gpt-oss-20b",
  "openai/gpt-oss-120b",
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
- CollegeOS study units should normally represent MAJOR TEST / ASSESSMENT BLOCKS, not calendar weeks.
- A heading such as Week 1, Week 2, Week 3, Wk 4, or a date range is schedule organization only. NEVER create a UNIT from a week heading.
- If the course has Midterm 1, Midterm 2, and a Final Exam, the default study hierarchy should be three assessment_block units named Midterm 1, Midterm 2, and Final Exam.
- Put the instructional topics that occur before Midterm 1 into the Midterm 1 unit. Put topics after Midterm 1 and before Midterm 2 into the Midterm 2 unit. Put topics after Midterm 2 into the Final Exam unit.
- The exam row itself is an assessment boundary and must NOT be emitted as a TOPIC.
- Reviews may remain topics only when the syllabus explicitly schedules a substantive review session.
- If the professor explicitly names meaningful content units/modules/sections, preserve them only when they are genuine academic groupings, not week labels. When major tests clearly define the study flow, prefer assessment_block units because students study by test.
- Do not use holidays, breaks, due dates, presentation dates, or final-exam options as units.
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

const gradeScalePrompt = `Read the supplied syllabus grading evidence and extract ONLY the explicitly stated letter-grade cutoff scale.
Use only the supplied text. Do not assume a standard scale and do not calculate missing cutoffs.

Important:
- Return EVERY stated letter grade, including plus and minus grades.
- Convert a printed range to minimum then maximum. Example: "A 100-93" becomes minimum 93 and maximum 100.
- Preserve decimals exactly, such as 92.9, 89.9, and 59.9.
- A grading scale printed across multiple columns or separated by vertical bars is still one scale. Read every entry.
- Do not return grading-category weights, assessments, topics, dates, or commentary.

Return ONLY these tagged lines using literal TAB characters:
GRADE_SCALE<TAB>letter grade<TAB>minimum percent<TAB>maximum percent<TAB>notes
CONFIDENCE<TAB>0-100`;

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
  return /\b(?:midterm|final\s+exam|exam\s+date|project\s+presentation|\btest\s*\d*)\b/i.test(
    sourceText,
  );
}

function isWeekBucketName(name: string) {
  return /^\s*(?:week|wk)\s*(?:\d+|[ivxlcdm]+)\b/i.test(name);
}

function usesWeekBucketsAsUnits(analysis: SyllabusAnalysis) {
  if (analysis.units.length < 2) return false;
  const weekUnits = analysis.units.filter((unit) => isWeekBucketName(unit.name));
  return weekUnits.length >= 2 && weekUnits.length / analysis.units.length >= 0.5;
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

function buildGradeScaleEvidence(sourceText: string) {
  const pages = splitPages(sourceText);
  const directIndexes = pages
    .map((page, index) => ({ page, index }))
    .filter(({ page }) => /grading\s+scale|evaluation\s*&?\s*grading/i.test(page.text))
    .map(({ index }) => index);

  if (directIndexes.length === 0) {
    return sourceText.slice(0, Math.min(sourceText.length, 5000));
  }

  const selected = new Set<number>();
  for (const index of directIndexes) {
    selected.add(index);
    if (index > 0) selected.add(index - 1);
    if (index + 1 < pages.length) selected.add(index + 1);
  }

  return [...selected]
    .sort((a, b) => a - b)
    .map((index) => pages[index].text)
    .join("\n\n");
}

function validateAnalysisExceptGradeScale(
  analysis: SyllabusAnalysis,
  sourceText: string,
) {
  if (hasVisibleGradingWeights(sourceText) && analysis.gradingCategories.length === 0) {
    throw Object.assign(
      new Error("AI missed an explicitly stated grading-weight section."),
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

  if (hasVisibleMajorAssessments(sourceText) && usesWeekBucketsAsUnits(analysis)) {
    throw Object.assign(
      new Error(
        "AI incorrectly used calendar weeks as study units. Study units must be organized around major tests/assessment blocks.",
      ),
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

function buildGradeScaleRequest(model: string, evidenceText: string) {
  const base = {
    model,
    messages: [
      { role: "system" as const, content: gradeScalePrompt },
      {
        role: "user" as const,
        content: `SYLLABUS GRADING EVIDENCE:\n${evidenceText}`,
      },
    ],
    temperature: 0,
    max_completion_tokens: 650,
  };

  if (model.startsWith("openai/gpt-oss-")) {
    return {
      ...base,
      reasoning_effort: "low" as const,
    };
  }

  return base;
}

async function recoverGradeScale(sourceText: string) {
  const evidenceText = buildGradeScaleEvidence(sourceText);
  const failures: Array<{ model: string; error: string; status: number | null }> = [];

  for (const model of GRADE_SCALE_MODELS) {
    try {
      console.log("Focused grade-scale AI attempt:", {
        model,
        evidenceCharacters: evidenceText.length,
        maxCompletionTokens: 650,
      });

      const completion = await getGroqClient().chat.completions.create(
        buildGradeScaleRequest(model, evidenceText),
      );
      const choice = completion.choices[0];
      const content = choice?.message?.content?.trim();

      if (!content) {
        throw Object.assign(new Error("AI returned an empty grade-scale extraction."), {
          status: 422,
        });
      }
      if (choice.finish_reason === "length") {
        throw Object.assign(new Error("AI grade-scale extraction was truncated."), {
          status: 422,
        });
      }
      if (!/^CONFIDENCE\t/m.test(content)) {
        throw Object.assign(
          new Error("AI grade-scale extraction did not follow the tagged format."),
          { status: 422 },
        );
      }

      const analysis = parseTaggedSyllabusChunk(content);
      if (!hasUsableGradeScale(analysis)) {
        throw Object.assign(
          new Error("AI did not return a complete, correctly ordered visible letter-grade scale."),
          { status: 422 },
        );
      }

      console.log("Focused grade-scale AI recovered scale:", {
        model,
        rows: analysis.gradingScale.length,
      });

      return {
        gradingScale: analysis.gradingScale,
        model,
        failures,
      };
    } catch (error) {
      const failure = {
        model,
        error: errorMessage(error),
        status: errorStatus(error),
      };
      failures.push(failure);
      console.warn("Focused grade-scale AI attempt failed:", failure);
    }
  }

  const last = failures[failures.length - 1];
  throw Object.assign(
    new Error(
      `AI could not recover the explicitly stated grading scale. ${last?.error ?? "No model was available."}`,
    ),
    { status: last?.status ?? 503, failures },
  );
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
          status: 422 },
        );
      }
      if (!/^CONFIDENCE\t/m.test(content)) {
        throw Object.assign(
          new Error("AI syllabus extraction did not follow the tagged format."),
          { status: 422 },
        );
      }

      const analysis = parseTaggedSyllabusChunk(content);
      validateAnalysisExceptGradeScale(analysis, sourceText);

      let gradeScaleModel = "";
      let gradeScaleAttempts = 0;
      if (hasVisibleGradeScale(sourceText) && !hasUsableGradeScale(analysis)) {
        const recovered = await recoverGradeScale(sourceText);
        analysis.gradingScale = recovered.gradingScale;
        gradeScaleModel = recovered.model;
        gradeScaleAttempts = recovered.failures.length + 1;
      }

      const modelsUsed = [...new Set([model, gradeScaleModel].filter(Boolean))];
      const pipelineChunks: SyllabusPipelineChunk[] = [
        {
          index: 0,
          text: "Whole-document AI syllabus extraction",
          status: "ready",
          memory: analysis,
          attempts: failures.length + 1,
          lastError: null,
        },
      ];

      if (gradeScaleModel) {
        pipelineChunks.push({
          index: 1,
          text: "Focused AI grading-scale verification",
          status: "ready",
          memory: {
            ...analysis,
            gradingCategories: [],
            assessments: [],
            units: [],
            unassignedTopics: [],
            importantDates: [],
            policies: [],
            scheduleNotes: [],
            warnings: [],
          },
          attempts: gradeScaleAttempts,
          lastError: null,
        });
      }

      return {
        analysis,
        pipelineChunks,
        modelsUsed,
        taskModels: {
          whole_document: model,
          ...(gradeScaleModel ? { grade_scale_verification: gradeScaleModel } : {}),
        },
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
