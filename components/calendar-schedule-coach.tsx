"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bot, CalendarPlus, Check, ChevronRight, Clock3, FileText, Loader2, MessageCircle, Sparkles, X } from "lucide-react";
import { supabase } from "../lib/supabase";

type Course = { id: string; code: string; name: string; color: string };
type ClassDraft = { courseId: string; title: string; daysOfWeek: number[]; startTime: string; endTime: string; location: string; startDate: string; endDate: string; confidence: number };
type EventDraft = { courseId: string; title: string; itemType: string; date: string; startTime: string; endDate: string; endTime: string; allDay: boolean; location: string; notes: string; confidence: number; startsAt?: string; endsAt?: string };

const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function localDateKey(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function localDate(dateKey: string, time = "00:00") {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  return new Date(year, month - 1, day, hour || 0, minute || 0, 0, 0);
}

function eventTimes(draft: EventDraft) {
  if (draft.startsAt && draft.endsAt) {
    return { startsAt: draft.startsAt, endsAt: draft.endsAt };
  }
  const start = localDate(draft.date, draft.allDay ? "00:00" : draft.startTime);
  const end = localDate(draft.endDate, draft.allDay ? "00:00" : draft.endTime);
  if (draft.allDay) end.setDate(end.getDate() + 1);
  return { startsAt: start.toISOString(), endsAt: end.toISOString() };
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" })
    .format(localDate(value, "12:00"));
}

export function CalendarScheduleCoach({ courses, accent, onApplied, sourceFileId, sourceCourseId }: { courses: Course[]; accent: string; onApplied: () => Promise<void> | void; sourceFileId?: string; sourceCourseId?: string }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [reply, setReply] = useState("");
  const [classDrafts, setClassDrafts] = useState<ClassDraft[]>([]);
  const [eventDrafts, setEventDrafts] = useState<EventDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const courseMap = useMemo(() => new Map(courses.map((course) => [course.id, course])), [courses]);
  const total = classDrafts.length + eventDrafts.length;

  async function token() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("You must be signed in.");
    return session.access_token;
  }

  async function parse() {
    if (!message.trim()) return;
    try {
      setBusy(true);
      setDone(false);
      const today = new Date();
      const end = new Date(today);
      end.setMonth(end.getMonth() + 5);
      const response = await fetch("/api/calendar/parse-schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({ message: message.trim(), semesterStart: localDateKey(today), semesterEnd: localDateKey(end) }),
      });
      const raw = await response.text();
      let payload: { ok?: boolean; reply?: string; classDrafts?: ClassDraft[]; eventDrafts?: EventDraft[]; error?: string } = {};
      try { payload = raw ? JSON.parse(raw) : {}; } catch { throw new Error(`Calendar Assistant failed on the server (HTTP ${response.status}).`); }
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not understand those calendar items.");
      setReply(payload.reply || "I found these items. Review them before adding anything.");
      setClassDrafts(payload.classDrafts ?? []);
      setEventDrafts(payload.eventDrafts ?? []);
    } catch (error) {
      setReply(error instanceof Error ? error.message : "Could not understand those calendar items.");
      setClassDrafts([]);
      setEventDrafts([]);
    } finally {
      setBusy(false);
    }
  }

  async function openAssistant() {
    setOpen(true);
    if (!sourceFileId || !sourceCourseId || busy) return;
    try {
      setBusy(true);
      setDone(false);
      setReply("Reading the uploaded course calendar…");
      const response = await fetch("/api/calendar/parse-source", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({ courseId: sourceCourseId, courseFileId: sourceFileId }),
      });
      const raw = await response.text();
      let payload: { ok?: boolean; reply?: string; classDrafts?: ClassDraft[]; eventDrafts?: EventDraft[]; error?: string } = {};
      try { payload = raw ? JSON.parse(raw) : {}; } catch { throw new Error(`Calendar import failed on the server (HTTP ${response.status}).`); }
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not read this course calendar.");
      setReply(payload.reply || "Review the dates I found before adding them.");
      setClassDrafts(payload.classDrafts ?? []);
      setEventDrafts(payload.eventDrafts ?? []);
    } catch (error) {
      setReply(error instanceof Error ? error.message : "Could not read this course calendar.");
      setClassDrafts([]);
      setEventDrafts([]);
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!total) return;
    try {
      setSaving(true);
      const response = await fetch("/api/calendar/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({
          classDrafts: classDrafts.map((draft) => ({ ...draft, color: courseMap.get(draft.courseId)?.color ?? accent })),
          eventDrafts: eventDrafts.map((draft) => ({ ...draft, ...eventTimes(draft), color: courseMap.get(draft.courseId)?.color ?? accent })),
        }),
      });
      const raw = await response.text();
      let payload: { ok?: boolean; error?: string; createdCount?: number } = {};
      try { payload = raw ? JSON.parse(raw) : {}; } catch { throw new Error(`Saving failed on the server (HTTP ${response.status}).`); }
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not add these items.");
      await onApplied();
      setDone(true);
      setReply(`${payload.createdCount ?? total} color-coded calendar items were added.`);
      setMessage("");
      setClassDrafts([]);
      setEventDrafts([]);
    } catch (error) {
      setReply(error instanceof Error ? error.message : "Could not add these items.");
    } finally {
      setSaving(false);
    }
  }

  return <>
    <button type="button" onClick={() => void openAssistant()} className="group flex w-full items-center gap-3 rounded-[20px] border border-white/[.09] bg-white/[.025] p-4 text-left transition hover:border-white/[.15] hover:bg-white/[.04]">
      <span className="flex h-10 w-10 items-center justify-center rounded-[14px]" style={{ color: accent, backgroundColor: `${accent}14` }}><MessageCircle size={16} /></span>
      <span className="min-w-0 flex-1"><span className="block text-[11px] font-medium text-white/72">Calendar Assistant</span><span className="mt-1 block text-[9px] text-white/32">{sourceFileId ? "Import every date from this uploaded calendar" : "Paste classes, due dates, exams, or a whole schedule"}</span></span>
      <ChevronRight size={13} className="text-white/24 transition group-hover:translate-x-0.5" />
    </button>

    <AnimatePresence>{open && <motion.div className="fixed inset-0 z-[95] flex items-end justify-center bg-black/75 backdrop-blur-sm sm:items-center sm:p-5" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="max-h-[94dvh] w-full max-w-3xl overflow-y-auto rounded-t-[30px] border border-white/[.09] bg-[#101012] p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl sm:rounded-[30px] sm:p-7" initial={{ opacity: 0, y: 35 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 35 }}>
        <div className="flex items-start justify-between gap-4"><div className="flex gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-[15px]" style={{ color: accent, backgroundColor: `${accent}14` }}><Bot size={18} /></span><div><p className="text-[9px] font-semibold uppercase tracking-[.14em] text-white/30">Calendar Assistant</p><h2 className="mt-1 text-[25px] font-medium tracking-[-.045em] sm:text-[29px]">Tell me everything at once.</h2></div></div><button type="button" aria-label="Close Calendar Assistant" onClick={() => setOpen(false)} className="h-9 w-9 shrink-0 rounded-full border border-white/[.07] text-white/35"><X size={14} className="mx-auto" /></button></div>
        <p className="mt-5 max-w-2xl text-[11px] leading-5 text-white/36">Copy and paste a syllabus date list, several assignments, exams, meetings, and recurring classes in one message. I’ll sort them, match course colors, and show a preview before saving.</p>
        <div className="mt-4 flex flex-wrap gap-2 text-[9px] text-white/30"><span className="rounded-full border border-white/[.07] px-3 py-1.5">MWF classes</span><span className="rounded-full border border-white/[.07] px-3 py-1.5">Bulk due dates</span><span className="rounded-full border border-white/[.07] px-3 py-1.5">Exams & quizzes</span><span className="rounded-full border border-white/[.07] px-3 py-1.5">Personal events</span></div>
        <textarea value={message} maxLength={20000} onChange={(event) => setMessage(event.target.value)} placeholder={"ECON 2180 meets MWF 10–10:50 in Room 204.\nProblem Set 1 due Aug 31. Midterm Sep 24 at 7pm.\nClub meeting Thursday Sep 3, 6–7pm."} className="mt-5 min-h-44 w-full resize-y rounded-[20px] border border-white/[.08] bg-black/20 p-4 text-[13px] leading-6 text-white/76 outline-none placeholder:text-white/18 focus:border-white/[.17]" />
        <button type="button" disabled={busy || !message.trim()} onClick={() => void parse()} className="mt-3 flex w-full items-center justify-center gap-2 rounded-full py-3 text-[11px] font-semibold text-black disabled:opacity-35" style={{ backgroundColor: accent }}>{busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}{busy ? "Reading every item…" : "Build calendar preview"}</button>
        {(reply || total > 0) && <div className="mt-6 border-t border-white/[.06] pt-5">
          {reply && <div className="flex gap-2 text-[11px] leading-5 text-white/46">{done ? <Check size={13} style={{ color: accent }} className="mt-1 shrink-0" /> : <Bot size={13} style={{ color: accent }} className="mt-1 shrink-0" />}<p>{reply}</p></div>}
          {total > 0 && <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {classDrafts.map((draft, index) => { const course = courseMap.get(draft.courseId); return <div key={`class-${draft.courseId}-${index}`} className="flex items-center gap-3 rounded-[18px] border border-white/[.07] bg-white/[.018] p-4"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px]" style={{ color: course?.color ?? accent, backgroundColor: `${course?.color ?? accent}12` }}><Clock3 size={14} /></span><div className="min-w-0 flex-1"><p className="truncate text-[11px] font-medium text-white/70">{course?.code || "Class"} · {draft.title}</p><p className="mt-1 text-[9px] text-white/31">{draft.daysOfWeek.map((day) => dayNames[day]).join(" · ")} · {draft.startTime}–{draft.endTime}{draft.location ? ` · ${draft.location}` : ""}</p></div></div>; })}
            {eventDrafts.map((draft, index) => { const course = courseMap.get(draft.courseId); return <div key={`event-${draft.date}-${index}`} className="flex items-center gap-3 rounded-[18px] border border-white/[.07] bg-white/[.018] p-4"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px]" style={{ color: course?.color ?? accent, backgroundColor: `${course?.color ?? accent}12` }}><FileText size={14} /></span><div className="min-w-0 flex-1"><p className="truncate text-[11px] font-medium text-white/70">{course?.code ? `${course.code} · ` : ""}{draft.title}</p><p className="mt-1 text-[9px] capitalize text-white/31">{draft.itemType} · {dateLabel(draft.date)}{draft.allDay ? " · All day" : ` · ${draft.startTime}`}</p></div></div>; })}
          </div>}
          {total > 0 && <button type="button" disabled={saving} onClick={() => void apply()} className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-white py-3 text-[11px] font-medium text-black disabled:opacity-40">{saving ? <Loader2 size={13} className="animate-spin" /> : <CalendarPlus size={13} />}{saving ? "Adding everything…" : `Add all ${total} items`}</button>}
        </div>}
      </motion.div>
    </motion.div>}</AnimatePresence>
  </>;
}
