import {
  NextResponse,
} from "next/server";
import {
  userContext,
} from "../../../../lib/server-auth";
import {
  rebuildPlannerLearningProfile,
} from "../../../../lib/planner-learning-server";
import {
  plannerLearningSummary,
} from "../../../../lib/academic-intelligence";

export const runtime =
  "nodejs";
export const dynamic =
  "force-dynamic";

export async function GET(
  request: Request,
) {
  const context =
    await userContext(
      request,
    );

  if (!context) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "You are not signed in.",
      },
      {
        status: 401,
      },
    );
  }

  try {
    const url =
      new URL(
        request.url,
      );

    const requestedTimeZone =
      url.searchParams.get(
        "tz",
      );

    const {
      data: preferences,
      error,
    } =
      await context.supabase
        .from(
          "calendar_preferences",
        )
        .select(
          "timezone",
        )
        .eq(
          "user_id",
          context.user.id,
        )
        .maybeSingle();

    if (error) {
      throw error;
    }

    const timeZone =
      requestedTimeZone ||
      preferences?.timezone ||
      "America/Chicago";

    const profile =
      await rebuildPlannerLearningProfile(
        {
          supabase:
            context.supabase,
          userId:
            context.user.id,
          timeZone,
        },
      );

    return NextResponse.json({
      ok: true,
      profile,
      summary:
        plannerLearningSummary(
          profile,
        ),
    });
  } catch (error) {
    console.error(
      "Planner learning refresh failed:",
      error,
    );

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof
          Error
            ? error.message
            : "Could not update planner learning.",
      },
      {
        status: 500,
      },
    );
  }
}