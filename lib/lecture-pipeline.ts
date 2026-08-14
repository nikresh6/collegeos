"use client";

import { supabase } from "./supabase";
import { uploadLectureAudio } from "./resumable-upload";

export type LecturePipelineStage =
  | "uploading"
  | "transcribing"
  | "analyzing"
  | "ready";

type ProcessingPayload = {
  ok?: boolean;
  status?:
    | "processing"
    | "ready"
    | "cancelled"
    | "queued";
  phase?: string;
  progress?: number;
  message?: string;
  error?: string;
  code?: string;
  retryable?: boolean;
  retryAfterSeconds?: number;
};

export function clampLectureDepth(value: number) {
  return Math.max(
    0,
    Math.min(
      100,
      Math.round(value),
    ),
  );
}

export function lectureDepthLabel(value: number) {
  const depth =
    clampLectureDepth(value);

  if (depth <= 20) return "Quick";
  if (depth <= 40) return "Focused";
  if (depth <= 60) return "Balanced";
  if (depth <= 80) return "Detailed";
  return "Deep";
}

function sanitizeFileName(
  value: string,
) {
  return value
    .trim()
    .replace(
      /[^a-zA-Z0-9._-]/g,
      "_",
    )
    .replace(/_+/g, "_")
    .slice(0, 160);
}

function extensionFromFile(
  file: File,
) {
  const extension =
    file.name
      .split(".")
      .pop()
      ?.trim()
      .toLowerCase();

  if (
    extension &&
    extension !==
      file.name.toLowerCase()
  ) {
    return extension;
  }

  if (
    file.type.includes(
      "mpeg",
    )
  ) {
    return "mp3";
  }

  if (
    file.type.includes(
      "mp4",
    )
  ) {
    return "m4a";
  }

  if (
    file.type.includes(
      "wav",
    )
  ) {
    return "wav";
  }

  if (
    file.type.includes(
      "ogg",
    )
  ) {
    return "ogg";
  }

  return "webm";
}

export class LectureAnalysisCancelledError extends Error {
  constructor(
    message =
      "Lecture analysis cancelled.",
  ) {
    super(message);
    this.name =
      "LectureAnalysisCancelledError";
  }
}

export function isLectureAnalysisCancelledError(
  error: unknown,
) {
  return (
    error instanceof
      LectureAnalysisCancelledError ||
    (
      error instanceof Error &&
      error.name ===
        "AbortError"
    )
  );
}

function throwIfAborted(
  signal?: AbortSignal,
) {
  if (signal?.aborted) {
    throw new LectureAnalysisCancelledError();
  }
}

function sleep(
  milliseconds: number,
  signal?: AbortSignal,
) {
  return new Promise<void>(
    (resolve, reject) => {
      throwIfAborted(signal);

      const timeout =
        window.setTimeout(
          () => {
            cleanup();
            resolve();
          },
          milliseconds,
        );

      const onAbort =
        () => {
          window.clearTimeout(
            timeout,
          );
          cleanup();
          reject(
            new LectureAnalysisCancelledError(),
          );
        };

      const cleanup =
        () => {
          signal?.removeEventListener(
            "abort",
            onAbort,
          );
        };

      signal?.addEventListener(
        "abort",
        onAbort,
        {
          once: true,
        },
      );
    },
  );
}

async function accessToken() {
  const {
    data: { session },
    error:
      sessionError,
  } =
    await supabase.auth.getSession();

  if (sessionError) {
    throw sessionError;
  }

  if (!session) {
    throw new Error(
      "You must be signed in.",
    );
  }

  return session.access_token;
}

async function postOnce(
  path: string,
  body: Record<
    string,
    unknown
  >,
  signal?: AbortSignal,
) {
  const token =
    await accessToken();

  const response =
    await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type":
          "application/json",
        Authorization:
          `Bearer ${token}`,
      },
      body:
        JSON.stringify(body),
      signal,
    });

  let payload:
    ProcessingPayload;

  try {
    payload =
      (await response.json()) as ProcessingPayload;
  } catch {
    payload = {
      ok: false,
      error:
        "The lecture processor returned an unreadable response.",
    };
  }

  return {
    response,
    payload,
  };
}

function retryDelaySeconds(
  response: Response,
  payload:
    ProcessingPayload,
) {
  const fromPayload =
    Number(
      payload.retryAfterSeconds,
    );

  if (
    Number.isFinite(
      fromPayload,
    ) &&
    fromPayload > 0
  ) {
    return Math.min(
      90,
      Math.max(
        2,
        Math.ceil(
          fromPayload,
        ),
      ),
    );
  }

  const fromHeader =
    Number(
      response.headers.get(
        "retry-after",
      ),
    );

  if (
    Number.isFinite(
      fromHeader,
    ) &&
    fromHeader > 0
  ) {
    return Math.min(
      90,
      Math.max(
        2,
        Math.ceil(
          fromHeader,
        ),
      ),
    );
  }

  return 15;
}

function shouldRetry(
  response: Response,
  payload:
    ProcessingPayload,
) {
  if (
    payload.retryable !==
    true
  ) {
    return false;
  }

  return (
    response.status ===
      429 ||
    response.status ===
      502 ||
    response.status ===
      503 ||
    response.status ===
      504 ||
    payload.code ===
      "GROQ_RATE_LIMITED" ||
    payload.code ===
      "GROQ_TEMPORARY_ERROR"
  );
}

async function transcribeUntilReady({
  lectureId,
  onStage,
  signal,
}: {
  lectureId: string;
  onStage?: (
    stage:
      LecturePipelineStage,
    message: string,
  ) => void;
  signal?: AbortSignal;
}) {
  for (
    let attempt = 0;
    attempt < 80;
    attempt += 1
  ) {
    throwIfAborted(
      signal,
    );

    const {
      response,
      payload,
    } = await postOnce(
      "/api/lectures/transcribe",
      {
        lectureId,
      },
      signal,
    );

    if (
      shouldRetry(
        response,
        payload,
      )
    ) {
      const delay =
        retryDelaySeconds(
          response,
          payload,
        );

      onStage?.(
        "transcribing",
        payload.message ||
          `Transcription service is busy. Retrying in about ${delay} seconds.`,
      );

      await sleep(
        delay * 1000,
        signal,
      );

      continue;
    }

    if (
      !response.ok ||
      payload.ok !==
        true
    ) {
      throw new Error(
        payload.message ||
          payload.error ||
          "Lecture transcription failed.",
      );
    }

    return;
  }

  throw new Error(
    "Lecture transcription is taking unusually long. The uploaded audio is still saved.",
  );
}

async function queueLectureAnalysis({
  lectureId,
  depthPercent,
  onStage,
  signal,
}: {
  lectureId: string;
  depthPercent: number;
  onStage?: (
    stage:
      LecturePipelineStage,
    message: string,
  ) => void;
  signal?: AbortSignal;
}) {
  throwIfAborted(
    signal,
  );

  const {
    response,
    payload,
  } = await postOnce(
    "/api/lectures/jobs/enqueue",
    {
      lectureId,
      depthPercent,
    },
    signal,
  );

  if (
    !response.ok ||
    payload.ok !== true
  ) {
    throw new Error(
      payload.message ||
        payload.error ||
        "Could not start background lecture analysis.",
    );
  }

  onStage?.(
    "analyzing",
    payload.message ||
      "AI analysis is running in the background. You can leave this page.",
  );
}

export async function cancelLectureAnalysis({
  lectureId,
  controller,
}: {
  lectureId: string;
  controller?:
    | AbortController
    | null;
}) {
  controller?.abort();

  const {
    data: lecture,
    error:
      lectureReadError,
  } = await supabase
    .from("lectures")
    .select(
      "id, course_file_id, processing_state, processed_at, analysis_progress",
    )
    .eq("id", lectureId)
    .single();

  if (
    lectureReadError
  ) {
    throw new Error(
      lectureReadError.message ||
        "Could not read the lecture before cancelling.",
    );
  }

  const currentState =
    lecture.processing_state &&
    typeof lecture.processing_state ===
      "object" &&
    !Array.isArray(
      lecture.processing_state,
    )
      ? (lecture.processing_state as Record<
          string,
          unknown
        >)
      : {};

  const hadCompletedAnalysis =
    Boolean(
      lecture.processed_at,
    );

  const now =
    new Date().toISOString();

  const {
    error:
      lectureUpdateError,
  } = await supabase
    .from("lectures")
    .update({
      status:
        hadCompletedAnalysis
          ? "ready"
          : "uploaded",
      analysis_stage:
        hadCompletedAnalysis
          ? "ready"
          : "idle",
      analysis_progress:
        hadCompletedAnalysis
          ? 100
          : Number(
              lecture.analysis_progress ??
                0,
            ),
      error_message: null,
      processing_state: {
        ...currentState,
        cancelRequested:
          true,
        cancelledAt: now,
      },
    })
    .eq("id", lectureId);

  if (
    lectureUpdateError
  ) {
    throw new Error(
      lectureUpdateError.message ||
        "Could not mark the lecture analysis as cancelled.",
    );
  }

  const {
    error: jobError,
  } = await supabase
    .from(
      "lecture_analysis_jobs",
    )
    .update({
      status:
        "cancelled",
      stage:
        "cancelled",
      next_run_at: now,
      locked_at: null,
      locked_by: null,
      heartbeat_at: now,
      last_error: null,
    })
    .eq(
      "lecture_id",
      lectureId,
    );

  if (jobError) {
    throw new Error(
      jobError.message ||
        "The lecture stopped, but its background job could not be cancelled.",
    );
  }

  if (
    lecture.course_file_id
  ) {
    const {
      error:
        fileUpdateError,
    } = await supabase
      .from(
        "course_files",
      )
      .update({
        processing_status:
          hadCompletedAnalysis
            ? "ready"
            : "uploaded",
      })
      .eq(
        "id",
        lecture.course_file_id,
      );

    if (
      fileUpdateError
    ) {
      throw new Error(
        fileUpdateError.message ||
          "The lecture was cancelled, but its material status could not be updated.",
      );
    }
  }

  return {
    lectureId,
    cancelled: true,
  };
}

export async function createLectureMaterial({
  file,
  courseId,
  unitId,
  title,
  sourceKind,
  depthPercent,
  durationSeconds,
  noteId,
  onStage,
  onUploadProgress,
  onLectureCreated,
  analysisSignal,
}: {
  file: File;
  courseId: string;
  unitId?:
    | string
    | null;
  title: string;
  sourceKind:
    | "recording"
    | "upload";
  depthPercent: number;
  durationSeconds?:
    | number
    | null;
  noteId?:
    | string
    | null;
  onStage?: (
    stage:
      LecturePipelineStage,
    message: string,
  ) => void;
  onUploadProgress?: (
    percent: number,
  ) => void;
  onLectureCreated?: (
    lectureId: string,
  ) => void;
  analysisSignal?:
    AbortSignal;
}) {
  const {
    data: { session },
    error:
      sessionError,
  } =
    await supabase.auth.getSession();

  if (sessionError) {
    throw sessionError;
  }

  if (!session) {
    throw new Error(
      "You must be signed in.",
    );
  }

  const cleanTitle =
    title.trim();

  if (!cleanTitle) {
    throw new Error(
      "Give the lecture a title.",
    );
  }

  const depth =
    clampLectureDepth(
      depthPercent,
    );

  const extension =
    extensionFromFile(file);

  const displayName =
    `${cleanTitle}.${extension}`;

  const storagePath =
    `${
      session.user.id
    }/${courseId}/${crypto.randomUUID()}-${sanitizeFileName(
      displayName,
    )}`;

  let courseFileId:
    | string
    | null = null;

  let lectureId:
    | string
    | null = null;

  try {
    throwIfAborted(
      analysisSignal,
    );

    onStage?.(
      "uploading",
      "Uploading the lecture safely…",
    );

    await uploadLectureAudio({
      file,
      storagePath,
      onProgress:
        onUploadProgress,
    });

    const {
      data:
        courseFile,
      error:
        courseFileError,
    } = await supabase
      .from(
        "course_files",
      )
      .insert({
        user_id:
          session.user.id,
        course_id:
          courseId,
        unit_id:
          unitId || null,
        file_name:
          displayName,
        storage_path:
          storagePath,
        mime_type:
          file.type ||
          "application/octet-stream",
        size_bytes:
          file.size,
        material_type:
          "lecture_recording",
        processing_status:
          "processing",
      })
      .select("id")
      .single();

    if (
      courseFileError
    ) {
      throw courseFileError;
    }

    courseFileId =
      courseFile.id;

    const {
      data: lecture,
      error:
        lectureError,
    } = await supabase
      .from("lectures")
      .insert({
        user_id:
          session.user.id,
        course_id:
          courseId,
        unit_id:
          unitId || null,
        course_file_id:
          courseFile.id,
        title:
          cleanTitle,
        source_kind:
          sourceKind,
        file_name:
          file.name,
        storage_path:
          storagePath,
        mime_type:
          file.type ||
          "application/octet-stream",
        size_bytes:
          file.size,
        duration_seconds:
          durationSeconds ||
          null,
        notes_depth_percent:
          depth,
        status:
          "uploaded",
        analysis_stage:
          "idle",
        analysis_progress:
          0,
        processing_state:
          {},
      })
      .select("id")
      .single();

    if (lectureError) {
      throw lectureError;
    }

    lectureId =
      lecture.id;

    onLectureCreated?.(
      lectureId,
    );

    if (noteId) {
      const {
        error:
          noteLinkError,
      } = await supabase
        .from("notes")
        .update({
          lecture_id:
            lectureId,
          course_id:
            courseId,
        })
        .eq("id", noteId);

      if (
        noteLinkError
      ) {
        throw new Error(
          `Could not attach your live notes before analysis: ${noteLinkError.message}`,
        );
      }
    }

    onStage?.(
      "transcribing",
      "Creating the timestamped transcript…",
    );

    await transcribeUntilReady({
      lectureId,
      onStage,
      signal:
        analysisSignal,
    });

    await queueLectureAnalysis({
      lectureId,
      depthPercent:
        depth,
      onStage,
      signal:
        analysisSignal,
    });

    return {
      lectureId,
      courseFileId,
      analysisQueued:
        true as const,
    };
  } catch (error) {
    if (
      isLectureAnalysisCancelledError(
        error,
      )
    ) {
      throw new LectureAnalysisCancelledError();
    }

    /*
     * If analysis was already queued, its durable worker owns the rest of the
     * lifecycle. Errors before queueing are still marked here.
     */
    if (lectureId) {
      const {
        data: job,
      } = await supabase
        .from(
          "lecture_analysis_jobs",
        )
        .select("id")
        .eq(
          "lecture_id",
          lectureId,
        )
        .maybeSingle();

      if (!job) {
        await supabase
          .from("lectures")
          .update({
            status:
              "error",
            analysis_stage:
              "error",
            error_message:
              error instanceof
              Error
                ? error.message
                : "Lecture processing failed.",
          })
          .eq(
            "id",
            lectureId,
          );

        if (
          courseFileId
        ) {
          await supabase
            .from(
              "course_files",
            )
            .update({
              processing_status:
                "error",
            })
            .eq(
              "id",
              courseFileId,
            );
        }
      }
    } else {
      await supabase.storage
        .from(
          "lecture-audio",
        )
        .remove([
          storagePath,
        ]);
    }

    throw error;
  }
}

export async function reprocessLectureMaterial({
  lectureId,
  depthPercent,
  onStage,
  analysisSignal,
}: {
  lectureId: string;
  depthPercent: number;
  onStage?: (
    stage: Exclude<
      LecturePipelineStage,
      "uploading"
    >,
    message: string,
  ) => void;
  analysisSignal?:
    AbortSignal;
}) {
  const depth =
    clampLectureDepth(
      depthPercent,
    );

  const {
    data: lecture,
    error,
  } = await supabase
    .from("lectures")
    .select(
      "id, course_file_id, transcript_text",
    )
    .eq("id", lectureId)
    .single();

  if (error) {
    throw error;
  }

  throwIfAborted(
    analysisSignal,
  );

  if (
    !lecture.transcript_text
  ) {
    onStage?.(
      "transcribing",
      "Creating the timestamped transcript…",
    );

    await transcribeUntilReady({
      lectureId,
      onStage,
      signal:
        analysisSignal,
    });
  }

  await queueLectureAnalysis({
    lectureId,
    depthPercent:
      depth,
    onStage,
    signal:
      analysisSignal,
  });

  return {
    lectureId,
    analysisQueued:
      true as const,
  };
}