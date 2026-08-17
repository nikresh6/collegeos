import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  calculatePreparedness,
  studyNeedScore,
} from "../../../../lib/study-mastery";
import {
  applyLearnedPlannerPreferences,
} from "../../../../lib/academic-intelligence";
import {
  rebuildPlannerLearningProfile,
} from "../../../../lib/planner-learning-server";
import {
  deriveAssessmentLearning,
} from "../../../../lib/assessment-learning";
import {
  assessmentSourceWeights,
} from "../../../../lib/assessment-evidence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Preferences = {
  timezone: string;
  wake_time: string;
  bedtime_time: string;
  breakfast_start: string | null;
  breakfast_end: string | null;
  lunch_start: string | null;
  lunch_end: string | null;
  dinner_start: string | null;
  dinner_end: string | null;
  preferred_study_period:
    | "morning"
    | "afternoon"
    | "evening"
    | "mixed";
  min_study_minutes: number;
  default_study_minutes: number;
  max_study_minutes: number;
  break_minutes: number;
  buffer_minutes: number;
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
  parent_topic_id: string | null;
  name: string;
};

type BusyBlock = {
  start: number;
  end: number;
};

type PlannedBlock = {
  courseId: string;
  topicIds: string[];
  title: string;
  startsAt: string;
  endsAt: string;
  notes: string;
};

function createUserClient(accessToken: string) {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env
      .NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Supabase public environment variables are missing.",
    );
  }

  return createClient(url, key, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function bearerToken(request: Request) {
  const authorization =
    request.headers.get("authorization") ?? "";

  return authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function parseClock(value: string | null | undefined) {
  if (!value) return null;

  const [hours, minutes] = value
    .split(":")
    .map((part) => Number(part));

  if (
    !Number.isFinite(hours) ||
    !Number.isFinite(minutes)
  ) {
    return null;
  }

  return {
    hours,
    minutes,
  };
}

function dateParts(value: string) {
  const [year, month, day] = value
    .split("-")
    .map((part) => Number(part));

  return {
    year,
    month,
    day,
  };
}

function localTimestamp({
  date,
  time,
  utcOffsetMinutes,
}: {
  date: string;
  time: string;
  utcOffsetMinutes: number;
}) {
  const { year, month, day } =
    dateParts(date);
  const clock = parseClock(time);

  if (!clock) {
    throw new Error(
      `Invalid local time: ${time}`,
    );
  }

  return (
    Date.UTC(
      year,
      month - 1,
      day,
      clock.hours,
      clock.minutes,
      0,
      0,
    ) +
    utcOffsetMinutes * 60 * 1000
  );
}

function dateStringFromUtcDay(
  weekStart: string,
  offsetDays: number,
) {
  const { year, month, day } =
    dateParts(weekStart);

  const date = new Date(
    Date.UTC(
      year,
      month - 1,
      day + offsetDays,
      12,
      0,
      0,
    ),
  );

  return [
    date.getUTCFullYear(),
    String(
      date.getUTCMonth() + 1,
    ).padStart(2, "0"),
    String(date.getUTCDate()).padStart(
      2,
      "0",
    ),
  ].join("-");
}

function dayOfWeek(value: string) {
  const { year, month, day } =
    dateParts(value);

  return new Date(
    Date.UTC(year, month - 1, day, 12),
  ).getUTCDay();
}

function dateOrdinal(value: string) {
  const { year, month, day } =
    dateParts(value);

  return Math.floor(
    Date.UTC(year, month - 1, day) /
      (24 * 60 * 60 * 1000),
  );
}

function weekParity(
  startDate: string,
  currentDate: string,
) {
  const delta =
    dateOrdinal(currentDate) -
    dateOrdinal(startDate);

  return (
    Math.floor(Math.max(0, delta) / 7) %
    2
  );
}

function overlap(
  start: number,
  end: number,
  busy: BusyBlock[],
  bufferMinutes: number,
) {
  const buffer =
    bufferMinutes * 60 * 1000;

  return busy.some(
    (block) =>
      start <
        block.end + buffer &&
      end >
        block.start - buffer,
  );
}

function periodScore(
  timestamp: number,
  utcOffsetMinutes: number,
  preferred:
    | "morning"
    | "afternoon"
    | "evening"
    | "mixed",
) {
  if (preferred === "mixed") {
    return 0;
  }

  const local = new Date(
    timestamp -
      utcOffsetMinutes * 60 * 1000,
  );

  const hour = local.getUTCHours();

  const target =
    preferred === "morning"
      ? 9
      : preferred === "afternoon"
        ? 14
        : 19;

  return -Math.abs(hour - target) * 4;
}

function urgencyFromDays(
  daysAway: number,
  eventType: string,
) {
  const typeBoost =
    /exam|midterm|final/i.test(
      eventType,
    )
      ? 34
      : /quiz/i.test(eventType)
        ? 24
        : /assignment|paper|project|essay|homework/i.test(
              eventType,
            )
          ? 18
          : 10;

  if (daysAway <= 1) {
    return typeBoost + 50;
  }

  if (daysAway <= 3) {
    return typeBoost + 35;
  }

  if (daysAway <= 7) {
    return typeBoost + 22;
  }

  if (daysAway <= 14) {
    return typeBoost + 10;
  }

  return 0;
}

function minutesForPreparedness({
  preparedness,
  urgency,
  preferences,
}: {
  preparedness: number;
  urgency: number;
  preferences: Preferences;
}) {
  const range =
    preferences.max_study_minutes -
    preferences.min_study_minutes;

  const weaknessMinutes =
    preferences.min_study_minutes +
    (1 - preparedness / 100) *
      range;

  const urgencyMinutes =
    Math.min(20, urgency * 0.18);

  const result =
    weaknessMinutes + urgencyMinutes;

  return Math.round(
    clamp(
      result,
      preferences.min_study_minutes,
      preferences.max_study_minutes,
    ) / 5,
  ) * 5;
}

export async function POST(request: Request) {
  const token = bearerToken(request);

  if (!token) {
    return NextResponse.json(
      {
        ok: false,
        error: "You are not signed in.",
      },
      { status: 401 },
    );
  }

  const supabase =
    createUserClient(token);

  try {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError) throw userError;
    if (!user) {
      throw new Error(
        "You are not signed in.",
      );
    }

    const body = (await request.json()) as {
      weekStart?: string;
      utcOffsetMinutes?: number;
    };

    const weekStart =
      body.weekStart?.trim() ?? "";
    const utcOffsetMinutes = Number(
      body.utcOffsetMinutes ?? 0,
    );

    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(
        weekStart,
      )
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "A valid weekStart is required.",
        },
        { status: 400 },
      );
    }

    const weekEnd =
      dateStringFromUtcDay(
        weekStart,
        7,
      );

    const weekStartMs =
      localTimestamp({
        date: weekStart,
        time: "00:00",
        utcOffsetMinutes,
      });

    const weekEndMs =
      localTimestamp({
        date: weekEnd,
        time: "00:00",
        utcOffsetMinutes,
      });

    const [
      {
        data: preferenceData,
        error: preferenceError,
      },
      { data: courseData, error: courseError },
      { data: topicData, error: topicError },
      {
        data: responseData,
        error: responseError,
      },
      { data: rulesData, error: rulesError },
      { data: itemsData, error: itemsError },
      {
        data: courseEventData,
        error: courseEventError,
      },
      {
        data: assessmentSourceData,
        error: assessmentSourceError,
      },
      {
        data: assessmentTopicData,
        error: assessmentTopicError,
      },
      {
        data: assessmentFeedbackData,
        error: assessmentFeedbackError,
      },
    ] = await Promise.all([
      supabase
        .from("calendar_preferences")
        .select(
          "timezone, wake_time, bedtime_time, breakfast_start, breakfast_end, lunch_start, lunch_end, dinner_start, dinner_end, preferred_study_period, min_study_minutes, default_study_minutes, max_study_minutes, break_minutes, buffer_minutes",
        )
        .eq("user_id", user.id)
        .single(),
      supabase
        .from("courses")
        .select("id, code, name, color")
        .eq("user_id", user.id)
        .is("archived_at", null),
      supabase
        .from("course_topics")
        .select(
          "id, course_id, parent_topic_id, name",
        )
        .eq("user_id", user.id),
      supabase
        .from("study_responses")
        .select(
          "course_id, topic_id, score, answered_at",
        )
        .eq("user_id", user.id)
        .order("answered_at", {
          ascending: true,
        }),
      supabase
        .from("class_schedule_rules")
        .select(
          "id, course_id, days_of_week, start_time, end_time, start_date, end_date, week_pattern",
        )
        .eq("user_id", user.id)
        .eq("is_active", true)
        .lte("start_date", weekEnd)
        .gte("end_date", weekStart),
      supabase
        .from("calendar_items")
        .select(
          "id, course_id, item_type, starts_at, ends_at, source, planner_locked, topic_ids",
        )
        .eq("user_id", user.id)
        .gte(
          "starts_at",
          new Date(
            weekStartMs,
          ).toISOString(),
        )
        .lt(
          "starts_at",
          new Date(
            weekEndMs,
          ).toISOString(),
        )
        .neq("status", "cancelled"),
      supabase
        .from("course_events")
        .select(
          "course_id, name, event_type, start_date",
        )
        .eq("user_id", user.id)
        .gte("start_date", weekStart)
        .lte(
          "start_date",
          dateStringFromUtcDay(
            weekStart,
            14,
          ),
        ),
      supabase
        .from("assessment_sources")
        .select("id, course_id, title, source_type, source_authority, style_weight, coverage_weight, assessment_date, status, created_at")
        .eq("user_id", user.id)
        .eq("status", "ready")
        .order("created_at", { ascending: false })
        .limit(500),
      supabase
        .from("assessment_source_topic_links")
        .select("source_id, course_id, topic_id, relevance_score, question_count")
        .eq("user_id", user.id)
        .limit(1000),
      supabase
        .from("assessment_feedback")
        .select("course_id, assessment_kind, score_percent, preparedness_percent, difficulty_percent, quiz_similarity_percent, assistant_helpfulness_percent, study_hours, difference_notes, covered_topic_ids, weak_topic_ids, response_status, created_at")
        .eq("user_id", user.id)
        .eq("response_status", "completed")
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

    if (preferenceError) {
      throw preferenceError;
    }
    if (courseError) throw courseError;
    if (topicError) throw topicError;
    if (responseError) {
      throw responseError;
    }
    if (rulesError) throw rulesError;
    if (itemsError) throw itemsError;
    if (courseEventError) {
      throw courseEventError;
    }
    if (assessmentSourceError) throw assessmentSourceError;
    if (assessmentTopicError) throw assessmentTopicError;
    if (assessmentFeedbackError) throw assessmentFeedbackError;

    const basePreferences =
      preferenceData as Preferences;

    const learnedProfile =
      await rebuildPlannerLearningProfile({
        supabase,
        userId: user.id,
        timeZone:
          basePreferences.timezone ||
          "America/Chicago",
      });

    const preferences =
      applyLearnedPlannerPreferences({
        preferences:
          basePreferences,
        learning:
          learnedProfile,
      });

    const courses = (
      courseData ?? []
    ) as Course[];

    const topics = (
      topicData ?? []
    ) as Topic[];

    const childIds = new Set(
      topics
        .map(
          (topic) =>
            topic.parent_topic_id,
        )
        .filter(
          (id): id is string =>
            Boolean(id),
        ),
    );

    const leafTopics =
      topics.filter(
        (topic) =>
          !childIds.has(topic.id),
      );

    const topicById = new Map(topics.map((topic) => [topic.id, topic]));
    const childrenByParent = new Map<string, Topic[]>();
    for (const topic of topics) {
      if (!topic.parent_topic_id) continue;
      const current = childrenByParent.get(topic.parent_topic_id) ?? [];
      current.push(topic);
      childrenByParent.set(topic.parent_topic_id, current);
    }

    const expandToLeafTopics = (
      topicIds: string[],
      courseId: string,
    ) => {
      const leaves = new Set<string>();
      const pending = [...topicIds];
      const visited = new Set<string>();

      while (pending.length) {
        const topicId = pending.pop();
        if (!topicId || visited.has(topicId)) continue;
        visited.add(topicId);

        const topic = topicById.get(topicId);
        if (!topic || topic.course_id !== courseId) continue;
        const children = (childrenByParent.get(topicId) ?? []).filter(
          (child) => child.course_id === courseId,
        );
        if (children.length === 0) {
          leaves.add(topicId);
        } else {
          pending.push(...children.map((child) => child.id));
        }
      }

      return Array.from(leaves);
    };

    const preparednessByTopic =
      new Map<
        string,
        ReturnType<
          typeof calculatePreparedness
        >
      >();

    for (const topic of leafTopics) {
      const evidence = (
        responseData ?? []
      )
        .filter(
          (response) =>
            response.topic_id ===
            topic.id,
        )
        .map((response) => ({
          score: Number(
            response.score ?? 0,
          ),
          answered_at:
            response.answered_at,
        }));

      preparednessByTopic.set(
        topic.id,
        calculatePreparedness(evidence),
      );
    }

    const courseUrgency =
      new Map<string, number>();
    const topicUrgency =
      new Map<string, number>();

    const weekStartOrdinal =
      dateOrdinal(weekStart);

    for (const event of
      courseEventData ?? []) {
      const daysAway =
        dateOrdinal(event.start_date) -
        weekStartOrdinal;

      const urgency =
        urgencyFromDays(
          daysAway,
          `${event.event_type} ${event.name}`,
        );

      courseUrgency.set(
        event.course_id,
        Math.max(
          courseUrgency.get(
            event.course_id,
          ) ?? 0,
          urgency,
        ),
      );

    }

    for (const item of itemsData ?? []) {
      if (!item.course_id) continue;

      if (
        ![
          "assignment",
          "exam",
          "quiz",
        ].includes(item.item_type)
      ) {
        continue;
      }

      const daysAway =
        Math.floor(
          (new Date(
            item.starts_at,
          ).getTime() -
            weekStartMs) /
            (24 *
              60 *
              60 *
              1000),
        );

      const urgency =
        urgencyFromDays(
          daysAway,
          item.item_type,
        );

      courseUrgency.set(
        item.course_id,
        Math.max(
          courseUrgency.get(
            item.course_id,
          ) ?? 0,
          urgency,
        ),
      );

      const scopedTopicIds = Array.isArray(item.topic_ids)
        ? item.topic_ids.filter((id): id is string => typeof id === "string")
        : [];
      for (const topicId of expandToLeafTopics(
        scopedTopicIds,
        item.course_id,
      )) {
        topicUrgency.set(topicId, Math.max(topicUrgency.get(topicId) ?? 0, urgency));
      }
    }

    const sourceById = new Map(
      (assessmentSourceData ?? []).map((source) => [source.id, source]),
    );

    const assessmentPriorityByTopic = new Map<
      string,
      {
        score: number;
        questionCount: number;
        sourceTypes: Set<string>;
      }
    >();

    for (const link of assessmentTopicData ?? []) {
      const source = sourceById.get(link.source_id);
      if (!source || source.course_id !== link.course_id) continue;

      const relevance = clamp(Number(link.relevance_score ?? 0), 0, 1);
      const coverageWeight = assessmentSourceWeights(source).coverage;
      const questionCount = Math.max(0, Number(link.question_count ?? 0));
      const questionSignal = 1 + Math.min(0.35, questionCount * 0.035);
      const score = relevance * coverageWeight * questionSignal * 24;
      for (const topicId of expandToLeafTopics(
        [link.topic_id],
        link.course_id,
      )) {
        const current = assessmentPriorityByTopic.get(topicId) ?? {
          score: 0,
          questionCount: 0,
          sourceTypes: new Set<string>(),
        };

        current.score = Math.min(52, current.score + score);
        current.questionCount += questionCount;
        current.sourceTypes.add(source.source_type);
        assessmentPriorityByTopic.set(topicId, current);
      }
    }

    const surveyPriorityByTopic = new Map<string, number>();
    const assessmentLearningByCourse = new Map<string, ReturnType<typeof deriveAssessmentLearning>>();

    for (const course of courses) {
      assessmentLearningByCourse.set(
        course.id,
        deriveAssessmentLearning(
          (assessmentFeedbackData ?? []).filter((row) => row.course_id === course.id),
        ),
      );
    }

    for (const feedback of assessmentFeedbackData ?? []) {
      const score = clamp(Number(feedback.score_percent ?? 100), 0, 100);
      const weakness = 10 + Math.max(0, 82 - score) * 0.28;
      const covered = Array.isArray(feedback.covered_topic_ids)
        ? feedback.covered_topic_ids.filter((id): id is string => typeof id === "string")
        : [];
      const weak = Array.isArray(feedback.weak_topic_ids)
        ? feedback.weak_topic_ids.filter((id): id is string => typeof id === "string")
        : [];

      for (const topicId of expandToLeafTopics(
        covered,
        feedback.course_id,
      )) {
        if (score < 82) {
          surveyPriorityByTopic.set(
            topicId,
            Math.min(30, (surveyPriorityByTopic.get(topicId) ?? 0) + 5),
          );
        }
      }

      for (const topicId of expandToLeafTopics(
        weak,
        feedback.course_id,
      )) {
        surveyPriorityByTopic.set(
          topicId,
          Math.min(42, (surveyPriorityByTopic.get(topicId) ?? 0) + weakness),
        );
      }
    }

    const rankedCourses = courses
      .map((course) => {
        const courseTopics =
          leafTopics.filter(
            (topic) =>
              topic.course_id ===
              course.id,
          );

        const rankedTopics =
          courseTopics
            .map((topic) => {
              const evidence = assessmentPriorityByTopic.get(topic.id);
              return {
                topic,
                stats:
                  preparednessByTopic.get(
                    topic.id,
                  ) ??
                  calculatePreparedness(
                    [],
                  ),
                assessmentPriority: evidence?.score ?? 0,
                assessmentQuestionCount: evidence?.questionCount ?? 0,
                assessmentSourceTypes: evidence ? Array.from(evidence.sourceTypes) : [],
                surveyPriority: surveyPriorityByTopic.get(topic.id) ?? 0,
                deadlinePriority: topicUrgency.get(topic.id) ?? 0,
              };
            })
            .sort(
              (a, b) =>
                (studyNeedScore(b.stats) + b.assessmentPriority + b.surveyPriority + b.deadlinePriority) -
                (studyNeedScore(a.stats) + a.assessmentPriority + a.surveyPriority + a.deadlinePriority),
            );

        const top =
          rankedTopics.slice(0, 4);

        const preparedness =
          top.length === 0
            ? 45
            : Math.round(
                top.reduce(
                  (sum, item) =>
                    sum +
                    item.stats
                      .preparedness,
                  0,
                ) / top.length,
              );

        const urgency =
          courseUrgency.get(
            course.id,
          ) ?? 0;

        const assessmentLearning = assessmentLearningByCourse.get(course.id) ?? deriveAssessmentLearning([]);
        const evidencePriority = top.length
          ? Math.max(...top.map((item) => item.assessmentPriority + item.surveyPriority))
          : 0;

        return {
          course,
          topics: rankedTopics,
          preparedness,
          urgency,
          assessmentMultiplier: assessmentLearning.studyLoadMultiplier,
          evidencePriority,
          need:
            (100 - preparedness) +
            urgency +
            evidencePriority +
            Math.max(0, assessmentLearning.studyLoadMultiplier - 1) * 45 +
            (top.some(
              (item) =>
                item.stats
                  .answeredCount === 0,
            )
              ? 14
              : 0),
        };
      })
      .sort(
        (a, b) =>
          b.need - a.need,
      );

    const busyByDate =
      new Map<
        string,
        BusyBlock[]
      >();

    for (
      let dayIndex = 0;
      dayIndex < 7;
      dayIndex += 1
    ) {
      busyByDate.set(
        dateStringFromUtcDay(
          weekStart,
          dayIndex,
        ),
        [],
      );
    }

    for (const item of itemsData ?? []) {
      if (
        item.source === "ai" &&
        item.item_type === "study" &&
        !item.planner_locked
      ) {
        continue;
      }

      const start =
        new Date(
          item.starts_at,
        ).getTime();
      const end =
        new Date(
          item.ends_at,
        ).getTime();

      const localStart =
        new Date(
          start -
            utcOffsetMinutes *
              60 *
              1000,
        );

      const date = [
        localStart.getUTCFullYear(),
        String(
          localStart.getUTCMonth() +
            1,
        ).padStart(2, "0"),
        String(
          localStart.getUTCDate(),
        ).padStart(2, "0"),
      ].join("-");

      busyByDate.get(date)?.push({
        start,
        end,
      });
    }

    for (
      let dayIndex = 0;
      dayIndex < 7;
      dayIndex += 1
    ) {
      const date =
        dateStringFromUtcDay(
          weekStart,
          dayIndex,
        );

      const dow = dayOfWeek(date);

      for (const rule of
        rulesData ?? []) {
        const days = Array.isArray(
          rule.days_of_week,
        )
          ? rule.days_of_week.map(Number)
          : [];

        if (!days.includes(dow)) {
          continue;
        }

        if (
          date < rule.start_date ||
          date > rule.end_date
        ) {
          continue;
        }

        if (
          rule.week_pattern ===
            "odd" &&
          weekParity(
            rule.start_date,
            date,
          ) !== 0
        ) {
          continue;
        }

        if (
          rule.week_pattern ===
            "even" &&
          weekParity(
            rule.start_date,
            date,
          ) !== 1
        ) {
          continue;
        }

        busyByDate.get(date)?.push({
          start: localTimestamp({
            date,
            time: rule.start_time,
            utcOffsetMinutes,
          }),
          end: localTimestamp({
            date,
            time: rule.end_time,
            utcOffsetMinutes,
          }),
        });
      }

      const mealPairs: Array<
        [string | null, string | null]
      > = [
        [
          preferences.breakfast_start,
          preferences.breakfast_end,
        ],
        [
          preferences.lunch_start,
          preferences.lunch_end,
        ],
        [
          preferences.dinner_start,
          preferences.dinner_end,
        ],
      ];

      for (const [
        mealStart,
        mealEnd,
      ] of mealPairs) {
        if (
          !mealStart ||
          !mealEnd
        ) {
          continue;
        }

        busyByDate.get(date)?.push({
          start: localTimestamp({
            date,
            time: mealStart,
            utcOffsetMinutes,
          }),
          end: localTimestamp({
            date,
            time: mealEnd,
            utcOffsetMinutes,
          }),
        });
      }
    }

    const proposed: PlannedBlock[] = [];

    const courseTargets =
      rankedCourses.slice(0, 5);

    for (const target of courseTargets) {
      if (
        target.topics.length === 0
      ) {
        continue;
      }

      const weakest =
        target.topics.slice(0, 3);

      let sessionCount =
        target.urgency >= 55
          ? 2
          : 1;

      if (target.evidencePriority >= 28) {
        sessionCount = Math.max(sessionCount, 2);
      }

      if (
        target.preparedness < 35 &&
        target.urgency >= 25
      ) {
        sessionCount = 3;
      }

      const baseMinutes =
        minutesForPreparedness({
          preparedness:
            target.preparedness,
          urgency: target.urgency,
          preferences,
        });

      const minutes = Math.round(
        clamp(
          baseMinutes * target.assessmentMultiplier,
          preferences.min_study_minutes,
          preferences.max_study_minutes,
        ) / 5,
      ) * 5;

      for (
        let sessionIndex = 0;
        sessionIndex < sessionCount;
        sessionIndex += 1
      ) {
        const candidates: Array<{
          date: string;
          start: number;
          end: number;
          score: number;
        }> = [];

        for (
          let dayIndex = 0;
          dayIndex < 7;
          dayIndex += 1
        ) {
          const date =
            dateStringFromUtcDay(
              weekStart,
              dayIndex,
            );

          const wakeClock =
            parseClock(
              preferences.wake_time,
            ) ?? {
              hours: 7,
              minutes: 30,
            };

          const bedClock =
            parseClock(
              preferences.bedtime_time,
            ) ?? {
              hours: 23,
              minutes: 30,
            };

          const wakeMinutes =
            wakeClock.hours * 60 +
            wakeClock.minutes;

          let bedMinutes =
            bedClock.hours * 60 +
            bedClock.minutes;

          if (
            bedMinutes <=
            wakeMinutes
          ) {
            bedMinutes = 24 * 60;
          }

          const latestStart =
            bedMinutes - minutes;

          for (
            let localMinutes =
              Math.ceil(
                wakeMinutes / 15,
              ) * 15;
            localMinutes <=
            latestStart;
            localMinutes += 15
          ) {
            const hour =
              Math.floor(
                localMinutes / 60,
              );
            const minute =
              localMinutes % 60;

            if (hour >= 24) {
              continue;
            }

            const time = `${String(
              hour,
            ).padStart(2, "0")}:${String(
              minute,
            ).padStart(2, "0")}`;

            const start =
              localTimestamp({
                date,
                time,
                utcOffsetMinutes,
              });

            const end =
              start +
              minutes *
                60 *
                1000;

            if (
              overlap(
                start,
                end,
                busyByDate.get(
                  date,
                ) ?? [],
                preferences.buffer_minutes,
              )
            ) {
              continue;
            }

            const sameCourseSameDay =
              proposed.some((block) => {
                if (
                  block.courseId !==
                  target.course.id
                ) {
                  return false;
                }

                const local =
                  new Date(
                    new Date(
                      block.startsAt,
                    ).getTime() -
                      utcOffsetMinutes *
                        60 *
                        1000,
                  );

                const blockDate = [
                  local.getUTCFullYear(),
                  String(
                    local.getUTCMonth() +
                      1,
                  ).padStart(2, "0"),
                  String(
                    local.getUTCDate(),
                  ).padStart(2, "0"),
                ].join("-");

                return blockDate === date;
              });

            const dayPenalty =
              sameCourseSameDay
                ? -28
                : 0;

            const spacingScore =
              dayIndex * -1.5;

            const score =
              periodScore(
                start,
                utcOffsetMinutes,
                preferences.preferred_study_period,
              ) +
              dayPenalty +
              spacingScore;

            candidates.push({
              date,
              start,
              end,
              score,
            });
          }
        }

        candidates.sort(
          (a, b) =>
            b.score - a.score,
        );

        const chosen =
          candidates[0];

        if (!chosen) {
          break;
        }

        const topicNames =
          weakest
            .slice(0, 2)
            .map(
              (item) =>
                item.topic.name,
            );

        const topicIds =
          weakest.map(
            (item) =>
              item.topic.id,
          );

        const notes = [
          `${target.preparedness}% course preparedness`,
          target.urgency > 0
            ? "Upcoming academic deadline increases priority"
            : "Scheduled from preparedness and practice evidence",
          topicNames.length > 0
            ? `Focus: ${topicNames.join(
                " + ",
              )}`
            : "",
          weakest.some((item) => item.assessmentQuestionCount > 0)
            ? `${weakest.reduce((sum, item) => sum + item.assessmentQuestionCount, 0)} relevant assessment questions`
            : "",
          weakest.some((item) => item.surveyPriority > 0)
            ? "Post-grade reflection marked this scope for review"
            : "",
        ]
          .filter(Boolean)
          .join(" · ");

        proposed.push({
          courseId:
            target.course.id,
          topicIds,
          title:
            topicNames.length > 0
              ? `Study ${target.course.code}: ${topicNames[0]}`
              : `Study ${target.course.code}`,
          startsAt:
            new Date(
              chosen.start,
            ).toISOString(),
          endsAt:
            new Date(
              chosen.end,
            ).toISOString(),
          notes,
        });

        busyByDate
          .get(chosen.date)
          ?.push({
            start: chosen.start,
            end: chosen.end,
          });
      }
    }

    const {
      error: deleteError,
    } = await supabase
      .from("calendar_items")
      .delete()
      .eq("user_id", user.id)
      .eq("source", "ai")
      .eq("item_type", "study")
      .eq("planner_locked", false)
      .gte(
        "starts_at",
        new Date(
          weekStartMs,
        ).toISOString(),
      )
      .lt(
        "starts_at",
        new Date(
          weekEndMs,
        ).toISOString(),
      );

    if (deleteError) {
      throw deleteError;
    }

    if (proposed.length > 0) {
      const {
        data: inserted,
        error: insertError,
      } = await supabase
        .from("calendar_items")
        .insert(
          proposed.map((block) => ({
            user_id: user.id,
            course_id:
              block.courseId,
            title: block.title,
            item_type: "study",
            starts_at:
              block.startsAt,
            ends_at: block.endsAt,
            all_day: false,
            notes: block.notes,
            flexibility: "flexible",
            status: "scheduled",
            source: "ai",
            topic_ids:
              block.topicIds,
          })),
        )
        .select(
          "id, course_id, starts_at, ends_at, topic_ids",
        );

      if (insertError) {
        throw insertError;
      }

      if (
        inserted &&
        inserted.length > 0
      ) {
        const {
          error:
            behaviorError,
        } = await supabase
          .from(
            "study_behavior_events",
          )
          .insert(
            inserted.map(
              (item) => ({
                user_id:
                  user.id,
                course_id:
                  item.course_id ??
                  null,
                calendar_item_id:
                  item.id,
                event_type:
                  "planned",
                topic_ids:
                  Array.isArray(
                    item.topic_ids,
                  )
                    ? item.topic_ids
                    : [],
                original_starts_at:
                  null,
                original_ends_at:
                  null,
                resulting_starts_at:
                  item.starts_at,
                resulting_ends_at:
                  item.ends_at,
                metadata: {
                  origin:
                    "adaptive_planner",
                  learnedPreferenceConfidence:
                    learnedProfile.confidence,
                  learnedPreferredPeriod:
                    learnedProfile.learned_preferred_period,
                  learnedDefaultMinutes:
                    learnedProfile.learned_default_minutes,
                },
              }),
            ),
          );

        if (behaviorError) {
          console.warn(
            "Could not log planned study behavior:",
            behaviorError,
          );
        }
      }
    }

    return NextResponse.json({
      ok: true,
      plannedCount: proposed.length,
      blocks: proposed,
      learnedPlanner: {
        confidence:
          learnedProfile.confidence,
        preferredPeriod:
          learnedProfile.learned_preferred_period,
        defaultMinutes:
          learnedProfile.learned_default_minutes,
        maxMinutes:
          learnedProfile.learned_max_minutes,
      },
      message:
        proposed.length > 0
          ? `Planned ${proposed.length} flexible study session${proposed.length === 1 ? "" : "s"} around classes, meals, sleep, deadlines, quiz mastery, assessment coverage, and what your grade reflections said needs work.`
          : "I could not find a conflict-free study window this week. Adjust your availability or calendar and try again.",
    });
  } catch (error) {
    console.error(
      "Calendar study planning failed:",
      error,
    );

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not plan the study week.",
      },
      { status: 500 },
    );
  }
}
