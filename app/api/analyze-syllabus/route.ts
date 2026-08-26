import { NextResponse } from "next/server";
import { extractPdfText } from "../../../lib/pdf";
import { userContext } from "../../../lib/server-auth";
import {
  isSyllabusPipelineState,
  type SyllabusAnalysis,
  type SyllabusPipelineState,
} from "../../../lib/syllabus-analysis-pipeline";
import {
  analyzeSyllabusWithTargetedAI,
  TARGETED_SYLLABUS_MODE,
} from "../../../lib/syllabus-ai-targeted";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 240;

type TargetedPipelineState = SyllabusPipelineState & {
  analysisMode: string;
  taskModels?: Record<string, string>;
};

function topicCount(analysis: SyllabusAnalysis) {
  return (
    analysis.unassignedTopics.length +
    analysis.units.reduce((sum, unit) => sum + unit.topics.length, 0)
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error ?? "Unknown error");
}

function errorStatus(error: unknown) {
  const status = Number((error as { status?: number })?.status);
  return Number.isFinite(status) ? status : null;
}

function blankAnalysis(): SyllabusAnalysis {
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

function isCurrentTargetedPipeline(value: unknown): value is TargetedPipelineState {
  return (
    isSyllabusPipelineState(value) &&
    (value as SyllabusPipelineState & { analysisMode?: string }).analysisMode ===
      TARGETED_SYLLABUS_MODE
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
      .select("id, code, name, professor, credits")
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

      const completed = existingRows?.find((row) => {
        if (!isCurrentTargetedPipeline(row.raw_analysis)) return false;
        return (
          row.raw_analysis.status === "complete" &&
          Boolean(row.raw_analysis.result) &&
          row.raw_analysis.chunks.every((chunk) => chunk.status === "ready")
        );
      });

      if (
        completed &&
        isCurrentTargetedPipeline(completed.raw_analysis) &&
        completed.raw_analysis.result
      ) {
        return NextResponse.json({
          ok: true,
          status: "complete",
          requestId,
          analysisId: completed.id,
          provider: "saved-ai-targeted",
          model: "saved",
          modelLanes: completed.raw_analysis.chunks.length,
          analysis: completed.raw_analysis.result,
        });
      }

      const { data: storedFile, error: storedFileError } = await context.supabase
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
            "This PDF contains too little extractable text. It may be scanned or image-based.",
        },
        { status: 422 },
      );
    }

    console.log("Syllabus analysis starting:", {
      fileName: candidate.name,
      pageCount,
      characters: text.length,
      strategy: TARGETED_SYLLABUS_MODE,
    });

    // The LLMs search the full syllabus independently for four semantic tasks:
    // grading, academic structure, calendar/assessments, and metadata/policies.
    // Code only validates and stores those findings. It does not infer units,
    // manufacture calendar events, or reconstruct a grade scale from regexes.
    const aiResult = await analyzeSyllabusWithTargetedAI(text);
    const result = aiResult.analysis;

    // Existing course metadata is only a UI fallback if the syllabus omits it.
    result.courseInfo.courseCode ||= course.code ?? "";
    result.courseInfo.courseName ||= course.name ?? "";
    result.courseInfo.professor ||= course.professor ?? "";
    if (!result.courseInfo.credits && Number(course.credits) > 0) {
      result.courseInfo.credits = Number(course.credits);
    }

    const pipeline: TargetedPipelineState & {
      taskModels: Record<string, string>;
    } = {
      pipelineVersion: 2,
      analysisMode: TARGETED_SYLLABUS_MODE,
      status: "complete",
      fileName: candidate.name,
      pageCount,
      chunks: aiResult.pipelineChunks,
      deterministicFacts: blankAnalysis(),
      result,
      taskModels: aiResult.taskModels,
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

    console.log("AI-targeted syllabus analysis complete:", {
      analysisId: inserted.id,
      taskModels: aiResult.taskModels,
      topics: topicCount(result),
      units: result.units.length,
      importantDates: result.importantDates.length,
      assessments: result.assessments.length,
      gradingCategories: result.gradingCategories.length,
      gradingScale: result.gradingScale.length,
    });

    return NextResponse.json({
      ok: true,
      status: "complete",
      requestId,
      analysisId: inserted.id,
      provider: "groq-targeted-ai",
      model: aiResult.modelsUsed.join(","),
      taskModels: aiResult.taskModels,
      modelLanes: aiResult.pipelineChunks.length,
      analysis: result,
    });
  } catch (error) {
    console.error("Syllabus analysis failed:", error);
    const message = errorMessage(error);
    const upstreamStatus = errorStatus(error);
    const rateLimited =
      upstreamStatus === 429 || message.toLowerCase().includes("rate limit");

    return NextResponse.json(
      {
        ok: false,
        requestId,
        code: rateLimited
          ? "SYLLABUS_AI_RATE_LIMITED"
          : "SYLLABUS_AI_EXTRACTION_FAILED",
        retryable: true,
        retryAfterMs: rateLimited ? 15000 : 3000,
        error: rateLimited
          ? "The AI models are temporarily rate limited. CollegeOS did not replace the syllabus with algorithmically inferred data. Retry when a model lane is available."
          : message,
      },
      { status: rateLimited ? 429 : 503 },
    );
  }
}
