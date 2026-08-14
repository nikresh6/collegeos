"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  ExternalLink,
  FileText,
  Flame,
  Loader2,
  RotateCcw,
  Sparkles,
  Star,
  Target,
  Trophy,
  X,
} from "lucide-react";
import {
  MotionConfig,
  motion,
} from "framer-motion";
import { supabase } from "../../../../lib/supabase";
import {
  useSchoolIdentity,
} from "../../../../components/school-identity";
import {
  calculatePreparedness,
  weaknessReason,
} from "../../../../lib/study-mastery";

type QuestionType =
  | "multiple_choice"
  | "true_false"
  | "short_answer";

type SessionRecord = {
  id: string;
  course_id: string;
  strategy: "manual" | "adaptive";
  selected_topic_ids: string[];
  status: string;
  answered_count: number;
  score_percent: number | null;
};

type Question = {
  id: string;
  topic_id: string | null;
  question_type: QuestionType;
  prompt: string;
  choices: string[];
  correct_answer: string;
  explanation: string;
  difficulty: number;
  source_refs: Array<{
    fileId?: string;
    fileName?: string;
    materialType?: string;
  }>;
  position: number;
};

type ResponseRow = {
  question_id: string;
  topic_id: string | null;
  answer_text: string;
  score: number;
  is_correct: boolean;
  feedback: string;
  answered_at: string;
};

type Topic = {
  id: string;
  name: string;
};

type Course = {
  id: string;
  code: string;
  name: string;
  color: string;
};

type SourceMaterial = {
  id: string;
  file_name: string;
  storage_path: string;
  material_type: string;
  mime_type: string | null;
  is_favorite: boolean;
  favorited_at: string | null;
};

type GradeResult = {
  score: number;
  isCorrect: boolean;
  feedback: string;
  correctAnswer: string;
  explanation: string;
  preparedness?: {
    preparedness: number;
    trend: number;
    answeredCount: number;
  } | null;
  session: {
    answeredCount: number;
    totalQuestions: number;
    scorePercent: number;
    complete: boolean;
  };
};

function questionTypeLabel(type: QuestionType) {
  if (type === "multiple_choice") {
    return "Multiple choice";
  }

  if (type === "true_false") {
    return "True / False";
  }

  return "Short answer";
}

export default function StudySessionPage() {
  const params = useParams();
  const router = useRouter();
  const { identity } = useSchoolIdentity();

  const sessionId = String(params.id ?? "");

  const [session, setSession] =
    useState<SessionRecord | null>(null);
  const [course, setCourse] =
    useState<Course | null>(null);
  const [questions, setQuestions] =
    useState<Question[]>([]);
  const [responses, setResponses] =
    useState<ResponseRow[]>([]);
  const [topics, setTopics] =
    useState<Topic[]>([]);
  const [allEvidence, setAllEvidence] =
    useState<ResponseRow[]>([]);
  const [sourceMaterials, setSourceMaterials] =
    useState<Record<string, SourceMaterial>>({});
  const [sourceBusyIds, setSourceBusyIds] =
    useState<Record<string, boolean>>({});

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] =
    useState(false);
  const [error, setError] = useState("");

  const [currentIndex, setCurrentIndex] =
    useState(0);
  const [answer, setAnswer] = useState("");
  const [result, setResult] =
    useState<GradeResult | null>(null);
  const [showSummary, setShowSummary] =
    useState(false);

  const questionStartedAt = useRef(Date.now());

  useEffect(() => {
    void loadSession();
  }, [sessionId]);

  async function loadSession() {
    try {
      setLoading(true);
      setError("");

      const {
        data: { session: authSession },
        error: authError,
      } = await supabase.auth.getSession();

      if (authError) throw authError;

      if (!authSession) {
        router.replace("/onboarding");
        return;
      }

      const {
        data: sessionData,
        error: sessionError,
      } = await supabase
        .from("study_sessions")
        .select(
          "id, course_id, strategy, selected_topic_ids, status, answered_count, score_percent",
        )
        .eq("id", sessionId)
        .single();

      if (sessionError) throw sessionError;

      const [
        { data: courseData, error: courseError },
        {
          data: questionData,
          error: questionError,
        },
        {
          data: responseData,
          error: responseError,
        },
        { data: topicData, error: topicError },
      ] = await Promise.all([
        supabase
          .from("courses")
          .select("id, code, name, color")
          .eq("id", sessionData.course_id)
          .single(),
        supabase
          .from("study_questions")
          .select(
            "id, topic_id, question_type, prompt, choices, correct_answer, explanation, difficulty, source_refs, position",
          )
          .eq("session_id", sessionId)
          .order("position", { ascending: true }),
        supabase
          .from("study_responses")
          .select(
            "question_id, topic_id, answer_text, score, is_correct, feedback, answered_at",
          )
          .eq("session_id", sessionId)
          .order("answered_at", { ascending: true }),
        supabase
          .from("course_topics")
          .select("id, name")
          .eq("course_id", sessionData.course_id),
      ]);

      if (courseError) throw courseError;
      if (questionError) throw questionError;
      if (responseError) throw responseError;
      if (topicError) throw topicError;

      const nextSession: SessionRecord = {
        id: sessionData.id,
        course_id: sessionData.course_id,
        strategy: sessionData.strategy,
        selected_topic_ids: Array.isArray(
          sessionData.selected_topic_ids,
        )
          ? sessionData.selected_topic_ids
          : [],
        status: sessionData.status,
        answered_count: Number(
          sessionData.answered_count ?? 0,
        ),
        score_percent:
          sessionData.score_percent === null
            ? null
            : Number(sessionData.score_percent),
      };

      const nextQuestions = (questionData ?? []).map(
        (question) => ({
          id: question.id,
          topic_id: question.topic_id ?? null,
          question_type: question.question_type,
          prompt: question.prompt,
          choices: Array.isArray(question.choices)
            ? question.choices
            : [],
          correct_answer: question.correct_answer,
          explanation: question.explanation ?? "",
          difficulty: Number(question.difficulty ?? 2),
          source_refs: Array.isArray(question.source_refs)
            ? question.source_refs
            : [],
          position: Number(question.position ?? 0),
        }),
      ) as Question[];

      const sourceFileIds = Array.from(
        new Set(
          nextQuestions.flatMap((question) =>
            question.source_refs
              .map((source) => source.fileId)
              .filter(
                (id): id is string =>
                  Boolean(id),
              ),
          ),
        ),
      );

      if (sourceFileIds.length > 0) {
        const {
          data: sourceMaterialData,
          error: sourceMaterialError,
        } = await supabase
          .from("course_files")
          .select(
            "id, file_name, storage_path, material_type, mime_type, is_favorite, favorited_at",
          )
          .eq("course_id", sessionData.course_id)
          .in("id", sourceFileIds);

        if (sourceMaterialError) {
          throw sourceMaterialError;
        }

        setSourceMaterials(
          Object.fromEntries(
            (sourceMaterialData ?? []).map(
              (material) => [
                material.id,
                {
                  id: material.id,
                  file_name: material.file_name,
                  storage_path:
                    material.storage_path,
                  material_type:
                    material.material_type,
                  mime_type:
                    material.mime_type ?? null,
                  is_favorite: Boolean(
                    material.is_favorite,
                  ),
                  favorited_at:
                    material.favorited_at ?? null,
                } satisfies SourceMaterial,
              ],
            ),
          ),
        );
      } else {
        setSourceMaterials({});
      }

      const nextResponses = (responseData ?? []).map(
        (response) => ({
          question_id: response.question_id,
          topic_id: response.topic_id ?? null,
          answer_text: response.answer_text ?? "",
          score: Number(response.score ?? 0),
          is_correct: Boolean(response.is_correct),
          feedback: response.feedback ?? "",
          answered_at: response.answered_at,
        }),
      );

      setSession(nextSession);
      setCourse(courseData as Course);
      setQuestions(nextQuestions);
      setResponses(nextResponses);
      setTopics((topicData ?? []) as Topic[]);

      const selectedIds =
        nextSession.selected_topic_ids;

      if (selectedIds.length > 0) {
        const {
          data: evidenceData,
          error: evidenceError,
        } = await supabase
          .from("study_responses")
          .select(
            "question_id, topic_id, answer_text, score, is_correct, feedback, answered_at",
          )
          .eq("course_id", nextSession.course_id)
          .in("topic_id", selectedIds)
          .order("answered_at", { ascending: true });

        if (evidenceError) throw evidenceError;

        setAllEvidence(
          (evidenceData ?? []).map((response) => ({
            question_id: response.question_id,
            topic_id: response.topic_id ?? null,
            answer_text: response.answer_text ?? "",
            score: Number(response.score ?? 0),
            is_correct: Boolean(response.is_correct),
            feedback: response.feedback ?? "",
            answered_at: response.answered_at,
          })),
        );
      }

      const answeredIds = new Set(
        nextResponses.map(
          (response) => response.question_id,
        ),
      );

      const nextIndex =
        nextQuestions.findIndex(
          (question) =>
            !answeredIds.has(question.id),
        );

      if (
        nextSession.status === "completed" ||
        nextIndex === -1
      ) {
        setShowSummary(true);
        setCurrentIndex(
          Math.max(0, nextQuestions.length - 1),
        );
      } else {
        setCurrentIndex(nextIndex);
      }

      questionStartedAt.current = Date.now();
    } catch (loadError) {
      console.error(
        "Could not load study session:",
        loadError,
      );
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load the study session.",
      );
    } finally {
      setLoading(false);
    }
  }

  const currentQuestion =
    questions[currentIndex] ?? null;

  const topicMap = useMemo(
    () =>
      new Map(
        topics.map((topic) => [
          topic.id,
          topic.name,
        ]),
      ),
    [topics],
  );

  const currentTopicName =
    currentQuestion?.topic_id
      ? topicMap.get(currentQuestion.topic_id) ??
        "Course topic"
      : "Course topic";

  const answeredQuestionIds = useMemo(
    () =>
      new Set(
        responses.map(
          (response) => response.question_id,
        ),
      ),
    [responses],
  );

  const completedCount =
    answeredQuestionIds.size;

  const progress =
    questions.length > 0
      ? Math.round(
          (completedCount / questions.length) *
            100,
        )
      : 0;

  const scorePercent =
    responses.length > 0
      ? Math.round(
          (responses.reduce(
            (sum, response) =>
              sum + response.score,
            0,
          ) /
            responses.length) *
            100,
        )
      : 0;

  const streak = useMemo(() => {
    let count = 0;

    for (
      let index = responses.length - 1;
      index >= 0;
      index -= 1
    ) {
      if (responses[index].score >= 0.85) {
        count += 1;
      } else {
        break;
      }
    }

    return count;
  }, [responses]);

  const topicSummary = useMemo(() => {
    if (!session) return [];

    return session.selected_topic_ids
      .map((topicId) => {
        const evidence = allEvidence
          .filter(
            (response) =>
              response.topic_id === topicId,
          )
          .map((response) => ({
            score: response.score,
            answered_at: response.answered_at,
          }));

        const stats =
          calculatePreparedness(evidence);

        return {
          topicId,
          name:
            topicMap.get(topicId) ??
            "Topic",
          stats,
        };
      })
      .sort(
        (a, b) =>
          a.stats.preparedness -
          b.stats.preparedness,
      );
  }, [session, allEvidence, topicMap]);

  const accent =
    course?.color ?? identity.primary;

  async function openSourceMaterial(
    material: SourceMaterial,
  ) {
    if (sourceBusyIds[material.id]) return;

    try {
      setSourceBusyIds((current) => ({
        ...current,
        [material.id]: true,
      }));
      setError("");

      const bucket =
        material.material_type ===
        "lecture_recording"
          ? "lecture-audio"
          : "course-files";

      const {
        data,
        error: signedUrlError,
      } = await supabase.storage
        .from(bucket)
        .createSignedUrl(
          material.storage_path,
          10 * 60,
        );

      if (signedUrlError) {
        throw signedUrlError;
      }

      window.open(
        data.signedUrl,
        "_blank",
        "noopener,noreferrer",
      );
    } catch (openError) {
      setError(
        openError instanceof Error
          ? openError.message
          : "Could not open this material.",
      );
    } finally {
      setSourceBusyIds((current) => ({
        ...current,
        [material.id]: false,
      }));
    }
  }

  async function toggleSourceFavorite(
    material: SourceMaterial,
  ) {
    if (!course || sourceBusyIds[material.id]) {
      return;
    }

    const nextFavorite =
      !material.is_favorite;
    const favoritedAt = nextFavorite
      ? new Date().toISOString()
      : null;

    setSourceMaterials((current) => ({
      ...current,
      [material.id]: {
        ...material,
        is_favorite: nextFavorite,
        favorited_at: favoritedAt,
      },
    }));

    try {
      setSourceBusyIds((current) => ({
        ...current,
        [material.id]: true,
      }));

      const { error: favoriteError } =
        await supabase
          .from("course_files")
          .update({
            is_favorite: nextFavorite,
            favorited_at: favoritedAt,
          })
          .eq("id", material.id)
          .eq("course_id", course.id);

      if (favoriteError) {
        throw favoriteError;
      }
    } catch (favoriteError) {
      setSourceMaterials((current) => ({
        ...current,
        [material.id]: material,
      }));
      setError(
        favoriteError instanceof Error
          ? favoriteError.message
          : "Could not update this favorite.",
      );
    } finally {
      setSourceBusyIds((current) => ({
        ...current,
        [material.id]: false,
      }));
    }
  }

  async function submitAnswer() {
    if (
      !currentQuestion ||
      !answer.trim() ||
      submitting
    ) {
      return;
    }

    try {
      setSubmitting(true);
      setError("");

      const {
        data: { session: authSession },
        error: authError,
      } = await supabase.auth.getSession();

      if (authError) throw authError;

      if (!authSession) {
        throw new Error(
          "You must be signed in.",
        );
      }

      const response = await fetch(
        "/api/study/answer",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authSession.access_token}`,
          },
          body: JSON.stringify({
            questionId: currentQuestion.id,
            answer,
            responseTimeMs:
              Date.now() -
              questionStartedAt.current,
          }),
        },
      );

      const payload =
        (await response.json()) as
          | ({
              ok: true;
            } & GradeResult)
          | {
              ok?: false;
              error?: string;
            };

      if (
        !response.ok ||
        payload.ok !== true
      ) {
        throw new Error(
          "error" in payload
            ? payload.error ||
                "Could not grade the answer."
            : "Could not grade the answer.",
        );
      }

      const grade = payload as GradeResult & {
        ok: true;
      };

      setResult(grade);

      const newResponse: ResponseRow = {
        question_id: currentQuestion.id,
        topic_id: currentQuestion.topic_id,
        answer_text: answer,
        score: grade.score,
        is_correct: grade.isCorrect,
        feedback: grade.feedback,
        answered_at:
          new Date().toISOString(),
      };

      setResponses((current) => {
        const without = current.filter(
          (item) =>
            item.question_id !==
            currentQuestion.id,
        );

        return [...without, newResponse];
      });

      setAllEvidence((current) => [
        ...current,
        newResponse,
      ]);

      if (session) {
        setSession({
          ...session,
          answered_count:
            grade.session.answeredCount,
          score_percent:
            grade.session.scorePercent,
          status:
            grade.session.complete
              ? "completed"
              : "in_progress",
        });
      }
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Could not submit the answer.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  function nextQuestion() {
    if (!result) return;

    if (
      result.session.complete ||
      currentIndex >= questions.length - 1
    ) {
      setShowSummary(true);
      setResult(null);
      setAnswer("");
      return;
    }

    const answered = new Set([
      ...responses.map(
        (response) => response.question_id,
      ),
      currentQuestion?.id ?? "",
    ]);

    const nextIndex = questions.findIndex(
      (question, index) =>
        index > currentIndex &&
        !answered.has(question.id),
    );

    if (nextIndex === -1) {
      setShowSummary(true);
      return;
    }

    setCurrentIndex(nextIndex);
    setAnswer("");
    setResult(null);
    questionStartedAt.current = Date.now();
  }

  function chooseAnswer(value: string) {
    if (result || submitting) return;
    setAnswer(value);
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#080809] text-white">
        <div className="flex items-center gap-2 text-[12px] text-white/36">
          <Loader2 size={14} className="animate-spin" />
          Loading quiz
        </div>
      </main>
    );
  }

  if (!session || !course) {
    return (
      <main className="min-h-screen bg-[#080809] px-6 py-10 text-white">
        <p className="text-[13px] text-white/46">
          {error || "This study session could not be found."}
        </p>
      </main>
    );
  }

  if (showSummary) {
    const weakest =
      topicSummary.slice(0, 3);

    return (
      <MotionConfig reducedMotion="user">
        <main className="relative min-h-screen overflow-hidden bg-[#080809] text-white">
          <div
            aria-hidden
            className="pointer-events-none fixed inset-0 opacity-[0.13]"
            style={{
              background: `radial-gradient(circle at 50% 10%, ${accent}55 0%, transparent 48%)`,
            }}
          />

          <div className="relative mx-auto max-w-[980px] px-5 pb-20 pt-7 sm:px-8 md:pt-12">
            <button
              type="button"
              onClick={() => router.push("/study")}
              className="flex items-center gap-2 rounded-full border border-white/[0.07] bg-white/[0.02] px-3.5 py-2.5 text-[12px] font-medium text-white/48"
            >
              <ArrowLeft size={14} />
              Study
            </button>

            <div className="mt-14 text-center">
              <div
                className="mx-auto flex h-14 w-14 items-center justify-center rounded-[18px]"
                style={{
                  backgroundColor: `${accent}14`,
                  color: accent,
                }}
              >
                <Trophy size={22} />
              </div>

              <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.15em] text-white/32">
                Session complete
              </p>

              <h1 className="mt-3 text-[48px] font-medium leading-[0.98] tracking-[-0.06em] sm:text-[62px]">
                {scorePercent}%.
              </h1>

              <p className="mx-auto mt-4 max-w-xl text-[14px] leading-6 text-white/40">
                {scorePercent >= 90
                  ? "Excellent work. Your recent evidence is moving in the right direction."
                  : scorePercent >= 75
                    ? "Strong session. A few targeted reps can tighten the weak spots."
                    : scorePercent >= 60
                      ? "Useful practice. Your next session should stay focused on the lowest-prepared topics."
                      : "This gave the app a useful baseline. Target the weak spots now and your preparedness curve can move quickly."}
              </p>
            </div>

            <div className="mx-auto mt-10 grid max-w-[720px] grid-cols-3 gap-2">
              <SummaryMetric
                label="Answered"
                value={String(responses.length)}
              />
              <SummaryMetric
                label="Score"
                value={`${scorePercent}%`}
              />
              <SummaryMetric
                label="Best streak"
                value={String(
                  Math.max(
                    streak,
                    longestStreak(responses),
                  ),
                )}
              />
            </div>

            {topicSummary.length > 0 && (
              <section className="mx-auto mt-12 max-w-[720px]">
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-white/30">
                      Preparedness
                    </p>
                    <h2 className="mt-2 text-[25px] font-medium tracking-[-0.04em]">
                      What changed.
                    </h2>
                  </div>
                </div>

                <div className="mt-5 overflow-hidden rounded-[22px] border border-white/[0.065] bg-[#101012]">
                  {topicSummary.map((item, index) => (
                    <div
                      key={item.topicId}
                      className={`grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_100px] sm:items-center ${
                        index === topicSummary.length - 1
                          ? ""
                          : "border-b border-white/[0.045]"
                      }`}
                    >
                      <div>
                        <p className="text-[12px] font-medium text-white/62">
                          {item.name}
                        </p>
                        <p className="mt-1 text-[10px] text-white/28">
                          {weaknessReason(item.stats)}
                        </p>
                      </div>

                      <div>
                        <div className="flex items-center justify-between text-[9px] text-white/28">
                          <span>Prepared</span>
                          <span>{item.stats.preparedness}%</span>
                        </div>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${item.stats.preparedness}%`,
                              backgroundColor: accent,
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <div className="mx-auto mt-8 flex max-w-[720px] flex-col gap-2 sm:flex-row">
              {weakest.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    router.push(
                      `/study?course=${course.id}&topics=${weakest
                        .map((item) => item.topicId)
                        .join(",")}`,
                    )
                  }
                  className="flex flex-1 items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-[12px] font-medium text-black"
                >
                  <Target size={13} />
                  Study weak spots
                </button>
              )}

              <button
                type="button"
                onClick={() =>
                  router.push(
                    `/study?course=${course.id}`,
                  )
                }
                className="flex flex-1 items-center justify-center gap-2 rounded-full border border-white/[0.08] px-5 py-3 text-[12px] font-medium text-white/52 transition hover:bg-white/[0.03]"
              >
                <RotateCcw size={13} />
                Build another session
              </button>
            </div>
          </div>
        </main>
      </MotionConfig>
    );
  }

  if (!currentQuestion) {
    return (
      <main className="min-h-screen bg-[#080809] px-6 py-10 text-white">
        <p className="text-[13px] text-white/44">
          This quiz does not have any questions.
        </p>
      </main>
    );
  }

  return (
    <MotionConfig reducedMotion="user">
      <main className="relative min-h-screen overflow-hidden bg-[#080809] text-white">
        <div
          aria-hidden
          className="pointer-events-none fixed inset-x-0 top-0 h-[560px] opacity-[0.1]"
          style={{
            background: `radial-gradient(circle at 40% 0%, ${accent}55 0%, transparent 58%)`,
          }}
        />

        <div className="relative mx-auto max-w-[980px] px-5 pb-20 pt-6 sm:px-8 md:pt-9">
          <div className="flex items-center justify-between gap-4">
            <button
              type="button"
              onClick={() => router.push("/study")}
              className="flex items-center gap-2 rounded-full border border-white/[0.07] bg-white/[0.02] px-3.5 py-2.5 text-[12px] font-medium text-white/48"
            >
              <ArrowLeft size={14} />
              Exit
            </button>

            <div className="flex items-center gap-4">
              <div className="hidden items-center gap-2 text-[10px] text-white/30 sm:flex">
                <Flame
                  size={12}
                  style={{
                    color:
                      streak > 0
                        ? accent
                        : undefined,
                  }}
                />
                {streak} streak
              </div>
              <p className="text-[11px] font-medium text-white/40">
                {completedCount + 1} / {questions.length}
              </p>
            </div>
          </div>

          <div className="mt-6 h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
            <motion.div
              animate={{
                width: `${Math.max(
                  progress,
                  ((currentIndex + 1) /
                    Math.max(1, questions.length)) *
                    100 *
                    0.95,
                )}%`,
              }}
              className="h-full rounded-full"
              style={{
                backgroundColor: accent,
              }}
            />
          </div>

          {error && (
            <div className="mt-5 rounded-[17px] border border-red-500/15 bg-red-500/[0.04] px-4 py-3">
              <p className="text-[11px] leading-5 text-red-200/65">
                {error}
              </p>
            </div>
          )}

          <section className="mx-auto mt-12 max-w-[760px]">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="rounded-full px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.1em]"
                style={{
                  backgroundColor: `${accent}12`,
                  color: accent,
                }}
              >
                {currentTopicName}
              </span>

              <span className="rounded-full border border-white/[0.055] px-2.5 py-1 text-[9px] font-medium text-white/28">
                {questionTypeLabel(
                  currentQuestion.question_type,
                )}
              </span>

              <span className="rounded-full border border-white/[0.055] px-2.5 py-1 text-[9px] font-medium text-white/28">
                Difficulty {currentQuestion.difficulty}/3
              </span>
            </div>

            <h1 className="mt-6 text-[28px] font-medium leading-[1.2] tracking-[-0.035em] text-white/82 sm:text-[34px]">
              {currentQuestion.prompt}
            </h1>

            <div className="mt-8">
              {currentQuestion.question_type === "short_answer" ? (
                <textarea
                  value={answer}
                  disabled={Boolean(result)}
                  onChange={(event) =>
                    setAnswer(event.target.value)
                  }
                  rows={6}
                  placeholder="Explain it in your own words…"
                  className="w-full resize-none rounded-[22px] border border-white/[0.075] bg-[#101012] px-5 py-4 text-[14px] leading-6 text-white/72 outline-none placeholder:text-white/20 focus:border-white/[0.13] disabled:opacity-65"
                />
              ) : (
                <div className="grid gap-2">
                  {currentQuestion.choices.map(
                    (choice, index) => {
                      const chosen =
                        answer === choice;
                      const correct =
                        result &&
                        choice ===
                          result.correctAnswer;
                      const wrongChosen =
                        result &&
                        chosen &&
                        !correct;

                      return (
                        <button
                          key={`${choice}-${index}`}
                          type="button"
                          disabled={Boolean(result)}
                          onClick={() =>
                            chooseAnswer(choice)
                          }
                          className={`flex items-center gap-4 rounded-[18px] border px-4 py-4 text-left transition ${
                            correct
                              ? "border-emerald-400/25 bg-emerald-400/[0.06]"
                              : wrongChosen
                                ? "border-red-400/20 bg-red-400/[0.05]"
                                : chosen
                                  ? "border-white/[0.16] bg-white/[0.04]"
                                  : "border-white/[0.06] bg-[#101012] hover:border-white/[0.11] hover:bg-white/[0.018]"
                          }`}
                        >
                          <div
                            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border text-[11px] font-medium ${
                              correct
                                ? "border-emerald-400/20 text-emerald-200"
                                : wrongChosen
                                  ? "border-red-400/20 text-red-200"
                                  : "border-white/[0.07] text-white/34"
                            }`}
                          >
                            {correct ? (
                              <Check size={13} />
                            ) : wrongChosen ? (
                              <X size={13} />
                            ) : (
                              String.fromCharCode(
                                65 + index,
                              )
                            )}
                          </div>
                          <span className="text-[13px] leading-5 text-white/58">
                            {choice}
                          </span>
                        </button>
                      );
                    },
                  )}
                </div>
              )}
            </div>

            {!result ? (
              <button
                type="button"
                disabled={
                  submitting || !answer.trim()
                }
                onClick={() =>
                  void submitAnswer()
                }
                className="mt-7 flex min-w-[150px] items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-[12px] font-medium text-black disabled:cursor-not-allowed disabled:opacity-30"
              >
                {submitting ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <CheckCircle2 size={13} />
                )}
                {submitting
                  ? currentQuestion.question_type ===
                    "short_answer"
                    ? "Checking"
                    : "Submitting"
                  : "Check answer"}
              </button>
            ) : (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className={`mt-7 rounded-[22px] border p-5 ${
                  result.score >= 0.85
                    ? "border-emerald-400/15 bg-emerald-400/[0.035]"
                    : result.score >= 0.45
                      ? "border-amber-300/15 bg-amber-300/[0.03]"
                      : "border-red-400/15 bg-red-400/[0.03]"
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[13px] font-medium text-white/72">
                      {result.score >= 0.85
                        ? "Correct."
                        : result.score >= 0.45
                          ? "Partial credit."
                          : "Not quite."}
                    </p>
                    <p className="mt-2 text-[12px] leading-6 text-white/42">
                      {result.feedback ||
                        result.explanation}
                    </p>
                  </div>

                  <span className="text-[18px] font-medium text-white/66">
                    {Math.round(result.score * 100)}%
                  </span>
                </div>

                {result.score < 0.85 && (
                  <div className="mt-4 border-t border-white/[0.05] pt-4">
                    <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-white/26">
                      Answer
                    </p>
                    <p className="mt-2 text-[12px] leading-5 text-white/52">
                      {result.correctAnswer}
                    </p>
                  </div>
                )}

                {result.preparedness && (
                  <div className="mt-4 flex items-center gap-3 border-t border-white/[0.05] pt-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between text-[9px] text-white/28">
                        <span>{currentTopicName} preparedness</span>
                        <span>
                          {result.preparedness.preparedness}%
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${result.preparedness.preparedness}%`,
                            backgroundColor: accent,
                          }}
                        />
                      </div>
                    </div>

                    {result.preparedness.trend > 5 && (
                      <Sparkles
                        size={13}
                        style={{ color: accent }}
                      />
                    )}
                  </div>
                )}

                {currentQuestion.source_refs.length > 0 && (
                  <div className="mt-5 border-t border-white/[0.05] pt-4">
                    <div className="flex items-start gap-3">
                      <div
                        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px]"
                        style={{
                          backgroundColor: `${accent}10`,
                          color: accent,
                        }}
                      >
                        <FileText size={13} />
                      </div>

                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-medium text-white/58">
                          {result.score >= 0.85
                            ? "Reinforce this with the course material."
                            : "Review these materials before your next rep."}
                        </p>
                        <p className="mt-1 text-[9px] leading-4 text-white/26">
                          These are the sources this question was built from.
                          Open one to review it, or star it for quick access later.
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 space-y-2">
                      {currentQuestion.source_refs
                        .map((source) =>
                          source.fileId
                            ? sourceMaterials[source.fileId]
                            : null,
                        )
                        .filter(
                          (
                            material,
                          ): material is SourceMaterial =>
                            Boolean(material),
                        )
                        .slice(0, 5)
                        .map((material) => (
                          <div
                            key={material.id}
                            className="flex items-center gap-2 rounded-[14px] border border-white/[0.055] bg-black/10 p-2"
                          >
                            <button
                              type="button"
                              onClick={() =>
                                void openSourceMaterial(
                                  material,
                                )
                              }
                              disabled={
                                sourceBusyIds[
                                  material.id
                                ]
                              }
                              className="flex min-w-0 flex-1 items-center gap-3 rounded-[10px] px-2 py-1.5 text-left transition hover:bg-white/[0.025] disabled:opacity-45"
                            >
                              <ExternalLink
                                size={11}
                                className="shrink-0 text-white/24"
                              />
                              <div className="min-w-0">
                                <p className="truncate text-[10px] font-medium text-white/48">
                                  {
                                    material.file_name
                                  }
                                </p>
                                <p className="mt-0.5 text-[8px] capitalize text-white/20">
                                  {material.material_type.replace(
                                    /_/g,
                                    " ",
                                  )}
                                </p>
                              </div>
                            </button>

                            <button
                              type="button"
                              aria-label={
                                material.is_favorite
                                  ? "Remove from favorites"
                                  : "Add to favorites"
                              }
                              onClick={() =>
                                void toggleSourceFavorite(
                                  material,
                                )
                              }
                              disabled={
                                sourceBusyIds[
                                  material.id
                                ]
                              }
                              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/[0.055] text-white/24 transition hover:bg-white/[0.03] hover:text-white/52 disabled:opacity-40"
                              style={
                                material.is_favorite
                                  ? {
                                      color: accent,
                                    }
                                  : undefined
                              }
                            >
                              {sourceBusyIds[
                                material.id
                              ] ? (
                                <Loader2
                                  size={11}
                                  className="animate-spin"
                                />
                              ) : (
                                <Star
                                  size={11}
                                  fill={
                                    material.is_favorite
                                      ? "currentColor"
                                      : "none"
                                  }
                                />
                              )}
                            </button>
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  onClick={nextQuestion}
                  className="mt-5 flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-[11px] font-medium text-black"
                >
                  {result.session.complete
                    ? "See results"
                    : "Next question"}
                  <ChevronRight size={11} />
                </button>
              </motion.div>
            )}

          </section>
        </div>
      </main>
    </MotionConfig>
  );
}

function SummaryMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[17px] border border-white/[0.06] bg-[#101012] p-4 text-center">
      <p className="text-[19px] font-medium text-white/70">
        {value}
      </p>
      <p className="mt-1 text-[9px] font-semibold uppercase tracking-[0.1em] text-white/24">
        {label}
      </p>
    </div>
  );
}

function longestStreak(
  responses: ResponseRow[],
) {
  let best = 0;
  let current = 0;

  for (const response of responses) {
    if (response.score >= 0.85) {
      current += 1;
      best = Math.max(best, current);
    } else {
      current = 0;
    }
  }

  return best;
}