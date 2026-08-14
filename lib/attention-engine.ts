import type {
  SupabaseClient,
} from "@supabase/supabase-js";

export type AttentionUrgency =
  | "critical"
  | "high"
  | "medium"
  | "low";

export type AttentionKind =
  | "exam"
  | "quiz"
  | "assignment"
  | "missed_study"
  | "weak_topic"
  | "new_topics"
  | "lecture_ready";

export type AttentionAction = {
  label: string;
  href: string;
};

export type AttentionItem = {
  key: string;
  kind: AttentionKind;
  title: string;
  detail: string;
  score: number;
  urgency: AttentionUrgency;
  courseId: string | null;
  courseCode: string | null;
  color: string | null;
  dueAt: string | null;
  preparedness: number | null;
  action: AttentionAction;
  secondaryAction?: AttentionAction | null;
  metadata: Record<
    string,
    unknown
  >;
};

export type AttentionSnapshot = {
  generatedAt: string;
  primary: AttentionItem | null;
  items: AttentionItem[];
  criticalCount: number;
  highCount: number;
};

type CourseRow = {
  id: string;
  code: string;
  name: string;
  color: string;
};

type TopicRow = {
  id: string;
  course_id: string;
  parent_topic_id: string | null;
  name: string;
  mastery_score: number;
  mastery_state: string;
  source: string;
  created_at: string;
};

type CourseEventRow = {
  id: string;
  course_id: string;
  name: string;
  event_type: string;
  start_date: string | null;
  notes: string | null;
};

type CalendarItemRow = {
  id: string;
  course_id: string | null;
  title: string;
  item_type: string;
  starts_at: string;
  ends_at: string;
  status: string;
  source: string;
  topic_ids: unknown;
};

function localDateKey(
  date: Date,
  timeZone: string,
) {
  const parts =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      },
    ).formatToParts(date);

  const values =
    Object.fromEntries(
      parts.map((part) => [
        part.type,
        part.value,
      ]),
    );

  return `${values.year}-${values.month}-${values.day}`;
}

function dayOrdinal(
  dateKey: string,
) {
  const [year, month, day] =
    dateKey
      .split("-")
      .map(Number);

  return Math.floor(
    Date.UTC(
      year,
      month - 1,
      day,
    ) /
      86400000,
  );
}

function daysBetween(
  fromKey: string,
  toKey: string,
) {
  return (
    dayOrdinal(toKey) -
    dayOrdinal(fromKey)
  );
}

function dateKeyPlusDays(
  dateKey: string,
  days: number,
) {
  const [year, month, day] =
    dateKey
      .split("-")
      .map(Number);

  const date =
    new Date(
      Date.UTC(
        year,
        month - 1,
        day + days,
        12,
      ),
    );

  return [
    date.getUTCFullYear(),
    String(
      date.getUTCMonth() + 1,
    ).padStart(2, "0"),
    String(
      date.getUTCDate(),
    ).padStart(2, "0"),
  ].join("-");
}

function urgencyFromScore(
  score: number,
): AttentionUrgency {
  if (score >= 92) {
    return "critical";
  }

  if (score >= 76) {
    return "high";
  }

  if (score >= 55) {
    return "medium";
  }

  return "low";
}

function plural(
  count: number,
  word: string,
) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function dateDistanceText(
  daysAway: number,
) {
  if (daysAway < 0) {
    return `${plural(
      Math.abs(daysAway),
      "day",
    )} overdue`;
  }

  if (daysAway === 0) {
    return "today";
  }

  if (daysAway === 1) {
    return "tomorrow";
  }

  return `in ${plural(
    daysAway,
    "day",
  )}`;
}

function weekKey(
  date: Date,
  timeZone: string,
) {
  const key =
    localDateKey(
      date,
      timeZone,
    );

  const ordinal =
    dayOrdinal(key);

  return Math.floor(
    ordinal / 7,
  );
}

function averagePreparedness(
  topics: TopicRow[],
) {
  if (
    topics.length === 0
  ) {
    return null;
  }

  return Math.round(
    topics.reduce(
      (sum, topic) =>
        sum +
        Number(
          topic.mastery_score ??
            0,
        ),
      0,
    ) /
      topics.length,
  );
}

function normalizeTopicIds(
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

function eventKind(
  eventType: string,
) {
  const normalized =
    eventType.toLowerCase();

  if (
    /exam|midterm|final/.test(
      normalized,
    )
  ) {
    return "exam" as const;
  }

  if (
    /quiz/.test(
      normalized,
    )
  ) {
    return "quiz" as const;
  }

  return "assignment" as const;
}

function eventScore({
  kind,
  daysAway,
  preparedness,
}: {
  kind:
    | "exam"
    | "quiz"
    | "assignment";
  daysAway: number;
  preparedness: number | null;
}) {
  const base =
    kind === "exam"
      ? 100
      : kind === "quiz"
        ? 84
        : 76;

  const duePenalty =
    daysAway < 0
      ? 8
      : Math.max(
          0,
          daysAway,
        ) *
        (kind === "exam"
          ? 4
          : 5);

  const preparednessBoost =
    preparedness === null
      ? 0
      : kind === "exam"
        ? Math.max(
            0,
            (65 -
              preparedness) /
              2,
          )
        : kind === "quiz"
          ? Math.max(
              0,
              (55 -
                preparedness) /
                3,
            )
          : 0;

  return Math.max(
    45,
    Math.min(
      110,
      base -
        duePenalty +
        preparednessBoost,
    ),
  );
}

export async function buildAttentionSnapshot({
  supabase,
  userId,
  timeZone,
  now = new Date(),
}: {
  supabase: SupabaseClient;
  userId: string;
  timeZone: string;
  now?: Date;
}): Promise<AttentionSnapshot> {
  const today =
    localDateKey(
      now,
      timeZone,
    );

  const fourteenDays =
    dateKeyPlusDays(
      today,
      14,
    );

  const threeDaysAgo =
    new Date(
      now.getTime() -
        3 *
          86400000,
    ).toISOString();

  const recentCutoff =
    new Date(
      now.getTime() -
        30 *
          60 *
          60 *
          1000,
    ).toISOString();

  const [
    {
      data: courseData,
      error: courseError,
    },
    {
      data: topicData,
      error: topicError,
    },
    {
      data: courseEventData,
      error:
        courseEventError,
    },
    {
      data: calendarData,
      error: calendarError,
    },
    {
      data: lectureData,
      error: lectureError,
    },
    {
      data: dismissalData,
      error: dismissalError,
    },
  ] =
    await Promise.all([
      supabase
        .from("courses")
        .select(
          "id, code, name, color",
        )
        .eq(
          "user_id",
          userId,
        )
        .is(
          "archived_at",
          null,
        ),

      supabase
        .from(
          "course_topics",
        )
        .select(
          "id, course_id, parent_topic_id, name, mastery_score, mastery_state, source, created_at",
        )
        .eq(
          "user_id",
          userId,
        ),

      supabase
        .from(
          "course_events",
        )
        .select(
          "id, course_id, name, event_type, start_date, notes",
        )
        .eq(
          "user_id",
          userId,
        )
        .gte(
          "start_date",
          dateKeyPlusDays(
            today,
            -2,
          ),
        )
        .lte(
          "start_date",
          fourteenDays,
        ),

      supabase
        .from(
          "calendar_items",
        )
        .select(
          "id, course_id, title, item_type, starts_at, ends_at, status, source, topic_ids",
        )
        .eq(
          "user_id",
          userId,
        )
        .gte(
          "ends_at",
          threeDaysAgo,
        )
        .lte(
          "starts_at",
          new Date(
            now.getTime() +
              14 *
                86400000,
          ).toISOString(),
        ),

      supabase
        .from(
          "lectures",
        )
        .select(
          "id, course_id, title, status, processed_at, updated_at",
        )
        .eq(
          "user_id",
          userId,
        )
        .eq(
          "status",
          "ready",
        )
        .gte(
          "processed_at",
          recentCutoff,
        )
        .order(
          "processed_at",
          {
            ascending: false,
          },
        )
        .limit(8),

      supabase
        .from(
          "attention_dismissals",
        )
        .select(
          "attention_key, dismissed_at, snoozed_until",
        )
        .eq(
          "user_id",
          userId,
        ),
    ]);

  if (courseError) {
    throw courseError;
  }
  if (topicError) {
    throw topicError;
  }
  if (courseEventError) {
    throw courseEventError;
  }
  if (calendarError) {
    throw calendarError;
  }
  if (lectureError) {
    throw lectureError;
  }
  if (dismissalError) {
    throw dismissalError;
  }

  const courses =
    (courseData ??
      []) as CourseRow[];

  const topics =
    (topicData ??
      []).map(
      (topic) => ({
        id: topic.id,
        course_id:
          topic.course_id,
        parent_topic_id:
          topic.parent_topic_id ??
          null,
        name: topic.name,
        mastery_score:
          Number(
            topic.mastery_score ??
              0,
          ),
        mastery_state:
          topic.mastery_state,
        source:
          topic.source,
        created_at:
          topic.created_at,
      }),
    ) as TopicRow[];

  const courseMap =
    new Map(
      courses.map(
        (course) => [
          course.id,
          course,
        ],
      ),
    );

  const childIds =
    new Set(
      topics
        .map(
          (topic) =>
            topic.parent_topic_id,
        )
        .filter(
          (
            value,
          ): value is string =>
            Boolean(value),
        ),
    );

  const leafTopics =
    topics.filter(
      (topic) =>
        !childIds.has(
          topic.id,
        ),
    );

  const topicsByCourse =
    new Map<
      string,
      TopicRow[]
    >();

  for (
    const topic of
    leafTopics
  ) {
    const existing =
      topicsByCourse.get(
        topic.course_id,
      ) ?? [];

    existing.push(topic);

    topicsByCourse.set(
      topic.course_id,
      existing,
    );
  }

  const preparednessByCourse =
    new Map<
      string,
      number | null
    >();

  for (
    const course of
    courses
  ) {
    preparednessByCourse.set(
      course.id,
      averagePreparedness(
        topicsByCourse.get(
          course.id,
        ) ?? [],
      ),
    );
  }

  const dismissals =
    new Map<
      string,
      {
        attention_key: string;
        dismissed_at: string;
        snoozed_until: string | null;
      }
    >(
      (
        (dismissalData ??
          []) as Array<{
          attention_key: string;
          dismissed_at: string;
          snoozed_until: string | null;
        }>
      ).map(
        (dismissal) => [
          dismissal.attention_key,
          dismissal,
        ],
      ),
    );

  const visible =
    (item: AttentionItem) => {
      const dismissal =
        dismissals.get(
          item.key,
        );

      if (!dismissal) {
        return true;
      }

      if (
        dismissal.snoozed_until
      ) {
        return (
          new Date(
            dismissal.snoozed_until,
          ).getTime() <=
          now.getTime()
        );
      }

      return false;
    };

  const items:
    AttentionItem[] = [];

  const upcomingExamByCourse =
    new Map<
      string,
      number
    >();

  for (
    const rawEvent of
    courseEventData ??
    []
  ) {
    if (
      !rawEvent.start_date
    ) {
      continue;
    }

    const event =
      rawEvent as CourseEventRow;

    const kind =
      eventKind(
        `${event.event_type} ${event.name}`,
      );

    const daysAway =
      daysBetween(
        today,
        event.start_date,
      );

    const preparedness =
      preparednessByCourse.get(
        event.course_id,
      ) ?? null;

    const course =
      courseMap.get(
        event.course_id,
      );

    if (!course) {
      continue;
    }

    if (
      kind === "exam" &&
      daysAway >= 0
    ) {
      upcomingExamByCourse.set(
        course.id,
        Math.min(
          upcomingExamByCourse.get(
            course.id,
          ) ??
            Number.POSITIVE_INFINITY,
          daysAway,
        ),
      );
    }

    const score =
      eventScore({
        kind,
        daysAway,
        preparedness,
      });

    const detailParts =
      [
        `${event.name} is ${dateDistanceText(
          daysAway,
        )}.`,
      ];

    if (
      preparedness !==
        null &&
      (
        kind === "exam" ||
        kind === "quiz"
      )
    ) {
      detailParts.push(
        `Current course preparedness is ${preparedness}%.`,
      );
    }

    const key =
      `course-event:${event.id}`;

    const item:
      AttentionItem = {
        key,
        kind,
        title:
          kind === "exam"
            ? `${course.code}: ${event.name}`
            : kind === "quiz"
              ? `${course.code}: ${event.name}`
              : `${course.code}: ${event.name}`,
        detail:
          detailParts.join(
            " ",
          ),
        score,
        urgency:
          urgencyFromScore(
            score,
          ),
        courseId:
          course.id,
        courseCode:
          course.code,
        color:
          course.color,
        dueAt:
          event.start_date,
        preparedness,
        action: {
          label:
            kind === "exam" ||
            kind === "quiz"
              ? "Study now"
              : "Open course",
          href:
            kind === "exam" ||
            kind === "quiz"
              ? `/study?course=${course.id}`
              : `/courses/${course.id}`,
        },
        secondaryAction:
          kind === "exam" ||
          kind === "quiz"
            ? {
                label:
                  "View calendar",
                href:
                  "/calendar",
              }
            : null,
        metadata: {
          eventId:
            event.id,
          daysAway,
          eventType:
            event.event_type,
        },
      };

    if (visible(item)) {
      items.push(item);
    }
  }

  for (
    const rawItem of
    calendarData ?? []
  ) {
    const item =
      rawItem as CalendarItemRow;

    const course =
      item.course_id
        ? courseMap.get(
            item.course_id,
          ) ?? null
        : null;

    if (
      item.item_type ===
        "study" &&
      item.status ===
        "scheduled" &&
      new Date(
        item.ends_at,
      ).getTime() <
        now.getTime()
    ) {
      const key =
        `missed-study:${item.id}`;

      const score = 84;

      const attention:
        AttentionItem = {
        key,
        kind:
          "missed_study",
        title:
          course
            ? `Missed ${course.code} study block`
            : "Missed study block",
        detail:
          "This planned block ended without being marked complete. Reschedule it if the work still matters.",
        score,
        urgency:
          urgencyFromScore(
            score,
          ),
        courseId:
          course?.id ??
          null,
        courseCode:
          course?.code ??
          null,
        color:
          course?.color ??
          null,
        dueAt:
          item.ends_at,
        preparedness:
          course
            ? preparednessByCourse.get(
                course.id,
              ) ?? null
            : null,
        action: {
          label:
            "Open calendar",
          href:
            "/calendar",
        },
        secondaryAction:
          course
            ? {
                label:
                  "Study now",
                href:
                  `/study?course=${course.id}&topics=${normalizeTopicIds(
                    item.topic_ids,
                  ).join(",")}`,
              }
            : null,
        metadata: {
          calendarItemId:
            item.id,
          topicIds:
            normalizeTopicIds(
              item.topic_ids,
            ),
        },
      };

      if (
        visible(
          attention,
        )
      ) {
        items.push(
          attention,
        );
      }
    }

    if (
      [
        "assignment",
        "exam",
        "quiz",
      ].includes(
        item.item_type,
      ) &&
      item.status ===
        "scheduled"
    ) {
      const startKey =
        localDateKey(
          new Date(
            item.starts_at,
          ),
          timeZone,
        );

      const daysAway =
        daysBetween(
          today,
          startKey,
        );

      if (
        daysAway < -2 ||
        daysAway > 14
      ) {
        continue;
      }

      const kind =
        eventKind(
          item.item_type,
        );

      const preparedness =
        course
          ? preparednessByCourse.get(
              course.id,
            ) ?? null
          : null;

      const score =
        eventScore({
          kind,
          daysAway,
          preparedness,
        }) - 2;

      const attention:
        AttentionItem = {
        key:
          `calendar-deadline:${item.id}`,
        kind,
        title:
          course
            ? `${course.code}: ${item.title}`
            : item.title,
        detail:
          `${item.title} is ${dateDistanceText(
            daysAway,
          )}.${preparedness !== null && kind !== "assignment" ? ` Current preparedness is ${preparedness}%.` : ""}`,
        score,
        urgency:
          urgencyFromScore(
            score,
          ),
        courseId:
          course?.id ??
          null,
        courseCode:
          course?.code ??
          null,
        color:
          course?.color ??
          null,
        dueAt:
          item.starts_at,
        preparedness,
        action: {
          label:
            kind === "assignment"
              ? "Open calendar"
              : "Study now",
          href:
            kind === "assignment"
              ? "/calendar"
              : course
                ? `/study?course=${course.id}`
                : "/study",
        },
        metadata: {
          calendarItemId:
            item.id,
          daysAway,
        },
      };

      if (
        visible(
          attention,
        )
      ) {
        items.push(
          attention,
        );
      }
    }
  }

  const weakTopicWeek =
    weekKey(
      now,
      timeZone,
    );

  const weakCandidates =
    leafTopics
      .filter(
        (topic) =>
          Number(
            topic.mastery_score,
          ) < 58,
      )
      .map((topic) => {
        const course =
          courseMap.get(
            topic.course_id,
          );

        if (!course) {
          return null;
        }

        const mastery =
          Number(
            topic.mastery_score ??
              0,
          );

        const examDays =
          upcomingExamByCourse.get(
            course.id,
          );

        const examBoost =
          examDays !==
            undefined &&
          examDays <= 7
            ? 20 -
              examDays * 2
            : 0;

        const unseenBoost =
          topic.mastery_state ===
            "unseen"
            ? 5
            : 0;

        const score =
          55 +
          Math.max(
            0,
            (58 - mastery) /
              2,
          ) +
          examBoost +
          unseenBoost;

        return {
          topic,
          course,
          mastery,
          score,
          examDays,
        };
      })
      .filter(
        (
          value,
        ): value is NonNullable<
          typeof value
        > =>
          Boolean(value),
      )
      .sort(
        (a, b) =>
          b.score -
          a.score,
      )
      .slice(0, 3);

  for (
    const candidate of
    weakCandidates
  ) {
    const attention:
      AttentionItem = {
      key:
        `weak-topic:${candidate.topic.id}:${weakTopicWeek}`,
      kind:
        "weak_topic",
      title:
        candidate.mastery <=
        0
          ? `${candidate.topic.name} has not been practiced yet`
          : `${candidate.topic.name} needs attention`,
      detail:
        candidate.examDays !==
          undefined
          ? `${candidate.course.code} has an exam ${dateDistanceText(
              candidate.examDays,
            )}, and this topic is at ${Math.round(
              candidate.mastery,
            )}% mastery.`
          : `${candidate.course.code} topic mastery is ${Math.round(
              candidate.mastery,
            )}%. A short focused session would improve your coverage.`,
      score:
        candidate.score,
      urgency:
        urgencyFromScore(
          candidate.score,
        ),
      courseId:
        candidate.course.id,
      courseCode:
        candidate.course.code,
      color:
        candidate.course.color,
      dueAt: null,
      preparedness:
        candidate.mastery,
      action: {
        label:
          "Study topic",
        href:
          `/study?course=${candidate.course.id}&topics=${candidate.topic.id}`,
      },
      secondaryAction: {
        label:
          "Open course",
        href:
          `/courses/${candidate.course.id}`,
      },
      metadata: {
        topicId:
          candidate.topic.id,
        mastery:
          candidate.mastery,
      },
    };

    if (
      visible(
        attention,
      )
    ) {
      items.push(
        attention,
      );
    }
  }

  const recentNewTopics =
    topics.filter(
      (topic) =>
        new Date(
          topic.created_at,
        ).getTime() >=
          new Date(
            recentCutoff,
          ).getTime() &&
        [
          "lecture",
          "ai",
          "notes",
        ].includes(
          topic.source,
        ),
    );

  const recentByCourse =
    new Map<
      string,
      TopicRow[]
    >();

  for (
    const topic of
    recentNewTopics
  ) {
    const existing =
      recentByCourse.get(
        topic.course_id,
      ) ?? [];

    existing.push(topic);

    recentByCourse.set(
      topic.course_id,
      existing,
    );
  }

  for (
    const [
      courseId,
      courseTopics,
    ] of recentByCourse
  ) {
    const course =
      courseMap.get(
        courseId,
      );

    if (!course) {
      continue;
    }

    const newest =
      [...courseTopics].sort(
        (a, b) =>
          new Date(
            b.created_at,
          ).getTime() -
          new Date(
            a.created_at,
          ).getTime(),
      )[0];

    const attention:
      AttentionItem = {
      key:
        `new-topics:${courseId}:${newest?.id ?? courseTopics.length}`,
      kind:
        "new_topics",
      title:
        `${courseTopics.length} new topic${courseTopics.length === 1 ? "" : "s"} added to ${course.code}`,
      detail:
        `Recent lecture or note analysis expanded your course map with ${courseTopics
          .slice(0, 3)
          .map(
            (topic) =>
              topic.name,
          )
          .join(", ")}${courseTopics.length > 3 ? ", and more." : "."}`,
      score: 50,
      urgency: "low",
      courseId:
        course.id,
      courseCode:
        course.code,
      color:
        course.color,
      dueAt: null,
      preparedness:
        preparednessByCourse.get(
          course.id,
        ) ?? null,
      action: {
        label:
          "Open course",
        href:
          `/courses/${course.id}`,
      },
      metadata: {
        topicIds:
          courseTopics.map(
            (topic) =>
              topic.id,
          ),
      },
    };

    if (
      visible(
        attention,
      )
    ) {
      items.push(
        attention,
      );
    }
  }

  for (
    const lecture of
    lectureData ?? []
  ) {
    const course =
      courseMap.get(
        lecture.course_id,
      );

    if (!course) {
      continue;
    }

    const attention:
      AttentionItem = {
      key:
        `lecture-ready:${lecture.id}`,
      kind:
        "lecture_ready",
      title:
        `${lecture.title} is ready`,
      detail:
        `The transcript, chapter map, and AI lecture summary are ready in ${course.code}.`,
      score: 48,
      urgency: "low",
      courseId:
        course.id,
      courseCode:
        course.code,
      color:
        course.color,
      dueAt: null,
      preparedness:
        preparednessByCourse.get(
          course.id,
        ) ?? null,
      action: {
        label:
          "Open lecture",
        href:
          `/lectures/${lecture.id}`,
      },
      metadata: {
        lectureId:
          lecture.id,
      },
    };

    if (
      visible(
        attention,
      )
    ) {
      items.push(
        attention,
      );
    }
  }

  const deduped =
    new Map<
      string,
      AttentionItem
    >();

  for (
    const item of items
  ) {
    const fingerprint =
      [
        item.kind,
        item.courseId ??
          "none",
        item.title
          .toLowerCase()
          .replace(
            /\s+/g,
            " ",
          ),
      ].join(":");

    const existing =
      deduped.get(
        fingerprint,
      );

    if (
      !existing ||
      item.score >
        existing.score
    ) {
      deduped.set(
        fingerprint,
        item,
      );
    }
  }

  const ranked =
    Array.from(
      deduped.values(),
    )
      .sort(
        (a, b) =>
          b.score -
          a.score,
      )
      .slice(0, 12);

  return {
    generatedAt:
      now.toISOString(),
    primary:
      ranked[0] ??
      null,
    items: ranked,
    criticalCount:
      ranked.filter(
        (item) =>
          item.urgency ===
          "critical",
      ).length,
    highCount:
      ranked.filter(
        (item) =>
          item.urgency ===
          "high",
      ).length,
  };
}