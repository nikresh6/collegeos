-- Exam forecasting, mock-exam metadata, and self-correcting study-guide reliability.
--
-- Study guides start as strong prospective coverage evidence. After a later real
-- instructor exam or quiz from the same scoped unit is uploaded, their future
-- coverage influence is calibrated against how well their topic emphasis
-- matched the real assessment. One outcome only nudges the weight; repeated
-- outcomes are allowed to move it farther from the prior.

alter table public.assessment_sources
  add column if not exists predictive_reliability numeric(4, 3) not null default 1.000,
  add column if not exists reliability_sample_count integer not null default 0,
  add column if not exists reliability_updated_at timestamptz;

alter table public.assessment_sources
  drop constraint if exists assessment_sources_predictive_reliability_check,
  drop constraint if exists assessment_sources_reliability_sample_count_check;

alter table public.assessment_sources
  add constraint assessment_sources_predictive_reliability_check
    check (predictive_reliability >= 0.600 and predictive_reliability <= 1.350),
  add constraint assessment_sources_reliability_sample_count_check
    check (reliability_sample_count >= 0);

alter table public.study_sessions
  add column if not exists quiz_mode text not null default 'practice',
  add column if not exists format_spec jsonb not null default '{}'::jsonb,
  add column if not exists prediction_snapshot jsonb not null default '[]'::jsonb,
  add column if not exists teacher_format_note text;

alter table public.study_sessions
  drop constraint if exists study_sessions_quiz_mode_check,
  drop constraint if exists study_sessions_format_spec_object_check,
  drop constraint if exists study_sessions_prediction_snapshot_array_check;

alter table public.study_sessions
  add constraint study_sessions_quiz_mode_check
    check (quiz_mode in ('practice', 'mock_exam')),
  add constraint study_sessions_format_spec_object_check
    check (jsonb_typeof(format_spec) = 'object'),
  add constraint study_sessions_prediction_snapshot_array_check
    check (jsonb_typeof(prediction_snapshot) = 'array');

create index if not exists study_sessions_exam_mode_idx
  on public.study_sessions (user_id, course_id, quiz_mode, created_at desc);

create or replace function public.refresh_study_guide_reliability(
  p_user_id uuid,
  p_course_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  guide record;
  v_samples integer;
  v_similarity numeric;
  v_target numeric;
  v_shrink numeric;
  v_reliability numeric;
begin
  if p_user_id is null or p_course_id is null then
    return;
  end if;

  for guide in
    select
      source.id,
      source.unit_id,
      coalesce(source.assessment_date::timestamptz, source.created_at) as guide_at
    from public.assessment_sources as source
    where source.user_id = p_user_id
      and source.course_id = p_course_id
      and source.status = 'ready'
      and source.source_type = 'study_guide'
      and source.source_authority = 'instructor'
  loop
    -- Do not punish an unscoped guide by comparing it with an unrelated exam.
    -- Once the guide is attached to a unit, later real assessments from that
    -- exact unit become legitimate predictive outcomes.
    if guide.unit_id is null then
      update public.assessment_sources
      set predictive_reliability = 1.000,
          reliability_sample_count = 0,
          reliability_updated_at = null,
          coverage_weight = 1.200
      where id = guide.id
        and user_id = p_user_id
        and course_id = p_course_id;
      continue;
    end if;

    with later_tests as (
      select
        actual.id,
        case when actual.source_type = 'past_exam' then 1.000 else 0.850 end as outcome_weight
      from public.assessment_sources as actual
      where actual.user_id = p_user_id
        and actual.course_id = p_course_id
        and actual.status = 'ready'
        and actual.source_authority = 'instructor'
        and actual.source_type in ('past_exam', 'past_quiz')
        and actual.unit_id = guide.unit_id
        and coalesce(actual.assessment_date::timestamptz, actual.created_at) >= guide.guide_at
        and coalesce(actual.assessment_date::timestamptz, actual.created_at) <= guide.guide_at + interval '120 days'
    ),
    guide_weights as (
      select
        link.topic_id,
        greatest(0.050, link.relevance_score::numeric)
          * (1 + ln(1 + greatest(0, link.question_count))) as weight
      from public.assessment_source_topic_links as link
      where link.source_id = guide.id
        and link.user_id = p_user_id
        and link.course_id = p_course_id
    ),
    test_weights as (
      select
        test.id as test_id,
        link.topic_id,
        greatest(0.050, link.relevance_score::numeric)
          * (1 + ln(1 + greatest(0, link.question_count))) as weight,
        test.outcome_weight
      from later_tests as test
      join public.assessment_source_topic_links as link
        on link.source_id = test.id
       and link.user_id = p_user_id
       and link.course_id = p_course_id
    ),
    test_topics as (
      select
        test.id as test_id,
        topic.topic_id,
        test.outcome_weight
      from later_tests as test
      cross join lateral (
        select gw.topic_id from guide_weights as gw
        union
        select tw.topic_id from test_weights as tw where tw.test_id = test.id
      ) as topic
    ),
    pair_scores as (
      select
        universe.test_id,
        max(universe.outcome_weight) as outcome_weight,
        sum(least(coalesce(gw.weight, 0), coalesce(tw.weight, 0)))
          / nullif(sum(greatest(coalesce(gw.weight, 0), coalesce(tw.weight, 0))), 0) as similarity
      from test_topics as universe
      left join guide_weights as gw
        on gw.topic_id = universe.topic_id
      left join test_weights as tw
        on tw.test_id = universe.test_id
       and tw.topic_id = universe.topic_id
      group by universe.test_id
    )
    select
      count(*)::integer,
      sum(coalesce(similarity, 0) * outcome_weight)
        / nullif(sum(outcome_weight), 0)
    into v_samples, v_similarity
    from pair_scores;

    if coalesce(v_samples, 0) = 0 then
      v_reliability := 1.000;
      v_samples := 0;
    else
      -- Similarity 0 -> target 0.60, similarity 1 -> target 1.35.
      -- Bayesian-style shrinkage keeps one exam from overreacting.
      v_target := 0.600 + 0.750 * greatest(0, least(1, coalesce(v_similarity, 0)));
      v_shrink := v_samples::numeric / (v_samples + 2.000);
      v_reliability := greatest(
        0.600,
        least(1.350, 1.000 + (v_target - 1.000) * v_shrink)
      );
    end if;

    update public.assessment_sources
    set predictive_reliability = round(v_reliability, 3),
        reliability_sample_count = v_samples,
        reliability_updated_at = case when v_samples > 0 then now() else null end,
        coverage_weight = round(
          greatest(0.600, least(1.500, 1.200 * v_reliability)),
          3
        )
    where id = guide.id
      and user_id = p_user_id
      and course_id = p_course_id;
  end loop;
end;
$$;

revoke all on function public.refresh_study_guide_reliability(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.refresh_study_guide_reliability(uuid, uuid)
  to service_role;

create or replace function public.refresh_study_guide_reliability_from_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'ready' then
    perform public.refresh_study_guide_reliability(new.user_id, new.course_id);
  end if;
  return new;
end;
$$;

revoke all on function public.refresh_study_guide_reliability_from_source()
  from public, anon, authenticated;

drop trigger if exists refresh_study_guide_reliability_on_source
  on public.assessment_sources;
create trigger refresh_study_guide_reliability_on_source
after insert or update of status, unit_id, assessment_date, source_type
on public.assessment_sources
for each row
execute function public.refresh_study_guide_reliability_from_source();

create or replace function public.refresh_study_guide_reliability_from_topic_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_course_id uuid;
begin
  v_user_id := coalesce(new.user_id, old.user_id);
  v_course_id := coalesce(new.course_id, old.course_id);
  perform public.refresh_study_guide_reliability(v_user_id, v_course_id);
  return coalesce(new, old);
end;
$$;

revoke all on function public.refresh_study_guide_reliability_from_topic_link()
  from public, anon, authenticated;

drop trigger if exists refresh_study_guide_reliability_on_topic_link
  on public.assessment_source_topic_links;
create trigger refresh_study_guide_reliability_on_topic_link
after insert or update or delete
on public.assessment_source_topic_links
for each row
execute function public.refresh_study_guide_reliability_from_topic_link();

-- Backfill any existing instructor study guides using outcomes already present.
do $$
declare
  scope record;
begin
  for scope in
    select distinct user_id, course_id
    from public.assessment_sources
    where source_type = 'study_guide'
      and source_authority = 'instructor'
      and status = 'ready'
  loop
    perform public.refresh_study_guide_reliability(scope.user_id, scope.course_id);
  end loop;
end
$$;
