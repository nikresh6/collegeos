export type PlannerPeriod =
  | "morning"
  | "afternoon"
  | "evening"
  | "mixed";

export type PlannerLearningProfile = {
  learned_preferred_period: PlannerPeriod | null;
  learned_default_minutes: number | null;
  learned_max_minutes: number | null;
  completion_rate: number | null;
  sample_count: number;
  confidence: number;
  learned_at: string | null;
};

export type StudyBehaviorRow = {
  event_type:
    | "planned"
    | "moved"
    | "resized"
    | "completed"
    | "skipped"
    | "deleted";
  topic_ids: unknown;
  original_starts_at: string | null;
  original_ends_at: string | null;
  resulting_starts_at: string | null;
  resulting_ends_at: string | null;
  metadata: unknown;
  created_at: string;
};

export type TopicResponseEvidence = {
  topic_id: string | null;
  score: number;
  answered_at: string;
};

function clamp(
  value: number,
  minimum: number,
  maximum: number,
) {
  return Math.max(
    minimum,
    Math.min(maximum, value),
  );
}

function percentile(
  values: number[],
  p: number,
) {
  if (values.length === 0) {
    return null;
  }

  const sorted =
    [...values].sort(
      (a, b) => a - b,
    );

  const index =
    clamp(
      p,
      0,
      1,
    ) *
    (sorted.length - 1);

  const lower =
    Math.floor(index);
  const upper =
    Math.ceil(index);

  if (lower === upper) {
    return sorted[lower];
  }

  const weight =
    index - lower;

  return (
    sorted[lower] *
      (1 - weight) +
    sorted[upper] *
      weight
  );
}

function topicIdsFrom(
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

function minutesBetween(
  start: string | null,
  end: string | null,
) {
  if (!start || !end) {
    return null;
  }

  const startMs =
    new Date(start).getTime();
  const endMs =
    new Date(end).getTime();

  if (
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    endMs <= startMs
  ) {
    return null;
  }

  return (
    (endMs - startMs) /
    60000
  );
}

function localHour(
  iso: string,
  timeZone: string,
) {
  const date =
    new Date(iso);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return null;
  }

  const parts =
    new Intl.DateTimeFormat(
      "en-US",
      {
        timeZone,
        hour: "2-digit",
        hour12: false,
      },
    ).formatToParts(date);

  const hour =
    Number(
      parts.find(
        (part) =>
          part.type === "hour",
      )?.value,
    );

  return Number.isFinite(hour)
    ? hour
    : null;
}

function periodForHour(
  hour: number | null,
): Exclude<
  PlannerPeriod,
  "mixed"
> | null {
  if (hour === null) {
    return null;
  }

  if (hour < 12) {
    return "morning";
  }

  if (hour < 17) {
    return "afternoon";
  }

  return "evening";
}

function average(
  values: number[],
) {
  if (values.length === 0) {
    return null;
  }

  return (
    values.reduce(
      (sum, value) =>
        sum + value,
      0,
    ) / values.length
  );
}

function responseAverage({
  responses,
  topicIds,
  start,
  end,
}: {
  responses: TopicResponseEvidence[];
  topicIds: string[];
  start: number;
  end: number;
}) {
  const allowed =
    new Set(topicIds);

  return average(
    responses
      .filter((response) => {
        if (
          !response.topic_id ||
          !allowed.has(
            response.topic_id,
          )
        ) {
          return false;
        }

        const answered =
          new Date(
            response.answered_at,
          ).getTime();

        return (
          answered >= start &&
          answered <= end
        );
      })
      .map((response) =>
        Number(
          response.score ?? 0,
        ),
      ),
  );
}

function efficacyForEvent({
  event,
  responses,
}: {
  event: StudyBehaviorRow;
  responses: TopicResponseEvidence[];
}) {
  if (
    event.event_type !==
      "completed" ||
    !event.resulting_ends_at
  ) {
    return 0;
  }

  const topicIds =
    topicIdsFrom(
      event.topic_ids,
    );

  if (
    topicIds.length === 0
  ) {
    return 0;
  }

  const end =
    new Date(
      event.resulting_ends_at,
    ).getTime();

  if (!Number.isFinite(end)) {
    return 0;
  }

  const week =
    7 *
    24 *
    60 *
    60 *
    1000;

  const before =
    responseAverage({
      responses,
      topicIds,
      start:
        end - week,
      end:
        end - 1,
    });

  const after =
    responseAverage({
      responses,
      topicIds,
      start: end,
      end:
        Math.min(
          Date.now(),
          end + week,
        ),
    });

  if (
    before === null ||
    after === null
  ) {
    return 0;
  }

  return clamp(
    after - before,
    -1,
    1,
  );
}

export function derivePlannerLearning({
  events,
  responses,
  timeZone,
}: {
  events: StudyBehaviorRow[];
  responses: TopicResponseEvidence[];
  timeZone: string;
}): PlannerLearningProfile {
  const relevant =
    events.filter(
      (event) =>
        event.event_type !==
        "planned",
    );

  const completionEvents =
    relevant.filter(
      (event) =>
        event.event_type ===
        "completed",
    );

  const negativeEvents =
    relevant.filter(
      (event) =>
        event.event_type ===
          "skipped" ||
        event.event_type ===
          "deleted",
    );

  const periodWeights:
    Record<
      Exclude<
        PlannerPeriod,
        "mixed"
      >,
      number
    > = {
      morning: 0,
      afternoon: 0,
      evening: 0,
    };

  const durationSamples:
    Array<{
      minutes: number;
      weight: number;
    }> = [];

  for (const event of relevant) {
    const start =
      event.resulting_starts_at ??
      event.original_starts_at;

    const end =
      event.resulting_ends_at ??
      event.original_ends_at;

    const period =
      start
        ? periodForHour(
            localHour(
              start,
              timeZone,
            ),
          )
        : null;

    const efficacy =
      efficacyForEvent({
        event,
        responses,
      });

    const positiveWeight =
      event.event_type ===
      "completed"
        ? 2.4 +
          Math.max(
            0,
            efficacy,
          ) *
            2.6
        : event.event_type ===
            "moved"
          ? 1.4
          : event.event_type ===
              "resized"
            ? 1.1
            : -1.2;

    if (period) {
      periodWeights[period] +=
        positiveWeight;
    }

    const minutes =
      minutesBetween(
        start,
        end,
      );

    if (
      minutes !== null &&
      minutes >= 15 &&
      minutes <= 240 &&
      (
        event.event_type ===
          "completed" ||
        event.event_type ===
          "moved" ||
        event.event_type ===
          "resized"
      )
    ) {
      durationSamples.push({
        minutes,
        weight:
          Math.max(
            0.2,
            positiveWeight,
          ),
      });
    }
  }

  const rankedPeriods =
    (
      Object.entries(
        periodWeights,
      ) as Array<
        [
          Exclude<
            PlannerPeriod,
            "mixed"
          >,
          number,
        ]
      >
    ).sort(
      (a, b) =>
        b[1] - a[1],
    );

  const bestPeriod =
    rankedPeriods[0];

  const secondPeriod =
    rankedPeriods[1];

  let learnedPeriod:
    PlannerPeriod | null =
    null;

  if (
    bestPeriod &&
    bestPeriod[1] > 0
  ) {
    learnedPeriod =
      secondPeriod &&
      secondPeriod[1] > 0 &&
      Math.abs(
        bestPeriod[1] -
          secondPeriod[1],
      ) < 1.8
        ? "mixed"
        : bestPeriod[0];
  }

  const expandedDurations:
    number[] = [];

  for (
    const sample of
    durationSamples
  ) {
    const copies =
      Math.max(
        1,
        Math.min(
          6,
          Math.round(
            sample.weight,
          ),
        ),
      );

    for (
      let index = 0;
      index < copies;
      index += 1
    ) {
      expandedDurations.push(
        sample.minutes,
      );
    }
  }

  const median =
    percentile(
      expandedDurations,
      0.5,
    );

  const upper =
    percentile(
      expandedDurations,
      0.8,
    );

  const longSessionFailures =
    negativeEvents.filter(
      (event) => {
        const minutes =
          minutesBetween(
            event.resulting_starts_at ??
              event.original_starts_at,
            event.resulting_ends_at ??
              event.original_ends_at,
          );

        return (
          minutes !== null &&
          minutes >= 75
        );
      },
    ).length;

  const learnedDefault =
    median === null
      ? null
      : Math.round(
          clamp(
            Math.round(
              median / 5,
            ) * 5,
            20,
            120,
          ),
        );

  let learnedMax =
    upper === null
      ? null
      : Math.round(
          clamp(
            Math.round(
              upper / 5,
            ) * 5,
            25,
            180,
          ),
        );

  if (
    learnedMax !== null &&
    longSessionFailures >= 2
  ) {
    learnedMax =
      Math.min(
        learnedMax,
        75,
      );
  }

  const completionDenominator =
    completionEvents.length +
    negativeEvents.length;

  const completionRate =
    completionDenominator === 0
      ? null
      : completionEvents.length /
        completionDenominator;

  const sampleCount =
    relevant.length;

  const confidence =
    clamp(
      sampleCount / 14,
      0,
      1,
    );

  return {
    learned_preferred_period:
      learnedPeriod,
    learned_default_minutes:
      learnedDefault,
    learned_max_minutes:
      learnedMax,
    completion_rate:
      completionRate,
    sample_count:
      sampleCount,
    confidence,
    learned_at:
      sampleCount > 0
        ? new Date().toISOString()
        : null,
  };
}

export function applyLearnedPlannerPreferences<
  T extends {
    preferred_study_period: PlannerPeriod;
    default_study_minutes: number;
    max_study_minutes: number;
    min_study_minutes: number;
  },
>({
  preferences,
  learning,
}: {
  preferences: T;
  learning:
    | PlannerLearningProfile
    | null;
}): T {
  if (
    !learning ||
    learning.confidence < 0.25
  ) {
    return preferences;
  }

  const next = {
    ...preferences,
  };

  if (
    learning.learned_preferred_period
  ) {
    next.preferred_study_period =
      learning.learned_preferred_period;
  }

  if (
    learning.learned_default_minutes
  ) {
    next.default_study_minutes =
      Math.max(
        next.min_study_minutes,
        Math.min(
          learning.learned_default_minutes,
          next.max_study_minutes,
        ),
      );
  }

  if (
    learning.learned_max_minutes
  ) {
    next.max_study_minutes =
      Math.max(
        next.default_study_minutes,
        learning.learned_max_minutes,
      );
  }

  return next;
}

export function plannerLearningSummary(
  profile:
    | PlannerLearningProfile
    | null,
) {
  if (
    !profile ||
    profile.confidence < 0.25
  ) {
    return null;
  }

  const period =
    profile.learned_preferred_period;

  const duration =
    profile.learned_default_minutes;

  const pieces: string[] =
    [];

  if (
    period &&
    period !== "mixed"
  ) {
    pieces.push(
      `you tend to keep ${period} sessions`,
    );
  } else if (
    period === "mixed"
  ) {
    pieces.push(
      "your study time varies by day",
    );
  }

  if (duration) {
    pieces.push(
      `${duration}-minute blocks fit you well`,
    );
  }

  if (
    profile.completion_rate !==
      null &&
    profile.sample_count >= 4
  ) {
    pieces.push(
      `${Math.round(
        profile.completion_rate *
          100,
      )}% of observed plans were completed`,
    );
  }

  if (
    pieces.length === 0
  ) {
    return null;
  }

  return pieces.join(", ");
}