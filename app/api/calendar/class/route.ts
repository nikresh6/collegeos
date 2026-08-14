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

export async function POST(request: Request) {
  const token = bearerToken(request);
  if (!token) return NextResponse.json({ ok: false, error: "You are not signed in." }, { status: 401 });

  const supabase = createUserClient(token);

  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ ok: false, error: "You are not signed in." }, { status: 401 });

    const body = await request.json() as Record<string, unknown>;
    const courseId = typeof body.courseId === "string" ? body.courseId : "";
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const days = Array.isArray(body.daysOfWeek)
      ? [...new Set(body.daysOfWeek.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))]
      : [];
    const weekPattern = typeof body.weekPattern === "string" ? body.weekPattern : "every";

    if (!courseId || !title || days.length === 0) {
      return NextResponse.json({ ok: false, error: "Course, title, and at least one day are required." }, { status: 400 });
    }
    if (!validTime(body.startTime) || !validTime(body.endTime) || body.endTime <= body.startTime) {
      return NextResponse.json({ ok: false, error: "Enter a valid class start and end time." }, { status: 400 });
    }
    if (!validDate(body.startDate) || !validDate(body.endDate) || body.endDate < body.startDate) {
      return NextResponse.json({ ok: false, error: "Enter a valid class date range." }, { status: 400 });
    }
    if (!["every", "odd", "even"].includes(weekPattern)) {
      return NextResponse.json({ ok: false, error: "Invalid week pattern." }, { status: 400 });
    }

    const { data: course, error: courseError } = await supabase
      .from("courses")
      .select("id")
      .eq("id", courseId)
      .eq("user_id", user.id)
      .single();

    if (courseError || !course) {
      return NextResponse.json({ ok: false, error: "Course not found." }, { status: 404 });
    }

    const { data, error } = await supabase
      .from("class_schedule_rules")
      .insert({
        user_id: user.id,
        course_id: courseId,
        title,
        meeting_type: "class",
        location: typeof body.location === "string" && body.location.trim() ? body.location.trim() : null,
        days_of_week: days,
        start_time: body.startTime,
        end_time: body.endTime,
        start_date: body.startDate,
        end_date: body.endDate,
        week_pattern: weekPattern,
        color_override: typeof body.color === "string" && body.color ? body.color.slice(0, 32) : null,
        is_active: true,
      })
      .select("id, course_id, title, meeting_type, location, days_of_week, start_time, end_time, start_date, end_date, week_pattern, color_override")
      .single();

    if (error) throw error;
    return NextResponse.json({ ok: true, rule: data });
  } catch (error) {
    console.error("Calendar class creation failed:", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not add class." }, { status: 500 });
  }
}