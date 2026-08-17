import { NextResponse } from "next/server";
import {
  userContext,
} from "../../../../lib/server-auth";
import {
  loadOwnedSolveSession,
  loadPrivateSolvePlan,
  publicSolveState,
} from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
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

    const { plan, verification } = await loadPrivateSolvePlan({
      sessionId,
      userId: auth.user.id,
    });

    return NextResponse.json({
      ok: true,
      session: publicSolveState(session, plan, verification),
    });
  } catch (error) {
    console.error("Guided solver load failed:", error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not load that guided solve session.",
      },
      { status: 500 },
    );
  }
}
