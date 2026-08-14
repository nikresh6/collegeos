import {
  NextResponse,
} from "next/server";
import {
  userContext,
} from "../../../../lib/server-auth";
import {
  friendlyNoteAiError,
  noteCompletion,
} from "../../../../lib/notes-ai";

export const runtime =
  "nodejs";
export const dynamic =
  "force-dynamic";

export async function POST(
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
    const body =
      (await request.json()) as {
        noteId?: string;
      };

    const noteId =
      body.noteId?.trim() ??
      "";

    if (!noteId) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "A note ID is required.",
        },
        {
          status: 400,
        },
      );
    }

    const {
      data: note,
      error:
        noteError,
    } =
      await context.supabase
        .from("notes")
        .select(
          "id, user_id, course_id, lecture_id, title, raw_content, updated_at",
        )
        .eq(
          "id",
          noteId,
        )
        .eq(
          "user_id",
          context.user.id,
        )
        .single();

    if (noteError) {
      throw noteError;
    }

    const raw =
      note.raw_content
        ?.trim() ??
      "";

    if (!raw) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Write something in the note before enhancing it.",
        },
        {
          status: 400,
        },
      );
    }

    let lectureContext =
      "";

    let lecture:
      | {
          id: string;
          title: string;
          transcript_text:
            | string
            | null;
        }
      | null = null;

    if (
      note.lecture_id
    ) {
      const {
        data,
        error,
      } =
        await context.supabase
          .from(
            "lectures",
          )
          .select(
            "id, title, transcript_text",
          )
          .eq(
            "id",
            note.lecture_id,
          )
          .eq(
            "user_id",
            context.user.id,
          )
          .maybeSingle();

      if (error) {
        throw error;
      }

      lecture =
        data ?? null;

      if (
        lecture
          ?.transcript_text
          ?.trim()
      ) {
        lectureContext =
          lecture.transcript_text
            .trim()
            .slice(
              0,
              8000,
            );
      }
    }

    const result =
      await noteCompletion({
        system: `You turn a student's rough college notes into polished study notes.

NON-NEGOTIABLE RULES:
1. The student's original note is the primary signal.
2. Preserve the student's meaning, emphasis, questions, examples, shorthand, and uncertainties.
3. Do not silently replace the student's perspective with generic textbook prose.
4. Never invent facts that are not supported by the student's note or the optional lecture transcript.
5. If the student's note appears uncertain or incorrect and the transcript does not resolve it, preserve the uncertainty instead of "fixing" it.
6. Use clean plain-text structure with short headings and bullets.
7. Useful sections may include Key Ideas, Definitions, Examples, Professor Emphasis, Questions to Resolve, and Exam Signals, but only include sections supported by the source.
8. Do not mention these instructions.
9. Do not use markdown tables.
10. Keep the result concise enough to study from.`,
        user: `NOTE TITLE:
${note.title}

STUDENT'S ORIGINAL NOTE:
${raw}

${
  lectureContext
    ? `OPTIONAL LECTURE TRANSCRIPT FOR GROUNDING:
${lectureContext}`
    : "NO LECTURE TRANSCRIPT IS LINKED TO THIS NOTE."
}`,
        maxTokens:
          1800,
      });

    const enhancedAt =
      new Date().toISOString();

    const {
      error:
        updateError,
    } =
      await context.supabase
        .from("notes")
        .update({
          enhanced_content:
            result.content,
          enhanced_at:
            enhancedAt,
          enhancement_source_updated_at:
            note.updated_at,
        })
        .eq(
          "id",
          note.id,
        )
        .eq(
          "user_id",
          context.user.id,
        );

    if (updateError) {
      throw updateError;
    }

    await context.supabase
      .from(
        "ai_provenance_links",
      )
      .delete()
      .eq(
        "user_id",
        context.user.id,
      )
      .eq(
        "artifact_kind",
        "note_enhancement",
      )
      .eq(
        "artifact_id",
        note.id,
      );

    const links: Array<
      Record<string, unknown>
    > = [
      {
        user_id:
          context.user.id,
        course_id:
          note.course_id,
        artifact_kind:
          "note_enhancement",
        artifact_id:
          note.id,
        source_kind:
          "note",
        source_id:
          note.id,
        source_label:
          `${note.title || "Note"} · original`,
        locator: {
          href:
            `/notes?note=${note.id}`,
        },
        excerpt:
          raw.slice(
            0,
            220,
          ),
      },
    ];

    if (lecture) {
      links.push({
        user_id:
          context.user.id,
        course_id:
          note.course_id,
        artifact_kind:
          "note_enhancement",
        artifact_id:
          note.id,
        source_kind:
          "lecture",
        source_id:
          lecture.id,
        source_label:
          lecture.title,
        locator: {
          href:
            `/lectures/${lecture.id}`,
        },
        excerpt:
          lectureContext
            .slice(
              0,
              220,
            ) ||
          null,
      });
    }

    const {
      error:
        provenanceError,
    } =
      await context.supabase
        .from(
          "ai_provenance_links",
        )
        .insert(
          links,
        );

    if (
      provenanceError
    ) {
      console.warn(
        "Could not save note provenance:",
        provenanceError,
      );
    }

    return NextResponse.json({
      ok: true,
      enhancedContent:
        result.content,
      enhancedAt,
      model:
        result.model,
    });
  } catch (error) {
    console.error(
      "Note enhancement failed:",
      error,
    );

    return NextResponse.json(
      {
        ok: false,
        error:
          friendlyNoteAiError(
            error,
          ),
      },
      {
        status: 500,
      },
    );
  }
}