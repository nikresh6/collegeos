"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArrowLeft,
  Loader2,
  RotateCcw,
  TrendingUp,
} from "lucide-react";
import { supabase } from "../../lib/supabase";

type ArchivedCourse = {
  id: string;
  code: string;
  name: string;
  professor: string;
  color: string;
  archived_at: string;
  archived_grade: string;
};

export default function ArchivedCoursesPage() {
  const router = useRouter();
  const [courses, setCourses] = useState<ArchivedCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  useEffect(() => {
    void loadArchivedCourses();
  }, []);

  async function loadArchivedCourses() {
    try {
      setLoading(true);

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.replace("/onboarding");
        return;
      }

      const { data, error } = await supabase
        .from("courses")
        .select(
          "id, code, name, professor, color, archived_at, archived_grade",
        )
        .not("archived_at", "is", null)
        .order("archived_at", { ascending: false });

      if (error) throw error;

      setCourses(
        (data ?? []).map((course) => ({
          id: course.id,
          code: course.code,
          name: course.name,
          professor: course.professor ?? "",
          color: course.color,
          archived_at: course.archived_at,
          archived_grade:
            course.archived_grade || "Not calculated",
        })),
      );
    } catch (error) {
      console.error("Could not load archived courses:", error);
    } finally {
      setLoading(false);
    }
  }

  async function restoreCourse(courseId: string) {
    try {
      setRestoringId(courseId);

      const { error } = await supabase
        .from("courses")
        .update({
          archived_at: null,
          archived_grade: null,
        })
        .eq("id", courseId);

      if (error) throw error;

      setCourses((current) =>
        current.filter((course) => course.id !== courseId),
      );
    } catch (error) {
      console.error("Could not restore course:", error);
      alert("Could not restore this course.");
    } finally {
      setRestoringId(null);
    }
  }

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-[#080809] text-[#F5F5F7]">
      <div className="pointer-events-none fixed left-[20%] top-[-340px] h-[620px] w-[760px] rounded-full bg-white/[0.015] blur-[150px]" />

      <div className="relative mx-auto max-w-[1180px] px-5 py-8 sm:px-8 md:px-10 md:py-12">
        <button
          type="button"
          onClick={() => router.push("/")}
          className="flex items-center gap-2 rounded-full border border-white/[0.065] bg-white/[0.02] px-3.5 py-2 text-[10px] font-medium text-white/38 transition hover:bg-white/[0.045] hover:text-white/68"
        >
          <ArrowLeft size={13} />
          Back to courses
        </button>

        <header className="mt-12 max-w-3xl border-b border-white/[0.065] pb-10">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-[10px] border border-white/[0.06] bg-white/[0.025] text-white/34">
              <Archive size={14} />
            </div>

            <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-white/24">
              Archive
            </p>
          </div>

          <h1 className="mt-6 text-[42px] font-medium leading-[1] tracking-[-0.055em] sm:text-[54px]">
            Past courses.
          </h1>

          <p className="mt-4 max-w-2xl text-[13px] leading-6 text-white/30">
            Archived courses stay out of your active workspace. Only the final
            course result is surfaced here.
          </p>
        </header>

        {loading ? (
          <div className="mt-10 flex items-center gap-3 text-[11px] text-white/28">
            <Loader2 size={14} className="animate-spin" />
            Loading archive
          </div>
        ) : courses.length === 0 ? (
          <div className="mt-10 rounded-[24px] border border-white/[0.06] bg-white/[0.01] p-7 sm:p-8">
            <p className="text-[13px] font-medium text-white/62">
              Nothing archived yet.
            </p>
            <p className="mt-2 text-[10px] leading-5 text-white/24">
              When you finish a course, archive it from the course options menu.
            </p>
          </div>
        ) : (
          <section className="mt-10 overflow-hidden rounded-[26px] border border-white/[0.065] bg-white/[0.012]">
            {courses.map((course, index) => (
              <article
                key={course.id}
                className={`grid gap-5 px-5 py-5 sm:grid-cols-[48px_1fr_auto] sm:items-center ${
                  index === courses.length - 1
                    ? ""
                    : "border-b border-white/[0.05]"
                }`}
              >
                <div
                  className="flex h-11 w-11 items-center justify-center rounded-[14px] text-[13px] font-semibold text-black"
                  style={{ backgroundColor: course.color }}
                >
                  {course.code.charAt(0)}
                </div>

                <div className="min-w-0">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.13em] text-white/22">
                    {course.code}
                  </p>
                  <h2 className="mt-1.5 truncate text-[15px] font-medium text-white/72">
                    {course.name}
                  </h2>
                  <p className="mt-1 text-[9px] text-white/20">
                    Archived{" "}
                    {new Intl.DateTimeFormat(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    }).format(new Date(course.archived_at))}
                  </p>
                </div>

                <div className="flex items-center justify-between gap-5 sm:justify-end">
                  <div className="text-right">
                    <p className="text-[8px] font-medium uppercase tracking-[0.12em] text-white/18">
                      Final grade
                    </p>
                    <div className="mt-1 flex items-center justify-end gap-2">
                      <TrendingUp
                        size={11}
                        style={{ color: course.color }}
                      />
                      <p className="text-[14px] font-medium text-white/68">
                        {course.archived_grade}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => void restoreCourse(course.id)}
                    disabled={restoringId === course.id}
                    title="Restore course"
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.055] bg-white/[0.015] text-white/24 transition hover:bg-white/[0.04] hover:text-white/58 disabled:opacity-40"
                  >
                    {restoringId === course.id ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <RotateCcw size={12} />
                    )}
                  </button>
                </div>
              </article>
            ))}
          </section>
        )}
      </div>
    </main>
  );
}