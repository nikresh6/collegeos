"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  BarChart3,
  BookOpen,
  BrainCircuit,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDot,
  FileText,
  Gauge,
  Loader2,
  Play,
  RotateCcw,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  Trophy,
} from "lucide-react";
import {
  AnimatePresence,
  MotionConfig,
  motion,
} from "framer-motion";
import { supabase } from "../../lib/supabase";
import {
  SchoolMark,
  useSchoolIdentity,
} from "../../components/school-identity";
import {
  aggregatePreparedness,
  calculatePreparedness,
  preparednessLabel,
  studyNeedScore,
  weaknessReason,
  type PreparednessResult,
} from "../../lib/study-mastery";

type Course = {
  id: string;
  code: string;
  name: string;
  color: string;
};

type CourseUnit = {
  id: string;
  course_id: string;
  name: string;
  description: string | null;
  position: number;
};

type CourseTopic = {
  id: string;
  course_id: string;
  unit_id: string | null;
  parent_topic_id: string | null;
  name: string;
  description: string | null;
  position: number;
};

type StudyResponseRow = {
  topic_id: string | null;
  score: number;
  answered_at: string;
};

type StudySessionRow = {
  id: string;
  course_id: string;
  strategy: "manual" | "adaptive";
  selected_topic_ids: string[];
  status: string;
  answered_count: number;
  score_percent: number | null;
  created_at: string;
};

type StudyGuideRow = {
  id: string;
  course_id: string;
  title: string;
  strategy: "manual" | "adaptive";
  selected_topic_ids: string[];
  depth_percent: number;
  created_at: string;
};

type BuilderMode = "quiz" | "guide";
type Strategy = "manual" | "adaptive";
type QuestionType =
  | "multiple_choice"
  | "true_false"
  | "short_answer";

function formatDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(date);
}

function trendText(value: number) {
  if (value >= 8) return `+${value} recent`;
  if (value <= -8) return `${value} recent`;
  return "steady";
}

function questionTypeLabel(type: QuestionType) {
  if (type === "multiple_choice") return "Multiple choice";
  if (type === "true_false") return "True / False";
  return "Short answer";
}

export default function StudyPage() {
  const router = useRouter();
  const { identity } = useSchoolIdentity();

  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState("");
  const [units, setUnits] = useState<CourseUnit[]>([]);
  const [topics, setTopics] = useState<CourseTopic[]>([]);
  const [responses, setResponses] = useState<StudyResponseRow[]>([]);
  const [sourceCounts, setSourceCounts] =
    useState<Record<string, number>>({});
  const [sessions, setSessions] = useState<StudySessionRow[]>([]);
  const [guides, setGuides] = useState<StudyGuideRow[]>([]);

  const [loading, setLoading] = useState(true);
  const [loadingCourse, setLoadingCourse] = useState(false);

  const [strategy, setStrategy] =
    useState<Strategy>("adaptive");
  const [selectedTopicIds, setSelectedTopicIds] =
    useState<string[]>([]);
  const [adaptivePickerOpen, setAdaptivePickerOpen] =
    useState(false);
  const [adaptiveUnitIds, setAdaptiveUnitIds] =
    useState<string[]>([]);
  const [builderMode, setBuilderMode] =
    useState<BuilderMode>("quiz");

  const [questionCount, setQuestionCount] = useState(10);
  const [questionTypes, setQuestionTypes] = useState<
    Record<QuestionType, boolean>
  >({
    multiple_choice: true,
    true_false: true,
    short_answer: true,
  });

  const [guideDepth, setGuideDepth] = useState(60);

  const [generating, setGenerating] = useState(false);
  const [generationMessage, setGenerationMessage] = useState("");
  const [error, setError] = useState("");

  const [openUnits, setOpenUnits] = useState<Record<string, boolean>>({});

  useEffect(() => {
    void initialize();
  }, []);

  useEffect(() => {
    if (!courseId) return;
    void loadCourseStudyData(courseId);
  }, [courseId]);

  async function initialize() {
    try {
      setLoading(true);

      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) throw sessionError;

      if (!session) {
        router.replace("/onboarding");
        return;
      }

      const { data, error: coursesError } =
        await supabase
          .from("courses")
          .select("id, code, name, color")
          .is("archived_at", null)
          .order("created_at", { ascending: true });

      if (coursesError) throw coursesError;

      const activeCourses = (data ?? []) as Course[];
      setCourses(activeCourses);

      const params = new URLSearchParams(
        window.location.search,
      );
      const requestedCourse =
        params.get("course");

      const firstCourse =
        activeCourses.find(
          (course) => course.id === requestedCourse,
        ) ?? activeCourses[0] ?? null;

      if (firstCourse) {
        setCourseId(firstCourse.id);
      }
    } catch (initializationError) {
      console.error(
        "Could not initialize Study:",
        initializationError,
      );
      setError(
        initializationError instanceof Error
          ? initializationError.message
          : "Could not load Study.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadCourseStudyData(nextCourseId: string) {
    try {
      setLoadingCourse(true);
      setError("");

      const [
        { data: unitData, error: unitError },
        { data: topicData, error: topicError },
        { data: responseData, error: responseError },
        { data: linkData, error: linkError },
        { data: sessionData, error: sessionError },
        { data: guideData, error: guideError },
      ] = await Promise.all([
        supabase
          .from("course_units")
          .select(
            "id, course_id, name, description, position",
          )
          .eq("course_id", nextCourseId)
          .order("position", { ascending: true }),
        supabase
          .from("course_topics")
          .select(
            "id, course_id, unit_id, parent_topic_id, name, description, position",
          )
          .eq("course_id", nextCourseId)
          .order("position", { ascending: true }),
        supabase
          .from("study_responses")
          .select("topic_id, score, answered_at")
          .eq("course_id", nextCourseId)
          .order("answered_at", { ascending: true }),
        supabase
          .from("course_file_topic_links")
          .select("topic_id, course_file_id")
          .eq("course_id", nextCourseId),
        supabase
          .from("study_sessions")
          .select(
            "id, course_id, strategy, selected_topic_ids, status, answered_count, score_percent, created_at",
          )
          .eq("course_id", nextCourseId)
          .order("created_at", { ascending: false })
          .limit(6),
        supabase
          .from("study_guides")
          .select(
            "id, course_id, title, strategy, selected_topic_ids, depth_percent, created_at",
          )
          .eq("course_id", nextCourseId)
          .order("created_at", { ascending: false })
          .limit(6),
      ]);

      if (unitError) throw unitError;
      if (topicError) throw topicError;
      if (responseError) throw responseError;
      if (linkError) throw linkError;
      if (sessionError) throw sessionError;
      if (guideError) throw guideError;

      const nextUnits = (unitData ?? []).map((unit) => ({
        id: unit.id,
        course_id: unit.course_id,
        name: unit.name,
        description: unit.description ?? null,
        position: Number(unit.position ?? 0),
      }));

      const nextTopics = (topicData ?? []).map((topic) => ({
        id: topic.id,
        course_id: topic.course_id,
        unit_id: topic.unit_id ?? null,
        parent_topic_id: topic.parent_topic_id ?? null,
        name: topic.name,
        description: topic.description ?? null,
        position: Number(topic.position ?? 0),
      }));

      setUnits(nextUnits);
      setTopics(nextTopics);
      setResponses(
        (responseData ?? []).map((response) => ({
          topic_id: response.topic_id ?? null,
          score: Number(response.score ?? 0),
          answered_at: response.answered_at,
        })),
      );

      const counts: Record<string, Set<string>> = {};

      for (const link of linkData ?? []) {
        if (!counts[link.topic_id]) {
          counts[link.topic_id] = new Set();
        }

        counts[link.topic_id].add(link.course_file_id);
      }

      setSourceCounts(
        Object.fromEntries(
          Object.entries(counts).map(([topicId, ids]) => [
            topicId,
            ids.size,
          ]),
        ),
      );

      setSessions(
        (sessionData ?? []).map((session) => ({
          id: session.id,
          course_id: session.course_id,
          strategy: session.strategy,
          selected_topic_ids: Array.isArray(
            session.selected_topic_ids,
          )
            ? session.selected_topic_ids
            : [],
          status: session.status,
          answered_count: Number(
            session.answered_count ?? 0,
          ),
          score_percent:
            session.score_percent === null
              ? null
              : Number(session.score_percent),
          created_at: session.created_at,
        })) as StudySessionRow[],
      );

      setGuides(
        (guideData ?? []).map((guide) => ({
          id: guide.id,
          course_id: guide.course_id,
          title: guide.title,
          strategy: guide.strategy,
          selected_topic_ids: Array.isArray(
            guide.selected_topic_ids,
          )
            ? guide.selected_topic_ids
            : [],
          depth_percent: Number(
            guide.depth_percent ?? 60,
          ),
          created_at: guide.created_at,
        })) as StudyGuideRow[],
      );

      const params = new URLSearchParams(
        window.location.search,
      );

      const requestedTopics = (
        params.get("topics") ?? ""
      )
        .split(",")
        .filter((id) =>
          nextTopics.some((topic) => topic.id === id),
        );

      const requestedUnit = params.get("unit");

      if (requestedTopics.length > 0) {
        setSelectedTopicIds(requestedTopics);
        setStrategy("manual");
      } else if (requestedUnit) {
        const unitTopicIds = nextTopics
          .filter((topic) => topic.unit_id === requestedUnit)
          .map((topic) => topic.id);

        if (unitTopicIds.length > 0) {
          setSelectedTopicIds(unitTopicIds);
          setStrategy("manual");
        }
      } else {
        setSelectedTopicIds([]);
        setStrategy("adaptive");
        setAdaptiveUnitIds([]);
      }

      setOpenUnits(
        Object.fromEntries(
          nextUnits
            .slice(0, 2)
            .map((unit) => [unit.id, true]),
        ),
      );
    } catch (loadError) {
      console.error(
        "Could not load course study data:",
        loadError,
      );
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load study data.",
      );
    } finally {
      setLoadingCourse(false);
    }
  }

  const selectedCourse = useMemo(
    () =>
      courses.find((course) => course.id === courseId) ??
      null,
    [courses, courseId],
  );

  const topicPreparedness = useMemo(() => {
    const map = new Map<string, PreparednessResult>();

    for (const topic of topics) {
      map.set(
        topic.id,
        calculatePreparedness(
          responses
            .filter(
              (response) =>
                response.topic_id === topic.id,
            )
            .map((response) => ({
              score: response.score,
              answered_at: response.answered_at,
            })),
        ),
      );
    }

    return map;
  }, [topics, responses]);

  const childIds = useMemo(
    () =>
      new Set(
        topics
          .map((topic) => topic.parent_topic_id)
          .filter(
            (id): id is string => Boolean(id),
          ),
      ),
    [topics],
  );

  const studyNodes = useMemo(() => {
    const leaves = topics.filter(
      (topic) => !childIds.has(topic.id),
    );

    return leaves.length > 0 ? leaves : topics;
  }, [topics, childIds]);

  const overallPreparedness = useMemo(
    () =>
      aggregatePreparedness(
        studyNodes.map(
          (topic) =>
            topicPreparedness.get(topic.id) ??
            calculatePreparedness([]),
        ),
      ),
    [studyNodes, topicPreparedness],
  );

  const weakTopics = useMemo(() => {
    return studyNodes
      .filter(
        (topic) =>
          (sourceCounts[topic.id] ?? 0) > 0,
      )
      .map((topic) => ({
        topic,
        stats:
          topicPreparedness.get(topic.id) ??
          calculatePreparedness([]),
      }))
      .sort(
        (a, b) =>
          studyNeedScore(b.stats) -
          studyNeedScore(a.stats),
      )
      .slice(0, 5);
  }, [
    studyNodes,
    topicPreparedness,
    sourceCounts,
  ]);

  const selectedTopics = useMemo(
    () =>
      topics.filter((topic) =>
        selectedTopicIds.includes(topic.id),
      ),
    [topics, selectedTopicIds],
  );

  const selectedMaterialCount = useMemo(() => {
    const selected = new Set(selectedTopicIds);
    const materialIds = new Set<string>();

    for (const topicId of selected) {
      const count = sourceCounts[topicId] ?? 0;

      // We only know counts client-side, so this is a
      // conservative aggregate indicator, not unique-file math.
      for (let index = 0; index < count; index += 1) {
        materialIds.add(`${topicId}-${index}`);
      }
    }

    return materialIds.size;
  }, [selectedTopicIds, sourceCounts]);

  const accent =
    selectedCourse?.color ?? identity.primary;

  function applyAdaptiveFocusFrom(
    topicRows: CourseTopic[],
    responseRows: StudyResponseRow[],
    counts: Record<string, number>,
    allowedUnitIds: string[],
  ) {
    const parentSet = new Set(
      topicRows
        .map((topic) => topic.parent_topic_id)
        .filter(
          (id): id is string => Boolean(id),
        ),
    );

    const allowedUnits =
      new Set(allowedUnitIds);

    const candidates = topicRows.filter(
      (topic) =>
        !parentSet.has(topic.id) &&
        Boolean(topic.unit_id) &&
        allowedUnits.has(topic.unit_id as string) &&
        (counts[topic.id] ?? 0) > 0,
    );

    const ranked = candidates
      .map((topic) => {
        const stats = calculatePreparedness(
          responseRows
            .filter(
              (response) =>
                response.topic_id === topic.id,
            )
            .map((response) => ({
              score: response.score,
              answered_at: response.answered_at,
            })),
        );

        return {
          id: topic.id,
          need: studyNeedScore(stats),
        };
      })
      .sort((a, b) => b.need - a.need);

    const nextTopicIds =
      ranked.slice(0, 4).map((item) => item.id);

    if (nextTopicIds.length === 0) {
      setError(
        "Those units do not have enough analyzed, topic-linked material for Adaptive Focus yet.",
      );
      return false;
    }

    setSelectedTopicIds(nextTopicIds);
    setStrategy("adaptive");
    setAdaptivePickerOpen(false);
    return true;
  }

  function openAdaptivePicker() {
    setError("");
    setStrategy("adaptive");
    setAdaptivePickerOpen(true);
  }

  function toggleAdaptiveUnit(unitId: string) {
    setAdaptiveUnitIds((current) =>
      current.includes(unitId)
        ? current.filter((id) => id !== unitId)
        : [...current, unitId],
    );
  }

  function applyAdaptiveFocus() {
    if (adaptiveUnitIds.length === 0) {
      setError(
        "Choose at least one unit for Adaptive Focus.",
      );
      setAdaptivePickerOpen(true);
      return;
    }

    setError("");
    applyAdaptiveFocusFrom(
      topics,
      responses,
      sourceCounts,
      adaptiveUnitIds,
    );
  }

  function toggleTopic(topicId: string) {
    setStrategy("manual");

    setSelectedTopicIds((current) =>
      current.includes(topicId)
        ? current.filter((id) => id !== topicId)
        : [...current, topicId],
    );
  }

  function toggleUnit(unitId: string) {
    setStrategy("manual");

    const ids = topics
      .filter((topic) => topic.unit_id === unitId)
      .map((topic) => topic.id);

    const allSelected = ids.every((id) =>
      selectedTopicIds.includes(id),
    );

    setSelectedTopicIds((current) => {
      const next = new Set(current);

      if (allSelected) {
        ids.forEach((id) => next.delete(id));
      } else {
        ids.forEach((id) => next.add(id));
      }

      return Array.from(next);
    });
  }

  function setQuestionType(
    type: QuestionType,
  ) {
    setQuestionTypes((current) => {
      const enabledCount = Object.values(
        current,
      ).filter(Boolean).length;

      if (
        current[type] &&
        enabledCount === 1
      ) {
        return current;
      }

      return {
        ...current,
        [type]: !current[type],
      };
    });
  }

  async function postWithRetry(
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

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetch(path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(body),
      });

      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        retryable?: boolean;
        retryAfterSeconds?: number;
        sessionId?: string;
        guideId?: string;
      };

      if (
        response.status === 429 &&
        payload.retryable !== false
      ) {
        const delay = Math.max(
          2,
          Math.min(
            45,
            Number(payload.retryAfterSeconds ?? 15),
          ),
        );

        setGenerationMessage(
          `AI capacity is busy. Your settings are safe. Retrying in about ${delay} seconds…`,
        );

        await new Promise<void>((resolve) =>
          window.setTimeout(resolve, delay * 1000),
        );

        continue;
      }

      if (!response.ok || payload.ok !== true) {
        throw new Error(
          payload.error ||
            "Could not generate study material.",
        );
      }

      return payload;
    }

    throw new Error(
      "Study generation is taking unusually long. Try again in a moment.",
    );
  }

  async function generateQuiz() {
    if (!courseId || selectedTopicIds.length === 0) {
      setError(
        "Choose at least one topic to study.",
      );
      return;
    }

    const enabledTypes = (
      Object.entries(questionTypes) as Array<
        [QuestionType, boolean]
      >
    )
      .filter(([, enabled]) => enabled)
      .map(([type]) => type);

    try {
      setGenerating(true);
      setError("");
      setGenerationMessage(
        strategy === "adaptive"
          ? "Building a quiz around your highest-priority study areas…"
          : "Building a source-grounded quiz from your selected topics…",
      );

      const payload = await postWithRetry(
        "/api/study/generate-quiz",
        {
          courseId,
          topicIds: selectedTopicIds,
          strategy,
          questionCount,
          questionTypes: enabledTypes,
        },
      );

      if (!payload.sessionId) {
        throw new Error(
          "The quiz was created without a session ID.",
        );
      }

      router.push(
        `/study/session/${payload.sessionId}`,
      );
    } catch (generationError) {
      setError(
        generationError instanceof Error
          ? generationError.message
          : "Could not generate the quiz.",
      );
    } finally {
      setGenerating(false);
      setGenerationMessage("");
    }
  }

  async function generateGuide() {
    if (!courseId || selectedTopicIds.length === 0) {
      setError(
        "Choose at least one topic for the guide.",
      );
      return;
    }

    try {
      setGenerating(true);
      setError("");
      setGenerationMessage(
        "Turning your course materials into a focused study guide…",
      );

      const payload = await postWithRetry(
        "/api/study/generate-guide",
        {
          courseId,
          topicIds: selectedTopicIds,
          strategy,
          depthPercent: guideDepth,
        },
      );

      if (!payload.guideId) {
        throw new Error(
          "The study guide was created without an ID.",
        );
      }

      router.push(
        `/study/guide/${payload.guideId}`,
      );
    } catch (generationError) {
      setError(
        generationError instanceof Error
          ? generationError.message
          : "Could not generate the study guide.",
      );
    } finally {
      setGenerating(false);
      setGenerationMessage("");
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#080809] text-white">
        <div className="flex items-center gap-3 text-[12px] text-white/38">
          <Loader2 size={15} className="animate-spin" />
          Loading Study
        </div>
      </main>
    );
  }

  return (
    <MotionConfig reducedMotion="user">
      <main className="relative min-h-screen overflow-x-hidden bg-[#080809] text-[#F5F5F7]">
        <div
          aria-hidden
          className="pointer-events-none fixed inset-x-0 top-0 h-[620px] opacity-[0.12]"
          style={{
            background: `radial-gradient(circle at 26% 0%, ${accent}55 0%, transparent 60%)`,
          }}
        />

        <div className="relative mx-auto max-w-[1240px] px-5 pb-24 pt-6 sm:px-8 md:px-10 md:pb-16 md:pt-10">
          <div className="flex items-center justify-between gap-4">
            <button
              type="button"
              onClick={() => router.push("/")}
              className="flex items-center gap-2 rounded-full border border-white/[0.07] bg-white/[0.02] px-3.5 py-2.5 text-[12px] font-medium text-white/48 transition hover:bg-white/[0.045] hover:text-white/78"
            >
              <ArrowLeft size={14} />
              Home
            </button>

            {selectedCourse && (
              <div className="flex items-center gap-2 rounded-full border border-white/[0.065] bg-white/[0.018] px-3 py-2 text-[11px] text-white/38">
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{
                    backgroundColor: selectedCourse.color,
                  }}
                />
                {selectedCourse.code}
              </div>
            )}
          </div>

          <header className="mt-12 grid gap-10 border-b border-white/[0.065] pb-10 lg:grid-cols-[minmax(0,1fr)_390px] lg:items-end">
            <div>
              <div className="flex items-center gap-3">
                <SchoolMark size={40} quiet />
                <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-white/38">
                  Study
                </p>
              </div>

              <h1 className="mt-6 max-w-4xl text-[50px] font-medium leading-[0.96] tracking-[-0.062em] sm:text-[64px]">
                Know what to study.
                <br className="hidden sm:block" /> Then prove you know it.
              </h1>

              <p className="mt-5 max-w-2xl text-[15px] leading-7 text-white/44">
                Build your own session topic by topic, or let Adaptive Focus
                target weak and under-practiced areas. Every quiz and guide is
                grounded in the materials already connected to your course.
              </p>
            </div>

            <PreparednessHero
              preparedness={overallPreparedness.preparedness}
              answeredCount={overallPreparedness.answeredCount}
              trend={overallPreparedness.trend}
              color={accent}
            />
          </header>

          {courses.length > 1 && (
            <section className="mt-7">
              <div className="flex gap-2 overflow-x-auto pb-1">
                {courses.map((course) => {
                  const active = course.id === courseId;

                  return (
                    <button
                      key={course.id}
                      type="button"
                      onClick={() => {
                        setCourseId(course.id);
                        setSelectedTopicIds([]);
                        setStrategy("adaptive");
                      }}
                      className={`flex shrink-0 items-center gap-3 rounded-[16px] border px-4 py-3 text-left transition ${
                        active
                          ? "border-white/[0.14] bg-white/[0.04]"
                          : "border-white/[0.06] bg-white/[0.012] hover:border-white/[0.1]"
                      }`}
                    >
                      <span
                        className="h-7 w-1 rounded-full"
                        style={{
                          backgroundColor: course.color,
                        }}
                      />
                      <div>
                        <p
                          className="text-[10px] font-semibold"
                          style={{ color: course.color }}
                        >
                          {course.code}
                        </p>
                        <p className="mt-0.5 max-w-[170px] truncate text-[11px] text-white/42">
                          {course.name}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          <AnimatePresence mode="wait">
            {error && (
              <motion.div
                key={error}
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mt-6 rounded-[18px] border border-red-500/15 bg-red-500/[0.04] px-4 py-3.5"
              >
                <p className="text-[11px] leading-5 text-red-200/68">
                  {error}
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          {loadingCourse ? (
            <div className="mt-10 flex items-center gap-2 text-[12px] text-white/36">
              <Loader2 size={14} className="animate-spin" />
              Loading course readiness
            </div>
          ) : selectedCourse ? (
            <>
              <section className="mt-10 grid gap-4 md:grid-cols-2">
                <button
                  type="button"
                  onClick={openAdaptivePicker}
                  className={`group rounded-[24px] border p-5 text-left transition sm:p-6 ${
                    strategy === "adaptive"
                      ? "border-white/[0.14] bg-white/[0.035]"
                      : "border-white/[0.065] bg-[#101012] hover:border-white/[0.1]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-5">
                    <div
                      className="flex h-11 w-11 items-center justify-center rounded-[14px]"
                      style={{
                        backgroundColor: `${accent}12`,
                        color: accent,
                      }}
                    >
                      <BrainCircuit size={18} />
                    </div>
                    {strategy === "adaptive" && (
                      <span
                        className="rounded-full px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.1em]"
                        style={{
                          backgroundColor: `${accent}12`,
                          color: accent,
                        }}
                      >
                        Active
                      </span>
                    )}
                  </div>

                  <p className="mt-5 text-[17px] font-medium tracking-[-0.025em] text-white/76">
                    Adaptive Focus
                  </p>
                  <p className="mt-2 max-w-lg text-[12px] leading-6 text-white/38">
                    Choose the unit or units you are preparing for, then
                    automatically target low preparedness, limited practice,
                    and recent performance dips inside that scope.
                  </p>

                  <div className="mt-5 flex items-center gap-2 text-[11px] font-medium text-white/42 transition group-hover:text-white/70">
                    Choose units & target weak spots
                    <ChevronRight size={12} />
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setStrategy("manual");
                    setAdaptivePickerOpen(false);
                  }}
                  className={`group rounded-[24px] border p-5 text-left transition sm:p-6 ${
                    strategy === "manual"
                      ? "border-white/[0.14] bg-white/[0.035]"
                      : "border-white/[0.065] bg-[#101012] hover:border-white/[0.1]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-5">
                    <div className="flex h-11 w-11 items-center justify-center rounded-[14px] bg-white/[0.035] text-white/46">
                      <Target size={18} />
                    </div>
                    {strategy === "manual" && (
                      <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.1em] text-white/46">
                        Active
                      </span>
                    )}
                  </div>

                  <p className="mt-5 text-[17px] font-medium tracking-[-0.025em] text-white/76">
                    Build it yourself
                  </p>
                  <p className="mt-2 max-w-lg text-[12px] leading-6 text-white/38">
                    Choose any unit, topic, or subtopic manually. Mix exactly
                    what you want before an exam, homework set, or quick review.
                  </p>

                  <div className="mt-5 flex items-center gap-2 text-[11px] font-medium text-white/42 transition group-hover:text-white/70">
                    Choose topics
                    <ChevronRight size={12} />
                  </div>
                </button>
              </section>

              <AnimatePresence initial={false}>
                {adaptivePickerOpen && (
                  <motion.section
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    className="mt-4 overflow-hidden rounded-[24px] border border-white/[0.075] bg-[#101012]"
                  >
                    <div className="grid gap-5 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                      <div>
                        <div className="flex items-center gap-3">
                          <div
                            className="flex h-10 w-10 items-center justify-center rounded-[13px]"
                            style={{
                              backgroundColor: `${accent}12`,
                              color: accent,
                            }}
                          >
                            <BrainCircuit size={16} />
                          </div>

                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-white/28">
                              Adaptive Focus
                            </p>
                            <h3 className="mt-1 text-[18px] font-medium tracking-[-0.03em] text-white/72">
                              Which unit(s) are you studying?
                            </h3>
                          </div>
                        </div>

                        <p className="mt-4 max-w-2xl text-[11px] leading-5 text-white/34">
                          Choose one or more units. Adaptive Focus will only
                          rank weaknesses inside that scope, using preparedness,
                          repetition count, recency, and recent performance.
                        </p>

                        <div className="mt-5 flex flex-wrap gap-2">
                          {units.map((unit) => {
                            const selected =
                              adaptiveUnitIds.includes(unit.id);

                            return (
                              <button
                                key={unit.id}
                                type="button"
                                onClick={() =>
                                  toggleAdaptiveUnit(unit.id)
                                }
                                className={`flex items-center gap-2 rounded-full border px-3 py-2 text-[10px] font-medium transition ${
                                  selected
                                    ? "border-white/[0.15] bg-white/[0.05] text-white/68"
                                    : "border-white/[0.06] bg-white/[0.012] text-white/34 hover:border-white/[0.1] hover:text-white/56"
                                }`}
                              >
                                <span
                                  className="flex h-4 w-4 items-center justify-center rounded-full border"
                                  style={
                                    selected
                                      ? {
                                          backgroundColor: accent,
                                          borderColor: accent,
                                          color: "#080809",
                                        }
                                      : {
                                          borderColor:
                                            "rgba(255,255,255,0.09)",
                                        }
                                  }
                                >
                                  {selected && <Check size={9} />}
                                </span>
                                {unit.name}
                              </button>
                            );
                          })}
                        </div>

                        {units.length === 0 && (
                          <p className="mt-4 text-[11px] text-white/30">
                            This course does not have any units yet.
                          </p>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                        {units.length > 1 && (
                          <button
                            type="button"
                            onClick={() =>
                              setAdaptiveUnitIds(
                                adaptiveUnitIds.length === units.length
                                  ? []
                                  : units.map((unit) => unit.id),
                              )
                            }
                            className="rounded-full border border-white/[0.065] px-3.5 py-2.5 text-[10px] font-medium text-white/38 transition hover:bg-white/[0.03] hover:text-white/62"
                          >
                            {adaptiveUnitIds.length === units.length
                              ? "Clear all"
                              : "Select all"}
                          </button>
                        )}

                        <button
                          type="button"
                          disabled={adaptiveUnitIds.length === 0}
                          onClick={applyAdaptiveFocus}
                          className="flex w-full items-center justify-center gap-2 rounded-full bg-white px-4 py-2.5 text-[10px] font-medium text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-30 sm:w-auto"
                        >
                          <Sparkles size={11} />
                          Find my weak spots
                        </button>
                      </div>
                    </div>
                  </motion.section>
                )}
              </AnimatePresence>

              <section className="mt-10 grid gap-7 lg:grid-cols-[minmax(0,1fr)_390px]">
                <div>
                  <div className="flex flex-wrap items-end justify-between gap-4">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/32">
                        Course map
                      </p>
                      <h2 className="mt-2 text-[29px] font-medium tracking-[-0.045em]">
                        Choose what matters.
                      </h2>
                    </div>

                    <div className="flex items-center gap-3 text-[11px] text-white/30">
                      <span>{selectedTopicIds.length} selected</span>
                      {selectedTopicIds.length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedTopicIds([]);
                            setStrategy("manual");
                          }}
                          className="font-medium text-white/44 transition hover:text-white/72"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>

                  {units.length === 0 && topics.length === 0 ? (
                    <div className="mt-5 rounded-[24px] border border-white/[0.06] bg-[#101012] p-6">
                      <p className="text-[14px] font-medium text-white/68">
                        No study structure yet.
                      </p>
                      <p className="mt-2 text-[12px] leading-6 text-white/36">
                        Add a syllabus or course materials first so this course
                        has units and topics to study.
                      </p>
                    </div>
                  ) : (
                    <div className="mt-5 space-y-3">
                      {units.map((unit) => {
                        const unitTopics = topics.filter(
                          (topic) => topic.unit_id === unit.id,
                        );
                        const unitStudyNodes = unitTopics.filter(
                          (topic) =>
                            !unitTopics.some(
                              (candidate) =>
                                candidate.parent_topic_id === topic.id,
                            ),
                        );
                        const stats = aggregatePreparedness(
                          unitStudyNodes.map(
                            (topic) =>
                              topicPreparedness.get(topic.id) ??
                              calculatePreparedness([]),
                          ),
                        );
                        const open = Boolean(openUnits[unit.id]);

                        return (
                          <div
                            key={unit.id}
                            className="overflow-hidden rounded-[22px] border border-white/[0.065] bg-[#101012]"
                          >
                            <div className="flex items-center gap-3 px-4 py-4 sm:px-5">
                              <button
                                type="button"
                                onClick={() =>
                                  setOpenUnits((current) => ({
                                    ...current,
                                    [unit.id]: !current[unit.id],
                                  }))
                                }
                                className="flex min-w-0 flex-1 items-center gap-3 text-left"
                              >
                                <div
                                  className="h-8 w-1 shrink-0 rounded-full"
                                  style={{
                                    backgroundColor: accent,
                                  }}
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                    <p className="truncate text-[13px] font-medium text-white/72">
                                      {unit.name}
                                    </p>
                                    <span className="text-[10px] text-white/28">
                                      {stats.preparedness}% prepared ·{" "}
                                      {stats.answeredCount} reps
                                    </span>
                                  </div>

                                  <div className="mt-2 h-1.5 max-w-[320px] overflow-hidden rounded-full bg-white/[0.05]">
                                    <div
                                      className="h-full rounded-full transition-[width] duration-500"
                                      style={{
                                        width: `${stats.preparedness}%`,
                                        backgroundColor: accent,
                                      }}
                                    />
                                  </div>
                                </div>

                                {open ? (
                                  <ChevronDown size={14} className="text-white/28" />
                                ) : (
                                  <ChevronRight size={14} className="text-white/28" />
                                )}
                              </button>

                              <button
                                type="button"
                                onClick={() => toggleUnit(unit.id)}
                                className="rounded-full border border-white/[0.06] px-3 py-2 text-[10px] font-medium text-white/40 transition hover:bg-white/[0.03] hover:text-white/68"
                              >
                                {unitTopics.length > 0 &&
                                unitTopics.every((topic) =>
                                  selectedTopicIds.includes(topic.id),
                                )
                                  ? "Deselect unit"
                                  : "Select unit"}
                              </button>
                            </div>

                            <AnimatePresence initial={false}>
                              {open && (
                                <motion.div
                                  initial={{ opacity: 0, height: 0 }}
                                  animate={{ opacity: 1, height: "auto" }}
                                  exit={{ opacity: 0, height: 0 }}
                                  className="border-t border-white/[0.05]"
                                >
                                  <div className="space-y-2 p-3 sm:p-4">
                                    {unitTopics
                                      .filter(
                                        (topic) =>
                                          !topic.parent_topic_id,
                                      )
                                      .map((topic) => (
                                        <TopicSelector
                                          key={topic.id}
                                          topic={topic}
                                          children={unitTopics.filter(
                                            (candidate) =>
                                              candidate.parent_topic_id ===
                                              topic.id,
                                          )}
                                          preparedness={topicPreparedness}
                                          sourceCounts={sourceCounts}
                                          selectedTopicIds={selectedTopicIds}
                                          color={accent}
                                          onToggle={toggleTopic}
                                        />
                                      ))}
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        );
                      })}

                      {topics.some((topic) => !topic.unit_id) && (
                        <div className="overflow-hidden rounded-[22px] border border-white/[0.055] bg-white/[0.01]">
                          <div className="px-5 py-4">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/28">
                              Unassigned topics
                            </p>
                          </div>
                          <div className="space-y-2 border-t border-white/[0.045] p-3">
                            {topics
                              .filter(
                                (topic) =>
                                  !topic.unit_id &&
                                  !topic.parent_topic_id,
                              )
                              .map((topic) => (
                                <TopicSelector
                                  key={topic.id}
                                  topic={topic}
                                  children={topics.filter(
                                    (candidate) =>
                                      candidate.parent_topic_id === topic.id,
                                  )}
                                  preparedness={topicPreparedness}
                                  sourceCounts={sourceCounts}
                                  selectedTopicIds={selectedTopicIds}
                                  color={accent}
                                  onToggle={toggleTopic}
                                />
                              ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="mt-10">
                    <div className="flex items-end justify-between gap-4">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/32">
                          Adaptive readout
                        </p>
                        <h2 className="mt-2 text-[27px] font-medium tracking-[-0.04em]">
                          Where to spend the next 20 minutes.
                        </h2>
                      </div>
                    </div>

                    {weakTopics.length === 0 ? (
                      <div className="mt-5 rounded-[22px] border border-white/[0.06] bg-white/[0.012] p-5">
                        <p className="text-[12px] leading-6 text-white/38">
                          Analyze and connect some course material first. Adaptive
                          Focus only targets topics that have studyable source
                          material.
                        </p>
                      </div>
                    ) : (
                      <div className="mt-5 grid gap-3 md:grid-cols-2">
                        {weakTopics.map(({ topic, stats }, index) => (
                          <button
                            key={topic.id}
                            type="button"
                            onClick={() => {
                              setStrategy("manual");
                              setSelectedTopicIds([topic.id]);
                            }}
                            className="group rounded-[20px] border border-white/[0.06] bg-white/[0.012] p-5 text-left transition hover:border-white/[0.1] hover:bg-white/[0.02]"
                          >
                            <div className="flex items-start justify-between gap-4">
                              <div>
                                <p
                                  className="text-[10px] font-semibold"
                                  style={{ color: accent }}
                                >
                                  #{index + 1} focus
                                </p>
                                <p className="mt-2 text-[13px] font-medium text-white/68">
                                  {topic.name}
                                </p>
                              </div>

                              <span className="text-[18px] font-medium text-white/66">
                                {stats.preparedness}%
                              </span>
                            </div>

                            <p className="mt-3 text-[11px] leading-5 text-white/34">
                              {weaknessReason(stats)}
                            </p>

                            <div className="mt-4 flex items-center gap-3">
                              <Sparkline
                                values={stats.curve}
                                color={accent}
                              />
                              <span
                                className={`text-[9px] font-medium ${
                                  stats.trend > 5
                                    ? "text-emerald-300/60"
                                    : stats.trend < -5
                                      ? "text-red-300/60"
                                      : "text-white/26"
                                }`}
                              >
                                {trendText(stats.trend)}
                              </span>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {(sessions.length > 0 || guides.length > 0) && (
                    <div className="mt-12">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/32">
                        Recent
                      </p>
                      <h2 className="mt-2 text-[27px] font-medium tracking-[-0.04em]">
                        Keep the rhythm going.
                      </h2>

                      <div className="mt-5 space-y-2">
                        {sessions.slice(0, 3).map((session) => (
                          <button
                            key={session.id}
                            type="button"
                            onClick={() =>
                              router.push(
                                `/study/session/${session.id}`,
                              )
                            }
                            className="flex w-full items-center gap-4 rounded-[17px] border border-white/[0.055] bg-white/[0.01] px-4 py-3.5 text-left transition hover:border-white/[0.09] hover:bg-white/[0.02]"
                          >
                            <div
                              className="flex h-9 w-9 items-center justify-center rounded-[12px]"
                              style={{
                                backgroundColor: `${accent}10`,
                                color: accent,
                              }}
                            >
                              <CircleDot size={14} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-[12px] font-medium text-white/62">
                                {session.strategy === "adaptive"
                                  ? "Adaptive quiz"
                                  : "Custom quiz"}
                              </p>
                              <p className="mt-1 text-[10px] text-white/28">
                                {formatDate(session.created_at)} ·{" "}
                                {session.answered_count} answered
                              </p>
                            </div>
                            {session.score_percent !== null && (
                              <span className="text-[12px] font-medium text-white/50">
                                {Math.round(session.score_percent)}%
                              </span>
                            )}
                            <ChevronRight size={13} className="text-white/20" />
                          </button>
                        ))}

                        {guides.slice(0, 3).map((guide) => (
                          <button
                            key={guide.id}
                            type="button"
                            onClick={() =>
                              router.push(
                                `/study/guide/${guide.id}`,
                              )
                            }
                            className="flex w-full items-center gap-4 rounded-[17px] border border-white/[0.055] bg-white/[0.01] px-4 py-3.5 text-left transition hover:border-white/[0.09] hover:bg-white/[0.02]"
                          >
                            <div
                              className="flex h-9 w-9 items-center justify-center rounded-[12px]"
                              style={{
                                backgroundColor: `${accent}10`,
                                color: accent,
                              }}
                            >
                              <FileText size={14} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[12px] font-medium text-white/62">
                                {guide.title}
                              </p>
                              <p className="mt-1 text-[10px] text-white/28">
                                {formatDate(guide.created_at)} ·{" "}
                                {guide.depth_percent}% depth
                              </p>
                            </div>
                            <ChevronRight size={13} className="text-white/20" />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <aside className="order-first lg:order-none lg:sticky lg:top-8 lg:self-start">
                  <div className="overflow-hidden rounded-[26px] border border-white/[0.075] bg-[#101012] shadow-2xl shadow-black/20">
                    <div className="border-b border-white/[0.055] p-5">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-white/28">
                            Session builder
                          </p>
                          <p className="mt-1.5 text-[18px] font-medium tracking-[-0.03em] text-white/74">
                            Make study feel intentional.
                          </p>
                        </div>
                        <div
                          className="flex h-10 w-10 items-center justify-center rounded-[13px]"
                          style={{
                            backgroundColor: `${accent}12`,
                            color: accent,
                          }}
                        >
                          <Sparkles size={16} />
                        </div>
                      </div>
                    </div>

                    <div className="p-5">
                      <div className="grid grid-cols-2 gap-1 rounded-full border border-white/[0.055] bg-white/[0.012] p-1">
                        <BuilderTab
                          active={builderMode === "quiz"}
                          label="Quiz"
                          icon={Play}
                          onClick={() => setBuilderMode("quiz")}
                        />
                        <BuilderTab
                          active={builderMode === "guide"}
                          label="Study guide"
                          icon={BookOpen}
                          onClick={() => setBuilderMode("guide")}
                        />
                      </div>

                      <div className="mt-6">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/28">
                            Target
                          </p>
                          <button
                            type="button"
                            onClick={openAdaptivePicker}
                            className="flex items-center gap-1.5 text-[10px] font-medium transition"
                            style={{ color: accent }}
                          >
                            <BrainCircuit size={11} />
                            Auto focus
                          </button>
                        </div>

                        {selectedTopics.length === 0 ? (
                          <div className="mt-3 rounded-[16px] border border-dashed border-white/[0.08] px-4 py-4">
                            <p className="text-[11px] leading-5 text-white/32">
                              Pick topics from the course map, or use Adaptive
                              Focus.
                            </p>
                          </div>
                        ) : (
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {selectedTopics.slice(0, 6).map((topic) => (
                              <button
                                key={topic.id}
                                type="button"
                                onClick={() => toggleTopic(topic.id)}
                                className="rounded-full border border-white/[0.06] bg-white/[0.025] px-2.5 py-1.5 text-[9px] font-medium text-white/44 transition hover:text-white/70"
                              >
                                {topic.name} ×
                              </button>
                            ))}
                            {selectedTopics.length > 6 && (
                              <span className="rounded-full border border-white/[0.05] px-2.5 py-1.5 text-[9px] text-white/26">
                                +{selectedTopics.length - 6}
                              </span>
                            )}
                          </div>
                        )}

                        <div className="mt-3 flex items-center gap-2 text-[10px] text-white/26">
                          <FileText size={11} />
                          {selectedMaterialCount} source{" "}
                          {selectedMaterialCount === 1 ? "link" : "links"}
                        </div>
                      </div>

                      {builderMode === "quiz" ? (
                        <>
                          <div className="mt-7">
                            <div className="flex items-end justify-between gap-4">
                              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/28">
                                Questions
                              </p>
                              <span className="text-[15px] font-medium text-white/62">
                                {questionCount}
                              </span>
                            </div>

                            <input
                              type="range"
                              min="5"
                              max="20"
                              step="1"
                              value={questionCount}
                              onChange={(event) =>
                                setQuestionCount(
                                  Number(event.target.value),
                                )
                              }
                              className="mt-4 w-full accent-white"
                            />

                            <div className="mt-2 flex justify-between text-[9px] text-white/20">
                              <span>5 quick</span>
                              <span>20 deep reps</span>
                            </div>
                          </div>

                          <div className="mt-7">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/28">
                              Question mix
                            </p>

                            <div className="mt-3 space-y-2">
                              {(
                                [
                                  "multiple_choice",
                                  "true_false",
                                  "short_answer",
                                ] as QuestionType[]
                              ).map((type) => (
                                <button
                                  key={type}
                                  type="button"
                                  onClick={() => setQuestionType(type)}
                                  className={`flex w-full items-center gap-3 rounded-[15px] border px-3.5 py-3 text-left transition ${
                                    questionTypes[type]
                                      ? "border-white/[0.12] bg-white/[0.035]"
                                      : "border-white/[0.055] bg-white/[0.01]"
                                  }`}
                                >
                                  <div
                                    className={`flex h-5 w-5 items-center justify-center rounded-[6px] border ${
                                      questionTypes[type]
                                        ? "border-transparent"
                                        : "border-white/[0.09]"
                                    }`}
                                    style={
                                      questionTypes[type]
                                        ? {
                                            backgroundColor: accent,
                                            color: "#080809",
                                          }
                                        : undefined
                                    }
                                  >
                                    {questionTypes[type] && <Check size={11} />}
                                  </div>
                                  <span className="text-[11px] font-medium text-white/48">
                                    {questionTypeLabel(type)}
                                  </span>
                                </button>
                              ))}
                            </div>
                          </div>

                          <button
                            type="button"
                            disabled={
                              generating ||
                              selectedTopicIds.length === 0
                            }
                            onClick={() => void generateQuiz()}
                            className="mt-7 flex w-full items-center justify-center gap-2 rounded-full bg-white px-4 py-3 text-[12px] font-medium text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-30"
                          >
                            {generating ? (
                              <Loader2 size={13} className="animate-spin" />
                            ) : (
                              <Play size={12} />
                            )}
                            {generating ? "Building quiz" : "Start quiz"}
                          </button>
                        </>
                      ) : (
                        <>
                          <div className="mt-7">
                            <div className="flex items-end justify-between gap-4">
                              <div>
                                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/28">
                                  Guide depth
                                </p>
                                <p className="mt-1 text-[11px] text-white/32">
                                  Controls explanation and coverage.
                                </p>
                              </div>
                              <span className="text-[15px] font-medium text-white/62">
                                {guideDepth}%
                              </span>
                            </div>

                            <input
                              type="range"
                              min="0"
                              max="100"
                              step="1"
                              value={guideDepth}
                              onChange={(event) =>
                                setGuideDepth(
                                  Number(event.target.value),
                                )
                              }
                              className="mt-4 w-full accent-white"
                            />

                            <div className="mt-2 flex justify-between text-[9px] text-white/20">
                              <span>Quick</span>
                              <span>Balanced</span>
                              <span>Deep</span>
                            </div>
                          </div>

                          <button
                            type="button"
                            disabled={
                              generating ||
                              selectedTopicIds.length === 0
                            }
                            onClick={() => void generateGuide()}
                            className="mt-7 flex w-full items-center justify-center gap-2 rounded-full bg-white px-4 py-3 text-[12px] font-medium text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-30"
                          >
                            {generating ? (
                              <Loader2 size={13} className="animate-spin" />
                            ) : (
                              <BookOpen size={12} />
                            )}
                            {generating
                              ? "Building guide"
                              : "Generate study guide"}
                          </button>
                        </>
                      )}

                      {generationMessage && (
                        <div className="mt-4 rounded-[15px] border border-white/[0.055] bg-white/[0.012] px-3.5 py-3">
                          <p className="text-[10px] leading-5 text-white/34">
                            {generationMessage}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </aside>
              </section>
            </>
          ) : (
            <div className="mt-10 rounded-[24px] border border-white/[0.06] bg-white/[0.012] p-6">
              <p className="text-[14px] font-medium text-white/66">
                Add a course first.
              </p>
            </div>
          )}
        </div>
      </main>
    </MotionConfig>
  );
}

function PreparednessHero({
  preparedness,
  answeredCount,
  trend,
  color,
}: {
  preparedness: number;
  answeredCount: number;
  trend: number;
  color: string;
}) {
  return (
    <div className="rounded-[24px] border border-white/[0.07] bg-[#101012] p-5">
      <div className="flex items-center gap-5">
        <div
          className="relative flex h-[110px] w-[110px] shrink-0 items-center justify-center rounded-full"
          style={{
            background: `conic-gradient(${color} ${preparedness * 3.6}deg, rgba(255,255,255,0.055) 0deg)`,
          }}
        >
          <div className="absolute inset-[7px] rounded-full bg-[#101012]" />
          <div className="relative text-center">
            <p className="text-[28px] font-medium tracking-[-0.05em] text-white/78">
              {preparedness}%
            </p>
            <p className="mt-0.5 text-[9px] font-medium uppercase tracking-[0.1em] text-white/26">
              prepared
            </p>
          </div>
        </div>

        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Gauge size={14} style={{ color }} />
            <p className="text-[12px] font-medium text-white/62">
              Course preparedness
            </p>
          </div>
          <p className="mt-2 text-[11px] leading-5 text-white/34">
            Based on accuracy, repetition, recency, and whether your recent
            answers are improving.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="rounded-full border border-white/[0.055] px-2.5 py-1.5 text-[9px] text-white/34">
              {answeredCount} answers
            </span>
            <span
              className={`flex items-center gap-1 rounded-full border border-white/[0.055] px-2.5 py-1.5 text-[9px] ${
                trend > 5
                  ? "text-emerald-300/60"
                  : trend < -5
                    ? "text-red-300/60"
                    : "text-white/34"
              }`}
            >
              {trend > 5 ? (
                <TrendingUp size={9} />
              ) : trend < -5 ? (
                <TrendingDown size={9} />
              ) : (
                <BarChart3 size={9} />
              )}
              {trendText(trend)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function BuilderTab({
  active,
  label,
  icon: Icon,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: React.ElementType;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center justify-center gap-2 rounded-full px-3 py-2 text-[10px] font-medium transition ${
        active
          ? "bg-white text-black"
          : "text-white/34 hover:text-white/62"
      }`}
    >
      <Icon size={11} />
      {label}
    </button>
  );
}

function TopicSelector({
  topic,
  children,
  preparedness,
  sourceCounts,
  selectedTopicIds,
  color,
  onToggle,
}: {
  topic: CourseTopic;
  children: CourseTopic[];
  preparedness: Map<string, PreparednessResult>;
  sourceCounts: Record<string, number>;
  selectedTopicIds: string[];
  color: string;
  onToggle: (topicId: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const stats =
    preparedness.get(topic.id) ??
    calculatePreparedness([]);
  const selected =
    selectedTopicIds.includes(topic.id);

  return (
    <div className="overflow-hidden rounded-[17px] border border-white/[0.05] bg-white/[0.009]">
      <div className="flex items-center gap-3 px-3.5 py-3">
        <button
          type="button"
          onClick={() => onToggle(topic.id)}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] border transition"
          style={
            selected
              ? {
                  backgroundColor: color,
                  borderColor: color,
                  color: "#080809",
                }
              : {
                  borderColor: "rgba(255,255,255,0.09)",
                }
          }
        >
          {selected && <Check size={12} />}
        </button>

        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <p className="truncate text-[12px] font-medium text-white/64">
                {topic.name}
              </p>
              <span className="text-[9px] text-white/24">
                {sourceCounts[topic.id] ?? 0} sources ·{" "}
                {stats.answeredCount} reps
              </span>
            </div>

            <div className="mt-2 flex items-center gap-3">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.05]">
                <div
                  className="h-full rounded-full transition-[width] duration-500"
                  style={{
                    width: `${stats.preparedness}%`,
                    backgroundColor: color,
                  }}
                />
              </div>
              <span className="w-[35px] text-right text-[9px] font-medium text-white/32">
                {stats.preparedness}%
              </span>
            </div>
          </div>

          <Sparkline values={stats.curve} color={color} />

          {children.length > 0 &&
            (open ? (
              <ChevronDown size={12} className="text-white/24" />
            ) : (
              <ChevronRight size={12} className="text-white/24" />
            ))}
        </button>
      </div>

      {open && children.length > 0 && (
        <div className="space-y-1.5 border-t border-white/[0.04] p-2.5 pl-8">
          {children.map((child) => {
            const childStats =
              preparedness.get(child.id) ??
              calculatePreparedness([]);
            const childSelected =
              selectedTopicIds.includes(child.id);

            return (
              <button
                key={child.id}
                type="button"
                onClick={() => onToggle(child.id)}
                className={`flex w-full items-center gap-3 rounded-[13px] border px-3 py-2.5 text-left transition ${
                  childSelected
                    ? "border-white/[0.11] bg-white/[0.03]"
                    : "border-transparent hover:bg-white/[0.015]"
                }`}
              >
                <div
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border"
                  style={
                    childSelected
                      ? {
                          backgroundColor: color,
                          borderColor: color,
                          color: "#080809",
                        }
                      : {
                          borderColor:
                            "rgba(255,255,255,0.08)",
                        }
                  }
                >
                  {childSelected && <Check size={10} />}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-[10px] font-medium text-white/50">
                    {child.name}
                  </p>
                  <p className="mt-0.5 text-[9px] text-white/22">
                    {preparednessLabel(childStats)} ·{" "}
                    {sourceCounts[child.id] ?? 0} sources ·{" "}
                    {childStats.answeredCount} reps
                  </p>
                </div>

                <span className="text-[9px] font-medium text-white/30">
                  {childStats.preparedness}%
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Sparkline({
  values,
  color,
}: {
  values: number[];
  color: string;
}) {
  if (values.length < 2) {
    return (
      <div className="h-[24px] w-[54px] rounded-[8px] border border-white/[0.045] bg-white/[0.01]" />
    );
  }

  const width = 54;
  const height = 24;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);

  const points = values
    .map((value, index) => {
      const x =
        (index / Math.max(1, values.length - 1)) *
        width;
      const y =
        height -
        ((value - min) / range) * (height - 5) -
        2.5;

      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-[24px] w-[54px] shrink-0 overflow-visible"
      aria-hidden
    >
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
        opacity="0.72"
      />
    </svg>
  );
}