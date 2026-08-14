import type {
  SupabaseClient,
} from "@supabase/supabase-js";
import {
  derivePlannerLearning,
  type PlannerLearningProfile,
} from "./academic-intelligence";

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
    ]);

  if (eventsError) {
    throw eventsError;
  }

  if (responsesError) {
    throw responsesError;
  }

  const profile =
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