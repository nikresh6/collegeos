"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowLeft,
  BrainCircuit,
  Check,
  ChevronRight,
  Download,
  FileText,
  Loader2,
  Plus,
  Search,
  Sparkles,
  Trash2,
  WandSparkles,
} from "lucide-react";
import {
  useRouter,
} from "next/navigation";
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
  SourceProvenance,
} from "../../components/source-provenance";
import { NotebookTools } from "../../components/notebook-tools";
import { RichNoteEditor } from "../../components/rich-note-editor";
import { noteContentToPlainText, noteWordCount } from "../../lib/note-content";
import { printNote } from "../../lib/print-note";

type Course = {
  id: string;
  code: string;
  name: string;
  color: string;
};

type Lecture = {
  id: string;
  course_id: string;
  title: string;
  captured_at: string;
};

type TopicProposal = {
  kind:
    | "match"
    | "new";
  topicId: string | null;
  parentTopicId: string | null;
  name: string;
  confidence: number;
  rationale: string;
};

type TopicAnalysis = {
  status?: string;
  analyzedAt?: string;
  message?: string;
  proposals?: TopicProposal[];
  confirmedAt?: string;
  confirmedTopicIds?: string[];
};

type Note = {
  id: string;
  user_id: string;
  course_id: string | null;
  lecture_id: string | null;
  title: string;
  raw_content: string;
  created_at: string;
  updated_at: string;
  enhanced_content: string | null;
  enhanced_at: string | null;
  enhancement_source_updated_at: string | null;
  topic_analysis: TopicAnalysis;
};

type SaveState =
  | "saved"
  | "dirty"
  | "saving"
  | "error";

const NOTE_SELECT =
  "id, user_id, course_id, lecture_id, title, raw_content, created_at, updated_at, enhanced_content, enhanced_at, enhancement_source_updated_at, topic_analysis";

function noteSignature(
  note: {
    title: string;
    content: string;
    courseId: string;
    lectureId: string;
  },
) {
  return JSON.stringify(
    note,
  );
}

function parseAnalysis(
  value: unknown,
): TopicAnalysis {
  return value &&
    typeof value ===
      "object" &&
    !Array.isArray(value)
    ? (value as TopicAnalysis)
    : {};
}

function relativeDate(
  value: string,
) {
  const date =
    new Date(value);

  const diff =
    Date.now() -
    date.getTime();

  if (
    !Number.isFinite(diff)
  ) {
    return "";
  }

  const minutes =
    Math.max(
      0,
      Math.round(
        diff / 60000,
      ),
    );

  if (minutes < 2) {
    return "now";
  }

  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours =
    Math.round(
      minutes / 60,
    );

  if (hours < 24) {
    return `${hours}h`;
  }

  return new Intl.DateTimeFormat(
    undefined,
    {
      month: "short",
      day: "numeric",
    },
  ).format(date);
}

export default function NotesPage() {
  const router =
    useRouter();

  const {
    identity,
  } =
    useSchoolIdentity();

  const [
    userId,
    setUserId,
  ] =
    useState<string | null>(
      null,
    );

  const [
    notes,
    setNotes,
  ] =
    useState<Note[]>(
      [],
    );

  const [
    courses,
    setCourses,
  ] =
    useState<Course[]>(
      [],
    );

  const [
    lectures,
    setLectures,
  ] =
    useState<Lecture[]>(
      [],
    );

  const [
    activeId,
    setActiveId,
  ] =
    useState<string | null>(
      null,
    );

  const [
    draftTitle,
    setDraftTitle,
  ] = useState("");

  const [
    draftContent,
    setDraftContent,
  ] = useState("");

  const [
    draftCourseId,
    setDraftCourseId,
  ] = useState("");

  const [
    draftLectureId,
    setDraftLectureId,
  ] = useState("");

  const [
    query,
    setQuery,
  ] = useState("");

  const [
    editorMode,
    setEditorMode,
  ] =
    useState<
      "original" |
      "enhanced"
    >("original");

  const [
    saveState,
    setSaveState,
  ] =
    useState<SaveState>(
      "saved",
    );

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    error,
    setError,
  ] = useState("");

  const [
    aiBusy,
    setAiBusy,
  ] =
    useState<
      | "enhance"
      | "topics"
      | "confirm"
      | null
    >(null);

  const [
    selectedProposals,
    setSelectedProposals,
  ] =
    useState<
      Set<number>
    >(new Set());

  const [
    deleteConfirm,
    setDeleteConfirm,
  ] = useState(false);

  const saveTimerRef =
    useRef<ReturnType<
      typeof setTimeout
    > | null>(null);

  const lastSavedRef =
    useRef("");

  const activeIdRef =
    useRef<string | null>(
      null,
    );

  const courseMap =
    useMemo(
      () =>
        new Map(
          courses.map(
            (course) => [
              course.id,
              course,
            ],
          ),
        ),
      [courses],
    );

  const lectureMap =
    useMemo(
      () =>
        new Map(
          lectures.map(
            (lecture) => [
              lecture.id,
              lecture,
            ],
          ),
        ),
      [lectures],
    );

  const activeNote =
    useMemo(
      () =>
        notes.find(
          (note) =>
            note.id ===
            activeId,
        ) ?? null,
      [
        activeId,
        notes,
      ],
    );

  const selectedCourse =
    draftCourseId
      ? courseMap.get(
          draftCourseId,
        ) ?? null
      : null;

  const accent =
    selectedCourse?.color ??
    identity.primary;

  const availableLectures =
    useMemo(
      () =>
        draftCourseId
          ? lectures.filter(
              (lecture) =>
                lecture.course_id ===
                draftCourseId,
            )
          : lectures,
      [
        draftCourseId,
        lectures,
      ],
    );

  const filteredNotes =
    useMemo(() => {
      const clean =
        query
          .trim()
          .toLowerCase();

      if (!clean) {
        return notes;
      }

      return notes.filter(
        (note) => {
          const course =
            note.course_id
              ? courseMap.get(
                  note.course_id,
                )
              : null;

          const lecture =
            note.lecture_id
              ? lectureMap.get(
                  note.lecture_id,
                )
              : null;

          return [
            note.title,
            noteContentToPlainText(note.raw_content),
            note.enhanced_content,
            course?.code,
            course?.name,
            lecture?.title,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(clean);
        },
      );
    }, [
      courseMap,
      lectureMap,
      notes,
      query,
    ]);

  const currentSignature =
    useMemo(
      () =>
        noteSignature({
          title:
            draftTitle,
          content:
            draftContent,
          courseId:
            draftCourseId,
          lectureId:
            draftLectureId,
        }),
      [
        draftContent,
        draftCourseId,
        draftLectureId,
        draftTitle,
      ],
    );

  const proposals =
    activeNote
      ?.topic_analysis
      ?.proposals ??
    [];

  const applyNote =
    useCallback(
      (note: Note) => {
        if (
          saveTimerRef.current
        ) {
          clearTimeout(
            saveTimerRef.current,
          );
          saveTimerRef.current =
            null;
        }

        activeIdRef.current =
          note.id;

        setActiveId(
          note.id,
        );

        setDraftTitle(
          note.title ===
            "Untitled note"
            ? ""
            : note.title,
        );

        setDraftContent(
          note.raw_content ??
            "",
        );

        setDraftCourseId(
          note.course_id ??
            "",
        );

        setDraftLectureId(
          note.lecture_id ??
            "",
        );

        setEditorMode(
          "original",
        );

        lastSavedRef.current =
          noteSignature({
            title:
              note.title ===
              "Untitled note"
                ? ""
                : note.title,
            content:
              note.raw_content ??
              "",
            courseId:
              note.course_id ??
              "",
            lectureId:
              note.lecture_id ??
              "",
          });

        const nextSelected =
          new Set<number>();

        (
          note.topic_analysis
            ?.proposals ??
          []
        ).forEach(
          (
            proposal,
            index,
          ) => {
            if (
              proposal.kind ===
                "match" &&
              proposal.confidence >=
                65
            ) {
              nextSelected.add(
                index,
              );
            }
          },
        );

        setSelectedProposals(
          nextSelected,
        );

        setSaveState(
          "saved",
        );

        setDeleteConfirm(
          false,
        );

        setError("");
      },
      [],
    );

  const initialize =
    useCallback(
      async () => {
        try {
          setLoading(
            true,
          );
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

          setUserId(
            session.user.id,
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
                lectureData,
              error:
                lectureError,
            },
            {
              data:
                noteData,
              error:
                noteError,
            },
          ] =
            await Promise.all([
              supabase
                .from(
                  "courses",
                )
                .select(
                  "id, code, name, color",
                )
                .eq(
                  "user_id",
                  session.user.id,
                )
                .is(
                  "archived_at",
                  null,
                )
                .order(
                  "created_at",
                  {
                    ascending:
                      true,
                  },
                ),

              supabase
                .from(
                  "lectures",
                )
                .select(
                  "id, course_id, title, captured_at",
                )
                .eq(
                  "user_id",
                  session.user.id,
                )
                .order(
                  "captured_at",
                  {
                    ascending:
                      false,
                  },
                ),

              supabase
                .from(
                  "notes",
                )
                .select(
                  NOTE_SELECT,
                )
                .eq(
                  "user_id",
                  session.user.id,
                )
                .order(
                  "updated_at",
                  {
                    ascending:
                      false,
                  },
                ),
            ]);

          if (
            courseError
          ) {
            throw courseError;
          }

          if (
            lectureError
          ) {
            throw lectureError;
          }

          if (
            noteError
          ) {
            throw noteError;
          }

          setCourses(
            (
              courseData ??
              []
            ) as Course[],
          );

          setLectures(
            (
              lectureData ??
              []
            ) as Lecture[],
          );

          const loaded =
            (
              noteData ??
              []
            ).map(
              (note) => ({
                ...note,
                enhanced_content:
                  note.enhanced_content ??
                  null,
                enhanced_at:
                  note.enhanced_at ??
                  null,
                enhancement_source_updated_at:
                  note.enhancement_source_updated_at ??
                  null,
                topic_analysis:
                  parseAnalysis(
                    note.topic_analysis,
                  ),
              }),
            ) as Note[];

          setNotes(
            loaded,
          );

          const requestedId =
            typeof window !==
            "undefined"
              ? new URLSearchParams(
                  window.location.search,
                ).get("note")
              : null;

          const requested =
            requestedId
              ? loaded.find(
                  (note) =>
                    note.id ===
                    requestedId,
                ) ??
                null
              : null;

          if (
            requested
          ) {
            applyNote(
              requested,
            );
          } else if (
            loaded[0]
          ) {
            applyNote(
              loaded[0],
            );
          }
        } catch (
          initError
        ) {
          setError(
            initError instanceof
              Error
              ? initError.message
              : "Could not load Notes.",
          );
        } finally {
          setLoading(
            false,
          );
        }
      },
      [
        applyNote,
        router,
      ],
    );

  useEffect(() => {
    void initialize();
  }, [initialize]);

  const saveNow =
    useCallback(
      async () => {
        const noteId =
          activeIdRef.current;

        if (
          !noteId ||
          !userId
        ) {
          return true;
        }

        if (
          currentSignature ===
          lastSavedRef.current
        ) {
          setSaveState(
            "saved",
          );
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

        try {
          setSaveState(
            "saving",
          );

          const title =
            draftTitle.trim() ||
            "Untitled note";

          const {
            data:
              updated,
            error:
              saveError,
          } =
            await supabase
              .from("notes")
              .update({
                title,
                raw_content:
                  draftContent,
                course_id:
                  draftCourseId ||
                  null,
                lecture_id:
                  draftLectureId ||
                  null,
              })
              .eq(
                "id",
                noteId,
              )
              .eq(
                "user_id",
                userId,
              )
              .select(
                NOTE_SELECT,
              )
              .single();

          if (
            saveError
          ) {
            throw saveError;
          }

          const normalized:
            Note = {
            ...updated,
            enhanced_content:
              updated.enhanced_content ??
              null,
            enhanced_at:
              updated.enhanced_at ??
              null,
            enhancement_source_updated_at:
              updated.enhancement_source_updated_at ??
              null,
            topic_analysis:
              parseAnalysis(
                updated.topic_analysis,
              ),
          };

          setNotes(
            (current) =>
              current
                .map(
                  (note) =>
                    note.id ===
                    noteId
                      ? normalized
                      : note,
                )
                .sort(
                  (a, b) =>
                    new Date(
                      b.updated_at,
                    ).getTime() -
                    new Date(
                      a.updated_at,
                    ).getTime(),
                ),
          );

          lastSavedRef.current =
            currentSignature;

          setSaveState(
            "saved",
          );

          return true;
        } catch (
          saveError
        ) {
          setSaveState(
            "error",
          );

          setError(
            saveError instanceof
              Error
              ? saveError.message
              : "Could not save this note.",
          );

          return false;
        }
      },
      [
        currentSignature,
        draftContent,
        draftCourseId,
        draftLectureId,
        draftTitle,
        userId,
      ],
    );

  useEffect(() => {
    if (
      !activeId ||
      currentSignature ===
        lastSavedRef.current
    ) {
      return;
    }

    setSaveState(
      "dirty",
    );

    if (
      saveTimerRef.current
    ) {
      clearTimeout(
        saveTimerRef.current,
      );
    }

    saveTimerRef.current =
      setTimeout(
        () => {
          void saveNow();
        },
        700,
      );

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
    activeId,
    currentSignature,
    saveNow,
  ]);

  async function createNote() {
    if (!userId) {
      return;
    }

    const {
      data: note,
      error:
        createError,
    } =
      await supabase
        .from("notes")
        .insert({
          user_id:
            userId,
          title:
            "Untitled note",
          raw_content:
            "",
        })
        .select(
          NOTE_SELECT,
        )
        .single();

    if (
      createError
    ) {
      setError(
        createError.message,
      );
      return;
    }

    const normalized:
      Note = {
      ...note,
      enhanced_content:
        note.enhanced_content ??
        null,
      enhanced_at:
        note.enhanced_at ??
        null,
      enhancement_source_updated_at:
        note.enhancement_source_updated_at ??
        null,
      topic_analysis:
        parseAnalysis(
          note.topic_analysis,
        ),
    };

    setNotes(
      (current) => [
        normalized,
        ...current,
      ],
    );

    applyNote(
      normalized,
    );
  }

  async function deleteNote() {
    if (
      !activeId ||
      !userId
    ) {
      return;
    }

    if (
      !deleteConfirm
    ) {
      setDeleteConfirm(
        true,
      );
      return;
    }

    const id =
      activeId;

    if (
      saveTimerRef.current
    ) {
      clearTimeout(
        saveTimerRef.current,
      );
      saveTimerRef.current =
        null;
    }

    /*
     * Stop any pending autosave from trying to write the note after it has
     * been deleted.
     */
    activeIdRef.current =
      null;

    setSaveState(
      "saved",
    );

    try {
      /*
       * Provenance uses generic source IDs rather than a direct note FK, so
       * clean those rows explicitly. note_topic_links are removed by their
       * ON DELETE CASCADE relationship.
       */
      const [
        {
          error:
            artifactSourceError,
        },
        {
          error:
            directSourceError,
        },
      ] =
        await Promise.all([
          supabase
            .from(
              "ai_provenance_links",
            )
            .delete()
            .eq(
              "user_id",
              userId,
            )
            .eq(
              "artifact_kind",
              "note_enhancement",
            )
            .eq(
              "artifact_id",
              id,
            ),

          supabase
            .from(
              "ai_provenance_links",
            )
            .delete()
            .eq(
              "user_id",
              userId,
            )
            .eq(
              "source_kind",
              "note",
            )
            .eq(
              "source_id",
              id,
            ),
        ]);

      if (
        artifactSourceError
      ) {
        console.warn(
          "Could not remove note artifact provenance:",
          artifactSourceError,
        );
      }

      if (
        directSourceError
      ) {
        console.warn(
          "Could not remove note source provenance:",
          directSourceError,
        );
      }

      const {
        error:
          deleteError,
      } =
        await supabase
          .from("notes")
          .delete()
          .eq(
            "id",
            id,
          )
          .eq(
            "user_id",
            userId,
          );

      if (
        deleteError
      ) {
        throw deleteError;
      }

      const remaining =
        notes.filter(
          (note) =>
            note.id !== id,
        );

      setNotes(
        remaining,
      );

      setDeleteConfirm(
        false,
      );

      if (
        remaining[0]
      ) {
        applyNote(
          remaining[0],
        );
      } else {
        setActiveId(
          null,
        );
        setDraftTitle(
          "",
        );
        setDraftContent(
          "",
        );
        setDraftCourseId(
          "",
        );
        setDraftLectureId(
          "",
        );
        setEditorMode(
          "original",
        );
      }
    } catch (
      deleteError
    ) {
      activeIdRef.current =
        id;

      setDeleteConfirm(
        false,
      );

      setError(
        deleteError instanceof
          Error
          ? deleteError.message
          : "Could not delete this note.",
      );
    }
  }

  async function authenticatedPost(
    path: string,
    body:
      Record<
        string,
        unknown
      >,
  ) {
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
      throw new Error(
        "You must be signed in.",
      );
    }

    const response =
      await fetch(
        path,
        {
          method:
            "POST",
          headers: {
            "Content-Type":
              "application/json",
            Authorization:
              `Bearer ${session.access_token}`,
          },
          body:
            JSON.stringify(
              body,
            ),
        },
      );

    const payload =
      (await response.json()) as Record<
        string,
        unknown
      >;

    if (
      !response.ok ||
      payload.ok !== true
    ) {
      throw new Error(
        typeof payload.error ===
          "string"
          ? payload.error
          : "AI request failed.",
      );
    }

    return payload;
  }

  async function enhance() {
    if (
      !activeId ||
      aiBusy
    ) {
      return;
    }

    const saved =
      await saveNow();

    if (!saved) {
      return;
    }

    try {
      setAiBusy(
        "enhance",
      );
      setError("");

      const payload =
        await authenticatedPost(
          "/api/notes/enhance",
          {
            noteId:
              activeId,
          },
        );

      const content =
        typeof payload.enhancedContent ===
        "string"
          ? payload.enhancedContent
          : "";

      const enhancedAt =
        typeof payload.enhancedAt ===
        "string"
          ? payload.enhancedAt
          : new Date().toISOString();

      setNotes(
        (current) =>
          current.map(
            (note) =>
              note.id ===
              activeId
                ? {
                    ...note,
                    enhanced_content:
                      content,
                    enhanced_at:
                      enhancedAt,
                    enhancement_source_updated_at:
                      note.updated_at,
                  }
                : note,
          ),
      );

      setEditorMode(
        "enhanced",
      );
    } catch (
      enhanceError
    ) {
      setError(
        enhanceError instanceof
          Error
          ? enhanceError.message
          : "Could not enhance this note.",
      );
    } finally {
      setAiBusy(
        null,
      );
    }
  }

  async function analyzeTopics() {
    if (
      !activeId ||
      aiBusy
    ) {
      return;
    }

    const saved =
      await saveNow();

    if (!saved) {
      return;
    }

    try {
      setAiBusy(
        "topics",
      );
      setError("");

      const payload =
        await authenticatedPost(
          "/api/notes/analyze-topics",
          {
            noteId:
              activeId,
          },
        );

      const analysis =
        parseAnalysis(
          payload.analysis,
        );

      setNotes(
        (current) =>
          current.map(
            (note) =>
              note.id ===
              activeId
                ? {
                    ...note,
                    topic_analysis:
                      analysis,
                  }
                : note,
          ),
      );

      const next =
        new Set<number>();

      (
        analysis.proposals ??
        []
      ).forEach(
        (
          proposal,
          index,
        ) => {
          if (
            proposal.kind ===
              "match" &&
            proposal.confidence >=
              65
          ) {
            next.add(
              index,
            );
          }
        },
      );

      setSelectedProposals(
        next,
      );
    } catch (
      topicError
    ) {
      setError(
        topicError instanceof
          Error
          ? topicError.message
          : "Could not analyze note topics.",
      );
    } finally {
      setAiBusy(
        null,
      );
    }
  }

  async function confirmTopics() {
    if (
      !activeId ||
      aiBusy
    ) {
      return;
    }

    try {
      setAiBusy(
        "confirm",
      );

      const accepted =
        proposals.filter(
          (
            _,
            index,
          ) =>
            selectedProposals.has(
              index,
            ),
        );

      const payload =
        await authenticatedPost(
          "/api/notes/confirm-topics",
          {
            noteId:
              activeId,
            accepted,
          },
        );

      setNotes(
        (current) =>
          current.map(
            (note) =>
              note.id ===
              activeId
                ? {
                    ...note,
                    topic_analysis:
                      {
                        ...note.topic_analysis,
                        status:
                          "confirmed",
                        confirmedAt:
                          new Date().toISOString(),
                        confirmedTopicIds:
                          Array.isArray(
                            payload.topicIds,
                          )
                            ? (
                                payload.topicIds as string[]
                              )
                            : [],
                      },
                  }
                : note,
          ),
      );
    } catch (
      confirmError
    ) {
      setError(
        confirmError instanceof
          Error
          ? confirmError.message
          : "Could not save topic connections.",
      );
    } finally {
      setAiBusy(
        null,
      );
    }
  }

  function changeCourse(
    courseId: string,
  ) {
    const lecture =
      draftLectureId
        ? lectureMap.get(
            draftLectureId,
          )
        : null;

    setDraftCourseId(
      courseId,
    );

    if (
      lecture &&
      courseId &&
      lecture.course_id !==
        courseId
    ) {
      setDraftLectureId(
        "",
      );
    }
  }

  function changeLecture(
    lectureId: string,
  ) {
    setDraftLectureId(
      lectureId,
    );

    const lecture =
      lectureId
        ? lectureMap.get(
            lectureId,
          )
        : null;

    if (lecture) {
      setDraftCourseId(
        lecture.course_id,
      );
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#080809] text-white">
        <div className="flex items-center gap-2 text-[11px] text-white/30">
          <Loader2
            size={13}
            className="animate-spin"
          />
          Opening Notebook
        </div>
      </main>
    );
  }

  return (
    <MotionConfig reducedMotion="user">
      <main className="relative h-[100svh] overflow-hidden bg-[#080809] text-[#F5F5F7]">
        <div
          aria-hidden
          className="pointer-events-none fixed left-[22%] top-[-360px] h-[720px] w-[820px] rounded-full opacity-[0.08] blur-[155px]"
          style={{
            backgroundColor:
              accent,
          }}
        />

        <div className="relative flex h-full min-h-0 flex-col">
          <header className="flex items-center justify-between gap-4 border-b border-white/[0.05] px-4 py-3 sm:px-6">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() =>
                  router.push(
                    "/",
                  )
                }
                className="flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.06] text-white/26 transition hover:bg-white/[0.03] hover:text-white/55"
              >
                <ArrowLeft
                  size={12}
                />
              </button>

              <SchoolMark
                size={32}
                quiet
              />

              <div>
                <p className="text-[8px] font-semibold uppercase tracking-[0.15em] text-white/22">
                  Notebook
                </p>
                <p className="mt-0.5 hidden text-[8px] text-white/15 sm:block">
                  Typed pages, paper scans, and AI study briefs.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() =>
                void createNote()
              }
              className="flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-[9px] font-medium text-black"
            >
              <Plus
                size={10}
              />
              New note
            </button>
          </header>

          {error && (
            <div className="mx-4 mt-3 rounded-[14px] border border-red-300/10 bg-red-300/[0.025] px-4 py-3 text-[8px] leading-4 text-red-100/52 sm:mx-6">
              {error}
            </div>
          )}

          <div className="border-b border-white/[0.045] px-4 py-3 md:hidden">
            <div className="flex items-center gap-2">
              <select
                value={activeId ?? ""}
                onChange={(event) => {
                  const next = notes.find(
                    (note) =>
                      note.id ===
                      event.target.value,
                  );

                  if (next) {
                    applyNote(next);
                  }
                }}
                className="min-w-0 flex-1 rounded-[12px] border border-white/[0.055] bg-white/[0.01] px-3 py-2.5 text-[9px] text-white/38 outline-none [color-scheme:dark]"
              >
                {notes.length === 0 && (
                  <option value="">
                    No notes yet
                  </option>
                )}
                {notes.map((note) => (
                  <option
                    key={note.id}
                    value={note.id}
                  >
                    {note.title === "Untitled note"
                      ? "Untitled"
                      : note.title}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent(
                      "college-assistant:open-command-center",
                    ),
                  )
                }
                aria-label="Search workspace"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] border border-white/[0.055] text-white/22"
              >
                <Search size={11} />
              </button>
            </div>
          </div>

          <div className="grid min-h-0 flex-1 md:grid-cols-[250px_minmax(0,1fr)] xl:grid-cols-[250px_minmax(0,1fr)_320px]">
            <aside className="hidden min-h-0 overflow-y-auto border-r border-white/[0.05] bg-[#0B0B0C]/55 p-4 md:block">
              <div className="flex items-center gap-2 rounded-[12px] border border-white/[0.05] bg-white/[0.008] px-3 py-2.5">
                <Search
                  size={10}
                  className="text-white/18"
                />
                <input
                  value={
                    query
                  }
                  onChange={(
                    event,
                  ) =>
                    setQuery(
                      event.target
                        .value,
                    )
                  }
                  placeholder="Search notes"
                  className="min-w-0 flex-1 bg-transparent text-[9px] text-white/42 outline-none placeholder:text-white/14"
                />
              </div>

              <div className="mt-4 space-y-1">
                {filteredNotes.map(
                  (note) => {
                    const course =
                      note.course_id
                        ? courseMap.get(
                            note.course_id,
                          )
                        : null;

                    return (
                      <button
                        key={
                          note.id
                        }
                        type="button"
                        onClick={() =>
                          applyNote(
                            note,
                          )
                        }
                        className={`w-full rounded-[13px] border px-3 py-3 text-left transition ${
                          note.id ===
                          activeId
                            ? "border-white/[0.07] bg-white/[0.03]"
                            : "border-transparent hover:bg-white/[0.015]"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className="h-1.5 w-1.5 shrink-0 rounded-full"
                            style={{
                              backgroundColor:
                                course?.color ??
                                "rgba(255,255,255,.18)",
                            }}
                          />
                          <p className="min-w-0 flex-1 truncate text-[9px] font-medium text-white/40">
                            {note.title ===
                            "Untitled note"
                              ? "Untitled"
                              : note.title}
                          </p>
                          <span className="text-[7px] text-white/11">
                            {relativeDate(
                              note.updated_at,
                            )}
                          </span>
                        </div>

                        <p className="mt-1.5 line-clamp-2 text-[7px] leading-4 text-white/14">
                          {noteContentToPlainText(note.raw_content) ||
                            "Empty note"}
                        </p>
                      </button>
                    );
                  },
                )}
              </div>
            </aside>

            <section className="min-w-0 overflow-y-auto px-4 pb-28 pt-6 sm:px-8 md:pt-7 lg:px-10 lg:pb-10">
              {activeNote ? (
                <div className="mx-auto max-w-[780px]">
                  <div className="flex flex-wrap items-start justify-between gap-3 sm:items-center">
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={
                          draftCourseId
                        }
                        onChange={(
                          event,
                        ) =>
                          changeCourse(
                            event
                              .target
                              .value,
                          )
                        }
                        className="rounded-full border border-white/[0.055] bg-white/[0.01] px-3 py-2 text-[8px] text-white/34 outline-none [color-scheme:dark]"
                      >
                        <option value="">
                          No course
                        </option>
                        {courses.map(
                          (course) => (
                            <option
                              key={
                                course.id
                              }
                              value={
                                course.id
                              }
                            >
                              {
                                course.code
                              }
                            </option>
                          ),
                        )}
                      </select>

                      <select
                        value={
                          draftLectureId
                        }
                        onChange={(
                          event,
                        ) =>
                          changeLecture(
                            event
                              .target
                              .value,
                          )
                        }
                        className="max-w-[230px] rounded-full border border-white/[0.055] bg-white/[0.01] px-3 py-2 text-[8px] text-white/34 outline-none [color-scheme:dark]"
                      >
                        <option value="">
                          No lecture
                        </option>
                        {availableLectures.map(
                          (lecture) => (
                            <option
                              key={
                                lecture.id
                              }
                              value={
                                lecture.id
                              }
                            >
                              {
                                lecture.title
                              }
                            </option>
                          ),
                        )}
                      </select>
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() =>
                          printNote({
                            title: draftTitle.trim() || "Untitled note",
                            content: draftContent,
                            course: selectedCourse
                              ? `${selectedCourse.code} · ${selectedCourse.name}`
                              : "CollegeOS Notebook",
                            updatedAt: activeNote.updated_at,
                            accent,
                          })
                        }
                        className="flex items-center gap-1.5 rounded-full border border-white/[0.055] bg-white/[0.008] px-3 py-2 text-[8px] text-white/30 transition hover:bg-white/[0.03] hover:text-white/60"
                      >
                        <Download size={9} />
                        Export PDF
                      </button>
                      <div
                        className={`flex items-center gap-1.5 text-[7px] ${
                        saveState ===
                        "error"
                          ? "text-red-200/50"
                          : "text-white/16"
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
                      ) : null}

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

                  <input
                    value={
                      draftTitle
                    }
                    onChange={(
                      event,
                    ) =>
                      setDraftTitle(
                        event.target
                          .value,
                      )
                    }
                    onBlur={() =>
                      void saveNow()
                    }
                    placeholder="Untitled note"
                    className="mt-6 w-full bg-transparent text-[34px] font-medium leading-[1.03] tracking-[-0.052em] text-white/82 outline-none placeholder:text-white/15 sm:mt-7 sm:text-[48px]"
                  />

                  <div className="mt-5 flex items-center gap-2 border-b border-white/[0.045] pb-3">
                    <button
                      type="button"
                      onClick={() =>
                        setEditorMode(
                          "original",
                        )
                      }
                      className={`rounded-full px-3 py-1.5 text-[8px] font-medium transition ${
                        editorMode ===
                        "original"
                          ? "bg-white/[0.045] text-white/55"
                          : "text-white/20"
                      }`}
                    >
                      Notebook page
                    </button>

                    <button
                      type="button"
                      disabled={
                        !activeNote.enhanced_content
                      }
                      onClick={() =>
                        setEditorMode(
                          "enhanced",
                        )
                      }
                      className={`rounded-full px-3 py-1.5 text-[8px] font-medium transition disabled:opacity-30 ${
                        editorMode ===
                        "enhanced"
                          ? "bg-white/[0.045] text-white/55"
                          : "text-white/20"
                      }`}
                    >
                      AI study brief
                    </button>

                  </div>

                  {editorMode ===
                  "original" ? (
                    <>
                    <RichNoteEditor
                      value={draftContent}
                      onChange={setDraftContent}
                      onBlur={() =>
                        void saveNow()
                      }
                      placeholder="Start anywhere — headings, concepts, equations, questions, professor emphasis, or a checklist for what to review…"
                      accent={accent}
                      className="mt-4"
                    />
                    {userId && (
                      <NotebookTools
                        noteId={activeNote.id}
                        userId={userId}
                        courseId={draftCourseId}
                        accent={accent}
                      />
                    )}
                    </>
                  ) : (
                    <div className="mt-5 min-h-[62vh] whitespace-pre-wrap text-[14px] leading-8 text-white/48">
                      {activeNote.enhanced_content ||
                        "Build an AI study brief to combine your page with the lecture and course graph."}
                    </div>
                  )}

                  <div className="mt-5 flex flex-col items-start justify-between gap-3 border-t border-white/[0.045] pt-4 sm:flex-row sm:items-center">
                    <p className="text-[7px] text-white/13">
                      {noteWordCount(
                        draftContent,
                      )}{" "}
                      words ·{" "}
                      {
                        noteContentToPlainText(draftContent).length
                      }{" "}
                      characters
                    </p>

                    <div className="flex max-w-full flex-wrap items-center gap-2">
                      {deleteConfirm ? (
                        <>
                          <span className="hidden text-[8px] text-red-100/35 sm:inline">
                            Delete this note permanently?
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setDeleteConfirm(
                                false,
                              )
                            }
                            className="rounded-full px-3 py-1.5 text-[8px] text-white/28 transition hover:text-white/52"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              void deleteNote()
                            }
                            className="flex items-center gap-1.5 rounded-full bg-red-100 px-3 py-1.5 text-[8px] font-medium text-black transition hover:bg-red-50"
                          >
                            <Trash2
                              size={8}
                            />
                            Delete permanently
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            void deleteNote()
                          }
                          className="flex items-center gap-1.5 rounded-full border border-red-300/[0.08] bg-red-300/[0.015] px-3 py-1.5 text-[8px] text-red-100/30 transition hover:border-red-300/[0.14] hover:bg-red-300/[0.035] hover:text-red-100/58"
                        >
                          <Trash2
                            size={8}
                          />
                          Delete note
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center text-center">
                  <FileText
                    size={21}
                    className="text-white/14"
                  />
                  <h2 className="mt-4 text-[22px] font-medium tracking-[-0.04em]">
                    Start with what you heard.
                  </h2>
                  <p className="mt-2 text-[9px] leading-5 text-white/20">
                    Rough notes are enough. The intelligence layer can organize them after you capture the important part.
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      void createNote()
                    }
                    className="mt-5 rounded-full bg-white px-4 py-2.5 text-[9px] font-medium text-black"
                  >
                    New note
                  </button>
                </div>
              )}
            </section>

            <aside className="hidden min-h-0 overflow-y-auto border-l border-white/[0.05] bg-[#0C0C0D]/60 p-4 xl:block">
              {activeNote ? (
                <div className="space-y-3">
                  <div className="rounded-[19px] border border-white/[0.055] bg-white/[0.008] p-4">
                    <div className="flex items-center gap-2">
                      <WandSparkles
                        size={11}
                        style={{
                          color:
                            accent,
                        }}
                      />
                      <p className="text-[8px] font-semibold uppercase tracking-[0.13em] text-white/22">
                        AI expansion
                      </p>
                    </div>

                    <p className="mt-3 text-[9px] leading-5 text-white/27">
                      Preserve your original note, then build a clearer study version beside it.
                    </p>

                    <button
                      type="button"
                      disabled={
                        aiBusy !==
                          null ||
                        !draftContent.trim()
                      }
                      onClick={() =>
                        void enhance()
                      }
                      className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-white px-3 py-2.5 text-[8px] font-medium text-black disabled:opacity-30"
                    >
                      {aiBusy ===
                      "enhance" ? (
                        <Loader2
                          size={9}
                          className="animate-spin"
                        />
                      ) : (
                        <Sparkles
                          size={9}
                        />
                      )}
                      {activeNote.enhanced_content
                        ? "Rebuild enhanced notes"
                        : "Enhance my notes"}
                    </button>
                  </div>

                  <div className="rounded-[19px] border border-white/[0.055] bg-white/[0.008] p-4">
                    <div className="flex items-center gap-2">
                      <BrainCircuit
                        size={11}
                        style={{
                          color:
                            accent,
                        }}
                      />
                      <p className="text-[8px] font-semibold uppercase tracking-[0.13em] text-white/22">
                        Course graph
                      </p>
                    </div>

                    <p className="mt-3 text-[9px] leading-5 text-white/27">
                      Map this note into real course topics. New subtopics are proposed only when the existing graph is not enough.
                    </p>

                    <button
                      type="button"
                      disabled={
                        aiBusy !==
                        null
                      }
                      onClick={() =>
                        void analyzeTopics()
                      }
                      className="mt-4 flex w-full items-center justify-center gap-2 rounded-full border border-white/[0.065] bg-white/[0.015] px-3 py-2.5 text-[8px] font-medium text-white/42 transition hover:bg-white/[0.03] disabled:opacity-30"
                    >
                      {aiBusy ===
                      "topics" ? (
                        <Loader2
                          size={9}
                          className="animate-spin"
                        />
                      ) : (
                        <BrainCircuit
                          size={9}
                        />
                      )}
                      Analyze for topics
                    </button>

                    {activeNote.topic_analysis
                      ?.message && (
                      <p className="mt-3 text-[7px] leading-4 text-white/18">
                        {
                          activeNote
                            .topic_analysis
                            .message
                        }
                      </p>
                    )}

                    {proposals.length >
                      0 && (
                      <div className="mt-4 space-y-2">
                        {proposals.map(
                          (
                            proposal,
                            index,
                          ) => {
                            const selected =
                              selectedProposals.has(
                                index,
                              );

                            return (
                              <button
                                key={`${proposal.kind}:${proposal.topicId ?? proposal.name}:${index}`}
                                type="button"
                                onClick={() => {
                                  const next =
                                    new Set(
                                      selectedProposals,
                                    );

                                  if (
                                    selected
                                  ) {
                                    next.delete(
                                      index,
                                    );
                                  } else {
                                    next.add(
                                      index,
                                    );
                                  }

                                  setSelectedProposals(
                                    next,
                                  );
                                }}
                                className={`w-full rounded-[13px] border p-3 text-left transition ${
                                  selected
                                    ? "border-white/[0.09] bg-white/[0.025]"
                                    : "border-white/[0.045] bg-black/10"
                                }`}
                              >
                                <div className="flex items-center gap-2">
                                  <span
                                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border"
                                    style={
                                      selected
                                        ? {
                                            borderColor:
                                              accent,
                                            backgroundColor:
                                              accent,
                                            color:
                                              "#080809",
                                          }
                                        : {
                                            borderColor:
                                              "rgba(255,255,255,.08)",
                                          }
                                    }
                                  >
                                    {selected && (
                                      <Check
                                        size={8}
                                      />
                                    )}
                                  </span>

                                  <p className="min-w-0 flex-1 truncate text-[8px] font-medium text-white/38">
                                    {proposal.kind ===
                                    "new"
                                      ? `New: ${proposal.name}`
                                      : proposal.name}
                                  </p>

                                  <span className="text-[7px] tabular-nums text-white/14">
                                    {Math.round(
                                      proposal.confidence,
                                    )}
                                    %
                                  </span>
                                </div>

                                <p className="mt-2 line-clamp-2 text-[7px] leading-4 text-white/16">
                                  {
                                    proposal.rationale
                                  }
                                </p>
                              </button>
                            );
                          },
                        )}

                        <button
                          type="button"
                          disabled={
                            aiBusy !==
                              null ||
                            selectedProposals.size ===
                              0
                          }
                          onClick={() =>
                            void confirmTopics()
                          }
                          className="mt-2 flex w-full items-center justify-center gap-2 rounded-full bg-white px-3 py-2.5 text-[8px] font-medium text-black disabled:opacity-30"
                        >
                          {aiBusy ===
                          "confirm" ? (
                            <Loader2
                              size={9}
                              className="animate-spin"
                            />
                          ) : (
                            <Check
                              size={9}
                            />
                          )}
                          Save selected connections
                        </button>
                      </div>
                    )}
                  </div>

                  {activeNote.enhanced_content && (
                    <SourceProvenance
                      artifactKind="note_enhancement"
                      artifactId={
                        activeNote.id
                      }
                      compact
                    />
                  )}

                  <button
                    type="button"
                    onClick={() =>
                      window.dispatchEvent(
                        new CustomEvent(
                          "college-assistant:open-command-center",
                        ),
                      )
                    }
                    className="flex w-full items-center justify-between rounded-[15px] border border-white/[0.045] bg-white/[0.006] px-4 py-3 text-left transition hover:bg-white/[0.016]"
                  >
                    <div>
                      <p className="text-[8px] font-medium text-white/32">
                        Search the whole workspace
                      </p>
                      <p className="mt-1 text-[7px] text-white/13">
                        Notes, topics, lectures, assignments, guides, files
                      </p>
                    </div>
                    <ChevronRight
                      size={9}
                      className="text-white/12"
                    />
                  </button>
                </div>
              ) : null}
            </aside>
          </div>
        </div>
      </main>
    </MotionConfig>
  );
}
