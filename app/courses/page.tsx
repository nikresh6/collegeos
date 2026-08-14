"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArrowLeft,
  BookOpen,
  ChevronRight,
  Loader2,
  Plus,
} from "lucide-react";
import { motion, MotionConfig } from "framer-motion";
import { supabase } from "../../lib/supabase";
import {
  SchoolLandmarkBackdrop,
  SchoolLandmarkLabel,
  SchoolMark,
} from "../../components/school-identity";

type Course = {
  id: string;
  code: string;
  name: string;
  professor: string;
  credits: number;
  color: string;
};

export default function CoursesPage() {
  const router = useRouter();
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void loadCourses();
  }, []);

  async function loadCourses() {
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
          "id, code, name, professor, credits, color",
        )
        .is("archived_at", null)
        .order("created_at", { ascending: true });

      if (error) throw error;

      setCourses(
        (data ?? []).map((course) => ({
          id: course.id,
          code: course.code,
          name: course.name,
          professor: course.professor ?? "",
          credits: Number(course.credits),
          color: course.color,
        })),
      );
    } catch (error) {
      console.error("Could not load courses:", error);
    } finally {
      setLoading(false);
    }
  }

  return (
    <MotionConfig reducedMotion="user">
      <main className="min-h-screen bg-[#080809] text-[#F5F5F7]">
        <div className="mx-auto max-w-[1180px] px-5 py-8 sm:px-8 md:px-10 md:py-12">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => router.push("/")}
              className="flex items-center gap-2 rounded-full border border-white/[0.065] bg-white/[0.02] px-3.5 py-2 text-[10px] font-medium text-white/38 transition hover:bg-white/[0.045] hover:text-white/68"
            >
              <ArrowLeft size={13} />
              Home
            </button>

            <button
              type="button"
              onClick={() => router.push("/archived")}
              className="flex items-center gap-2 rounded-full border border-white/[0.065] bg-white/[0.02] px-3.5 py-2 text-[10px] font-medium text-white/30 transition hover:bg-white/[0.045] hover:text-white/62"
            >
              <Archive size={12} />
              Archived
            </button>
          </div>

          <header className="relative mt-12 overflow-hidden border-b border-white/[0.065] pb-10 pt-2">
          <SchoolLandmarkBackdrop opacity={0.05} align="right" />
          <div className="relative z-10">
            <div className="flex items-center gap-3">
            <SchoolMark size={38} quiet />
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-white/30">
                Courses
              </p>
              <SchoolLandmarkLabel className="mt-1" />
            </div>
          </div>
            <h1 className="mt-5 text-[44px] font-medium leading-[0.98] tracking-[-0.06em] sm:text-[58px]">
              Your academic workspace.
            </h1>
            <p className="mt-4 max-w-2xl text-[13px] leading-6 text-white/30">
              Open a course to manage units, materials, grades, and study tools.
            </p>
                    </div>
        </header>

          {loading ? (
            <div className="mt-10 flex items-center gap-2 text-[10px] text-white/25">
              <Loader2 size={13} className="animate-spin" />
              Loading courses
            </div>
          ) : courses.length === 0 ? (
            <div className="mt-10 rounded-[26px] border border-white/[0.06] bg-white/[0.012] p-8">
              <BookOpen size={18} className="text-white/25" />
              <h2 className="mt-5 text-[22px] font-medium tracking-[-0.04em]">
                No active courses.
              </h2>
              <button
                type="button"
                onClick={() => router.push("/")}
                className="mt-5 flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-[10px] font-medium text-black"
              >
                <Plus size={11} />
                Add one from Home
              </button>
            </div>
          ) : (
            <section className="mt-10 grid gap-4 md:grid-cols-2">
              {courses.map((course, index) => (
                <motion.button
                  key={course.id}
                  type="button"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    delay: index * 0.04,
                    duration: 0.35,
                  }}
                  onClick={() =>
                    router.push(`/courses/${course.id}`)
                  }
                  className="group relative overflow-hidden rounded-[24px] border border-white/[0.065] bg-[#101012] p-5 text-left transition hover:border-white/[0.1] hover:bg-[#121214] sm:p-6"
                >
                  <div
                    className="pointer-events-none absolute right-[-80px] top-[-100px] h-[230px] w-[230px] rounded-full opacity-[0.08] blur-[90px]"
                    style={{ backgroundColor: course.color }}
                  />

                  <div className="relative flex items-start gap-4">
                    <div
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] text-[13px] font-semibold text-black"
                      style={{ backgroundColor: course.color }}
                    >
                      {course.code.charAt(0)}
                    </div>

                    <div className="min-w-0 flex-1">
                      <p
                        className="text-[9px] font-semibold uppercase tracking-[0.13em]"
                        style={{ color: course.color }}
                      >
                        {course.code}
                      </p>
                      <h2 className="mt-1.5 truncate text-[16px] font-medium text-white/72">
                        {course.name}
                      </h2>
                      <p className="mt-2 text-[9px] text-white/20">
                        {course.professor || "Professor not set"} ·{" "}
                        {course.credits} credits
                      </p>
                    </div>

                    <ChevronRight
                      size={15}
                      className="mt-1 shrink-0 text-white/18 transition group-hover:translate-x-0.5 group-hover:text-white/42"
                    />
                  </div>
                </motion.button>
              ))}
            </section>
          )}
        </div>
      </main>
    </MotionConfig>
  );
}