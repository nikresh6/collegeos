"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AnimatePresence,
  motion,
} from "framer-motion";
import {
  ArrowRight,
  BrainCircuit,
  Check,
  CheckCircle2,
  ChevronRight,
  Eye,
  Lightbulb,
  Loader2,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import {
  useSchoolIdentity,
} from "./school-identity";

type Course = {
  id: string;
  code: string;
  name: string;
  color: string;
};

type Topic = {
  id: string;
  name: string;
  unit_id: string | null;
};

type SolveState = {
  id: string;
  courseId: string;
  unitId: string | null;
  topicId: string | null;
  originKind: string;
  prompt: string;
  problemSummary: string;
  subject: string;
  givens: string[];
  goal: string;
  assumptions: string[];
  status: string;
  currentStepIndex: number;
  stepCount: number;
  hintCount: number;
  progressPercent: number;
  currentStep: {
    index: number;
    title: string;
    learnerPrompt: string;
    concept: string;
  } | null;
  completedSteps: Array<{
    index: number;
    title: string;
    explanation: string;
  }>;
  answer: {
    finalAnswer: string;
    finalCheck: string;
    steps: Array<{
      index: number;
      title: string;
      explanation: string;
    }>;
  } | null;
};

type OpenSolverDetail = {
  prompt?: string;
  courseId?: string;
  unitId?: string;
  topicId?: string;
  originKind?: string;
  originId?: string;
};

type ApiPayload = {
  ok?: boolean;
  error?: string;
  session?: SolveState;
  correct?: boolean;
  score?: number;
  feedback?: string;
  hint?: string;
  hintLevel?: number;
  revealedEarly?: boolean;
  conflict?: boolean;
};

const EXAMPLES = [
  "Walk me through this equation",
  "Help me reason through this concept",
  "Break this practice question into steps",
] as const;

export function SolveAssistant() {
  const { identity } = useSchoolIdentity();
  const responseRef = useRef<HTMLTextAreaElement>(null);
  const courseOwnerIdRef = useRef("");

  const [open, setOpen] = useState(false);
  const [courses, setCourses] = useState<Course[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [courseId, setCourseId] = useState("");
  const [topicId, setTopicId] = useState("");
  const [unitId, setUnitId] = useState("");
  const [originKind, setOriginKind] = useState("manual");
  const [originId, setOriginId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [response, setResponse] = useState("");
  const [solution, setSolution] =
    useState<SolveState | null>(null);
  const [feedback, setFeedback] = useState("");
  const [feedbackCorrect, setFeedbackCorrect] =
    useState<boolean | null>(null);
  const [hint, setHint] = useState("");
  const [hintLevel, setHintLevel] = useState(0);
  const [confirmReveal, setConfirmReveal] = useState(false);
  const [busy, setBusy] = useState<
    "loading" | "start" | "attempt" | "hint" | "reveal" | null
  >(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextOwnerId = session?.user.id ?? "";
      if (nextOwnerId === courseOwnerIdRef.current) return;

      courseOwnerIdRef.current = nextOwnerId;
      setCourses([]);
      setTopics([]);
      setCourseId("");
      setTopicId("");
      setUnitId("");
      setOriginKind("manual");
      setOriginId("");
      setSolution(null);
      setError("");
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    function handleOpen(event: Event) {
      const detail =
        (event as CustomEvent<OpenSolverDetail>).detail ?? {};

      setPrompt(
        typeof detail.prompt === "string" ? detail.prompt : "",
      );
      if (typeof detail.courseId === "string") {
        setCourseId(detail.courseId);
      }
      setUnitId(
        typeof detail.unitId === "string" ? detail.unitId : "",
      );
      setTopicId(
        typeof detail.topicId === "string" ? detail.topicId : "",
      );
      setOriginKind(
        typeof detail.originKind === "string"
          ? detail.originKind
          : "manual",
      );
      setOriginId(
        typeof detail.originId === "string" ? detail.originId : "",
      );

      setSolution(null);
      setResponse("");
      setFeedback("");
      setFeedbackCorrect(null);
      setHint("");
      setHintLevel(0);
      setConfirmReveal(false);
      setError("");
      setOpen(true);
    }

    window.addEventListener(
      "collegeos:open-solver",
      handleOpen,
    );

    return () => {
      window.removeEventListener(
        "collegeos:open-solver",
        handleOpen,
      );
    };
  }, []);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    window.addEventListener("keydown", closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  useEffect(() => {
    if (!open || courses.length > 0) return;

    let cancelled = false;

    async function loadCourses() {
      try {
        setBusy("loading");
        setError("");

        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (sessionError) throw sessionError;
        if (!session) {
          throw new Error("You must be signed in to use Guided Solve.");
        }

        courseOwnerIdRef.current = session.user.id;

        const { data, error: courseError } = await supabase
          .from("courses")
          .select("id, code, name, color")
          .eq("user_id", session.user.id)
          .is("archived_at", null)
          .order("created_at", { ascending: true });

        if (courseError) throw courseError;
        if (cancelled) return;

        const nextCourses = (data ?? []) as Course[];
        setCourses(nextCourses);
        setCourseId((current) =>
          nextCourses.some((course) => course.id === current)
            ? current
            : nextCourses[0]?.id ?? "",
        );
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load your courses.",
          );
        }
      } finally {
        if (!cancelled) setBusy(null);
      }
    }

    void loadCourses();

    return () => {
      cancelled = true;
    };
  }, [open, courses.length]);

  useEffect(() => {
    if (!open || !courseId) return;

    let cancelled = false;

    async function loadTopics() {
      const { data, error: topicError } = await supabase
        .from("course_topics")
        .select("id, name, unit_id")
        .eq("user_id", courseOwnerIdRef.current)
        .eq("course_id", courseId)
        .order("position", { ascending: true });

      if (cancelled) return;

      if (topicError) {
        setError(topicError.message);
        return;
      }

      const nextTopics = (data ?? []) as Topic[];
      setTopics(nextTopics);
      setTopicId((current) =>
        nextTopics.some((topic) => topic.id === current)
          ? current
          : "",
      );
    }

    void loadTopics();

    return () => {
      cancelled = true;
    };
  }, [courseId, open]);

  const selectedCourse = useMemo(
    () => courses.find((course) => course.id === courseId),
    [courseId, courses],
  );
  const accent = selectedCourse?.color || identity.primary;

  async function post(
    path: string,
    body: Record<string, unknown>,
  ) {
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError) throw sessionError;
    if (!session) {
      throw new Error("You must be signed in.");
    }

    const request = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(body),
    });
    const payload = (await request.json()) as ApiPayload;

    if (request.status === 409 && payload.session) {
      return {
        ...payload,
        conflict: true,
      };
    }

    if (!request.ok || payload.ok === false) {
      throw new Error(
        payload.error || "Guided Solve could not complete that action.",
      );
    }

    return payload;
  }

  async function startSolve() {
    if (!courseId || prompt.trim().length < 4 || busy) return;

    try {
      setBusy("start");
      setError("");
      setFeedback("");
      setHint("");

      const selectedTopic = topics.find(
        (topic) => topic.id === topicId,
      );
      const payload = await post("/api/solve/start", {
        courseId,
        topicId: topicId || null,
        unitId: unitId || selectedTopic?.unit_id || null,
        originKind,
        originId: originId || null,
        prompt: prompt.trim(),
      });

      if (!payload.session) {
        throw new Error("The tutor did not return a guided session.");
      }

      setSolution(payload.session);
      setResponse("");
      setFeedback("");
      setFeedbackCorrect(null);
      setHint("");
      setHintLevel(0);
    } catch (startError) {
      setError(
        startError instanceof Error
          ? startError.message
          : "Could not build the guided solution.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function submitStep() {
    if (!solution || !response.trim() || busy) return;

    try {
      setBusy("attempt");
      setError("");

      const payload = await post(
        `/api/solve/${solution.id}/attempt`,
        {
          response: response.trim(),
          expectedStep: solution.currentStepIndex,
        },
      );

      if (!payload.session) {
        throw new Error("The tutor could not return the next step.");
      }

      if (payload.conflict) {
        setSolution(payload.session);
        setResponse("");
        setHint("");
        setHintLevel(0);
        setFeedback("");
        setFeedbackCorrect(null);
        setError(
          payload.error ||
            "This solve advanced elsewhere. Work from the refreshed step.",
        );
        return;
      }

      setSolution(payload.session);
      setFeedback(payload.feedback || "Step checked.");
      setFeedbackCorrect(Boolean(payload.correct));

      if (payload.correct) {
        setResponse("");
        setHint("");
        setHintLevel(0);
        window.setTimeout(
          () => responseRef.current?.focus(),
          80,
        );
      }
    } catch (attemptError) {
      setError(
        attemptError instanceof Error
          ? attemptError.message
          : "Could not check that step.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function requestHint() {
    if (!solution || busy) return;

    try {
      setBusy("hint");
      setError("");

      const payload = await post(
        `/api/solve/${solution.id}/hint`,
        { expectedStep: solution.currentStepIndex },
      );

      if (payload.conflict && payload.session) {
        setSolution(payload.session);
        setResponse("");
        setHint("");
        setHintLevel(0);
        setFeedback("");
        setFeedbackCorrect(null);
        setError(
          payload.error ||
            "This solve advanced elsewhere. Work from the refreshed step.",
        );
        return;
      }

      if (payload.session) setSolution(payload.session);
      setHint(payload.hint || "Focus on the next requested move.");
      setHintLevel(Number(payload.hintLevel ?? 1));
    } catch (hintError) {
      setError(
        hintError instanceof Error
          ? hintError.message
          : "Could not get the next hint.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function revealAnswer() {
    if (!solution || busy) return;

    try {
      setBusy("reveal");
      setError("");

      const payload = await post(
        `/api/solve/${solution.id}/reveal`,
        { confirm: true },
      );

      if (!payload.session) {
        throw new Error("The tutor could not reveal the solution.");
      }

      setSolution(payload.session);
      setConfirmReveal(false);
      setFeedback(
        payload.revealedEarly
          ? "Answer revealed. This attempt will not count like independent practice."
          : "Solution complete.",
      );
      setFeedbackCorrect(null);
    } catch (revealError) {
      setError(
        revealError instanceof Error
          ? revealError.message
          : "Could not reveal the solution.",
      );
    } finally {
      setBusy(null);
    }
  }

  function startAnother() {
    setSolution(null);
    setPrompt("");
    setResponse("");
    setFeedback("");
    setFeedbackCorrect(null);
    setHint("");
    setHintLevel(0);
    setConfirmReveal(false);
    setOriginKind("manual");
    setOriginId("");
    setUnitId("");
    setError("");
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[360] flex items-end justify-center bg-black/74 backdrop-blur-xl sm:items-center sm:p-5"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setOpen(false);
            }
          }}
        >
          <motion.section
            role="dialog"
            aria-modal="true"
            aria-label="Guided Solve"
            initial={{ opacity: 0, y: 28, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.99 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="flex max-h-[calc(100svh-8px)] w-full max-w-[820px] flex-col overflow-hidden rounded-t-[30px] border border-white/[0.09] bg-[#101012] shadow-[0_34px_120px_rgba(0,0,0,.68)] sm:max-h-[88svh] sm:rounded-[30px]"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="flex shrink-0 items-center gap-3 border-b border-white/[0.06] px-4 py-3.5 sm:px-6 sm:py-4">
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[13px]"
                style={{
                  color: accent,
                  backgroundColor: `${accent}12`,
                }}
              >
                <BrainCircuit size={15} />
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-[12px] font-medium text-white/72">
                    Guided Solve
                  </p>
                  <span className="rounded-full border border-white/[0.055] px-2 py-0.5 text-[7px] font-semibold uppercase tracking-[0.12em] text-white/24">
                    No spoilers
                  </span>
                </div>
                <p className="mt-0.5 truncate text-[8px] text-white/22">
                  Work it out one verified step at a time.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close Guided Solve"
                className="ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/[0.06] text-white/28 transition hover:bg-white/[0.035] hover:text-white/62"
              >
                <X size={13} />
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(24px,env(safe-area-inset-bottom))] pt-5 sm:px-7 sm:pb-7 sm:pt-6">
              {!solution ? (
                <div className="mx-auto max-w-[680px]">
                  <div className="flex items-start gap-3 rounded-[18px] border border-white/[0.055] bg-white/[0.012] p-4">
                    <ShieldCheck
                      size={14}
                      className="mt-0.5 shrink-0"
                      style={{ color: accent }}
                    />
                    <div>
                      <p className="text-[11px] font-medium text-white/58">
                        The answer stays locked while you learn it.
                      </p>
                      <p className="mt-1 text-[9px] leading-4 text-white/25">
                        Ask for progressively stronger hints, submit each step,
                        or deliberately reveal the answer when you are truly
                        stuck.
                      </p>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    <label className="text-[9px] font-medium text-white/28">
                      Course
                      <select
                        value={courseId}
                        onChange={(event) => {
                          setCourseId(event.target.value);
                          setTopicId("");
                          setUnitId("");
                          setOriginKind("manual");
                          setOriginId("");
                        }}
                        disabled={busy === "loading"}
                        className="mt-2 w-full rounded-[14px] border border-white/[0.07] bg-black/20 px-3 py-3 text-[11px] text-white/68 outline-none [color-scheme:dark]"
                      >
                        {courses.length === 0 && (
                          <option value="">No course available</option>
                        )}
                        {courses.map((course) => (
                          <option key={course.id} value={course.id}>
                            {course.code} · {course.name}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="text-[9px] font-medium text-white/28">
                      Topic <span className="text-white/14">(optional)</span>
                      <select
                        value={topicId}
                        onChange={(event) => {
                          const nextTopicId = event.target.value;
                          const nextTopic = topics.find(
                            (topic) => topic.id === nextTopicId,
                          );
                          setTopicId(nextTopicId);
                          setUnitId(nextTopic?.unit_id ?? "");
                        }}
                        disabled={!courseId}
                        className="mt-2 w-full rounded-[14px] border border-white/[0.07] bg-black/20 px-3 py-3 text-[11px] text-white/68 outline-none [color-scheme:dark] disabled:opacity-35"
                      >
                        <option value="">Let the tutor infer it</option>
                        {topics.map((topic) => (
                          <option key={topic.id} value={topic.id}>
                            {topic.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <label className="mt-5 block text-[9px] font-medium text-white/28">
                    Question or problem
                    <textarea
                      value={prompt}
                      onChange={(event) => setPrompt(event.target.value)}
                      rows={8}
                      placeholder="Paste the full problem, including any given values, answer choices, or instructions…"
                      className="mt-2 w-full resize-none rounded-[20px] border border-white/[0.075] bg-black/20 px-4 py-4 text-[13px] leading-6 text-white/72 outline-none placeholder:text-white/18 focus:border-white/[0.13]"
                    />
                  </label>

                  {!prompt.trim() && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {EXAMPLES.map((example) => (
                        <button
                          key={example}
                          type="button"
                          onClick={() => setPrompt(`${example}: `)}
                          className="rounded-full border border-white/[0.055] bg-white/[0.01] px-3 py-2 text-[8px] text-white/26 transition hover:border-white/[0.09] hover:text-white/48"
                        >
                          {example}
                        </button>
                      ))}
                    </div>
                  )}

                  {error && <ErrorNotice message={error} />}

                  <button
                    type="button"
                    disabled={
                      busy !== null ||
                      !courseId ||
                      prompt.trim().length < 4
                    }
                    onClick={() => void startSolve()}
                    className="mt-5 flex w-full items-center justify-center gap-2 rounded-full py-3.5 text-[11px] font-semibold text-black transition disabled:cursor-not-allowed disabled:opacity-35"
                    style={{ backgroundColor: accent }}
                  >
                    {busy === "start" || busy === "loading" ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Sparkles size={13} />
                    )}
                    {busy === "start"
                      ? "Building your learning path…"
                      : "Start guided solve"}
                  </button>
                </div>
              ) : (
                <div className="mx-auto max-w-[700px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className="rounded-full px-2.5 py-1 text-[8px] font-semibold uppercase tracking-[0.11em]"
                      style={{
                        color: accent,
                        backgroundColor: `${accent}12`,
                      }}
                    >
                      {selectedCourse?.code || "Course"}
                    </span>
                    <span className="rounded-full border border-white/[0.055] px-2.5 py-1 text-[8px] text-white/25">
                      {solution.subject}
                    </span>
                    <span className="ml-auto text-[9px] tabular-nums text-white/24">
                      {solution.status === "completed"
                        ? "Complete"
                        : `Step ${solution.currentStepIndex + 1} of ${solution.stepCount}`}
                    </span>
                  </div>

                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
                    <motion.div
                      animate={{ width: `${solution.progressPercent}%` }}
                      className="h-full rounded-full"
                      style={{ backgroundColor: accent }}
                    />
                  </div>

                  <div className="mt-5 rounded-[20px] border border-white/[0.06] bg-white/[0.01] p-4 sm:p-5">
                    <p className="text-[8px] font-semibold uppercase tracking-[0.13em] text-white/22">
                      The problem
                    </p>
                    <p className="mt-2 whitespace-pre-wrap text-[11px] leading-5 text-white/48">
                      {solution.prompt}
                    </p>
                    <div className="mt-4 flex items-start gap-2 border-t border-white/[0.045] pt-3">
                      <ArrowRight
                        size={10}
                        className="mt-1 shrink-0"
                        style={{ color: accent }}
                      />
                      <p className="text-[9px] leading-4 text-white/28">
                        {solution.goal}
                      </p>
                    </div>
                  </div>

                  {solution.completedSteps.length > 0 && (
                    <div className="mt-4 space-y-2">
                      {solution.completedSteps.map((step) => (
                        <div
                          key={step.index}
                          className="flex items-start gap-3 rounded-[16px] border border-emerald-300/[0.08] bg-emerald-300/[0.018] px-4 py-3"
                        >
                          <CheckCircle2
                            size={12}
                            className="mt-0.5 shrink-0 text-emerald-200/55"
                          />
                          <div>
                            <p className="text-[9px] font-medium text-white/43">
                              {step.title}
                            </p>
                            <p className="mt-1 text-[8px] leading-4 text-white/22">
                              {step.explanation}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {solution.currentStep ? (
                    <motion.div
                      key={solution.currentStep.index}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="mt-4 rounded-[23px] border border-white/[0.075] bg-[#141416] p-5 sm:p-6"
                    >
                      <div className="flex items-start gap-3">
                        <span
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[11px] text-[10px] font-semibold"
                          style={{
                            color: accent,
                            backgroundColor: `${accent}12`,
                          }}
                        >
                          {solution.currentStep.index + 1}
                        </span>
                        <div>
                          <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-white/24">
                            {solution.currentStep.title}
                          </p>
                          <h2 className="mt-2 text-[17px] font-medium leading-6 tracking-[-0.025em] text-white/74 sm:text-[19px]">
                            {solution.currentStep.learnerPrompt}
                          </h2>
                          {solution.currentStep.concept && (
                            <p className="mt-2 text-[9px] leading-4 text-white/24">
                              Focus: {solution.currentStep.concept}
                            </p>
                          )}
                        </div>
                      </div>

                      {hint && (
                        <motion.div
                          initial={{ opacity: 0, y: 5 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="mt-4 flex items-start gap-3 rounded-[16px] border border-amber-200/[0.1] bg-amber-200/[0.025] p-4"
                        >
                          <Lightbulb
                            size={12}
                            className="mt-0.5 shrink-0 text-amber-100/55"
                          />
                          <div>
                            <p className="text-[8px] font-semibold uppercase tracking-[0.12em] text-amber-100/35">
                              Hint {hintLevel} of 3
                            </p>
                            <p className="mt-1.5 text-[10px] leading-5 text-white/42">
                              {hint}
                            </p>
                          </div>
                        </motion.div>
                      )}

                      <textarea
                        ref={responseRef}
                        value={response}
                        onChange={(event) => setResponse(event.target.value)}
                        rows={4}
                        placeholder="Show your next step or explain your reasoning…"
                        className="mt-5 w-full resize-none rounded-[17px] border border-white/[0.07] bg-black/20 px-4 py-3.5 text-[12px] leading-5 text-white/68 outline-none placeholder:text-white/16 focus:border-white/[0.13]"
                      />

                      {feedback && (
                        <div
                          className={`mt-3 flex items-start gap-2 rounded-[14px] border px-3.5 py-3 text-[9px] leading-4 ${
                            feedbackCorrect === true
                              ? "border-emerald-300/10 bg-emerald-300/[0.025] text-emerald-100/52"
                              : feedbackCorrect === false
                                ? "border-amber-200/10 bg-amber-200/[0.025] text-amber-100/50"
                                : "border-white/[0.055] bg-white/[0.012] text-white/34"
                          }`}
                        >
                          {feedbackCorrect ? (
                            <Check size={10} className="mt-0.5 shrink-0" />
                          ) : (
                            <BrainCircuit
                              size={10}
                              className="mt-0.5 shrink-0"
                            />
                          )}
                          {feedback}
                        </div>
                      )}

                      {error && <ErrorNotice message={error} />}

                      <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
                        <button
                          type="button"
                          disabled={busy !== null || !response.trim()}
                          onClick={() => void submitStep()}
                          className="flex items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-[10px] font-semibold text-black disabled:opacity-30"
                        >
                          {busy === "attempt" ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <Send size={11} />
                          )}
                          Check this step
                        </button>
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => void requestHint()}
                          className="flex items-center justify-center gap-2 rounded-full border border-white/[0.07] px-4 py-3 text-[10px] text-white/42 transition hover:bg-white/[0.025] disabled:opacity-30"
                        >
                          {busy === "hint" ? (
                            <Loader2 size={11} className="animate-spin" />
                          ) : (
                            <Lightbulb size={11} />
                          )}
                          {hintLevel >= 3 ? "Repeat strongest hint" : "Get a hint"}
                        </button>
                      </div>

                      <div className="mt-5 border-t border-white/[0.045] pt-4">
                        {!confirmReveal ? (
                          <button
                            type="button"
                            onClick={() => setConfirmReveal(true)}
                            className="flex items-center gap-2 text-[8px] text-white/18 transition hover:text-white/38"
                          >
                            <Eye size={9} />
                            I&apos;m stuck — reveal the answer
                          </button>
                        ) : (
                          <div className="flex flex-col gap-3 rounded-[14px] border border-red-300/[0.08] bg-red-300/[0.015] p-3 sm:flex-row sm:items-center">
                            <p className="min-w-0 flex-1 text-[8px] leading-4 text-white/28">
                              This ends the guided attempt and records that the
                              answer was revealed early.
                            </p>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => setConfirmReveal(false)}
                                className="rounded-full border border-white/[0.06] px-3 py-2 text-[8px] text-white/30"
                              >
                                Keep trying
                              </button>
                              <button
                                type="button"
                                disabled={busy !== null}
                                onClick={() => void revealAnswer()}
                                className="flex items-center gap-1.5 rounded-full border border-red-200/[0.12] px-3 py-2 text-[8px] text-red-100/52 disabled:opacity-35"
                              >
                                {busy === "reveal" && (
                                  <Loader2 size={9} className="animate-spin" />
                                )}
                                Reveal
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  ) : solution.answer ? (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="mt-4 overflow-hidden rounded-[24px] border border-emerald-300/[0.11] bg-emerald-300/[0.025]"
                    >
                      <div className="p-5 sm:p-6">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="text-emerald-100/60" size={14} />
                          <p className="text-[9px] font-semibold uppercase tracking-[0.13em] text-emerald-100/45">
                            Answer unlocked
                          </p>
                        </div>
                        <p className="mt-4 whitespace-pre-wrap text-[16px] font-medium leading-7 text-white/76">
                          {solution.answer.finalAnswer}
                        </p>
                        <div className="mt-5 border-t border-white/[0.055] pt-4">
                          <p className="text-[8px] font-semibold uppercase tracking-[0.12em] text-white/22">
                            Final check
                          </p>
                          <p className="mt-2 text-[10px] leading-5 text-white/38">
                            {solution.answer.finalCheck}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-col gap-2 border-t border-white/[0.055] p-4 sm:flex-row">
                        <button
                          type="button"
                          onClick={startAnother}
                          className="flex flex-1 items-center justify-center gap-2 rounded-full bg-white px-4 py-3 text-[10px] font-semibold text-black"
                        >
                          <RotateCcw size={11} />
                          Solve another problem
                        </button>
                        <button
                          type="button"
                          onClick={() => setOpen(false)}
                          className="flex flex-1 items-center justify-center gap-2 rounded-full border border-white/[0.07] px-4 py-3 text-[10px] text-white/40"
                        >
                          Done
                          <ChevronRight size={10} />
                        </button>
                      </div>
                    </motion.div>
                  ) : null}
                </div>
              )}
            </div>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ErrorNotice({ message }: { message: string }) {
  return (
    <div className="mt-3 rounded-[14px] border border-red-300/10 bg-red-300/[0.025] px-4 py-3 text-[9px] leading-4 text-red-100/55">
      {message}
    </div>
  );
}
