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
      confirm?: unknown;
    };

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

    const admin = createAdminClient();
    const { data: transitionData, error: transitionError } =
      await admin.rpc("commit_solve_reveal", {
        p_session_id: sessionId,
        p_user_id: auth.user.id,
        p_confirm: body.confirm === true,
      });
    if (transitionError) throw transitionError;

    const transition =
      transitionData && typeof transitionData === "object"
        ? (transitionData as Record<string, unknown>)
        : {};
    if (transition.requiresConfirmation === true) {
      return NextResponse.json(
        {
          ok: false,
          requiresConfirmation: true,
          error:
            "Confirm that you want to reveal the answer before finishing the steps.",
        },
        { status: 409 },
      );
    }

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

    return NextResponse.json({
      ok: true,
      revealedEarly: transition.revealedEarly === true,
      session: publicSolveState(
        updated,
        nextPlan,
        nextVerification,
      ),
    });
  } catch (error) {
    console.error("Guided solver reveal failed:", error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not reveal the solution.",
      },
      { status: 500 },
    );
  }
}
