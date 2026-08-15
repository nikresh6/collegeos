"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Check,
  Gauge,
  Loader2,
  Sparkles,
  Timer,
  X,
} from "lucide-react";
import {
  AnimatePresence,
  motion,
} from "framer-motion";
import { supabase } from "../lib/supabase";

type AssessmentKind =
  | "exam"
  | "quiz"
  | "homework"
  | "assignment"
  | "project"
  | "paper"
  | "attendance"
  | "participation"
  | "other";

type GradeCandidate = {
  id: string;
  user_id: string;
  course_id: string;
  category_id: string | null;
  name: string;
  points_earned: number;
  points_possible: number;
  created_at: string;
};

type FeedbackTarget = GradeCandidate & {
  courseCode: string;
  courseName: string;
  courseColor: string;
  categoryName: string;
  kind: AssessmentKind;
};

const RECOVERY_WINDOW_MS = 20 * 60 * 1000;

function clamp(
  value: number,
  minimum: number,
  maximum: number,
) {
  return Math.max(
    minimum,
    Math.min(maximum, value),
  );
}

function numberFrom(
  value: unknown,
  fallback = 0,
) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? parsed
    : fallback;
}

function stringFrom(
  value: unknown,
) {
  return typeof value === "string"
    ? value
    : "";
}

function gradeFromRecord(
  value: Record<string, unknown>,
): GradeCandidate | null {
  const id = stringFrom(value.id);
  const userId = stringFrom(
    value.user_id,
  );
  const courseId = stringFrom(
    value.course_id,
  );
  const name = stringFrom(
    value.name,
  );
  const possible = numberFrom(
    value.points_possible,
  );

  if (
    !id ||
    !userId ||
    !courseId ||
    !name ||
    possible <= 0
  ) {
    return null;
  }

  return {
    id,
    user_id: userId,
    course_id: courseId,
    category_id:
      typeof value.category_id ===
        "string"
        ? value.category_id
        : null,
    name,
    points_earned: numberFrom(
      value.points_earned,
    ),
    points_possible: possible,
    created_at:
      stringFrom(
        value.created_at,
      ) ||
      new Date().toISOString(),
  };
}

function inferAssessmentKind(
  name: string,
  categoryName: string,
): AssessmentKind {
  const text =
    `${categoryName} ${name}`.toLowerCase();

  if (
    /\b(midterm|final|exam|test)\b/.test(
      text,
    )
  ) {
    return "exam";
  }

  if (/\bquiz\b/.test(text)) {
    return "quiz";
  }

  if (
    /\b(attendance|presence)\b/.test(
      text,
    )
  ) {
    return "attendance";
  }

  if (
    /\b(participation|discussion)\b/.test(
      text,
    )
  ) {
    return "participation";
  }

  if (
    /\b(homework|hw|problem set|pset|worksheet)\b/.test(
      text,
    )
  ) {
    return "homework";
  }

  if (
    /\b(project|presentation)\b/.test(
      text,
    )
  ) {
    return "project";
  }

  if (
    /\b(paper|essay|report)\b/.test(
      text,
    )
  ) {
    return "paper";
  }

  if (
    /\b(assignment|lab|writeup)\b/.test(
      text,
    )
  ) {
    return "assignment";
  }

  return "other";
}

function kindLabel(
  kind: AssessmentKind,
) {
  if (kind === "exam") return "exam";
  if (kind === "quiz") return "quiz";
  if (kind === "homework")
    return "homework";
  if (kind === "assignment")
    return "assignment";
  if (kind === "project")
    return "project";
  if (kind === "paper") return "paper";
  if (kind === "attendance")
    return "attendance";
  if (kind === "participation")
    return "participation";
  return "graded item";
}

function scorePercent(
  target: FeedbackTarget,
) {
  return (
    (target.points_earned /
      target.points_possible) *
    100
  );
}

export function AssessmentFeedbackPrompt() {
  const [
    userId,
    setUserId,
  ] = useState<string | null>(
    null,
  );
  const [
    queue,
    setQueue,
  ] = useState<FeedbackTarget[]>(
    [],
  );
  const queuedIds =
    useRef<Set<string>>(
      new Set(),
    );
  const checking =
    useRef(false);

  const active =
    queue[0] ?? null;

  const removeActive =
    useCallback(() => {
      setQueue((current) => {
        const [
          first,
          ...rest
        ] = current;

        if (first) {
          queuedIds.current.delete(
            first.id,
          );
        }

        return rest;
      });
    }, []);

  const hydrateTarget =
    useCallback(
      async (
        grade: GradeCandidate,
      ) => {
        if (
          queuedIds.current.has(
            grade.id,
          )
        ) {
          return;
        }

        const {
          data:
            existingFeedback,
          error:
            feedbackError,
        } = await supabase
          .from(
            "assessment_feedback",
          )
          .select("id")
          .eq(
            "grade_item_id",
            grade.id,
          )
          .maybeSingle();

        if (feedbackError) {
          console.error(
            "Could not check grade reflection:",
            feedbackError,
          );
          return;
        }

        if (existingFeedback) {
          return;
        }

        const [
          {
            data: course,
            error:
              courseError,
          },
          categoryResult,
        ] =
          await Promise.all([
            supabase
              .from("courses")
              .select(
                "code, name, color",
              )
              .eq(
                "id",
                grade.course_id,
              )
              .single(),
            grade.category_id
              ? supabase
                  .from(
                    "grading_categories",
                  )
                  .select("name")
                  .eq(
                    "id",
                    grade.category_id,
                  )
                  .maybeSingle()
              : Promise.resolve({
                  data: null,
                  error: null,
                }),
          ]);

        if (courseError) {
          console.error(
            "Could not load grade reflection course:",
            courseError,
          );
          return;
        }

        if (
          categoryResult.error
        ) {
          console.error(
            "Could not load grade reflection category:",
            categoryResult.error,
          );
        }

        const categoryName =
          categoryResult.data
            ?.name ?? "";

        queuedIds.current.add(
          grade.id,
        );

        setQueue((current) => [
          ...current,
          {
            ...grade,
            courseCode:
              course.code,
            courseName:
              course.name,
            courseColor:
              course.color ||
              "#CFAE70",
            categoryName,
            kind:
              inferAssessmentKind(
                grade.name,
                categoryName,
              ),
          },
        ]);
      },
      [],
    );

  const recoverRecent =
    useCallback(async () => {
      if (
        !userId ||
        checking.current
      ) {
        return;
      }

      checking.current = true;

      try {
        const since =
          new Date(
            Date.now() -
              RECOVERY_WINDOW_MS,
          ).toISOString();

        const {
          data,
          error,
        } = await supabase
          .from(
            "course_grade_items",
          )
          .select(
            "id, user_id, course_id, category_id, name, points_earned, points_possible, created_at",
          )
          .eq(
            "user_id",
            userId,
          )
          .gte(
            "created_at",
            since,
          )
          .order(
            "created_at",
            {
              ascending: true,
            },
          )
          .limit(8);

        if (error) {
          throw error;
        }

        for (
          const row of data ?? []
        ) {
          const grade =
            gradeFromRecord(
              row as Record<
                string,
                unknown
              >,
            );

          if (grade) {
            await hydrateTarget(
              grade,
            );
          }
        }
      } catch (error) {
        console.error(
          "Could not recover grade reflections:",
          error,
        );
      } finally {
        checking.current = false;
      }
    }, [
      hydrateTarget,
      userId,
    ]);

  useEffect(() => {
    let mounted = true;

    async function start() {
      const {
        data: {
          user,
        },
      } =
        await supabase.auth.getUser();

      if (
        !mounted ||
        !user
      ) {
        return;
      }

      setUserId(user.id);
    }

    void start();

    const {
      data: authListener,
    } =
      supabase.auth.onAuthStateChange(
        (_event, session) => {
          if (!mounted) return;

          setUserId(
            session?.user.id ??
              null,
          );

          if (!session?.user) {
            setQueue([]);
            queuedIds.current.clear();
          }
        },
      );

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!userId) {
      return;
    }

    void recoverRecent();

    const channel =
      supabase
        .channel(
          `assessment-feedback-${userId}`,
        )
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table:
              "course_grade_items",
            filter:
              `user_id=eq.${userId}`,
          },
          (payload) => {
            const grade =
              gradeFromRecord(
                payload.new as Record<
                  string,
                  unknown
                >,
              );

            if (grade) {
              void hydrateTarget(
                grade,
              );
            }
          },
        )
        .subscribe();

    const interval =
      window.setInterval(
        () => {
          if (
            document.visibilityState ===
            "visible"
          ) {
            void recoverRecent();
          }
        },
        6000,
      );

    const onFocus = () => {
      void recoverRecent();
    };

    window.addEventListener(
      "focus",
      onFocus,
    );

    return () => {
      window.clearInterval(
        interval,
      );
      window.removeEventListener(
        "focus",
        onFocus,
      );
      void supabase.removeChannel(
        channel,
      );
    };
  }, [
    hydrateTarget,
    recoverRecent,
    userId,
  ]);

  return (
    <AnimatePresence>
      {active && (
        <AssessmentReflection
          key={active.id}
          target={active}
          onDone={
            removeActive
          }
        />
      )}
    </AnimatePresence>
  );
}

function AssessmentReflection({
  target,
  onDone,
}: {
  target: FeedbackTarget;
  onDone: () => void;
}) {
  const [
    preparedness,
    setPreparedness,
  ] = useState(70);
  const [
    difficulty,
    setDifficulty,
  ] = useState(55);
  const [
    similarity,
    setSimilarity,
  ] = useState(55);
  const [
    usedPractice,
    setUsedPractice,
  ] = useState(true);
  const [
    helpfulness,
    setHelpfulness,
  ] = useState(60);
  const [
    usedCollegeOsHelp,
    setUsedCollegeOsHelp,
  ] = useState(true);
  const [
    studyHours,
    setStudyHours,
  ] = useState("");
  const [
    notes,
    setNotes,
  ] = useState("");
  const [
    saving,
    setSaving,
  ] = useState(false);
  const [
    error,
    setError,
  ] = useState("");
  const [
    saved,
    setSaved,
  ] = useState(false);
  const [
    showAttendanceSurvey,
    setShowAttendanceSurvey,
  ] = useState(false);

  const lowSignalKind =
    target.kind ===
      "attendance" ||
    target.kind ===
      "participation";

  const showPracticeMatch =
    target.kind === "exam" ||
    target.kind === "quiz";

  const showHelpfulness =
    !showPracticeMatch &&
    !lowSignalKind;

  const score =
    useMemo(
      () =>
        scorePercent(
          target,
        ),
      [target],
    );

  async function saveFeedback(
    status:
      | "completed"
      | "skipped",
  ) {
    if (saving) return;

    try {
      setSaving(true);
      setError("");

      const {
        data: {
          user,
        },
        error: userError,
      } =
        await supabase.auth.getUser();

      if (userError) {
        throw userError;
      }

      if (!user) {
        throw new Error(
          "You are not signed in.",
        );
      }

      const parsedHours =
        studyHours.trim()
          ? Number(
              studyHours,
            )
          : null;

      if (
        parsedHours !== null &&
        (
          !Number.isFinite(
            parsedHours,
          ) ||
          parsedHours < 0 ||
          parsedHours > 250
        )
      ) {
        setError(
          "Enter a realistic number of study hours, or leave it blank.",
        );
        return;
      }

      const {
        error:
          saveError,
      } = await supabase
        .from(
          "assessment_feedback",
        )
        .upsert(
          {
            user_id:
              user.id,
            course_id:
              target.course_id,
            grade_item_id:
              target.id,
            category_id:
              target.category_id,
            assessment_kind:
              target.kind,
            score_percent:
              Number(
                score.toFixed(2),
              ),
            preparedness_percent:
              status ===
              "completed"
                ? preparedness
                : null,
            difficulty_percent:
              status ===
              "completed"
                ? difficulty
                : null,
            quiz_similarity_percent:
              status ===
                "completed" &&
              showPracticeMatch &&
              usedPractice
                ? similarity
                : null,
            assistant_helpfulness_percent:
              status ===
                "completed" &&
              showHelpfulness &&
              usedCollegeOsHelp
                ? helpfulness
                : null,
            study_hours:
              status ===
              "completed"
                ? parsedHours
                : null,
            difference_notes:
              status ===
                "completed" &&
              notes.trim()
                ? notes
                    .trim()
                    .slice(
                      0,
                      900,
                    )
                : null,
            response_status:
              status,
            updated_at:
              new Date().toISOString(),
          },
          {
            onConflict:
              "user_id,grade_item_id",
          },
        );

      if (saveError) {
        throw saveError;
      }

      setSaved(true);

      window.setTimeout(
        onDone,
        650,
      );
    } catch (
      saveError
    ) {
      setError(
        saveError instanceof
          Error
          ? saveError.message
          : "Could not save this reflection.",
      );
    } finally {
      setSaving(false);
    }
  }

  const attendanceGate =
    lowSignalKind &&
    !showAttendanceSurvey;

  return (
    <motion.div
      initial={{
        opacity: 0,
      }}
      animate={{
        opacity: 1,
      }}
      exit={{
        opacity: 0,
      }}
      className="fixed inset-0 z-[600] flex items-end justify-center bg-black/72 px-0 backdrop-blur-xl sm:items-center sm:px-5 sm:py-8"
    >
      <motion.div
        initial={{
          opacity: 0,
          y: 24,
          scale: 0.985,
        }}
        animate={{
          opacity: 1,
          y: 0,
          scale: 1,
        }}
        exit={{
          opacity: 0,
          y: 14,
          scale: 0.99,
        }}
        transition={{
          duration: 0.3,
          ease: [
            0.22,
            1,
            0.36,
            1,
          ],
        }}
        className="relative max-h-[92dvh] w-full overflow-y-auto rounded-t-[28px] border border-white/[0.08] bg-[#111113] shadow-[0_30px_100px_rgba(0,0,0,0.65)] sm:max-w-[620px] sm:rounded-[28px]"
      >
        <div
          className="h-[2px] w-full"
          style={{
            background: `linear-gradient(90deg, transparent, ${target.courseColor}, transparent)`,
          }}
        />

        <div className="p-5 sm:p-6">
          <div className="flex items-start gap-4">
            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px]"
              style={{
                backgroundColor:
                  `${target.courseColor}12`,
                color:
                  target.courseColor,
              }}
            >
              <Sparkles
                size={17}
              />
            </div>

            <div className="min-w-0 flex-1">
              <p
                className="text-[10px] font-semibold uppercase tracking-[0.14em]"
                style={{
                  color:
                    target.courseColor,
                }}
              >
                Learn from this grade
              </p>
              <h2 className="mt-1.5 text-[24px] font-medium tracking-[-0.04em] text-white/90">
                {target.name}
              </h2>
              <p className="mt-1 text-[11px] text-white/38">
                {target.courseCode}
                {target.categoryName
                  ? ` · ${target.categoryName}`
                  : ""}
                {" · "}
                {score.toFixed(
                  1,
                )}
                %
              </p>
            </div>

            <button
              type="button"
              onClick={() =>
                void saveFeedback(
                  "skipped",
                )
              }
              disabled={saving}
              aria-label="Skip reflection"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/28 transition hover:bg-white/[0.045] hover:text-white/60"
            >
              <X size={13} />
            </button>
          </div>

          {saved ? (
            <div className="mt-7 rounded-[20px] border border-emerald-300/10 bg-emerald-300/[0.025] p-5">
              <div className="flex items-center gap-2 text-[12px] font-medium text-emerald-100/75">
                <Check
                  size={13}
                />
                Learning updated
              </div>
              <p className="mt-2 text-[11px] leading-5 text-white/38">
                Future practice and study planning can now use what this grade taught CollegeOS about you.
              </p>
            </div>
          ) : attendanceGate ? (
            <div className="mt-7">
              <div className="rounded-[20px] border border-white/[0.055] bg-white/[0.012] p-5">
                <p className="text-[13px] font-medium text-white/72">
                  This looks like {kindLabel(
                    target.kind,
                  )}.
                </p>
                <p className="mt-2 text-[11px] leading-5 text-white/38">
                  There probably is not much useful study signal here, so you can skip it in one tap.
                </p>
              </div>

              <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() =>
                    setShowAttendanceSurvey(
                      true,
                    )
                  }
                  className="rounded-full border border-white/[0.07] px-4 py-2.5 text-[11px] font-medium text-white/50 transition hover:bg-white/[0.035] hover:text-white/72"
                >
                  Add feedback anyway
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void saveFeedback(
                      "skipped",
                    )
                  }
                  disabled={
                    saving
                  }
                  className="rounded-full bg-white px-4 py-2.5 text-[11px] font-medium text-black disabled:opacity-50"
                >
                  Skip this grade
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="mt-6 rounded-[18px] border border-white/[0.055] bg-white/[0.01] px-4 py-3">
                <p className="text-[11px] leading-5 text-white/40">
                  About 60 seconds. Your answers calibrate quiz difficulty and how aggressively CollegeOS plans study time.
                </p>
              </div>

              <div className="mt-6 space-y-6">
                <SliderQuestion
                  icon={Gauge}
                  label="How prepared did you feel?"
                  value={
                    preparedness
                  }
                  onChange={
                    setPreparedness
                  }
                  low="Not ready"
                  high="Completely ready"
                  color={
                    target.courseColor
                  }
                />

                <SliderQuestion
                  icon={Gauge}
                  label={`How hard was the ${kindLabel(
                    target.kind,
                  )}?`}
                  value={
                    difficulty
                  }
                  onChange={
                    setDifficulty
                  }
                  low="Very easy"
                  high="Extremely hard"
                  color={
                    target.courseColor
                  }
                />

                {showPracticeMatch && (
                  <div>
                    {usedPractice ? (
                      <SliderQuestion
                        icon={
                          Sparkles
                        }
                        label="How much did CollegeOS practice match the real assessment?"
                        value={
                          similarity
                        }
                        onChange={
                          setSimilarity
                        }
                        low="Very different"
                        high="Almost identical"
                        color={
                          target.courseColor
                        }
                      />
                    ) : (
                      <div className="rounded-[16px] border border-white/[0.055] bg-white/[0.01] px-4 py-3 text-[10px] text-white/34">
                        Practice-match feedback will be left out because you did not use CollegeOS practice for this assessment.
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        setUsedPractice(
                          (current) =>
                            !current,
                        )
                      }
                      className="mt-2 text-[9px] font-medium text-white/30 transition hover:text-white/55"
                    >
                      {usedPractice
                        ? "I didn't use CollegeOS practice"
                        : "I did use CollegeOS practice"}
                    </button>
                  </div>
                )}

                {showHelpfulness && (
                  <div>
                    {usedCollegeOsHelp ? (
                      <SliderQuestion
                        icon={
                          Sparkles
                        }
                        label="How much did CollegeOS help with this?"
                        value={
                          helpfulness
                        }
                        onChange={
                          setHelpfulness
                        }
                        low="Not much"
                        high="A lot"
                        color={
                          target.courseColor
                        }
                      />
                    ) : (
                      <div className="rounded-[16px] border border-white/[0.055] bg-white/[0.01] px-4 py-3 text-[10px] text-white/34">
                        Helpfulness feedback will be left out because you did not use CollegeOS for this work.
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        setUsedCollegeOsHelp(
                          (current) =>
                            !current,
                        )
                      }
                      className="mt-2 text-[9px] font-medium text-white/30 transition hover:text-white/55"
                    >
                      {usedCollegeOsHelp
                        ? "I didn't use CollegeOS for this"
                        : "I did use CollegeOS for this"}
                    </button>
                  </div>
                )}

                <label className="block">
                  <span className="flex items-center gap-2 text-[11px] font-medium text-white/52">
                    <Timer
                      size={12}
                    />
                    About how many total hours did you study for this?
                  </span>
                  <div className="mt-2 flex items-center gap-3">
                    <input
                      value={
                        studyHours
                      }
                      onChange={(
                        event,
                      ) =>
                        setStudyHours(
                          event.target
                            .value,
                        )
                      }
                      inputMode="decimal"
                      placeholder="e.g. 4.5"
                      className="w-32 rounded-[13px] border border-white/[0.065] bg-white/[0.02] px-3.5 py-3 text-[12px] text-white/72 outline-none transition placeholder:text-white/20 focus:border-white/[0.13]"
                    />
                    <span className="text-[10px] text-white/30">
                      hours
                    </span>
                  </div>
                </label>

                <label className="block">
                  <span className="text-[11px] font-medium text-white/52">
                    {showPracticeMatch
                      ? "What was different from the practice?"
                      : "Anything CollegeOS should learn from this?"}
                  </span>
                  <textarea
                    value={notes}
                    onChange={(
                      event,
                    ) =>
                      setNotes(
                        event.target.value,
                      )
                    }
                    rows={3}
                    maxLength={900}
                    placeholder={
                      showPracticeMatch
                        ? "Optional: more application questions, trickier wording, different emphasis..."
                        : "Optional: what helped, what did not, or what you would change next time..."
                    }
                    className="mt-2 w-full resize-none rounded-[15px] border border-white/[0.065] bg-white/[0.02] px-3.5 py-3 text-[12px] leading-5 text-white/65 outline-none transition placeholder:text-white/18 focus:border-white/[0.13]"
                  />
                </label>
              </div>

              {error && (
                <p className="mt-4 text-[11px] text-red-300/70">
                  {error}
                </p>
              )}

              <div className="mt-7 flex flex-col-reverse gap-2 border-t border-white/[0.055] pt-5 sm:flex-row sm:items-center sm:justify-between">
                <button
                  type="button"
                  onClick={() =>
                    void saveFeedback(
                      "skipped",
                    )
                  }
                  disabled={
                    saving
                  }
                  className="rounded-full px-3 py-2.5 text-[11px] font-medium text-white/34 transition hover:bg-white/[0.03] hover:text-white/58"
                >
                  Skip
                </button>

                <button
                  type="button"
                  onClick={() =>
                    void saveFeedback(
                      "completed",
                    )
                  }
                  disabled={
                    saving
                  }
                  className="flex items-center justify-center gap-2 rounded-full bg-white px-5 py-2.5 text-[11px] font-medium text-black transition hover:bg-white/90 disabled:opacity-50"
                >
                  {saving ? (
                    <Loader2
                      size={11}
                      className="animate-spin"
                    />
                  ) : (
                    <Check
                      size={11}
                    />
                  )}
                  {saving
                    ? "Saving"
                    : "Teach CollegeOS"}
                </button>
              </div>
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

function SliderQuestion({
  icon: Icon,
  label,
  value,
  onChange,
  low,
  high,
  color,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  onChange: (
    value: number,
  ) => void;
  low: string;
  high: string;
  color: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <span className="flex items-center gap-2 text-[11px] font-medium text-white/52">
          <Icon size={12} />
          {label}
        </span>
        <span
          className="text-[13px] font-semibold tabular-nums"
          style={{
            color,
          }}
        >
          {value}%
        </span>
      </div>

      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        onChange={(event) =>
          onChange(
            clamp(
              Number(
                event.target
                  .value,
              ),
              0,
              100,
            ),
          )
        }
        className="mt-3 h-1.5 w-full cursor-pointer"
        style={{
          accentColor: color,
        }}
      />

      <div className="mt-2 flex items-center justify-between text-[9px] text-white/25">
        <span>{low}</span>
        <span>{high}</span>
      </div>
    </div>
  );
}
