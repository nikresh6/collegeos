-- Let new instructor study guides inherit a conservative course-level prior
-- from older guides that have already been judged against later real tests.

create or replace function public.apply_study_guide_course_prior(
  p_user_id uuid,
  p_course_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.assessment_sources as guide
  set
    predictive_reliability = round(prior.inherited_reliability, 3),
    coverage_weight = round(
      greatest(0.600, least(1.500, 1.200 * prior.inherited_reliability)),
      3
    )
  from lateral (
    select greatest(
      0.600,
      least(
        1.350,
        1.000 +
          (
            coalesce(
              sum(history.predictive_reliability * history.reliability_sample_count)
                / nullif(sum(history.reliability_sample_count), 0),
              1.000
            ) - 1.000
          )
          * (
            coalesce(sum(history.reliability_sample_count), 0)::numeric
            / (coalesce(sum(history.reliability_sample_count), 0) + 3.000)
          )
      )
    ) as inherited_reliability
    from public.assessment_sources as history
    where history.user_id = guide.user_id
      and history.course_id = guide.course_id
      and history.status = 'ready'
      and history.source_type = 'study_guide'
      and history.source_authority = 'instructor'
      and history.reliability_sample_count > 0
      and history.id <> guide.id
      and coalesce(history.assessment_date::timestamptz, history.created_at)
        <= coalesce(guide.assessment_date::timestamptz, guide.created_at)
  ) as prior
  where guide.user_id = p_user_id
    and guide.course_id = p_course_id
    and guide.status = 'ready'
    and guide.source_type = 'study_guide'
    and guide.source_authority = 'instructor'
    and guide.reliability_sample_count = 0;
end;
$$;

revoke all on function public.apply_study_guide_course_prior(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.apply_study_guide_course_prior(uuid, uuid)
  to service_role;

create or replace function public.apply_study_guide_course_prior_from_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'ready' then
    perform public.apply_study_guide_course_prior(new.user_id, new.course_id);
  end if;
  return new;
end;
$$;

create or replace function public.apply_study_guide_course_prior_from_topic_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_course_id uuid;
begin
  if tg_op = 'DELETE' then
    v_user_id := old.user_id;
    v_course_id := old.course_id;
  else
    v_user_id := new.user_id;
    v_course_id := new.course_id;
  end if;
  perform public.apply_study_guide_course_prior(v_user_id, v_course_id);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.apply_study_guide_course_prior_from_source()
  from public, anon, authenticated;
revoke all on function public.apply_study_guide_course_prior_from_topic_link()
  from public, anon, authenticated;

drop trigger if exists zz_apply_study_guide_course_prior_on_source
  on public.assessment_sources;
create trigger zz_apply_study_guide_course_prior_on_source
after insert or update of status, unit_id, assessment_date, source_type
on public.assessment_sources
for each row
execute function public.apply_study_guide_course_prior_from_source();

drop trigger if exists zz_apply_study_guide_course_prior_on_topic_link
  on public.assessment_source_topic_links;
create trigger zz_apply_study_guide_course_prior_on_topic_link
after insert or update or delete
on public.assessment_source_topic_links
for each row
execute function public.apply_study_guide_course_prior_from_topic_link();

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
    perform public.apply_study_guide_course_prior(scope.user_id, scope.course_id);
  end loop;
end
$$;
