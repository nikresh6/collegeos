"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bot, CalendarPlus, Check, ChevronRight, Loader2, MessageCircle, Sparkles, X } from "lucide-react";
import { supabase } from "../lib/supabase";

type Course = { id: string; code: string; name: string; color: string };
type Draft = { courseId: string; title: string; daysOfWeek: number[]; startTime: string; endTime: string; location: string; startDate: string; endDate: string; confidence: number };

const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function CalendarScheduleCoach({ courses, accent, onApplied }: { courses: Course[]; accent: string; onApplied: () => Promise<void> | void }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [reply, setReply] = useState("");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const courseMap = useMemo(() => new Map(courses.map((course) => [course.id, course])), [courses]);

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
      end.setMonth(end.getMonth() + 4);
      const response = await fetch("/api/calendar/parse-schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({ message: message.trim(), semesterStart: today.toISOString().slice(0, 10), semesterEnd: end.toISOString().slice(0, 10) }),
      });
      const payload = await response.json() as { ok?: boolean; reply?: string; drafts?: Draft[]; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not understand that schedule.");
      setReply(payload.reply || "Review these blocks before adding them.");
      setDrafts(payload.drafts ?? []);
    } catch (error) {
      setReply(error instanceof Error ? error.message : "Could not understand that schedule.");
      setDrafts([]);
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!drafts.length) return;
    try {
      setSaving(true);
      const accessToken = await token();
      for (const draft of drafts) {
        const course = courseMap.get(draft.courseId);
        const response = await fetch("/api/calendar/class", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ ...draft, color: course?.color ?? accent, weekPattern: "every" }),
        });
        const payload = await response.json() as { ok?: boolean; error?: string };
        if (!response.ok || !payload.ok) throw new Error(payload.error || `Could not add ${draft.title}.`);
      }
      await onApplied();
      setDone(true);
      setReply(`${drafts.length} color-coded class ${drafts.length === 1 ? "block is" : "blocks are"} now on your calendar.`);
      setMessage("");
      setDrafts([]);
    } catch (error) {
      setReply(error instanceof Error ? error.message : "Could not add this schedule.");
    } finally {
      setSaving(false);
    }
  }

  return <>
    <button type="button" onClick={() => setOpen(true)} className="group flex w-full items-center gap-3 rounded-[20px] border border-white/[.07] bg-white/[.018] p-4 text-left transition hover:border-white/[.12] hover:bg-white/[.03]">
      <span className="flex h-10 w-10 items-center justify-center rounded-[14px]" style={{ color: accent, backgroundColor: `${accent}14` }}><MessageCircle size={16} /></span>
      <span className="min-w-0 flex-1"><span className="block text-[11px] font-medium text-white/65">Tell me your class schedule</span><span className="mt-1 block text-[9px] text-white/27">“MATH 241 meets MWF from 10–10:50…”</span></span>
      <ChevronRight size={13} className="text-white/18 transition group-hover:translate-x-0.5" />
    </button>

    <AnimatePresence>{open && <motion.div className="fixed inset-0 z-[95] flex items-end justify-center bg-black/75 backdrop-blur-sm sm:items-center sm:p-5" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-[30px] border border-white/[.09] bg-[#101012] p-5 shadow-2xl sm:rounded-[30px] sm:p-7" initial={{ opacity: 0, y: 35 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 35 }}>
        <div className="flex items-start justify-between gap-4"><div className="flex gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-[15px]" style={{ color: accent, backgroundColor: `${accent}14` }}><Bot size={18} /></span><div><p className="text-[9px] font-semibold uppercase tracking-[.14em] text-white/27">Schedule coach</p><h2 className="mt-1 text-[27px] font-medium tracking-[-.045em]">Describe your week.</h2></div></div><button onClick={() => setOpen(false)} className="h-9 w-9 rounded-full border border-white/[.07] text-white/35"><X size={14} className="mx-auto" /></button></div>
        <p className="mt-5 max-w-lg text-[11px] leading-5 text-white/31">Give me several classes at once. Include days, start and end times, and locations if you know them. I’ll match them to your courses and let you review everything before saving.</p>
        <textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="CHEM 102 is Monday, Wednesday and Friday 9–9:50 in Noyes 100. Discussion is Thursday 2–2:50 in Chem Annex…" className="mt-5 min-h-32 w-full rounded-[20px] border border-white/[.08] bg-black/20 p-4 text-[13px] leading-6 text-white/72 outline-none placeholder:text-white/17 focus:border-white/[.15]" />
        <button disabled={busy || !message.trim()} onClick={() => void parse()} className="mt-3 flex w-full items-center justify-center gap-2 rounded-full py-3 text-[11px] font-semibold text-black disabled:opacity-35" style={{ backgroundColor: accent }}>{busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}{busy ? "Reading your schedule…" : "Build schedule preview"}</button>
        {(reply || drafts.length > 0) && <div className="mt-6 border-t border-white/[.06] pt-5">
          {reply && <div className="flex gap-2 text-[11px] leading-5 text-white/42">{done ? <Check size={13} style={{ color: accent }} className="mt-1 shrink-0" /> : <Bot size={13} style={{ color: accent }} className="mt-1 shrink-0" />}<p>{reply}</p></div>}
          {drafts.length > 0 && <div className="mt-4 space-y-2">{drafts.map((draft, index) => { const course = courseMap.get(draft.courseId); return <div key={`${draft.courseId}-${index}`} className="flex items-center gap-3 rounded-[18px] border border-white/[.07] bg-white/[.018] p-4"><span className="h-11 w-1 rounded-full" style={{ backgroundColor: course?.color ?? accent }} /><div className="min-w-0 flex-1"><p className="text-[11px] font-medium text-white/68">{course?.code} · {draft.title}</p><p className="mt-1 text-[9px] text-white/29">{draft.daysOfWeek.map((day) => dayNames[day]).join(" · ")} · {draft.startTime}–{draft.endTime}{draft.location ? ` · ${draft.location}` : ""}</p></div><span className="text-[8px] text-white/18">{Math.round(draft.confidence)}%</span></div>; })}</div>}
          {drafts.length > 0 && <button disabled={saving} onClick={() => void apply()} className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-white py-3 text-[11px] font-medium text-black disabled:opacity-40">{saving ? <Loader2 size={13} className="animate-spin" /> : <CalendarPlus size={13} />}{saving ? "Adding blocks…" : `Add ${drafts.length} class ${drafts.length === 1 ? "block" : "blocks"}`}</button>}
        </div>}
      </motion.div>
    </motion.div>}</AnimatePresence>
  </>;
}
