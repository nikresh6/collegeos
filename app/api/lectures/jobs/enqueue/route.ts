import {
  NextResponse,
  after,
} from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ACCURATE_TRANSCRIPTION_MODEL =
  process.env.GROQ_TRANSCRIPTION_MODEL ||
  "whisper-large-v3";

function bearerToken(
  request: Request,
) {
  const authorization =
    request.headers.get(
      "authorization",
    ) ?? "";

  return authorization.startsWith(
    "Bearer ",
  )
    ? authorization.slice(
        "Bearer ".length,
      )
    : "";
}

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
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function kickWorker(
  request: Request,
) {
  const secret =
    process.env.LECTURE_WORKER_SECRET;

  if (!secret) {
    throw new Error(
      "LECTURE_WORKER_SECRET is missing from the server environment.",
    );
  }

  const workerUrl =
    new URL(
      "/api/lectures/jobs/worker",
      request.url,
    );

  after(async () => {
    try {
      if (
        process.env.NODE_ENV ===
        "development"
      ) {
        /*
         * Do not fetch localhost from localhost in development. Import the
         * worker route and invoke it in-process so Turbopack cannot tear down
         * the loopback socket mid-job.
         */
        const {
          POST: runWorker,
        } = await import(
          "../worker/route"
        );

        await runWorker(
          new Request(
            workerUrl,
            {
              method: "POST",
              headers: {
                "x-lecture-worker-secret":
                  secret,
              },
            },
          ),
        );

        return;
      }

      await fetch(workerUrl, {
        method: "POST",
        headers: {
          "x-lecture-worker-secret":
            secret,
        },
        cache: "no-store",
      });
    } catch (error) {
      /*
       * The durable queue row remains in Supabase even if this immediate kick
       * fails. The deployment cron can recover and run it later.
       */
      console.error(
        "Could not kick lecture analysis worker:",
        error,
      );
    }
  });
}

async function refreshTranscriptIfNeeded({
  request,
  accessToken,
  lectureId,
  transcriptText,
  transcriptionModel,
}: {
  request: Request;
  accessToken: string;
  lectureId: string;
  transcriptText: string | null;
  transcriptionModel: string | null;
}) {
  const needsAccurateTranscript =
    !transcriptText?.trim() ||
    transcriptionModel !==
      ACCURATE_TRANSCRIPTION_MODEL;

  if (!needsAccurateTranscript) {
    return null;
  }

  const transcribeUrl =
    new URL(
      "/api/lectures/transcribe",
      request.url,
    );

  const transcribeRequest =
    new Request(
      transcribeUrl,
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
          Authorization:
            `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          lectureId,
        }),
      },
    );

  const response =
    process.env.NODE_ENV ===
    "development"
      ? await (
          await import(
            "../../transcribe/route"
          )
        ).POST(
          transcribeRequest,
        )
      : await fetch(
          transcribeRequest,
          {
            cache: "no-store",
          },
        );

  let payload:
    Record<string, unknown> = {};

  try {
    payload =
      (await response.json()) as Record<
        string,
        unknown
      >;
  } catch {
    payload = {};
  }

  if (!response.ok) {
    return NextResponse.json(
      {
        ok: false,
        ...payload,
        error:
          typeof payload.error ===
          "string"
            ? payload.error
            : typeof payload.message ===
                "string"
              ? payload.message
              : "Could not create the high-accuracy lecture transcript.",
      },
      {
        status:
          response.status,
        headers:
          response.headers.get(
            "retry-after",
          )
            ? {
                "Retry-After":
                  response.headers.get(
                    "retry-after",
                  )!,
              }
            : undefined,
      },
    );
  }

  return null;
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

  try {
    const body =
      (await request.json()) as {
        lectureId?: string;
        depthPercent?: number;
      };

    const lectureId =
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

    const supabase =
      createUserClient(
        accessToken,
      );

    const {
      data: { user },
      error: userError,
    } =
      await supabase.auth.getUser();

    if (userError) {
      throw userError;
    }

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

    const {
      data: lecture,
      error: lectureError,
    } = await supabase
      .from("lectures")
      .select(
        "id, user_id, course_id, course_file_id, transcript_text, transcription_model, notes_depth_percent, processing_state",
      )
      .eq("id", lectureId)
      .single();

    if (lectureError) {
      throw lectureError;
    }

    if (
      lecture.user_id !==
      user.id
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "You do not have access to this lecture.",
        },
        { status: 403 },
      );
    }

    const {
      data: noteRows,
      error: notesError,
    } = await supabase
      .from("notes")
      .select("id, raw_content")
      .eq("lecture_id", lectureId)
      .order("updated_at", {
        ascending: false,
      })
      .limit(8);

    if (notesError) {
      throw notesError;
    }

    const hasUserNotes =
      (noteRows ?? []).some(
        (note) =>
          typeof note.raw_content ===
            "string" &&
          note.raw_content
            .replace(/<[^>]*>/g, " ")
            .replace(/&nbsp;/gi, " ")
            .replace(/\s+/g, " ")
            .trim().length > 0,
      );

    const transcriptRefreshResponse =
      await refreshTranscriptIfNeeded({
        request,
        accessToken,
        lectureId,
        transcriptText:
          lecture.transcript_text ??
          null,
        transcriptionModel:
          lecture.transcription_model ??
          null,
      });

    if (transcriptRefreshResponse) {
      return transcriptRefreshResponse;
    }

    const requestedDepth =
      Number(
        body.depthPercent ??
          lecture.notes_depth_percent ??
          60,
      );

    const baseDepthPercent =
      Math.max(
        0,
        Math.min(
          100,
          Number.isFinite(
            requestedDepth,
          )
            ? Math.round(
                requestedDepth,
              )
            : 60,
        ),
      );

    /*
     * A rebuild with student notes is an expansion request, not just a rerun.
     * Give the final synthesis enough room to cover every supported note idea
     * instead of silently returning the same five-section Balanced summary.
     */
    const depthPercent =
      hasUserNotes
        ? Math.max(
            85,
            baseDepthPercent,
          )
        : baseDepthPercent;

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

    const now =
      new Date().toISOString();

    const {
      error:
        lectureUpdateError,
    } = await supabase
      .from("lectures")
      .update({
        notes_depth_percent:
          depthPercent,
        status: "analyzing",
        analysis_stage:
          "condensing",
        error_message: null,
        processing_state: {
          ...currentState,
          cancelRequested:
            false,
          cancelledAt: null,
          backgroundJobQueuedAt:
            now,
          notesDrivenDeepPass:
            hasUserNotes,
        },
      })
      .eq("id", lectureId);

    if (
      lectureUpdateError
    ) {
      throw lectureUpdateError;
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
            "processing",
        })
        .eq(
          "id",
          lecture.course_file_id,
        );

      if (fileUpdateError) {
        throw fileUpdateError;
      }
    }

    const {
      data: job,
      error: jobError,
    } = await supabase
      .from(
        "lecture_analysis_jobs",
      )
      .upsert(
        {
          lecture_id:
            lectureId,
          user_id:
            user.id,
          course_id:
            lecture.course_id,
          status: "queued",
          stage: "queued",
          priority: 0,
          attempts: 0,
          next_run_at:
            now,
          locked_at: null,
          locked_by: null,
          heartbeat_at:
            null,
          last_error: null,
          last_result: {
            depthPercent,
            queuedAt: now,
            notesDrivenDeepPass:
              hasUserNotes,
            transcriptionModel:
              ACCURATE_TRANSCRIPTION_MODEL,
          },
        },
        {
          onConflict:
            "lecture_id",
        },
      )
      .select(
        "id, status, stage",
      )
      .single();

    if (jobError) {
      throw jobError;
    }

    kickWorker(request);

    return NextResponse.json({
      ok: true,
      status: "queued",
      lectureId,
      jobId: job.id,
      depthPercent,
      notesDrivenDeepPass:
        hasUserNotes,
      message:
        hasUserNotes
          ? "Your high-accuracy transcript is ready. AI is rebuilding a deeper lecture analysis around your saved notes in the background."
          : "AI analysis is running in the background. You can leave this page or close the tab.",
    });
  } catch (error) {
    console.error(
      "Could not queue lecture analysis:",
      error,
    );

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not queue lecture analysis.",
      },
      { status: 500 },
    );
  }
}