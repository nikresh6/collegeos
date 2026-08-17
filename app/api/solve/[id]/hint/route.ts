import { NextResponse } from "next/server";
import {
  userContext,
} from "../../../../../lib/server-auth";
import {
  createAdminClient,
  loadOwnedSolveSession,
  loadPrivateSolvePlan,
  publicSolveState,
} from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: {
    params: Promise<{ id: string }>;
  },
) {
  const auth = await userContext(request);

  if (!auth) {
    return NextResponse.json(
      {
        ok: false,
        error: "You are not signed in.",
      },
      { status: 401 },
    );
  }

  try {
    const { id } = await context.params;
    const sessionId = id?.trim();
    const body = (await request.json()) as {
      expectedStep?: unknown;
    };
    const requestedStep = Number(body.expectedStep);

    if (!sessionId) {
      return NextResponse.json(
        {
          ok: false,
          error: "A solve session id is required.",
        },
        { status: 400 },
      );
    }

    const session = await loadOwnedSolveSession({
      supabase: auth.supabase,
      userId: auth.user.id,
      sessionId,
    });

    if (!session) {
      return NextResponse.json(
        {
          ok: false,
          error: "That guided solve session was not found.",
        },
        { status: 404 },
      );
    }

    const { plan, verification } =
      await loadPrivateSolvePlan({
        sessionId,
        userId: auth.user.id,
      });

    if (
      !Number.isInteger(requestedStep) ||
      requestedStep !== verification.currentStep
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "This solve advanced in another tab. Your current step has been refreshed.",
          session: publicSolveState(session, plan, verification),
        },
        { status: 409 },
      );
    }

    if (
      verification.completedAt ||
      verification.currentStep >= plan.steps.length
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: "This guided solution is already complete.",
        },
        { status: 409 },
      );
    }

    const stepIndex = Math.max(
      0,
      Math.min(
        plan.steps.length - 1,
        verification.currentStep,
      ),
    );
    const step = plan.steps[stepIndex];

    if (!step) {
      throw new Error(
        "The current solution step could not be loaded.",
      );
    }

    const admin = createAdminClient();
    const { data: transitionData, error: transitionError } =
      await admin.rpc("commit_solve_hint", {
        p_session_id: sessionId,
        p_user_id: auth.user.id,
        p_expected_step: stepIndex,
        p_hints: step.hints,
      });
    if (transitionError) throw transitionError;

    const transition =
      transitionData && typeof transitionData === "object"
        ? (transitionData as Record<string, unknown>)
        : {};
    const updated = await loadOwnedSolveSession({
      supabase: auth.supabase,
      userId: auth.user.id,
      sessionId,
    });
    if (!updated) {
      throw new Error("The guided solve session could not be reloaded.");
    }
    const { plan: nextPlan, verification: nextVerification } =
      await loadPrivateSolvePlan({
        sessionId,
        userId: auth.user.id,
      });

    if (transition.conflict === true) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "This solve advanced in another tab. Your current step has been refreshed.",
          session: publicSolveState(
            updated,
            nextPlan,
            nextVerification,
          ),
        },
        { status: 409 },
      );
    }

    const hint =
      typeof transition.hint === "string"
        ? transition.hint
        : "Focus on the single operation requested by this step.";
    const hintLevel = Number(transition.hintLevel ?? 1);

    return NextResponse.json({
      ok: true,
      hint,
      hintLevel,
      session: publicSolveState(
        updated,
        nextPlan,
        nextVerification,
      ),
    });
  } catch (error) {
    console.error("Guided solver hint failed:", error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not reveal the next hint.",
      },
      { status: 500 },
    );
  }
}
