import {
  NextResponse,
} from "next/server";
import {
  userContext,
} from "../../../../lib/server-auth";

export const runtime =
  "nodejs";
export const dynamic =
  "force-dynamic";

type AcceptedProposal = {
  kind:
    | "match"
    | "new";
  topicId?: string | null;
  parentTopicId?: string | null;
  name?: string;
  confidence?: number;
  rationale?: string;
};

function normalizeName(
  value: string,
) {
  return value
    .toLowerCase()
    .replace(
      /[^\p{L}\p{N}]+/gu,
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
        accepted?: AcceptedProposal[];
      };

    const noteId =
      body.noteId?.trim() ??
      "";

    const accepted =
      Array.isArray(
        body.accepted,
      )
        ? body.accepted
        : [];

    const {
      data: note,
      error: noteError,
    } =
      await context.supabase
        .from("notes")
        .select(
          "id, course_id, topic_analysis",
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
      return NextResponse.json(
        {
          ok: false,
          error:
            "Assign this note to a course first.",
        },
        {
          status: 400,
        },
      );
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
          "id, name, unit_id, parent_topic_id, position",
        )
        .eq(
          "user_id",
          context.user.id,
        )
        .eq(
          "course_id",
          note.course_id,
        );

    if (topicsError) {
      throw topicsError;
    }

    type TopicRow = {
      id: string;
      name: string;
      unit_id: string | null;
      parent_topic_id: string | null;
      position: number;
    };

    const existingTopics =
      (topics ?? []) as TopicRow[];

    const topicMap =
      new Map<string, TopicRow>(
        existingTopics.map(
          (topic) => [
            topic.id,
            topic,
          ],
        ),
      );

    const finalIds:
      string[] = [];

    for (
      const proposal of
      accepted.slice(
        0,
        8,
      )
    ) {
      if (
        proposal.kind ===
        "match" &&
        proposal.topicId &&
        topicMap.has(
          proposal.topicId,
        )
      ) {
        finalIds.push(
          proposal.topicId,
        );
        continue;
      }

      if (
        proposal.kind !==
          "new" ||
        !proposal.parentTopicId ||
        !proposal.name?.trim()
      ) {
        continue;
      }

      const parent =
        topicMap.get(
          proposal.parentTopicId,
        );

      if (!parent) {
        continue;
      }

      const cleanName =
        proposal.name.trim();

      const duplicate =
        existingTopics.find(
          (topic) =>
            topic.parent_topic_id ===
              parent.id &&
            normalizeName(
              topic.name,
            ) ===
              normalizeName(
                cleanName,
              ),
        );

      if (duplicate) {
        finalIds.push(
          duplicate.id,
        );
        continue;
      }

      const maxPosition =
        existingTopics.reduce(
          (
            maximum,
            topic,
          ) =>
            Math.max(
              maximum,
              Number(
                topic.position ??
                  0,
              ),
            ),
          0,
        );

      const {
        data: created,
        error:
          createError,
      } =
        await context.supabase
          .from(
            "course_topics",
          )
          .insert({
            user_id:
              context.user.id,
            course_id:
              note.course_id,
            unit_id:
              parent.unit_id ??
              null,
            parent_topic_id:
              parent.id,
            source_file_id:
              null,
            name:
              cleanName,
            description:
              proposal.rationale?.trim() ||
              null,
            position:
              maxPosition +
              1,
            source:
              "notes",
            mastery_score:
              0,
            mastery_state:
              "unseen",
          })
          .select(
            "id, name, unit_id, parent_topic_id, position",
          )
          .single();

      if (createError) {
        throw createError;
      }

      existingTopics.push(
        created as TopicRow,
      );

      topicMap.set(
        created.id,
        created,
      );

      finalIds.push(
        created.id,
      );
    }

    const uniqueIds =
      Array.from(
        new Set(
          finalIds,
        ),
      );

    if (
      uniqueIds.length >
      0
    ) {
      const proposalByTopic =
        new Map(
          accepted
            .filter(
              (proposal) =>
                proposal.kind ===
                  "match" &&
                proposal.topicId,
            )
            .map(
              (proposal) => [
                proposal.topicId!,
                proposal,
              ],
            ),
        );

      const {
        error:
          linkError,
      } =
        await context.supabase
          .from(
            "note_topic_links",
          )
          .upsert(
            uniqueIds.map(
              (topicId) => {
                const proposal =
                  proposalByTopic.get(
                    topicId,
                  );

                return {
                  user_id:
                    context.user.id,
                  note_id:
                    note.id,
                  course_id:
                    note.course_id,
                  topic_id:
                    topicId,
                  confidence:
                    proposal?.confidence !==
                    undefined
                      ? Math.max(
                          0,
                          Math.min(
                            1,
                            Number(
                              proposal.confidence,
                            ) /
                              100,
                          ),
                        )
                      : null,
                  rationale:
                    proposal?.rationale ??
                    null,
                  relation_source:
                    "ai_reviewed",
                };
              },
            ),
            {
              onConflict:
                "note_id,topic_id",
            },
          );

      if (linkError) {
        throw linkError;
      }
    }

    const previous =
      note.topic_analysis &&
      typeof note.topic_analysis ===
        "object" &&
      !Array.isArray(
        note.topic_analysis,
      )
        ? note.topic_analysis
        : {};

    const {
      error:
        noteUpdateError,
    } =
      await context.supabase
        .from("notes")
        .update({
          topic_analysis: {
            ...previous,
            status:
              "confirmed",
            confirmedAt:
              new Date().toISOString(),
            confirmedTopicIds:
              uniqueIds,
          },
        })
        .eq(
          "id",
          note.id,
        );

    if (
      noteUpdateError
    ) {
      throw noteUpdateError;
    }

    return NextResponse.json({
      ok: true,
      topicIds:
        uniqueIds,
      message:
        uniqueIds.length >
        0
          ? `Saved ${uniqueIds.length} course connection${uniqueIds.length === 1 ? "" : "s"}.`
          : "No topic connections were selected.",
    });
  } catch (error) {
    console.error(
      "Note topic confirmation failed:",
      error,
    );

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof
          Error
            ? error.message
            : "Could not save note topic connections.",
      },
      {
        status: 500,
      },
    );
  }
}