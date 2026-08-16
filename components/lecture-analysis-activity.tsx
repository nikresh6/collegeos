"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  BrainCircuit,
  ChevronRight,
  Loader2,
} from "lucide-react";
import {
  usePathname,
  useRouter,
} from "next/navigation";
import { supabase } from "../lib/supabase";
import {
  useSchoolIdentity,
} from "./school-identity";

type ActiveLecture = {
  id: string;
  title: string;
  analysis_stage: string;
  analysis_progress: number;
};

export function LectureAnalysisActivity() {
  const router =
    useRouter();
  const pathname =
    usePathname();
  const { identity } =
    useSchoolIdentity();

  const [
    lectures,
    setLectures,
  ] =
    useState<ActiveLecture[]>(
      [],
    );

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      const {
        data,
        error,
      } = await supabase
        .from("lectures")
        .select(
          "id, title, analysis_stage, analysis_progress",
        )
        .eq(
          "status",
          "analyzing",
        )
        .order(
          "updated_at",
          {
            ascending:
              false,
          },
        )
        .limit(5);

      if (
        cancelled ||
        error
      ) {
        return;
      }

      setLectures(
        (data ??
          []).map(
          (lecture) => ({
            id:
              lecture.id,
            title:
              lecture.title,
            analysis_stage:
              lecture.analysis_stage ??
              "condensing",
            analysis_progress:
              Number(
                lecture.analysis_progress ??
                  0,
              ),
          }),
        ),
      );
    }

    void refresh();

    const interval =
      window.setInterval(
        () => {
          void refresh();
        },
        lectures.length > 0
          ? 3000
          : 8000,
      );

    return () => {
      cancelled = true;
      window.clearInterval(
        interval,
      );
    };
  }, [lectures.length]);

  const averageProgress =
    useMemo(() => {
      if (
        lectures.length ===
        0
      ) {
        return 0;
      }

      return Math.round(
        lectures.reduce(
          (
            total,
            lecture,
          ) =>
            total +
            lecture.analysis_progress,
          0,
        ) /
          lectures.length,
      );
    }, [lectures]);

  if (
    lectures.length ===
    0
  ) {
    return null;
  }

  const first =
    lectures[0];

  const target =
    lectures.length === 1
      ? `/lectures/${first.id}`
      : "/lectures";

  const onLectureSummary =
    pathname ===
    `/lectures/${first.id}`;

  if (
    lectures.length === 1 &&
    onLectureSummary
  ) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={() =>
        router.push(
          target,
        )
      }
      className="fixed bottom-[76px] left-1/2 z-[190] w-[min(92vw,460px)] -translate-x-1/2 overflow-hidden rounded-[17px] border border-white/[0.09] bg-[#111113]/94 text-left shadow-[0_18px_60px_rgba(0,0,0,0.42)] backdrop-blur-2xl transition hover:border-white/[0.14] lg:bottom-5"
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[11px]"
          style={{
            backgroundColor: `${identity.primary}12`,
            color:
              identity.primary,
          }}
        >
          <BrainCircuit
            size={13}
          />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-[9px] font-medium text-white/58">
              {lectures.length ===
              1
                ? first.title
                : `${lectures.length} lectures analyzing`}
            </p>

            <Loader2
              size={9}
              className="shrink-0 animate-spin text-white/24"
            />
          </div>

          <p className="mt-1 text-[7px] uppercase tracking-[0.09em] text-white/20">
            {lectures.length ===
            1
              ? `${first.analysis_stage} · ${first.analysis_progress}%`
              : `Background AI · ${averageProgress}% average`}
          </p>
        </div>

        <ChevronRight
          size={11}
          className="shrink-0 text-white/18"
        />
      </div>

      <div className="h-[2px] bg-white/[0.035]">
        <div
          className="h-full transition-all duration-500"
          style={{
            width: `${Math.max(
              3,
              averageProgress,
            )}%`,
            backgroundColor:
              identity.primary,
          }}
        />
      </div>
    </button>
  );
}
