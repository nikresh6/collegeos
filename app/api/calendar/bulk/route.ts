import { NextResponse } from "next/server";
import { userContext } from "../../../../lib/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ITEM_TYPES = new Set([
  "personal", "assignment", "exam", "quiz", "meeting", "club", "work",
  "social", "study", "focus", "travel", "other",
]);

function records(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}

function dateOnly(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function clock(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export async function POST(request: Request) {
  const context = await userContext(request);
  if (!context) {
    return NextResponse.json({ ok: false, error: "You are not signed in." }, { status: 401 });
  }

  let insertedClassIds: string[] = [];

  try {
    const body = await request.json() as Record<string, unknown>;
    const classDrafts = records(body.classDrafts);
    const eventDrafts = records(body.eventDrafts);
    if (!classDrafts.length && !eventDrafts.length) {
      return NextResponse.json({ ok: false, error: "There is nothing to add." }, { status: 400 });
    }
    if (classDrafts.length + eventDrafts.length > 50) {
      return NextResponse.json({ ok: false, error: "Add no more than 50 calendar items at once." }, { status: 400 });
    }

    const requestedCourseIds = [...new Set([...classDrafts, ...eventDrafts]
      .map((draft) => typeof draft.courseId === "string" ? draft.courseId : "")
      .filter(Boolean))];
    const { data: ownedCourses, error: courseError } = requestedCourseIds.length
      ? await context.supabase.from("courses").select("id").eq("user_id", context.user.id).in("id", requestedCourseIds)
      : { data: [], error: null };
    if (courseError) throw courseError;
    if ((ownedCourses ?? []).length !== requestedCourseIds.length) {
      return NextResponse.json({ ok: false, error: "One or more selected courses were not found." }, { status: 404 });
    }

    const classRows = classDrafts.map((draft, index) => {
      const days = Array.isArray(draft.daysOfWeek)
        ? [...new Set(draft.daysOfWeek.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort()
        : [];
      const title = typeof draft.title === "string" ? draft.title.trim().slice(0, 200) : "";
      if (!title || typeof draft.courseId !== "string" || !draft.courseId || !days.length || !clock(draft.startTime) || !clock(draft.endTime) || draft.endTime <= draft.startTime || !dateOnly(draft.startDate) || !dateOnly(draft.endDate) || draft.endDate < draft.startDate) {
        throw new Error(`Class block ${index + 1} is incomplete.`);
      }
      return {
        user_id: context.user.id,
        course_id: draft.courseId,
        title,
        meeting_type: "class",
        location: typeof draft.location === "string" && draft.location.trim() ? draft.location.trim().slice(0, 300) : null,
        days_of_week: days,
        start_time: draft.startTime,
        end_time: draft.endTime,
        start_date: draft.startDate,
        end_date: draft.endDate,
        week_pattern: "every",
        color_override: typeof draft.color === "string" ? draft.color.slice(0, 32) : null,
        is_active: true,
      };
    });

    const eventRows = eventDrafts.map((draft, index) => {
      const title = typeof draft.title === "string" ? draft.title.trim().slice(0, 200) : "";
      const itemType = typeof draft.itemType === "string" ? draft.itemType : "other";
      const startsAt = typeof draft.startsAt === "string" ? draft.startsAt : "";
      const endsAt = typeof draft.endsAt === "string" ? draft.endsAt : "";
      if (!title || !ITEM_TYPES.has(itemType) || !Number.isFinite(new Date(startsAt).getTime()) || !Number.isFinite(new Date(endsAt).getTime()) || new Date(endsAt) <= new Date(startsAt)) {
        throw new Error(`Calendar item ${index + 1} is incomplete.`);
      }
      return {
        user_id: context.user.id,
        course_id: typeof draft.courseId === "string" && draft.courseId ? draft.courseId : null,
        title,
        item_type: itemType,
        starts_at: startsAt,
        ends_at: endsAt,
        all_day: Boolean(draft.allDay),
        location: typeof draft.location === "string" && draft.location.trim() ? draft.location.trim().slice(0, 300) : null,
        notes: typeof draft.notes === "string" && draft.notes.trim() ? draft.notes.trim().slice(0, 2000) : null,
        flexibility: "rigid",
        status: "scheduled",
        source: "ai",
        topic_ids: [],
        color_override: typeof draft.color === "string" ? draft.color.slice(0, 32) : null,
        planner_locked: false,
      };
    });

    if (classRows.length) {
      const { data, error } = await context.supabase.from("class_schedule_rules").insert(classRows).select("id");
      if (error) throw error;
      insertedClassIds = (data ?? []).map((row) => row.id);
    }

    if (eventRows.length) {
      const { error } = await context.supabase.from("calendar_items").insert(eventRows);
      if (error) throw error;
    }

    return NextResponse.json({ ok: true, createdCount: classRows.length + eventRows.length });
  } catch (error) {
    if (insertedClassIds.length) {
      await context.supabase.from("class_schedule_rules").delete().in("id", insertedClassIds).eq("user_id", context.user.id);
    }
    console.error("Bulk calendar creation failed:", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not add these calendar items." }, { status: 500 });
  }
}
