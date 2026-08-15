import type {
  SupabaseClient,
} from "@supabase/supabase-js";
import {
  derivePlannerLearning,
  type PlannerLearningProfile,
} from "./academic-intelligence";
import {
  deriveAssessmentLearning,
} from "./assessment-learning";

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

function roundToFive(
  value: number,
) {
  return (
    Math.round(value / 5) *
    5
  );
}

export async function rebuildPlannerLearningProfile({
  supabase,
  userId,
  timeZone,
}: {
  supabase: SupabaseClient;
  userId: string;
  timeZone: string;
}): Promise<PlannerLearningProfile> {
  const since =
    new Date(
      Date.now() -
        120 *
          24 *
          60 *
          60 *
          1000,
    ).toISOString();

  const [
    {
      data: events,
      error: eventsError,
    },
    {
      data: responses,
      error: responsesError,
    },
    {
      data: assessmentFeedback,
      error: assessmentFeedbackError,
    },
  ] =
    await Promise.all([
      supabase
        .from(
          "study_behavior_events",
        )
        .select(
          "event_type, topic_ids, original_starts_at, original_ends_at, resulting_starts_at, resulting_ends_at, metadata, created_at",
        )
        .eq(
          "user_id",
          userId,
        )
        .gte(
          "created_at",
          since,
        )
        .order(
          "created_at",
          {
            ascending: true,
          },
        )
        .limit(500),

      supabase
        .from(
          "study_responses",
        )
        .select(
          "topic_id, score, answered_at",
        )
        .eq(
          "user_id",
          userId,
        )
        .gte(
          "answered_at",
          since,
        )
        .order(
          "answered_at",
          {
            ascending: true,
          },
        )
        .limit(1000),

      supabase
        .from(
          "assessment_feedback",
        )
        .select(
          "assessment_kind, score_percent, preparedness_percent, difficulty_percent, quiz_similarity_percent, assistant_helpfulness_percent, study_hours, difference_notes, response_status, created_at",
        )
        .eq(
          "user_id",
          userId,
        )
        .gte(
          "created_at",
          since,
        )
        .order(
          "created_at",
          {
            ascending: false,
          },
        )
        .limit(60),
    ]);

  if (eventsError) {
    throw eventsError;
  }

  if (responsesError) {
    throw responsesError;
  }

  if (
    assessmentFeedbackError
  ) {
    throw assessmentFeedbackError;
  }

  const behavioralProfile =
    derivePlannerLearning({
      events:
        (events ?? []).map(
          (event) => ({
            event_type:
              event.event_type,
            topic_ids:
              event.topic_ids,
            original_starts_at:
              event.original_starts_at ??
              null,
            original_ends_at:
              event.original_ends_at ??
              null,
            resulting_starts_at:
              event.resulting_starts_at ??
              null,
            resulting_ends_at:
              event.resulting_ends_at ??
              null,
            metadata:
              event.metadata,
            created_at:
              event.created_at,
          }),
        ),
      responses:
        (responses ?? []).map(
          (response) => ({
            topic_id:
              response.topic_id ??
              null,
            score:
              Number(
                response.score ?? 0,
              ),
            answered_at:
              response.answered_at,
          }),
        ),
      timeZone,
    });

  const assessmentLearning =
    deriveAssessmentLearning(
      assessmentFeedback ?? [],
    );

  let profile =
    behavioralProfile;

  if (
    assessmentLearning.sampleCount >
    0
  ) {
    const feedbackConfidence =
      clamp(
        assessmentLearning.sampleCount *
          0.3,
        0,
        0.9,
      );

    const effectiveMultiplier =
      1 +
      (
        assessmentLearning.studyLoadMultiplier -
        1
      ) *
        feedbackConfidence;

    const baseDefault =
      behavioralProfile.learned_default_minutes ??
      45;

    const learnedDefault =
      roundToFive(
        clamp(
          baseDefault *
            effectiveMultiplier,
          20,
          120,
        ),
      );

    const baseMax =
      behavioralProfile.learned_max_minutes ??
      Math.max(
        learnedDefault,
        60,
      );

    const maxMultiplier =
      1 +
      (
        effectiveMultiplier -
        1
      ) *
        0.7;

    const learnedMax =
      roundToFive(
        clamp(
          Math.max(
            learnedDefault,
            baseMax *
              maxMultiplier,
          ),
          25,
          180,
        ),
      );

    const combinedConfidence =
      1 -
      (
        1 -
        behavioralProfile.confidence
      ) *
        (
          1 -
          feedbackConfidence
        );

    profile = {
      ...behavioralProfile,
      learned_default_minutes:
        learnedDefault,
      learned_max_minutes:
        learnedMax,
      sample_count:
        behavioralProfile.sample_count +
        assessmentLearning.sampleCount,
      confidence:
        clamp(
          combinedConfidence,
          0,
          1,
        ),
      learned_at:
        new Date().toISOString(),
    };
  }

  const {
    error: saveError,
  } = await supabase
    .from(
      "planner_learning_profiles",
    )
    .upsert(
      {
        user_id:
          userId,
        ...profile,
        updated_at:
          new Date().toISOString(),
      },
      {
        onConflict:
          "user_id",
      },
    );

  if (saveError) {
    throw saveError;
  }

  return profile;
}
