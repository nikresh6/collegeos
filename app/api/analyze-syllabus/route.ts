import { NextResponse } from "next/server";
import { extractPdfText } from "../../../lib/pdf";
import { userContext } from "../../../lib/server-auth";
import {
  deriveDeterministicSyllabusFacts,
  isSyllabusPipelineState,
  mergeSyllabusChunkAnalyses,
  type SyllabusAnalysis,
  type SyllabusPipelineState,
} from "../../../lib/syllabus-analysis-pipeline";
import { analyzeSyllabusAcrossLanes } from "../../../lib/syllabus-groq-lanes";
import { reconcileSyllabusAnalysis } from "../../../lib/syllabus-reconcile";
import { deriveDeterministicScheduleFacts } from "../../../lib/syllabus-schedule-fallback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 240;

function topicCount(analysis: SyllabusAnalysis) {
  return (
    analysis.unassignedTopics.length +
    analysis.units.reduce((sum, unit) => sum + unit.topics.length, 0)
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error ?? "Unknown error");
}

function appendWarning(analysis: SyllabusAnalysis, warning: string) {
  const normalized = warning.toLowerCase();
  if (!analysis.warnings.some((item) => item.toLowerCase() === normalized)) {
    analysis.warnings.push(warning);
  }
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
        if (!isSyllabusPipelineState(row.raw_analysis)) return false;
        return (
          row.raw_analysis.status === "complete" &&
          Boolean(row.raw_analysis.result) &&
          row.raw_analysis.chunks.every((chunk) => chunk.status === "ready")
        );
      });

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
          provider: "saved",
          model: "saved",
          modelLanes: 0,
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

    console.log("Syllabus analysis starting:", {
      fileName: candidate.name,
      pageCount,
      characters: text.length,
      strategy: "deterministic-plus-five-lane-chunks",
    });

    const deterministicFacts = deriveDeterministicSyllabusFacts(text);
    const scheduleFacts = deriveDeterministicScheduleFacts(text);
    const deterministicCombined = mergeSyllabusChunkAnalyses([
      deterministicFacts,
      scheduleFacts,
    ]);

    // Groq is enrichment, not a hard dependency. Each model receives only a
    // small page-sized chunk. A rate-limited model exits its lane and healthy
    // lanes claim the remaining chunks. If all lanes are unavailable, the
    // deterministic extraction below still produces a reviewable course.
    const laneResult = await analyzeSyllabusAcrossLanes(pageTexts);

    const merged = mergeSyllabusChunkAnalyses([
      deterministicCombined,
      ...laneResult.analyses,
    ]);
    const result = reconcileSyllabusAnalysis({
      analysis: merged,
      deterministicFacts: deterministicCombined,
      sourceText: text,
    });

    result.courseInfo.courseCode ||= course.code ?? "";
    result.courseInfo.courseName ||= course.name ?? "";
    result.courseInfo.professor ||= course.professor ?? "";
    if (!result.courseInfo.credits && Number(course.credits) > 0) {
      result.courseInfo.credits = Number(course.credits);
    }

    if (laneResult.unresolvedChunkCount > 0) {
      appendWarning(
        result,
        `${laneResult.unresolvedChunkCount} syllabus chunk(s) could not be AI-enriched because the available Groq lanes were exhausted or unavailable. Explicit grading, dates, and schedule rows were still extracted deterministically. Re-analyze later to enrich any missing details.`,
      );
      if (result.overallConfidence > 82) result.overallConfidence = 82;
    }

    if (laneResult.modelsUsed.length === 0) {
      appendWarning(
        result,
        "Groq enrichment was unavailable for this run. CollegeOS completed the syllabus foundation from deterministic PDF extraction instead of failing the upload.",
      );
    }

    const pipeline: SyllabusPipelineState = {
      pipelineVersion: 2,
      status: "complete",
      fileName: candidate.name,
      pageCount,
      chunks: laneResult.pipelineChunks,
      deterministicFacts: deterministicCombined,
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

    console.log("Syllabus analysis complete:", {
      analysisId: inserted.id,
      modelsUsed: laneResult.modelsUsed,
      disabledModels: laneResult.disabledModels.map((item) => item.model),
      unresolvedChunks: laneResult.unresolvedChunkCount,
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
      provider:
        laneResult.modelsUsed.length > 0 ? "groq+deterministic" : "deterministic",
      model:
        laneResult.modelsUsed.length > 0
          ? laneResult.modelsUsed.join(",")
          : "deterministic-only",
      modelLanes: laneResult.laneCount,
      unresolvedChunks: laneResult.unresolvedChunkCount,
      analysis: result,
    });
  } catch (error) {
    console.error("Syllabus analysis failed:", error);
    const message = errorMessage(error);

    return NextResponse.json(
      {
        ok: false,
        requestId,
        code: "SYLLABUS_ANALYSIS_FAILED",
        retryable: true,
        retryAfterMs: 2000,
        error: message,
      },
      { status: 500 },
    );
  }
}
