import {
  NextResponse,
} from "next/server";
import {
  userContext,
} from "../../../../lib/server-auth";
import {
  buildAttentionSnapshot,
} from "../../../../lib/attention-engine";
import {
  rebuildPlannerLearningProfile,
} from "../../../../lib/planner-learning-server";
import {
  plannerLearningSummary,
} from "../../../../lib/academic-intelligence";

export const runtime =
  "nodejs";
export const dynamic =
  "force-dynamic";

type CourseRow = {
  id: string;
  code: string;
  name: string;
  color: string;
  professor: string | null;
  credits: number;
};

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

function dateKey(
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
  key: string,
  days: number,
) {
  const [
    year,
    month,
    day,
  ] =
    key
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

function offsetMs(
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

  const wallAsUtc =
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
    wallAsUtc -
    date.getTime()
  );
}

function zonedToUtc({
  key,
  minutes,
  timeZone,
}: {
  key: string;
  minutes: number;
  timeZone: string;
}) {
  const [
    year,
    month,
    day,
  ] =
    key
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
      ),
    );

  const first =
    offsetMs(
      guess,
      timeZone,
    );

  let result =
    new Date(
      guess.getTime() -
        first,
    );

  const second =
    offsetMs(
      result,
      timeZone,
    );

  if (second !== first) {
    result =
      new Date(
        guess.getTime() -
          second,
      );
  }

  return result;
}

function clockMinutes(
  value: string,
) {
  const [
    hour,
    minute,
  ] =
    value
      .split(":")
      .map(Number);

  return (
    hour * 60 +
    minute
  );
}

function weekday(
  key: string,
) {
  const [
    year,
    month,
    day,
  ] =
    key
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

function ordinal(
  key: string,
) {
  const [
    year,
    month,
    day,
  ] =
    key
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

function ruleOccurs(
  rule: {
    days_of_week: number[];
    start_date: string;
    end_date: string;
    week_pattern:
      | "every"
      | "odd"
      | "even";
  },
  key: string,
) {
  if (
    key <
      rule.start_date ||
    key >
      rule.end_date ||
    !rule.days_of_week.includes(
      weekday(key),
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
        ordinal(key) -
          ordinal(
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

    const requestedTimeZone =
      url.searchParams.get(
        "tz",
      );

    const now =
      new Date();

    const [
      {
        data: profile,
        error: profileError,
      },
      {
        data: calendarPreferences,
        error:
          preferenceError,
      },
      {
        data: courses,
        error: coursesError,
      },
    ] =
      await Promise.all([
        context.supabase
          .from("profiles")
          .select(
            "first_name, last_name, preferred_name, onboarding_completed, current_semester_id, target_gpa",
          )
          .eq(
            "id",
            context.user.id,
          )
          .maybeSingle(),

        context.supabase
          .from(
            "calendar_preferences",
          )
          .select(
            "timezone",
          )
          .eq(
            "user_id",
            context.user.id,
          )
          .maybeSingle(),

        context.supabase
          .from("courses")
          .select(
            "id, code, name, color, professor, credits",
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
      ]);

    if (profileError) {
      throw profileError;
    }
    if (preferenceError) {
      throw preferenceError;
    }
    if (coursesError) {
      throw coursesError;
    }

    const timeZone =
      requestedTimeZone ||
      calendarPreferences
        ?.timezone ||
      "America/Chicago";

    const local =
      localParts(
        now,
        timeZone,
      );

    const today =
      dateKey(local);

    const tomorrow =
      addDays(
        today,
        1,
      );

    const dayStart =
      zonedToUtc({
        key: today,
        minutes: 0,
        timeZone,
      });

    const dayEnd =
      zonedToUtc({
        key:
          tomorrow,
        minutes: 0,
        timeZone,
      });

    const activeCourses =
      (courses ?? []) as CourseRow[];

    const courseMap =
      new Map<string, CourseRow>(
        activeCourses.map(
          (course) => [
            course.id,
            course,
          ],
        ),
      );

    const [
      attention,
      learning,
      {
        data: calendarItems,
        error: calendarError,
      },
      {
        data: classRules,
        error: rulesError,
      },
      {
        data: topicData,
        error: topicsError,
      },
      {
        data: notes,
        error: notesError,
      },
      {
        data: lectures,
        error: lecturesError,
      },
      {
        data: guides,
        error: guidesError,
      },
    ] =
      await Promise.all([
        buildAttentionSnapshot(
          {
            supabase:
              context.supabase,
            userId:
              context.user.id,
            timeZone,
            now,
          },
        ),

        rebuildPlannerLearningProfile(
          {
            supabase:
              context.supabase,
            userId:
              context.user.id,
            timeZone,
          },
        ),

        context.supabase
          .from(
            "calendar_items",
          )
          .select(
            "id, course_id, title, item_type, starts_at, ends_at, location, status, source",
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
          )
          .order(
            "starts_at",
            {
              ascending: true,
            },
          ),

        context.supabase
          .from(
            "class_schedule_rules",
          )
          .select(
            "id, course_id, title, meeting_type, location, days_of_week, start_time, end_time, start_date, end_date, week_pattern",
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
            today,
          )
          .gte(
            "end_date",
            today,
          ),

        context.supabase
          .from(
            "course_topics",
          )
          .select(
            "id, course_id, parent_topic_id, name, mastery_score, mastery_state",
          )
          .eq(
            "user_id",
            context.user.id,
          ),

        context.supabase
          .from("notes")
          .select(
            "id, course_id, title, updated_at",
          )
          .eq(
            "user_id",
            context.user.id,
          )
          .order(
            "updated_at",
            {
              ascending: false,
            },
          )
          .limit(4),

        context.supabase
          .from(
            "lectures",
          )
          .select(
            "id, course_id, title, status, updated_at, processed_at",
          )
          .eq(
            "user_id",
            context.user.id,
          )
          .order(
            "updated_at",
            {
              ascending: false,
            },
          )
          .limit(4),

        context.supabase
          .from(
            "study_guides",
          )
          .select(
            "id, course_id, title, updated_at",
          )
          .eq(
            "user_id",
            context.user.id,
          )
          .order(
            "updated_at",
            {
              ascending: false,
            },
          )
          .limit(3),
      ]);

    if (calendarError) {
      throw calendarError;
    }
    if (rulesError) {
      throw rulesError;
    }
    if (topicsError) {
      throw topicsError;
    }
    if (notesError) {
      throw notesError;
    }
    if (lecturesError) {
      throw lecturesError;
    }
    if (guidesError) {
      throw guidesError;
    }

    const schedule:
      Array<{
        id: string;
        kind:
          | "class"
          | "event";
        courseId:
          | string
          | null;
        courseCode:
          | string
          | null;
        color:
          | string
          | null;
        title: string;
        itemType: string;
        startsAt: string;
        endsAt: string;
        location:
          | string
          | null;
        source: string;
      }> = [];

    for (
      const item of
      calendarItems ?? []
    ) {
      const course =
        item.course_id
          ? courseMap.get(
              item.course_id,
            )
          : null;

      schedule.push({
        id:
          item.id,
        kind:
          "event",
        courseId:
          item.course_id ??
          null,
        courseCode:
          course?.code ??
          null,
        color:
          course?.color ??
          null,
        title:
          item.title,
        itemType:
          item.item_type,
        startsAt:
          item.starts_at,
        endsAt:
          item.ends_at,
        location:
          item.location ??
          null,
        source:
          item.source,
      });
    }

    for (
      const rule of
      classRules ?? []
    ) {
      const occurs =
        ruleOccurs(
          {
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
          today,
        );

      if (!occurs) {
        continue;
      }

      const course =
        courseMap.get(
          rule.course_id,
        );

      const start =
        zonedToUtc({
          key: today,
          minutes:
            clockMinutes(
              rule.start_time,
            ),
          timeZone,
        });

      const end =
        zonedToUtc({
          key: today,
          minutes:
            clockMinutes(
              rule.end_time,
            ),
          timeZone,
        });

      schedule.push({
        id:
          `class:${rule.id}:${today}`,
        kind:
          "class",
        courseId:
          rule.course_id,
        courseCode:
          course?.code ??
          null,
        color:
          course?.color ??
          null,
        title:
          rule.title,
        itemType:
          rule.meeting_type,
        startsAt:
          start.toISOString(),
        endsAt:
          end.toISOString(),
        location:
          rule.location ??
          null,
        source:
          "class_rule",
      });
    }

    schedule.sort(
      (a, b) =>
        new Date(
          a.startsAt,
        ).getTime() -
        new Date(
          b.startsAt,
        ).getTime(),
    );

    const allTopics =
      (
        topicData ?? []
      ).map(
        (topic) => ({
          id: topic.id,
          course_id:
            topic.course_id,
          parent_topic_id:
            topic.parent_topic_id ??
            null,
          name:
            topic.name,
          mastery_score:
            Number(
              topic.mastery_score ??
                0,
            ),
          mastery_state:
            topic.mastery_state,
        }),
      );

    const parents =
      new Set(
        allTopics
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

    const preparedness =
      activeCourses.map(
        (course) => {
          const leaf =
            allTopics.filter(
              (topic) =>
                topic.course_id ===
                  course.id &&
                !parents.has(
                  topic.id,
                ),
            );

          const average =
            leaf.length ===
            0
              ? null
              : Math.round(
                  leaf.reduce(
                    (
                      sum,
                      topic,
                    ) =>
                      sum +
                      topic.mastery_score,
                    0,
                  ) /
                    leaf.length,
                );

          const weakest =
            [...leaf]
              .sort(
                (a, b) =>
                  a.mastery_score -
                  b.mastery_score,
              )
              .slice(
                0,
                2,
              )
              .map(
                (topic) => ({
                  id:
                    topic.id,
                  name:
                    topic.name,
                  mastery:
                    Math.round(
                      topic.mastery_score,
                    ),
                }),
              );

          return {
            courseId:
              course.id,
            courseCode:
              course.code,
            courseName:
              course.name,
            color:
              course.color,
            preparedness:
              average,
            weakest,
          };
        },
      );

    const recent =
      [
        ...(notes ?? []).map(
          (note) => {
            const course =
              note.course_id
                ? courseMap.get(
                    note.course_id,
                  )
                : null;

            return {
              id:
                note.id,
              kind:
                "note" as const,
              title:
                note.title ||
                "Untitled note",
              courseCode:
                course?.code ??
                null,
              color:
                course?.color ??
                null,
              at:
                note.updated_at,
              href:
                `/notes?note=${note.id}`,
            };
          },
        ),
        ...(
          lectures ?? []
        ).map(
          (lecture) => {
            const course =
              courseMap.get(
                lecture.course_id,
              );

            return {
              id:
                lecture.id,
              kind:
                "lecture" as const,
              title:
                lecture.title,
              courseCode:
                course?.code ??
                null,
              color:
                course?.color ??
                null,
              at:
                lecture.processed_at ??
                lecture.updated_at,
              href:
                `/lectures/${lecture.id}`,
            };
          },
        ),
        ...(guides ?? []).map(
          (guide) => {
            const course =
              courseMap.get(
                guide.course_id,
              );

            return {
              id:
                guide.id,
              kind:
                "guide" as const,
              title:
                guide.title,
              courseCode:
                course?.code ??
                null,
              color:
                course?.color ??
                null,
              at:
                guide.updated_at,
              href:
                `/study/guide/${guide.id}`,
            };
          },
        ),
      ]
        .sort(
          (a, b) =>
            new Date(
              b.at,
            ).getTime() -
            new Date(
              a.at,
            ).getTime(),
        )
        .slice(0, 6);

    return NextResponse.json({
      ok: true,
      generatedAt:
        now.toISOString(),
      timeZone,
      profile: {
        firstName:
          profile?.first_name ??
          "",
        lastName:
          profile?.last_name ??
          "",
        preferredName:
          profile?.preferred_name ??
          "",
        onboardingCompleted:
          Boolean(
            profile?.onboarding_completed,
          ),
        currentSemesterId:
          profile?.current_semester_id ??
          null,
        targetGpa:
          Number(
            profile?.target_gpa ??
              3.7,
          ),
      },
      courses:
        activeCourses,
      attention,
      schedule,
      preparedness,
      recent,
      learning: {
        profile:
          learning,
        summary:
          plannerLearningSummary(
            learning,
          ),
      },
    });
  } catch (error) {
    console.error(
      "Home intelligence failed:",
      error,
    );

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof
          Error
            ? error.message
            : "Could not build the Home control center.",
      },
      {
        status: 500,
      },
    );
  }
}