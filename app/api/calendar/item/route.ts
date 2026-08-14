import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  rebuildPlannerLearningProfile,
} from "../../../../lib/planner-learning-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ITEM_TYPES = new Set([
  "personal", "assignment", "exam", "quiz", "meeting", "club",
  "work", "social", "study", "focus", "travel", "other",
]);

const FLEXIBILITY = new Set(["rigid", "flexible"]);
const STATUSES = new Set([
  "scheduled",
  "completed",
  "cancelled",
]);

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
}

function createUserClient(accessToken: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    throw new Error("Supabase public environment variables are missing.");
  }

  return createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function getUserContext(request: Request) {
  const token = bearerToken(request);
  if (!token) {
    return { error: NextResponse.json({ ok: false, error: "You are not signed in." }, { status: 401 }) } as const;
  }

  const supabase = createUserClient(token);
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    return { error: NextResponse.json({ ok: false, error: "You are not signed in." }, { status: 401 }) } as const;
  }

  return { supabase, user } as const;
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(new Date(value).getTime());
}

function normalizeColor(value: unknown) {
  if (value === null || value === "" || value === undefined) return null;
  return typeof value === "string" ? value.slice(0, 32) : null;
}

function normalizeTopicIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").slice(0, 100);
}

async function refreshLearning(
  supabase: ReturnType<typeof createUserClient>,
  userId: string,
) {
  try {
    const { data: preferences } = await supabase
      .from("calendar_preferences")
      .select("timezone")
      .eq("user_id", userId)
      .maybeSingle();

    await rebuildPlannerLearningProfile({
      supabase,
      userId,
      timeZone:
        preferences?.timezone ??
        "America/Chicago",
    });
  } catch (error) {
    console.warn(
      "Planner learning refresh failed:",
      error,
    );
  }
}

async function logStudyBehavior({
  supabase,
  userId,
  courseId,
  calendarItemId,
  eventType,
  topicIds,
  originalStartsAt,
  originalEndsAt,
  resultingStartsAt,
  resultingEndsAt,
  metadata = {},
}: {
  supabase: ReturnType<typeof createUserClient>;
  userId: string;
  courseId: string | null;
  calendarItemId: string;
  eventType:
    | "planned"
    | "moved"
    | "resized"
    | "completed"
    | "skipped"
    | "deleted";
  topicIds: string[];
  originalStartsAt: string | null;
  originalEndsAt: string | null;
  resultingStartsAt: string | null;
  resultingEndsAt: string | null;
  metadata?: Record<string, unknown>;
}) {
  const { error } = await supabase
    .from("study_behavior_events")
    .insert({
      user_id: userId,
      course_id: courseId,
      calendar_item_id: calendarItemId,
      event_type: eventType,
      topic_ids: topicIds,
      original_starts_at: originalStartsAt,
      original_ends_at: originalEndsAt,
      resulting_starts_at: resultingStartsAt,
      resulting_ends_at: resultingEndsAt,
      metadata,
    });

  if (error) {
    console.warn(
      "Study behavior logging failed:",
      error,
    );
    return;
  }

  await refreshLearning(
    supabase,
    userId,
  );
}

const ITEM_SELECT = "id, user_id, course_id, unit_id, title, item_type, starts_at, ends_at, all_day, location, notes, flexibility, status, source, topic_ids, color_override, planner_locked, user_modified_at";

export async function POST(request: Request) {
  const context = await getUserContext(request);
  if ("error" in context) return context.error;

  try {
    const body = await request.json() as Record<string, unknown>;
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const itemType = typeof body.itemType === "string" ? body.itemType : "personal";
    const flexibility = typeof body.flexibility === "string" ? body.flexibility : "rigid";

    if (!title) {
      return NextResponse.json({ ok: false, error: "A title is required." }, { status: 400 });
    }
    if (!ITEM_TYPES.has(itemType)) {
      return NextResponse.json({ ok: false, error: "Invalid event type." }, { status: 400 });
    }
    if (!FLEXIBILITY.has(flexibility)) {
      return NextResponse.json({ ok: false, error: "Invalid flexibility value." }, { status: 400 });
    }
    if (!validDate(body.startsAt) || !validDate(body.endsAt)) {
      return NextResponse.json({ ok: false, error: "Valid start and end times are required." }, { status: 400 });
    }
    if (new Date(body.endsAt).getTime() <= new Date(body.startsAt).getTime()) {
      return NextResponse.json({ ok: false, error: "End time must be after start time." }, { status: 400 });
    }

    const { data, error } = await context.supabase
      .from("calendar_items")
      .insert({
        user_id: context.user.id,
        course_id: typeof body.courseId === "string" && body.courseId ? body.courseId : null,
        title,
        item_type: itemType,
        starts_at: body.startsAt,
        ends_at: body.endsAt,
        all_day: Boolean(body.allDay),
        location: typeof body.location === "string" && body.location.trim() ? body.location.trim() : null,
        notes: typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null,
        flexibility,
        status: "scheduled",
        source: "manual",
        topic_ids: normalizeTopicIds(body.topicIds),
        color_override: normalizeColor(body.color),
        planner_locked: Boolean(body.plannerLocked),
      })
      .select(ITEM_SELECT)
      .single();

    if (error) throw error;

    if (data.item_type === "study") {
      await logStudyBehavior({
        supabase: context.supabase,
        userId: context.user.id,
        courseId: data.course_id ?? null,
        calendarItemId: data.id,
        eventType: "planned",
        topicIds: normalizeTopicIds(data.topic_ids),
        originalStartsAt: null,
        originalEndsAt: null,
        resultingStartsAt: data.starts_at,
        resultingEndsAt: data.ends_at,
        metadata: {
          origin: "calendar_manual",
          source: data.source,
        },
      });
    }

    return NextResponse.json({ ok: true, item: data });
  } catch (error) {
    console.error("Calendar item creation failed:", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not create event." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const context = await getUserContext(request);
  if ("error" in context) return context.error;

  try {
    const body = await request.json() as Record<string, unknown>;
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) {
      return NextResponse.json({ ok: false, error: "An event id is required." }, { status: 400 });
    }

    const { data: existing, error: existingError } = await context.supabase
      .from("calendar_items")
      .select("id, course_id, item_type, starts_at, ends_at, source, status, topic_ids")
      .eq("id", id)
      .eq("user_id", context.user.id)
      .single();

    if (existingError || !existing) {
      return NextResponse.json({ ok: false, error: "Event not found." }, { status: 404 });
    }

    const patch: Record<string, unknown> = {};

    if ("title" in body) {
      const title = typeof body.title === "string" ? body.title.trim() : "";
      if (!title) return NextResponse.json({ ok: false, error: "A title is required." }, { status: 400 });
      patch.title = title;
    }
    if ("courseId" in body) patch.course_id = typeof body.courseId === "string" && body.courseId ? body.courseId : null;
    if ("itemType" in body) {
      if (typeof body.itemType !== "string" || !ITEM_TYPES.has(body.itemType)) return NextResponse.json({ ok: false, error: "Invalid event type." }, { status: 400 });
      patch.item_type = body.itemType;
    }
    if ("allDay" in body) patch.all_day = Boolean(body.allDay);
    if ("location" in body) patch.location = typeof body.location === "string" && body.location.trim() ? body.location.trim() : null;
    if ("notes" in body) patch.notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null;
    if ("flexibility" in body) {
      if (typeof body.flexibility !== "string" || !FLEXIBILITY.has(body.flexibility)) return NextResponse.json({ ok: false, error: "Invalid flexibility value." }, { status: 400 });
      patch.flexibility = body.flexibility;
    }
    if ("topicIds" in body) patch.topic_ids = normalizeTopicIds(body.topicIds);
    if ("color" in body) patch.color_override = normalizeColor(body.color);
    if ("plannerLocked" in body) patch.planner_locked = Boolean(body.plannerLocked);
    if ("status" in body) {
      if (
        typeof body.status !== "string" ||
        !STATUSES.has(body.status)
      ) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "Invalid event status.",
          },
          { status: 400 },
        );
      }
      patch.status = body.status;
    }

    const nextStart = "startsAt" in body ? body.startsAt : existing.starts_at;
    const nextEnd = "endsAt" in body ? body.endsAt : existing.ends_at;

    if (!validDate(nextStart) || !validDate(nextEnd)) {
      return NextResponse.json({ ok: false, error: "Valid start and end times are required." }, { status: 400 });
    }
    if (new Date(nextEnd).getTime() <= new Date(nextStart).getTime()) {
      return NextResponse.json({ ok: false, error: "End time must be after start time." }, { status: 400 });
    }

    if ("startsAt" in body) patch.starts_at = nextStart;
    if ("endsAt" in body) patch.ends_at = nextEnd;

    const movedOrResized = "startsAt" in body || "endsAt" in body;
    if (existing.source === "ai" && movedOrResized && !("plannerLocked" in body)) {
      patch.planner_locked = true;
    }
    patch.user_modified_at = new Date().toISOString();

    const { data, error } = await context.supabase
      .from("calendar_items")
      .update(patch)
      .eq("id", id)
      .eq("user_id", context.user.id)
      .select(ITEM_SELECT)
      .single();

    if (error) throw error;

    if (
      existing.item_type === "study" ||
      data.item_type === "study"
    ) {
      const startChanged =
        new Date(data.starts_at).getTime() !==
        new Date(existing.starts_at).getTime();

      const originalDuration =
        new Date(existing.ends_at).getTime() -
        new Date(existing.starts_at).getTime();

      const nextDuration =
        new Date(data.ends_at).getTime() -
        new Date(data.starts_at).getTime();

      const durationChanged =
        nextDuration !== originalDuration;

      const statusChanged =
        data.status !== existing.status;

      let eventType:
        | "moved"
        | "resized"
        | "completed"
        | "skipped"
        | null = null;

      if (
        statusChanged &&
        data.status === "completed"
      ) {
        eventType = "completed";
      } else if (
        statusChanged &&
        data.status === "cancelled"
      ) {
        eventType = "skipped";
      } else if (durationChanged) {
        eventType = "resized";
      } else if (startChanged) {
        eventType = "moved";
      }

      if (eventType) {
        await logStudyBehavior({
          supabase: context.supabase,
          userId: context.user.id,
          courseId:
            data.course_id ??
            existing.course_id ??
            null,
          calendarItemId: data.id,
          eventType,
          topicIds: normalizeTopicIds(
            data.topic_ids ??
            existing.topic_ids,
          ),
          originalStartsAt:
            existing.starts_at,
          originalEndsAt:
            existing.ends_at,
          resultingStartsAt:
            data.starts_at,
          resultingEndsAt:
            data.ends_at,
          metadata: {
            source: existing.source,
            statusBefore:
              existing.status,
            statusAfter:
              data.status,
            userModified: true,
          },
        });
      }
    }

    return NextResponse.json({ ok: true, item: data });
  } catch (error) {
    console.error("Calendar item update failed:", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not update event." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const context = await getUserContext(request);
  if ("error" in context) return context.error;

  try {
    const body = await request.json() as Record<string, unknown>;
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return NextResponse.json({ ok: false, error: "An event id is required." }, { status: 400 });

    const {
      data: existing,
      error: readError,
    } = await context.supabase
      .from("calendar_items")
      .select(
        "id, course_id, item_type, starts_at, ends_at, source, status, topic_ids",
      )
      .eq("id", id)
      .eq("user_id", context.user.id)
      .single();

    if (readError || !existing) {
      return NextResponse.json(
        {
          ok: false,
          error: "Event not found.",
        },
        { status: 404 },
      );
    }

    if (existing.item_type === "study") {
      await logStudyBehavior({
        supabase: context.supabase,
        userId: context.user.id,
        courseId:
          existing.course_id ?? null,
        calendarItemId: existing.id,
        eventType: "deleted",
        topicIds: normalizeTopicIds(
          existing.topic_ids,
        ),
        originalStartsAt:
          existing.starts_at,
        originalEndsAt:
          existing.ends_at,
        resultingStartsAt: null,
        resultingEndsAt: null,
        metadata: {
          source: existing.source,
          status: existing.status,
        },
      });
    }

    const { error } = await context.supabase
      .from("calendar_items")
      .delete()
      .eq("id", id)
      .eq("user_id", context.user.id);

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Calendar item deletion failed:", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not delete event." }, { status: 500 });
  }
}