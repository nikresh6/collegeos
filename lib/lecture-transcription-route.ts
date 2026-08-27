import { spawn } from "child_process";
import { createReadStream, existsSync } from "fs";
import {
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import ffmpegPath from "ffmpeg-static";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { groq } from "./ai/groq";
import { noteContentToPlainText } from "./note-content";

const ACCURATE_TRANSCRIPTION_MODEL =
  process.env.GROQ_TRANSCRIPTION_MODEL ||
  "whisper-large-v3";

const GROQ_MEDIA_LIMIT_BYTES =
  25 * 1024 * 1024;
const DIRECT_MEDIA_SAFE_BYTES =
  24 * 1024 * 1024;
const CHUNK_SECONDS = 20 * 60;
const SPEECH_BITRATE = "48k";

export type TranscriptSegment = {
  start?: number;
  end?: number;
  text?: string;
};

type TranscriptResponse = {
  text?: string;
  duration?: number;
  segments?: TranscriptSegment[];
};

type StoredSegment = {
  lecture_id: string;
  user_id: string;
  position: number;
  start_seconds: number;
  end_seconds: number;
  text: string;
};

function createUserClient(
  accessToken: string,
) {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env
      .NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Supabase public environment variables are missing.",
    );
  }

  return createClient(url, key, {
    global: {
      headers: {
        Authorization:
          `Bearer ${accessToken}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function bearerToken(request: Request) {
  const authorization =
    request.headers.get("authorization") ??
    "";

  return authorization.startsWith(
    "Bearer ",
  )
    ? authorization.slice(
        "Bearer ".length,
      )
    : "";
}

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : String(error ?? "Unknown error");
}

function errorStatus(error: unknown) {
  const status = Number(
    (error as { status?: number })
      ?.status,
  );
  return Number.isFinite(status)
    ? status
    : null;
}

function isRateLimitError(error: unknown) {
  const message =
    errorMessage(error).toLowerCase();

  return (
    errorStatus(error) === 429 ||
    message.includes("429") ||
    message.includes("rate limit") ||
    message.includes("rate_limit")
  );
}

function isMediaTooLargeError(
  error: unknown,
) {
  const message =
    errorMessage(error).toLowerCase();

  return (
    message.includes(
      "media file too large",
    ) ||
    (
      message.includes("size limit") &&
      message.includes("actual size")
    ) ||
    (
      errorStatus(error) === 400 &&
      message.includes("too large")
    )
  );
}

function retryAfterSeconds(error: unknown) {
  const candidate = error as {
    headers?:
      | Headers
      | Record<
          string,
          string | undefined
        >;
  };

  const headers = candidate?.headers;
  let raw:
    | string
    | null
    | undefined;

  if (
    headers &&
    typeof (headers as Headers).get ===
      "function"
  ) {
    raw = (headers as Headers).get(
      "retry-after",
    );
  } else if (headers) {
    raw =
      (
        headers as Record<
          string,
          string | undefined
        >
      )["retry-after"];
  }

  const parsed = Number(raw);

  return Number.isFinite(parsed) &&
    parsed > 0
    ? Math.min(
        90,
        Math.ceil(parsed),
      )
    : 15;
}

function compactVocabulary(value: string) {
  return value
    .replace(/\s+/g, " ")
    .trim();
}

function resolvedFfmpegPath() {
  const candidates = [
    ffmpegPath,
    path.join(
      process.cwd(),
      "node_modules",
      "ffmpeg-static",
      "ffmpeg",
    ),
  ].filter(
    (candidate): candidate is string =>
      Boolean(candidate),
  );

  const found = candidates.find(
    (candidate) =>
      existsSync(candidate),
  );

  if (!found) {
    throw new Error(
      "The lecture audio converter is unavailable on this deployment.",
    );
  }

  return found;
}

function runFfmpeg(args: string[]) {
  return new Promise<void>(
    (resolve, reject) => {
      const child = spawn(
        resolvedFfmpegPath(),
        args,
        {
          stdio: [
            "ignore",
            "ignore",
            "pipe",
          ],
        },
      );

      let stderr = "";

      child.stderr.on(
        "data",
        (chunk: Buffer) => {
          stderr += chunk.toString();
          if (stderr.length > 5000) {
            stderr = stderr.slice(-5000);
          }
        },
      );

      child.on("error", reject);
      child.on(
        "close",
        (code) => {
          if (code === 0) {
            resolve();
            return;
          }

          reject(
            new Error(
              `Could not prepare the oversized lecture audio for transcription. ffmpeg exited with ${code ?? "unknown"}: ${stderr.trim()}`,
            ),
          );
        },
      );
    },
  );
}

function responseDuration(
  response: TranscriptResponse,
) {
  const declared = Number(
    response.duration,
  );
  if (
    Number.isFinite(declared) &&
    declared > 0
  ) {
    return declared;
  }

  return Math.max(
    0,
    ...(response.segments ?? []).map(
      (segment) =>
        Number(segment.end ?? 0),
    ),
  );
}

async function transcribeOne({
  url,
  filePath,
  prompt,
}: {
  url?: string;
  filePath?: string;
  prompt: string;
}) {
  const source = filePath
    ? {
        file: createReadStream(
          filePath,
        ),
      }
    : {
        url,
      };

  const transcription =
    await groq.audio.transcriptions.create(
      {
        ...source,
        model:
          ACCURATE_TRANSCRIPTION_MODEL,
        language: "en",
        prompt:
          prompt || undefined,
        response_format:
          "verbose_json",
        timestamp_granularities: [
          "segment",
        ],
        temperature: 0,
      } as never,
    );

  return transcription as unknown as TranscriptResponse;
}

async function prepareOversizedChunks({
  signedUrl,
  originalName,
}: {
  signedUrl: string;
  originalName: string;
}) {
  const workDir = await mkdtemp(
    path.join(
      tmpdir(),
      "collegeos-audio-",
    ),
  );

  try {
    const sourceExtension =
      path.extname(originalName) ||
      ".media";
    const inputPath = path.join(
      workDir,
      `source${sourceExtension}`,
    );

    const sourceResponse =
      await fetch(signedUrl, {
        cache: "no-store",
      });

    if (!sourceResponse.ok) {
      throw new Error(
        `Could not download the saved lecture audio for chunking (${sourceResponse.status}).`,
      );
    }

    const sourceBytes = Buffer.from(
      await sourceResponse.arrayBuffer(),
    );

    await writeFile(
      inputPath,
      sourceBytes,
    );

    const outputPattern = path.join(
      workDir,
      "chunk-%03d.mp3",
    );

    await runFfmpeg([
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      inputPath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "libmp3lame",
      "-b:a",
      SPEECH_BITRATE,
      "-f",
      "segment",
      "-segment_time",
      String(CHUNK_SECONDS),
      "-reset_timestamps",
      "1",
      outputPattern,
    ]);

    const chunkFiles = (
      await readdir(workDir)
    )
      .filter((name) =>
        /^chunk-\d+\.mp3$/i.test(
          name,
        ),
      )
      .sort()
      .map((name) =>
        path.join(workDir, name),
      );

    if (chunkFiles.length === 0) {
      throw new Error(
        "The oversized lecture was converted, but no transcription chunks were produced.",
      );
    }

    for (const chunkPath of chunkFiles) {
      const stats = await import(
        "fs/promises"
      ).then((fs) =>
        fs.stat(chunkPath),
      );

      if (
        stats.size >=
        GROQ_MEDIA_LIMIT_BYTES
      ) {
        throw new Error(
          `Prepared lecture chunk is still too large (${stats.size} bytes).`,
        );
      }
    }

    return {
      workDir,
      chunkFiles,
    };
  } catch (error) {
    await rm(workDir, {
      recursive: true,
      force: true,
    }).catch(() => undefined);
    throw error;
  }
}

async function transcribeChunked({
  signedUrl,
  originalName,
  contextPrompt,
}: {
  signedUrl: string;
  originalName: string;
  contextPrompt: string;
}) {
  const prepared =
    await prepareOversizedChunks({
      signedUrl,
      originalName,
    });

  try {
    const responses:
      TranscriptResponse[] = [];
    const allSegments:
      Array<{
        start: number;
        end: number;
        text: string;
      }> = [];
    let offsetSeconds = 0;
    let previousTail = "";

    for (
      let index = 0;
      index <
      prepared.chunkFiles.length;
      index += 1
    ) {
      const continuity =
        previousTail
          ? ` Previous chunk ended with: ${previousTail}`
          : "";
      const chunkPrompt =
        `${contextPrompt}${continuity}`
          .slice(0, 850);

      const response =
        await transcribeOne({
          filePath:
            prepared.chunkFiles[index],
          prompt: chunkPrompt,
        });

      const text =
        response.text?.trim() ??
        "";

      if (!text) {
        throw new Error(
          `Transcription chunk ${index + 1} returned no text.`,
        );
      }

      responses.push(response);

      for (const segment of
        response.segments ?? []) {
        const segmentText =
          segment.text?.trim() ??
          "";
        if (!segmentText) continue;

        allSegments.push({
          start:
            offsetSeconds +
            Number(
              segment.start ?? 0,
            ),
          end:
            offsetSeconds +
            Number(
              segment.end ??
                segment.start ??
                0,
            ),
          text: segmentText,
        });
      }

      offsetSeconds +=
        responseDuration(response);
      previousTail =
        text.slice(-220);
    }

    return {
      text: responses
        .map((response) =>
          response.text?.trim() ??
          "",
        )
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
      duration:
        offsetSeconds || undefined,
      segments: allSegments,
      chunkCount:
        prepared.chunkFiles.length,
    };
  } finally {
    await rm(prepared.workDir, {
      recursive: true,
      force: true,
    }).catch(() => undefined);
  }
}

export async function POST(
  request: Request,
) {
  const accessToken =
    bearerToken(request);

  if (!accessToken) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "You are not signed in.",
      },
      { status: 401 },
    );
  }

  const supabase =
    createUserClient(accessToken);

  let lectureId = "";
  let courseFileId:
    | string
    | null = null;

  try {
    const {
      data: { user },
      error: userError,
    } =
      await supabase.auth.getUser();

    if (userError) throw userError;

    if (!user) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "You are not signed in.",
        },
        { status: 401 },
      );
    }

    const body =
      (await request.json()) as {
        lectureId?: string;
      };

    lectureId =
      body.lectureId?.trim() ??
      "";

    if (!lectureId) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "lectureId is required.",
        },
        { status: 400 },
      );
    }

    const {
      data: lecture,
      error: lectureError,
    } = await supabase
      .from("lectures")
      .select(
        "id, course_id, unit_id, course_file_id, title, storage_path, size_bytes, mime_type, file_name",
      )
      .eq("id", lectureId)
      .single();

    if (lectureError) {
      throw lectureError;
    }

    courseFileId =
      lecture.course_file_id ??
      null;

    const [
      {
        data: course,
        error: courseError,
      },
      {
        data: unit,
        error: unitError,
      },
      {
        data: topicRows,
        error: topicsError,
      },
      {
        data: noteRows,
        error: notesError,
      },
    ] = await Promise.all([
      supabase
        .from("courses")
        .select("code, name")
        .eq(
          "id",
          lecture.course_id,
        )
        .single(),
      lecture.unit_id
        ? supabase
            .from(
              "course_units",
            )
            .select("name")
            .eq(
              "id",
              lecture.unit_id,
            )
            .maybeSingle()
        : Promise.resolve({
            data: null,
            error: null,
          }),
      supabase
        .from("course_topics")
        .select("name")
        .eq(
          "course_id",
          lecture.course_id,
        )
        .order("position", {
          ascending: true,
        })
        .limit(18),
      supabase
        .from("notes")
        .select("raw_content")
        .eq(
          "lecture_id",
          lectureId,
        )
        .order("updated_at", {
          ascending: false,
        })
        .limit(4),
    ]);

    if (courseError) throw courseError;
    if (unitError) throw unitError;
    if (topicsError) throw topicsError;
    if (notesError) throw notesError;

    const {
      data: signed,
      error: signedError,
    } = await supabase.storage
      .from("lecture-audio")
      .createSignedUrl(
        lecture.storage_path,
        30 * 60,
      );

    if (signedError) {
      throw signedError;
    }

    const sourceBytes = Number(
      lecture.size_bytes ?? 0,
    );
    const plannedChunking =
      sourceBytes >
      DIRECT_MEDIA_SAFE_BYTES;

    const {
      error: statusError,
    } = await supabase
      .from("lectures")
      .update({
        status: "transcribing",
        analysis_stage: "idle",
        analysis_progress: 0,
        processing_state: {
          transcription: {
            mode:
              plannedChunking
                ? "preparing_chunks"
                : "direct",
            sourceBytes,
          },
        },
        error_message: null,
      })
      .eq("id", lectureId);

    if (statusError) {
      throw statusError;
    }

    if (courseFileId) {
      const {
        error: fileStatusError,
      } = await supabase
        .from("course_files")
        .update({
          processing_status:
            "processing",
        })
        .eq(
          "id",
          courseFileId,
        );

      if (fileStatusError) {
        throw fileStatusError;
      }
    }

    const topicVocabulary =
      compactVocabulary(
        (topicRows ?? [])
          .map((topic) =>
            topic.name,
          )
          .filter(Boolean)
          .join(", "),
      );

    const studentVocabulary =
      compactVocabulary(
        (noteRows ?? [])
          .map((note) =>
            typeof note.raw_content ===
            "string"
              ? noteContentToPlainText(
                  note.raw_content,
                )
              : "",
          )
          .filter(Boolean)
          .join(" "),
      ).slice(0, 520);

    const contextPrompt = [
      "College lecture transcription with technical academic vocabulary.",
      course?.code ||
      course?.name
        ? `Course: ${[
            course?.code,
            course?.name,
          ]
            .filter(Boolean)
            .join(" ")}.`
        : "",
      unit?.name
        ? `Unit: ${unit.name}.`
        : "",
      topicVocabulary
        ? `Likely technical terms: ${topicVocabulary}.`
        : "",
      studentVocabulary
        ? `Student shorthand and spellings from this lecture: ${studentVocabulary}.`
        : "",
      "Preserve mathematical notation, variable names, and technical terminology as literally as the audio supports.",
    ]
      .filter(Boolean)
      .join(" ")
      .slice(0, 850);

    let transcript:
      TranscriptResponse & {
        chunkCount?: number;
      };
    let chunked = plannedChunking;

    if (plannedChunking) {
      transcript =
        await transcribeChunked({
          signedUrl:
            signed.signedUrl,
          originalName:
            lecture.file_name ||
            "lecture.webm",
          contextPrompt,
        });
    } else {
      try {
        transcript =
          await transcribeOne({
            url: signed.signedUrl,
            prompt: contextPrompt,
          });
      } catch (error) {
        if (!isMediaTooLargeError(error)) {
          throw error;
        }

        chunked = true;
        transcript =
          await transcribeChunked({
            signedUrl:
              signed.signedUrl,
            originalName:
              lecture.file_name ||
              "lecture.webm",
            contextPrompt,
          });
      }
    }

    const transcriptText =
      transcript.text?.trim() ??
      "";

    if (!transcriptText) {
      throw new Error(
        "The transcription completed but returned no text.",
      );
    }

    const segments:
      StoredSegment[] = (
        transcript.segments ?? []
      )
      .map((segment, index) => ({
        lecture_id: lectureId,
        user_id: user.id,
        position: index,
        start_seconds: Number(
          segment.start ?? 0,
        ),
        end_seconds: Number(
          segment.end ??
            segment.start ??
            0,
        ),
        text:
          segment.text?.trim() ??
          "",
      }))
      .filter((segment) =>
        Boolean(segment.text),
      );

    const [
      {
        error:
          deleteSegmentsError,
      },
      {
        error:
          deleteChunksError,
      },
    ] = await Promise.all([
      supabase
        .from(
          "lecture_transcript_segments",
        )
        .delete()
        .eq(
          "lecture_id",
          lectureId,
        ),
      supabase
        .from(
          "lecture_analysis_chunks",
        )
        .delete()
        .eq(
          "lecture_id",
          lectureId,
        ),
    ]);

    if (deleteSegmentsError) {
      throw deleteSegmentsError;
    }
    if (deleteChunksError) {
      throw deleteChunksError;
    }

    if (segments.length > 0) {
      const {
        error: insertError,
      } = await supabase
        .from(
          "lecture_transcript_segments",
        )
        .insert(segments);

      if (insertError) {
        throw insertError;
      }
    }

    const durationSeconds =
      responseDuration(transcript) ||
      null;
    const chunkCount = Number(
      transcript.chunkCount ?? 1,
    );

    const {
      error: updateError,
    } = await supabase
      .from("lectures")
      .update({
        transcript_text:
          transcriptText,
        duration_seconds:
          durationSeconds,
        transcription_model:
          ACCURATE_TRANSCRIPTION_MODEL,
        status: "analyzing",
        analysis_stage:
          "condensing",
        analysis_progress: 5,
        processing_state: {
          transcription: {
            mode:
              chunked
                ? "chunked_16khz_mono_mp3"
                : "direct",
            sourceBytes,
            chunkCount,
            chunkSeconds:
              chunked
                ? CHUNK_SECONDS
                : null,
            bitrate:
              chunked
                ? SPEECH_BITRATE
                : null,
          },
        },
        error_message: null,
      })
      .eq("id", lectureId);

    if (updateError) {
      throw updateError;
    }

    return NextResponse.json({
      ok: true,
      status: "ready",
      lectureId,
      model:
        ACCURATE_TRANSCRIPTION_MODEL,
      chunked,
      chunkCount,
      segmentCount:
        segments.length,
      transcriptLength:
        transcriptText.length,
      durationSeconds,
    });
  } catch (error) {
    const message =
      errorMessage(error) ||
      "Lecture transcription failed.";

    if (isRateLimitError(error)) {
      const retryAfter =
        retryAfterSeconds(error);

      if (lectureId) {
        await supabase
          .from("lectures")
          .update({
            status: "transcribing",
            error_message: null,
          })
          .eq("id", lectureId);
      }

      return NextResponse.json(
        {
          ok: false,
          code:
            "GROQ_RATE_LIMITED",
          retryable: true,
          retryAfterSeconds:
            retryAfter,
          message:
            `Transcription capacity is busy. Your audio is safe and the app will retry automatically in about ${retryAfter} seconds.`,
        },
        {
          status: 429,
          headers: {
            "Retry-After":
              String(retryAfter),
          },
        },
      );
    }

    console.error(
      "Lecture transcription failed:",
      error,
    );

    if (lectureId) {
      await supabase
        .from("lectures")
        .update({
          status: "error",
          analysis_stage: "error",
          error_message: message,
        })
        .eq("id", lectureId);
    }

    if (courseFileId) {
      await supabase
        .from("course_files")
        .update({
          processing_status:
            "error",
        })
        .eq(
          "id",
          courseFileId,
        );
    }

    return NextResponse.json(
      {
        ok: false,
        code:
          "LECTURE_TRANSCRIPTION_FAILED",
        retryable: true,
        error: message,
      },
      { status: 500 },
    );
  }
}
