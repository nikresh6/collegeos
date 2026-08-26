import { NextResponse } from "next/server";
import { getGroqClient } from "../../../lib/ai/groq";
import { extractPdfText } from "../../../lib/pdf";
import { userContext } from "../../../lib/server-auth";
import {
  deriveDeterministicSyllabusFacts,
  isSyllabusPipelineState,
  mergeSyllabusChunkAnalyses,
  parseTaggedSyllabusChunk,
  type SyllabusAnalysis,
  type SyllabusPipelineState,
} from "../../../lib/syllabus-analysis-pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 240;

const WHOLE_DOCUMENT_MODELS = [
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "qwen/qwen3.6-27b",
] as const;

const systemPrompt = `You extract structured facts from a college syllabus.

Use only information explicitly supported by the supplied syllabus. Do not invent course facts, dates, topics, policies, assignments, grade weights, or units.

Preserve explicit topic and lecture titles as written. If the syllabus has an explicit unit, module, section, or block hierarchy, preserve it and use basisType explicit_unit. If there is no explicit hierarchy but an exam clearly defines a range of material, an assessment_block may be used. Otherwise keep explicit topics unassigned.

Extract all explicit course metadata, grading categories and weights, grading scale cutoffs, named assessments, important dates, policies, schedule notes, and scheduled topics. For schedule tables, preserve each class meeting as a separate topic with its date, reading, and assignment when available. Preserve assignment due dates separately when they differ from lecture dates.

Never infer a standard grading scale. If credits are not explicit, use 0. Keep unsupported text fields empty. Return only the tagged format requested below.`;

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
- Use UNASSIGNED only when a topic is explicit but no unit is supported.
- Every explicitly weighted grading component must produce a GRADE_CATEGORY line.
- Every dated assessment or due item must produce an ASSESSMENT line and a DATE line.
- For a weekly schedule table, emit one TOPIC for every non-empty class content cell using that cell's exact date.
- Do not combine several class meetings into one TOPIC.
- Emit each alternative final-exam date as its own DATE line.
- Do not output JSON, markdown, headings, commentary, or code fences.
- Do not place TAB characters inside a field.`;

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : String(error ?? "Unknown error");
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
    status === 422 ||
    status === 424 ||
    status === 429 ||
    (status !== null && status >= 500) ||
    message.includes("rate limit") ||
    message.includes("temporarily unavailable") ||
    message.includes("capacity") ||
    message.includes("timeout") ||
    message.includes("model_not_found") ||
    message.includes("does not exist") ||
    message.includes("do not have access") ||
    message.includes("truncated") ||
    message.includes("tagged data")
  );
}

function countVisibleScheduleDates(text: string) {
  const patterns = [
    /\b\d{1,2}-(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\b/gi,
    /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}\b/gi,
    /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g,
  ];
  const values = patterns.flatMap((pattern) => text.match(pattern) ?? []);
  return new Set(values.map((value) => value.toLowerCase())).size;
}

function topicCount(analysis: SyllabusAnalysis) {
  return (
    analysis.unassignedTopics.length +
    analysis.units.reduce((sum, unit) => sum + unit.topics.length, 0)
  );
}

function analysisScore(analysis: SyllabusAnalysis) {
  return (
    topicCount(analysis) * 4 +
    analysis.importantDates.length * 3 +
    analysis.assessments.length * 3 +
    analysis.gradingCategories.length * 3 +
    analysis.gradingScale.length * 2 +
    analysis.policies.length
  );
}

async function analyzeWholeSyllabus(text: string) {
  const visibleScheduleDates = countVisibleScheduleDates(text);
  let best: { analysis: SyllabusAnalysis; model: string; score: number } | null =
    null;
  let lastError: unknown = null;

  for (const model of WHOLE_DOCUMENT_MODELS) {
    try {
      console.log("Whole syllabus analysis starting:", {
        model,
        characters: text.length,
      });

      const completion = await getGroqClient().chat.completions.create({
        model,
        messages: [
          {
            role: "system",
            content: `${systemPrompt}\n\n${taggedOutputPrompt}`,
          },
          {
            role: "user",
            content: `FULL SYLLABUS:\n${text}`,
          },
        ],
        temperature: model.startsWith("qwen/") ? 0.2 : 0.05,
        max_completion_tokens: 6500,
      });

      const choice = completion.choices[0];
      const content = choice?.message?.content?.trim();
      if (!content) {
        throw Object.assign(new Error("Groq returned an empty syllabus response."), {
          status: 422,
        });
      }

      if (choice.finish_reason === "length") {
        throw Object.assign(
          new Error("The syllabus response was truncated before completion."),
          { status: 422 },
        );
      }

      if (
        !/^(?:COURSE|GRADE_CATEGORY|GRADE_SCALE|ASSESSMENT|UNIT|TOPIC|DATE|POLICY|SCHEDULE_NOTE|WARNING)\t/m.test(
          content,
        ) ||
        !/^CONFIDENCE\t/m.test(content)
      ) {
        throw Object.assign(
          new Error("The syllabus response did not contain usable tagged data."),
          { status: 422 },
        );
      }

      const analysis = parseTaggedSyllabusChunk(content);
      const score = analysisScore(analysis);
      if (!best || score > best.score) {
        best = { analysis, model, score };
      }

      const topics = topicCount(analysis);
      const scheduleLooksComplete =
        visibleScheduleDates < 6 || topics >= Math.max(4, Math.floor(visibleScheduleDates * 0.45));

      console.log("Whole syllabus analysis finished:", {
        model,
        topics,
        importantDates: analysis.importantDates.length,
        assessments: analysis.assessments.length,
        gradingCategories: analysis.gradingCategories.length,
        score,
        scheduleLooksComplete,
      });

      if (scheduleLooksComplete) {
        return { analysis, model };
      }
    } catch (error) {
      lastError = error;
      console.warn("Whole syllabus model failed:", {
        model,
        status: errorStatus(error),
        error: errorMessage(error),
      });
      if (!isRetryableModelError(error)) throw error;
    }
  }

  if (best) {
    best.analysis.warnings = [
      ...best.analysis.warnings,
      "The syllabus was extracted, but some schedule rows may need review.",
    ];
    return { analysis: best.analysis, model: best.model };
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Groq could not analyze the syllabus.");
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

    if (courseFileId) {
      const { data: existingRows, error: existingError } =
        await context.supabase
          .from("syllabus_analyses")
          .select("id, raw_analysis")
          .eq("course_id", courseId)
          .eq("course_file_id", courseFileId)
          .eq("user_id", context.user.id)
          .eq("status", "draft")
          .order("created_at", { ascending: false })
          .limit(5);
      if (existingError) throw existingError;

      const completed = existingRows?.find(
        (row) =>
          isSyllabusPipelineState(row.raw_analysis) &&
          row.raw_analysis.status === "complete" &&
          row.raw_analysis.result,
      );
      if (
        completed &&
        isSyllabusPipelineState(completed.raw_analysis) &&
        completed.raw_analysis.result
      ) {
        return NextResponse.json({
          ok: true,
          status: "complete",
          requestId,
          analysisId: completed.id,
          provider: "groq",
          model: "saved",
          analysis: completed.raw_analysis.result,
        });
      }

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

    if (!candidate) {
      return NextResponse.json(
        { ok: false, requestId, error: "A syllabus PDF is required." },
        { status: 400 },
      );
    }

    if (
      candidate.type !== "application/pdf" &&
      !candidate.name.toLowerCase().endsWith(".pdf")
    ) {
      return NextResponse.json(
        { ok: false, requestId, error: "The syllabus must be a PDF." },
        { status: 400 },
      );
    }

    if (candidate.size > 30 * 1024 * 1024) {
      return NextResponse.json(
        {
          ok: false,
          requestId,
          error: "The syllabus PDF is too large. Keep it under 30 MB.",
        },
        { status: 413 },
      );
    }

    const { text, pageCount } = await extractPdfText(candidate);
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

    console.log("Simple syllabus analysis:", {
      fileName: candidate.name,
      pageCount,
      characters: text.length,
      models: WHOLE_DOCUMENT_MODELS,
    });

    const deterministicFacts = deriveDeterministicSyllabusFacts(text);
    const aiResult = await analyzeWholeSyllabus(text);
    const result = mergeSyllabusChunkAnalyses([
      deterministicFacts,
      aiResult.analysis,
    ]);

    const pipeline: SyllabusPipelineState = {
      pipelineVersion: 2,
      status: "complete",
      fileName: candidate.name,
      pageCount,
      chunks: [
        {
          index: 0,
          text,
          status: "ready",
          memory: aiResult.analysis,
          attempts: 1,
          lastError: null,
        },
      ],
      deterministicFacts,
      result,
    };

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
        edited_analysis: result,
        status: "draft",
        confidence: result.overallConfidence,
      })
      .select("id")
      .single();
    if (insertError) throw insertError;

    console.log("Simple syllabus analysis complete:", {
      analysisId: inserted.id,
      model: aiResult.model,
      topics: topicCount(result),
      importantDates: result.importantDates.length,
      assessments: result.assessments.length,
      gradingCategories: result.gradingCategories.length,
    });

    return NextResponse.json({
      ok: true,
      status: "complete",
      requestId,
      analysisId: inserted.id,
      provider: "groq",
      model: aiResult.model,
      modelLanes: 1,
      analysis: result,
    });
  } catch (error) {
    console.error("Groq syllabus analysis failed:", error);

    const message =
      error instanceof Error
        ? error.message
        : "Groq could not analyze the syllabus.";

    if (isGroqRateLimitError(message)) {
      return NextResponse.json(
        {
          ok: false,
          requestId,
          code: "GROQ_RATE_LIMITED",
          retryable: true,
          retryAfterMs: 1500,
          error:
            "The available Groq models are temporarily rate limited. Please retry shortly.",
        },
        { status: 429, headers: { "Retry-After": "2" } },
      );
    }

    if (isGroqAuthError(message)) {
      return NextResponse.json(
        {
          ok: false,
          requestId,
          code: "GROQ_AUTH_FAILED",
          retryable: false,
          error:
            "Groq authentication failed. Check GROQ_API_KEY in the deployed server environment.",
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
        retryAfterMs: 1500,
        error: message,
      },
      { status: 500 },
    );
  }
}
