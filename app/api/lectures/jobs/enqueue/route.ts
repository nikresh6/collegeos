import {
  NextResponse,
  after,
} from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

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
        "id, user_id, course_id, course_file_id, transcript_text, notes_depth_percent, processing_state",
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

    if (
      !lecture.transcript_text
        ?.trim()
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "The lecture needs a transcript before AI analysis can start.",
        },
        { status: 409 },
      );
    }

    const requestedDepth =
      Number(
        body.depthPercent ??
          lecture.notes_depth_percent ??
          60,
      );

    const depthPercent =
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
      message:
        "AI analysis is running in the background. You can leave this page or close the tab.",
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