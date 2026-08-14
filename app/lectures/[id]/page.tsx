"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  useParams,
  useRouter,
} from "next/navigation";
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronRight,
  Clock3,
  FileText,
  Headphones,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Sparkles,
  Trash2,
  Volume2,
  Square,
} from "lucide-react";
import {
  AnimatePresence,
  MotionConfig,
  motion,
} from "framer-motion";
import { supabase } from "../../../lib/supabase";
import {
  cancelLectureAnalysis,
  isLectureAnalysisCancelledError,
  reprocessLectureMaterial,
  type LecturePipelineStage,
} from "../../../lib/lecture-pipeline";
import {
  SchoolMark,
  useSchoolIdentity,
} from "../../../components/school-identity";
import {
  SourceProvenance,
} from "../../../components/source-provenance";

type Course = {
  id: string;
  code: string;
  name: string;
  color: string;
  professor: string | null;
};

type Lecture = {
  id: string;
  user_id: string;
  course_id: string;
  unit_id: string | null;
  course_file_id: string | null;
  title: string;
  source_kind: "recording" | "upload";
  file_name: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  duration_seconds: number | null;
  notes_depth_percent: number;
  status:
    | "uploaded"
    | "transcribing"
    | "analyzing"
    | "ready"
    | "error";
  analysis_stage: string;
  analysis_progress: number;
  transcript_text: string | null;
  summary: string | null;
  notes: Record<string, unknown>;
  error_message: string | null;
  captured_at: string;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
};

type MaterialAnalysisContent = {
  detailLevel:
    | "skim"
    | "standard"
    | "deep";
  detailPercent?: number;
  sourceKind?: "lecture";
  title: string;
  overview: string;
  whatToKnow: string[];
  sections: Array<{
    heading: string;
    explanation: string;
    keyPoints: string[];
    relatedTopicIds: string[];
    startSeconds?: number;
    endSeconds?: number;
  }>;
  quickChecks: Array<{
    question: string;
    choices: string[];
    correctIndex: number;
    explanation: string;
    relatedTopicIds: string[];
  }>;
  studyTips: string[];
  topicNotes: Array<{
    topicId: string;
    summary: string;
    keyPoints: string[];
  }>;
  confidence: number;
};

type SavedAnalysis = {
  id: string;
  summary: string | null;
  explanation: string | null;
  raw_analysis: MaterialAnalysisContent | null;
  status: string;
  model: string | null;
  analyzed_at: string | null;
  updated_at: string;
};

type Note = {
  id: string;
  title: string;
  raw_content: string;
  updated_at: string;
};

type LinkedTopic = {
  id: string;
  name: string;
  confidence: number | null;
};

type Chapter = {
  heading: string;
  startSeconds: number;
  endSeconds: number;
};

type ChunkRow = {
  chunk_index: number;
  start_seconds: number;
  end_seconds: number;
  memory: unknown;
};

type SaveState =
  | "saved"
  | "dirty"
  | "saving"
  | "error";

function isRecord(
  value: unknown,
): value is Record<
  string,
  unknown
> {
  return (
    typeof value ===
      "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function stringArray(
  value: unknown,
) {
  return Array.isArray(value)
    ? value.filter(
        (
          item,
        ): item is string =>
          typeof item ===
          "string",
      )
    : [];
}

function formatPlaybackTime(
  seconds: number,
) {
  if (
    !Number.isFinite(
      seconds,
    ) ||
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
      (rounded %
        3600) /
        60,
    );
  const remainder =
    rounded % 60;

  if (hours > 0) {
    return `${hours}:${String(
      minutes,
    ).padStart(
      2,
      "0",
    )}:${String(
      remainder,
    ).padStart(
      2,
      "0",
    )}`;
  }

  return `${minutes}:${String(
    remainder,
  ).padStart(2, "0")}`;
}

function formatDate(
  value: string,
) {
  const date =
    new Date(value);

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
      year: "numeric",
    },
  ).format(date);
}

function formatDuration(
  value:
    | number
    | null,
) {
  if (
    !value ||
    value <= 0
  ) {
    return "Duration unavailable";
  }

  const minutes =
    Math.round(
      value / 60,
    );

  if (minutes < 60) {
    return `${Math.max(
      1,
      minutes,
    )} min`;
  }

  const hours =
    Math.floor(
      minutes / 60,
    );
  const remainder =
    minutes % 60;

  return remainder
    ? `${hours}h ${remainder}m`
    : `${hours}h`;
}

function normalizeChapters(
  chapters: Chapter[],
  duration: number,
) {
  const safeDuration =
    duration > 0
      ? duration
      : Math.max(
          1,
          ...chapters.map(
            (chapter) =>
              chapter.endSeconds,
          ),
        );

  const sorted =
    chapters
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
    (
      chapter,
      index,
    ) => {
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

function fallbackAnalysisFromLecture(
  lecture: Lecture,
): MaterialAnalysisContent | null {
  const lectureNotes =
    isRecord(
      lecture.notes,
    )
      ? lecture.notes
      : {};

  const candidate =
    lectureNotes.materialAnalysis;

  return isRecord(
    candidate,
  )
    ? (candidate as unknown as MaterialAnalysisContent)
    : null;
}

function noteWasUsed(
  lecture: Lecture,
) {
  return (
    isRecord(
      lecture.notes,
    ) &&
    lecture.notes
      .userNotesUsed ===
      true
  );
}

function lectureTerms(
  lecture: Lecture,
) {
  if (
    !isRecord(
      lecture.notes,
    )
  ) {
    return [];
  }

  const terms =
    lecture.notes.terms;

  if (
    !Array.isArray(
      terms,
    )
  ) {
    return [];
  }

  return terms
    .map((term) => {
      if (
        !isRecord(term)
      ) {
        return null;
      }

      const name =
        typeof term.term ===
        "string"
          ? term.term
          : "";

      const definition =
        typeof term.definition ===
        "string"
          ? term.definition
          : "";

      return name &&
        definition
        ? {
            term: name,
            definition,
          }
        : null;
    })
    .filter(
      (
        item,
      ): item is {
        term: string;
        definition: string;
      } =>
        Boolean(item),
    );
}

function lectureSignals(
  lecture: Lecture,
) {
  if (
    !isRecord(
      lecture.notes,
    )
  ) {
    return [];
  }

  const signals =
    lecture.notes
      .studySignals;

  if (
    !Array.isArray(
      signals,
    )
  ) {
    return [];
  }

  return signals
    .map((signal) => {
      if (
        !isRecord(
          signal,
        )
      ) {
        return null;
      }

      const label =
        typeof signal.label ===
        "string"
          ? signal.label
          : "";

      const explanation =
        typeof signal.explanation ===
        "string"
          ? signal.explanation
          : "";

      const startSeconds =
        Number(
          signal.startSeconds,
        );

      return label &&
        explanation
        ? {
            label,
            explanation,
            startSeconds:
              Number.isFinite(
                startSeconds,
              )
                ? startSeconds
                : 0,
          }
        : null;
    })
    .filter(
      (
        item,
      ): item is {
        label: string;
        explanation: string;
        startSeconds: number;
      } =>
        Boolean(item),
    );
}

function chaptersFromChunks(
  chunks: ChunkRow[],
) {
  const chapters:
    Chapter[] = [];

  for (
    const chunk of chunks
  ) {
    const memory =
      isRecord(
        chunk.memory,
      )
        ? chunk.memory
        : null;

    const sections =
      memory &&
      Array.isArray(
        memory.sections,
      )
        ? memory.sections
        : [];

    if (
      sections.length >
      0
    ) {
      for (
        const rawSection of sections
      ) {
        if (
          !isRecord(
            rawSection,
          )
        ) {
          continue;
        }

        const heading =
          typeof rawSection.heading ===
          "string"
            ? rawSection.heading
            : `Section ${
                chapters.length +
                1
              }`;

        const start =
          Number(
            rawSection.startSeconds,
          );
        const end =
          Number(
            rawSection.endSeconds,
          );

        chapters.push({
          heading,
          startSeconds:
            Number.isFinite(
              start,
            )
              ? start
              : chunk.start_seconds,
          endSeconds:
            Number.isFinite(
              end,
            )
              ? end
              : chunk.end_seconds,
        });
      }
    } else {
      chapters.push({
        heading: `Section ${
          chunk.chunk_index +
          1
        }`,
        startSeconds:
          chunk.start_seconds,
        endSeconds:
          chunk.end_seconds,
      });
    }
  }

  return chapters;
}

export default function LectureSummaryPage() {
  const params =
    useParams();
  const router =
    useRouter();
  const {
    identity,
  } =
    useSchoolIdentity();

  const lectureId =
    String(
      params.id ?? "",
    );

  const audioRef =
    useRef<HTMLAudioElement | null>(
      null,
    );
  const noteTimerRef =
    useRef<ReturnType<
      typeof setTimeout
    > | null>(null);
  const lastSavedNoteRef =
    useRef("");
  const analysisControllerRef =
    useRef<AbortController | null>(null);

  const [
    loading,
    setLoading,
  ] = useState(true);
  const [
    error,
    setError,
  ] = useState("");

  const [
    lecture,
    setLecture,
  ] =
    useState<Lecture | null>(
      null,
    );
  const [
    course,
    setCourse,
  ] =
    useState<Course | null>(
      null,
    );
  const [
    savedAnalysis,
    setSavedAnalysis,
  ] =
    useState<SavedAnalysis | null>(
      null,
    );
  const [
    linkedTopics,
    setLinkedTopics,
  ] =
    useState<LinkedTopic[]>(
      [],
    );
  const [
    chunks,
    setChunks,
  ] =
    useState<ChunkRow[]>(
      [],
    );

  const [
    noteId,
    setNoteId,
  ] =
    useState<string | null>(
      null,
    );
  const [
    noteContent,
    setNoteContent,
  ] = useState("");
  const [
    noteUpdatedAt,
    setNoteUpdatedAt,
  ] =
    useState<string | null>(
      null,
    );
  const [
    saveState,
    setSaveState,
  ] =
    useState<SaveState>(
      "saved",
    );

  const [
    audioUrl,
    setAudioUrl,
  ] = useState("");
  const [
    audioDuration,
    setAudioDuration,
  ] = useState(0);
  const [
    currentTime,
    setCurrentTime,
  ] = useState(0);
  const [
    playing,
    setPlaying,
  ] = useState(false);

  const [
    rebuilding,
    setRebuilding,
  ] = useState(false);
  const [
    cancellingAnalysis,
    setCancellingAnalysis,
  ] = useState(false);
  const [
    rebuildMessage,
    setRebuildMessage,
  ] = useState("");

  const [
    deleteConfirmation,
    setDeleteConfirmation,
  ] = useState(false);
  const [
    deletingLecture,
    setDeletingLecture,
  ] = useState(false);

  const [
    selectedAnswers,
    setSelectedAnswers,
  ] = useState<
    Record<
      number,
      number
    >
  >({});

  const analysis =
    useMemo(
      () =>
        savedAnalysis
          ?.raw_analysis ??
        (lecture
          ? fallbackAnalysisFromLecture(
              lecture,
            )
          : null),
      [
        lecture,
        savedAnalysis,
      ],
    );

  const accent =
    course?.color ??
    identity.primary;

  const terms =
    useMemo(
      () =>
        lecture
          ? lectureTerms(
              lecture,
            )
          : [],
      [lecture],
    );

  const studySignals =
    useMemo(
      () =>
        lecture
          ? lectureSignals(
              lecture,
            )
          : [],
      [lecture],
    );

  const rawChapters =
    useMemo(() => {
      if (
        analysis?.sections
          ?.length
      ) {
        return analysis.sections
          .map(
            (
              section,
              index,
            ) => {
              const start =
                Number(
                  section.startSeconds,
                );
              const end =
                Number(
                  section.endSeconds,
                );

              if (
                !Number.isFinite(
                  start,
                )
              ) {
                return null;
              }

              return {
                heading:
                  section.heading ||
                  `Section ${
                    index + 1
                  }`,
                startSeconds:
                  start,
                endSeconds:
                  Number.isFinite(
                    end,
                  )
                    ? end
                    : start,
              };
            },
          )
          .filter(
            (
              item,
            ): item is Chapter =>
              Boolean(item),
          );
      }

      return chaptersFromChunks(
        chunks,
      );
    }, [
      analysis,
      chunks,
    ]);

  const chapters =
    useMemo(
      () =>
        normalizeChapters(
          rawChapters,
          audioDuration ||
            lecture?.duration_seconds ||
            0,
        ),
      [
        rawChapters,
        audioDuration,
        lecture
          ?.duration_seconds,
      ],
    );

  const activeChapterIndex =
    useMemo(() => {
      if (
        chapters.length ===
        0
      ) {
        return -1;
      }

      let active = 0;

      chapters.forEach(
        (
          chapter,
          index,
        ) => {
          if (
            currentTime >=
            chapter.startSeconds
          ) {
            active =
              index;
          }
        },
      );

      return active;
    }, [
      chapters,
      currentTime,
    ]);

  const noteChangedSinceAnalysis =
    useMemo(() => {
      if (
        !lecture ||
        !noteUpdatedAt ||
        !noteContent.trim()
      ) {
        return false;
      }

      if (
        !lecture.processed_at
      ) {
        return Boolean(
          noteContent.trim(),
        );
      }

      return (
        new Date(
          noteUpdatedAt,
        ).getTime() >
        new Date(
          lecture.processed_at,
        ).getTime() +
          500
      );
    }, [
      lecture,
      noteContent,
      noteUpdatedAt,
    ]);

  const analysisUsedNotes =
    lecture
      ? noteWasUsed(
          lecture,
        )
      : false;

  const loadPage =
    useCallback(
      async () => {
        if (!lectureId) {
          return;
        }

        try {
          setLoading(true);
          setError("");

          const {
            data: {
              session,
            },
            error:
              sessionError,
          } =
            await supabase.auth.getSession();

          if (
            sessionError
          ) {
            throw sessionError;
          }

          if (!session) {
            router.replace(
              "/onboarding",
            );
            return;
          }

          const {
            data:
              lectureData,
            error:
              lectureError,
          } = await supabase
            .from(
              "lectures",
            )
            .select(
              "id, user_id, course_id, unit_id, course_file_id, title, source_kind, file_name, storage_path, mime_type, size_bytes, duration_seconds, notes_depth_percent, status, analysis_stage, analysis_progress, transcript_text, summary, notes, error_message, captured_at, processed_at, created_at, updated_at",
            )
            .eq(
              "id",
              lectureId,
            )
            .single();

          if (
            lectureError
          ) {
            throw lectureError;
          }

          const normalizedLecture: Lecture =
            {
              ...lectureData,
              size_bytes:
                lectureData.size_bytes ===
                null
                  ? null
                  : Number(
                      lectureData.size_bytes,
                    ),
              duration_seconds:
                lectureData.duration_seconds ===
                null
                  ? null
                  : Number(
                      lectureData.duration_seconds,
                    ),
              notes_depth_percent:
                Number(
                  lectureData.notes_depth_percent ??
                    60,
                ),
              analysis_progress:
                Number(
                  lectureData.analysis_progress ??
                    0,
                ),
              notes:
                isRecord(
                  lectureData.notes,
                )
                  ? lectureData.notes
                  : {},
            };

          setLecture(
            normalizedLecture,
          );

          const [
            {
              data:
                courseData,
              error:
                courseError,
            },
            {
              data:
                analysisData,
              error:
                analysisError,
            },
            {
              data:
                noteData,
              error:
                noteError,
            },
            {
              data:
                chunkData,
              error:
                chunkError,
            },
            {
              data:
                linkData,
              error:
                linkError,
            },
            {
              data:
                signedAudio,
              error:
                signedAudioError,
            },
          ] =
            await Promise.all([
              supabase
                .from(
                  "courses",
                )
                .select(
                  "id, code, name, color, professor",
                )
                .eq(
                  "id",
                  normalizedLecture.course_id,
                )
                .single(),

              normalizedLecture.course_file_id
                ? supabase
                    .from(
                      "material_analyses",
                    )
                    .select(
                      "id, summary, explanation, raw_analysis, status, model, analyzed_at, updated_at",
                    )
                    .eq(
                      "course_file_id",
                      normalizedLecture.course_file_id,
                    )
                    .maybeSingle()
                : Promise.resolve(
                    {
                      data: null,
                      error: null,
                    },
                  ),

              supabase
                .from(
                  "notes",
                )
                .select(
                  "id, title, raw_content, updated_at",
                )
                .eq(
                  "lecture_id",
                  lectureId,
                )
                .order(
                  "updated_at",
                  {
                    ascending:
                      false,
                  },
                )
                .limit(1)
                .maybeSingle(),

              supabase
                .from(
                  "lecture_analysis_chunks",
                )
                .select(
                  "chunk_index, start_seconds, end_seconds, memory",
                )
                .eq(
                  "lecture_id",
                  lectureId,
                )
                .eq(
                  "status",
                  "ready",
                )
                .order(
                  "chunk_index",
                  {
                    ascending:
                      true,
                  },
                ),

              supabase
                .from(
                  "lecture_topic_links",
                )
                .select(
                  "topic_id, confidence",
                )
                .eq(
                  "lecture_id",
                  lectureId,
                ),

              supabase.storage
                .from(
                  "lecture-audio",
                )
                .createSignedUrl(
                  normalizedLecture.storage_path,
                  60 * 60,
                ),
            ]);

          if (
            courseError
          ) {
            throw courseError;
          }
          if (
            analysisError
          ) {
            throw analysisError;
          }
          if (noteError) {
            throw noteError;
          }
          if (
            chunkError
          ) {
            throw chunkError;
          }
          if (linkError) {
            throw linkError;
          }

          setCourse({
            id:
              courseData.id,
            code:
              courseData.code,
            name:
              courseData.name,
            color:
              courseData.color,
            professor:
              courseData.professor ??
              null,
          });

          setSavedAnalysis(
            analysisData
              ? {
                  ...analysisData,
                  raw_analysis:
                    isRecord(
                      analysisData.raw_analysis,
                    )
                      ? (analysisData.raw_analysis as unknown as MaterialAnalysisContent)
                      : null,
                }
              : null,
          );

          setChunks(
            (chunkData ??
              []).map(
              (chunk) => ({
                chunk_index:
                  Number(
                    chunk.chunk_index,
                  ),
                start_seconds:
                  Number(
                    chunk.start_seconds,
                  ),
                end_seconds:
                  Number(
                    chunk.end_seconds,
                  ),
                memory:
                  chunk.memory,
              }),
            ),
          );

          if (
            signedAudioError
          ) {
            console.warn(
              "Could not create lecture audio URL:",
              signedAudioError,
            );
            setAudioUrl(
              "",
            );
          } else {
            setAudioUrl(
              signedAudio
                ?.signedUrl ??
                "",
            );
          }

          const topicLinks =
            (linkData ??
              []).map(
              (link) => ({
                topicId:
                  link.topic_id,
                confidence:
                  link.confidence ===
                  null
                    ? null
                    : Number(
                        link.confidence,
                      ),
              }),
            );

          if (
            topicLinks.length >
            0
          ) {
            const {
              data:
                topicData,
              error:
                topicError,
            } = await supabase
              .from(
                "course_topics",
              )
              .select(
                "id, name",
              )
              .in(
                "id",
                topicLinks.map(
                  (link) =>
                    link.topicId,
                ),
              );

            if (
              topicError
            ) {
              throw topicError;
            }

            setLinkedTopics(
              (topicData ??
                []).map(
                (topic) => {
                  const link =
                    topicLinks.find(
                      (
                        candidate,
                      ) =>
                        candidate.topicId ===
                        topic.id,
                    );

                  return {
                    id:
                      topic.id,
                    name:
                      topic.name,
                    confidence:
                      link?.confidence ??
                      null,
                  };
                },
              ),
            );
          } else {
            setLinkedTopics(
              [],
            );
          }

          let resolvedNote =
            noteData as Note | null;

          if (
            !resolvedNote
          ) {
            const {
              data:
                createdNote,
              error:
                createNoteError,
            } = await supabase
              .from(
                "notes",
              )
              .insert({
                user_id:
                  session.user.id,
                course_id:
                  normalizedLecture.course_id,
                lecture_id:
                  lectureId,
                title: `Notes · ${normalizedLecture.title}`,
                raw_content:
                  "",
              })
              .select(
                "id, title, raw_content, updated_at",
              )
              .single();

            if (
              createNoteError
            ) {
              throw createNoteError;
            }

            resolvedNote =
              createdNote as Note;
          }

          setNoteId(
            resolvedNote.id,
          );
          setNoteContent(
            resolvedNote.raw_content ??
              "",
          );
          setNoteUpdatedAt(
            resolvedNote.updated_at,
          );

          lastSavedNoteRef.current =
            resolvedNote.raw_content ??
            "";

          setSaveState(
            "saved",
          );
        } catch (
          loadError
        ) {
          console.error(
            "Could not load lecture summary:",
            loadError,
          );

          setError(
            loadError instanceof
              Error
              ? loadError.message
              : "Could not load this lecture.",
          );
        } finally {
          setLoading(false);
        }
      },
      [
        lectureId,
        router,
      ],
    );

  useEffect(() => {
    void loadPage();
  }, [loadPage]);

  useEffect(() => {
    if (
      !lectureId ||
      lecture?.status !==
        "analyzing"
    ) {
      return;
    }

    let cancelled = false;

    const refreshProgress =
      async () => {
        const {
          data,
          error:
            refreshError,
        } = await supabase
          .from("lectures")
          .select(
            "status, analysis_stage, analysis_progress, error_message, processed_at, updated_at",
          )
          .eq(
            "id",
            lectureId,
          )
          .maybeSingle();

        if (
          cancelled ||
          refreshError ||
          !data
        ) {
          return;
        }

        const previousStatus =
          lecture.status;

        setLecture(
          (current) =>
            current
              ? {
                  ...current,
                  status:
                    data.status,
                  analysis_stage:
                    data.analysis_stage,
                  analysis_progress:
                    Number(
                      data.analysis_progress ??
                        0,
                    ),
                  error_message:
                    data.error_message ??
                    null,
                  processed_at:
                    data.processed_at ??
                    null,
                  updated_at:
                    data.updated_at,
                }
              : current,
        );

        if (
          data.status ===
            "ready" &&
          previousStatus !==
            "ready"
        ) {
          await loadPage();
        }
      };

    void refreshProgress();

    const interval =
      window.setInterval(
        () => {
          void refreshProgress();
        },
        2500,
      );

    return () => {
      cancelled = true;
      window.clearInterval(
        interval,
      );
    };
  }, [
    lecture?.status,
    lectureId,
    loadPage,
  ]);

  const saveNoteNow =
    useCallback(
      async () => {
        if (
          !noteId ||
          !lecture
        ) {
          return true;
        }

        if (
          noteContent ===
          lastSavedNoteRef.current
        ) {
          setSaveState(
            "saved",
          );
          return true;
        }

        if (
          noteTimerRef.current
        ) {
          clearTimeout(
            noteTimerRef.current,
          );
          noteTimerRef.current =
            null;
        }

        setSaveState(
          "saving",
        );

        const {
          data,
          error:
            noteSaveError,
        } = await supabase
          .from("notes")
          .update({
            raw_content:
              noteContent,
            course_id:
              lecture.course_id,
            lecture_id:
              lecture.id,
          })
          .eq(
            "id",
            noteId,
          )
          .select(
            "updated_at",
          )
          .single();

        if (
          noteSaveError
        ) {
          console.error(
            "Could not save lecture notes:",
            noteSaveError,
          );
          setSaveState(
            "error",
          );
          return false;
        }

        lastSavedNoteRef.current =
          noteContent;
        setNoteUpdatedAt(
          data.updated_at,
        );
        setSaveState(
          "saved",
        );

        return true;
      },
      [
        lecture,
        noteContent,
        noteId,
      ],
    );

  useEffect(() => {
    if (
      !noteId ||
      noteContent ===
        lastSavedNoteRef.current
    ) {
      return;
    }

    setSaveState(
      "dirty",
    );

    if (
      noteTimerRef.current
    ) {
      clearTimeout(
        noteTimerRef.current,
      );
    }

    noteTimerRef.current =
      setTimeout(() => {
        void saveNoteNow();
      }, 700);

    return () => {
      if (
        noteTimerRef.current
      ) {
        clearTimeout(
          noteTimerRef.current,
        );
      }
    };
  }, [
    noteContent,
    noteId,
    saveNoteNow,
  ]);

  useEffect(() => {
    return () => {
      if (
        noteTimerRef.current
      ) {
        clearTimeout(
          noteTimerRef.current,
        );
      }
    };
  }, []);

  async function rebuildWithNotes() {
    if (
      !lecture ||
      rebuilding
    ) {
      return;
    }

    const saved =
      await saveNoteNow();

    if (!saved) {
      setError(
        "Save your notes before rebuilding the lecture analysis.",
      );
      return;
    }

    const analysisController =
      new AbortController();

    analysisControllerRef.current =
      analysisController;

    try {
      setRebuilding(true);
      setError("");
      setRebuildMessage(
        "Preparing your saved notes…",
      );

      const onStage = (
        _stage:
          Exclude<
            LecturePipelineStage,
            "uploading"
          >,
        message: string,
      ) => {
        setRebuildMessage(
          message,
        );
      };

      await reprocessLectureMaterial({
        lectureId:
          lecture.id,
        depthPercent:
          lecture.notes_depth_percent,
        analysisSignal:
          analysisController.signal,
        onStage,
      });

      setRebuildMessage(
        "AI analysis is now running in the background.",
      );

      await loadPage();

      setRebuildMessage(
        "",
      );
    } catch (
      rebuildError
    ) {
      if (
        isLectureAnalysisCancelledError(
          rebuildError,
        )
      ) {
        return;
      }

      console.error(
        "Could not rebuild lecture:",
        rebuildError,
      );

      setError(
        rebuildError instanceof
          Error
          ? rebuildError.message
          : "Could not rebuild this lecture.",
      );
    } finally {
      if (
        analysisControllerRef.current ===
        analysisController
      ) {
        analysisControllerRef.current = null;
      }
      setRebuilding(
        false,
      );
    }
  }

  async function cancelCurrentAnalysis() {
    if (
      !lecture ||
      (
        lecture.status !==
          "analyzing" &&
        !rebuilding
      ) ||
      cancellingAnalysis
    ) {
      return;
    }

    try {
      setCancellingAnalysis(true);
      setRebuildMessage(
        "Cancelling AI analysis…",
      );

      await cancelLectureAnalysis({
        lectureId: lecture.id,
        controller:
          analysisControllerRef.current,
      });

      setRebuilding(false);
      setRebuildMessage("");
      setLecture((current) =>
        current
          ? {
              ...current,
              status:
                current.processed_at
                  ? "ready"
                  : "uploaded",
              analysis_stage:
                current.processed_at
                  ? "ready"
                  : "idle",
              error_message:
                null,
            }
          : current,
      );
      await loadPage();
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

  async function deleteCurrentLecture() {
    if (
      !lecture ||
      deletingLecture
    ) {
      return;
    }

    try {
      setDeletingLecture(true);
      setError("");

      if (
        lecture.status ===
          "analyzing" ||
        rebuilding
      ) {
        await cancelLectureAnalysis({
          lectureId:
            lecture.id,
          controller:
            analysisControllerRef.current,
        });
      }

      /*
       * Remove the audio object first. If storage cleanup fails we log it,
       * but still allow the database record to be removed so the user is not
       * trapped with an undeletable lecture.
       */
      if (
        lecture.storage_path
      ) {
        const {
          error:
            storageDeleteError,
        } =
          await supabase.storage
            .from(
              "lecture-audio",
            )
            .remove([
              lecture.storage_path,
            ]);

        if (
          storageDeleteError
        ) {
          console.warn(
            "Lecture audio cleanup failed:",
            storageDeleteError,
          );
        }
      }

      if (
        lecture.course_file_id
      ) {
        /*
         * Live FK rules cascade course_file deletion to the lecture,
         * transcript segments, chunk memories, topic links and analysis.
         * User notes survive because notes.lecture_id uses ON DELETE SET NULL.
         */
        const {
          error:
            courseFileDeleteError,
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
          courseFileDeleteError
        ) {
          throw courseFileDeleteError;
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

      router.replace(
        "/lectures",
      );
    } catch (
      deleteError
    ) {
      console.error(
        "Could not delete lecture:",
        deleteError,
      );

      setError(
        deleteError instanceof
          Error
          ? deleteError.message
          : "Could not delete this lecture.",
      );
    } finally {
      setDeletingLecture(
        false,
      );
      setDeleteConfirmation(
        false,
      );
    }
  }

  async function togglePlayback() {
    const audio =
      audioRef.current;

    if (
      !audio ||
      !audioUrl
    ) {
      return;
    }

    if (audio.paused) {
      try {
        await audio.play();
      } catch (
        playbackError
      ) {
        setError(
          playbackError instanceof
            Error
            ? playbackError.message
            : "Could not play this lecture.",
        );
      }
    } else {
      audio.pause();
    }
  }

  async function seekChapter(
    chapter: Chapter,
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
      // The seek itself still worked.
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#080809] text-white">
        <div className="flex items-center gap-3 text-[11px] text-white/34">
          <Loader2
            size={14}
            className="animate-spin"
          />
          Opening lecture
        </div>
      </main>
    );
  }

  if (
    !lecture ||
    !course
  ) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#080809] px-6 text-white">
        <div className="max-w-sm text-center">
          <p className="text-[13px] text-white/42">
            {error ||
              "Lecture not found."}
          </p>
          <button
            type="button"
            onClick={() =>
              router.push(
                "/lectures",
              )
            }
            className="mt-5 rounded-full bg-white px-4 py-2.5 text-[10px] font-medium text-black"
          >
            Back to Lectures
          </button>
        </div>
      </main>
    );
  }

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

  return (
    <MotionConfig reducedMotion="user">
      <main className="relative min-h-screen overflow-x-hidden bg-[#080809] text-[#F5F5F7]">
        <motion.div
          aria-hidden
          className="pointer-events-none fixed left-[15%] top-[-320px] h-[650px] w-[820px] rounded-full opacity-[0.09] blur-[145px]"
          style={{
            backgroundColor:
              accent,
          }}
          animate={{
            x: [
              0,
              20,
              -8,
              0,
            ],
            y: [
              0,
              10,
              -6,
              0,
            ],
          }}
          transition={{
            duration: 24,
            repeat:
              Infinity,
            ease:
              "easeInOut",
          }}
        />

        <div className="relative mx-auto max-w-[1320px] px-5 pb-24 pt-6 sm:px-8 md:px-10 md:pt-9">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() =>
                router.push(
                  "/lectures",
                )
              }
              className="flex items-center gap-2 rounded-full border border-white/[0.07] bg-white/[0.02] px-3.5 py-2.5 text-[10px] font-medium text-white/44 transition hover:bg-white/[0.045] hover:text-white/72"
            >
              <ArrowLeft
                size={12}
              />
              Lectures
            </button>

            <div className="flex items-center gap-2">
              <span
                className="rounded-full border px-3 py-2 text-[8px] font-semibold uppercase tracking-[0.09em]"
                style={{
                  borderColor: `${accent}24`,
                  backgroundColor: `${accent}0B`,
                  color:
                    accent,
                }}
              >
                {lecture.source_kind ===
                "recording"
                  ? "Recorded live"
                  : "Uploaded audio"}
              </span>

              <button
                type="button"
                onClick={() =>
                  router.push(
                    `/courses/${course.id}`,
                  )
                }
                className="rounded-full border border-white/[0.06] bg-white/[0.012] px-3 py-2 text-[8px] text-white/30 transition hover:bg-white/[0.035] hover:text-white/58"
              >
                {course.code}
              </button>

              {deleteConfirmation ? (
                <div className="flex items-center gap-1 rounded-full border border-red-300/12 bg-red-300/[0.025] p-1">
                  <button
                    type="button"
                    onClick={() =>
                      setDeleteConfirmation(
                        false,
                      )
                    }
                    disabled={
                      deletingLecture
                    }
                    className="rounded-full px-2.5 py-1.5 text-[8px] text-white/28 transition hover:text-white/52 disabled:opacity-35"
                  >
                    Keep
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      void deleteCurrentLecture()
                    }
                    disabled={
                      deletingLecture
                    }
                    className="flex items-center gap-1.5 rounded-full bg-red-200/90 px-2.5 py-1.5 text-[8px] font-medium text-black transition disabled:opacity-35"
                  >
                    {deletingLecture ? (
                      <Loader2
                        size={8}
                        className="animate-spin"
                      />
                    ) : (
                      <Trash2
                        size={8}
                      />
                    )}
                    Delete
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() =>
                    setDeleteConfirmation(
                      true,
                    )
                  }
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-white/[0.055] bg-white/[0.008] text-white/18 transition hover:border-red-300/15 hover:bg-red-300/[0.025] hover:text-red-100/55"
                  aria-label="Delete lecture"
                  title="Delete lecture"
                >
                  <Trash2
                    size={10}
                  />
                </button>
              )}
            </div>
          </div>

          <header className="mt-10 border-b border-white/[0.065] pb-9">
            <div className="flex items-center gap-3">
              <SchoolMark
                size={40}
                quiet
              />
              <div>
                <p
                  className="text-[9px] font-semibold uppercase tracking-[0.16em]"
                  style={{
                    color:
                      accent,
                  }}
                >
                  {course.code} · Lecture summary
                </p>
                <p className="mt-1 text-[9px] text-white/24">
                  {formatDate(
                    lecture.captured_at,
                  )}{" "}
                  ·{" "}
                  {formatDuration(
                    lecture.duration_seconds,
                  )}
                </p>
              </div>
            </div>

            <h1 className="mt-6 max-w-[900px] text-[42px] font-medium leading-[0.98] tracking-[-0.058em] sm:text-[58px]">
              {analysis?.title ||
                lecture.title}
            </h1>

            <p className="mt-5 max-w-3xl text-[13px] leading-7 text-white/40">
              {analysis?.overview ||
                lecture.summary ||
                (lecture.status ===
                "ready"
                  ? "This lecture is ready, but no summary text was saved."
                  : "This lecture is still being processed.")}
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-2">
              {linkedTopics.map(
                (topic) => (
                  <span
                    key={
                      topic.id
                    }
                    className="rounded-full border border-white/[0.055] bg-white/[0.012] px-3 py-1.5 text-[8px] text-white/34"
                  >
                    {
                      topic.name
                    }
                  </span>
                ),
              )}

              {analysis && (
                <span className="rounded-full border border-white/[0.05] px-3 py-1.5 text-[8px] text-white/20">
                  {Math.round(
                    analysis.confidence ??
                      0,
                  )}
                  % AI confidence
                </span>
              )}
            </div>
          </header>

          <AnimatePresence>
            {error && (
              <motion.div
                initial={{
                  opacity: 0,
                  y: -4,
                }}
                animate={{
                  opacity: 1,
                  y: 0,
                }}
                exit={{
                  opacity: 0,
                }}
                className="mt-5 rounded-[16px] border border-red-400/15 bg-red-400/[0.035] px-4 py-3"
              >
                <p className="text-[9px] leading-5 text-red-200/62">
                  {error}
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          {rebuilding && (
            <div
              className="mt-5 rounded-[18px] border p-4"
              style={{
                borderColor: `${accent}20`,
                backgroundColor: `${accent}08`,
              }}
            >
              <div className="flex items-center gap-3">
                <Loader2
                  size={13}
                  className="animate-spin"
                  style={{
                    color:
                      accent,
                  }}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-medium text-white/58">
                    Rebuilding lecture analysis
                  </p>
                  <p className="mt-1 text-[8px] leading-4 text-white/26">
                    {rebuildMessage ||
                      "Updating the lecture summary…"}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    void cancelCurrentAnalysis()
                  }
                  disabled={cancellingAnalysis}
                  className="flex shrink-0 items-center gap-1.5 rounded-full border border-red-300/15 bg-red-300/[0.025] px-3 py-2 text-[8px] font-medium text-red-100/55 transition hover:bg-red-300/[0.05] hover:text-red-100/80 disabled:opacity-35"
                >
                  {cancellingAnalysis ? (
                    <Loader2
                      size={9}
                      className="animate-spin"
                    />
                  ) : (
                    <Square
                      size={9}
                    />
                  )}
                  {cancellingAnalysis
                    ? "Cancelling"
                    : "Cancel analysis"}
                </button>
              </div>
            </div>
          )}

          <section className="mt-7 grid gap-6 xl:grid-cols-[minmax(0,1fr)_330px]">
            <div className="min-w-0 space-y-6">
              <section className="rounded-[24px] border border-white/[0.065] bg-[#101012] p-4 sm:p-5">
                <audio
                  ref={
                    audioRef
                  }
                  src={
                    audioUrl ||
                    undefined
                  }
                  preload="metadata"
                  onLoadedMetadata={(
                    event,
                  ) => {
                    const duration =
                      event
                        .currentTarget
                        .duration;

                    if (
                      Number.isFinite(
                        duration,
                      )
                    ) {
                      setAudioDuration(
                        duration,
                      );
                    }

                    const requestedSeconds =
                      typeof window !==
                      "undefined"
                        ? Number(
                            new URLSearchParams(
                              window.location.search,
                            ).get("t"),
                          )
                        : NaN;

                    if (
                      Number.isFinite(
                        requestedSeconds,
                      ) &&
                      requestedSeconds > 0
                    ) {
                      const safeTime =
                        Math.min(
                          duration ||
                            requestedSeconds,
                          Math.max(
                            0,
                            requestedSeconds,
                          ),
                        );

                      event.currentTarget.currentTime =
                        safeTime;

                      setCurrentTime(
                        safeTime,
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
                    setPlaying(
                      true,
                    )
                  }
                  onPause={() =>
                    setPlaying(
                      false,
                    )
                  }
                  onEnded={() =>
                    setPlaying(
                      false,
                    )
                  }
                />

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      void togglePlayback()
                    }
                    disabled={
                      !audioUrl
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
                    {playing ? (
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

                  <span className="w-[46px] shrink-0 text-right text-[9px] font-medium tabular-nums text-white/36">
                    {formatPlaybackTime(
                      currentTime,
                    )}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex min-h-[18px] items-center justify-between gap-3">
                      <p className="truncate text-[9px] font-medium text-white/48">
                        {chapters[
                          activeChapterIndex
                        ]
                          ?.heading ||
                          "Lecture audio"}
                      </p>

                      <Volume2
                        size={10}
                        className="shrink-0 text-white/18"
                      />
                    </div>

                    <div className="relative flex h-3 gap-[2px]">
                      {chapters.length >
                      0 ? (
                        chapters.map(
                          (
                            chapter,
                            index,
                          ) => {
                            const length =
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
                                onClick={() =>
                                  void seekChapter(
                                    chapter,
                                  )
                                }
                                title={`${chapter.heading} · ${formatPlaybackTime(
                                  chapter.startSeconds,
                                )}`}
                                className="h-3 min-w-[5px] rounded-[4px] border border-white/[0.035] transition hover:brightness-125"
                                style={{
                                  flexGrow:
                                    length,
                                  flexBasis:
                                    0,
                                  backgroundColor:
                                    active
                                      ? accent
                                      : currentTime >=
                                          chapter.endSeconds
                                        ? `${accent}75`
                                        : "rgba(255,255,255,0.09)",
                                }}
                              />
                            );
                          },
                        )
                      ) : (
                        <div className="h-3 w-full rounded-full bg-white/[0.08]" />
                      )}

                      <span
                        aria-hidden
                        className="pointer-events-none absolute -top-[3px] h-[18px] w-px bg-white/80"
                        style={{
                          left: `${playbackProgress}%`,
                        }}
                      />
                    </div>
                  </div>

                  <span className="w-[46px] shrink-0 text-[9px] font-medium tabular-nums text-white/22">
                    {formatPlaybackTime(
                      audioDuration ||
                        lecture.duration_seconds ||
                        0,
                    )}
                  </span>
                </div>

                {chapters.length >
                  0 && (
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
                              : "border-white/[0.045] bg-white/[0.01] hover:border-white/[0.08]"
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
                          <p className="mt-1 max-w-[180px] truncate text-[8px] text-white/34">
                            {
                              chapter.heading
                            }
                          </p>
                        </button>
                      ),
                    )}
                  </div>
                )}
              </section>

              {analysis ? (
                <>
                  {analysis.whatToKnow
                    ?.length >
                    0 && (
                    <section className="rounded-[24px] border border-white/[0.06] bg-[#101012] p-5 sm:p-6">
                      <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-white/24">
                        Essential takeaways
                      </p>
                      <h2 className="mt-2 text-[26px] font-medium tracking-[-0.04em] text-white/82">
                        What you need to know
                      </h2>

                      <div className="mt-5 grid gap-2.5 sm:grid-cols-2">
                        {analysis.whatToKnow.map(
                          (
                            point,
                            index,
                          ) => (
                            <div
                              key={`${point}-${index}`}
                              className="flex items-start gap-3 rounded-[16px] border border-white/[0.05] bg-white/[0.009] p-4"
                            >
                              <span
                                className="mt-0.5 text-[9px] font-semibold"
                                style={{
                                  color:
                                    accent,
                                }}
                              >
                                {String(
                                  index +
                                    1,
                                ).padStart(
                                  2,
                                  "0",
                                )}
                              </span>
                              <p className="text-[12px] leading-6 text-white/40">
                                {
                                  point
                                }
                              </p>
                            </div>
                          ),
                        )}
                      </div>
                    </section>
                  )}

                  {analysis.sections
                    ?.length >
                    0 && (
                    <section>
                      <div className="mb-4 px-1">
                        <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-white/24">
                          Lecture notes
                        </p>
                        <h2 className="mt-2 text-[28px] font-medium tracking-[-0.04em]">
                          Explained section by section.
                        </h2>
                      </div>

                      <div className="space-y-3">
                        {analysis.sections.map(
                          (
                            section,
                            index,
                          ) => (
                            <article
                              key={`${section.heading}-${index}`}
                              className="rounded-[22px] border border-white/[0.06] bg-[#101012] p-5 sm:p-6"
                            >
                              <div className="flex items-start gap-4">
                                <span
                                  className="mt-1 text-[9px] font-semibold"
                                  style={{
                                    color:
                                      accent,
                                  }}
                                >
                                  {String(
                                    index +
                                      1,
                                  ).padStart(
                                    2,
                                    "0",
                                  )}
                                </span>

                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-start justify-between gap-3">
                                    <h3 className="text-[19px] font-medium tracking-[-0.025em] text-white/76">
                                      {
                                        section.heading
                                      }
                                    </h3>

                                    {Number.isFinite(
                                      Number(
                                        section.startSeconds,
                                      ),
                                    ) && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          void seekChapter(
                                            {
                                              heading:
                                                section.heading,
                                              startSeconds:
                                                Number(
                                                  section.startSeconds,
                                                ),
                                              endSeconds:
                                                Number(
                                                  section.endSeconds ??
                                                    section.startSeconds,
                                                ),
                                            },
                                          )
                                        }
                                        className="flex items-center gap-1.5 rounded-full border border-white/[0.05] px-2.5 py-1.5 text-[7px] text-white/24 transition hover:text-white/50"
                                      >
                                        <Clock3
                                          size={
                                            8
                                          }
                                        />
                                        {formatPlaybackTime(
                                          Number(
                                            section.startSeconds,
                                          ),
                                        )}
                                      </button>
                                    )}
                                  </div>

                                  <p className="mt-3 text-[13px] leading-7 text-white/40">
                                    {
                                      section.explanation
                                    }
                                  </p>

                                  {section
                                    .keyPoints
                                    ?.length >
                                    0 && (
                                    <div className="mt-4 grid gap-2 border-t border-white/[0.045] pt-4 sm:grid-cols-2">
                                      {section.keyPoints.map(
                                        (
                                          point,
                                          pointIndex,
                                        ) => (
                                          <div
                                            key={`${point}-${pointIndex}`}
                                            className="flex items-start gap-2"
                                          >
                                            <span
                                              className="mt-[7px] h-1 w-1 shrink-0 rounded-full"
                                              style={{
                                                backgroundColor:
                                                  accent,
                                              }}
                                            />
                                            <p className="text-[11px] leading-5 text-white/30">
                                              {
                                                point
                                              }
                                            </p>
                                          </div>
                                        ),
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </article>
                          ),
                        )}
                      </div>
                    </section>
                  )}

                  {(terms.length >
                    0 ||
                    studySignals.length >
                      0) && (
                    <section className="grid gap-4 md:grid-cols-2">
                      {terms.length >
                        0 && (
                        <div className="rounded-[22px] border border-white/[0.06] bg-[#101012] p-5">
                          <p className="text-[9px] font-semibold uppercase tracking-[0.13em] text-white/24">
                            Terms
                          </p>
                          <div className="mt-4 space-y-3">
                            {terms.map(
                              (
                                term,
                                index,
                              ) => (
                                <div
                                  key={`${term.term}-${index}`}
                                  className="border-b border-white/[0.045] pb-3 last:border-b-0 last:pb-0"
                                >
                                  <p
                                    className="text-[10px] font-medium"
                                    style={{
                                      color:
                                        accent,
                                    }}
                                  >
                                    {
                                      term.term
                                    }
                                  </p>
                                  <p className="mt-1.5 text-[10px] leading-5 text-white/30">
                                    {
                                      term.definition
                                    }
                                  </p>
                                </div>
                              ),
                            )}
                          </div>
                        </div>
                      )}

                      {studySignals.length >
                        0 && (
                        <div className="rounded-[22px] border border-white/[0.06] bg-[#101012] p-5">
                          <p className="text-[9px] font-semibold uppercase tracking-[0.13em] text-white/24">
                            Professor signals
                          </p>
                          <div className="mt-4 space-y-3">
                            {studySignals.map(
                              (
                                signal,
                                index,
                              ) => (
                                <button
                                  key={`${signal.label}-${index}`}
                                  type="button"
                                  onClick={() =>
                                    void seekChapter(
                                      {
                                        heading:
                                          signal.label,
                                        startSeconds:
                                          signal.startSeconds,
                                        endSeconds:
                                          signal.startSeconds +
                                          1,
                                      },
                                    )
                                  }
                                  className="block w-full rounded-[14px] border border-white/[0.045] bg-white/[0.008] p-3 text-left transition hover:bg-white/[0.018]"
                                >
                                  <div className="flex items-center justify-between gap-3">
                                    <p className="text-[10px] font-medium text-white/54">
                                      {
                                        signal.label
                                      }
                                    </p>
                                    <span className="text-[7px] tabular-nums text-white/18">
                                      {formatPlaybackTime(
                                        signal.startSeconds,
                                      )}
                                    </span>
                                  </div>
                                  <p className="mt-1.5 text-[9px] leading-4 text-white/26">
                                    {
                                      signal.explanation
                                    }
                                  </p>
                                </button>
                              ),
                            )}
                          </div>
                        </div>
                      )}
                    </section>
                  )}

                  {analysis.studyTips
                    ?.length >
                    0 && (
                    <section className="rounded-[22px] border border-white/[0.055] bg-white/[0.009] p-5">
                      <p className="text-[9px] font-semibold uppercase tracking-[0.13em] text-white/22">
                        Study cues
                      </p>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {analysis.studyTips.map(
                          (
                            tip,
                            index,
                          ) => (
                            <span
                              key={`${tip}-${index}`}
                              className="rounded-full border border-white/[0.055] px-3 py-2 text-[9px] text-white/30"
                            >
                              {
                                tip
                              }
                            </span>
                          ),
                        )}
                      </div>
                    </section>
                  )}

                  {analysis.quickChecks
                    ?.length >
                    0 && (
                    <section className="rounded-[24px] border border-white/[0.06] bg-[#101012] p-5 sm:p-6">
                      <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-white/24">
                        Quick checks
                      </p>
                      <h2 className="mt-2 text-[26px] font-medium tracking-[-0.04em]">
                        Test the lecture while it is fresh.
                      </h2>

                      <div className="mt-5 space-y-3">
                        {analysis.quickChecks.map(
                          (
                            question,
                            questionIndex,
                          ) => {
                            const selected =
                              selectedAnswers[
                                questionIndex
                              ];

                            return (
                              <div
                                key={`${question.question}-${questionIndex}`}
                                className="rounded-[17px] border border-white/[0.05] bg-white/[0.008] p-4"
                              >
                                <p className="text-[12px] font-medium leading-6 text-white/58">
                                  {
                                    question.question
                                  }
                                </p>

                                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                  {question.choices.map(
                                    (
                                      choice,
                                      choiceIndex,
                                    ) => {
                                      const answered =
                                        selected !==
                                        undefined;
                                      const correct =
                                        question.correctIndex ===
                                        choiceIndex;
                                      const chosen =
                                        selected ===
                                        choiceIndex;

                                      return (
                                        <button
                                          key={`${choice}-${choiceIndex}`}
                                          type="button"
                                          disabled={
                                            answered
                                          }
                                          onClick={() =>
                                            setSelectedAnswers(
                                              (
                                                current,
                                              ) => ({
                                                ...current,
                                                [questionIndex]:
                                                  choiceIndex,
                                              }),
                                            )
                                          }
                                          className={`rounded-[12px] border px-3 py-2.5 text-left text-[10px] leading-5 transition ${
                                            answered &&
                                            correct
                                              ? "border-white/[0.12] text-white/60"
                                              : answered &&
                                                  chosen &&
                                                  !correct
                                                ? "border-red-300/15 bg-red-300/[0.025] text-red-100/48"
                                                : "border-white/[0.05] bg-white/[0.008] text-white/30 hover:border-white/[0.09] hover:text-white/48"
                                          }`}
                                          style={
                                            answered &&
                                            correct
                                              ? {
                                                  borderColor: `${accent}28`,
                                                  backgroundColor: `${accent}08`,
                                                }
                                              : undefined
                                          }
                                        >
                                          <span className="mr-2 text-white/16">
                                            {String.fromCharCode(
                                              65 +
                                                choiceIndex,
                                            )}
                                          </span>
                                          {
                                            choice
                                          }
                                        </button>
                                      );
                                    },
                                  )}
                                </div>

                                {selected !==
                                  undefined && (
                                  <div className="mt-3 border-t border-white/[0.04] pt-3">
                                    <p
                                      className="text-[9px] font-medium"
                                      style={{
                                        color:
                                          selected ===
                                          question.correctIndex
                                            ? accent
                                            : "rgba(254,202,202,0.65)",
                                      }}
                                    >
                                      {selected ===
                                      question.correctIndex
                                        ? "Correct"
                                        : "Not quite"}
                                    </p>
                                    <p className="mt-1.5 text-[10px] leading-5 text-white/28">
                                      {
                                        question.explanation
                                      }
                                    </p>
                                  </div>
                                )}
                              </div>
                            );
                          },
                        )}
                      </div>
                    </section>
                  )}
                </>
              ) : (
                <section className="rounded-[24px] border border-white/[0.06] bg-[#101012] p-6">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <Sparkles
                        size={18}
                        className="text-white/20"
                      />
                      <h2 className="mt-4 text-[20px] font-medium tracking-[-0.035em]">
                        Analysis is not ready yet.
                      </h2>
                      <p className="mt-2 text-[10px] leading-5 text-white/28">
                        {lecture.error_message ||
                          `Current status: ${lecture.status}.`}
                      </p>

                      {lecture.status ===
                        "analyzing" && (
                        <div className="mt-4">
                          <div className="flex items-center gap-2 text-[8px] text-white/24">
                            <Loader2
                              size={9}
                              className="animate-spin"
                            />
                            <span className="capitalize">
                              {lecture.analysis_stage ||
                                "analyzing"}
                            </span>
                            <span>·</span>
                            <span>
                              {Math.round(
                                lecture.analysis_progress ??
                                  0,
                              )}
                              %
                            </span>
                          </div>

                          <div className="mt-2 h-1.5 max-w-[320px] overflow-hidden rounded-full bg-white/[0.05]">
                            <div
                              className="h-full rounded-full transition-all duration-300"
                              style={{
                                width: `${Math.max(
                                  3,
                                  Math.min(
                                    100,
                                    Number(
                                      lecture.analysis_progress ??
                                        0,
                                    ),
                                  ),
                                )}%`,
                                backgroundColor:
                                  accent,
                              }}
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {lecture.status ===
                      "analyzing" && (
                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            void rebuildWithNotes()
                          }
                          disabled={
                            rebuilding ||
                            cancellingAnalysis
                          }
                          className="flex items-center gap-1.5 rounded-full border border-white/[0.07] bg-white/[0.018] px-3.5 py-2.5 text-[8px] font-medium text-white/38 transition hover:bg-white/[0.04] hover:text-white/62 disabled:opacity-35"
                        >
                          {rebuilding ? (
                            <Loader2
                              size={9}
                              className="animate-spin"
                            />
                          ) : (
                            <RefreshCw
                              size={9}
                            />
                          )}
                          Resume now
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            void cancelCurrentAnalysis()
                          }
                          disabled={
                            cancellingAnalysis
                          }
                          className="flex items-center gap-1.5 rounded-full border border-red-300/15 bg-red-300/[0.025] px-3.5 py-2.5 text-[8px] font-medium text-red-100/55 transition hover:bg-red-300/[0.05] hover:text-red-100/80 disabled:opacity-35"
                        >
                          {cancellingAnalysis ? (
                            <Loader2
                              size={9}
                              className="animate-spin"
                            />
                          ) : (
                            <Square
                              size={9}
                            />
                          )}
                          {cancellingAnalysis
                            ? "Cancelling"
                            : "Cancel analysis"}
                        </button>
                      </div>
                    )}
                  </div>
                </section>
              )}

              <SourceProvenance
                artifactKind="lecture_analysis"
                artifactId={lecture.id}
              />

              <section className="rounded-[24px] border border-white/[0.06] bg-[#101012] p-5 sm:p-6">
                <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-white/24">
                  Transcript
                </p>
                <div className="mt-4 max-h-[420px] overflow-y-auto rounded-[15px] border border-white/[0.045] bg-black/15 p-4">
                  <p className="whitespace-pre-wrap text-[10px] leading-6 text-white/36">
                    {lecture.transcript_text ||
                      "Transcript not available."}
                  </p>
                </div>
              </section>
            </div>

            <aside className="min-w-0 xl:sticky xl:top-6 xl:self-start">
              <div className="overflow-hidden rounded-[24px] border border-white/[0.065] bg-[#101012]">
                <div className="border-b border-white/[0.055] p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div
                        className="flex h-9 w-9 items-center justify-center rounded-[12px]"
                        style={{
                          backgroundColor: `${accent}10`,
                          color:
                            accent,
                        }}
                      >
                        <FileText
                          size={14}
                        />
                      </div>

                      <div>
                        <p className="text-[11px] font-medium text-white/64">
                          My notes
                        </p>
                        <p className="mt-1 text-[8px] text-white/24">
                          Autosaved with this lecture
                        </p>
                      </div>
                    </div>

                    <div
                      className={`flex items-center gap-1.5 text-[7px] ${
                        saveState ===
                        "error"
                          ? "text-red-200/52"
                          : "text-white/20"
                      }`}
                    >
                      {saveState ===
                      "saving" ? (
                        <Loader2
                          size={8}
                          className="animate-spin"
                        />
                      ) : saveState ===
                        "saved" ? (
                        <Check
                          size={8}
                        />
                      ) : (
                        <Clock3
                          size={8}
                        />
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
                </div>

                <div className="p-5">
                  <textarea
                    value={
                      noteContent
                    }
                    onChange={(
                      event,
                    ) =>
                      setNoteContent(
                        event
                          .target
                          .value,
                      )
                    }
                    onBlur={() =>
                      void saveNoteNow()
                    }
                    placeholder={
                      "Add what you noticed, what the professor emphasized, questions, examples, or shorthand you want AI to expand later."
                    }
                    className="min-h-[280px] w-full resize-y rounded-[16px] border border-white/[0.05] bg-black/15 p-4 text-[11px] leading-6 text-white/48 outline-none placeholder:text-white/14 focus:border-white/[0.09]"
                  />

                  <div className="mt-4 rounded-[15px] border border-white/[0.05] bg-white/[0.008] p-3.5">
                    {noteChangedSinceAnalysis ? (
                      <>
                        <p
                          className="text-[9px] font-medium"
                          style={{
                            color:
                              accent,
                          }}
                        >
                          Your notes changed since this analysis.
                        </p>
                        <p className="mt-1.5 text-[8px] leading-4 text-white/24">
                          They are saved. Rebuild when you want the AI summary to incorporate the new emphasis and questions.
                        </p>
                      </>
                    ) : analysisUsedNotes &&
                      noteContent.trim() ? (
                      <>
                        <p
                          className="flex items-center gap-1.5 text-[9px] font-medium"
                          style={{
                            color:
                              accent,
                          }}
                        >
                          <Sparkles
                            size={9}
                          />
                          Your notes were used in this analysis.
                        </p>
                        <p className="mt-1.5 text-[8px] leading-4 text-white/24">
                          Transcript content remains the factual source. Your notes tell AI what you cared about and what deserves extra clarity.
                        </p>
                      </>
                    ) : noteContent.trim() ? (
                      <>
                        <p className="text-[9px] font-medium text-white/44">
                          Notes saved, not yet applied to AI.
                        </p>
                        <p className="mt-1.5 text-[8px] leading-4 text-white/22">
                          Rebuild this lecture to use them in the summary.
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-[9px] font-medium text-white/40">
                          Add your own signal.
                        </p>
                        <p className="mt-1.5 text-[8px] leading-4 text-white/22">
                          Your notes stay separate from the transcript and can guide a future rebuild.
                        </p>
                      </>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      void rebuildWithNotes()
                    }
                    disabled={
                      rebuilding
                    }
                    className="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-white px-4 py-2.5 text-[9px] font-medium text-black transition hover:bg-white/90 disabled:opacity-30"
                  >
                    {rebuilding ? (
                      <Loader2
                        size={10}
                        className="animate-spin"
                      />
                    ) : (
                      <RefreshCw
                        size={10}
                      />
                    )}
                    {analysis
                      ? noteContent.trim()
                        ? "Rebuild with my notes"
                        : "Rebuild analysis"
                      : noteContent.trim()
                        ? "Analyze with my notes"
                        : "Analyze lecture"}
                  </button>
                </div>
              </div>

              <div className="mt-4 rounded-[22px] border border-white/[0.055] bg-white/[0.009] p-4">
                <div className="flex items-center gap-2">
                  <Headphones
                    size={12}
                    className="text-white/28"
                  />
                  <p className="text-[9px] font-medium text-white/42">
                    One canonical lecture
                  </p>
                </div>
                <p className="mt-2 text-[8px] leading-4 text-white/20">
                  This page reads the same saved analysis that backs the lecture material in your course library. Rebuilding updates that single saved analysis everywhere.
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  router.push(
                    `/courses/${course.id}`,
                  )
                }
                className="mt-4 flex w-full items-center justify-between rounded-[16px] border border-white/[0.05] bg-white/[0.008] px-4 py-3 text-left transition hover:bg-white/[0.018]"
              >
                <div>
                  <p className="text-[9px] font-medium text-white/42">
                    Open course
                  </p>
                  <p className="mt-1 text-[8px] text-white/20">
                    {course.code} · {course.name}
                  </p>
                </div>
                <ChevronRight
                  size={11}
                  className="text-white/18"
                />
              </button>
            </aside>
          </section>

          <footer className="mt-10 border-t border-white/[0.05] pt-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[8px] leading-4 text-white/18">
                AI notes are grounded in the lecture transcript. Your handwritten notes guide emphasis, but do not override unsupported transcript evidence.
              </p>

              <button
                type="button"
                onClick={() =>
                  router.push(
                    "/lectures",
                  )
                }
                className="flex items-center gap-1.5 text-[8px] font-medium text-white/24 transition hover:text-white/50"
              >
                All lectures
                <ChevronRight
                  size={9}
                />
              </button>
            </div>
          </footer>
        </div>
      </main>
    </MotionConfig>
  );
}