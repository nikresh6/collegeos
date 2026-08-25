import { NextResponse } from "next/server";
import { groq } from "../../../lib/ai/groq";
import { extractPdfText } from "../../../lib/pdf";
import { userContext } from "../../../lib/server-auth";
import {
  buildSyllabusChunks,
  deriveDeterministicSyllabusFacts,
  isSyllabusPipelineState,
  mergeSyllabusChunkAnalyses,
  parseTaggedSyllabusChunk,
  type SyllabusPipelineState,
} from "../../../lib/syllabus-analysis-pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 240;

const systemPrompt = `You are the syllabus extraction engine for a college academic assistant.

Your job is faithful extraction, not interpretation or curriculum design.

STRICT RULES:
1. Use only information explicitly supported by the supplied syllabus text.
2. Never invent a topic, lecture, unit, date, reading, assignment, grade weight, professor, credit count, or policy.
3. Preserve explicit topic and lecture titles as written. Do not decompose one syllabus topic into smaller invented concepts.
4. If the syllabus explicitly defines Units, Modules, Sections, Blocks, or another course hierarchy, preserve that hierarchy and use basisType "explicit_unit".
5. If there is no explicit unit hierarchy, but exams or major assessments explicitly divide course material into ranges, you may create assessment-based study blocks such as "Exam 1 Material". Use basisType "assessment_block" and state the supporting evidence in basis/coverage.
6. If a topic is explicit but its grouping is uncertain, keep it in unassignedTopics. Never drop it merely because the correct unit is unclear.
7. Keep dates in the form used by the syllabus when possible. Do not guess a year.
8. If credits are not explicitly stated, set credits to 0.
9. If a field is not supported, use an empty string, 0, or an empty array as appropriate.
10. overallConfidence is 0-100 and should reflect extraction confidence, not how good the course is.
11. warnings should identify genuine ambiguities or missing information that the student should review.
12. Do not merge distinct explicit topics just because they are similar.
13. Do not duplicate the same explicit topic in both a unit and unassignedTopics.
14. Extract grading categories, the percentage-to-letter-grade scale, assessments, dates, policies, schedule notes, and course metadata when explicitly present.
15. gradingScale is ONLY for an explicitly stated course grading scale such as A = 93-100, A- = 90-92.99, B+ = 87-89.99, etc.
16. Never infer a standard grading scale. Different courses use different cutoffs.
17. For gradingScale, preserve every explicitly listed letter grade or grade label, including plus/minus grades when present.
18. Convert clearly stated percentage thresholds or ranges to minPercent and maxPercent. Examples: "A: 93-100" -> 93 and 100; "A: 93% and above" -> 93 and 100; "F: below 60%" -> 0 and 59.999 when the boundary is explicit.
19. If the syllabus states a letter grade but the numeric boundary is not clear, set minPercent and maxPercent to 0 and explain the wording in notes.
20. If no explicit percentage-to-letter-grade scale is present, return gradingScale as an empty array.
21. Your response must conform exactly to the supplied tagged-line format.
22. Preserve every explicit scheduled topic even when there are many topics.
23. Be concise in notes, descriptions, policies, basis, and coverage fields. Do not repeat the same information in multiple prose fields.
24. For assessment-based units, description may be an empty string when the unit name, assessmentName, basis, and coverage already make the grouping clear.
25. For every dated schedule row, create a topic with the class meeting date, topic/title, reading, and assignment exactly as supported by that row. A calendar table is course evidence even when it has no heading named "Unit".
26. importantDates must include every explicit assignment deadline, exam/quiz date, project milestone, holiday, break, cancellation, and other date that belongs on a student's calendar. If an assignment's due date differs from its lecture/topic date, preserve the due date in importantDates rather than attaching it to the lecture date.
27. assessments should include every explicitly named graded assessment. gradingCategories must preserve every explicit category and weight, and gradingScale must preserve every explicit cutoff.
28. Do not spend output space explaining your reasoning. Return only the structured extraction.`;

const SYLLABUS_MODEL_POOL = [
  "openai/gpt-oss-20b",
  "qwen/qwen3.6-27b",
  "openai/gpt-oss-120b",
] as const;

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

Rules for output:
- Omit unsupported lines rather than inventing values.
- COURSE and CONFIDENCE may appear once. Every other tag may repeat.
- Use UNASSIGNED only when a topic is explicit but no unit is supported.
- Every explicitly weighted grading component must produce a GRADE_CATEGORY line. Do not confuse a grading component with the individual assessments inside it.
- Every dated assessment or due item must produce both an ASSESSMENT line and a DATE line.
- For a weekly M/W/F schedule table, emit one TOPIC for every non-empty Content cell using that column's exact date. Never combine an entire week into one TOPIC.
- For every non-empty Due cell in a schedule table, emit an ASSESSMENT and DATE using that column's exact date.
- A Week may be a UNIT, but its TOPIC rows must remain separate class meetings.
- Emit each alternative final-exam date as its own DATE line.
- Do not output JSON, markdown, headings, commentary, or code fences.
- Do not place TAB characters inside a field.`;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error ?? "Unknown error");
}

function isTransientGroqError(error: unknown) {
  const candidate = error as { status?: number; code?: string; message?: string };
  const status = Number(candidate?.status);
  const message = candidate?.message?.toLowerCase() ?? "";
  const code = candidate?.code?.toLowerCase() ?? "";
  return (
    status === 408 ||
    status === 422 ||
    status === 424 ||
    status === 429 ||
    status >= 500 ||
    code.includes("failed_generation") ||
    message.includes("rate limit") ||
    message.includes("temporarily unavailable") ||
    message.includes("capacity") ||
    message.includes("timeout")
  );
}

function retryAfterMilliseconds(error: unknown) {
  const candidate = error as {
    headers?: Headers | Record<string, string | undefined>;
  };
  const headers = candidate?.headers;
  let raw: string | null | undefined;
  if (headers && typeof (headers as Headers).get === "function") {
    raw = (headers as Headers).get("retry-after");
  } else if (headers) {
    raw = (headers as Record<string, string | undefined>)["retry-after"];
  }
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0
    ? Math.min(90_000, Math.ceil(seconds * 1000))
    : 8_000;
}

async function analyzeSyllabusChunk({
  text,
  index,
  total,
  model,
}: {
  text: string;
  index: number;
  total: number;
  model: string;
}) {
  const reasoningOptions = model.startsWith("qwen/")
    ? { reasoning_format: "hidden" as const, reasoning_effort: "none" as const }
    : { reasoning_format: "hidden" as const, reasoning_effort: "low" as const };

  const completion = await groq.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content: `${systemPrompt}\n\n${taggedOutputPrompt}`,
      },
      {
        role: "user",
        content: `CHUNK ${index + 1} OF ${total}:\n${text}`,
      },
    ],
    ...reasoningOptions,
    temperature: model.startsWith("qwen/") ? 0.4 : 0.05,
    max_completion_tokens: 1800,
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error("Groq returned an empty syllabus chunk response.");

  if (completion.choices[0]?.finish_reason === "length") {
    throw Object.assign(
      new Error("The syllabus chunk response was truncated before completion."),
      { status: 422, code: "SYLLABUS_CHUNK_QUALITY" },
    );
  }

  if (
    !/^(?:COURSE|GRADE_CATEGORY|GRADE_SCALE|ASSESSMENT|UNIT|TOPIC|DATE|POLICY|SCHEDULE_NOTE|WARNING)\t/m.test(content) ||
    !/^CONFIDENCE\t/m.test(content)
  ) {
    throw new Error("The syllabus chunk response did not contain usable tagged data.");
  }

  const analysis = parseTaggedSyllabusChunk(content);
  const scheduleDates = new Set(
    text.match(
      /\b\d{1,2}-(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\b/gi,
    ) ?? [],
  ).size;
  if (scheduleDates >= 8 && /\bContent\b/i.test(text)) {
    const topicCount =
      analysis.units.reduce((sum, unit) => sum + unit.topics.length, 0) +
      analysis.unassignedTopics.length;
    const minimumTopics = Math.max(1, Math.floor(scheduleDates * 0.65));
    if (topicCount < minimumTopics) {
      throw Object.assign(
        new Error(
          `The schedule extraction combined class meetings (${topicCount}/${scheduleDates}); retrying with another model.`,
        ),
        { status: 422, code: "SYLLABUS_CHUNK_QUALITY" },
      );
    }
  }

  return analysis;
}

function isGroqRateLimitError(message: string) {
  const lower = message.toLowerCase();

  return (
    lower.includes("rate limit") ||
    lower.includes("rate_limit") ||
    lower.includes("429") ||
    lower.includes("tokens per") ||
    lower.includes("requests per")
  );
}

function isGroqAuthError(message: string) {
  const lower = message.toLowerCase();

  return (
    lower.includes("api key") ||
    lower.includes("unauthorized") ||
    lower.includes("authentication") ||
    lower.includes("401")
  );
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();

  try {
    const context = await userContext(request);
    if (!context) {
      return NextResponse.json(
        { ok: false, error: "You are not signed in." },
        { status: 401 },
      );
    }

    const contentType = request.headers.get("content-type") ?? "";
    let candidate: File | null = null;
    let courseId = "";
    let courseFileId = "";

    if (contentType.includes("application/json")) {
      const body = (await request.json()) as {
        courseId?: unknown;
        courseFileId?: unknown;
      };
      courseId = typeof body.courseId === "string" ? body.courseId : "";
      courseFileId =
        typeof body.courseFileId === "string" ? body.courseFileId : "";
    } else {
      const formData = await request.formData();
      const uploaded = formData.get("file");
      candidate = uploaded instanceof File ? uploaded : null;
      const rawCourseId = formData.get("courseId");
      courseId = typeof rawCourseId === "string" ? rawCourseId : "";
    }

    if (!courseId) {
      return NextResponse.json(
        { ok: false, error: "A course is required." },
        { status: 400 },
      );
    }

    const { data: course, error: courseError } = await context.supabase
      .from("courses")
      .select("id")
      .eq("id", courseId)
      .eq("user_id", context.user.id)
      .maybeSingle();

    if (courseError) throw courseError;
    if (!course) {
      return NextResponse.json(
        { ok: false, error: "Course not found." },
        { status: 404 },
      );
    }

    let pipeline: SyllabusPipelineState | null = null;
    let analysisId = "";

    if (courseFileId) {
      const { data: existingRows, error: existingError } = await context.supabase
        .from("syllabus_analyses")
        .select("id, raw_analysis")
        .eq("course_id", courseId)
        .eq("course_file_id", courseFileId)
        .eq("user_id", context.user.id)
        .eq("status", "draft")
        .order("created_at", { ascending: false })
        .limit(5);
      if (existingError) throw existingError;

      const existing = existingRows?.find((row) =>
        isSyllabusPipelineState(row.raw_analysis),
      );
      if (existing && isSyllabusPipelineState(existing.raw_analysis)) {
        analysisId = existing.id;
        pipeline = existing.raw_analysis;
      }

      if (pipeline?.status === "complete" && pipeline.result) {
        return NextResponse.json({
          ok: true,
          status: "complete",
          requestId,
          analysisId,
          provider: "groq",
          analysis: pipeline.result,
        });
      }

      if (!pipeline) {
        const { data: storedFile, error: storedFileError } =
          await context.supabase
            .from("course_files")
            .select("id, file_name, storage_path, mime_type, size_bytes")
            .eq("id", courseFileId)
            .eq("course_id", courseId)
            .eq("user_id", context.user.id)
            .eq("material_type", "syllabus")
            .maybeSingle();

        if (storedFileError) throw storedFileError;
        if (!storedFile) {
          return NextResponse.json(
            { ok: false, requestId, error: "Syllabus file not found." },
            { status: 404 },
          );
        }

        const { data: storedBlob, error: downloadError } =
          await context.supabase.storage
            .from("course-files")
            .download(storedFile.storage_path);
        if (downloadError || !storedBlob) {
          throw downloadError ?? new Error("Could not download the stored syllabus.");
        }

        candidate = new File([storedBlob], storedFile.file_name, {
          type: storedFile.mime_type || "application/pdf",
        });
      }
    }

    if (!candidate && !pipeline) {
      return NextResponse.json(
        {
          ok: false,
          requestId,
          error: "A stored syllabus PDF is required.",
        },
        { status: 400 },
      );
    }

    if (
      candidate &&
      candidate.type !== "application/pdf" &&
      !candidate.name.toLowerCase().endsWith(".pdf")
    ) {
      return NextResponse.json(
        { ok: false, requestId, error: "The syllabus must be a PDF." },
        { status: 400 },
      );
    }

    if (candidate && candidate.size > 30 * 1024 * 1024) {
      return NextResponse.json(
        {
          ok: false,
          requestId,
          error: "The syllabus PDF is too large. Keep it under 30 MB.",
        },
        { status: 413 },
      );
    }

    if (!pipeline && candidate) {
      const { text, pageCount, pageTexts } = await extractPdfText(candidate);
      if (text.replace(/\s/g, "").length < 150) {
        return NextResponse.json(
          {
            ok: false,
            code: "PDF_TEXT_NOT_EXTRACTABLE",
            retryable: false,
            requestId,
            error:
              "This PDF contains too little extractable text. It may be scanned or image-based. OCR fallback has not been enabled yet.",
          },
          { status: 422 },
        );
      }

      const chunks = buildSyllabusChunks(pageTexts);
      if (!chunks.length) {
        throw new Error("The syllabus did not contain any readable page groups.");
      }

      pipeline = {
        pipelineVersion: 2,
        status: "processing",
        fileName: candidate.name,
        pageCount,
        chunks: chunks.map((chunkText, index) => ({
          index,
          text: chunkText,
          status: "pending",
          memory: null,
          attempts: 0,
          lastError: null,
        })),
        deterministicFacts: deriveDeterministicSyllabusFacts(text),
        result: null,
      };

      console.log("Syllabus analysis pipeline created:", {
        fileName: candidate.name,
        pageCount,
        extractedCharacters: text.length,
        chunks: chunks.length,
      });

      let supersedeQuery = context.supabase
        .from("syllabus_analyses")
        .update({ status: "superseded" })
        .eq("course_id", courseId)
        .eq("user_id", context.user.id)
        .eq("status", "draft");
      supersedeQuery = courseFileId
        ? supersedeQuery.eq("course_file_id", courseFileId)
        : supersedeQuery.is("course_file_id", null);
      const { error: supersedeError } = await supersedeQuery;
      if (supersedeError) throw supersedeError;

      const { data: inserted, error: insertError } = await context.supabase
        .from("syllabus_analyses")
        .insert({
          user_id: context.user.id,
          course_id: courseId,
          course_file_id: courseFileId || null,
          raw_analysis: pipeline,
          edited_analysis: null,
          status: "draft",
          confidence: 0,
        })
        .select("id")
        .single();
      if (insertError) throw insertError;
      analysisId = inserted.id;
    }

    if (!pipeline || !analysisId) {
      throw new Error("Could not initialize the syllabus analysis pipeline.");
    }

    const pending = pipeline.chunks.filter((chunk) => chunk.status !== "ready");
    const batch = pending.slice(0, SYLLABUS_MODEL_POOL.length);
    let retryAfterMs = 1_500;

    if (batch.length) {
      const results = await Promise.allSettled(
        batch.map((chunk, lane) => {
          const model =
            SYLLABUS_MODEL_POOL[
              (lane + chunk.attempts) % SYLLABUS_MODEL_POOL.length
            ];
          return analyzeSyllabusChunk({
            text: chunk.text,
            index: chunk.index,
            total: pipeline!.chunks.length,
            model,
          });
        }),
      );

      for (let index = 0; index < results.length; index += 1) {
        const chunk = batch[index];
        const result = results[index];
        if (result.status === "fulfilled") {
          chunk.status = "ready";
          chunk.memory = result.value;
          chunk.lastError = null;
          continue;
        }

        chunk.attempts += 1;
        chunk.lastError = errorMessage(result.reason);
        const reasonCode = (result.reason as { code?: string })?.code;
        if (
          (!isTransientGroqError(result.reason) && chunk.attempts >= 3) ||
          (reasonCode === "SYLLABUS_CHUNK_QUALITY" && chunk.attempts >= 6)
        ) {
          throw result.reason;
        }
        retryAfterMs = Math.max(
          retryAfterMs,
          retryAfterMilliseconds(result.reason),
        );
      }
    }

    const completedChunks = pipeline.chunks.filter(
      (chunk) => chunk.status === "ready",
    ).length;
    const complete = completedChunks === pipeline.chunks.length;
    if (complete) {
      pipeline.status = "complete";
      pipeline.result = mergeSyllabusChunkAnalyses(
        [
          pipeline.deterministicFacts,
          ...pipeline.chunks.flatMap((chunk) =>
            chunk.memory ? [chunk.memory] : [],
          ),
        ],
      );
    }

    const { error: persistError } = await context.supabase
      .from("syllabus_analyses")
      .update({
        raw_analysis: pipeline,
        edited_analysis: complete ? pipeline.result : null,
        confidence: pipeline.result?.overallConfidence ?? 0,
      })
      .eq("id", analysisId)
      .eq("course_id", courseId)
      .eq("user_id", context.user.id);
    if (persistError) throw persistError;

    if (!complete || !pipeline.result) {
      return NextResponse.json(
        {
          ok: true,
          status: "processing",
          requestId,
          analysisId,
          completedChunks,
          totalChunks: pipeline.chunks.length,
          progress: Math.round((completedChunks / pipeline.chunks.length) * 100),
          retryAfterMs,
        },
        {
          status: 202,
          headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) },
        },
      );
    }

    return NextResponse.json({
      ok: true,
      status: "complete",
      requestId,
      analysisId,
      provider: "groq",
      analysis: pipeline.result,
    });
  } catch (error) {
    console.error("Groq syllabus analysis failed:", error);

    const message =
      error instanceof Error
        ? error.message
        : "Groq could not analyze the syllabus.";

    const rateLimited = isGroqRateLimitError(message);
    const authFailed = isGroqAuthError(message);

    if (rateLimited) {
      return NextResponse.json(
        {
          ok: false,
          requestId,
          code: "GROQ_RATE_LIMITED",
          retryable: true,
          error:
            "Groq's current usage limit was reached. Try again after the limit resets.",
        },
        { status: 429 },
      );
    }

    if (authFailed) {
      return NextResponse.json(
        {
          ok: false,
          requestId,
          code: "GROQ_AUTH_FAILED",
          retryable: false,
          error:
            "Groq authentication failed. Check GROQ_API_KEY in .env.local and restart the development server.",
        },
        { status: 500 },
      );
    }

    return NextResponse.json(
      {
        ok: false,
        requestId,
        code: "GROQ_ANALYSIS_FAILED",
        retryable: true,
        error: message,
      },
      { status: 500 },
    );
  }
}
