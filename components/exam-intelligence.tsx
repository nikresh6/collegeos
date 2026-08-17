"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  BrainCircuit,
  ChevronRight,
  Loader2,
  Sparkles,
  Target,
  X,
} from "lucide-react";
import { supabase } from "../lib/supabase";

 type Course = {
  id: string;
  code: string;
  name: string;
};

type Unit = {
  id: string;
  course_id: string;
  name: string;
  position: number;
};

type Forecast = {
  topicId: string;
  name: string;
  parentTopicId: string | null;
  isSubtopic: boolean;
  predictedLikelihood: number;
  confidence: number;
  studyPriority: number;
  studyNeed: number;
  evidenceStrength: number;
  reasons: string[];
};

type FormatSpec = {
  multiple_choice: number;
  true_false: number;
  short_answer: number;
};

type ForecastPayload = {
  ok?: boolean;
  error?: string;
  forecasts?: Forecast[];
  voiceConfidence?: number;
  observedFormat?: FormatSpec;
  studyGuideReliability?: Array<{
    id: string;
    title: string;
    reliability: number;
    sampleCount: number;
  }>;
  disclaimer?: string;
};

const emptyFormat: FormatSpec = {
  multiple_choice: 20,
  true_false: 0,
  short_answer: 5,
};

function confidenceLabel(value: number) {
  if (value >= 75) return "high confidence";
  if (value >= 50) return "medium confidence";
  return "low confidence";
}

function likelihoodLabel(value: number) {
  if (value >= 75) return "Very likely";
  if (value >= 55) return "Likely";
  if (value >= 35) return "Possible";
  return "Lower signal";
}

export function ExamIntelligence() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [courses, setCourses] = useState<Course[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [courseId, setCourseId] = useState("");
  const [unitId, setUnitId] = useState("");
  const [payload, setPayload] = useState<ForecastPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [format, setFormat] = useState<FormatSpec>(emptyFormat);
  const [teacherFormatNote, setTeacherFormatNote] = useState("");

  const hidden =
    pathname.startsWith("/onboarding") ||
    pathname.startsWith("/study/session/") ||
    pathname.startsWith("/lectures/record");

  useEffect(() => {
    if (!open || courses.length) return;
    void loadCourses();
  }, [open, courses.length]);

  useEffect(() => {
    if (!courseId) {
      setUnits([]);
      setUnitId("");
      return;
    }
    void loadUnits(courseId);
  }, [courseId]);

  useEffect(() => {
    if (!open || !courseId || !unitId) return;
    void loadForecast();
  }, [open, courseId, unitId]);

  async function sessionToken() {
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    if (!session) throw new Error("You must be signed in.");
    return session.access_token;
  }

  async function loadCourses() {
    try {
      setError("");
      const { data, error: courseError } = await supabase
        .from("courses")
        .select("id, code, name")
        .is("archived_at", null)
        .order("created_at");
      if (courseError) throw courseError;
      const next = (data ?? []) as Course[];
      setCourses(next);
      if (!courseId && next[0]) setCourseId(next[0].id);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not load courses.");
    }
  }

  async function loadUnits(nextCourseId: string) {
    try {
      setError("");
      const { data, error: unitError } = await supabase
        .from("course_units")
        .select("id, course_id, name, position")
        .eq("course_id", nextCourseId)
        .order("position");
      if (unitError) throw unitError;
      const next = (data ?? []).map((unit) => ({
        ...unit,
        position: Number(unit.position ?? 0),
      })) as Unit[];
      setUnits(next);
      setUnitId((current) =>
        next.some((unit) => unit.id === current) ? current : next[0]?.id ?? "",
      );
      setPayload(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not load units.");
    }
  }

  async function loadForecast() {
    try {
      setLoading(true);
      setError("");
      const token = await sessionToken();
      const response = await fetch(
        `/api/exam-intelligence?courseId=${encodeURIComponent(courseId)}&unitId=${encodeURIComponent(unitId)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const next = (await response.json()) as ForecastPayload;
      if (!response.ok || next.ok !== true) {
        throw new Error(next.error || "Could not build the exam forecast.");
      }
      setPayload(next);
    } catch (nextError) {
      setPayload(null);
      setError(nextError instanceof Error ? nextError.message : "Could not build the exam forecast.");
    } finally {
      setLoading(false);
    }
  }

  function setFormatCount(key: keyof FormatSpec, value: number) {
    setFormat((current) => ({
      ...current,
      [key]: Math.max(0, Math.min(40, Math.round(value || 0))),
    }));
  }

  function useObservedFormat() {
    const observed = payload?.observedFormat;
    if (!observed) return;
    const total = observed.multiple_choice + observed.true_false + observed.short_answer;
    if (total > 0) setFormat(observed);
  }

  async function generateMockExam() {
    const total = format.multiple_choice + format.true_false + format.short_answer;
    if (!courseId || !unitId) {
      setError("Choose a course and unit first.");
      return;
    }
    if (total < 1 || total > 40) {
      setError("Use between 1 and 40 total questions.");
      return;
    }

    try {
      setGenerating(true);
      setError("");
      const token = await sessionToken();
      const response = await fetch("/api/exam-intelligence", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          courseId,
          unitId,
          format,
          teacherFormatNote,
        }),
      });
      const next = (await response.json()) as {
        ok?: boolean;
        error?: string;
        sessionId?: string;
      };
      if (!response.ok || next.ok !== true || !next.sessionId) {
        throw new Error(next.error || "Could not generate the mock exam.");
      }
      setOpen(false);
      router.push(`/study/session/${next.sessionId}`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not generate the mock exam.");
    } finally {
      setGenerating(false);
    }
  }

  const forecasts = payload?.forecasts ?? [];
  const parentForecasts = useMemo(
    () => forecasts.filter((forecast) => !forecast.parentTopicId),
    [forecasts],
  );
  const observedTotal = payload?.observedFormat
    ? payload.observedFormat.multiple_choice +
      payload.observedFormat.true_false +
      payload.observedFormat.short_answer
    : 0;
  const total = format.multiple_choice + format.true_false + format.short_answer;

  if (hidden) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-[92px] right-4 z-[72] flex items-center gap-2 rounded-full border border-white/[0.1] bg-[#111114]/95 px-3.5 py-2.5 text-[10px] font-semibold text-white/64 shadow-2xl shadow-black/40 backdrop-blur-xl transition hover:border-white/[0.16] hover:text-white sm:bottom-5 sm:right-5"
      >
        <Target size={13} />
        Exam Intel
      </button>

      {open && (
        <div className="fixed inset-0 z-[120] bg-black/65 backdrop-blur-sm">
          <button
            type="button"
            aria-label="Close Exam Intelligence"
            className="absolute inset-0"
            onClick={() => setOpen(false)}
          />

          <section className="absolute inset-x-0 bottom-0 max-h-[94vh] overflow-y-auto rounded-t-[28px] border-t border-white/[0.08] bg-[#0d0d0f] shadow-2xl sm:inset-y-3 sm:left-auto sm:right-3 sm:w-[520px] sm:max-h-none sm:rounded-[28px] sm:border">
            <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-white/[0.06] bg-[#0d0d0f]/95 px-5 py-5 backdrop-blur-xl">
              <div>
                <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/30">
                  <BrainCircuit size={12} />
                  Exam Intelligence
                </div>
                <h2 className="mt-2 text-[24px] font-medium tracking-[-0.04em] text-white/88">
                  Predict, then simulate.
                </h2>
                <p className="mt-1 max-w-[390px] text-[11px] leading-5 text-white/34">
                  Forecasts are evidence-weighted, not promises. Mock exams use the forecast for coverage and real teacher questions for voice.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/[0.07] text-white/34 transition hover:text-white/70"
              >
                <X size={14} />
              </button>
            </div>

            <div className="space-y-7 p-5 pb-10">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-white/26">Course</span>
                  <select
                    value={courseId}
                    onChange={(event) => setCourseId(event.target.value)}
                    className="mt-2 w-full rounded-[14px] border border-white/[0.07] bg-white/[0.025] px-3 py-3 text-[11px] text-white/68 outline-none"
                  >
                    {courses.map((course) => (
                      <option key={course.id} value={course.id} className="bg-[#111114]">
                        {course.code} {course.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-white/26">Unit exam</span>
                  <select
                    value={unitId}
                    onChange={(event) => setUnitId(event.target.value)}
                    className="mt-2 w-full rounded-[14px] border border-white/[0.07] bg-white/[0.025] px-3 py-3 text-[11px] text-white/68 outline-none"
                  >
                    {units.map((unit) => (
                      <option key={unit.id} value={unit.id} className="bg-[#111114]">
                        {unit.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {error && (
                <div className="rounded-[16px] border border-red-400/15 bg-red-400/[0.04] px-4 py-3 text-[11px] leading-5 text-red-200/70">
                  {error}
                </div>
              )}

              {loading ? (
                <div className="flex items-center gap-3 rounded-[20px] border border-white/[0.06] bg-white/[0.012] p-5 text-[11px] text-white/34">
                  <Loader2 size={14} className="animate-spin" />
                  Rebuilding the forecast from your latest evidence…
                </div>
              ) : payload ? (
                <>
                  <div>
                    <div className="flex items-end justify-between gap-4">
                      <div>
                        <p className="text-[9px] font-semibold uppercase tracking-[0.13em] text-white/26">Predicted coverage</p>
                        <h3 className="mt-1.5 text-[18px] font-medium tracking-[-0.03em] text-white/74">What is most likely to show up.</h3>
                      </div>
                      <div className="text-right">
                        <p className="text-[20px] font-medium text-white/72">{payload.voiceConfidence ?? 0}%</p>
                        <p className="text-[9px] text-white/24">teacher-voice confidence</p>
                      </div>
                    </div>

                    <div className="mt-4 space-y-2">
                      {parentForecasts.map((topic) => {
                        const children = forecasts.filter((candidate) => candidate.parentTopicId === topic.topicId);
                        return (
                          <div key={topic.topicId} className="rounded-[18px] border border-white/[0.06] bg-white/[0.012] p-4">
                            <ForecastLine forecast={topic} />
                            {children.length > 0 && (
                              <div className="mt-3 space-y-2 border-t border-white/[0.045] pt-3">
                                {children.map((child) => (
                                  <ForecastLine key={child.topicId} forecast={child} compact />
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    <p className="mt-3 text-[9px] leading-4 text-white/22">
                      {payload.disclaimer}
                    </p>
                  </div>

                  {(payload.studyGuideReliability?.length ?? 0) > 0 && (
                    <div>
                      <p className="text-[9px] font-semibold uppercase tracking-[0.13em] text-white/26">Study-guide learning</p>
                      <div className="mt-3 space-y-2">
                        {payload.studyGuideReliability?.map((guide) => (
                          <div key={guide.id} className="flex items-center justify-between gap-4 rounded-[15px] border border-white/[0.055] px-3.5 py-3">
                            <div className="min-w-0">
                              <p className="truncate text-[11px] font-medium text-white/55">{guide.title}</p>
                              <p className="mt-1 text-[9px] text-white/24">
                                {guide.sampleCount > 0
                                  ? `Learned from ${guide.sampleCount} later real assessment${guide.sampleCount === 1 ? "" : "s"}`
                                  : "Prior weight, no later real test to judge it yet"}
                              </p>
                            </div>
                            <span className="shrink-0 text-[15px] font-medium text-white/58">{guide.reliability}%</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="rounded-[22px] border border-white/[0.07] bg-white/[0.015] p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-[9px] font-semibold uppercase tracking-[0.13em] text-white/26">Mock exam format</p>
                        <p className="mt-1.5 text-[13px] font-medium text-white/62">Match what your teacher actually announced.</p>
                      </div>
                      {observedTotal > 0 && (
                        <button
                          type="button"
                          onClick={useObservedFormat}
                          className="rounded-full border border-white/[0.07] px-3 py-2 text-[9px] font-medium text-white/38 transition hover:text-white/66"
                        >
                          Use last exam
                        </button>
                      )}
                    </div>

                    <div className="mt-4 grid grid-cols-3 gap-2">
                      <FormatInput label="MCQ" value={format.multiple_choice} onChange={(value) => setFormatCount("multiple_choice", value)} />
                      <FormatInput label="True / False" value={format.true_false} onChange={(value) => setFormatCount("true_false", value)} />
                      <FormatInput label="Short answer" value={format.short_answer} onChange={(value) => setFormatCount("short_answer", value)} />
                    </div>

                    <label className="mt-4 block">
                      <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-white/24">Teacher note, optional</span>
                      <textarea
                        value={teacherFormatNote}
                        onChange={(event) => setTeacherFormatNote(event.target.value.slice(0, 700))}
                        placeholder='Example: "25 multiple choice and 3 short answer. Short answers are usually multi-part and no calculator."'
                        className="mt-2 min-h-[82px] w-full resize-none rounded-[14px] border border-white/[0.07] bg-black/15 px-3 py-3 text-[11px] leading-5 text-white/58 outline-none placeholder:text-white/18"
                      />
                    </label>

                    <div className="mt-4 flex items-center justify-between gap-4">
                      <div>
                        <p className="text-[18px] font-medium text-white/68">{total}</p>
                        <p className="text-[9px] text-white/24">total questions, max 40</p>
                      </div>
                      <button
                        type="button"
                        disabled={generating || total < 1 || total > 40}
                        onClick={() => void generateMockExam()}
                        className="flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-[10px] font-semibold text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-35"
                      >
                        {generating ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                        {generating ? "Building mock exam…" : "Generate predicted mock"}
                        {!generating && <ChevronRight size={11} />}
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="rounded-[20px] border border-white/[0.06] bg-white/[0.012] p-5 text-[11px] leading-5 text-white/32">
                  Choose a course and unit to build an exam forecast.
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function ForecastLine({ forecast, compact = false }: { forecast: Forecast; compact?: boolean }) {
  return (
    <div className={compact ? "pl-2" : ""}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className={`${compact ? "text-[10px]" : "text-[12px]"} font-medium text-white/62`}>
              {forecast.name}
            </p>
            <span className="text-[8px] font-medium uppercase tracking-[0.08em] text-white/20">
              {likelihoodLabel(forecast.predictedLikelihood)}
            </span>
          </div>
          <p className="mt-1 text-[9px] text-white/24">
            {forecast.reasons.slice(0, compact ? 2 : 3).join(" · ")}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className={`${compact ? "text-[15px]" : "text-[19px]"} font-medium text-white/68`}>
            {forecast.predictedLikelihood}%
          </p>
          <p className="text-[8px] text-white/22">
            {forecast.confidence}% {confidenceLabel(forecast.confidence)}
          </p>
        </div>
      </div>
      <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-white/[0.05]">
        <div
          className="h-full rounded-full bg-white/45"
          style={{ width: `${forecast.predictedLikelihood}%` }}
        />
      </div>
    </div>
  );
}

function FormatInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block rounded-[14px] border border-white/[0.06] bg-black/10 p-2.5">
      <span className="block truncate text-[8px] font-semibold uppercase tracking-[0.1em] text-white/22">{label}</span>
      <input
        type="number"
        min={0}
        max={40}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-1.5 w-full bg-transparent text-[18px] font-medium text-white/66 outline-none"
      />
    </label>
  );
}
