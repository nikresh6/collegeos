import {
  NextResponse,
  after,
} from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 240;

type AnalysisPayload = {
  ok?: boolean;
  status?:
    | "processing"
    | "ready"
    | "cancelled";
  phase?: string;
  progress?: number;
  message?: string;
  error?: string;
  code?: string;
  retryable?: boolean;
  retryAfterSeconds?: number;
};

function createAdminClient() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL;

  const key =
    process.env.SUPABASE_SECRET_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "SUPABASE_SECRET_KEY is missing from the server environment.",
    );
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function workerSecret() {
  const secret =
    process.env.LECTURE_WORKER_SECRET;

  if (!secret) {
    throw new Error(
      "LECTURE_WORKER_SECRET is missing from the server environment.",
    );
  }

  return secret;
}

function authorized(
  request: Request,
) {
  const supplied =
    request.headers.get(
      "x-lecture-worker-secret",
    );

  const expected =
    process.env.LECTURE_WORKER_SECRET;

  return Boolean(
    supplied &&
      expected &&
      supplied === expected,
  );
}

function sleep(
  milliseconds: number,
) {
  return new Promise<void>(
    (resolve) => {
      setTimeout(
        resolve,
        milliseconds,
      );
    },
  );
}

function normalizedStage(
  value: unknown,
) {
  return value ===
      "organizing" ||
    value ===
      "synthesizing"
    ? value
    : "condensing";
}

function scheduleWorkerAgain({
  request,
  delaySeconds,
}: {
  request: Request;
  delaySeconds: number;
}) {
  const secret =
    workerSecret();

  const workerUrl =
    new URL(
      "/api/lectures/jobs/worker",
      request.url,
    );

  const delay =
    Math.max(
      0,
      Math.min(
        90,
        delaySeconds,
      ),
    );

  /*
   * In development, never HTTP-fetch localhost from the worker. Turbopack can
   * rebuild the dev server while that loopback request is open, producing
   * UND_ERR_SOCKET: other side closed. Keep the durable Supabase queue, but
   * continue its next pass in-process instead.
   *
   * In production, keep the HTTP handoff so each pass gets a fresh serverless
   * execution budget and Supabase Cron can still recover stale jobs.
   */
  if (process.env.NODE_ENV === "development") {
    setTimeout(() => {
      const nextRequest =
        new Request(workerUrl, {
          method: "POST",
          headers: {
            "x-lecture-worker-secret":
              secret,
          },
        });

      void POST(nextRequest).catch(
        (error) => {
          console.error(
            "Lecture worker could not schedule its next local pass:",
            error,
          );
        },
      );
    }, delay * 1000);

    return;
  }

  after(async () => {
    if (delay > 0) {
      await sleep(
        delay * 1000,
      );
    }

    try {
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
       * A failed self-kick does not lose the job. Supabase Cron can recover
       * waiting or stale jobs after deployment.
       */
      console.error(
        "Lecture worker could not schedule its next pass:",
        error,
      );
    }
  });
}

async function updateJob({
  supabase,
  jobId,
  values,
}: {
  supabase: ReturnType<
    typeof createAdminClient
  >;
  jobId: string;
  values: Record<
    string,
    unknown
  >;
}) {
  const {
    error,
  } = await supabase
    .from(
      "lecture_analysis_jobs",
    )
    .update(values)
    .eq("id", jobId);

  if (error) {
    throw error;
  }
}

export async function POST(
  request: Request,
) {
  if (!authorized(request)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Worker authorization failed.",
      },
      { status: 401 },
    );
  }

  const supabase =
    createAdminClient();

  const workerName =
    `worker-${crypto.randomUUID()}`;

  try {
    /*
     * Recover a worker that was killed by a deployment or platform timeout.
     */
    await supabase.rpc(
      "recover_stale_lecture_analysis_jobs",
    );

    const {
      data: claimed,
      error: claimError,
    } = await supabase.rpc(
      "claim_next_lecture_analysis_job",
      {
        worker_name:
          workerName,
      },
    );

    if (claimError) {
      throw claimError;
    }

    const job =
      Array.isArray(claimed)
        ? claimed[0]
        : null;

    if (!job) {
      return NextResponse.json({
        ok: true,
        status: "idle",
        message:
          "No lecture analysis jobs are due.",
      });
    }

    const {
      data: lecture,
      error: lectureError,
    } = await supabase
      .from("lectures")
      .select(
        "id, notes_depth_percent, processing_state",
      )
      .eq(
        "id",
        job.lecture_id,
      )
      .single();

    if (lectureError) {
      await updateJob({
        supabase,
        jobId: job.id,
        values: {
          status: "error",
          stage: "error",
          locked_at: null,
          locked_by: null,
          heartbeat_at:
            new Date().toISOString(),
          last_error:
            lectureError.message,
        },
      });

      scheduleWorkerAgain({
        request,
        delaySeconds: 0,
      });

      return NextResponse.json(
        {
          ok: false,
          status: "error",
          lectureId:
            job.lecture_id,
          error:
            lectureError.message,
        },
        { status: 500 },
      );
    }

    const processingState =
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

    if (
      processingState
        .cancelRequested ===
      true
    ) {
      await updateJob({
        supabase,
        jobId: job.id,
        values: {
          status:
            "cancelled",
          stage:
            "cancelled",
          locked_at: null,
          locked_by: null,
          heartbeat_at:
            new Date().toISOString(),
          last_error: null,
        },
      });

      scheduleWorkerAgain({
        request,
        delaySeconds: 0,
      });

      return NextResponse.json({
        ok: true,
        status: "cancelled",
        lectureId:
          job.lecture_id,
      });
    }

    await updateJob({
      supabase,
      jobId: job.id,
      values: {
        heartbeat_at:
          new Date().toISOString(),
      },
    });

    const analyzeUrl =
      new URL(
        "/api/lectures/analyze",
        request.url,
      );

    const analyzeBody =
      JSON.stringify({
        lectureId:
          job.lecture_id,
        depthPercent:
          Number(
            lecture.notes_depth_percent ??
              60,
          ),
      });

    let response: Response;

    if (
      process.env.NODE_ENV ===
      "development"
    ) {
      /*
       * Avoid a localhost -> localhost HTTP hop in dev. This is the exact hop
       * that was producing UND_ERR_SOCKET when the Next.js dev process closed
       * or rebuilt the socket during a long lecture pass.
       */
      const {
        POST: runAnalyzer,
      } = await import(
        "../../analyze/route"
      );

      response =
        await runAnalyzer(
          new Request(
            analyzeUrl,
            {
              method: "POST",
              headers: {
                "Content-Type":
                  "application/json",
                "x-lecture-worker-secret":
                  workerSecret(),
              },
              body:
                analyzeBody,
            },
          ),
        );
    } else {
      response =
        await fetch(
          analyzeUrl,
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
              "x-lecture-worker-secret":
                workerSecret(),
            },
            body:
              analyzeBody,
            cache:
              "no-store",
          },
        );
    }

    let payload:
      AnalysisPayload;

    try {
      payload =
        (await response.json()) as AnalysisPayload;
    } catch {
      payload = {
        ok: false,
        retryable: true,
        retryAfterSeconds:
          15,
        error:
          "The analyzer returned an unreadable response.",
      };
    }

    const now =
      new Date();

    if (
      payload.status ===
      "cancelled"
    ) {
      await updateJob({
        supabase,
        jobId: job.id,
        values: {
          status:
            "cancelled",
          stage:
            "cancelled",
          locked_at: null,
          locked_by: null,
          heartbeat_at:
            now.toISOString(),
          last_error: null,
          last_result:
            payload,
        },
      });

      scheduleWorkerAgain({
        request,
        delaySeconds: 0,
      });

      return NextResponse.json({
        ok: true,
        status:
          "cancelled",
        lectureId:
          job.lecture_id,
      });
    }

    if (
      response.ok &&
      payload.ok === true &&
      payload.status ===
        "ready"
    ) {
      await updateJob({
        supabase,
        jobId: job.id,
        values: {
          status:
            "completed",
          stage: "ready",
          locked_at: null,
          locked_by: null,
          heartbeat_at:
            now.toISOString(),
          last_error: null,
          last_result:
            payload,
        },
      });

      scheduleWorkerAgain({
        request,
        delaySeconds: 0,
      });

      return NextResponse.json({
        ok: true,
        status: "completed",
        lectureId:
          job.lecture_id,
      });
    }

    const retryable =
      payload.retryable ===
        true ||
      (
        response.ok &&
        payload.ok === true &&
        payload.status ===
          "processing"
      );

    if (retryable) {
      const delaySeconds =
        Math.max(
          1,
          Math.min(
            90,
            Number(
              payload.retryAfterSeconds ??
                2,
            ),
          ),
        );

      const nextRun =
        new Date(
          now.getTime() +
            delaySeconds *
              1000,
        );

      await updateJob({
        supabase,
        jobId: job.id,
        values: {
          status:
            "waiting",
          stage:
            normalizedStage(
              payload.phase,
            ),
          next_run_at:
            nextRun.toISOString(),
          locked_at: null,
          locked_by: null,
          heartbeat_at:
            now.toISOString(),
          last_error:
            response.ok
              ? null
              : payload.error ??
                payload.message ??
                "Temporary analysis error.",
          last_result:
            payload,
        },
      });

      scheduleWorkerAgain({
        request,
        delaySeconds,
      });

      return NextResponse.json({
        ok: true,
        status: "waiting",
        lectureId:
          job.lecture_id,
        retryAfterSeconds:
          delaySeconds,
        phase:
          payload.phase,
        progress:
          payload.progress,
        message:
          payload.message,
      });
    }

    const permanentError =
      payload.error ??
      payload.message ??
      `Lecture analyzer failed with HTTP ${response.status}.`;

    await updateJob({
      supabase,
      jobId: job.id,
      values: {
        status: "error",
        stage: "error",
        locked_at: null,
        locked_by: null,
        heartbeat_at:
          now.toISOString(),
        last_error:
          permanentError,
        last_result:
          payload,
      },
    });

    scheduleWorkerAgain({
      request,
      delaySeconds: 0,
    });

    return NextResponse.json(
      {
        ok: false,
        status: "error",
        lectureId:
          job.lecture_id,
        error:
          permanentError,
      },
      {
        status:
          response.status >=
          400
            ? response.status
            : 500,
      },
    );
  } catch (error) {
    console.error(
      "Lecture analysis worker failed:",
      error,
    );

    /*
     * The claim has a four-minute lease. If this invocation dies before
     * releasing it, recover_stale_lecture_analysis_jobs will make it runnable
     * again.
     */
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Lecture analysis worker failed.",
      },
      { status: 500 },
    );
  }
}