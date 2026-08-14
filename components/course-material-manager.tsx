"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  usePathname,
} from "next/navigation";
import {
  FileText,
  FolderOpen,
  Headphones,
  Loader2,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import {
  AnimatePresence,
  motion,
} from "framer-motion";
import { supabase } from "../lib/supabase";
import {
  useSchoolIdentity,
} from "./school-identity";

type Course = {
  id: string;
  code: string;
  name: string;
  color: string;
};

type Material = {
  id: string;
  file_name: string;
  material_type: string;
  processing_status: string;
  size_bytes: number | null;
  created_at: string;
};

function materialTypeLabel(
  value: string,
) {
  const labels: Record<
    string,
    string
  > = {
    lecture_slides:
      "Lecture slides",
    lecture_notes:
      "Lecture notes",
    lecture_recording:
      "Lecture recording",
    handwritten_notes:
      "Notes",
    homework:
      "Homework / worksheet",
    returned_homework:
      "Returned homework",
    quiz: "Quiz",
    exam: "Exam",
    study_guide:
      "Study guide",
    textbook:
      "Textbook / reading",
    reference:
      "Reference",
    other: "Other",
  };

  return labels[value] ??
    "Material";
}

function formatFileSize(
  value: number | null,
) {
  if (
    value === null ||
    !Number.isFinite(value)
  ) {
    return "Size unavailable";
  }

  if (value < 1024) {
    return `${value} B`;
  }

  if (
    value <
    1024 * 1024
  ) {
    return `${(
      value / 1024
    ).toFixed(1)} KB`;
  }

  return `${(
    value /
    (1024 * 1024)
  ).toFixed(1)} MB`;
}

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

export function CourseMaterialManager() {
  const pathname =
    usePathname();
  const { identity } =
    useSchoolIdentity();

  const courseId =
    useMemo(() => {
      const match =
        pathname.match(
          /^\/courses\/([^/]+)\/?$/,
        );

      return match?.[1] ??
        null;
    }, [pathname]);

  const [open, setOpen] =
    useState(false);
  const [loading, setLoading] =
    useState(false);
  const [course, setCourse] =
    useState<Course | null>(
      null,
    );
  const [materials, setMaterials] =
    useState<Material[]>([]);
  const [error, setError] =
    useState("");
  const [warning, setWarning] =
    useState("");
  const [deleteTarget, setDeleteTarget] =
    useState<string | null>(
      null,
    );
  const [deletingId, setDeletingId] =
    useState<string | null>(
      null,
    );

  const accent =
    course?.color ??
    identity.primary;

  const loadMaterials =
    useCallback(async () => {
      if (!courseId) {
        setCourse(null);
        setMaterials([]);
        return;
      }

      try {
        setLoading(true);
        setError("");
        setWarning("");

        const [
          {
            data: courseData,
            error: courseError,
          },
          {
            data: materialData,
            error: materialError,
          },
        ] = await Promise.all([
          supabase
            .from("courses")
            .select(
              "id, code, name, color",
            )
            .eq("id", courseId)
            .maybeSingle(),
          supabase
            .from("course_files")
            .select(
              "id, file_name, material_type, processing_status, size_bytes, created_at",
            )
            .eq(
              "course_id",
              courseId,
            )
            .not(
              "material_type",
              "in",
              '("syllabus","course_calendar")',
            )
            .order(
              "created_at",
              {
                ascending:
                  false,
              },
            ),
        ]);

        if (courseError) {
          throw courseError;
        }

        if (materialError) {
          throw materialError;
        }

        setCourse(
          courseData
            ? {
                id:
                  courseData.id,
                code:
                  courseData.code,
                name:
                  courseData.name,
                color:
                  courseData.color,
              }
            : null,
        );

        setMaterials(
          (materialData ?? []).map(
            (material) => ({
              id: material.id,
              file_name:
                material.file_name,
              material_type:
                material.material_type,
              processing_status:
                material.processing_status,
              size_bytes:
                material.size_bytes ===
                null
                  ? null
                  : Number(
                      material.size_bytes,
                    ),
              created_at:
                material.created_at,
            }),
          ),
        );
      } catch (loadError) {
        console.error(
          "Could not load material manager:",
          loadError,
        );

        setError(
          loadError instanceof
            Error
            ? loadError.message
            : "Could not load course materials.",
        );
      } finally {
        setLoading(false);
      }
    }, [courseId]);

  useEffect(() => {
    if (!courseId) {
      setOpen(false);
      setCourse(null);
      setMaterials([]);
      return;
    }

    if (open) {
      void loadMaterials();
    }
  }, [
    courseId,
    loadMaterials,
    open,
  ]);

  async function deleteMaterial(
    material: Material,
  ) {
    if (
      deletingId ||
      material.processing_status ===
        "processing"
    ) {
      return;
    }

    if (
      deleteTarget !==
      material.id
    ) {
      setDeleteTarget(
        material.id,
      );
      return;
    }

    try {
      setDeletingId(
        material.id,
      );
      setError("");
      setWarning("");

      const {
        data: { session },
        error: sessionError,
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

      const response =
        await fetch(
          `/api/materials/${material.id}`,
          {
            method: "DELETE",
            headers: {
              Authorization: `Bearer ${session.access_token}`,
            },
          },
        );

      const payload =
        (await response.json()) as {
          ok?: boolean;
          error?: string;
          warning?: string | null;
        };

      if (
        !response.ok ||
        payload.ok !== true
      ) {
        throw new Error(
          payload.error ||
            "Could not delete this material.",
        );
      }

      setMaterials(
        (current) =>
          current.filter(
            (item) =>
              item.id !==
              material.id,
          ),
      );

      setDeleteTarget(null);

      if (payload.warning) {
        setWarning(
          payload.warning,
        );
      }

      window.dispatchEvent(
        new CustomEvent(
          "collegeassistant:material-deleted",
          {
            detail: {
              materialId:
                material.id,
              courseId,
            },
          },
        ),
      );
    } catch (deleteError) {
      console.error(
        "Could not delete material:",
        deleteError,
      );

      setError(
        deleteError instanceof
          Error
          ? deleteError.message
          : "Could not delete this material.",
      );
    } finally {
      setDeletingId(null);
    }
  }

  if (!courseId) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        onClick={() =>
          setOpen(true)
        }
        className="fixed bottom-5 right-5 z-[92] flex items-center gap-2 rounded-full border border-white/[0.075] bg-[#111113]/94 px-3.5 py-2.5 text-[9px] font-medium text-white/38 shadow-[0_18px_45px_rgba(0,0,0,0.35)] backdrop-blur-xl transition hover:bg-[#171719] hover:text-white/64 md:bottom-7 md:right-7"
      >
        <Settings2
          size={11}
        />
        Manage materials
      </button>

      <AnimatePresence>
        {open && (
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
            className="fixed inset-0 z-[260] flex items-end justify-center bg-black/70 backdrop-blur-xl sm:items-center sm:p-6"
          >
            <button
              type="button"
              onClick={() =>
                setOpen(false)
              }
              className="absolute inset-0"
              aria-label="Close material manager"
            />

            <motion.div
              initial={{
                opacity: 0,
                y: 18,
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
              className="relative z-10 max-h-[88vh] w-full overflow-hidden rounded-t-[28px] border border-white/[0.08] bg-[#0D0D0F] shadow-2xl shadow-black/60 sm:max-w-[720px] sm:rounded-[28px]"
            >
              <div
                aria-hidden
                className="pointer-events-none absolute right-[-100px] top-[-150px] h-[330px] w-[330px] rounded-full opacity-[0.08] blur-[105px]"
                style={{
                  backgroundColor:
                    accent,
                }}
              />

              <header className="relative flex items-start justify-between gap-4 border-b border-white/[0.06] px-5 py-5 sm:px-7 sm:py-6">
                <div>
                  <p
                    className="text-[9px] font-semibold uppercase tracking-[0.15em]"
                    style={{
                      color:
                        accent,
                    }}
                  >
                    {course?.code ??
                      "Course"} · Materials
                  </p>
                  <h2 className="mt-2 text-[25px] font-medium tracking-[-0.045em] text-white/88">
                    Remove an upload.
                  </h2>
                  <p className="mt-2 max-w-lg text-[10px] leading-5 text-white/28">
                    Delete an accidental or outdated upload. Its saved AI analysis and topic links are removed with it, while the course's topic definitions remain intact.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    setOpen(false)
                  }
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.04] text-white/30 transition hover:bg-white/[0.07] hover:text-white/62"
                >
                  <X
                    size={14}
                  />
                </button>
              </header>

              <div className="relative max-h-[64vh] overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
                {error && (
                  <div className="mb-4 rounded-[14px] border border-red-400/15 bg-red-400/[0.035] px-4 py-3">
                    <p className="text-[9px] leading-5 text-red-200/62">
                      {error}
                    </p>
                  </div>
                )}

                {warning && (
                  <div className="mb-4 rounded-[14px] border border-amber-300/12 bg-amber-300/[0.025] px-4 py-3">
                    <p className="text-[9px] leading-5 text-amber-100/52">
                      {warning}
                    </p>
                  </div>
                )}

                {loading ? (
                  <div className="flex min-h-[220px] items-center justify-center gap-2 text-[10px] text-white/28">
                    <Loader2
                      size={12}
                      className="animate-spin"
                    />
                    Loading materials
                  </div>
                ) : materials.length ===
                  0 ? (
                  <div className="py-14 text-center">
                    <FolderOpen
                      size={20}
                      className="mx-auto text-white/15"
                    />
                    <p className="mt-4 text-[11px] font-medium text-white/42">
                      No removable materials.
                    </p>
                    <p className="mt-2 text-[9px] text-white/20">
                      Your syllabus is managed separately from the course overview.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {materials.map(
                      (material) => {
                        const lecture =
                          material.material_type ===
                          "lecture_recording";
                        const busy =
                          material.processing_status ===
                          "processing";
                        const confirming =
                          deleteTarget ===
                          material.id;
                        const deleting =
                          deletingId ===
                          material.id;

                        return (
                          <div
                            key={
                              material.id
                            }
                            className="rounded-[17px] border border-white/[0.055] bg-white/[0.009] p-3.5 sm:p-4"
                          >
                            <div className="flex items-center gap-3">
                              <div
                                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px]"
                                style={{
                                  backgroundColor: `${accent}0D`,
                                  color:
                                    accent,
                                }}
                              >
                                {lecture ? (
                                  <Headphones
                                    size={14}
                                  />
                                ) : (
                                  <FileText
                                    size={14}
                                  />
                                )}
                              </div>

                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[10px] font-medium text-white/58">
                                  {
                                    material.file_name
                                  }
                                </p>
                                <p className="mt-1 text-[8px] text-white/20">
                                  {materialTypeLabel(
                                    material.material_type,
                                  )}{" "}
                                  ·{" "}
                                  {formatFileSize(
                                    material.size_bytes,
                                  )}{" "}
                                  ·{" "}
                                  {formatDate(
                                    material.created_at,
                                  )}
                                </p>
                              </div>

                              {busy ? (
                                <span className="shrink-0 rounded-full border border-white/[0.05] px-2.5 py-1.5 text-[7px] text-white/22">
                                  Processing
                                </span>
                              ) : confirming ? (
                                <div className="flex shrink-0 items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setDeleteTarget(
                                        null,
                                      )
                                    }
                                    className="rounded-full px-2.5 py-2 text-[8px] text-white/28 transition hover:text-white/58"
                                  >
                                    Keep
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void deleteMaterial(
                                        material,
                                      )
                                    }
                                    disabled={
                                      deleting
                                    }
                                    className="flex items-center gap-1.5 rounded-full bg-red-200/90 px-3 py-2 text-[8px] font-medium text-black disabled:opacity-40"
                                  >
                                    {deleting ? (
                                      <Loader2
                                        size={9}
                                        className="animate-spin"
                                      />
                                    ) : (
                                      <Trash2
                                        size={9}
                                      />
                                    )}
                                    Delete
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() =>
                                    void deleteMaterial(
                                      material,
                                    )
                                  }
                                  disabled={
                                    Boolean(
                                      deletingId,
                                    )
                                  }
                                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/18 transition hover:bg-red-400/[0.05] hover:text-red-200/55 disabled:opacity-30"
                                  aria-label={`Delete ${material.file_name}`}
                                >
                                  <Trash2
                                    size={12}
                                  />
                                </button>
                              )}
                            </div>

                            {busy && (
                              <p className="mt-3 border-t border-white/[0.04] pt-3 text-[8px] leading-4 text-white/20">
                                Finish or cancel this material's active processing before deleting it.
                              </p>
                            )}
                          </div>
                        );
                      },
                    )}
                  </div>
                )}
              </div>

              <footer className="relative flex items-center justify-between gap-4 border-t border-white/[0.055] px-5 py-4 sm:px-7">
                <p className="text-[8px] leading-4 text-white/18">
                  Deletion cannot be undone.
                </p>
                <button
                  type="button"
                  onClick={() =>
                    void loadMaterials()
                  }
                  disabled={
                    loading
                  }
                  className="text-[8px] font-medium text-white/28 transition hover:text-white/52 disabled:opacity-30"
                >
                  Refresh
                </button>
              </footer>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}