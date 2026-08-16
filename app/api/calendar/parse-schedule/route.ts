import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generateStructured } from "../../../../lib/ai/groq";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Draft = {
  courseId: string;
  title: string;
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
  location: string;
  startDate: string;
  endDate: string;
  confidence: number;
};

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    reply: { type: "string" },
    needsClarification: { type: "boolean" },
    drafts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          courseId: { type: "string" },
          title: { type: "string" },
          daysOfWeek: { type: "array", items: { type: "integer", minimum: 0, maximum: 6 } },
          startTime: { type: "string" },
          endTime: { type: "string" },
          location: { type: "string" },
          startDate: { type: "string" },
          endDate: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 100 },
        },
        required: ["courseId", "title", "daysOfWeek", "startTime", "endTime", "location", "startDate", "endDate", "confidence"],
      },
    },
  },
  required: ["reply", "needsClarification", "drafts"],
};

function bearerToken(request: Request) {
  const value = request.headers.get("authorization") ?? "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}

export async function POST(request: Request) {
  const token = bearerToken(request);
  if (!token) return NextResponse.json({ ok: false, error: "You are not signed in." }, { status: 401 });
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) throw new Error("Supabase public environment variables are missing.");
    const supabase = createClient(url, key, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: "You are not signed in." }, { status: 401 });
    const body = await request.json() as { message?: string; semesterStart?: string; semesterEnd?: string };
    const message = body.message?.trim() ?? "";
    if (!message) return NextResponse.json({ ok: false, error: "Describe at least one class." }, { status: 400 });
    const { data: courses, error } = await supabase.from("courses").select("id, code, name").eq("user_id", user.id).is("archived_at", null);
    if (error) throw error;
    const today = new Date().toISOString().slice(0, 10);
    const result = await generateStructured<{ reply: string; needsClarification: boolean; drafts: Draft[] }>({
      system: `You turn a student's casual description of a weekly class schedule into calendar drafts.

Match only courses from the supplied list and return that exact course id. Day numbers use Sunday=0 through Saturday=6. Convert times to 24-hour HH:MM. Understand forms such as MWF, TR, Tues/Thurs, noon, and 2:30pm. Never guess a missing start or end time. Never invent a course. If essential information is missing, explain exactly what is needed, set needsClarification true, and omit that draft. Use the supplied semester dates as defaults. Return only structured JSON.`,
      user: `TODAY: ${today}\nSEMESTER START: ${body.semesterStart || today}\nSEMESTER END: ${body.semesterEnd || today}\n\nAVAILABLE COURSES:\n${(courses ?? []).map((course) => `${course.id} | ${course.code} | ${course.name}`).join("\n")}\n\nSTUDENT MESSAGE:\n${message}`,
      schemaName: "class_schedule_drafts",
      schema,
      temperature: 0.05,
      maxTokens: 1800,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("Schedule parsing failed:", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not understand that schedule." }, { status: 500 });
  }
}
