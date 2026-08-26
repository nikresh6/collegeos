import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { groq } from "../../../../lib/ai/groq";
import { noteContentToPlainText } from "../../../../lib/note-content";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACCURATE_TRANSCRIPTION_MODEL =
  process.env.GROQ_TRANSCRIPTION_MODEL ||
  "whisper-large-v3";

type TranscriptSegment = {
  start?: number;
  end?: number;
  text?: string;
};

function createUserClient(accessToken: string) {
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
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";

  return authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
}

function isRateLimitError(error: unknown) {
  const candidate = error as {
    status?: number;
    message?: string;
  };

  const message =
    candidate?.message?.toLowerCase() ?? "";

  return (
    candidate?.status === 429 ||
    message.includes("429") ||
    message.includes("rate limit") ||
    message.includes("rate_limit")
  );
}

function retryAfterSeconds(error: unknown) {
  const candidate = error as {
    headers?:
      | Headers
      | Record<string, string | undefined>;
  };

  const headers = candidate?.headers;
  let raw: string | null | undefined;

  if (
    headers &&
    typeof (headers as Headers).get === "function"
  ) {
    raw = (headers as Headers).get("retry-after");
  } else if (headers) {
    raw =
      (headers as Record<string, string | undefined>)[
        "retry-after"
      ];
  }

  const parsed = Number(raw);

  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(90, Math.ceil(parsed))
    : 15;
}

function compactVocabulary(value: string) {
  return value
    .replace(/\s+/g, " ")
    .trim();
}

export async function POST(request: Request) {
  const accessToken = bearerToken(request);

  if (!accessToken) {
    return NextResponse.json(
      {
        ok: false,
        error: "You are not signed in.",
      },
      { status: 401 },
    );
  }

  const supabase =
    createUserClient(accessToken);

  let lectureId = "";
  let courseFileId: string | null = null;

  try {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError) throw userError;

    if (!user) {
      return NextResponse.json(
        {
          ok: false,
          error: "You are not signed in.",
        },
        { status: 401 },
      );
    }

    const body = (await request.json()) as {
      lectureId?: string;
    };

    lectureId = body.lectureId?.trim() ?? "";

    if (!lectureId) {
      return NextResponse.json(
        {
          ok: false,
          error: "lectureId is required.",
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
        "id, course_id, unit_id, course_file_id, title, storage_path",
      )
      .eq("id", lectureId)
      .single();

    if (lectureError) throw lectureError;

    courseFileId =
      lecture.course_file_id ?? null;

    const [
      { data: course, error: courseError },
      { data: unit, error: unitError },
      { data: topicRows, error: topicsError },
      { data: noteRows, error: notesError },
    ] = await Promise.all([
      supabase
        .from("courses")
        .select("code, name")
        .eq("id", lecture.course_id)
        .single(),
      lecture.unit_id
        ? supabase
            .from("course_units")
            .select("name")
            .eq("id", lecture.unit_id)
            .maybeSingle()
        : Promise.resolve({
            data: null,
            error: null,
          }),
      supabase
        .from("course_topics")
        .select("name")
        .eq("course_id", lecture.course_id)
        .order("position", { ascending: true })
        .limit(18),
      supabase
        .from("notes")
        .select("raw_content")
        .eq("lecture_id", lectureId)
        .order("updated_at", { ascending: false })
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
        10 * 60,
      );

    if (signedError) throw signedError;

    const { error: statusError } =
      await supabase
        .from("lectures")
        .update({
          status: "transcribing",
          analysis_stage: "idle",
          analysis_progress: 0,
          processing_state: {},
          error_message: null,
        })
        .eq("id", lectureId);

    if (statusError) throw statusError;

    if (courseFileId) {
      const { error: fileStatusError } =
        await supabase
          .from("course_files")
          .update({
            processing_status: "processing",
          })
          .eq("id", courseFileId);

      if (fileStatusError) {
        throw fileStatusError;
      }
    }

    const topicVocabulary = compactVocabulary(
      (topicRows ?? [])
        .map((topic) => topic.name)
        .filter(Boolean)
        .join(", "),
    );

    const studentVocabulary = compactVocabulary(
      (noteRows ?? [])
        .map((note) =>
          typeof note.raw_content === "string"
            ? noteContentToPlainText(note.raw_content)
            : "",
        )
        .filter(Boolean)
        .join(" "),
    );

    const contextPrompt = [
      "College lecture transcription with technical academic vocabulary.",
      course?.code || course?.name
        ? `Course: ${[course?.code, course?.name]
            .filter(Boolean)
            .join(" ")}.`
        : "",
      unit?.name ? `Unit: ${unit.name}.` : "",
      topicVocabulary
        ? `Likely technical terms: ${topicVocabulary}.`
        : "",
      studentVocabulary
        ? `Student shorthand and spellings from this lecture: ${studentVocabulary}.`
        : "",
      "Preserve mathematical symbols, variable names, and technical terminology as literally as the audio supports.",
    ]
      .filter(Boolean)
      .join(" ")
      .slice(0, 850);

    const transcription =
      await groq.audio.transcriptions.create({
        url: signed.signedUrl,
        model: ACCURATE_TRANSCRIPTION_MODEL,
        language: "en",
        prompt: contextPrompt || undefined,
        response_format: "verbose_json",
        timestamp_granularities: [
          "segment",
        ],
        temperature: 0,
      } as never);

    const response =
      transcription as unknown as {
        text?: string;
        duration?: number;
        segments?: TranscriptSegment[];
      };

    const transcriptText =
      response.text?.trim() ?? "";

    if (!transcriptText) {
      throw new Error(
        "The transcription completed but returned no text.",
      );
    }

    const segments = (
      response.segments ?? []
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
          segment.text?.trim() ?? "",
      }))
      .filter((segment) => segment.text);

    const [
      { error: deleteSegmentsError },
      { error: deleteChunksError },
    ] = await Promise.all([
      supabase
        .from(
          "lecture_transcript_segments",
        )
        .delete()
        .eq("lecture_id", lectureId),
      supabase
        .from(
          "lecture_analysis_chunks",
        )
        .delete()
        .eq("lecture_id", lectureId),
    ]);

    if (deleteSegmentsError) {
      throw deleteSegmentsError;
    }
    if (deleteChunksError) {
      throw deleteChunksError;
    }

    if (segments.length > 0) {
      const { error: insertError } =
        await supabase
          .from(
            "lecture_transcript_segments",
          )
          .insert(segments);

      if (insertError) throw insertError;
    }

    const { error: updateError } =
      await supabase
        .from("lectures")
        .update({
          transcript_text: transcriptText,
          duration_seconds:
            response.duration ?? null,
          transcription_model:
            ACCURATE_TRANSCRIPTION_MODEL,
          status: "analyzing",
          analysis_stage:
            "condensing",
          analysis_progress: 5,
          processing_state: {},
          error_message: null,
        })
        .eq("id", lectureId);

    if (updateError) throw updateError;

    return NextResponse.json({
      ok: true,
      status: "ready",
      lectureId,
      model: ACCURATE_TRANSCRIPTION_MODEL,
      segmentCount: segments.length,
      transcriptLength:
        transcriptText.length,
      durationSeconds:
        response.duration ?? null,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Lecture transcription failed.";

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
          code: "GROQ_RATE_LIMITED",
          retryable: true,
          retryAfterSeconds:
            retryAfter,
          message: `Transcription capacity is busy. Your audio is safe and the app will retry automatically in about ${retryAfter} seconds.`,
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
          processing_status: "error",
        })
        .eq("id", courseFileId);
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