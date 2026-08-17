-- Guided Solve state is server-derived. Keep browser roles read-only and commit
-- each state transition under a row lock so retries/tabs cannot corrupt progress.

revoke all on public.assessment_sources
  from public, anon, authenticated;
revoke all on public.assessment_source_questions
  from public, anon, authenticated;
revoke all on public.assessment_source_topic_links
  from public, anon, authenticated;
revoke all on public.assessment_question_topic_links
  from public, anon, authenticated;
revoke all on public.assessment_feedback
  from public, anon, authenticated;

grant select, insert, update, delete on public.assessment_sources
  to authenticated;
grant select, insert, update, delete on public.assessment_source_questions
  to authenticated;
grant select, insert, update, delete on public.assessment_source_topic_links
  to authenticated;
grant select, insert, update, delete on public.assessment_question_topic_links
  to authenticated;
grant select, insert, update, delete on public.assessment_feedback
  to authenticated;

revoke all on public.solve_sessions
  from public, anon, authenticated;
revoke all on public.solve_attempts
  from public, anon, authenticated;
revoke all on public.solve_solution_keys
  from public, anon, authenticated;

grant select, delete on public.solve_sessions to authenticated;
grant select on public.solve_attempts to authenticated;
grant select, insert, update, delete on public.solve_sessions to service_role;
grant select, insert, update, delete on public.solve_attempts to service_role;
grant select, insert, update, delete on public.solve_solution_keys to service_role;

create or replace function public.create_solve_session_with_key(
  p_user_id uuid,
  p_course_id uuid,
  p_unit_id uuid,
  p_topic_id uuid,
  p_origin_kind text,
  p_origin_id uuid,
  p_prompt text,
  p_subject text,
  p_plan jsonb,
  p_final_answer text,
  p_verification jsonb,
  p_model text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session_id uuid;
  v_step_count integer;
begin
  if p_user_id is null or p_course_id is null then
    raise exception 'A user and course are required.';
  end if;

  if p_origin_kind not in (
    'manual',
    'study_question',
    'assessment_question',
    'note',
    'lecture',
    'material'
  ) then
    raise exception 'Unsupported solve origin.';
  end if;

  if p_origin_kind = 'manual' and p_origin_id is not null then
    raise exception 'A manual solve cannot reference an origin row.';
  end if;

  if p_origin_kind <> 'manual' and p_origin_id is null then
    raise exception 'This solve origin requires an origin row.';
  end if;

  if not exists (
    select 1
    from public.courses as owned_course
    where owned_course.id = p_course_id
      and owned_course.user_id = p_user_id
  ) then
    raise exception 'The course is not owned by this user.';
  end if;

  if p_unit_id is not null and not exists (
    select 1
    from public.course_units as owned_unit
    where owned_unit.id = p_unit_id
      and owned_unit.user_id = p_user_id
      and owned_unit.course_id = p_course_id
  ) then
    raise exception 'The unit is outside this course.';
  end if;

  if p_topic_id is not null and not exists (
    select 1
    from public.course_topics as owned_topic
    where owned_topic.id = p_topic_id
      and owned_topic.user_id = p_user_id
      and owned_topic.course_id = p_course_id
      and (p_unit_id is null or owned_topic.unit_id = p_unit_id)
  ) then
    raise exception 'The topic is outside this course or unit.';
  end if;

  if p_origin_id is not null then
    if p_origin_kind = 'study_question' and not exists (
      select 1 from public.study_questions as owned_question
      where owned_question.id = p_origin_id
        and owned_question.user_id = p_user_id
        and owned_question.course_id = p_course_id
    ) then
      raise exception 'The study question is outside this course.';
    elsif p_origin_kind = 'assessment_question' and not exists (
      select 1 from public.assessment_source_questions as owned_question
      where owned_question.id = p_origin_id
        and owned_question.user_id = p_user_id
        and owned_question.course_id = p_course_id
    ) then
      raise exception 'The assessment question is outside this course.';
    elsif p_origin_kind = 'note' and not exists (
      select 1 from public.notes as owned_note
      where owned_note.id = p_origin_id
        and owned_note.user_id = p_user_id
        and owned_note.course_id = p_course_id
    ) then
      raise exception 'The note is outside this course.';
    elsif p_origin_kind = 'lecture' and not exists (
      select 1 from public.lectures as owned_lecture
      where owned_lecture.id = p_origin_id
        and owned_lecture.user_id = p_user_id
        and owned_lecture.course_id = p_course_id
    ) then
      raise exception 'The lecture is outside this course.';
    elsif p_origin_kind = 'material' and not exists (
      select 1 from public.course_files as owned_material
      where owned_material.id = p_origin_id
        and owned_material.user_id = p_user_id
        and owned_material.course_id = p_course_id
    ) then
      raise exception 'The material is outside this course.';
    end if;
  end if;

  v_step_count := jsonb_array_length(coalesce(p_plan -> 'steps', '[]'::jsonb));
  if v_step_count < 1 then
    raise exception 'A solution plan needs at least one step.';
  end if;

  insert into public.solve_sessions (
    user_id,
    course_id,
    unit_id,
    topic_id,
    origin_kind,
    origin_id,
    prompt,
    subject,
    status,
    current_step,
    step_count,
    hint_count
  )
  values (
    p_user_id,
    p_course_id,
    p_unit_id,
    p_topic_id,
    p_origin_kind,
    p_origin_id,
    p_prompt,
    p_subject,
    'active',
    0,
    v_step_count,
    0
  )
  returning id into v_session_id;

  insert into public.solve_solution_keys (
    session_id,
    user_id,
    course_id,
    plan,
    final_answer,
    verification,
    model
  )
  values (
    v_session_id,
    p_user_id,
    p_course_id,
    p_plan,
    p_final_answer,
    p_verification,
    p_model
  );

  return v_session_id;
end;
$$;

create or replace function public.commit_solve_attempt(
  p_session_id uuid,
  p_user_id uuid,
  p_expected_step integer,
  p_response text,
  p_score numeric,
  p_correct boolean,
  p_feedback text,
  p_method text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_step_count integer;
  v_current integer;
  v_next integer;
  v_attempt integer;
  v_complete boolean;
  v_now timestamptz := now();
  v_verification jsonb;
begin
  select owned_session.step_count, private_key.verification
  into v_step_count, v_verification
  from public.solve_sessions as owned_session
  join public.solve_solution_keys as private_key
    on private_key.session_id = owned_session.id
   and private_key.user_id = owned_session.user_id
  where owned_session.id = p_session_id
    and owned_session.user_id = p_user_id
  for update of owned_session, private_key;

  if not found then raise exception 'Solve session not found.'; end if;

  v_current := coalesce((v_verification ->> 'currentStep')::integer, 0);
  if (v_verification ->> 'completedAt') is not null then
    return jsonb_build_object('conflict', true, 'complete', true);
  end if;
  if v_current <> p_expected_step then
    return jsonb_build_object('conflict', true, 'currentStep', v_current);
  end if;
  if p_method not in ('exact', 'numeric', 'semantic') then
    raise exception 'Invalid verification method.';
  end if;

  select coalesce(max(attempt_no), 0) + 1
  into v_attempt
  from public.solve_attempts
  where session_id = p_session_id
    and step_index = v_current;

  insert into public.solve_attempts (
    session_id, user_id, step_index, attempt_no, response, score,
    is_correct, feedback, hint_level, verification_method
  )
  values (
    p_session_id,
    p_user_id,
    v_current,
    v_attempt,
    left(coalesce(p_response, ''), 2400),
    greatest(0, least(1, coalesce(p_score, 0))),
    coalesce(p_correct, false),
    left(coalesce(p_feedback, ''), 600),
    0,
    p_method
  );

  if coalesce(p_correct, false) then
    v_next := least(v_step_count, v_current + 1);
    v_complete := v_next >= v_step_count;
    v_verification := v_verification || jsonb_build_object(
      'currentStep', v_next,
      'completedAt', case
        when v_complete then to_jsonb(v_now)
        else 'null'::jsonb
      end
    );

    update public.solve_solution_keys
    set verification = v_verification,
        updated_at = v_now
    where session_id = p_session_id
      and user_id = p_user_id;

    update public.solve_sessions
    set current_step = v_next,
        status = case when v_complete then 'completed' else 'active' end,
        completed_at = case when v_complete then v_now else null end,
        updated_at = v_now
    where id = p_session_id
      and user_id = p_user_id;
  end if;

  return jsonb_build_object(
    'conflict', false,
    'attemptNo', v_attempt,
    'currentStep', coalesce(v_next, v_current),
    'complete', coalesce(v_complete, false)
  );
end;
$$;

create or replace function public.commit_solve_hint(
  p_session_id uuid,
  p_user_id uuid,
  p_expected_step integer,
  p_hints jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current integer;
  v_level integer;
  v_attempt integer;
  v_hint_count integer;
  v_hint text;
  v_now timestamptz := now();
  v_verification jsonb;
begin
  select private_key.verification
  into v_verification
  from public.solve_sessions as owned_session
  join public.solve_solution_keys as private_key
    on private_key.session_id = owned_session.id
   and private_key.user_id = owned_session.user_id
  where owned_session.id = p_session_id
    and owned_session.user_id = p_user_id
  for update of owned_session, private_key;

  if not found then raise exception 'Solve session not found.'; end if;
  v_current := coalesce((v_verification ->> 'currentStep')::integer, 0);
  if (v_verification ->> 'completedAt') is not null then
    return jsonb_build_object('conflict', true, 'complete', true);
  end if;
  if v_current <> p_expected_step then
    return jsonb_build_object('conflict', true, 'currentStep', v_current);
  end if;
  if jsonb_typeof(p_hints) <> 'array' or jsonb_array_length(p_hints) < 1 then
    raise exception 'Hints are required.';
  end if;

  select least(3, coalesce(max(hint_level), 0) + 1),
         coalesce(max(attempt_no), 0) + 1
  into v_level, v_attempt
  from public.solve_attempts
  where session_id = p_session_id
    and step_index = v_current;

  v_hint := coalesce(
    p_hints ->> least(v_level - 1, jsonb_array_length(p_hints) - 1),
    'Focus on the single move requested by this step.'
  );

  insert into public.solve_attempts (
    session_id, user_id, step_index, attempt_no, response, score,
    is_correct, feedback, hint_level, verification_method
  )
  values (
    p_session_id, p_user_id, v_current, v_attempt, '', 0,
    false, left(v_hint, 600), v_level, 'hint'
  );

  v_hint_count := coalesce((v_verification ->> 'hintCount')::integer, 0) + 1;
  v_verification := v_verification || jsonb_build_object('hintCount', v_hint_count);

  update public.solve_solution_keys
  set verification = v_verification,
      updated_at = v_now
  where session_id = p_session_id
    and user_id = p_user_id;

  update public.solve_sessions
  set hint_count = v_hint_count,
      updated_at = v_now
  where id = p_session_id
    and user_id = p_user_id;

  return jsonb_build_object(
    'conflict', false,
    'hint', v_hint,
    'hintLevel', v_level
  );
end;
$$;

create or replace function public.commit_solve_reveal(
  p_session_id uuid,
  p_user_id uuid,
  p_confirm boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_step_count integer;
  v_current integer;
  v_attempt integer;
  v_early boolean;
  v_now timestamptz := now();
  v_completed_at timestamptz;
  v_revealed_at timestamptz;
  v_verification jsonb;
begin
  select owned_session.step_count, private_key.verification
  into v_step_count, v_verification
  from public.solve_sessions as owned_session
  join public.solve_solution_keys as private_key
    on private_key.session_id = owned_session.id
   and private_key.user_id = owned_session.user_id
  where owned_session.id = p_session_id
    and owned_session.user_id = p_user_id
  for update of owned_session, private_key;

  if not found then raise exception 'Solve session not found.'; end if;
  v_current := coalesce((v_verification ->> 'currentStep')::integer, 0);
  v_early := (v_verification ->> 'completedAt') is null
    and v_current < v_step_count;

  if v_early and not coalesce(p_confirm, false) then
    return jsonb_build_object('requiresConfirmation', true);
  end if;

  v_completed_at := coalesce(
    (v_verification ->> 'completedAt')::timestamptz,
    v_now
  );
  v_revealed_at := coalesce(
    (v_verification ->> 'answerRevealedAt')::timestamptz,
    v_now
  );

  if v_early then
    select coalesce(max(attempt_no), 0) + 1
    into v_attempt
    from public.solve_attempts
    where session_id = p_session_id
      and step_index = v_current;

    insert into public.solve_attempts (
      session_id, user_id, step_index, attempt_no, response, score,
      is_correct, feedback, hint_level, verification_method
    )
    values (
      p_session_id, p_user_id, v_current, v_attempt, '', 0, false,
      'Answer revealed before all guided steps were completed.', 3, 'reveal'
    );
  end if;

  v_verification := v_verification || jsonb_build_object(
    'currentStep', v_step_count,
    'completedAt', v_completed_at,
    'answerRevealedAt', v_revealed_at
  );

  update public.solve_solution_keys
  set verification = v_verification,
      updated_at = v_now
  where session_id = p_session_id
    and user_id = p_user_id;

  update public.solve_sessions
  set status = 'completed',
      current_step = v_step_count,
      completed_at = v_completed_at,
      answer_revealed_at = v_revealed_at,
      updated_at = v_now
  where id = p_session_id
    and user_id = p_user_id;

  return jsonb_build_object('revealedEarly', v_early);
end;
$$;

create or replace function public.enforce_assessment_topic_unit_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_source_unit_id uuid;
  v_topic_unit_id uuid;
begin
  select source.unit_id
  into v_source_unit_id
  from public.assessment_sources as source
  where source.id = new.source_id
    and source.user_id = new.user_id
    and source.course_id = new.course_id
  for share;

  select topic.unit_id
  into v_topic_unit_id
  from public.course_topics as topic
  where topic.id = new.topic_id
    and topic.user_id = new.user_id
    and topic.course_id = new.course_id
  for share;

  if v_source_unit_id is not null
     and v_topic_unit_id is distinct from v_source_unit_id then
    raise exception 'Assessment evidence cannot link outside its selected unit.';
  end if;

  return new;
end;
$$;

create or replace function public.enforce_assessment_question_topic_unit_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_source_unit_id uuid;
  v_topic_unit_id uuid;
begin
  select source.unit_id
  into v_source_unit_id
  from public.assessment_source_questions as question
  join public.assessment_sources as source
    on source.id = question.source_id
   and source.user_id = question.user_id
   and source.course_id = question.course_id
  where question.id = new.question_id
    and question.user_id = new.user_id
    and question.course_id = new.course_id
  for share of source;

  select topic.unit_id
  into v_topic_unit_id
  from public.course_topics as topic
  where topic.id = new.topic_id
    and topic.user_id = new.user_id
    and topic.course_id = new.course_id
  for share;

  if v_source_unit_id is not null
     and v_topic_unit_id is distinct from v_source_unit_id then
    raise exception 'Assessment question evidence cannot link outside its selected unit.';
  end if;

  return new;
end;
$$;

create or replace function public.enforce_assessment_topic_unit_update_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.unit_id is not distinct from old.unit_id then
    return new;
  end if;

  if exists (
    select 1
    from public.assessment_source_topic_links as source_link
    join public.assessment_sources as source
      on source.id = source_link.source_id
     and source.user_id = source_link.user_id
     and source.course_id = source_link.course_id
    where source_link.topic_id = new.id
      and source_link.user_id = new.user_id
      and source_link.course_id = new.course_id
      and source.unit_id is not null
      and source.unit_id is distinct from new.unit_id
  ) or exists (
    select 1
    from public.assessment_question_topic_links as question_link
    join public.assessment_source_questions as question
      on question.id = question_link.question_id
     and question.user_id = question_link.user_id
     and question.course_id = question_link.course_id
    join public.assessment_sources as source
      on source.id = question.source_id
     and source.user_id = question.user_id
     and source.course_id = question.course_id
    where question_link.topic_id = new.id
      and question_link.user_id = new.user_id
      and question_link.course_id = new.course_id
      and source.unit_id is not null
      and source.unit_id is distinct from new.unit_id
  ) then
    raise exception 'Remove or relink scoped assessment evidence before moving this topic to another unit.';
  end if;

  return new;
end;
$$;

create or replace function public.enforce_assessment_question_scope_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.source_id is distinct from old.source_id
     or new.user_id is distinct from old.user_id
     or new.course_id is distinct from old.course_id then
    raise exception 'An assessment question cannot be moved to another source, course, or user.';
  end if;

  return new;
end;
$$;

create or replace function public.enforce_assessment_source_unit_update_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.unit_id is not distinct from old.unit_id or new.unit_id is null then
    return new;
  end if;

  if exists (
    select 1
    from public.assessment_source_topic_links as source_link
    join public.course_topics as topic
      on topic.id = source_link.topic_id
     and topic.user_id = source_link.user_id
     and topic.course_id = source_link.course_id
    where source_link.source_id = new.id
      and source_link.user_id = new.user_id
      and source_link.course_id = new.course_id
      and topic.unit_id is distinct from new.unit_id
  ) or exists (
    select 1
    from public.assessment_question_topic_links as question_link
    join public.assessment_source_questions as question
      on question.id = question_link.question_id
     and question.user_id = question_link.user_id
     and question.course_id = question_link.course_id
    join public.course_topics as topic
      on topic.id = question_link.topic_id
     and topic.user_id = question_link.user_id
     and topic.course_id = question_link.course_id
    where question.source_id = new.id
      and question_link.user_id = new.user_id
      and question_link.course_id = new.course_id
      and topic.unit_id is distinct from new.unit_id
  ) then
    raise exception 'Move or remove out-of-unit assessment topic links before changing the source unit.';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_assessment_source_topic_unit_scope
  on public.assessment_source_topic_links;
create trigger enforce_assessment_source_topic_unit_scope
before insert or update on public.assessment_source_topic_links
for each row execute function public.enforce_assessment_topic_unit_scope();

drop trigger if exists enforce_assessment_question_topic_unit_scope
  on public.assessment_question_topic_links;
create trigger enforce_assessment_question_topic_unit_scope
before insert or update on public.assessment_question_topic_links
for each row execute function public.enforce_assessment_question_topic_unit_scope();

drop trigger if exists enforce_assessment_source_unit_update_scope
  on public.assessment_sources;
create trigger enforce_assessment_source_unit_update_scope
before update of unit_id on public.assessment_sources
for each row execute function public.enforce_assessment_source_unit_update_scope();

drop trigger if exists enforce_assessment_topic_unit_update_scope
  on public.course_topics;
create trigger enforce_assessment_topic_unit_update_scope
before update of unit_id on public.course_topics
for each row execute function public.enforce_assessment_topic_unit_update_scope();

drop trigger if exists enforce_assessment_question_scope_immutable
  on public.assessment_source_questions;
create trigger enforce_assessment_question_scope_immutable
before update of source_id, user_id, course_id
on public.assessment_source_questions
for each row execute function public.enforce_assessment_question_scope_immutable();

revoke all on function public.enforce_assessment_topic_unit_scope()
  from public, anon, authenticated;
revoke all on function public.enforce_assessment_question_topic_unit_scope()
  from public, anon, authenticated;
revoke all on function public.enforce_assessment_source_unit_update_scope()
  from public, anon, authenticated;
revoke all on function public.enforce_assessment_topic_unit_update_scope()
  from public, anon, authenticated;
revoke all on function public.enforce_assessment_question_scope_immutable()
  from public, anon, authenticated;

revoke all on function public.create_solve_session_with_key(
  uuid, uuid, uuid, uuid, text, uuid, text, text, jsonb, text, jsonb, text
) from public, anon, authenticated;
revoke all on function public.commit_solve_attempt(
  uuid, uuid, integer, text, numeric, boolean, text, text
) from public, anon, authenticated;
revoke all on function public.commit_solve_hint(
  uuid, uuid, integer, jsonb
) from public, anon, authenticated;
revoke all on function public.commit_solve_reveal(
  uuid, uuid, boolean
) from public, anon, authenticated;

grant execute on function public.create_solve_session_with_key(
  uuid, uuid, uuid, uuid, text, uuid, text, text, jsonb, text, jsonb, text
) to service_role;
grant execute on function public.commit_solve_attempt(
  uuid, uuid, integer, text, numeric, boolean, text, text
) to service_role;
grant execute on function public.commit_solve_hint(
  uuid, uuid, integer, jsonb
) to service_role;
grant execute on function public.commit_solve_reveal(
  uuid, uuid, boolean
) to service_role;
