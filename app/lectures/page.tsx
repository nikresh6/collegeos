"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  AudioLines,
  BookOpen,
  Check,
  ChevronRight,
  Clock3,
  FileAudio,
  FileText,
  Loader2,
  Mic2,
  Pause,
  Play,
  Radio,
  RotateCcw,
  Sparkles,
  Square,
  Trash2,
  Upload,
  X,
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
  cancelLectureAnalysis,
  createLectureMaterial,
  isLectureAnalysisCancelledError,
  lectureDepthLabel,
  reprocessLectureMaterial,
  type LecturePipelineStage,
} from "../../lib/lecture-pipeline";
import {
  useLectureRecording,
} from "../../components/lecture-recording-provider";

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
  position: number;
};

type LectureStatus =
  | "uploaded"
  | "transcribing"
  | "analyzing"
  | "ready"
  | "error";

type Lecture = {
  id: string;
  course_id: string;
  unit_id: string | null;
  course_file_id: string | null;
  title: string;
  source_kind:
    | "recording"
    | "upload";
  file_name: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  duration_seconds: number | null;
  notes_depth_percent: number;
  status: LectureStatus;
  analysis_stage: string;
  analysis_progress: number;
  transcript_text: string | null;
  summary: string | null;
  notes: Record<string, unknown>;
  error_message: string | null;
  created_at: string;
};

type ProcessStage =
  | "idle"
  | "uploading"
  | "transcribing"
  | "analyzing"
  | "ready"
  | "error";

const AUDIO_ACCEPT =
  "audio/*,.mp3,.m4a,.wav,.webm,.ogg,.mp4,.mpeg,.mpga";

const waveformBars = [
  24, 42, 30, 58, 38, 70, 46, 84,
  52, 66, 36, 78, 44, 62, 28, 54,
  40, 72, 34, 60, 48, 82, 36, 64,
  30, 52, 44, 74, 38, 58, 26, 48,
];

function formatDate(
  value: string,
) {
  const date = new Date(value);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return "";
  }

  return new Intl.DateTimeFormat(
    undefined,
    {
      month: "short",
      day: "numeric",
    },
  ).format(date);
}

function formatLongDuration(
  seconds:
    | number
    | null
    | undefined,
) {
  if (!seconds || seconds <= 0) {
    return "Duration pending";
  }

  const rounded =
    Math.round(seconds);
  const hours = Math.floor(
    rounded / 3600,
  );
  const minutes = Math.floor(
    (rounded % 3600) / 60,
  );

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${Math.max(
    1,
    minutes,
  )} min`;
}

async function durationForFile(
  file: File,
) {
  return new Promise<number>(
    (resolve) => {
      const url =
        URL.createObjectURL(
          file,
        );
      const audio =
        document.createElement(
          "audio",
        );

      function cleanup() {
        URL.revokeObjectURL(url);
        audio.remove();
      }

      audio.preload =
        "metadata";
      audio.src = url;

      audio.onloadedmetadata =
        () => {
          const duration =
            Number.isFinite(
              audio.duration,
            )
              ? audio.duration
              : 0;

          cleanup();
          resolve(duration);
        };

      audio.onerror = () => {
        cleanup();
        resolve(0);
      };
    },
  );
}

export default function LecturesPage() {
  const router = useRouter();
  const { identity } =
    useSchoolIdentity();
  const recording =
    useLectureRecording();

  const [courses, setCourses] =
    useState<Course[]>([]);
  const [units, setUnits] =
    useState<CourseUnit[]>([]);
  const [lectures, setLectures] =
    useState<Lecture[]>([]);
  const [loading, setLoading] =
    useState(true);

  const [courseId, setCourseId] =
    useState("");
  const [unitId, setUnitId] =
    useState("");
  const [
    lectureTitle,
    setLectureTitle,
  ] = useState("");
  const [
    depthPercent,
    setDepthPercent,
  ] = useState(60);

  const [uploadFile, setUploadFile] =
    useState<File | null>(null);
  const [
    uploadDuration,
    setUploadDuration,
  ] = useState(0);

  const [
    processStage,
    setProcessStage,
  ] =
    useState<ProcessStage>(
      "idle",
    );
  const [
    uploadProgress,
    setUploadProgress,
  ] = useState(0);
  const [
    processMessage,
    setProcessMessage,
  ] = useState("");
  const [error, setError] =
    useState("");
  const [
    activeProcessingLectureId,
    setActiveProcessingLectureId,
  ] = useState<string | null>(null);
  const [
    cancellingAnalysis,
    setCancellingAnalysis,
  ] = useState(false);

  const analysisControllerRef =
    useRef<AbortController | null>(null);

  const [
    openLecture,
    setOpenLecture,
  ] =
    useState<Lecture | null>(
      null,
    );

  const uploadInputRef =
    useRef<HTMLInputElement>(
      null,
    );

  useEffect(() => {
    void loadPage();
  }, []);

  async function loadPage() {
    try {
      setLoading(true);
      setError("");

      const {
        data: { session },
        error:
          sessionError,
      } =
        await supabase.auth.getSession();

      if (sessionError) {
        throw sessionError;
      }

      if (!session) {
        router.replace(
          "/onboarding",
        );
        return;
      }

      const {
        data: courseData,
        error: courseError,
      } = await supabase
        .from("courses")
        .select(
          "id, code, name, color",
        )
        .is(
          "archived_at",
          null,
        )
        .order("created_at", {
          ascending: true,
        });

      if (courseError) {
        throw courseError;
      }

      const activeCourses =
        (courseData ??
          []) as Course[];

      setCourses(
        activeCourses,
      );

      if (
        activeCourses[0]
      ) {
        setCourseId(
          (current) =>
            current ||
            activeCourses[0].id,
        );
      }

      const courseIds =
        activeCourses.map(
          (course) =>
            course.id,
        );

      if (
        courseIds.length === 0
      ) {
        setUnits([]);
        setLectures([]);
        return;
      }

      const [
        {
          data: unitData,
          error: unitError,
        },
        {
          data: lectureData,
          error: lectureError,
        },
      ] = await Promise.all([
        supabase
          .from(
            "course_units",
          )
          .select(
            "id, course_id, name, position",
          )
          .in(
            "course_id",
            courseIds,
          )
          .order("position", {
            ascending: true,
          }),
        supabase
          .from("lectures")
          .select(
            "id, course_id, unit_id, course_file_id, title, source_kind, file_name, storage_path, mime_type, size_bytes, duration_seconds, notes_depth_percent, status, analysis_stage, analysis_progress, transcript_text, summary, notes, error_message, created_at",
          )
          .in(
            "course_id",
            courseIds,
          )
          .order(
            "created_at",
            {
              ascending: false,
            },
          ),
      ]);

      if (unitError) {
        throw unitError;
      }

      if (lectureError) {
        throw lectureError;
      }

      setUnits(
        (unitData ??
          []).map(
          (unit) => ({
            id: unit.id,
            course_id:
              unit.course_id,
            name: unit.name,
            position: Number(
              unit.position ??
                0,
            ),
          }),
        ),
      );

      setLectures(
        (lectureData ??
          []).map(
          (lecture) => ({
            ...lecture,
            size_bytes:
              lecture.size_bytes ===
              null
                ? null
                : Number(
                    lecture.size_bytes,
                  ),
            duration_seconds:
              lecture.duration_seconds ===
              null
                ? null
                : Number(
                    lecture.duration_seconds,
                  ),
            notes_depth_percent:
              Number(
                lecture.notes_depth_percent ??
                  60,
              ),
            analysis_progress:
              Number(
                lecture.analysis_progress ??
                  0,
              ),
            notes:
              (lecture.notes ??
                {}) as Record<
                string,
                unknown
              >,
          }),
        ) as Lecture[],
      );
    } catch (
      loadError
    ) {
      console.error(
        "Could not load lectures:",
        loadError,
      );
      setError(
        loadError instanceof
          Error
          ? loadError.message
          : "Could not load lectures.",
      );
    } finally {
      setLoading(false);
    }
  }

  const selectedCourse =
    useMemo(
      () =>
        courses.find(
          (course) =>
            course.id ===
            courseId,
        ) ?? null,
      [
        courses,
        courseId,
      ],
    );

  const availableUnits =
    useMemo(
      () =>
        units.filter(
          (unit) =>
            unit.course_id ===
            courseId,
        ),
      [
        units,
        courseId,
      ],
    );

  const selectedUnit =
    useMemo(
      () =>
        availableUnits.find(
          (unit) =>
            unit.id ===
            unitId,
        ) ?? null,
      [
        availableUnits,
        unitId,
      ],
    );

  const accent =
    selectedCourse?.color ??
    identity.primary;

  const activeProcessing =
    processStage ===
      "uploading" ||
    processStage ===
      "transcribing" ||
    processStage ===
      "analyzing";

  async function beginRecording() {
    if (!selectedCourse) {
      setError(
        "Choose a class before recording.",
      );
      return;
    }

    if (
      recording.isActive
    ) {
      router.push(
        "/lectures/recording",
      );
      return;
    }

    setError("");

    const title =
      lectureTitle.trim() ||
      `${selectedCourse.code} Lecture · ${new Intl.DateTimeFormat(
        undefined,
        {
          month: "short",
          day: "numeric",
        },
      ).format(new Date())}`;

    const started =
      await recording.startRecording(
        {
          courseId:
            selectedCourse.id,
          courseCode:
            selectedCourse.code,
          courseName:
            selectedCourse.name,
          courseColor:
            selectedCourse.color,
          unitId:
            selectedUnit?.id ??
            null,
          title,
          depthPercent,
        },
      );

    if (!started) {
      setError(
        recording.error ||
          "Could not start the microphone.",
      );
      return;
    }

    router.push(
      "/lectures/recording",
    );
  }

  async function chooseUpload(
    file: File | null,
  ) {
    if (!file) {
      return;
    }

    setError("");
    setUploadFile(file);

    const duration =
      await durationForFile(
        file,
      );

    setUploadDuration(
      duration,
    );

    if (
      !lectureTitle.trim() &&
      selectedCourse
    ) {
      setLectureTitle(
        file.name.replace(
          /\.[^.]+$/,
          "",
        ) ||
          `${selectedCourse.code} Lecture`,
      );
    }
  }

  async function processUpload() {
    if (
      !selectedCourse ||
      !uploadFile ||
      !lectureTitle.trim() ||
      activeProcessing
    ) {
      return;
    }

    const analysisController =
      new AbortController();

    analysisControllerRef.current =
      analysisController;
    setActiveProcessingLectureId(null);

    try {
      setError("");
      setUploadProgress(0);

      const handleStage = (
        stage:
          LecturePipelineStage,
        message: string,
      ) => {
        setProcessStage(
          stage,
        );
        setProcessMessage(
          message,
        );
      };

      const created =
        await createLectureMaterial({
        file: uploadFile,
        courseId:
          selectedCourse.id,
        unitId:
          selectedUnit?.id ??
          null,
        title:
          lectureTitle.trim(),
        sourceKind: "upload",
        depthPercent,
        durationSeconds:
          uploadDuration ||
          null,
        onLectureCreated: (lectureId) => {
          setActiveProcessingLectureId(lectureId);
        },
        analysisSignal:
          analysisController.signal,
        onStage: handleStage,
        onUploadProgress:
          setUploadProgress,
      });

      setProcessStage(
        "analyzing",
      );
      setProcessMessage(
        "AI analysis is running in the background. You can leave this page.",
      );
      setUploadFile(null);
      setUploadDuration(0);
      setLectureTitle("");
      setUnitId("");

      await loadPage();

      router.push(
        `/lectures/${created.lectureId}`,
      );
    } catch (
      processError
    ) {
      if (
        isLectureAnalysisCancelledError(
          processError,
        )
      ) {
        return;
      }

      console.error(
        "Lecture upload failed:",
        processError,
      );
      setProcessStage(
        "error",
      );
      setError(
        processError instanceof
          Error
          ? processError.message
          : "Lecture processing failed.",
      );
    } finally {
      if (
        analysisControllerRef.current ===
        analysisController
      ) {
        analysisControllerRef.current = null;
      }
    }
  }

  async function cancelCurrentAnalysis() {
    if (
      !activeProcessingLectureId ||
      cancellingAnalysis
    ) {
      return;
    }

    try {
      setCancellingAnalysis(true);
      setProcessMessage(
        "Cancelling AI analysis…",
      );

      const lectureId =
        activeProcessingLectureId;

      await cancelLectureAnalysis({
        lectureId,
        controller:
          analysisControllerRef.current,
      });

      setProcessStage("idle");
      setProcessMessage("");
      setUploadFile(null);
      setUploadDuration(0);
      await loadPage();
      router.push(
        `/lectures/${lectureId}`,
      );
    } catch (cancelError) {
      console.error(
        "Could not cancel lecture analysis:",
        cancelError,
      );
      setError(
        cancelError instanceof Error
          ? cancelError.message
          : "Could not cancel analysis.",
      );
    } finally {
      setCancellingAnalysis(false);
    }
  }

  async function reprocessLecture(
    lecture: Lecture,
  ) {
    const analysisController =
      new AbortController();

    analysisControllerRef.current =
      analysisController;
    setActiveProcessingLectureId(
      lecture.id,
    );

    try {
      setError("");

      const handleStage = (
        stage:
          LecturePipelineStage,
        message: string,
      ) => {
        setProcessStage(
          stage,
        );
        setProcessMessage(
          message,
        );
      };

      await reprocessLectureMaterial({
        lectureId:
          lecture.id,
        depthPercent:
          lecture.notes_depth_percent ??
          60,
        analysisSignal:
          analysisController.signal,
        onStage: handleStage,
      });

      setProcessStage(
        "ready",
      );

      await loadPage();

      const {
        data,
        error:
          refreshError,
      } = await supabase
        .from("lectures")
        .select(
          "id, course_id, unit_id, course_file_id, title, source_kind, file_name, storage_path, mime_type, size_bytes, duration_seconds, notes_depth_percent, status, analysis_stage, analysis_progress, transcript_text, summary, notes, error_message, created_at",
        )
        .eq(
          "id",
          lecture.id,
        )
        .single();

      if (refreshError) {
        throw refreshError;
      }

      setOpenLecture(
        data as Lecture,
      );
    } catch (
      reprocessError
    ) {
      if (
        isLectureAnalysisCancelledError(
          reprocessError,
        )
      ) {
        return;
      }

      setError(
        reprocessError instanceof
          Error
          ? reprocessError.message
          : "Could not reprocess lecture.",
      );
    } finally {
      if (
        analysisControllerRef.current ===
        analysisController
      ) {
        analysisControllerRef.current = null;
      }
    }
  }

  async function deleteLecture(
    lecture: Lecture,
  ) {
    const confirmed =
      window.confirm(
        `Delete "${lecture.title}" and its audio?`,
      );

    if (!confirmed) {
      return;
    }

    try {
      const {
        error: storageError,
      } =
        await supabase.storage
          .from(
            "lecture-audio",
          )
          .remove([
            lecture.storage_path,
          ]);

      if (storageError) {
        console.warn(
          "Lecture audio cleanup failed:",
          storageError,
        );
      }

      if (
        lecture.course_file_id
      ) {
        const {
          error:
            fileDeleteError,
        } = await supabase
          .from(
            "course_files",
          )
          .delete()
          .eq(
            "id",
            lecture.course_file_id,
          );

        if (
          fileDeleteError
        ) {
          throw fileDeleteError;
        }
      } else {
        const {
          error:
            lectureDeleteError,
        } = await supabase
          .from("lectures")
          .delete()
          .eq(
            "id",
            lecture.id,
          );

        if (
          lectureDeleteError
        ) {
          throw lectureDeleteError;
        }
      }

      setLectures(
        (current) =>
          current.filter(
            (item) =>
              item.id !==
              lecture.id,
          ),
      );

      if (
        openLecture?.id ===
        lecture.id
      ) {
        setOpenLecture(null);
      }
    } catch (
      deleteError
    ) {
      setError(
        deleteError instanceof
          Error
          ? deleteError.message
          : "Could not delete the lecture.",
      );
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#080809] text-white">
        <div className="flex items-center gap-3 text-[11px] text-white/36">
          <Loader2
            size={14}
            className="animate-spin"
          />
          Loading Lectures
        </div>
      </main>
    );
  }

  return (
    <MotionConfig reducedMotion="user">
      <main className="relative min-h-screen overflow-x-hidden bg-[#080809] text-[#F5F5F7]">
        <input
          ref={uploadInputRef}
          type="file"
          accept={AUDIO_ACCEPT}
          className="hidden"
          onChange={(
            event,
          ) => {
            void chooseUpload(
              event.target.files?.[0] ??
                null,
            );
            event.target.value =
              "";
          }}
        />

        <div
          aria-hidden
          className="pointer-events-none fixed inset-x-0 top-0 h-[600px] opacity-[0.13]"
          style={{
            background: `radial-gradient(circle at 30% 0%, ${accent}55 0%, transparent 58%)`,
          }}
        />

        <div className="relative mx-auto max-w-[1240px] px-4 pb-28 pt-6 sm:px-8 md:px-10 md:pt-10 lg:pb-16">
          <button
            type="button"
            onClick={() =>
              router.push("/")
            }
            className="flex items-center gap-2 rounded-full border border-white/[0.07] bg-white/[0.02] px-3.5 py-2.5 text-[11px] font-medium text-white/48 transition hover:bg-white/[0.045] hover:text-white/78"
          >
            <ArrowLeft
              size={13}
            />
            Home
          </button>

          <header className="mt-9 grid gap-7 border-b border-white/[0.065] pb-8 sm:mt-12 sm:gap-9 sm:pb-10 lg:grid-cols-[1fr_360px] lg:items-end">
            <div>
              <div className="flex items-center gap-3">
                <SchoolMark
                  size={40}
                  quiet
                />
                <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-white/38">
                  Lectures
                </p>
              </div>

              <h1 className="mt-5 max-w-4xl text-[40px] font-medium leading-[0.96] tracking-[-0.057em] sm:mt-6 sm:text-[64px]">
                Record once.
                <br className="hidden sm:block" />{" "}
                Study from it all week.
              </h1>

              <p className="mt-4 max-w-2xl text-[13px] leading-6 text-white/42 sm:mt-5 sm:text-[14px] sm:leading-7 sm:text-white/44">
                Record live in a dedicated lecture room with notes beside the
                recorder, or upload existing audio. Recording continues while
                you navigate away from the room.
              </p>
            </div>

            <div className="rounded-[22px] border border-white/[0.065] bg-[#101012] p-5">
              <div className="flex items-center gap-3">
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-[13px]"
                  style={{
                    backgroundColor: `${accent}12`,
                    color:
                      accent,
                  }}
                >
                  <Radio
                    size={16}
                  />
                </div>

                <div>
                  <p className="text-[11px] font-medium text-white/68">
                    Persistent recorder
                  </p>
                  <p className="mt-1 text-[9px] text-white/34">
                    Record · navigate · return
                  </p>
                </div>
              </div>

              <div className="mt-5 flex h-[62px] items-center gap-[3px] overflow-hidden">
                {waveformBars.map(
                  (
                    height,
                    index,
                  ) => (
                    <motion.span
                      key={`${height}-${index}`}
                      animate={{
                        height: [
                          `${Math.max(
                            16,
                            height *
                              0.55,
                          )}%`,
                          `${height}%`,
                          `${Math.max(
                            18,
                            height *
                              0.68,
                          )}%`,
                        ],
                      }}
                      transition={{
                        duration:
                          1.8 +
                          (index %
                            5) *
                            0.13,
                        repeat:
                          Infinity,
                        repeatType:
                          "mirror",
                        ease:
                          "easeInOut",
                        delay:
                          index *
                          0.02,
                      }}
                      className="w-[3px] flex-1 rounded-full bg-white/14"
                      style={{
                        maxWidth: 4,
                        backgroundColor:
                          index %
                            5 ===
                          0
                            ? accent
                            : undefined,
                        opacity:
                          index %
                            5 ===
                          0
                            ? 0.7
                            : undefined,
                      }}
                    />
                  ),
                )}
              </div>
            </div>
          </header>

          {error && (
            <div className="mt-6 flex items-start justify-between gap-4 rounded-[18px] border border-red-500/15 bg-red-500/[0.04] px-4 py-3.5">
              <p className="text-[10px] leading-5 text-red-200/68">
                {error}
              </p>
              <button
                type="button"
                onClick={() =>
                  setError("")
                }
                className="text-red-200/38 hover:text-red-100"
              >
                <X
                  size={12}
                />
              </button>
            </div>
          )}

          {recording.isActive && (
            <button
              type="button"
              onClick={() =>
                router.push(
                  "/lectures/recording",
                )
              }
              className="mt-6 flex w-full items-center gap-4 rounded-[18px] border border-red-300/10 bg-red-300/[0.025] px-4 py-4 text-left transition hover:bg-red-300/[0.04]"
            >
              <span className="h-2 w-2 animate-pulse rounded-full bg-red-400" />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium text-white/68">
                  Recording already in progress
                </p>
                <p className="mt-1 truncate text-[9px] text-white/28">
                  {recording.meta?.title}
                </p>
              </div>
              <ChevronRight
                size={12}
                className="text-white/24"
              />
            </button>
          )}

          <section className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="overflow-hidden rounded-[28px] border border-white/[0.07] bg-[#101012]">
              <div className="border-b border-white/[0.055] p-5 sm:p-6">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/34">
                  New lecture
                </p>
                <h2 className="mt-2 text-[28px] font-medium tracking-[-0.045em]">
                  Capture it without friction.
                </h2>
              </div>

              <div className="p-5 sm:p-6">
                {courses.length ===
                0 ? (
                  <p className="text-[11px] text-white/36">
                    Add a course before creating a lecture.
                  </p>
                ) : (
                  <>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {courses.map(
                        (course) => {
                          const selected =
                            course.id ===
                            courseId;

                          return (
                            <button
                              key={
                                course.id
                              }
                              type="button"
                              onClick={() => {
                                setCourseId(
                                  course.id,
                                );
                                setUnitId(
                                  "",
                                );
                              }}
                              disabled={
                                activeProcessing
                              }
                              className={`flex items-center gap-3 rounded-[16px] border px-4 py-3.5 text-left transition ${
                                selected
                                  ? "border-white/[0.13] bg-white/[0.04]"
                                  : "border-white/[0.055] bg-white/[0.008] hover:border-white/[0.09]"
                              } disabled:opacity-40`}
                            >
                              <span
                                className="h-8 w-1 rounded-full"
                                style={{
                                  backgroundColor:
                                    course.color,
                                }}
                              />
                              <div className="min-w-0">
                                <p
                                  className="text-[10px] font-semibold"
                                  style={{
                                    color:
                                      course.color,
                                  }}
                                >
                                  {
                                    course.code
                                  }
                                </p>
                                <p className="mt-1 truncate text-[11px] text-white/52">
                                  {
                                    course.name
                                  }
                                </p>
                              </div>
                            </button>
                          );
                        },
                      )}
                    </div>

                    <div className="mt-6 grid gap-4 sm:grid-cols-2">
                      <label className="block">
                        <span className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.1em] text-white/30">
                          Lecture title
                        </span>
                        <input
                          value={
                            lectureTitle
                          }
                          onChange={(
                            event,
                          ) =>
                            setLectureTitle(
                              event
                                .target
                                .value,
                            )
                          }
                          placeholder="Lecture 8 · Dynamics"
                          className="w-full rounded-[14px] border border-white/[0.065] bg-white/[0.02] px-4 py-3.5 text-[11px] text-white/68 outline-none placeholder:text-white/20 focus:border-white/[0.12]"
                        />
                      </label>

                      <label className="block">
                        <span className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.1em] text-white/30">
                          Unit{" "}
                          <span className="font-normal normal-case tracking-normal text-white/20">
                            optional
                          </span>
                        </span>
                        <select
                          value={
                            unitId
                          }
                          onChange={(
                            event,
                          ) =>
                            setUnitId(
                              event
                                .target
                                .value,
                            )
                          }
                          className="w-full rounded-[14px] border border-white/[0.065] bg-white/[0.02] px-4 py-3.5 text-[11px] text-white/68 outline-none [color-scheme:dark]"
                        >
                          <option value="">
                            Let AI connect topics later
                          </option>
                          {availableUnits.map(
                            (
                              unit,
                            ) => (
                              <option
                                key={
                                  unit.id
                                }
                                value={
                                  unit.id
                                }
                              >
                                {
                                  unit.name
                                }
                              </option>
                            ),
                          )}
                        </select>
                      </label>
                    </div>

                    <div className="mt-5 rounded-[18px] border border-white/[0.055] bg-white/[0.01] p-4">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-white/28">
                            AI notes depth
                          </p>
                          <p className="mt-1.5 text-[11px] text-white/48">
                            {lectureDepthLabel(
                              depthPercent,
                            )}
                          </p>
                        </div>
                        <p
                          className="text-[24px] font-medium tracking-[-0.045em]"
                          style={{
                            color:
                              accent,
                          }}
                        >
                          {
                            depthPercent
                          }
                          %
                        </p>
                      </div>

                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={
                          depthPercent
                        }
                        onChange={(
                          event,
                        ) =>
                          setDepthPercent(
                            Number(
                              event
                                .target
                                .value,
                            ),
                          )
                        }
                        className="mt-4 w-full accent-white"
                      />
                    </div>

                    <div className="mt-6 grid gap-3 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() =>
                          void beginRecording()
                        }
                        disabled={
                          !selectedCourse ||
                          activeProcessing
                        }
                        className="group rounded-[20px] border border-white/[0.07] bg-white/[0.015] p-5 text-left transition hover:border-white/[0.12] hover:bg-white/[0.03] disabled:opacity-35"
                      >
                        <div
                          className="flex h-10 w-10 items-center justify-center rounded-[13px]"
                          style={{
                            backgroundColor: `${accent}12`,
                            color:
                              accent,
                          }}
                        >
                          <Mic2
                            size={16}
                          />
                        </div>
                        <p className="mt-5 text-[13px] font-medium text-white/72">
                          {recording.isActive
                            ? "Return to recording"
                            : "Record live"}
                        </p>
                        <p className="mt-2 text-[10px] leading-5 text-white/32">
                          Opens a full-screen recording room with your notes beside it.
                        </p>
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          uploadInputRef.current?.click()
                        }
                        disabled={
                          activeProcessing
                        }
                        className="group rounded-[20px] border border-white/[0.07] bg-white/[0.015] p-5 text-left transition hover:border-white/[0.12] hover:bg-white/[0.03] disabled:opacity-35"
                      >
                        <div className="flex h-10 w-10 items-center justify-center rounded-[13px] bg-white/[0.04] text-white/42">
                          <Upload
                            size={16}
                          />
                        </div>
                        <p className="mt-5 text-[13px] font-medium text-white/72">
                          Upload audio
                        </p>
                        <p className="mt-2 text-[10px] leading-5 text-white/32">
                          Use an existing MP3, M4A, WAV, WebM, OGG, or MP4 recording.
                        </p>
                      </button>
                    </div>

                    {uploadFile && (
                      <div className="mt-5 rounded-[18px] border border-white/[0.065] bg-white/[0.012] p-4">
                        <div className="flex items-center gap-3">
                          <FileAudio
                            size={16}
                            className="text-white/34"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[11px] font-medium text-white/62">
                              {
                                uploadFile.name
                              }
                            </p>
                            <p className="mt-1 text-[9px] text-white/26">
                              {formatLongDuration(
                                uploadDuration,
                              )}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setUploadFile(
                                null,
                              );
                              setUploadDuration(
                                0,
                              );
                            }}
                            className="flex h-8 w-8 items-center justify-center rounded-full text-white/24 hover:bg-white/[0.035] hover:text-white/52"
                          >
                            <X
                              size={11}
                            />
                          </button>
                        </div>

                        {(activeProcessing ||
                          processStage ===
                            "ready") && (
                          <div className="mt-4">
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-[9px] text-white/34">
                                {processMessage ||
                                  "Processing"}
                              </p>
                              {activeProcessing && (
                                <Loader2
                                  size={10}
                                  className="animate-spin text-white/28"
                                />
                              )}
                            </div>
                            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
                              <div
                                className="h-full rounded-full transition-all"
                                style={{
                                  width: `${
                                    processStage ===
                                    "uploading"
                                      ? Math.max(
                                          4,
                                          uploadProgress,
                                        )
                                      : processStage ===
                                          "transcribing"
                                        ? 65
                                        : processStage ===
                                            "analyzing"
                                          ? 86
                                          : 100
                                  }%`,
                                  backgroundColor:
                                    accent,
                                }}
                              />
                            </div>

                            {processStage ===
                              "analyzing" &&
                              activeProcessingLectureId && (
                              <button
                                type="button"
                                onClick={() =>
                                  void cancelCurrentAnalysis()
                                }
                                disabled={
                                  cancellingAnalysis
                                }
                                className="mt-3 flex w-full items-center justify-center gap-2 rounded-full border border-red-300/15 bg-red-300/[0.025] px-3 py-2 text-[9px] font-medium text-red-100/55 transition hover:bg-red-300/[0.05] hover:text-red-100/80 disabled:opacity-35"
                              >
                                {cancellingAnalysis ? (
                                  <Loader2
                                    size={10}
                                    className="animate-spin"
                                  />
                                ) : (
                                  <Square
                                    size={10}
                                  />
                                )}
                                {cancellingAnalysis
                                  ? "Cancelling…"
                                  : "Cancel analysis"}
                              </button>
                            )}
                          </div>
                        )}

                        <button
                          type="button"
                          onClick={() =>
                            void processUpload()
                          }
                          disabled={
                            !lectureTitle.trim() ||
                            activeProcessing
                          }
                          className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-white px-4 py-2.5 text-[10px] font-medium text-black disabled:opacity-35"
                        >
                          <Sparkles
                            size={11}
                          />
                          Create transcript & AI notes
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            <aside className="space-y-4">
              <div className="rounded-[24px] border border-white/[0.065] bg-[#101012] p-5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-white/34">
                  Live recording
                </p>

                <div className="mt-5 space-y-4">
                  <FeatureStep
                    icon={Mic2}
                    title="Persistent microphone"
                    description="Navigate Home without ending the recording."
                    color={
                      accent
                    }
                  />
                  <FeatureStep
                    icon={FileText}
                    title="Notes beside recording"
                    description="Jot down what matters while the professor talks."
                    color={
                      accent
                    }
                  />
                  <FeatureStep
                    icon={Sparkles}
                    title="Same AI pipeline"
                    description="Finish the lecture, then create transcript and structured notes."
                    color={
                      accent
                    }
                  />
                </div>
              </div>

              <div className="rounded-[24px] border border-white/[0.06] bg-white/[0.012] p-5">
                <div className="flex items-center gap-3">
                  <Clock3
                    size={14}
                    className="text-white/30"
                  />
                  <p className="text-[11px] font-medium text-white/54">
                    Navigation is safe
                  </p>
                </div>
                <p className="mt-3 text-[10px] leading-5 text-white/30">
                  Moving between pages keeps the recorder alive because it now lives at the app root. A full browser refresh or closed tab still ends a browser recording.
                </p>
              </div>
            </aside>
          </section>

          <section className="mt-12">
            <div className="flex items-end justify-between gap-5">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/34">
                  Library
                </p>
                <h2 className="mt-2 text-[28px] font-medium tracking-[-0.04em]">
                  Recent lectures
                </h2>
              </div>

              <p className="text-[10px] text-white/26">
                {lectures.length} saved
              </p>
            </div>

            {lectures.length ===
            0 ? (
              <div className="mt-6 rounded-[24px] border border-white/[0.06] bg-white/[0.01] px-6 py-12 text-center">
                <AudioLines
                  size={20}
                  className="mx-auto text-white/18"
                />
                <p className="mt-4 text-[12px] font-medium text-white/52">
                  No lectures yet.
                </p>
              </div>
            ) : (
              <div className="mt-6 overflow-hidden rounded-[24px] border border-white/[0.065] bg-[#101012]">
                {lectures.map(
                  (
                    lecture,
                    index,
                  ) => {
                    const course =
                      courses.find(
                        (
                          item,
                        ) =>
                          item.id ===
                          lecture.course_id,
                      );

                    return (
                      <button
                        key={
                          lecture.id
                        }
                        type="button"
                        onClick={() =>
                          router.push(
                            `/lectures/${lecture.id}`,
                          )
                        }
                        className={`group flex w-full items-center gap-4 px-5 py-4 text-left transition hover:bg-white/[0.02] ${
                          index ===
                          lectures.length -
                            1
                            ? ""
                            : "border-b border-white/[0.05]"
                        }`}
                      >
                        <div
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px]"
                          style={{
                            backgroundColor: `${
                              course?.color ??
                              identity.primary
                            }10`,
                            color:
                              course?.color ??
                              identity.primary,
                          }}
                        >
                          <AudioLines
                            size={15}
                          />
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            {course && (
                              <span
                                className="text-[9px] font-semibold"
                                style={{
                                  color:
                                    course.color,
                                }}
                              >
                                {
                                  course.code
                                }
                              </span>
                            )}
                            <span className="text-[8px] uppercase tracking-[0.08em] text-white/20">
                              {
                                lecture.source_kind
                              }
                            </span>
                          </div>

                          <p className="mt-1.5 truncate text-[12px] font-medium text-white/66">
                            {
                              lecture.title
                            }
                          </p>

                          <p className="mt-1 text-[8px] text-white/22">
                            {formatDate(
                              lecture.created_at,
                            )}{" "}
                            ·{" "}
                            {formatLongDuration(
                              lecture.duration_seconds,
                            )}
                          </p>
                        </div>

                        <div className="flex items-center gap-3">
                          <StatusPill
                            status={
                              lecture.status
                            }
                          />
                          <ChevronRight
                            size={12}
                            className="text-white/18 transition group-hover:translate-x-0.5 group-hover:text-white/42"
                          />
                        </div>
                      </button>
                    );
                  },
                )}
              </div>
            )}
          </section>
        </div>

        <AnimatePresence>
          {openLecture && (
            <LectureDetail
              lecture={
                openLecture
              }
              course={
                courses.find(
                  (course) =>
                    course.id ===
                    openLecture.course_id,
                ) ?? null
              }
              processing={
                activeProcessing
              }
              onClose={() =>
                setOpenLecture(
                  null,
                )
              }
              onReprocess={() =>
                void reprocessLecture(
                  openLecture,
                )
              }
              onDelete={() =>
                void deleteLecture(
                  openLecture,
                )
              }
            />
          )}
        </AnimatePresence>
      </main>
    </MotionConfig>
  );
}

function FeatureStep({
  icon: Icon,
  title,
  description,
  color,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  color: string;
}) {
  return (
    <div className="flex gap-3">
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[11px]"
        style={{
          backgroundColor: `${color}0D`,
          color,
        }}
      >
        <Icon size={12} />
      </div>
      <div>
        <p className="text-[10px] font-medium text-white/58">
          {title}
        </p>
        <p className="mt-1 text-[8px] leading-4 text-white/26">
          {description}
        </p>
      </div>
    </div>
  );
}

function StatusPill({
  status,
}: {
  status: LectureStatus;
}) {
  const label =
    status === "ready"
      ? "Ready"
      : status ===
          "transcribing"
        ? "Transcribing"
        : status ===
            "analyzing"
          ? "Analyzing"
          : status ===
              "error"
            ? "Error"
            : "Uploaded";

  return (
    <span
      className={`rounded-full border px-2 py-1 text-[7px] font-medium uppercase tracking-[0.08em] ${
        status === "ready"
          ? "border-emerald-300/10 bg-emerald-300/[0.025] text-emerald-200/50"
          : status === "error"
            ? "border-red-300/10 bg-red-300/[0.025] text-red-200/50"
            : "border-white/[0.055] bg-white/[0.012] text-white/24"
      }`}
    >
      {label}
    </span>
  );
}


type LectureChapter = {
  heading: string;
  startSeconds: number;
  endSeconds: number;
};

function formatPlaybackTime(
  seconds: number,
) {
  if (
    !Number.isFinite(seconds) ||
    seconds < 0
  ) {
    return "0:00";
  }

  const rounded =
    Math.floor(seconds);
  const hours =
    Math.floor(
      rounded / 3600,
    );
  const minutes =
    Math.floor(
      (rounded % 3600) /
        60,
    );
  const remainder =
    rounded % 60;

  if (hours > 0) {
    return `${hours}:${String(
      minutes,
    ).padStart(2, "0")}:${String(
      remainder,
    ).padStart(2, "0")}`;
  }

  return `${minutes}:${String(
    remainder,
  ).padStart(2, "0")}`;
}

function normalizeLectureChapters(
  chapters: LectureChapter[],
  duration: number,
) {
  const safeDuration =
    Number.isFinite(duration) &&
    duration > 0
      ? duration
      : Math.max(
          1,
          ...chapters.map(
            (chapter) =>
              chapter.endSeconds,
          ),
        );

  const sorted = chapters
    .map((chapter) => ({
      heading:
        chapter.heading.trim() ||
        "Lecture section",
      startSeconds:
        Math.max(
          0,
          Number(
            chapter.startSeconds,
          ) || 0,
        ),
      endSeconds:
        Math.max(
          0,
          Number(
            chapter.endSeconds,
          ) || 0,
        ),
    }))
    .sort(
      (a, b) =>
        a.startSeconds -
        b.startSeconds,
    );

  return sorted.map(
    (chapter, index) => {
      const nextStart =
        sorted[index + 1]
          ?.startSeconds;

      const end =
        chapter.endSeconds >
        chapter.startSeconds
          ? chapter.endSeconds
          : nextStart &&
              nextStart >
                chapter.startSeconds
            ? nextStart
            : safeDuration;

      return {
        ...chapter,
        startSeconds:
          Math.min(
            chapter.startSeconds,
            safeDuration,
          ),
        endSeconds:
          Math.min(
            Math.max(
              end,
              chapter.startSeconds +
                0.25,
            ),
            safeDuration,
          ),
      };
    },
  );
}

function LectureDetail({
  lecture,
  course,
  processing,
  onClose,
  onReprocess,
  onDelete,
}: {
  lecture: Lecture;
  course: Course | null;
  processing: boolean;
  onClose: () => void;
  onReprocess: () => void;
  onDelete: () => void;
}) {
  const accent =
    course?.color ??
    "#CFAE70";

  const audioRef =
    useRef<HTMLAudioElement | null>(
      null,
    );

  const [audioUrl, setAudioUrl] =
    useState("");
  const [
    audioDuration,
    setAudioDuration,
  ] = useState(
    Number(
      lecture.duration_seconds ??
        0,
    ),
  );
  const [
    currentTime,
    setCurrentTime,
  ] = useState(0);
  const [playing, setPlaying] =
    useState(false);
  const [
    loadingAudio,
    setLoadingAudio,
  ] = useState(true);
  const [
    playbackError,
    setPlaybackError,
  ] = useState("");
  const [
    chunkChapters,
    setChunkChapters,
  ] = useState<LectureChapter[]>(
    [],
  );
  const [
    hoveredChapter,
    setHoveredChapter,
  ] =
    useState<LectureChapter | null>(
      null,
    );

  const materialAnalysis =
    lecture.notes &&
    typeof lecture.notes ===
      "object" &&
    "materialAnalysis" in
      lecture.notes
      ? (lecture.notes
          .materialAnalysis as {
          overview?: string;
          whatToKnow?: string[];
          sections?: Array<{
            heading?: string;
            startSeconds?: number;
            endSeconds?: number;
            explanation?: string;
            keyPoints?: string[];
          }>;
        })
      : null;

  const overview =
    materialAnalysis?.overview ||
    lecture.summary ||
    "";

  const whatToKnow =
    Array.isArray(
      materialAnalysis?.whatToKnow,
    )
      ? materialAnalysis
          .whatToKnow
      : [];

  const analyzedChapters =
    useMemo(() => {
      const sections =
        Array.isArray(
          materialAnalysis?.sections,
        )
          ? materialAnalysis
              .sections
          : [];

      return sections
        .map(
          (
            section,
            index,
          ): LectureChapter | null => {
            const startSeconds =
              Number(
                section.startSeconds ??
                  0,
              );
            const endSeconds =
              Number(
                section.endSeconds ??
                  startSeconds,
              );

            if (
              !Number.isFinite(
                startSeconds,
              )
            ) {
              return null;
            }

            return {
              heading:
                section.heading?.trim() ||
                `Section ${
                  index + 1
                }`,
              startSeconds,
              endSeconds:
                Number.isFinite(
                  endSeconds,
                )
                  ? endSeconds
                  : startSeconds,
            };
          },
        )
        .filter(
          (
            chapter,
          ): chapter is LectureChapter =>
            Boolean(chapter),
        );
    }, [materialAnalysis]);

  const rawChapters =
    analyzedChapters.length > 0
      ? analyzedChapters
      : chunkChapters;

  const chapters =
    useMemo(
      () =>
        normalizeLectureChapters(
          rawChapters,
          audioDuration ||
            Number(
              lecture.duration_seconds ??
                0,
            ),
        ),
      [
        rawChapters,
        audioDuration,
        lecture.duration_seconds,
      ],
    );

  const activeChapterIndex =
    useMemo(() => {
      if (
        chapters.length === 0
      ) {
        return -1;
      }

      let active = 0;

      chapters.forEach(
        (chapter, index) => {
          if (
            currentTime >=
            chapter.startSeconds
          ) {
            active = index;
          }
        },
      );

      return active;
    }, [
      chapters,
      currentTime,
    ]);

  const playbackProgress =
    audioDuration > 0
      ? Math.max(
          0,
          Math.min(
            100,
            (currentTime /
              audioDuration) *
              100,
          ),
        )
      : 0;

  useEffect(() => {
    let cancelled = false;

    async function loadPlayback() {
      setLoadingAudio(true);
      setPlaybackError("");
      setCurrentTime(0);
      setPlaying(false);
      setChunkChapters([]);

      const [
        signedResult,
        chunkResult,
      ] = await Promise.all([
        supabase.storage
          .from("lecture-audio")
          .createSignedUrl(
            lecture.storage_path,
            60 * 60,
          ),
        supabase
          .from(
            "lecture_analysis_chunks",
          )
          .select(
            "chunk_index, start_seconds, end_seconds, memory",
          )
          .eq(
            "lecture_id",
            lecture.id,
          )
          .order(
            "chunk_index",
            {
              ascending: true,
            },
          ),
      ]);

      if (cancelled) {
        return;
      }

      if (
        signedResult.error
      ) {
        setPlaybackError(
          signedResult.error.message ||
            "Could not load lecture audio.",
        );
      } else if (
        signedResult.data
          ?.signedUrl
      ) {
        setAudioUrl(
          signedResult.data
            .signedUrl,
        );
      }

      if (
        chunkResult.error
      ) {
        console.warn(
          "Could not load lecture chapters:",
          chunkResult.error,
        );
      } else {
        const derived: LectureChapter[] =
          [];

        for (
          const chunk of
          chunkResult.data ?? []
        ) {
          const chunkStart =
            Number(
              chunk.start_seconds,
            );
          const chunkEnd =
            Number(
              chunk.end_seconds,
            );

          const memory =
            chunk.memory &&
            typeof chunk.memory ===
              "object" &&
            !Array.isArray(
              chunk.memory,
            )
              ? (chunk.memory as Record<
                  string,
                  unknown
                >)
              : null;

          const memorySections =
            memory &&
            Array.isArray(
              memory.sections,
            )
              ? memory.sections
              : [];

          if (
            memorySections.length >
            0
          ) {
            for (
              const [
                index,
                rawSection,
              ] of memorySections.entries()
            ) {
              if (
                !rawSection ||
                typeof rawSection !==
                  "object" ||
                Array.isArray(
                  rawSection,
                )
              ) {
                continue;
              }

              const section =
                rawSection as Record<
                  string,
                  unknown
                >;

              const start =
                Number(
                  section.startSeconds,
                );
              const end =
                Number(
                  section.endSeconds,
                );

              derived.push({
                heading:
                  typeof section.heading ===
                  "string"
                    ? section.heading
                    : `Section ${
                        derived.length +
                        1
                      }`,
                startSeconds:
                  Number.isFinite(
                    start,
                  )
                    ? start
                    : chunkStart,
                endSeconds:
                  Number.isFinite(
                    end,
                  )
                    ? end
                    : chunkEnd,
              });
            }
          } else {
            derived.push({
              heading: `Section ${
                Number(
                  chunk.chunk_index,
                ) + 1
              }`,
              startSeconds:
                chunkStart,
              endSeconds:
                chunkEnd,
            });
          }
        }

        setChunkChapters(
          derived,
        );
      }

      setLoadingAudio(false);
    }

    void loadPlayback();

    return () => {
      cancelled = true;

      const audio =
        audioRef.current;

      if (audio) {
        audio.pause();
      }
    };
  }, [
    lecture.id,
    lecture.storage_path,
  ]);

  async function togglePlayback() {
    const audio =
      audioRef.current;

    if (!audio) {
      return;
    }

    if (audio.paused) {
      try {
        await audio.play();
      } catch (
        playError
      ) {
        setPlaybackError(
          playError instanceof
            Error
            ? playError.message
            : "Could not play this lecture.",
        );
      }
    } else {
      audio.pause();
    }
  }

  async function seekChapter(
    chapter: LectureChapter,
  ) {
    const audio =
      audioRef.current;

    if (!audio) {
      return;
    }

    audio.currentTime =
      Math.max(
        0,
        chapter.startSeconds,
      );
    setCurrentTime(
      audio.currentTime,
    );

    try {
      await audio.play();
    } catch {
      // The seek itself still succeeded.
    }
  }

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
      className="fixed inset-0 z-[220] flex items-end justify-center bg-black/70 backdrop-blur-lg sm:items-center sm:p-6"
    >
      <motion.div
        initial={{
          opacity: 0,
          y: 20,
          scale: 0.99,
        }}
        animate={{
          opacity: 1,
          y: 0,
          scale: 1,
        }}
        exit={{
          opacity: 0,
          y: 12,
        }}
        className="max-h-[94vh] w-full overflow-y-auto border-t border-white/[0.08] bg-[#101012] shadow-[0_-30px_100px_rgba(0,0,0,0.55)] sm:max-w-[980px] sm:rounded-[26px] sm:border"
      >
        <div className="sticky top-0 z-20 flex items-start justify-between gap-4 border-b border-white/[0.055] bg-[#101012]/95 px-5 py-5 backdrop-blur-xl sm:px-7">
          <div className="min-w-0">
            <p
              className="text-[9px] font-semibold uppercase tracking-[0.12em]"
              style={{
                color: accent,
              }}
            >
              {course?.code ??
                "Lecture"}
            </p>
            <h2 className="mt-2 truncate text-[24px] font-medium tracking-[-0.04em]">
              {lecture.title}
            </h2>
            <p className="mt-2 text-[9px] text-white/26">
              {formatDate(
                lecture.created_at,
              )}{" "}
              ·{" "}
              {formatLongDuration(
                lecture.duration_seconds,
              )}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.035] text-white/34 hover:bg-white/[0.07] hover:text-white/62"
          >
            <X size={12} />
          </button>
        </div>

        <div className="space-y-8 px-5 py-6 sm:px-7">
          {lecture.error_message && (
            <div className="rounded-[15px] border border-red-300/10 bg-red-300/[0.025] px-4 py-3 text-[9px] leading-5 text-red-200/52">
              {lecture.error_message}
            </div>
          )}

          <section className="rounded-[20px] border border-white/[0.06] bg-black/15 p-4 sm:p-5">
            <audio
              ref={audioRef}
              src={audioUrl || undefined}
              preload="metadata"
              onLoadedMetadata={(
                event,
              ) => {
                const duration =
                  event.currentTarget
                    .duration;

                if (
                  Number.isFinite(
                    duration,
                  ) &&
                  duration > 0
                ) {
                  setAudioDuration(
                    duration,
                  );
                }
              }}
              onTimeUpdate={(
                event,
              ) =>
                setCurrentTime(
                  event
                    .currentTarget
                    .currentTime,
                )
              }
              onPlay={() =>
                setPlaying(true)
              }
              onPause={() =>
                setPlaying(false)
              }
              onEnded={() =>
                setPlaying(false)
              }
            />

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() =>
                  void togglePlayback()
                }
                disabled={
                  !audioUrl ||
                  loadingAudio
                }
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-black transition disabled:opacity-30"
                style={{
                  backgroundColor:
                    accent,
                }}
                aria-label={
                  playing
                    ? "Pause lecture"
                    : "Play lecture"
                }
              >
                {loadingAudio ? (
                  <Loader2
                    size={15}
                    className="animate-spin"
                  />
                ) : playing ? (
                  <Pause
                    size={15}
                    fill="currentColor"
                  />
                ) : (
                  <Play
                    size={15}
                    fill="currentColor"
                  />
                )}
              </button>

              <span className="w-[44px] shrink-0 text-right text-[10px] font-medium tabular-nums text-white/42">
                {formatPlaybackTime(
                  currentTime,
                )}
              </span>

              <div className="min-w-0 flex-1">
                <div className="mb-2 min-h-[18px]">
                  <AnimatePresence
                    mode="wait"
                  >
                    {(hoveredChapter ||
                      chapters[
                        activeChapterIndex
                      ]) && (
                      <motion.div
                        key={
                          (
                            hoveredChapter ||
                            chapters[
                              activeChapterIndex
                            ]
                          )?.heading
                        }
                        initial={{
                          opacity: 0,
                          y: 2,
                        }}
                        animate={{
                          opacity: 1,
                          y: 0,
                        }}
                        exit={{
                          opacity: 0,
                        }}
                        className="flex items-center justify-between gap-3"
                      >
                        <p className="truncate text-[9px] font-medium text-white/55">
                          {
                            (
                              hoveredChapter ||
                              chapters[
                                activeChapterIndex
                              ]
                            )?.heading
                          }
                        </p>
                        <p className="shrink-0 text-[8px] tabular-nums text-white/22">
                          {formatPlaybackTime(
                            (
                              hoveredChapter ||
                              chapters[
                                activeChapterIndex
                              ]
                            )?.startSeconds ??
                              0,
                          )}
                        </p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <div className="relative flex h-3 gap-[2px] overflow-visible rounded-full">
                  {chapters.length >
                  0 ? (
                    chapters.map(
                      (
                        chapter,
                        index,
                      ) => {
                        const chapterLength =
                          Math.max(
                            0.25,
                            chapter.endSeconds -
                              chapter.startSeconds,
                          );
                        const active =
                          index ===
                          activeChapterIndex;

                        return (
                          <button
                            key={`${chapter.heading}-${index}`}
                            type="button"
                            title={`${chapter.heading} · ${formatPlaybackTime(
                              chapter.startSeconds,
                            )}`}
                            onMouseEnter={() =>
                              setHoveredChapter(
                                chapter,
                              )
                            }
                            onMouseLeave={() =>
                              setHoveredChapter(
                                null,
                              )
                            }
                            onFocus={() =>
                              setHoveredChapter(
                                chapter,
                              )
                            }
                            onBlur={() =>
                              setHoveredChapter(
                                null,
                              )
                            }
                            onClick={() =>
                              void seekChapter(
                                chapter,
                              )
                            }
                            className="h-3 min-w-[5px] rounded-[4px] border border-white/[0.035] transition hover:brightness-125"
                            style={{
                              flexGrow:
                                chapterLength,
                              flexBasis: 0,
                              backgroundColor:
                                active
                                  ? accent
                                  : currentTime >=
                                      chapter.endSeconds
                                    ? `${accent}80`
                                    : "rgba(255,255,255,0.10)",
                            }}
                            aria-label={`Jump to ${chapter.heading}`}
                          />
                        );
                      },
                    )
                  ) : (
                    <div className="h-3 w-full rounded-full bg-white/[0.08]" />
                  )}

                  <span
                    aria-hidden
                    className="pointer-events-none absolute -top-[3px] h-[18px] w-px bg-white/85 shadow-[0_0_6px_rgba(255,255,255,0.25)]"
                    style={{
                      left: `${playbackProgress}%`,
                    }}
                  />
                </div>
              </div>

              <span className="w-[44px] shrink-0 text-[10px] font-medium tabular-nums text-white/28">
                {formatPlaybackTime(
                  audioDuration,
                )}
              </span>
            </div>

            {playbackError && (
              <p className="mt-3 text-[8px] leading-4 text-red-200/48">
                {playbackError}
              </p>
            )}

            {chapters.length > 0 && (
              <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
                {chapters.map(
                  (
                    chapter,
                    index,
                  ) => (
                    <button
                      key={`${chapter.heading}-chip-${index}`}
                      type="button"
                      onClick={() =>
                        void seekChapter(
                          chapter,
                        )
                      }
                      className={`shrink-0 rounded-[11px] border px-3 py-2 text-left transition ${
                        index ===
                        activeChapterIndex
                          ? "border-white/[0.11] bg-white/[0.045]"
                          : "border-white/[0.045] bg-white/[0.01] hover:border-white/[0.08] hover:bg-white/[0.025]"
                      }`}
                    >
                      <p
                        className="text-[7px] font-semibold uppercase tracking-[0.08em]"
                        style={{
                          color:
                            index ===
                            activeChapterIndex
                              ? accent
                              : undefined,
                        }}
                      >
                        {formatPlaybackTime(
                          chapter.startSeconds,
                        )}
                      </p>
                      <p className="mt-1 max-w-[180px] truncate text-[8px] text-white/38">
                        {chapter.heading}
                      </p>
                    </button>
                  ),
                )}
              </div>
            )}

            <p className="mt-3 text-[8px] leading-4 text-white/18">
              Each segment is a lecture section generated from the timestamped
              analysis chunks. Click any segment to jump directly to that part
              of the recording.
            </p>
          </section>

          <section>
            <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-white/24">
              Overview
            </p>
            <p className="mt-3 text-[12px] leading-6 text-white/50">
              {overview ||
                "This lecture has not produced an overview yet."}
            </p>
          </section>

          {whatToKnow.length >
            0 && (
            <section>
              <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-white/24">
                What to know
              </p>
              <div className="mt-3 space-y-2">
                {whatToKnow.map(
                  (
                    item,
                    index,
                  ) => (
                    <div
                      key={`${item}-${index}`}
                      className="flex gap-3 rounded-[13px] border border-white/[0.045] bg-white/[0.008] px-3 py-3"
                    >
                      <Check
                        size={10}
                        className="mt-1 shrink-0"
                        style={{
                          color:
                            accent,
                        }}
                      />
                      <p className="text-[10px] leading-5 text-white/42">
                        {item}
                      </p>
                    </div>
                  ),
                )}
              </div>
            </section>
          )}

          <section>
            <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-white/24">
              Transcript
            </p>
            <div className="mt-3 max-h-[320px] overflow-y-auto rounded-[16px] border border-white/[0.05] bg-black/15 px-4 py-4">
              <p className="whitespace-pre-wrap text-[10px] leading-6 text-white/40">
                {lecture.transcript_text ||
                  "Transcript not available yet."}
              </p>
            </div>
          </section>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.05] pt-5">
            <button
              type="button"
              onClick={onDelete}
              className="flex items-center gap-2 rounded-full px-3 py-2 text-[9px] text-red-200/38 transition hover:bg-red-300/[0.035] hover:text-red-200/62"
            >
              <Trash2 size={10} />
              Delete
            </button>

            <button
              type="button"
              onClick={onReprocess}
              disabled={
                processing
              }
              className="flex items-center gap-2 rounded-full border border-white/[0.065] bg-white/[0.015] px-3.5 py-2.5 text-[9px] font-medium text-white/42 transition hover:bg-white/[0.04] hover:text-white/64 disabled:opacity-35"
            >
              {processing ? (
                <Loader2
                  size={10}
                  className="animate-spin"
                />
              ) : (
                <RotateCcw
                  size={10}
                />
              )}
              Reprocess
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
