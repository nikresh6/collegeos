"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Bot,
  ChevronRight,
  Loader2,
  Send,
  Target,
  Trophy,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import {
  calculateGradebook,
  type GradeCategoryInput,
  type GradeItemInput,
  type GradeScaleInput,
} from "../../lib/grades";
import {
  calculateGpa,
  calculateTrackedCumulativeGpa,
  goalProgress,
  gradePointFromStoredGrade,
  type GpaCourse,
  type HistoricalGpaCourse,
} from "../../lib/gpa";
import {
  SchoolLandmarkBackdrop,
  SchoolLandmarkLabel,
  SchoolMark,
} from "../../components/school-identity";

type Course = {
  id: string;
  code: string;
  name: string;
  color: string;
  credits: number;
};

type CourseGradeSummary = {
  course: Course;
  categories: GradeCategoryInput[];
  items: GradeItemInput[];
  scale: GradeScaleInput[];
  summary: ReturnType<typeof calculateGradebook>;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export default function GradesPage() {
  const router = useRouter();

  const [courseGrades, setCourseGrades] = useState<
    CourseGradeSummary[]
  >([]);
  const [historicalCourses, setHistoricalCourses] =
    useState<HistoricalGpaCourse[]>([]);
  const [targetGpa, setTargetGpa] = useState(3.7);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    try {
      setLoading(true);
      setLoadError("");

      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) throw sessionError;

      if (!session) {
        router.replace("/onboarding");
        return;
      }

      const [
        { data: profileData, error: profileError },
        { data: activeCourseData, error: activeCourseError },
        { data: archivedCourseData, error: archivedCourseError },
        { data: categoryData, error: categoryError },
        { data: itemData, error: itemError },
        { data: scaleData, error: scaleError },
      ] = await Promise.all([
        supabase
          .from("profiles")
          .select("target_gpa")
          .eq("id", session.user.id)
          .single(),
        supabase
          .from("courses")
          .select("id, code, name, color, credits")
          .is("archived_at", null)
          .order("created_at", { ascending: true }),
        supabase
          .from("courses")
          .select(
            "id, code, name, credits, archived_grade",
          )
          .not("archived_at", "is", null)
          .order("archived_at", { ascending: true }),
        supabase
          .from("grading_categories")
          .select("id, course_id, name, weight_percent"),
        supabase
          .from("course_grade_items")
          .select(
            "id, course_id, category_id, name, points_earned, points_possible",
          ),
        supabase
          .from("course_grade_scale")
          .select(
            "course_id, letter_grade, min_percent, max_percent",
          ),
      ]);

      if (profileError) throw profileError;
      if (activeCourseError) throw activeCourseError;
      if (archivedCourseError) throw archivedCourseError;
      if (categoryError) throw categoryError;
      if (itemError) throw itemError;
      if (scaleError) throw scaleError;

      setTargetGpa(
        Number(profileData?.target_gpa ?? 3.7),
      );

      const results: CourseGradeSummary[] = (
        activeCourseData ?? []
      ).map((course) => {
        const categories: GradeCategoryInput[] = (
          categoryData ?? []
        )
          .filter(
            (category) =>
              category.course_id === course.id,
          )
          .map((category) => ({
            id: category.id,
            name: category.name,
            weight_percent: Number(
              category.weight_percent || 0,
            ),
          }));

        const items: GradeItemInput[] = (
          itemData ?? []
        )
          .filter(
            (item) => item.course_id === course.id,
          )
          .map((item) => ({
            id: item.id,
            category_id: item.category_id,
            name: item.name,
            points_earned: Number(item.points_earned),
            points_possible: Number(item.points_possible),
          }));

        const scale: GradeScaleInput[] = (
          scaleData ?? []
        )
          .filter(
            (row) => row.course_id === course.id,
          )
          .map((row) => ({
            letter_grade: row.letter_grade,
            min_percent:
              row.min_percent === null
                ? null
                : Number(row.min_percent),
            max_percent:
              row.max_percent === null
                ? null
                : Number(row.max_percent),
          }));

        return {
          course: {
            id: course.id,
            code: course.code,
            name: course.name,
            color: course.color,
            credits: Number(course.credits),
          },
          categories,
          items,
          scale,
          summary: calculateGradebook(
            categories,
            items,
            scale,
          ),
        };
      });

      const archived: HistoricalGpaCourse[] = (
        archivedCourseData ?? []
      ).map((course) => {
        const scale: GradeScaleInput[] = (
          scaleData ?? []
        )
          .filter(
            (row) => row.course_id === course.id,
          )
          .map((row) => ({
            letter_grade: row.letter_grade,
            min_percent:
              row.min_percent === null
                ? null
                : Number(row.min_percent),
            max_percent:
              row.max_percent === null
                ? null
                : Number(row.max_percent),
          }));

        return {
          id: course.id,
          code: course.code,
          name: course.name,
          credits: Number(course.credits),
          gradePoints: gradePointFromStoredGrade(
            course.archived_grade,
            scale,
          ),
        };
      });

      setCourseGrades(results);
      setHistoricalCourses(archived);
    } catch (error) {
      console.error("Could not load grades:", error);
      setLoadError(
        error instanceof Error
          ? error.message
          : "Could not load grades.",
      );
    } finally {
      setLoading(false);
    }
  }

  const activeGpaCourses = useMemo<GpaCourse[]>(
    () =>
      courseGrades.map(({ course, summary }) => ({
        id: course.id,
        code: course.code,
        name: course.name,
        credits: course.credits,
        letterGrade: summary.letterGrade,
        currentPercent: summary.currentPercent,
      })),
    [courseGrades],
  );

  const semester = useMemo(
    () => calculateGpa(activeGpaCourses),
    [activeGpaCourses],
  );

  const cumulative = useMemo(
    () =>
      calculateTrackedCumulativeGpa({
        activeCourses: activeGpaCourses,
        historicalCourses,
      }),
    [activeGpaCourses, historicalCourses],
  );

  const goal = useMemo(
    () => goalProgress(semester.gpa, targetGpa),
    [semester.gpa, targetGpa],
  );

  const trackedCount = useMemo(
    () =>
      courseGrades.filter(
        (entry) =>
          entry.summary.currentPercent !== null,
      ).length,
    [courseGrades],
  );

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-[#080809] text-[#F5F5F7]">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-[520px] bg-[radial-gradient(circle_at_30%_0%,rgba(255,255,255,0.045),transparent_58%)]" />

      <div className="relative mx-auto max-w-[1320px] px-4 pb-28 pt-6 sm:px-8 sm:pt-8 md:px-10 md:pt-12 lg:pb-12">
        <button
          type="button"
          onClick={() => router.push("/")}
          className="flex items-center gap-2 rounded-full border border-white/[0.065] bg-white/[0.02] px-3.5 py-2 text-[10px] font-medium text-white/38 transition hover:bg-white/[0.045] hover:text-white/68"
        >
          <ArrowLeft size={13} />
          Home
        </button>

        <header className="relative mt-9 overflow-hidden border-b border-white/[0.065] pb-8 pt-2 sm:mt-12 sm:pb-10">
          <SchoolLandmarkBackdrop
            opacity={0.055}
            align="right"
          />
          <div className="relative z-10 grid gap-8 xl:grid-cols-[1fr_360px] xl:items-end">
            <div>
              <div className="flex items-center gap-3">
                <SchoolMark size={38} quiet />
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-white/28">
                    Grades
                  </p>
                  <SchoolLandmarkLabel className="mt-1" />
                </div>
              </div>

              <h1 className="mt-5 max-w-4xl text-[40px] font-medium leading-[0.97] tracking-[-0.057em] sm:text-[64px]">
                Every course, one scoreboard.
              </h1>

              <p className="mt-5 max-w-2xl text-[15px] leading-7 text-white/36">
                Track course levels, model GPA scenarios, and see which move
                gets you closest to your target.
              </p>
            </div>

            <GpaScoreboard
              currentGpa={semester.gpa}
              cumulativeGpa={cumulative.gpa}
              targetGpa={targetGpa}
              gradedCredits={semester.gradedCredits}
              progress={goal.progress}
              reached={goal.reached}
              gap={goal.gap}
            />
          </div>
        </header>

        {loading ? (
          <div className="mt-10 flex items-center gap-2 text-[10px] text-white/25">
            <Loader2 size={13} className="animate-spin" />
            Loading grades
          </div>
        ) : loadError ? (
          <div className="mt-10 rounded-[22px] border border-red-500/10 bg-red-500/[0.025] p-5">
            <p className="text-[11px] font-medium text-red-200/65">
              Could not load the grade dashboard.
            </p>
            <p className="mt-2 text-[11px] leading-5 text-red-200/42">
              {loadError}
            </p>
          </div>
        ) : (
          <section className="mt-8 grid gap-5 sm:mt-10 sm:gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
            <div>
              <div className="mb-5 flex items-end justify-between gap-5">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-white/24">
                    Active courses
                  </p>
                  <h2 className="mt-2 text-[28px] font-medium tracking-[-0.04em]">
                    Your grade levels
                  </h2>
                </div>

                <p className="text-[12px] text-white/26">
                  {trackedCount}/{courseGrades.length} tracking
                </p>
              </div>

              {courseGrades.length === 0 ? (
                <div className="rounded-[26px] border border-white/[0.06] bg-white/[0.012] p-8">
                  <h2 className="text-[24px] font-medium tracking-[-0.04em]">
                    No active courses.
                  </h2>
                  <p className="mt-3 text-[13px] leading-6 text-white/30">
                    Add a course from Home, then enter a few grades to start
                    building your GPA picture.
                  </p>
                </div>
              ) : (
                <div className="overflow-hidden rounded-[26px] border border-white/[0.065] bg-[#101012]">
                  {courseGrades.map(
                    ({ course, summary }, index) => (
                      <CourseGradeRow
                        key={course.id}
                        course={course}
                        summary={summary}
                        last={
                          index === courseGrades.length - 1
                        }
                        onClick={() =>
                          router.push(
                            `/courses/${course.id}/grades`,
                          )
                        }
                      />
                    ),
                  )}
                </div>
              )}
            </div>

            <aside className="xl:sticky xl:top-8 xl:self-start">
              <GpaCoach
                targetGpa={targetGpa}
                semesterGpa={semester.gpa}
                cumulativeGpa={cumulative.gpa}
                courseGrades={courseGrades}
                historicalCourses={historicalCourses}
              />
            </aside>
          </section>
        )}
      </div>
    </main>
  );
}

function CourseGradeRow({
  course,
  summary,
  last,
  onClick,
}: {
  course: Course;
  summary: ReturnType<typeof calculateGradebook>;
  last: boolean;
  onClick: () => void;
}) {
  const currentPercent = summary.currentPercent;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative grid w-full gap-5 px-5 py-6 text-left transition hover:bg-white/[0.02] sm:px-6 lg:grid-cols-[minmax(0,1fr)_150px_230px_20px] lg:items-center ${
        last ? "" : "border-b border-white/[0.05]"
      }`}
    >
      <div
        className="pointer-events-none absolute bottom-0 left-0 top-0 w-[2px] opacity-80"
        style={{ backgroundColor: course.color }}
      />

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2.5">
          <p
            className="text-[11px] font-semibold uppercase tracking-[0.13em]"
            style={{ color: course.color }}
          >
            {course.code}
          </p>

          <span className="text-[11px] text-white/22">
            {course.credits} credits
          </span>
        </div>

        <h3 className="mt-2 truncate text-[18px] font-medium tracking-[-0.025em] text-white/76 transition group-hover:text-white/92">
          {course.name}
        </h3>
      </div>

      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/20">
          Current
        </p>
        <div className="mt-1.5 flex items-baseline gap-2">
          <p className="text-[34px] font-medium leading-none tracking-[-0.055em] text-white/84">
            {summary.letterGrade ?? "--"}
          </p>
          <p className="text-[13px] font-medium text-white/30">
            {currentPercent === null
              ? "--"
              : `${currentPercent.toFixed(1)}%`}
          </p>
        </div>
      </div>

      <div>
        {summary.nextLevel ? (
          <>
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] font-medium text-white/36">
                Next:{" "}
                <span
                  className="font-semibold"
                  style={{ color: course.color }}
                >
                  {summary.nextLevel.letterGrade}
                </span>
              </p>

              <p className="text-[11px] text-white/26">
                {summary.pointsToNextLevel?.toFixed(1)} pts away
              </p>
            </div>

            <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/[0.05]">
              <div
                className="h-full rounded-full transition-[width] duration-500"
                style={{
                  width: `${Math.max(
                    3,
                    summary.levelProgress * 100,
                  )}%`,
                  backgroundColor: course.color,
                }}
              />
            </div>
          </>
        ) : currentPercent !== null &&
          summary.letterGrade ? (
          <div className="flex items-center gap-2">
            <Trophy
              size={14}
              style={{ color: course.color }}
            />
            <p className="text-[12px] font-medium text-white/40">
              Highest configured level
            </p>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Target size={14} className="text-white/22" />
            <p className="text-[12px] text-white/30">
              Add grades to start tracking
            </p>
          </div>
        )}
      </div>

      <ChevronRight
        size={16}
        className="hidden text-white/14 transition group-hover:translate-x-0.5 group-hover:text-white/42 lg:block"
      />
    </button>
  );
}

function GpaScoreboard({
  currentGpa,
  cumulativeGpa,
  targetGpa,
  gradedCredits,
  progress,
  reached,
  gap,
}: {
  currentGpa: number | null;
  cumulativeGpa: number | null;
  targetGpa: number;
  gradedCredits: number;
  progress: number;
  reached: boolean;
  gap: number | null;
}) {
  return (
    <div className="rounded-[24px] border border-white/[0.07] bg-white/[0.016] p-5">
      <div className="flex items-start justify-between gap-5">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/20">
            Semester GPA
          </p>

          <div className="mt-2 flex items-end gap-2">
            <p className="text-[46px] font-medium leading-none tracking-[-0.06em] text-white/82">
              {currentGpa === null
                ? "--"
                : currentGpa.toFixed(2)}
            </p>
            <p className="pb-1 text-[11px] text-white/26">
              / {targetGpa.toFixed(2)}
            </p>
          </div>
        </div>

        <div className="text-right">
          <p className="text-[10px] uppercase tracking-[0.11em] text-white/16">
            Tracked cumulative
          </p>
          <p className="mt-1.5 text-[15px] font-medium text-white/48">
            {cumulativeGpa === null
              ? "--"
              : cumulativeGpa.toFixed(2)}
          </p>
        </div>
      </div>

      <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/[0.05]">
        <div
          className="h-full rounded-full bg-white/75 transition-[width] duration-500"
          style={{
            width: `${
              currentGpa === null
                ? 0
                : Math.max(3, progress * 100)
            }%`,
          }}
        />
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 text-[11px]">
        <span className="text-white/18">
          {gradedCredits > 0
            ? `${gradedCredits} graded credits`
            : "No graded courses yet"}
        </span>

        <span
          className={
            reached
              ? "text-white/52"
              : "text-white/25"
          }
        >
          {currentGpa === null
            ? "Start tracking"
            : reached
              ? "Goal reached"
              : `${gap?.toFixed(2)} to goal`}
        </span>
      </div>
    </div>
  );
}

function GpaCoach({
  targetGpa,
  semesterGpa,
  cumulativeGpa,
  courseGrades,
  historicalCourses,
}: {
  targetGpa: number;
  semesterGpa: number | null;
  cumulativeGpa: number | null;
  courseGrades: CourseGradeSummary[];
  historicalCourses: HistoricalGpaCourse[];
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "Ask me about your GPA across classes. I can model course letter-grade changes, finals, your distance from your target, and which class has the most leverage.",
    },
  ]);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  const quickPrompts = [
    "How close am I to my GPA goal?",
    "Which course has the most GPA leverage?",
    courseGrades[0]
      ? `If ${courseGrades[0].course.code} became an A, what happens to my GPA?`
      : "What should I improve first?",
  ];

  async function sendMessage(text?: string) {
    const nextMessage = (text ?? message).trim();

    if (!nextMessage || sending) return;

    const userMessage: ChatMessage = {
      role: "user",
      content: nextMessage,
    };

    setMessages((current) => [
      ...current,
      userMessage,
    ]);
    setMessage("");
    setSending(true);

    try {
      const response = await fetch("/api/gpa-chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: nextMessage,
          history: messages,
          context: {
            targetGpa,
            activeCourses: courseGrades.map(
              ({ course, categories, items, scale, summary }) => ({
                id: course.id,
                code: course.code,
                name: course.name,
                credits: course.credits,
                letterGrade: summary.letterGrade,
                currentPercent:
                  summary.currentPercent,
                color: course.color,
                categories,
                items,
                scale,
              }),
            ),
            historicalCourses,
          },
        }),
      });

      const payload = (await response.json()) as {
        ok?: boolean;
        answer?: string;
        error?: string;
      };

      if (
        !response.ok ||
        payload.ok !== true
      ) {
        throw new Error(
          payload.error ||
            "GPA Coach could not answer.",
        );
      }

      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content:
            payload.answer ||
            "I could not calculate that scenario.",
        },
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content:
            error instanceof Error
              ? error.message
              : "GPA Coach could not answer.",
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-[26px] border border-white/[0.075] bg-[#111113]">
      <div className="border-b border-white/[0.055] p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px] bg-white/[0.035] text-white/42">
            <Bot size={16} />
          </div>

          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-white/22">
              GPA Coach
            </p>
            <h2 className="mt-1.5 text-[22px] font-medium tracking-[-0.035em]">
              Ask the whole semester.
            </h2>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <CoachStat
            label="Semester"
            value={
              semesterGpa === null
                ? "--"
                : semesterGpa.toFixed(2)
            }
          />
          <CoachStat
            label="Cumulative"
            value={
              cumulativeGpa === null
                ? "--"
                : cumulativeGpa.toFixed(2)
            }
          />
        </div>
      </div>

      <div className="max-h-[460px] space-y-3 overflow-y-auto p-5">
        {messages.map((entry, index) => (
          <div
            key={`${entry.role}-${index}`}
            className={`flex ${
              entry.role === "user"
                ? "justify-end"
                : "justify-start"
            }`}
          >
            <div
              className={`max-w-[90%] rounded-[16px] px-3.5 py-3 text-[12px] leading-6 ${
                entry.role === "user"
                  ? "bg-white text-black"
                  : "border border-white/[0.055] bg-white/[0.012] text-white/38"
              }`}
            >
              {entry.content}
            </div>
          </div>
        ))}

        {sending && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-[16px] border border-white/[0.055] bg-white/[0.012] px-3.5 py-3 text-[11px] text-white/30">
              <Loader2
                size={11}
                className="animate-spin"
              />
              Modeling
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-white/[0.05] p-4">
        <div className="mb-3 flex flex-wrap gap-1.5">
          {quickPrompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() =>
                void sendMessage(prompt)
              }
              className="rounded-full border border-white/[0.055] bg-white/[0.01] px-2.5 py-1.5 text-[10px] text-white/30 transition hover:bg-white/[0.03] hover:text-white/50"
            >
              {prompt}
            </button>
          ))}
        </div>

        <div className="flex items-end gap-2 rounded-[16px] border border-white/[0.065] bg-white/[0.015] p-2">
          <textarea
            value={message}
            onChange={(event) =>
              setMessage(event.target.value)
            }
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey
              ) {
                event.preventDefault();
                void sendMessage();
              }
            }}
            rows={2}
            placeholder='Try: "If MATH 2500 got up to an A, how much closer would I be to my goal?"'
            className="min-h-[48px] flex-1 resize-none bg-transparent px-2 py-1.5 text-[12px] leading-6 text-white/55 outline-none placeholder:text-white/16"
          />

          <button
            type="button"
            onClick={() =>
              void sendMessage()
            }
            disabled={
              !message.trim() || sending
            }
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-black transition disabled:opacity-25"
          >
            <Send size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}

function CoachStat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[13px] border border-white/[0.05] bg-white/[0.01] px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.11em] text-white/16">
        {label}
      </p>
      <p className="mt-1 text-[16px] font-medium text-white/58">
        {value}
      </p>
    </div>
  );
}
