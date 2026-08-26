import { getGroqClient } from "./ai/groq";
import {
  buildSyllabusChunks,
  parseTaggedSyllabusChunk,
  type SyllabusAnalysis,
  type SyllabusPipelineChunk,
} from "./syllabus-analysis-pipeline";

const SYLLABUS_MODEL_LANES = [
  "openai/gpt-oss-20b",
  "openai/gpt-oss-120b",
  "qwen/qwen3.6-27b",
  "groq/compound-mini",
  "groq/compound",
] as const;

const systemPrompt = `You extract structured facts from ONE CHUNK of a college syllabus.

Use only information explicitly supported by this chunk. Do not invent course facts, dates, topics, policies, assignments, grade weights, or units.

GRADING RULES:
- GRADE_CATEGORY means a top-level gradebook category only.
- Never output both an aggregate category and its component assessments as separate grade categories.
- If a syllabus says "Midterm Exams: 30% total; 15% each", output one GRADE_CATEGORY for Midterm Exams at 30%. Midterm 1 and Midterm 2 are ASSESSMENT rows.
- Preserve explicit letter-grade cutoffs exactly. Never infer a standard grading scale.

STRUCTURE RULES:
- Preserve explicit unit/module/section hierarchies only when this chunk states them.
- Otherwise emit scheduled class meetings as UNASSIGNED topics. The application groups them around exams later.
- For schedule tables, preserve one TOPIC per non-empty class content row with the correct date, reading, and assignment.
- Do not combine multiple dated rows into one topic.

Keep unsupported fields empty. Return only the tagged format requested below.`;

const taggedOutputPrompt = `OUTPUT FORMAT:
Return ONLY lines in this tagged format. Use literal TAB characters between fields.

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

Rules:
- Omit unsupported lines rather than inventing values.
- COURSE and CONFIDENCE may appear once. Every other tag may repeat.
- Use UNASSIGNED when a topic is explicit but there is no explicit unit hierarchy.
- Individual exams, quizzes, projects, or assignments inside an aggregate grade category are ASSESSMENT rows, not duplicate GRADE_CATEGORY rows.
- Emit each dated schedule row separately.
- Do not output JSON, markdown, headings, commentary, or code fences.
- Do not place TAB characters inside a field.`;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error ?? "Unknown error");
}

function errorStatus(error: unknown) {
  const status = Number((error as { status?: number })?.status);
  return Number.isFinite(status) ? status : null;
}

function shouldDisableLane(error: unknown) {
  const status = errorStatus(error);
  const message = errorMessage(error).toLowerCase();
  return (
    status === 400 ||
    status === 401 ||
    status === 403 ||
    status === 404 ||
    status === 413 ||
    status === 422 ||
    status === 424 ||
    status === 429 ||
    (status !== null && status >= 500) ||
    message.includes("rate limit") ||
    message.includes("rate_limit") ||
    message.includes("tokens per") ||
    message.includes("requests per") ||
    message.includes("model_not_found") ||
    message.includes("does not exist") ||
    message.includes("do not have access") ||
    message.includes("authentication") ||
    message.includes("unauthorized") ||
    message.includes("temporarily unavailable") ||
    message.includes("capacity") ||
    message.includes("timeout")
  );
}

function validTaggedOutput(content: string) {
  return (
    /^(?:COURSE|GRADE_CATEGORY|GRADE_SCALE|ASSESSMENT|UNIT|TOPIC|DATE|POLICY|SCHEDULE_NOTE|WARNING)\t/m.test(
      content,
    ) && /^CONFIDENCE\t/m.test(content)
  );
}

async function analyzeChunk(model: string, chunk: string) {
  const completion = await getGroqClient().chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content: `${systemPrompt}\n\n${taggedOutputPrompt}`,
      },
      {
        role: "user",
        content: `SYLLABUS CHUNK:\n${chunk}`,
      },
    ],
    max_completion_tokens: 2200,
  });

  const choice = completion.choices[0];
  const content = choice?.message?.content?.trim();
  if (!content) {
    throw Object.assign(new Error("Groq returned an empty syllabus chunk."), {
      status: 422,
    });
  }
  if (choice.finish_reason === "length") {
    throw Object.assign(new Error("Groq truncated a syllabus chunk."), {
      status: 422,
    });
  }
  if (!validTaggedOutput(content)) {
    throw Object.assign(new Error("Groq returned invalid tagged syllabus data."), {
      status: 422,
    });
  }

  return parseTaggedSyllabusChunk(content);
}

export type SyllabusLaneResult = {
  analyses: SyllabusAnalysis[];
  pipelineChunks: SyllabusPipelineChunk[];
  modelsUsed: string[];
  disabledModels: Array<{ model: string; error: string }>;
  unresolvedChunkCount: number;
  laneCount: number;
};

export async function analyzeSyllabusAcrossLanes(
  pageTexts: string[],
): Promise<SyllabusLaneResult> {
  const chunks = buildSyllabusChunks(pageTexts);
  const queue = chunks.map((text, index) => ({ index, text }));
  const analysesByIndex = new Map<number, SyllabusAnalysis>();
  const attemptsByIndex = new Map<number, number>();
  const errorsByIndex = new Map<number, string>();
  const modelsUsed = new Set<string>();
  const disabledModels: Array<{ model: string; error: string }> = [];

  async function worker(model: string) {
    while (queue.length > 0) {
      const job = queue.shift();
      if (!job) return;

      attemptsByIndex.set(job.index, (attemptsByIndex.get(job.index) ?? 0) + 1);

      try {
        const analysis = await analyzeChunk(model, job.text);
        analysesByIndex.set(job.index, analysis);
        errorsByIndex.delete(job.index);
        modelsUsed.add(model);
      } catch (error) {
        const message = errorMessage(error);
        errorsByIndex.set(job.index, message);
        console.warn("Syllabus lane unavailable:", {
          model,
          chunk: job.index,
          status: errorStatus(error),
          error: message,
        });

        // Put this small chunk back once so a healthy lane can claim it. The
        // failing lane exits immediately, preventing repeated full-document
        // retries from burning another model's daily token allowance.
        queue.push(job);
        disabledModels.push({ model, error: message });
        if (shouldDisableLane(error)) return;
        return;
      }
    }
  }

  await Promise.all(SYLLABUS_MODEL_LANES.map((model) => worker(model)));

  const pipelineChunks: SyllabusPipelineChunk[] = chunks.map((text, index) => ({
    index,
    text,
    status: analysesByIndex.has(index) ? "ready" : "pending",
    memory: analysesByIndex.get(index) ?? null,
    attempts: attemptsByIndex.get(index) ?? 0,
    lastError: analysesByIndex.has(index) ? null : errorsByIndex.get(index) ?? null,
  }));

  return {
    analyses: [...analysesByIndex.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, analysis]) => analysis),
    pipelineChunks,
    modelsUsed: [...modelsUsed],
    disabledModels,
    unresolvedChunkCount: pipelineChunks.filter((chunk) => chunk.status !== "ready").length,
    laneCount: SYLLABUS_MODEL_LANES.length,
  };
}
