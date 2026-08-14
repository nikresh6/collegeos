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

type Proposal = {
  kind:
    | "match"
    | "new";
  topicId: string | null;
  parentTopicId: string | null;
  name: string;
  confidence: number;
  rationale: string;
};

function clean(
  value: string,
) {
  return value
    .replace(
      /\t/g,
      " ",
    )
    .replace(
      /\r?\n/g,
      " ",
    )
    .replace(
      /\s+/g,
      " ",
    )
    .trim();
}

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

    const {
      data: note,
      error: noteError,
    } =
      await context.supabase
        .from("notes")
        .select(
          "id, course_id, title, raw_content, enhanced_content, updated_at",
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

    if (
      !note.course_id
    ) {
      const analysis = {
        status:
          "needs_course",
        analyzedAt:
          new Date().toISOString(),
        proposals: [],
        message:
          "Assign this note to a course before mapping it into the course knowledge graph.",
      };

      await context.supabase
        .from("notes")
        .update({
          topic_analysis:
            analysis,
        })
        .eq(
          "id",
          note.id,
        );

      return NextResponse.json({
        ok: true,
        analysis,
      });
    }

    const {
      data: topics,
      error:
        topicsError,
    } =
      await context.supabase
        .from(
          "course_topics",
        )
        .select(
          "id, name, description, parent_topic_id, unit_id",
        )
        .eq(
          "user_id",
          context.user.id,
        )
        .eq(
          "course_id",
          note.course_id,
        )
        .order(
          "position",
          {
            ascending: true,
          },
        );

    if (topicsError) {
      throw topicsError;
    }

    if (
      !topics ||
      topics.length ===
        0
    ) {
      const analysis = {
        status:
          "no_topics",
        analyzedAt:
          new Date().toISOString(),
        proposals: [],
        message:
          "This course does not have topics yet. Add instructional materials first so Notes can map into a real course graph.",
      };

      await context.supabase
        .from("notes")
        .update({
          topic_analysis:
            analysis,
        })
        .eq(
          "id",
          note.id,
        );

      return NextResponse.json({
        ok: true,
        analysis,
      });
    }

    const topicIds =
      new Set(
        topics.map(
          (topic) =>
            topic.id,
        ),
      );

    const topicList =
      topics
        .map(
          (topic) =>
            `${topic.id}\t${topic.name}\t${topic.parent_topic_id ?? ""}\t${topic.description?.slice(0, 120) ?? ""}`,
        )
        .join("\n");

    const content =
      (
        note.enhanced_content ||
        note.raw_content ||
        ""
      )
        .trim()
        .slice(
          0,
          10000,
        );

    const result =
      await noteCompletion({
        system: `You map a student's note into an EXISTING course knowledge graph.

STRICT RULES:
1. Prefer existing topics whenever the note fits them.
2. Never generate free-floating keyword tags.
3. MATCH lines may only use IDs supplied in the existing topic list.
4. NEW is rare. Only propose a new durable subtopic when no existing topic captures an important concept.
5. Every NEW proposal must have an existing supplied topic as its parent.
6. Propose at most 6 matches and at most 2 new subtopics.
7. Return ONLY tab-separated tagged lines.
8. Do not output JSON, markdown, or prose outside those lines.

OUTPUT:
MATCH<TAB>topicId<TAB>confidence 0-100<TAB>short rationale
NEW<TAB>parentTopicId<TAB>new subtopic name<TAB>confidence 0-100<TAB>short rationale`,
        user: `NOTE:
${note.title}

NOTE CONTENT:
${content}

EXISTING COURSE TOPICS:
ID<TAB>NAME<TAB>PARENT_ID<TAB>DESCRIPTION
${topicList}`,
        maxTokens:
          650,
      });

    const proposals:
      Proposal[] = [];

    for (
      const line of
      result.content
        .split(/\r?\n/)
        .map(
          (value) =>
            value.trim(),
        )
        .filter(Boolean)
    ) {
      const parts =
        line.split("\t");

      const tag =
        parts[0]
          ?.toUpperCase();

      if (
        tag === "MATCH"
      ) {
        const topicId =
          clean(
            parts[1] ??
              "",
          );

        if (
          !topicIds.has(
            topicId,
          )
        ) {
          continue;
        }

        const topic =
          topics.find(
            (candidate) =>
              candidate.id ===
              topicId,
          );

        const confidence =
          Math.max(
            0,
            Math.min(
              100,
              Number(
                parts[2] ??
                  0,
              ) || 0,
            ),
          );

        proposals.push({
          kind:
            "match",
          topicId,
          parentTopicId:
            null,
          name:
            topic?.name ??
            "Course topic",
          confidence,
          rationale:
            clean(
              parts
                .slice(3)
                .join(
                  " ",
                ),
            ),
        });

        continue;
      }

      if (
        tag === "NEW"
      ) {
        const parentTopicId =
          clean(
            parts[1] ??
              "",
          );

        const name =
          clean(
            parts[2] ??
              "",
          );

        if (
          !topicIds.has(
            parentTopicId,
          ) ||
          !name
        ) {
          continue;
        }

        const confidence =
          Math.max(
            0,
            Math.min(
              100,
              Number(
                parts[3] ??
                  0,
              ) || 0,
            ),
          );

        proposals.push({
          kind:
            "new",
          topicId:
            null,
          parentTopicId,
          name,
          confidence,
          rationale:
            clean(
              parts
                .slice(4)
                .join(
                  " ",
                ),
            ),
        });
      }
    }

    const deduped =
      Array.from(
        new Map(
          proposals.map(
            (proposal) => [
              proposal.kind ===
              "match"
                ? `match:${proposal.topicId}`
                : `new:${proposal.parentTopicId}:${proposal.name.toLowerCase()}`,
              proposal,
            ],
          ),
        ).values(),
      ).slice(0, 8);

    const analysis = {
      status:
        "review",
      analyzedAt:
        new Date().toISOString(),
      proposals:
        deduped,
      message:
        deduped.length >
        0
          ? "Review the topic connections before saving them."
          : "No strong topic connections were found.",
    };

    const {
      error:
        updateError,
    } =
      await context.supabase
        .from("notes")
        .update({
          topic_analysis:
            analysis,
        })
        .eq(
          "id",
          note.id,
        );

    if (updateError) {
      throw updateError;
    }

    return NextResponse.json({
      ok: true,
      analysis,
      model:
        result.model,
    });
  } catch (error) {
    console.error(
      "Note topic analysis failed:",
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