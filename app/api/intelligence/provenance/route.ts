import {
  NextResponse,
} from "next/server";
import type {
  SupabaseClient,
} from "@supabase/supabase-js";
import {
  userContext,
} from "../../../../lib/server-auth";
import { noteContentToPlainText } from "../../../../lib/note-content";

export const runtime =
  "nodejs";
export const dynamic =
  "force-dynamic";

type ArtifactKind =
  | "study_guide"
  | "study_question"
  | "material_analysis"
  | "lecture_analysis"
  | "note_enhancement"
  | "attention";

type ProvenanceLink = {
  id?: string;
  sourceKind:
    | "lecture"
    | "note"
    | "material"
    | "topic"
    | "calendar";
  sourceId: string | null;
  sourceLabel: string;
  locator: Record<
    string,
    unknown
  >;
  excerpt: string | null;
  href: string | null;
};

function validKind(
  value: string | null,
): value is ArtifactKind {
  return (
    value ===
      "study_guide" ||
    value ===
      "study_question" ||
    value ===
      "material_analysis" ||
    value ===
      "lecture_analysis" ||
    value ===
      "note_enhancement" ||
    value ===
      "attention"
  );
}

function sourceHref(
  sourceKind: string,
  sourceId: string | null,
  locator: Record<
    string,
    unknown
  >,
) {
  if (
    typeof locator.href ===
    "string"
  ) {
    return locator.href;
  }

  if (
    !sourceId
  ) {
    return null;
  }

  if (
    sourceKind ===
    "lecture"
  ) {
    const seconds =
      Number(
        locator.seconds,
      );

    return Number.isFinite(
      seconds,
    )
      ? `/lectures/${sourceId}?t=${Math.max(
          0,
          Math.round(
            seconds,
          ),
        )}`
      : `/lectures/${sourceId}`;
  }

  if (
    sourceKind ===
    "note"
  ) {
    return `/notes?note=${sourceId}`;
  }

  return null;
}

async function saveLinks({
  supabase,
  userId,
  courseId,
  artifactKind,
  artifactId,
  links,
}: {
  supabase: SupabaseClient;
  userId: string;
  courseId: string | null;
  artifactKind: ArtifactKind;
  artifactId: string;
  links: ProvenanceLink[];
}) {
  if (
    links.length === 0
  ) {
    return;
  }

  await supabase
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
      artifactKind,
    )
    .eq(
      "artifact_id",
      artifactId,
    );

  const {
    error,
  } =
    await supabase
      .from(
        "ai_provenance_links",
      )
      .insert(
        links.map(
          (link) => ({
            user_id:
              userId,
            course_id:
              courseId,
            artifact_kind:
              artifactKind,
            artifact_id:
              artifactId,
            artifact_path:
              null,
            source_kind:
              link.sourceKind,
            source_id:
              link.sourceId,
            source_label:
              link.sourceLabel,
            locator:
              link.locator,
            excerpt:
              link.excerpt,
          }),
        ),
      );

  if (error) {
    console.warn(
      "Could not cache provenance:",
      error,
    );
  }
}

async function materialSources({
  supabase,
  courseId,
  fileIds,
}: {
  supabase: SupabaseClient;
  courseId: string;
  fileIds: string[];
}) {
  if (
    fileIds.length ===
    0
  ) {
    return [];
  }

  const [
    {
      data: files,
      error:
        fileError,
    },
    {
      data: lectures,
      error:
        lectureError,
    },
  ] =
    await Promise.all([
      supabase
        .from(
          "course_files",
        )
        .select(
          "id, file_name, material_type, course_id",
        )
        .in(
          "id",
          fileIds,
        ),

      supabase
        .from(
          "lectures",
        )
        .select(
          "id, course_file_id, title",
        )
        .in(
          "course_file_id",
          fileIds,
        ),
    ]);

  if (fileError) {
    throw fileError;
  }

  if (lectureError) {
    throw lectureError;
  }

  type MaterialRow = {
    id: string;
    file_name: string;
    material_type: string;
    course_id: string;
  };

  type LectureRow = {
    id: string;
    course_file_id: string;
    title: string;
  };

  const fileRows =
    (files ?? []) as MaterialRow[];

  const lectureRows =
    (lectures ?? []) as LectureRow[];

  const lectureByFile =
    new Map<string, LectureRow>(
      lectureRows.map(
        (lecture) => [
          lecture.course_file_id,
          lecture,
        ],
      ),
    );

  return fileRows.map(
    (file) => {
      const lecture =
        lectureByFile.get(
          file.id,
        );

      if (lecture) {
        return {
          sourceKind:
            "lecture" as const,
          sourceId:
            lecture.id,
          sourceLabel:
            lecture.title,
          locator: {
            href:
              `/lectures/${lecture.id}`,
          },
          excerpt:
            null,
          href:
            `/lectures/${lecture.id}`,
        };
      }

      return {
        sourceKind:
          "material" as const,
        sourceId:
          file.id,
        sourceLabel:
          file.file_name,
        locator: {
          href:
            `/courses/${courseId}?material=${file.id}`,
          materialType:
            file.material_type,
        },
        excerpt:
          null,
        href:
          `/courses/${courseId}?material=${file.id}`,
      };
    },
  );
}

async function generateLinks({
  supabase,
  userId,
  artifactKind,
  artifactId,
}: {
  supabase: SupabaseClient;
  userId: string;
  artifactKind: ArtifactKind;
  artifactId: string;
}) {
  if (
    artifactKind ===
    "study_guide"
  ) {
    const {
      data: guide,
      error,
    } =
      await supabase
        .from(
          "study_guides",
        )
        .select(
          "id, course_id, source_refs",
        )
        .eq(
          "id",
          artifactId,
        )
        .eq(
          "user_id",
          userId,
        )
        .single();

    if (error) {
      throw error;
    }

    const refs =
      Array.isArray(
        guide.source_refs,
      )
        ? guide.source_refs
        : [];

    const fileIds: string[] =
      Array.from(
        new Set<string>(
          refs
            .map(
              (
                raw,
              ) => {
                if (
                  !raw ||
                  typeof raw !==
                    "object" ||
                  Array.isArray(
                    raw,
                  )
                ) {
                  return "";
                }

                return typeof (
                  raw as Record<
                    string,
                    unknown
                  >
                ).fileId ===
                  "string"
                  ? (
                      raw as Record<
                        string,
                        string
                      >
                    ).fileId
                  : "";
              },
            )
            .filter(Boolean),
        ),
      );

    return {
      courseId:
        guide.course_id,
      links:
        await materialSources(
          {
            supabase,
            courseId:
              guide.course_id,
            fileIds,
          },
        ),
    };
  }

  if (
    artifactKind ===
    "study_question"
  ) {
    const {
      data: question,
      error,
    } =
      await supabase
        .from(
          "study_questions",
        )
        .select(
          "id, course_id, source_refs",
        )
        .eq(
          "id",
          artifactId,
        )
        .eq(
          "user_id",
          userId,
        )
        .single();

    if (error) {
      throw error;
    }

    const refs =
      Array.isArray(
        question.source_refs,
      )
        ? question.source_refs
        : [];

    const fileIds: string[] =
      refs
        .map(
          (raw) => {
            if (
              !raw ||
              typeof raw !==
                "object" ||
              Array.isArray(
                raw,
              )
            ) {
              return "";
            }

            return typeof (
              raw as Record<
                string,
                unknown
              >
            ).fileId ===
              "string"
              ? (
                  raw as Record<
                    string,
                    string
                  >
                ).fileId
              : "";
          },
        )
        .filter(Boolean);

    return {
      courseId:
        question.course_id,
      links:
        await materialSources(
          {
            supabase,
            courseId:
              question.course_id,
            fileIds,
          },
        ),
    };
  }

  if (
    artifactKind ===
    "lecture_analysis"
  ) {
    const {
      data: lecture,
      error:
        lectureError,
    } =
      await supabase
        .from(
          "lectures",
        )
        .select(
          "id, course_id, title, transcript_text",
        )
        .eq(
          "id",
          artifactId,
        )
        .eq(
          "user_id",
          userId,
        )
        .single();

    if (lectureError) {
      throw lectureError;
    }

    const {
      data: notes,
      error:
        notesError,
    } =
      await supabase
        .from("notes")
        .select(
          "id, title, raw_content",
        )
        .eq(
          "user_id",
          userId,
        )
        .eq(
          "lecture_id",
          lecture.id,
        );

    if (notesError) {
      throw notesError;
    }

    const links:
      ProvenanceLink[] = [
      {
        sourceKind:
          "lecture",
        sourceId:
          lecture.id,
        sourceLabel:
          lecture.title,
        locator: {
          href:
            `/lectures/${lecture.id}`,
          seconds: 0,
        },
        excerpt:
          lecture.transcript_text
            ?.trim()
            .slice(
              0,
              180,
            ) ??
          null,
        href:
          `/lectures/${lecture.id}`,
      },
    ];

    for (
      const note of
      notes ?? []
    ) {
      const noteText = noteContentToPlainText(note.raw_content);
      if (!noteText) {
        continue;
      }

      links.push({
        sourceKind:
          "note",
        sourceId:
          note.id,
        sourceLabel:
          note.title ||
          "Lecture notes",
        locator: {
          href:
            `/notes?note=${note.id}`,
        },
        excerpt:
          noteText.slice(0, 180),
        href:
          `/notes?note=${note.id}`,
      });
    }

    return {
      courseId:
        lecture.course_id,
      links,
    };
  }

  if (
    artifactKind ===
    "material_analysis"
  ) {
    const {
      data: analysis,
      error,
    } =
      await supabase
        .from(
          "material_analyses",
        )
        .select(
          "id, course_id, course_file_id, summary",
        )
        .eq(
          "id",
          artifactId,
        )
        .eq(
          "user_id",
          userId,
        )
        .single();

    if (error) {
      throw error;
    }

    const links =
      await materialSources({
        supabase,
        courseId:
          analysis.course_id,
        fileIds: [
          analysis.course_file_id,
        ],
      });

    return {
      courseId:
        analysis.course_id,
      links,
    };
  }

  if (
    artifactKind ===
    "note_enhancement"
  ) {
    const {
      data: note,
      error,
    } =
      await supabase
        .from("notes")
        .select(
          "id, course_id, title, raw_content",
        )
        .eq(
          "id",
          artifactId,
        )
        .eq(
          "user_id",
          userId,
        )
        .single();

    if (error) {
      throw error;
    }

    return {
      courseId:
        note.course_id,
      links: [
        {
          sourceKind:
            "note" as const,
          sourceId:
            note.id,
          sourceLabel:
            `${note.title || "Note"} · original`,
          locator: {
            href:
              `/notes?note=${note.id}`,
          },
          excerpt:
            noteContentToPlainText(note.raw_content).slice(0, 180) || null,
          href:
            `/notes?note=${note.id}`,
        },
      ],
    };
  }

  return {
    courseId: null,
    links: [],
  };
}

export async function GET(
  request: Request,
) {
  const context =
    await userContext(
      request,
    );

  if (!context) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "You are not signed in.",
      },
      {
        status: 401,
      },
    );
  }

  try {
    const url =
      new URL(
        request.url,
      );

    const kind =
      url.searchParams.get(
        "kind",
      );

    const artifactId =
      url.searchParams.get(
        "id",
      )?.trim() ??
      "";

    if (
      !validKind(kind) ||
      !artifactId
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "A valid artifact kind and ID are required.",
        },
        {
          status: 400,
        },
      );
    }

    const {
      data: cached,
      error:
        cachedError,
    } =
      await context.supabase
        .from(
          "ai_provenance_links",
        )
        .select(
          "id, source_kind, source_id, source_label, locator, excerpt",
        )
        .eq(
          "user_id",
          context.user.id,
        )
        .eq(
          "artifact_kind",
          kind,
        )
        .eq(
          "artifact_id",
          artifactId,
        )
        .order(
          "created_at",
          {
            ascending: true,
          },
        );

    if (cachedError) {
      throw cachedError;
    }

    if (
      cached &&
      cached.length > 0
    ) {
      return NextResponse.json({
        ok: true,
        links:
          cached.map(
            (link) => {
              const locator =
                link.locator &&
                typeof link.locator ===
                  "object" &&
                !Array.isArray(
                  link.locator,
                )
                  ? (
                      link.locator as Record<
                        string,
                        unknown
                      >
                    )
                  : {};

              return {
                id:
                  link.id,
                sourceKind:
                  link.source_kind,
                sourceId:
                  link.source_id ??
                  null,
                sourceLabel:
                  link.source_label,
                locator,
                excerpt:
                  link.excerpt ??
                  null,
                href:
                  sourceHref(
                    link.source_kind,
                    link.source_id ??
                      null,
                    locator,
                  ),
              };
            },
          ),
      });
    }

    const generated =
      await generateLinks({
        supabase:
          context.supabase,
        userId:
          context.user.id,
        artifactKind:
          kind,
        artifactId,
      });

    await saveLinks({
      supabase:
        context.supabase,
      userId:
        context.user.id,
      courseId:
        generated.courseId,
      artifactKind:
        kind,
      artifactId,
      links:
        generated.links,
    });

    return NextResponse.json({
      ok: true,
      links:
        generated.links,
    });
  } catch (error) {
    console.error(
      "Provenance lookup failed:",
      error,
    );

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof
          Error
            ? error.message
            : "Could not load sources.",
      },
      {
        status: 500,
      },
    );
  }
}
