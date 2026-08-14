"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  usePathname,
  useRouter,
} from "next/navigation";
import {
  Mic2,
  Pause,
} from "lucide-react";

export type LectureRecordingStatus =
  | "idle"
  | "requesting"
  | "recording"
  | "paused"
  | "captured"
  | "error";

export type LectureRecordingMeta = {
  courseId: string;
  courseCode: string;
  courseName: string;
  courseColor: string;
  unitId: string | null;
  title: string;
  depthPercent: number;
};

type LectureRecordingContextValue = {
  status: LectureRecordingStatus;
  meta: LectureRecordingMeta | null;
  seconds: number;
  levels: number[];
  file: File | null;
  error: string;
  noteId: string | null;
  isActive: boolean;
  startRecording: (
    meta: LectureRecordingMeta,
  ) => Promise<boolean>;
  pauseRecording: () => void;
  resumeRecording: () => void;
  stopRecording: () => void;
  discardRecording: () => void;
  clearCapturedRecording: () => void;
  updateMeta: (
    patch: Partial<LectureRecordingMeta>,
  ) => void;
  setNoteId: (
    noteId: string | null,
  ) => void;
};

const LectureRecordingContext =
  createContext<LectureRecordingContextValue | null>(
    null,
  );

function preferredRecordingMime() {
  if (
    typeof MediaRecorder === "undefined"
  ) {
    return "";
  }

  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];

  return (
    candidates.find((candidate) =>
      MediaRecorder.isTypeSupported(
        candidate,
      ),
    ) ?? ""
  );
}

function extensionForMime(
  mimeType: string,
) {
  if (
    mimeType.includes("mp4") ||
    mimeType.includes("aac")
  ) {
    return "m4a";
  }

  if (mimeType.includes("ogg")) {
    return "ogg";
  }

  return "webm";
}

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

export function LectureRecordingProvider({
  children,
}: {
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const [status, setStatus] =
    useState<LectureRecordingStatus>(
      "idle",
    );
  const [meta, setMeta] =
    useState<LectureRecordingMeta | null>(
      null,
    );
  const [seconds, setSeconds] =
    useState(0);
  const [levels, setLevels] =
    useState<number[]>(
      () => Array.from({ length: 30 }, () => 0.08),
    );
  const [file, setFile] =
    useState<File | null>(null);
  const [error, setError] =
    useState("");
  const [noteId, setNoteIdState] =
    useState<string | null>(null);

  const recorderRef =
    useRef<MediaRecorder | null>(null);
  const streamRef =
    useRef<MediaStream | null>(null);
  const chunksRef =
    useRef<Blob[]>([]);
  const timerRef =
    useRef<number | null>(null);

  const audioContextRef =
    useRef<AudioContext | null>(null);
  const analyserRef =
    useRef<AnalyserNode | null>(null);
  const analyserSourceRef =
    useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserFrameRef =
    useRef<number | null>(null);
  const analyserDataRef =
    useRef<Uint8Array | null>(null);
  const lastAnalyserPaintRef =
    useRef(0);

  const accumulatedMsRef =
    useRef(0);
  const segmentStartedAtRef =
    useRef<number | null>(null);
  const discardRef =
    useRef(false);

  const isActive =
    status === "requesting" ||
    status === "recording" ||
    status === "paused";

  const stopTimer =
    useCallback(() => {
      if (
        timerRef.current !== null
      ) {
        window.clearInterval(
          timerRef.current,
        );
        timerRef.current = null;
      }
    }, []);

  const elapsedMs =
    useCallback(() => {
      const segment =
        segmentStartedAtRef.current ===
        null
          ? 0
          : Date.now() -
            segmentStartedAtRef.current;

      return (
        accumulatedMsRef.current +
        segment
      );
    }, []);

  const syncTimer =
    useCallback(() => {
      setSeconds(
        Math.max(
          0,
          Math.floor(
            elapsedMs() / 1000,
          ),
        ),
      );
    }, [elapsedMs]);

  const startTimer =
    useCallback(() => {
      stopTimer();
      syncTimer();

      timerRef.current =
        window.setInterval(
          syncTimer,
          500,
        );
    }, [
      stopTimer,
      syncTimer,
    ]);

  const stopTracks =
    useCallback(() => {
      streamRef.current
        ?.getTracks()
        .forEach((track) =>
          track.stop(),
        );

      streamRef.current = null;
    }, []);

  const stopAnalyser =
    useCallback(() => {
      if (
        analyserFrameRef.current !== null
      ) {
        window.cancelAnimationFrame(
          analyserFrameRef.current,
        );
        analyserFrameRef.current = null;
      }

      try {
        analyserSourceRef.current?.disconnect();
      } catch {
        // Already disconnected.
      }

      try {
        analyserRef.current?.disconnect();
      } catch {
        // Already disconnected.
      }

      analyserSourceRef.current = null;
      analyserRef.current = null;
      analyserDataRef.current = null;

      const audioContext =
        audioContextRef.current;

      audioContextRef.current = null;

      if (
        audioContext &&
        audioContext.state !== "closed"
      ) {
        void audioContext.close().catch(
          () => undefined,
        );
      }

      setLevels(
        Array.from(
          { length: 30 },
          () => 0.08,
        ),
      );
    }, []);

  const startAnalyser =
    useCallback(
      async (
        stream: MediaStream,
      ) => {
        stopAnalyser();

        try {
          const audioContext =
            new AudioContext();

          if (
            audioContext.state ===
            "suspended"
          ) {
            await audioContext.resume();
          }

          const analyser =
            audioContext.createAnalyser();

          analyser.fftSize = 256;
          analyser.smoothingTimeConstant =
            0.76;
          analyser.minDecibels = -90;
          analyser.maxDecibels = -18;

          const source =
            audioContext.createMediaStreamSource(
              stream,
            );

          source.connect(analyser);

          const data =
            new Uint8Array(
              new ArrayBuffer(
                analyser.frequencyBinCount,
              ),
            );

          audioContextRef.current =
            audioContext;
          analyserRef.current =
            analyser;
          analyserSourceRef.current =
            source;
          analyserDataRef.current =
            data;
          lastAnalyserPaintRef.current =
            0;

          const paint = (
            timestamp: number,
          ) => {
            const currentAnalyser =
              analyserRef.current;
            const currentData =
              analyserDataRef.current;

            if (
              !currentAnalyser ||
              !currentData
            ) {
              return;
            }

            currentAnalyser.getByteFrequencyData(
              currentData,
            );

            if (
              timestamp -
                lastAnalyserPaintRef.current >=
              45
            ) {
              lastAnalyserPaintRef.current =
                timestamp;

              const usableBins =
                Math.max(
                  24,
                  Math.floor(
                    currentData.length *
                      0.58,
                  ),
                );

              let overall = 0;

              for (
                let index = 0;
                index < usableBins;
                index += 1
              ) {
                overall +=
                  currentData[index] /
                  255;
              }

              overall /=
                usableBins;

              const next =
                Array.from(
                  { length: 30 },
                  (_, barIndex) => {
                    const start =
                      Math.floor(
                        (barIndex /
                          30) *
                          usableBins,
                      );
                    const end =
                      Math.max(
                        start + 1,
                        Math.floor(
                          ((barIndex +
                            1) /
                            30) *
                            usableBins,
                        ),
                      );

                    let total = 0;
                    let count = 0;

                    for (
                      let bin = start;
                      bin <
                      Math.min(
                        end,
                        usableBins,
                      );
                      bin += 1
                    ) {
                      total +=
                        currentData[
                          bin
                        ] / 255;
                      count += 1;
                    }

                    const local =
                      count > 0
                        ? total / count
                        : 0;

                    const shaped =
                      Math.pow(
                        Math.min(
                          1,
                          local * 1.7 +
                            overall * 0.55,
                        ),
                        0.82,
                      );

                    return Math.max(
                      0.055,
                      shaped,
                    );
                  },
                );

              setLevels(next);
            }

            analyserFrameRef.current =
              window.requestAnimationFrame(
                paint,
              );
          };

          analyserFrameRef.current =
            window.requestAnimationFrame(
              paint,
            );
        } catch (
          visualizerError
        ) {
          console.warn(
            "Could not start microphone visualizer:",
            visualizerError,
          );

          setLevels(
            Array.from(
              { length: 30 },
              () => 0.08,
            ),
          );
        }
      },
      [stopAnalyser],
    );

  const resetCore =
    useCallback(() => {
      stopTimer();
      stopAnalyser();
      stopTracks();

      recorderRef.current = null;
      chunksRef.current = [];
      accumulatedMsRef.current = 0;
      segmentStartedAtRef.current =
        null;
      discardRef.current = false;

      setSeconds(0);
      setFile(null);
      setError("");
      setMeta(null);
      setNoteIdState(null);
      setStatus("idle");
    }, [
      stopAnalyser,
      stopTimer,
      stopTracks,
    ]);

  const startRecording =
    useCallback(
      async (
        nextMeta: LectureRecordingMeta,
      ) => {
        if (
          status === "requesting" ||
          status === "recording" ||
          status === "paused"
        ) {
          setError(
            "A lecture recording is already in progress.",
          );
          return false;
        }

        if (
          status === "captured" ||
          status === "error"
        ) {
          resetCore();
        }

        setStatus("requesting");
        setError("");
        setFile(null);
        setNoteIdState(null);
        setMeta(nextMeta);
        setSeconds(0);

        if (
          typeof window ===
            "undefined" ||
          typeof navigator ===
            "undefined" ||
          !navigator.mediaDevices
            ?.getUserMedia ||
          typeof MediaRecorder ===
            "undefined"
        ) {
          setStatus("error");
          setError(
            "This browser cannot record audio with the required browser APIs.",
          );
          return false;
        }

        let stream:
          | MediaStream
          | null = null;

        try {
          /*
           * Keep the initial request intentionally simple.
           * Some browsers/devices reject overly specific audio
           * constraints even when microphone permission is granted.
           */
          stream =
            await navigator.mediaDevices.getUserMedia(
              {
                audio: true,
              },
            );

          const mimeType =
            preferredRecordingMime();

          let recorder:
            | MediaRecorder
            | null = null;

          try {
            recorder = mimeType
              ? new MediaRecorder(
                  stream,
                  { mimeType },
                )
              : new MediaRecorder(
                  stream,
                );
          } catch {
            /*
             * Fallback to the browser default recorder configuration.
             * This handles browsers that claim support for a MIME type
             * but reject it when creating the recorder.
             */
            recorder =
              new MediaRecorder(
                stream,
              );
          }

          streamRef.current =
            stream;
          recorderRef.current =
            recorder;

          await startAnalyser(stream);
          chunksRef.current = [];
          discardRef.current = false;
          accumulatedMsRef.current = 0;
          segmentStartedAtRef.current =
            Date.now();

          recorder.ondataavailable =
            (event) => {
              if (
                event.data &&
                event.data.size > 0
              ) {
                chunksRef.current.push(
                  event.data,
                );
              }
            };

          recorder.onerror = (
            event,
          ) => {
            console.error(
              "MediaRecorder error:",
              event,
            );
            setError(
              "The browser stopped the microphone recorder unexpectedly.",
            );
          };

          recorder.onstop = () => {
            if (
              segmentStartedAtRef.current !==
              null
            ) {
              accumulatedMsRef.current +=
                Date.now() -
                segmentStartedAtRef.current;
              segmentStartedAtRef.current =
                null;
            }

            syncTimer();
            stopTimer();
            stopAnalyser();
            stopTracks();

            if (
              discardRef.current
            ) {
              resetCore();
              return;
            }

            const actualType =
              recorder?.mimeType ||
              mimeType ||
              chunksRef.current[0]
                ?.type ||
              "audio/webm";

            const blob = new Blob(
              chunksRef.current,
              {
                type: actualType,
              },
            );

            if (blob.size <= 0) {
              setStatus("error");
              setError(
                "The microphone started, but the browser returned an empty recording. Try again or use Upload audio.",
              );
              return;
            }

            const extension =
              extensionForMime(
                actualType,
              );

            const capturedFile =
              new File(
                [blob],
                `lecture-${new Date()
                  .toISOString()
                  .replace(
                    /[:.]/g,
                    "-",
                  )}.${extension}`,
                {
                  type: actualType,
                },
              );

            setFile(
              capturedFile,
            );
            setStatus(
              "captured",
            );
          };

          recorder.start(1000);
          setStatus("recording");
          startTimer();

          return true;
        } catch (recordError) {
          stream
            ?.getTracks()
            .forEach((track) =>
              track.stop(),
            );

          stopTimer();
          stopAnalyser();
          stopTracks();

          const namedError =
            recordError as {
              name?: string;
              message?: string;
            };

          let message =
            namedError.message ||
            "Could not start microphone recording.";

          if (
            namedError.name ===
              "NotAllowedError" ||
            namedError.name ===
              "SecurityError"
          ) {
            message =
              "Microphone access was blocked. Allow microphone access for this site in your browser settings, then try Record again.";
          } else if (
            namedError.name ===
            "NotFoundError"
          ) {
            message =
              "No microphone was found. Connect or enable a microphone, then try again.";
          } else if (
            namedError.name ===
            "NotReadableError"
          ) {
            message =
              "Your microphone is available but could not be opened. Another app or browser tab may be using it.";
          }

          setStatus("error");
          setError(message);
          return false;
        }
      },
      [
        resetCore,
        startAnalyser,
        startTimer,
        status,
        stopAnalyser,
        stopTimer,
        stopTracks,
        syncTimer,
      ],
    );

  const pauseRecording =
    useCallback(() => {
      const recorder =
        recorderRef.current;

      if (
        !recorder ||
        recorder.state !==
          "recording"
      ) {
        return;
      }

      if (
        segmentStartedAtRef.current !==
        null
      ) {
        accumulatedMsRef.current +=
          Date.now() -
          segmentStartedAtRef.current;
        segmentStartedAtRef.current =
          null;
      }

      recorder.pause();
      syncTimer();
      stopTimer();
      stopAnalyser();
      setStatus("paused");
    }, [
      stopTimer,
      syncTimer,
    ]);

  const resumeRecording =
    useCallback(() => {
      const recorder =
        recorderRef.current;

      if (
        !recorder ||
        recorder.state !== "paused"
      ) {
        return;
      }

      recorder.resume();
      segmentStartedAtRef.current =
        Date.now();
      setStatus("recording");
      startTimer();

      if (streamRef.current) {
        void startAnalyser(
          streamRef.current,
        );
      }
    }, [
      startAnalyser,
      startTimer,
    ]);

  const stopRecording =
    useCallback(() => {
      const recorder =
        recorderRef.current;

      if (
        !recorder ||
        recorder.state ===
          "inactive"
      ) {
        return;
      }

      try {
        recorder.requestData();
      } catch {
        // Not every browser requires or accepts requestData here.
      }

      stopAnalyser();
      recorder.stop();
    }, [stopAnalyser]);

  const discardRecording =
    useCallback(() => {
      discardRef.current = true;

      const recorder =
        recorderRef.current;

      if (
        recorder &&
        recorder.state !==
          "inactive"
      ) {
        try {
          recorder.stop();
        } catch {
          resetCore();
        }
      } else {
        resetCore();
      }
    }, [resetCore]);

  const clearCapturedRecording =
    useCallback(() => {
      resetCore();
    }, [resetCore]);

  const updateMeta =
    useCallback(
      (
        patch: Partial<LectureRecordingMeta>,
      ) => {
        setMeta((current) =>
          current
            ? {
                ...current,
                ...patch,
              }
            : current,
        );
      },
      [],
    );

  const setNoteId =
    useCallback(
      (
        nextNoteId:
          | string
          | null,
      ) => {
        setNoteIdState(
          nextNoteId,
        );
      },
      [],
    );

  useEffect(() => {
    return () => {
      stopTimer();
      stopAnalyser();
      stopTracks();
    };
  }, [
    stopAnalyser,
    stopTimer,
    stopTracks,
  ]);

  const value = useMemo(
    () => ({
      status,
      meta,
      seconds,
      levels,
      file,
      error,
      noteId,
      isActive,
      startRecording,
      pauseRecording,
      resumeRecording,
      stopRecording,
      discardRecording,
      clearCapturedRecording,
      updateMeta,
      setNoteId,
    }),
    [
      status,
      meta,
      seconds,
      levels,
      file,
      error,
      noteId,
      isActive,
      startRecording,
      pauseRecording,
      resumeRecording,
      stopRecording,
      discardRecording,
      clearCapturedRecording,
      updateMeta,
      setNoteId,
    ],
  );

  const showGlobalBar =
    isActive &&
    pathname !==
      "/lectures/recording";

  return (
    <LectureRecordingContext.Provider
      value={value}
    >
      <div
        className={
          showGlobalBar
            ? "pt-11"
            : ""
        }
      >
        {children}
      </div>

      {showGlobalBar && (
        <button
          type="button"
          onClick={() =>
            router.push(
              "/lectures/recording",
            )
          }
          className="fixed inset-x-0 top-0 z-[250] flex h-11 items-center justify-center border-b border-red-300/10 bg-[#120C0D]/96 px-4 text-left shadow-[0_8px_30px_rgba(0,0,0,0.28)] backdrop-blur-2xl"
        >
          <div className="flex w-full max-w-[1420px] items-center gap-3">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${
                status === "paused"
                  ? "bg-amber-300/80"
                  : "animate-pulse bg-red-400"
              }`}
            />

            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] font-medium text-white/78">
                {status === "paused"
                  ? "Lecture recording paused"
                  : status ===
                      "requesting"
                    ? "Starting microphone"
                    : "Lecture recording in progress"}
              </p>

              <p className="mt-[1px] truncate text-[9px] text-white/32">
                {meta?.courseCode
                  ? `${meta.courseCode} · ${meta.title}`
                  : "Recording continues while you navigate"}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {status ===
              "paused" ? (
                <Pause
                  size={12}
                  className="text-amber-200/70"
                />
              ) : (
                <Mic2
                  size={12}
                  className="text-red-200/70"
                />
              )}

              <span className="min-w-[48px] text-right text-[11px] font-medium tabular-nums text-white/68">
                {formatDuration(
                  seconds,
                )}
              </span>

              <span className="hidden text-[9px] text-white/28 sm:inline">
                Click to return
              </span>
            </div>
          </div>
        </button>
      )}
    </LectureRecordingContext.Provider>
  );
}

export function useLectureRecording() {
  const context = useContext(
    LectureRecordingContext,
  );

  if (!context) {
    throw new Error(
      "useLectureRecording must be used inside LectureRecordingProvider.",
    );
  }

  return context;
}