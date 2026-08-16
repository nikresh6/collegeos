import {
  NextResponse,
} from "next/server";
import {
  userContext,
} from "../../../../lib/server-auth";
import { noteContentToPlainText } from "../../../../lib/note-content";

export const runtime =
  "nodejs";
export const dynamic =
  "force-dynamic";

type SearchKind =
  | "course"
  | "note"
  | "lecture"
  | "material"
  | "topic"
  | "assignment"
  | "study_guide"
  | "calendar";

type SearchResult = {
  id: string;
  kind: SearchKind;
  title: string;
  subtitle: string;
  href: string;
  courseId: string | null;
  color: string | null;
  meta?: string | null;
};

type SearchAction = {
  id: string;
  type:
    | "navigate"
    | "create_note"
    | "schedule_study";
  title: string;
  subtitle: string;
  href?: string;
  query?: string;
};

type Course = {
  id: string;
  code: string;
  name: string;
  color: string;
};

type Topic = {
  id: string;
  course_id: string;
  name: string;
};

type CollectionIntent =
  | "lectures"
  | "notes"
  | "assignments"
  | "guides"
  | "materials"
  | "courses"
  | "topics"
  | "calendar"
  | null;

const STOP_WORDS =
  new Set([
    "a",
    "all",
    "an",
    "and",
    "can",
    "could",
    "find",
    "for",
    "get",
    "give",
    "i",
    "is",
    "list",
    "me",
    "my",
    "of",
    "open",
    "please",
    "show",
    "the",
    "to",
    "where",
    "would",
  ]);

const COLLECTION_WORDS =
  new Set([
    "assignment",
    "assignments",
    "calendar",
    "class",
    "classes",
    "course",
    "courses",
    "deadline",
    "deadlines",
    "file",
    "files",
    "guide",
    "guides",
    "homework",
    "lecture",
    "lectures",
    "material",
    "materials",
    "note",
    "notes",
    "recording",
    "recordings",
    "schedule",
    "topic",
    "topics",
  ]);

function normalize(
  value: string,
) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(
      /[^\p{L}\p{N}\s]/gu,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

function tokensFrom(
  value: string,
) {
  const unique =
    new Set(
      normalize(value)
        .split(" ")
        .map((token) =>
          token.replace(
            /[^\p{L}\p{N}]/gu,
            "",
          ),
        )
        .filter(
          (token) =>
            token.length >= 2 &&
            !STOP_WORDS.has(
              token,
            ) &&
            !COLLECTION_WORDS.has(
              token,
            ),
        ),
    );

  return Array.from(
    unique,
  ).slice(0, 4);
}

function searchTokensFrom(
  value: string,
) {
  const meaningful =
    tokensFrom(value);

  if (
    meaningful.length > 0
  ) {
    return meaningful;
  }

  return normalize(value)
    .split(" ")
    .filter(
      (token) =>
        token.length >= 2 &&
        !STOP_WORDS.has(
          token,
        ),
    )
    .slice(0, 3);
}

function ilikeOr(
  columns: string[],
  tokens: string[],
) {
  return tokens
    .flatMap((token) =>
      columns.map(
        (column) =>
          `${column}.ilike.%${token}%`,
      ),
    )
    .join(",");
}

function courseMapFrom(
  courses: Course[],
) {
  return new Map(
    courses.map(
      (course) => [
        course.id,
        course,
      ],
    ),
  );
}

function collectionIntent(
  query: string,
): CollectionIntent {
  const normalized =
    normalize(query);

  const words =
    normalized.split(" ");

  const collectionPhrase =
    words.length <= 4 ||
    /\b(my|all|recent|latest|last)\b/.test(
      normalized,
    ) ||
    /^(find|show|list|get|open|where)\b/.test(
      normalized,
    );

  if (!collectionPhrase) {
    return null;
  }

  if (
    /\b(lecture|lectures|recording|recordings)\b/.test(
      normalized,
    )
  ) {
    return "lectures";
  }

  if (
    /\b(note|notes)\b/.test(
      normalized,
    )
  ) {
    return "notes";
  }

  if (
    /\b(assignment|assignments|homework|deadline|deadlines)\b/.test(
      normalized,
    )
  ) {
    return "assignments";
  }

  if (
    /\b(study guide|study guides|guide|guides)\b/.test(
      normalized,
    )
  ) {
    return "guides";
  }

  if (
    /\b(material|materials|file|files)\b/.test(
      normalized,
    )
  ) {
    return "materials";
  }

  if (
    /\b(course|courses|class|classes)\b/.test(
      normalized,
    )
  ) {
    return "courses";
  }

  if (
    /\b(topic|topics)\b/.test(
      normalized,
    )
  ) {
    return "topics";
  }

  if (
    /\b(calendar|schedule)\b/.test(
      normalized,
    )
  ) {
    return "calendar";
  }

  return null;
}

function mentionedCourse(
  query: string,
  courses: Course[],
) {
  const normalized =
    normalize(query);

  const ranked =
    courses
      .map((course) => {
        const code =
          normalize(
            course.code,
          );

        const name =
          normalize(
            course.name,
          );

        let score = 0;

        if (
          normalized.includes(
            code,
          )
        ) {
          score += 100;
        }

        if (
          normalized.includes(
            name,
          )
        ) {
          score += 90;
        }

        const nameTokens =
          name
            .split(" ")
            .filter(
              (token) =>
                token.length >= 4,
            );

        score +=
          nameTokens.filter(
            (token) =>
              normalized.includes(
                token,
              ),
          ).length * 18;

        return {
          course,
          score,
        };
      })
      .sort(
        (a, b) =>
          b.score - a.score,
      );

  return ranked[0] &&
    ranked[0].score >= 18
    ? ranked[0].course
    : null;
}

function resultScore(
  query: string,
  item: SearchResult,
) {
  const tokens =
    searchTokensFrom(
      query,
    );

  const title =
    normalize(item.title);

  const subtitle =
    normalize(
      item.subtitle,
    );

  const meta =
    normalize(
      item.meta ?? "",
    );

  let score = 0;

  for (
    const token of tokens
  ) {
    if (
      title === token
    ) {
      score += 100;
    } else if (
      title.startsWith(
        token,
      )
    ) {
      score += 52;
    } else if (
      title.includes(
        token,
      )
    ) {
      score += 38;
    }

    if (
      subtitle.includes(
        token,
      )
    ) {
      score += 22;
    }

    if (
      meta.includes(
        token,
      )
    ) {
      score += 10;
    }
  }

  const kindBoost:
    Record<
      SearchKind,
      number
    > = {
    course: 15,
    topic: 14,
    note: 11,
    lecture: 11,
    assignment: 10,
    study_guide: 9,
    material: 8,
    calendar: 6,
  };

  return (
    score +
    kindBoost[item.kind]
  );
}

function bestEntityAction({
  originalQuery,
  intent,
  courses,
  topics,
}: {
  originalQuery: string;
  intent:
    | "study"
    | "open";
  courses: Course[];
  topics: Topic[];
}) {
  const stripped =
    normalize(
      originalQuery.replace(
        intent === "study"
          ? /^study\s+/i
          : /^open\s+/i,
        "",
      ),
    );

  if (!stripped) {
    return null;
  }

  const courseMap =
    courseMapFrom(
      courses,
    );

  const topicCandidates =
    topics
      .map((topic) => {
        const name =
          normalize(
            topic.name,
          );

        const score =
          name === stripped
            ? 100
            : name.includes(
                  stripped,
                )
              ? 85
              : stripped.includes(
                    name,
                  )
                ? 78
                : stripped
                    .split(" ")
                    .filter(
                      (token) =>
                        token.length >
                          2 &&
                        name.includes(
                          token,
                        ),
                    ).length *
                  14;

        return {
          topic,
          score,
        };
      })
      .sort(
        (a, b) =>
          b.score - a.score,
      );

  const topTopic =
    topicCandidates[0];

  if (
    topTopic &&
    topTopic.score >= 28
  ) {
    const course =
      courseMap.get(
        topTopic.topic
          .course_id,
      );

    if (course) {
      return {
        title:
          intent === "study"
            ? `Study ${topTopic.topic.name}`
            : `Open ${topTopic.topic.name}`,
        subtitle:
          `${course.code} · topic`,
        href:
          intent === "study"
            ? `/study?course=${course.id}&topics=${topTopic.topic.id}`
            : `/courses/${course.id}`,
      };
    }
  }

  const course =
    mentionedCourse(
      stripped,
      courses,
    );

  if (!course) {
    return null;
  }

  return {
    title:
      intent === "study"
        ? `Study ${course.code}`
        : `Open ${course.code}`,
    subtitle:
      course.name,
    href:
      intent === "study"
        ? `/study?course=${course.id}`
        : `/courses/${course.id}`,
  };
}

async function collectionResults({
  context,
  intent,
  query,
  courses,
}: {
  context: NonNullable<
    Awaited<
      ReturnType<
        typeof userContext
      >
    >
  >;
  intent: Exclude<
    CollectionIntent,
    null
  >;
  query: string;
  courses: Course[];
}) {
  const courseMap =
    courseMapFrom(
      courses,
    );

  const course =
    mentionedCourse(
      query,
      courses,
    );

  const normalized =
    normalize(query);

  const latestOnly =
    /\b(last|latest)\b/.test(
      normalized,
    );

  const limit =
    latestOnly ? 1 : 10;

  const results:
    SearchResult[] = [];

  if (
    intent === "courses"
  ) {
    return courses.map(
      (item) => ({
        id: item.id,
        kind:
          "course" as const,
        title: item.code,
        subtitle: item.name,
        href:
          `/courses/${item.id}`,
        courseId: item.id,
        color: item.color,
      }),
    );
  }

  if (
    intent === "topics"
  ) {
    let queryBuilder =
      context.supabase
        .from(
          "course_topics",
        )
        .select(
          "id, course_id, name, description, mastery_score",
        )
        .eq(
          "user_id",
          context.user.id,
        );

    if (course) {
      queryBuilder =
        queryBuilder.eq(
          "course_id",
          course.id,
        );
    }

    const {
      data,
      error,
    } =
      await queryBuilder
        .order(
          "position",
          {
            ascending: true,
          },
        )
        .limit(limit);

    if (error) {
      throw error;
    }

    for (
      const topic of data ?? []
    ) {
      const topicCourse =
        courseMap.get(
          topic.course_id,
        );

      results.push({
        id: topic.id,
        kind: "topic",
        title: topic.name,
        subtitle:
          `${topicCourse?.code ?? "Topic"} · ${Math.round(
            Number(
              topic.mastery_score ??
                0,
            ),
          )}% mastery`,
        href:
          `/study?course=${topic.course_id}&topics=${topic.id}`,
        courseId:
          topic.course_id,
        color:
          topicCourse?.color ??
          null,
        meta:
          topic.description ??
          null,
      });
    }

    return results;
  }

  if (
    intent === "lectures"
  ) {
    let queryBuilder =
      context.supabase
        .from("lectures")
        .select(
          "id, title, summary, course_id, status, captured_at",
        )
        .eq(
          "user_id",
          context.user.id,
        );

    if (course) {
      queryBuilder =
        queryBuilder.eq(
          "course_id",
          course.id,
        );
    }

    const {
      data,
      error,
    } =
      await queryBuilder
        .order(
          "captured_at",
          {
            ascending: false,
          },
        )
        .limit(limit);

    if (error) {
      throw error;
    }

    for (
      const lecture of data ?? []
    ) {
      const lectureCourse =
        courseMap.get(
          lecture.course_id,
        );

      results.push({
        id: lecture.id,
        kind: "lecture",
        title: lecture.title,
        subtitle:
          `${lectureCourse?.code ?? "Lecture"} · ${lecture.status}`,
        href:
          `/lectures/${lecture.id}`,
        courseId:
          lecture.course_id,
        color:
          lectureCourse?.color ??
          null,
        meta:
          lecture.summary
            ?.slice(0, 120) ??
          null,
      });
    }

    return results;
  }

  if (
    intent === "notes"
  ) {
    let queryBuilder =
      context.supabase
        .from("notes")
        .select(
          "id, title, raw_content, course_id, updated_at",
        )
        .eq(
          "user_id",
          context.user.id,
        );

    if (course) {
      queryBuilder =
        queryBuilder.eq(
          "course_id",
          course.id,
        );
    }

    const {
      data,
      error,
    } =
      await queryBuilder
        .order(
          "updated_at",
          {
            ascending: false,
          },
        )
        .limit(limit);

    if (error) {
      throw error;
    }

    for (
      const note of data ?? []
    ) {
      const noteCourse =
        note.course_id
          ? courseMap.get(
              note.course_id,
            )
          : null;

      results.push({
        id: note.id,
        kind: "note",
        title:
          note.title ||
          "Untitled note",
        subtitle:
          noteCourse
            ? `${noteCourse.code} · note`
            : "Standalone note",
        href:
          `/notes?note=${note.id}`,
        courseId:
          note.course_id ??
          null,
        color:
          noteCourse?.color ??
          null,
        meta:
          noteContentToPlainText(note.raw_content).slice(0, 120) || null,
      });
    }

    return results;
  }

  if (
    intent === "guides"
  ) {
    let queryBuilder =
      context.supabase
        .from(
          "study_guides",
        )
        .select(
          "id, title, course_id, depth_percent, updated_at",
        )
        .eq(
          "user_id",
          context.user.id,
        );

    if (course) {
      queryBuilder =
        queryBuilder.eq(
          "course_id",
          course.id,
        );
    }

    const {
      data,
      error,
    } =
      await queryBuilder
        .order(
          "updated_at",
          {
            ascending: false,
          },
        )
        .limit(limit);

    if (error) {
      throw error;
    }

    for (
      const guide of data ?? []
    ) {
      const guideCourse =
        courseMap.get(
          guide.course_id,
        );

      results.push({
        id: guide.id,
        kind:
          "study_guide",
        title: guide.title,
        subtitle:
          `${guideCourse?.code ?? "Study"} · ${guide.depth_percent}% guide`,
        href:
          `/study/guide/${guide.id}`,
        courseId:
          guide.course_id,
        color:
          guideCourse?.color ??
          null,
      });
    }

    return results;
  }

  if (
    intent === "materials"
  ) {
    let queryBuilder =
      context.supabase
        .from(
          "course_files",
        )
        .select(
          "id, file_name, material_type, course_id, processing_status, updated_at",
        )
        .eq(
          "user_id",
          context.user.id,
        );

    if (course) {
      queryBuilder =
        queryBuilder.eq(
          "course_id",
          course.id,
        );
    }

    const {
      data,
      error,
    } =
      await queryBuilder
        .order(
          "updated_at",
          {
            ascending: false,
          },
        )
        .limit(limit);

    if (error) {
      throw error;
    }

    for (
      const material of data ?? []
    ) {
      const materialCourse =
        courseMap.get(
          material.course_id,
        );

      results.push({
        id: material.id,
        kind: "material",
        title:
          material.file_name,
        subtitle:
          `${materialCourse?.code ?? "Material"} · ${material.material_type.replaceAll(
            "_",
            " ",
          )}`,
        href:
          `/courses/${material.course_id}?material=${material.id}`,
        courseId:
          material.course_id,
        color:
          materialCourse?.color ??
          null,
        meta:
          material.processing_status,
      });
    }

    return results;
  }

  if (
    intent === "calendar"
  ) {
    const now =
      new Date().toISOString();

    let queryBuilder =
      context.supabase
        .from(
          "calendar_items",
        )
        .select(
          "id, title, item_type, starts_at, course_id, status",
        )
        .eq(
          "user_id",
          context.user.id,
        )
        .neq(
          "status",
          "cancelled",
        )
        .gte(
          "starts_at",
          now,
        );

    if (course) {
      queryBuilder =
        queryBuilder.eq(
          "course_id",
          course.id,
        );
    }

    const {
      data,
      error,
    } =
      await queryBuilder
        .order(
          "starts_at",
          {
            ascending: true,
          },
        )
        .limit(limit);

    if (error) {
      throw error;
    }

    for (
      const item of data ?? []
    ) {
      const itemCourse =
        item.course_id
          ? courseMap.get(
              item.course_id,
            )
          : null;

      results.push({
        id: item.id,
        kind: "calendar",
        title: item.title,
        subtitle:
          `${itemCourse?.code ?? "Calendar"} · ${item.item_type}`,
        href: "/calendar",
        courseId:
          item.course_id ??
          null,
        color:
          itemCourse?.color ??
          null,
        meta:
          item.starts_at,
      });
    }

    return results;
  }

  const today =
    new Date()
      .toISOString()
      .slice(0, 10);

  let eventQuery =
    context.supabase
      .from(
        "course_events",
      )
      .select(
        "id, course_id, name, event_type, start_date, notes",
      )
      .eq(
        "user_id",
        context.user.id,
      )
      .gte(
        "start_date",
        today,
      );

  if (course) {
    eventQuery =
      eventQuery.eq(
        "course_id",
        course.id,
      );
  }

  const {
    data: events,
    error: eventsError,
  } =
    await eventQuery
      .order(
        "start_date",
        {
          ascending: true,
        },
      )
      .limit(limit);

  if (eventsError) {
    throw eventsError;
  }

  for (
    const event of events ?? []
  ) {
    const eventCourse =
      courseMap.get(
        event.course_id,
      );

    results.push({
      id: event.id,
      kind: "assignment",
      title: event.name,
      subtitle:
        `${eventCourse?.code ?? "Course"} · ${event.event_type.replaceAll(
          "_",
          " ",
        )}`,
      href: "/calendar",
      courseId:
        event.course_id,
      color:
        eventCourse?.color ??
        null,
      meta:
        event.start_date,
    });
  }

  return results;
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

    const originalQuery =
      url.searchParams.get(
        "q",
      ) ?? "";

    const normalized =
      normalize(
        originalQuery,
      );

    const [
      {
        data: courses,
        error: coursesError,
      },
      {
        data: allTopics,
        error:
          allTopicsError,
      },
    ] =
      await Promise.all([
        context.supabase
          .from("courses")
          .select(
            "id, code, name, color",
          )
          .eq(
            "user_id",
            context.user.id,
          )
          .is(
            "archived_at",
            null,
          )
          .order(
            "created_at",
            {
              ascending: true,
            },
          ),

        context.supabase
          .from(
            "course_topics",
          )
          .select(
            "id, course_id, name",
          )
          .eq(
            "user_id",
            context.user.id,
          ),
      ]);

    if (coursesError) {
      throw coursesError;
    }

    if (allTopicsError) {
      throw allTopicsError;
    }

    const activeCourses =
      (courses ?? []) as Course[];

    const topicsForActions =
      (allTopics ?? []) as Topic[];

    const actions:
      SearchAction[] = [];

    if (
      /^(create|new)\s+(a\s+)?note$/.test(
        normalized,
      )
    ) {
      actions.push({
        id:
          "create-note",
        type:
          "create_note",
        title:
          "Create a new note",
        subtitle:
          "Start writing immediately",
      });
    }

    if (
      normalized.startsWith(
        "study ",
      )
    ) {
      const action =
        bestEntityAction({
          originalQuery,
          intent:
            "study",
          courses:
            activeCourses,
          topics:
            topicsForActions,
        });

      if (action) {
        actions.push({
          id:
            "study-target",
          type:
            "navigate",
          ...action,
        });
      }
    }

    if (
      normalized.startsWith(
        "open ",
      )
    ) {
      const action =
        bestEntityAction({
          originalQuery,
          intent:
            "open",
          courses:
            activeCourses,
          topics:
            topicsForActions,
        });

      if (action) {
        actions.push({
          id:
            "open-target",
          type:
            "navigate",
          ...action,
        });
      }
    }

    if (
      /^(schedule|plan)\b/.test(
        normalized,
      ) &&
      /\bstudy\b/.test(
        normalized,
      )
    ) {
      actions.push({
        id:
          "schedule-study",
        type:
          "schedule_study",
        title:
          "Schedule this study block",
        subtitle:
          "Use your calendar, learned study pattern, and existing conflicts",
        query:
          originalQuery,
      });
    }

    if (
      [
        "what should i do",
        "what matters",
        "attention",
        "priorities",
      ].some(
        (phrase) =>
          normalized.includes(
            phrase,
          ),
      )
    ) {
      actions.push({
        id:
          "open-attention",
        type:
          "navigate",
        title:
          "Show what needs attention",
        subtitle:
          "Open the Home control center",
        href: "/",
      });
    }

    if (
      normalized.length < 2
    ) {
      return NextResponse.json({
        ok: true,
        query:
          originalQuery,
        results: [],
        actions,
        interpretedAs:
          null,
      });
    }

    const intent =
      collectionIntent(
        originalQuery,
      );

    if (intent) {
      const results =
        await collectionResults({
          context,
          intent,
          query:
            originalQuery,
          courses:
            activeCourses,
        });

      return NextResponse.json({
        ok: true,
        query:
          originalQuery,
        results,
        actions,
        interpretedAs:
          intent,
      });
    }

    const tokens =
      searchTokensFrom(
        originalQuery,
      );

    if (
      tokens.length === 0
    ) {
      return NextResponse.json({
        ok: true,
        query:
          originalQuery,
        results: [],
        actions,
        interpretedAs:
          null,
      });
    }

    const noteFilter =
      ilikeOr(
        [
          "title",
          "raw_content",
        ],
        tokens,
      );

    const lectureFilter =
      ilikeOr(
        [
          "title",
          "summary",
        ],
        tokens,
      );

    const topicFilter =
      ilikeOr(
        [
          "name",
          "description",
        ],
        tokens,
      );

    const eventFilter =
      ilikeOr(
        ["name"],
        tokens,
      );

    const calendarFilter =
      ilikeOr(
        ["title"],
        tokens,
      );

    const guideFilter =
      ilikeOr(
        ["title"],
        tokens,
      );

    const materialFilter =
      ilikeOr(
        ["file_name"],
        tokens,
      );

    const [
      notes,
      lectures,
      materials,
      topicResults,
      courseEvents,
      calendarItems,
      guides,
    ] =
      await Promise.all([
        context.supabase
          .from("notes")
          .select(
            "id, title, raw_content, course_id, updated_at",
          )
          .eq(
            "user_id",
            context.user.id,
          )
          .or(
            noteFilter,
          )
          .order(
            "updated_at",
            {
              ascending: false,
            },
          )
          .limit(10),

        context.supabase
          .from(
            "lectures",
          )
          .select(
            "id, title, summary, course_id, status, captured_at",
          )
          .eq(
            "user_id",
            context.user.id,
          )
          .or(
            lectureFilter,
          )
          .order(
            "captured_at",
            {
              ascending: false,
            },
          )
          .limit(10),

        context.supabase
          .from(
            "course_files",
          )
          .select(
            "id, file_name, material_type, course_id, processing_status, updated_at",
          )
          .eq(
            "user_id",
            context.user.id,
          )
          .or(
            materialFilter,
          )
          .order(
            "updated_at",
            {
              ascending: false,
            },
          )
          .limit(10),

        context.supabase
          .from(
            "course_topics",
          )
          .select(
            "id, name, description, course_id, mastery_score",
          )
          .eq(
            "user_id",
            context.user.id,
          )
          .or(
            topicFilter,
          )
          .limit(12),

        context.supabase
          .from(
            "course_events",
          )
          .select(
            "id, name, event_type, start_date, course_id",
          )
          .eq(
            "user_id",
            context.user.id,
          )
          .or(
            eventFilter,
          )
          .order(
            "start_date",
            {
              ascending: true,
            },
          )
          .limit(10),

        context.supabase
          .from(
            "calendar_items",
          )
          .select(
            "id, title, item_type, starts_at, course_id",
          )
          .eq(
            "user_id",
            context.user.id,
          )
          .or(
            calendarFilter,
          )
          .order(
            "starts_at",
            {
              ascending: true,
            },
          )
          .limit(10),

        context.supabase
          .from(
            "study_guides",
          )
          .select(
            "id, title, course_id, depth_percent, created_at, updated_at",
          )
          .eq(
            "user_id",
            context.user.id,
          )
          .or(
            guideFilter,
          )
          .order(
            "updated_at",
            {
              ascending: false,
            },
          )
          .limit(10),
      ]);

    const errors =
      [
        notes.error,
        lectures.error,
        materials.error,
        topicResults.error,
        courseEvents.error,
        calendarItems.error,
        guides.error,
      ].filter(Boolean);

    if (
      errors.length > 0
    ) {
      throw errors[0];
    }

    const courseMap =
      courseMapFrom(
        activeCourses,
      );

    const results:
      SearchResult[] = [];

    for (
      const course of
      activeCourses
    ) {
      const haystack =
        normalize(
          `${course.code} ${course.name}`,
        );

      if (
        tokens.some(
          (token) =>
            haystack.includes(
              token,
            ),
        )
      ) {
        results.push({
          id: course.id,
          kind: "course",
          title: course.code,
          subtitle:
            course.name,
          href:
            `/courses/${course.id}`,
          courseId:
            course.id,
          color:
            course.color,
        });
      }
    }

    for (
      const note of
      notes.data ?? []
    ) {
      const course =
        note.course_id
          ? courseMap.get(
              note.course_id,
            )
          : null;

      results.push({
        id: note.id,
        kind: "note",
        title:
          note.title ||
          "Untitled note",
        subtitle:
          course
            ? `${course.code} · note`
            : "Standalone note",
        href:
          `/notes?note=${note.id}`,
        courseId:
          note.course_id ??
          null,
        color:
          course?.color ??
          null,
        meta:
          noteContentToPlainText(note.raw_content).slice(0, 120) || null,
      });
    }

    for (
      const lecture of
      lectures.data ?? []
    ) {
      const course =
        courseMap.get(
          lecture.course_id,
        );

      results.push({
        id: lecture.id,
        kind: "lecture",
        title:
          lecture.title,
        subtitle:
          `${course?.code ?? "Lecture"} · ${lecture.status}`,
        href:
          `/lectures/${lecture.id}`,
        courseId:
          lecture.course_id,
        color:
          course?.color ??
          null,
        meta:
          lecture.summary
            ?.slice(0, 120) ??
          null,
      });
    }

    for (
      const material of
      materials.data ?? []
    ) {
      const course =
        courseMap.get(
          material.course_id,
        );

      results.push({
        id: material.id,
        kind: "material",
        title:
          material.file_name,
        subtitle:
          `${course?.code ?? "Material"} · ${material.material_type.replaceAll(
            "_",
            " ",
          )}`,
        href:
          `/courses/${material.course_id}?material=${material.id}`,
        courseId:
          material.course_id,
        color:
          course?.color ??
          null,
        meta:
          material.processing_status,
      });
    }

    for (
      const topic of
      topicResults.data ?? []
    ) {
      const course =
        courseMap.get(
          topic.course_id,
        );

      results.push({
        id: topic.id,
        kind: "topic",
        title: topic.name,
        subtitle:
          `${course?.code ?? "Topic"} · ${Math.round(
            Number(
              topic.mastery_score ??
                0,
            ),
          )}% mastery`,
        href:
          `/study?course=${topic.course_id}&topics=${topic.id}`,
        courseId:
          topic.course_id,
        color:
          course?.color ??
          null,
        meta:
          topic.description
            ?.slice(0, 120) ??
          null,
      });
    }

    for (
      const event of
      courseEvents.data ?? []
    ) {
      const course =
        courseMap.get(
          event.course_id,
        );

      results.push({
        id: event.id,
        kind:
          "assignment",
        title: event.name,
        subtitle:
          `${course?.code ?? "Course"} · ${event.event_type.replaceAll(
            "_",
            " ",
          )}`,
        href: "/calendar",
        courseId:
          event.course_id,
        color:
          course?.color ??
          null,
        meta:
          event.start_date,
      });
    }

    for (
      const item of
      calendarItems.data ?? []
    ) {
      const course =
        item.course_id
          ? courseMap.get(
              item.course_id,
            )
          : null;

      results.push({
        id: item.id,
        kind:
          [
            "assignment",
            "exam",
            "quiz",
          ].includes(
            item.item_type,
          )
            ? "assignment"
            : "calendar",
        title: item.title,
        subtitle:
          `${course?.code ?? "Calendar"} · ${item.item_type}`,
        href: "/calendar",
        courseId:
          item.course_id ??
          null,
        color:
          course?.color ??
          null,
        meta:
          item.starts_at,
      });
    }

    for (
      const guide of
      guides.data ?? []
    ) {
      const course =
        courseMap.get(
          guide.course_id,
        );

      results.push({
        id: guide.id,
        kind:
          "study_guide",
        title: guide.title,
        subtitle:
          `${course?.code ?? "Study"} · ${guide.depth_percent}% guide`,
        href:
          `/study/guide/${guide.id}`,
        courseId:
          guide.course_id,
        color:
          course?.color ??
          null,
        meta:
          guide.created_at,
      });
    }

    const deduped =
      Array.from(
        new Map(
          results.map(
            (result) => [
              `${result.kind}:${result.id}`,
              result,
            ],
          ),
        ).values(),
      )
        .sort(
          (a, b) =>
            resultScore(
              originalQuery,
              b,
            ) -
            resultScore(
              originalQuery,
              a,
            ),
        )
        .slice(0, 28);

    return NextResponse.json({
      ok: true,
      query:
        originalQuery,
      results:
        deduped,
      actions,
      interpretedAs:
        null,
    });
  } catch (error) {
    console.error(
      "Universal search failed:",
      error,
    );

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not search your academic workspace.",
      },
      {
        status: 500,
      },
    );
  }
}
