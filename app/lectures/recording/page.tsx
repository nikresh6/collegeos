"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Check,
  FileText,
  Home,
  Loader2,
  Mic2,
  Pause,
  Play,
  Sparkles,
  Square,
  Trash2,
  X,
} from "lucide-react";
import {
  AnimatePresence,
  MotionConfig,
  motion,
} from "framer-motion";
import { supabase } from "../../../lib/supabase";
import {
  cancelLectureAnalysis,
  createLectureMaterial,
  isLectureAnalysisCancelledError,
  type LecturePipelineStage,
} from "../../../lib/lecture-pipeline";
import {
  SchoolMark,
  useSchoolIdentity,
} from "../../../components/school-identity";
import {
  useLectureRecording,
} from "../../../components/lecture-recording-provider";

type SaveState =
  | "saved"
  | "dirty"
  | "saving"
  | "error";

type ProcessingStage =
  | "idle"
  | "uploading"
  | "transcribing"
  | "analyzing"
  | "ready"
  | "error";

function formatDuration(
  totalSeconds: number,
) {
  const hours = Math.floor(
    totalSeconds / 3600,
  );
  const minutes = Math.floor(
    (totalSeconds % 3600) / 60,
  );
  const seconds =
    totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(
      minutes,
    ).padStart(2, "0")}:${String(
      seconds,
    ).padStart(2, "0")}`;
  }

  return `${minutes}:${String(
    seconds,
  ).padStart(2, "0")}`;
}

export default function LectureRecordingPage() {
  const router = useRouter();
  const { identity } =
    useSchoolIdentity();
  const recording =
    useLectureRecording();

  const [noteTitle, setNoteTitle] =
    useState("");
  const [noteContent, setNoteContent] =
    useState("");
  const [saveState, setSaveState] =
    useState<SaveState>("saved");
  const [noteError, setNoteError] =
    useState("");

  const [
    processingStage,
    setProcessingStage,
  ] =
    useState<ProcessingStage>(
      "idle",
    );
  const [
    processMessage,
    setProcessMessage,
  ] = useState("");
  const [
    uploadProgress,
    setUploadProgress,
  ] = useState(0);
  const [
    processingError,
    setProcessingError,
  ] = useState("");

  const [
    activeLectureId,
    setActiveLectureId,
  ] = useState<string | null>(null);
  const [
    cancellingAnalysis,
    setCancellingAnalysis,
  ] = useState(false);

  const analysisControllerRef =
    useRef<AbortController | null>(null);

  const saveTimerRef =
    useRef<ReturnType<
      typeof setTimeout
    > | null>(null);

  const lastSavedRef =
    useRef("");

  const accent =
    recording.meta?.courseColor ??
    identity.primary;

  const isRecording =
    recording.status ===
    "recording";

  const isPaused =
    recording.status ===
    "paused";

  const isCaptured =
    recording.status ===
    "captured";

  const isProcessing =
    processingStage ===
      "uploading" ||
    processingStage ===
      "transcribing" ||
    processingStage ===
      "analyzing";

  const noteSignature =
    useMemo(
      () =>
        JSON.stringify([
          noteTitle,
          noteContent,
        ]),
      [
        noteTitle,
        noteContent,
      ],
    );

  const saveNote =
    useCallback(async () => {
      if (!recording.meta) {
        return true;
      }

      if (
        noteSignature ===
          lastSavedRef.current &&
        recording.noteId
      ) {
        setSaveState("saved");
        return true;
      }

      if (
        saveTimerRef.current
      ) {
        clearTimeout(
          saveTimerRef.current,
        );
        saveTimerRef.current =
          null;
      }

      setSaveState("saving");
      setNoteError("");

      const title =
        noteTitle.trim() ||
        `Notes · ${recording.meta.title}`;

      try {
        if (recording.noteId) {
          const {
            data,
            error,
          } = await supabase
            .from("notes")
            .update({
              title,
              raw_content:
                noteContent,
              course_id:
                recording.meta
                  .courseId,
            })
            .eq(
              "id",
              recording.noteId,
            )
            .select(
              "id, title, raw_content",
            )
            .single();

          if (error) {
            throw error;
          }

          setNoteTitle(
            data.title ?? title,
          );
          setNoteContent(
            data.raw_content ?? "",
          );
        } else {
          const {
            data: {
              session,
            },
            error:
              sessionError,
          } =
            await supabase.auth.getSession();

          if (sessionError) {
            throw sessionError;
          }

          if (!session) {
            throw new Error(
              "You are not signed in.",
            );
          }

          const {
            data,
            error,
          } = await supabase
            .from("notes")
            .insert({
              user_id:
                session.user.id,
              course_id:
                recording.meta
                  .courseId,
              lecture_id: null,
              title,
              raw_content:
                noteContent,
            })
            .select(
              "id, title, raw_content",
            )
            .single();

          if (error) {
            throw error;
          }

          recording.setNoteId(
            data.id,
          );
          setNoteTitle(
            data.title ?? title,
          );
          setNoteContent(
            data.raw_content ?? "",
          );
        }

        lastSavedRef.current =
          JSON.stringify([
            title,
            noteContent,
          ]);
        setSaveState("saved");
        return true;
      } catch (saveError) {
        console.error(
          "Could not save live lecture note:",
          saveError,
        );

        setSaveState("error");
        setNoteError(
          saveError instanceof Error
            ? saveError.message
            : "Could not save the note.",
        );
        return false;
      }
    }, [
      noteContent,
      noteSignature,
      noteTitle,
      recording.meta,
      recording.noteId,
      recording.setNoteId,
    ]);

  useEffect(() => {
    if (!recording.meta) {
      return;
    }

    if (!noteTitle) {
      setNoteTitle(
        `Notes · ${recording.meta.title}`,
      );
    }
  }, [
    noteTitle,
    recording.meta,
  ]);

  useEffect(() => {
    if (
      !recording.meta ||
      recording.noteId
    ) {
      return;
    }

    void saveNote();
  }, [
    recording.meta,
    recording.noteId,
    saveNote,
  ]);

  useEffect(() => {
    if (!recording.noteId) {
      return;
    }

    if (
      noteSignature ===
      lastSavedRef.current
    ) {
      return;
    }

    setSaveState("dirty");

    if (
      saveTimerRef.current
    ) {
      clearTimeout(
        saveTimerRef.current,
      );
    }

    saveTimerRef.current =
      setTimeout(() => {
        void saveNote();
      }, 700);

    return () => {
      if (
        saveTimerRef.current
      ) {
        clearTimeout(
          saveTimerRef.current,
        );
      }
    };
  }, [
    noteSignature,
    recording.noteId,
    saveNote,
  ]);

  useEffect(() => {
    async function loadExistingNote() {
      if (!recording.noteId) {
        return;
      }

      const {
        data,
        error,
      } = await supabase
        .from("notes")
        .select(
          "id, title, raw_content",
        )
        .eq(
          "id",
          recording.noteId,
        )
        .maybeSingle();

      if (error) {
        setNoteError(
          error.message,
        );
        return;
      }

      if (data) {
        setNoteTitle(
          data.title ?? "",
        );
        setNoteContent(
          data.raw_content ?? "",
        );
        lastSavedRef.current =
          JSON.stringify([
            data.title ?? "",
            data.raw_content ??
              "",
          ]);
        setSaveState("saved");
      }
    }

    void loadExistingNote();
  }, [recording.noteId]);

  async function leaveRecordingRoom() {
    await saveNote();

    router.push("/");
  }

  async function processRecording() {
    if (
      !recording.file ||
      !recording.meta ||
      isProcessing
    ) {
      return;
    }

    const saved =
      await saveNote();

    if (!saved) {
      return;
    }

    const analysisController =
      new AbortController();

    analysisControllerRef.current =
      analysisController;
    setActiveLectureId(null);

    try {
      setProcessingError("");
      setUploadProgress(0);
      setProcessMessage("");

      const handleStage = (
        stage:
          LecturePipelineStage,
        message: string,
      ) => {
        setProcessingStage(
          stage,
        );
        setProcessMessage(
          message,
        );
      };

      const created =
        await createLectureMaterial({
          file: recording.file,
          courseId:
            recording.meta
              .courseId,
          unitId:
            recording.meta
              .unitId,
          title:
            recording.meta.title,
          sourceKind:
            "recording",
          depthPercent:
            recording.meta
              .depthPercent,
          durationSeconds:
            recording.seconds ||
            null,
          noteId:
            recording.noteId,
          onLectureCreated: (lectureId) => {
            setActiveLectureId(lectureId);
          },
          analysisSignal:
            analysisController.signal,
          onStage: handleStage,
          onUploadProgress:
            setUploadProgress,
        });

      setProcessingStage(
        "analyzing",
      );
      setProcessMessage(
        "AI analysis is running in the background. You can leave this page.",
      );

      recording.clearCapturedRecording();

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
        "Could not process recorded lecture:",
        processError,
      );

      setProcessingStage(
        "error",
      );
      setProcessingError(
        processError instanceof
          Error
          ? processError.message
          : "Could not process the lecture.",
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
      !activeLectureId ||
      cancellingAnalysis
    ) {
      return;
    }

    try {
      setCancellingAnalysis(true);
      setProcessMessage(
        "Cancelling AI analysis…",
      );

      await cancelLectureAnalysis({
        lectureId: activeLectureId,
        controller:
          analysisControllerRef.current,
      });

      const cancelledLectureId =
        activeLectureId;

      recording.clearCapturedRecording();
      router.push(
        `/lectures/${cancelledLectureId}`,
      );
    } catch (cancelError) {
      console.error(
        "Could not cancel lecture analysis:",
        cancelError,
      );

      setProcessingError(
        cancelError instanceof Error
          ? cancelError.message
          : "Could not cancel analysis.",
      );
    } finally {
      setCancellingAnalysis(false);
    }
  }

  function leaveFinishedRecording() {
    recording.clearCapturedRecording();
    router.push("/lectures");
  }

  if (!recording.meta) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#080809] px-5 text-[#F5F5F7]">
        <div className="max-w-md text-center">
          <Mic2
            size={22}
            className="mx-auto text-white/24"
          />
          <h1 className="mt-5 text-[24px] font-medium tracking-[-0.04em]">
            No active recording.
          </h1>
          <p className="mt-3 text-[12px] leading-6 text-white/36">
            Start a live lecture from the Lectures page.
          </p>
          <button
            type="button"
            onClick={() =>
              router.push(
                "/lectures",
              )
            }
            className="mt-6 rounded-full bg-white px-4 py-2.5 text-[11px] font-medium text-black"
          >
            Open Lectures
          </button>
        </div>
      </main>
    );
  }

  return (
    <MotionConfig reducedMotion="user">
      <main className="relative min-h-screen overflow-hidden bg-[#080809] text-[#F5F5F7]">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[620px] opacity-[0.14]"
          style={{
            background: `radial-gradient(circle at 24% 0%, ${accent}55 0%, transparent 58%)`,
          }}
        />

        <div className="relative flex min-h-screen flex-col">
          <header className="flex min-h-[72px] items-center justify-between gap-4 border-b border-white/[0.06] px-4 sm:px-6 lg:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={() =>
                  void leaveRecordingRoom()
                }
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/[0.07] bg-white/[0.02] text-white/42 transition hover:bg-white/[0.05] hover:text-white/72"
                aria-label="Exit recording room"
              >
                <ArrowLeft
                  size={14}
                />
              </button>

              <SchoolMark
                size={34}
                quiet
              />

              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      isPaused
                        ? "bg-amber-300/80"
                        : isCaptured
                          ? "bg-emerald-300/70"
                          : "animate-pulse bg-red-400"
                    }`}
                  />
                  <p className="truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-white/36">
                    {isPaused
                      ? "Paused"
                      : isCaptured
                        ? "Recording complete"
                        : recording.status ===
                            "requesting"
                          ? "Starting microphone"
                          : "Recording"}
                  </p>
                </div>
                <p className="mt-1 truncate text-[11px] text-white/58">
                  {
                    recording.meta
                      .courseCode
                  }{" "}
                  ·{" "}
                  {
                    recording.meta
                      .title
                  }
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() =>
                void leaveRecordingRoom()
              }
              className="hidden items-center gap-2 rounded-full border border-white/[0.065] bg-white/[0.018] px-3.5 py-2 text-[10px] font-medium text-white/42 transition hover:bg-white/[0.045] hover:text-white/68 sm:flex"
            >
              <Home size={11} />
              Exit to Home
            </button>
          </header>

          <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(360px,0.78fr)_minmax(0,1.22fr)]">
            <section className="relative flex min-h-[430px] flex-col justify-between border-b border-white/[0.06] px-5 py-6 sm:px-8 sm:py-8 lg:border-b-0 lg:border-r lg:px-10 lg:py-10">
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-white/28">
                  Live lecture
                </p>

                <input
                  value={
                    recording.meta
                      .title
                  }
                  disabled={
                    isCaptured ||
                    isProcessing
                  }
                  onChange={(
                    event,
                  ) =>
                    recording.updateMeta(
                      {
                        title:
                          event
                            .target
                            .value,
                      },
                    )
                  }
                  className="mt-3 w-full border-0 bg-transparent text-[28px] font-medium tracking-[-0.045em] text-white/88 outline-none disabled:opacity-60 sm:text-[34px]"
                />

                <p className="mt-2 text-[11px] text-white/30">
                  {
                    recording.meta
                      .courseName
                  }
                </p>
              </div>

              <div className="py-8 text-center lg:py-10">
                <div
                  className={`mx-auto flex h-24 w-24 items-center justify-center rounded-full border ${
                    isPaused
                      ? "border-amber-300/15 bg-amber-300/[0.035]"
                      : isCaptured
                        ? "border-emerald-300/15 bg-emerald-300/[0.035]"
                        : "border-red-300/15 bg-red-300/[0.035]"
                  }`}
                >
                  {isCaptured ? (
                    <Check
                      size={30}
                      className="text-emerald-200/70"
                    />
                  ) : isPaused ? (
                    <Pause
                      size={28}
                      className="text-amber-200/70"
                    />
                  ) : (
                    <Mic2
                      size={30}
                      className="text-red-200/70"
                    />
                  )}
                </div>

                <p className="mt-7 text-[64px] font-medium leading-none tracking-[-0.065em] tabular-nums text-white/92 sm:text-[76px]">
                  {formatDuration(
                    recording.seconds,
                  )}
                </p>

                <p className="mt-3 text-[10px] font-medium uppercase tracking-[0.14em] text-white/28">
                  {isCaptured
                    ? "Captured"
                    : isPaused
                      ? "Recording paused"
                      : "Recording in progress"}
                </p>

                <div className="mx-auto mt-8 flex h-[70px] max-w-md items-center justify-center gap-[3px] overflow-hidden">
                  {recording.levels.map(
                    (
                      level,
                      index,
                    ) => (
                      <span
                        key={index}
                        className="w-[3px] flex-1 rounded-full bg-white/12 transition-[height,opacity] duration-75 ease-out"
                        style={{
                          maxWidth: 5,
                          height: `${Math.max(
                            7,
                            Math.min(
                              100,
                              level * 100,
                            ),
                          )}%`,
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
                              ? Math.max(
                                  0.35,
                                  Math.min(
                                    0.95,
                                    level +
                                      0.28,
                                  ),
                                )
                              : Math.max(
                                  0.2,
                                  Math.min(
                                    0.72,
                                    level +
                                      0.16,
                                  ),
                                ),
                        }}
                      />
                    ),
                  )}
                </div>
              </div>

              <div>
                <AnimatePresence>
                  {(recording.error ||
                    processingError) && (
                    <motion.div
                      initial={{
                        opacity: 0,
                        y: 4,
                      }}
                      animate={{
                        opacity: 1,
                        y: 0,
                      }}
                      exit={{
                        opacity: 0,
                      }}
                      className="mb-4 rounded-[15px] border border-red-400/15 bg-red-400/[0.035] px-4 py-3"
                    >
                      <p className="text-[9px] leading-5 text-red-200/62">
                        {processingError ||
                          recording.error}
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>

                {isCaptured ? (
                  <div className="space-y-3">
                    {isProcessing && (
                      <div className="rounded-[16px] border border-white/[0.06] bg-white/[0.015] px-4 py-3.5">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-[10px] font-medium text-white/58">
                            {processMessage ||
                              "Processing lecture"}
                          </p>
                          <Loader2
                            size={12}
                            className="animate-spin text-white/36"
                          />
                        </div>

                        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
                          <div
                            className="h-full rounded-full transition-all duration-300"
                            style={{
                              width: `${
                                processingStage ===
                                "uploading"
                                  ? Math.max(
                                      4,
                                      uploadProgress,
                                    )
                                  : processingStage ===
                                      "transcribing"
                                    ? 68
                                    : processingStage ===
                                        "analyzing"
                                      ? 88
                                      : 100
                              }%`,
                              backgroundColor:
                                accent,
                            }}
                          />
                        </div>

                        {processingStage ===
                          "analyzing" &&
                          activeLectureId && (
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
                        void processRecording()
                      }
                      disabled={
                        isProcessing
                      }
                      className="flex w-full items-center justify-center gap-2 rounded-full bg-white px-4 py-3 text-[11px] font-medium text-black transition hover:bg-white/90 disabled:opacity-35"
                    >
                      {isProcessing ? (
                        <Loader2
                          size={12}
                          className="animate-spin"
                        />
                      ) : (
                        <Sparkles
                          size={12}
                        />
                      )}
                      {isProcessing
                        ? "Creating transcript & notes"
                        : "Create transcript & AI notes"}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        recording.discardRecording();
                        router.push(
                          "/lectures",
                        );
                      }}
                      disabled={
                        isProcessing
                      }
                      className="flex w-full items-center justify-center gap-2 rounded-full border border-white/[0.065] px-4 py-3 text-[10px] font-medium text-white/34 transition hover:bg-white/[0.025] hover:text-white/58 disabled:opacity-35"
                    >
                      <Trash2
                        size={11}
                      />
                      Discard recording
                    </button>

                    {processingStage ===
                      "error" && (
                      <button
                        type="button"
                        onClick={
                          leaveFinishedRecording
                        }
                        className="flex w-full items-center justify-center rounded-full border border-white/[0.065] px-4 py-3 text-[10px] font-medium text-white/42 transition hover:bg-white/[0.025] hover:text-white/64"
                      >
                        Return to Lectures and start another
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    {isPaused ? (
                      <button
                        type="button"
                        onClick={
                          recording.resumeRecording
                        }
                        className="flex flex-1 items-center justify-center gap-2 rounded-full bg-white px-4 py-3 text-[11px] font-medium text-black"
                      >
                        <Play
                          size={12}
                          fill="currentColor"
                        />
                        Resume
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={
                          recording.pauseRecording
                        }
                        disabled={
                          !isRecording
                        }
                        className="flex flex-1 items-center justify-center gap-2 rounded-full border border-white/[0.075] bg-white/[0.02] px-4 py-3 text-[11px] font-medium text-white/56 transition hover:bg-white/[0.05] disabled:opacity-30"
                      >
                        <Pause
                          size={12}
                        />
                        Pause
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={
                        recording.stopRecording
                      }
                      disabled={
                        !isRecording &&
                        !isPaused
                      }
                      className="flex flex-1 items-center justify-center gap-2 rounded-full bg-red-300/90 px-4 py-3 text-[11px] font-medium text-black transition hover:bg-red-200 disabled:opacity-30"
                    >
                      <Square
                        size={11}
                        fill="currentColor"
                      />
                      Finish
                    </button>
                  </div>
                )}

                <p className="mt-4 text-center text-[8px] leading-4 text-white/18">
                  You can leave this screen and navigate normally. The recording
                  continues. Refreshing or closing the browser tab still ends the
                  browser recording session.
                </p>
              </div>
            </section>

            <section className="min-h-0 bg-[#0B0B0D]">
              <div className="flex h-full flex-col">
                <div className="flex min-h-[72px] items-center justify-between gap-4 border-b border-white/[0.055] px-5 sm:px-7">
                  <div className="flex items-center gap-3">
                    <div
                      className="flex h-8 w-8 items-center justify-center rounded-[11px]"
                      style={{
                        backgroundColor: `${accent}10`,
                        color:
                          accent,
                      }}
                    >
                      <FileText
                        size={13}
                      />
                    </div>
                    <div>
                      <p className="text-[11px] font-medium text-white/68">
                        Live notes
                      </p>
                      <p className="mt-1 text-[8px] text-white/24">
                        Your own notes, saved continuously
                      </p>
                    </div>
                  </div>

                  <div
                    className={`flex items-center gap-1.5 text-[8px] ${
                      saveState ===
                      "error"
                        ? "text-red-200/52"
                        : "text-white/24"
                    }`}
                  >
                    {saveState ===
                    "saving" ? (
                      <Loader2
                        size={9}
                        className="animate-spin"
                      />
                    ) : saveState ===
                      "saved" ? (
                      <Check
                        size={9}
                      />
                    ) : (
                      <span className="h-1.5 w-1.5 rounded-full bg-white/20" />
                    )}
                    {saveState ===
                    "saving"
                      ? "Saving"
                      : saveState ===
                          "dirty"
                        ? "Unsaved"
                        : saveState ===
                            "error"
                          ? "Save failed"
                          : "Saved"}
                  </div>
                </div>

                <div className="flex min-h-0 flex-1 flex-col px-5 py-5 sm:px-8 sm:py-7 lg:px-10">
                  <input
                    value={
                      noteTitle
                    }
                    onChange={(
                      event,
                    ) =>
                      setNoteTitle(
                        event.target
                          .value,
                      )
                    }
                    onBlur={() =>
                      void saveNote()
                    }
                    placeholder="Lecture notes"
                    className="w-full border-0 bg-transparent text-[26px] font-medium tracking-[-0.04em] text-white/86 outline-none placeholder:text-white/14 sm:text-[32px]"
                  />

                  <textarea
                    value={
                      noteContent
                    }
                    onChange={(
                      event,
                    ) =>
                      setNoteContent(
                        event.target
                          .value,
                      )
                    }
                    onBlur={() =>
                      void saveNote()
                    }
                    placeholder={
                      "Write exactly what you want to remember.\n\n• Important idea\n• Professor says this will be on the exam\n• Question to revisit\n• Formula or example\n\nAI enhancement comes later. For now, capture what matters."
                    }
                    spellCheck
                    className="mt-6 min-h-[430px] flex-1 resize-none border-0 bg-transparent text-[14px] leading-7 text-white/58 outline-none placeholder:text-white/13 sm:text-[15px] sm:leading-8"
                  />

                  {noteError && (
                    <div className="mt-4 flex items-start gap-2 rounded-[13px] border border-red-400/10 bg-red-400/[0.025] px-3 py-2.5">
                      <X
                        size={10}
                        className="mt-1 shrink-0 text-red-200/42"
                      />
                      <p className="text-[8px] leading-4 text-red-200/48">
                        {
                          noteError
                        }
                      </p>
                    </div>
                  )}

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.05] pt-4">
                    <p className="text-[8px] text-white/18">
                      {
                        noteContent
                          .trim()
                          .split(/\s+/)
                          .filter(
                            Boolean,
                          ).length
                      }{" "}
                      words
                    </p>

                    <p className="text-[8px] text-white/18">
                      Attached to{" "}
                      {
                        recording.meta
                          .courseCode
                      }
                    </p>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      </main>
    </MotionConfig>
  );
}