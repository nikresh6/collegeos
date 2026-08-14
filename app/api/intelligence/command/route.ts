import {
  NextResponse,
} from "next/server";
import {
  userContext,
} from "../../../../lib/server-auth";
import {
  rebuildPlannerLearningProfile,
} from "../../../../lib/planner-learning-server";
import {
  applyLearnedPlannerPreferences,
} from "../../../../lib/academic-intelligence";
import {
  buildAttentionSnapshot,
} from "../../../../lib/attention-engine";

export const runtime =
  "nodejs";
export const dynamic =
  "force-dynamic";

type Preferences = {
  timezone: string;
  wake_time: string;
  bedtime_time: string;
  preferred_study_period:
    | "morning"
    | "afternoon"
    | "evening"
    | "mixed";
  min_study_minutes: number;
  default_study_minutes: number;
  max_study_minutes: number;
};

type EntityMatch = {
  courseId: string;
  courseCode: string;
  courseName: string;
  color: string;
  topicId: string | null;
  topicName: string | null;
};

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
    .trim();
}

function clockMinutes(
  value: string | null,
  fallback: number,
) {
  if (!value) {
    return fallback;
  }

  const [
    hour,
    minute,
  ] =
    value
      .split(":")
      .map(Number);

  if (
    !Number.isFinite(hour) ||
    !Number.isFinite(minute)
  ) {
    return fallback;
  }

  return (
    hour * 60 +
    minute
  );
}

function localParts(
  date: Date,
  timeZone: string,
) {
  const parts =
    new Intl.DateTimeFormat(
      "en-US",
      {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      },
    ).formatToParts(date);

  const values =
    Object.fromEntries(
      parts.map((part) => [
        part.type,
        part.value,
      ]),
    );

  return {
    year:
      Number(
        values.year,
      ),
    month:
      Number(
        values.month,
      ),
    day:
      Number(
        values.day,
      ),
    hour:
      Number(
        values.hour,
      ) % 24,
    minute:
      Number(
        values.minute,
      ),
  };
}

function dateKeyFromParts(
  parts: {
    year: number;
    month: number;
    day: number;
  },
) {
  return [
    parts.year,
    String(
      parts.month,
    ).padStart(2, "0"),
    String(
      parts.day,
    ).padStart(2, "0"),
  ].join("-");
}

function addDays(
  dateKey: string,
  days: number,
) {
  const [
    year,
    month,
    day,
  ] =
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
      date.getUTCMonth() +
        1,
    ).padStart(2, "0"),
    String(
      date.getUTCDate(),
    ).padStart(2, "0"),
  ].join("-");
}

function timeZoneOffsetMs(
  date: Date,
  timeZone: string,
) {
  const parts =
    new Intl.DateTimeFormat(
      "en-US",
      {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      },
    ).formatToParts(date);

  const values =
    Object.fromEntries(
      parts.map((part) => [
        part.type,
        part.value,
      ]),
    );

  const asUtc =
    Date.UTC(
      Number(
        values.year,
      ),
      Number(
        values.month,
      ) - 1,
      Number(
        values.day,
      ),
      Number(
        values.hour,
      ) % 24,
      Number(
        values.minute,
      ),
      Number(
        values.second,
      ),
    );

  return (
    asUtc -
    date.getTime()
  );
}

function zonedDateTimeToUtc({
  dateKey,
  minutes,
  timeZone,
}: {
  dateKey: string;
  minutes: number;
  timeZone: string;
}) {
  const [
    year,
    month,
    day,
  ] =
    dateKey
      .split("-")
      .map(Number);

  const hour =
    Math.floor(
      minutes / 60,
    );

  const minute =
    minutes % 60;

  const guess =
    new Date(
      Date.UTC(
        year,
        month - 1,
        day,
        hour,
        minute,
        0,
        0,
      ),
    );

  const firstOffset =
    timeZoneOffsetMs(
      guess,
      timeZone,
    );

  let result =
    new Date(
      guess.getTime() -
        firstOffset,
    );

  const secondOffset =
    timeZoneOffsetMs(
      result,
      timeZone,
    );

  if (
    secondOffset !==
    firstOffset
  ) {
    result =
      new Date(
        guess.getTime() -
          secondOffset,
      );
  }

  return result;
}

function dayOfWeek(
  dateKey: string,
) {
  const [
    year,
    month,
    day,
  ] =
    dateKey
      .split("-")
      .map(Number);

  return new Date(
    Date.UTC(
      year,
      month - 1,
      day,
      12,
    ),
  ).getUTCDay();
}

function dateOrdinal(
  dateKey: string,
) {
  const [
    year,
    month,
    day,
  ] =
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

function ruleOccurs({
  rule,
  dateKey,
}: {
  rule: {
    days_of_week: number[];
    start_date: string;
    end_date: string;
    week_pattern:
      | "every"
      | "odd"
      | "even";
  };
  dateKey: string;
}) {
  if (
    dateKey <
      rule.start_date ||
    dateKey >
      rule.end_date ||
    !rule.days_of_week.includes(
      dayOfWeek(
        dateKey,
      ),
    )
  ) {
    return false;
  }

  if (
    rule.week_pattern ===
    "every"
  ) {
    return true;
  }

  const weeks =
    Math.floor(
      Math.max(
        0,
        dateOrdinal(
          dateKey,
        ) -
          dateOrdinal(
            rule.start_date,
          ),
      ) / 7,
    );

  const odd =
    weeks % 2 ===
    0;

  return rule.week_pattern ===
    "odd"
    ? odd
    : !odd;
}

function parseTime(
  query: string,
) {
  const match =
    query.match(
      /\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i,
    );

  if (!match) {
    return null;
  }

  let hour =
    Number(
      match[1],
    );

  const minute =
    Number(
      match[2] ??
        0,
    );

  const meridiem =
    match[3]
      ?.toLowerCase();

  if (
    meridiem === "pm" &&
    hour < 12
  ) {
    hour += 12;
  }

  if (
    meridiem === "am" &&
    hour === 12
  ) {
    hour = 0;
  }

  if (
    !meridiem &&
    hour >= 1 &&
    hour <= 7
  ) {
    hour += 12;
  }

  if (
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  return (
    hour * 60 +
    minute
  );
}

function parseDuration(
  query: string,
) {
  const match =
    query.match(
      /\b(\d{1,3})\s*(?:m|min|mins|minute|minutes)\b/i,
    );

  if (!match) {
    return null;
  }

  const value =
    Number(
      match[1],
    );

  return Number.isFinite(
    value,
  )
    ? value
    : null;
}

function targetPeriod(
  query: string,
) {
  const normalized =
    normalize(query);

  if (
    normalized.includes(
      "morning",
    )
  ) {
    return "morning" as const;
  }

  if (
    normalized.includes(
      "afternoon",
    )
  ) {
    return "afternoon" as const;
  }

  if (
    normalized.includes(
      "evening",
    ) ||
    normalized.includes(
      "tonight",
    )
  ) {
    return "evening" as const;
  }

  return null;
}

function bestEntityMatch({
  query,
  courses,
  topics,
}: {
  query: string;
  courses: Array<{
    id: string;
    code: string;
    name: string;
    color: string;
  }>;
  topics: Array<{
    id: string;
    course_id: string;
    name: string;
  }>;
}): EntityMatch | null {
  const normalized =
    normalize(query);

  const courseById =
    new Map(
      courses.map(
        (course) => [
          course.id,
          course,
        ],
      ),
    );

  const topicRanked =
    topics
      .map((topic) => {
        const name =
          normalize(
            topic.name,
          );

        let score = 0;

        if (
          normalized.includes(
            name,
          )
        ) {
          score =
            100 +
            name.length;
        } else {
          score =
            name
              .split(" ")
              .filter(
                (token) =>
                  token.length >
                    2 &&
                  normalized.includes(
                    token,
                  ),
              ).length *
            14;
        }

        return {
          topic,
          score,
        };
      })
      .sort(
        (a, b) =>
          b.score -
          a.score,
      );

  const topTopic =
    topicRanked[0];

  if (
    topTopic &&
    topTopic.score >= 28
  ) {
    const course =
      courseById.get(
        topTopic.topic
          .course_id,
      );

    if (course) {
      return {
        courseId:
          course.id,
        courseCode:
          course.code,
        courseName:
          course.name,
        color:
          course.color,
        topicId:
          topTopic.topic.id,
        topicName:
          topTopic.topic.name,
      };
    }
  }

  const courseRanked =
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
          score =
            90 +
            code.length;
        }

        if (
          normalized.includes(
            name,
          )
        ) {
          score =
            Math.max(
              score,
              80 +
                name.length,
            );
        }

        for (
          const token of
          normalized.split(
            " ",
          )
        ) {
          if (
            token.length >
              2 &&
            (
              code.includes(
                token,
              ) ||
              name.includes(
                token,
              )
            )
          ) {
            score += 12;
          }
        }

        return {
          course,
          score,
        };
      })
      .sort(
        (a, b) =>
          b.score -
          a.score,
      );

  const topCourse =
    courseRanked[0];

  if (
    !topCourse ||
    topCourse.score < 24
  ) {
    return null;
  }

  return {
    courseId:
      topCourse.course.id,
    courseCode:
      topCourse.course.code,
    courseName:
      topCourse.course.name,
    color:
      topCourse.course.color,
    topicId: null,
    topicName: null,
  };
}

function overlaps(
  start: number,
  end: number,
  busy: Array<{
    start: number;
    end: number;
  }>,
) {
  return busy.some(
    (block) =>
      start <
        block.end &&
      end >
        block.start,
  );
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
        action?:
          | "create_note"
          | "schedule_study";
        query?: string;
      };

    if (
      body.action ===
      "create_note"
    ) {
      const {
        data: note,
        error,
      } =
        await context.supabase
          .from("notes")
          .insert({
            user_id:
              context.user.id,
            title:
              "Untitled note",
            raw_content:
              "",
          })
          .select("id")
          .single();

      if (error) {
        throw error;
      }

      return NextResponse.json({
        ok: true,
        message:
          "New note created.",
        href:
          `/notes?note=${note.id}`,
      });
    }

    if (
      body.action !==
      "schedule_study"
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Unknown command action.",
        },
        {
          status: 400,
        },
      );
    }

    const query =
      body.query?.trim() ??
      "";

    if (!query) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Describe the study block you want to schedule.",
        },
        {
          status: 400,
        },
      );
    }

    const [
      {
        data: preferencesData,
        error:
          preferencesError,
      },
      {
        data: courses,
        error: coursesError,
      },
      {
        data: topics,
        error: topicsError,
      },
    ] =
      await Promise.all([
        context.supabase
          .from(
            "calendar_preferences",
          )
          .select(
            "timezone, wake_time, bedtime_time, preferred_study_period, min_study_minutes, default_study_minutes, max_study_minutes",
          )
          .eq(
            "user_id",
            context.user.id,
          )
          .maybeSingle(),

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

    if (preferencesError) {
      throw preferencesError;
    }
    if (coursesError) {
      throw coursesError;
    }
    if (topicsError) {
      throw topicsError;
    }

    const fallback:
      Preferences = {
      timezone:
        preferencesData
          ?.timezone ??
        "America/Chicago",
      wake_time:
        preferencesData
          ?.wake_time ??
        "08:00:00",
      bedtime_time:
        preferencesData
          ?.bedtime_time ??
        "23:30:00",
      preferred_study_period:
        preferencesData
          ?.preferred_study_period ??
        "evening",
      min_study_minutes:
        Number(
          preferencesData
            ?.min_study_minutes ??
            25,
        ),
      default_study_minutes:
        Number(
          preferencesData
            ?.default_study_minutes ??
            45,
        ),
      max_study_minutes:
        Number(
          preferencesData
            ?.max_study_minutes ??
            75,
        ),
    };

    const learning =
      await rebuildPlannerLearningProfile(
        {
          supabase:
            context.supabase,
          userId:
            context.user.id,
          timeZone:
            fallback.timezone,
        },
      );

    const preferences =
      applyLearnedPlannerPreferences(
        {
          preferences:
            fallback,
          learning,
        },
      );

    let target =
      bestEntityMatch({
        query,
        courses:
          courses ?? [],
        topics:
          topics ?? [],
      });

    if (!target) {
      const attention =
        await buildAttentionSnapshot({
          supabase:
            context.supabase,
          userId:
            context.user.id,
          timeZone:
            preferences.timezone,
        });

      const priority =
        attention.items.find(
          (item) =>
            Boolean(
              item.courseId,
            ) &&
            [
              "exam",
              "quiz",
              "weak_topic",
              "missed_study",
            ].includes(
              item.kind,
            ),
        ) ??
        attention.primary;

      if (
        priority?.courseId
      ) {
        const course =
          (courses ?? []).find(
            (candidate) =>
              candidate.id ===
              priority.courseId,
          );

        const metadataTopicId =
          typeof priority.metadata
            ?.topicId ===
            "string"
            ? priority.metadata
                .topicId
            : null;

        const topic =
          metadataTopicId
            ? (
                topics ??
                []
              ).find(
                (candidate) =>
                  candidate.id ===
                  metadataTopicId,
              )
            : null;

        if (course) {
          target = {
            courseId:
              course.id,
            courseCode:
              course.code,
            courseName:
              course.name,
            color:
              course.color,
            topicId:
              topic?.id ??
              null,
            topicName:
              topic?.name ??
              null,
          };
        }
      }
    }

    if (!target) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "I do not have enough academic context to choose a useful study target yet. Add a course topic, deadline, or quiz result first.",
        },
        {
          status: 400,
        },
      );
    }

    const explicitDuration =
      parseDuration(
        query,
      );

    const duration =
      Math.max(
        preferences.min_study_minutes,
        Math.min(
          preferences.max_study_minutes,
          explicitDuration ??
            preferences.default_study_minutes,
        ),
      );

    const now =
      new Date();

    const currentLocal =
      localParts(
        now,
        preferences.timezone,
      );

    const today =
      dateKeyFromParts(
        currentLocal,
      );

    const normalized =
      normalize(query);

    let dateKey =
      normalized.includes(
        "tomorrow",
      )
        ? addDays(
            today,
            1,
          )
        : today;

    const explicitTime =
      parseTime(
        query,
      );

    const explicitPeriod =
      targetPeriod(
        query,
      );

    const learnedPeriod =
      explicitPeriod ??
      (
        preferences.preferred_study_period ===
        "mixed"
          ? "afternoon"
          : preferences.preferred_study_period
      );

    const periodTarget =
      learnedPeriod ===
      "morning"
        ? 9 * 60
        : learnedPeriod ===
            "afternoon"
          ? 15 * 60
          : 19 * 60;

    let targetMinutes =
      explicitTime ??
      periodTarget;

    if (
      dateKey ===
        today &&
      targetMinutes <=
        currentLocal.hour *
          60 +
          currentLocal.minute +
          15
    ) {
      targetMinutes =
        Math.ceil(
          (
            currentLocal.hour *
              60 +
            currentLocal.minute +
            30
          ) /
            15,
        ) * 15;
    }

    const wakeMinutes =
      clockMinutes(
        preferences.wake_time,
        8 * 60,
      );

    let bedMinutes =
      clockMinutes(
        preferences.bedtime_time,
        23 * 60 + 30,
      );

    if (
      bedMinutes <=
      wakeMinutes
    ) {
      bedMinutes =
        24 * 60;
    }

    if (
      targetMinutes +
        duration >
      bedMinutes
    ) {
      dateKey =
        addDays(
          dateKey,
          1,
        );
      targetMinutes =
        explicitTime ??
        periodTarget;
    }

    const dayStart =
      zonedDateTimeToUtc({
        dateKey,
        minutes: 0,
        timeZone:
          preferences.timezone,
      });

    const dayEnd =
      zonedDateTimeToUtc({
        dateKey:
          addDays(
            dateKey,
            1,
          ),
        minutes: 0,
        timeZone:
          preferences.timezone,
      });

    const [
      {
        data: calendarItems,
        error:
          calendarError,
      },
      {
        data: classRules,
        error:
          classError,
      },
    ] =
      await Promise.all([
        context.supabase
          .from(
            "calendar_items",
          )
          .select(
            "starts_at, ends_at",
          )
          .eq(
            "user_id",
            context.user.id,
          )
          .neq(
            "status",
            "cancelled",
          )
          .lt(
            "starts_at",
            dayEnd.toISOString(),
          )
          .gt(
            "ends_at",
            dayStart.toISOString(),
          ),

        context.supabase
          .from(
            "class_schedule_rules",
          )
          .select(
            "days_of_week, start_time, end_time, start_date, end_date, week_pattern",
          )
          .eq(
            "user_id",
            context.user.id,
          )
          .eq(
            "is_active",
            true,
          )
          .lte(
            "start_date",
            dateKey,
          )
          .gte(
            "end_date",
            dateKey,
          ),
      ]);

    if (calendarError) {
      throw calendarError;
    }

    if (classError) {
      throw classError;
    }

    const busy =
      (
        calendarItems ?? []
      ).map((item) => ({
        start:
          new Date(
            item.starts_at,
          ).getTime(),
        end:
          new Date(
            item.ends_at,
          ).getTime(),
      }));

    for (
      const rule of
      classRules ?? []
    ) {
      if (
        !ruleOccurs({
          rule: {
            days_of_week:
              (
                rule.days_of_week ??
                []
              ).map(Number),
            start_date:
              rule.start_date,
            end_date:
              rule.end_date,
            week_pattern:
              rule.week_pattern,
          },
          dateKey,
        })
      ) {
        continue;
      }

      const start =
        zonedDateTimeToUtc({
          dateKey,
          minutes:
            clockMinutes(
              rule.start_time,
              0,
            ),
          timeZone:
            preferences.timezone,
        });

      const end =
        zonedDateTimeToUtc({
          dateKey,
          minutes:
            clockMinutes(
              rule.end_time,
              0,
            ),
          timeZone:
            preferences.timezone,
        });

      busy.push({
        start:
          start.getTime(),
        end:
          end.getTime(),
      });
    }

    const latestStart =
      bedMinutes -
      duration;

    const earliestStart =
      Math.max(
        wakeMinutes,
        dateKey === today
          ? Math.ceil(
              (
                currentLocal.hour *
                  60 +
                currentLocal.minute +
                15
              ) /
                15,
            ) * 15
          : wakeMinutes,
      );

    const candidates:
      number[] = [];

    for (
      let minutes =
        Math.max(
          earliestStart,
          Math.ceil(
            targetMinutes /
              15,
          ) * 15,
        );
      minutes <=
      latestStart;
      minutes += 15
    ) {
      candidates.push(
        minutes,
      );
    }

    for (
      let minutes =
        earliestStart;
      minutes <
      Math.min(
        targetMinutes,
        latestStart,
      );
      minutes += 15
    ) {
      candidates.push(
        minutes,
      );
    }

    let chosenStart:
      Date | null =
      null;

    for (
      const minutes of
      candidates
    ) {
      const start =
        zonedDateTimeToUtc({
          dateKey,
          minutes,
          timeZone:
            preferences.timezone,
        });

      const end =
        new Date(
          start.getTime() +
            duration *
              60000,
        );

      if (
        !overlaps(
          start.getTime(),
          end.getTime(),
          busy,
        )
      ) {
        chosenStart =
          start;
        break;
      }
    }

    if (!chosenStart) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "I could not find a conflict-free window that day. Try another day or shorten the session.",
        },
        {
          status: 409,
        },
      );
    }

    const chosenEnd =
      new Date(
        chosenStart.getTime() +
          duration *
            60000,
      );

    const topicIds =
      target.topicId
        ? [
            target.topicId,
          ]
        : [];

    const title =
      target.topicName
        ? `Study ${target.courseCode}: ${target.topicName}`
        : `Study ${target.courseCode}`;

    const {
      data: item,
      error:
        insertError,
    } =
      await context.supabase
        .from(
          "calendar_items",
        )
        .insert({
          user_id:
            context.user.id,
          course_id:
            target.courseId,
          title,
          item_type:
            "study",
          starts_at:
            chosenStart.toISOString(),
          ends_at:
            chosenEnd.toISOString(),
          all_day:
            false,
          notes:
            "Scheduled from Command Center.",
          flexibility:
            "flexible",
          status:
            "scheduled",
          source:
            "manual",
          topic_ids:
            topicIds,
          color_override:
            target.color,
          planner_locked:
            true,
        })
        .select(
          "id, starts_at, ends_at",
        )
        .single();

    if (insertError) {
      throw insertError;
    }

    const {
      error:
        behaviorError,
    } =
      await context.supabase
        .from(
          "study_behavior_events",
        )
        .insert({
          user_id:
            context.user.id,
          course_id:
            target.courseId,
          calendar_item_id:
            item.id,
          event_type:
            "planned",
          topic_ids:
            topicIds,
          resulting_starts_at:
            item.starts_at,
          resulting_ends_at:
            item.ends_at,
          metadata: {
            origin:
              "command_center",
            explicitDuration:
              explicitDuration !==
              null,
            explicitTime:
              explicitTime !==
              null,
          },
        });

    if (behaviorError) {
      console.warn(
        "Study behavior logging failed:",
        behaviorError,
      );
    }

    return NextResponse.json({
      ok: true,
      message:
        `${title} scheduled for ${duration} minutes.`,
      href:
        "/calendar",
      item,
    });
  } catch (error) {
    console.error(
      "Command Center action failed:",
      error,
    );

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof
          Error
            ? error.message
            : "Could not complete that action.",
      },
      {
        status: 500,
      },
    );
  }
}