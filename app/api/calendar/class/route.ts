import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
}

function createUserClient(accessToken: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase public environment variables are missing.");

  return createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function validTime(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value);
}

function normalizeDraft(body: Record<string, unknown>, index: number) {
  const label = `Class ${index + 1}`;
  const courseId = typeof body.courseId === "string" ? body.courseId : "";
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 200) : "";
  const days = Array.isArray(body.daysOfWeek)
    ? [...new Set(body.daysOfWeek.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort()
    : [];
  const weekPattern = typeof body.weekPattern === "string" ? body.weekPattern : "every";

  if (!courseId || !title || days.length === 0) {
    throw new Error(`${label} needs a course, title, and at least one meeting day.`);
  }
  if (!validTime(body.startTime) || !validTime(body.endTime) || body.endTime <= body.startTime) {
    throw new Error(`${label} needs a valid start and end time.`);
  }
  if (!validDate(body.startDate) || !validDate(body.endDate) || body.endDate < body.startDate) {
    throw new Error(`${label} needs a valid semester date range.`);
  }
  if (!["every", "odd", "even"].includes(weekPattern)) {
    throw new Error(`${label} has an invalid week pattern.`);
  }

  return {
    course_id: courseId,
    title,
    meeting_type: "class",
    location:
      typeof body.location === "string" && body.location.trim()
        ? body.location.trim().slice(0, 300)
        : null,
    days_of_week: days,
    start_time: body.startTime,
    end_time: body.endTime,
    start_date: body.startDate,
    end_date: body.endDate,
    week_pattern: weekPattern,
    color_override:
      typeof body.color === "string" && body.color
        ? body.color.slice(0, 32)
        : null,
    is_active: true,
  };
}

export async function POST(request: Request) {
  const token = bearerToken(request);
  if (!token) return NextResponse.json({ ok: false, error: "You are not signed in." }, { status: 401 });

  const supabase = createUserClient(token);

  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ ok: false, error: "You are not signed in." }, { status: 401 });

    const body = await request.json() as Record<string, unknown>;
    const rawDrafts = Array.isArray(body.drafts)
      ? body.drafts.filter(
          (draft): draft is Record<string, unknown> =>
            Boolean(draft) && typeof draft === "object" && !Array.isArray(draft),
        )
      : [body];
    if (!rawDrafts.length || rawDrafts.length > 30) {
      return NextResponse.json(
        { ok: false, error: "Add between 1 and 30 class blocks at a time." },
        { status: 400 },
      );
    }

    let rows: ReturnType<typeof normalizeDraft>[];
    try {
      rows = rawDrafts.map(normalizeDraft);
    } catch (validationError) {
      return NextResponse.json(
        {
          ok: false,
          error:
            validationError instanceof Error
              ? validationError.message
              : "One of the class blocks is invalid.",
        },
        { status: 400 },
      );
    }

    const courseIds = [...new Set(rows.map((row) => row.course_id))];

    const { data: ownedCourses, error: courseError } = await supabase
      .from("courses")
      .select("id")
      .in("id", courseIds)
      .eq("user_id", user.id)
      .is("archived_at", null);

    if (courseError) throw courseError;
    if ((ownedCourses ?? []).length !== courseIds.length) {
      return NextResponse.json({ ok: false, error: "One or more courses were not found." }, { status: 404 });
    }

    const { data, error } = await supabase
      .from("class_schedule_rules")
      .insert(rows.map((row) => ({
        ...row,
        user_id: user.id,
      })))
      .select("id, course_id, title, meeting_type, location, days_of_week, start_time, end_time, start_date, end_date, week_pattern, color_override");

    if (error) throw error;
    return NextResponse.json({
      ok: true,
      rule: Array.isArray(body.drafts) ? undefined : data?.[0],
      rules: data ?? [],
      createdCount: data?.length ?? 0,
    });
  } catch (error) {
    console.error("Calendar class creation failed:", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not add class." }, { status: 500 });
  }
}
