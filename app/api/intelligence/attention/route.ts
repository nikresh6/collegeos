import {
  NextResponse,
} from "next/server";
import {
  userContext,
} from "../../../../lib/server-auth";
import {
  buildAttentionSnapshot,
} from "../../../../lib/attention-engine";

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
      error:
        preferenceError,
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

    if (preferenceError) {
      throw preferenceError;
    }

    const timeZone =
      requestedTimeZone ||
      preferences?.timezone ||
      "America/Chicago";

    const snapshot =
      await buildAttentionSnapshot(
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
      snapshot,
    });
  } catch (error) {
    console.error(
      "Attention engine failed:",
      error,
    );

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof
          Error
            ? error.message
            : "Could not load academic attention.",
      },
      {
        status: 500,
      },
    );
  }
}

export async function POST(
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
    const body =
      (await request.json()) as {
        action?:
          | "dismiss"
          | "snooze"
          | "restore";
        key?: string;
        hours?: number;
      };

    const key =
      body.key?.trim() ??
      "";

    if (!key) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "An attention key is required.",
        },
        {
          status: 400,
        },
      );
    }

    if (
      body.action ===
      "restore"
    ) {
      const {
        error,
      } =
        await context.supabase
          .from(
            "attention_dismissals",
          )
          .delete()
          .eq(
            "user_id",
            context.user.id,
          )
          .eq(
            "attention_key",
            key,
          );

      if (error) {
        throw error;
      }

      return NextResponse.json({
        ok: true,
      });
    }

    if (
      body.action !==
        "dismiss" &&
      body.action !==
        "snooze"
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Invalid attention action.",
        },
        {
          status: 400,
        },
      );
    }

    const now =
      new Date();

    const hours =
      Math.max(
        1,
        Math.min(
          168,
          Math.round(
            Number(
              body.hours ??
                24,
            ),
          ),
        ),
      );

    const snoozedUntil =
      body.action ===
      "snooze"
        ? new Date(
            now.getTime() +
              hours *
                60 *
                60 *
                1000,
          ).toISOString()
        : null;

    const {
      error,
    } =
      await context.supabase
        .from(
          "attention_dismissals",
        )
        .upsert(
          {
            user_id:
              context.user.id,
            attention_key:
              key,
            dismissed_at:
              now.toISOString(),
            snoozed_until:
              snoozedUntil,
          },
          {
            onConflict:
              "user_id,attention_key",
          },
        );

    if (error) {
      throw error;
    }

    return NextResponse.json({
      ok: true,
      snoozedUntil,
    });
  } catch (error) {
    console.error(
      "Attention action failed:",
      error,
    );

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof
          Error
            ? error.message
            : "Could not update attention.",
      },
      {
        status: 500,
      },
    );
  }
}