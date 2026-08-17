-- Intelligence evidence, topic grounding, and guided solver storage.
--
-- This migration intentionally enforces tenant and course consistency twice:
--   1. composite foreign keys protect every writer, including server workers;
--   2. RLS policies protect browser/API access for authenticated students.

-- ---------------------------------------------------------------------------
-- Shared composite identities used by course-scoped foreign keys.
-- ---------------------------------------------------------------------------

create unique index if not exists courses_id_user_id_scope_uidx
  on public.courses (id, user_id);

create unique index if not exists course_units_id_user_course_scope_uidx
  on public.course_units (id, user_id, course_id);

create unique index if not exists course_topics_id_user_course_scope_uidx
  on public.course_topics (id, user_id, course_id);

-- ---------------------------------------------------------------------------
-- Assessment evidence metadata and hardened ownership.
-- ---------------------------------------------------------------------------

alter table public.assessment_sources
  add column if not exists unit_id uuid,
  add column if not exists source_authority text,
  add column if not exists assessment_date date,
  add column if not exists style_weight numeric(4, 3),
  add column if not exists coverage_weight numeric(4, 3);

-- The original check predates practice exams.
alter table public.assessment_sources
  drop constraint if exists assessment_sources_source_type_check;

alter table public.assessment_sources
  add constraint assessment_sources_source_type_check
  check (
    source_type in (
      'past_exam',
      'past_quiz',
      'practice_exam',
      'study_guide',
      'practice_set',
      'question_set'
    )
  );

update public.assessment_sources
set
  source_authority = case
    when source_authority in ('instructor', 'textbook', 'student')
      then source_authority
    when source_authority = 'student_evidence'
      then 'student'
    else 'instructor'
  end,
  style_weight = coalesce(
    style_weight,
    case source_type
      when 'past_exam' then 1.000
      when 'past_quiz' then 0.900
      when 'practice_exam' then 0.900
      when 'study_guide' then 0.250
      when 'practice_set' then 0.650
      else 0.650
    end
  ),
  coverage_weight = coalesce(
    coverage_weight,
    case source_type
      when 'past_exam' then 0.900
      when 'past_quiz' then 0.750
      when 'practice_exam' then 1.100
      when 'study_guide' then 1.200
      when 'practice_set' then 1.000
      else 0.600
    end
  )
where
  source_authority is null
  or source_authority not in ('instructor', 'textbook', 'student')
  or style_weight is null
  or coverage_weight is null;

alter table public.assessment_sources
  alter column source_authority set default 'instructor',
  alter column source_authority set not null,
  alter column style_weight set default 0.650,
  alter column style_weight set not null,
  alter column coverage_weight set default 0.600,
  alter column coverage_weight set not null;

alter table public.assessment_sources
  drop constraint if exists assessment_sources_source_authority_check;

alter table public.assessment_sources
  add constraint assessment_sources_source_authority_check
  check (source_authority in ('instructor', 'textbook', 'student'));

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.assessment_sources'::regclass
      and conname = 'assessment_sources_style_weight_check'
  ) then
    alter table public.assessment_sources
      add constraint assessment_sources_style_weight_check
      check (style_weight >= 0 and style_weight <= 1.5);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.assessment_sources'::regclass
      and conname = 'assessment_sources_coverage_weight_check'
  ) then
    alter table public.assessment_sources
      add constraint assessment_sources_coverage_weight_check
      check (coverage_weight >= 0 and coverage_weight <= 1.5);
  end if;
end
$$;

create unique index if not exists assessment_sources_id_user_course_scope_uidx
  on public.assessment_sources (id, user_id, course_id);

create unique index if not exists assessment_source_questions_id_user_course_scope_uidx
  on public.assessment_source_questions (id, user_id, course_id);

create index if not exists assessment_sources_user_course_rank_idx
  on public.assessment_sources (
    user_id,
    course_id,
    unit_id,
    source_authority,
    created_at desc
  );

create index if not exists assessment_source_questions_user_course_source_idx
  on public.assessment_source_questions (
    user_id,
    course_id,
    source_id,
    created_at desc
  );

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.assessment_sources'::regclass
      and conname = 'assessment_sources_course_scope_fkey'
  ) then
    alter table public.assessment_sources
      add constraint assessment_sources_course_scope_fkey
      foreign key (course_id, user_id)
      references public.courses (id, user_id)
      on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.assessment_sources'::regclass
      and conname = 'assessment_sources_unit_scope_fkey'
  ) then
    alter table public.assessment_sources
      add constraint assessment_sources_unit_scope_fkey
      foreign key (unit_id, user_id, course_id)
      references public.course_units (id, user_id, course_id)
      on delete set null (unit_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.assessment_source_questions'::regclass
      and conname = 'assessment_source_questions_source_scope_fkey'
  ) then
    alter table public.assessment_source_questions
      add constraint assessment_source_questions_source_scope_fkey
      foreign key (source_id, user_id, course_id)
      references public.assessment_sources (id, user_id, course_id)
      on delete cascade;
  end if;
end
$$;

drop policy if exists "Users can insert own assessment sources"
  on public.assessment_sources;
drop policy if exists "Users can update own assessment sources"
  on public.assessment_sources;

create policy "Users can insert own assessment sources"
  on public.assessment_sources
  for insert
  to authenticated
  with check (
    (select auth.uid()) = assessment_sources.user_id
    and exists (
      select 1
      from public.courses as owned_course
      where owned_course.id = assessment_sources.course_id
        and owned_course.user_id = (select auth.uid())
    )
    and (
      assessment_sources.unit_id is null
      or exists (
        select 1
        from public.course_units as owned_unit
        where owned_unit.id = assessment_sources.unit_id
          and owned_unit.course_id = assessment_sources.course_id
          and owned_unit.user_id = (select auth.uid())
      )
    )
  );

create policy "Users can update own assessment sources"
  on public.assessment_sources
  for update
  to authenticated
  using (
    (select auth.uid()) = assessment_sources.user_id
  )
  with check (
    (select auth.uid()) = assessment_sources.user_id
    and exists (
      select 1
      from public.courses as owned_course
      where owned_course.id = assessment_sources.course_id
        and owned_course.user_id = (select auth.uid())
    )
    and (
      assessment_sources.unit_id is null
      or exists (
        select 1
        from public.course_units as owned_unit
        where owned_unit.id = assessment_sources.unit_id
          and owned_unit.course_id = assessment_sources.course_id
          and owned_unit.user_id = (select auth.uid())
      )
    )
  );

drop policy if exists "Users can insert own assessment questions"
  on public.assessment_source_questions;
drop policy if exists "Users can update own assessment questions"
  on public.assessment_source_questions;

create policy "Users can insert own assessment questions"
  on public.assessment_source_questions
  for insert
  to authenticated
  with check (
    (select auth.uid()) = assessment_source_questions.user_id
    and exists (
      select 1
      from public.assessment_sources as owned_source
      where owned_source.id = assessment_source_questions.source_id
        and owned_source.user_id = (select auth.uid())
        and owned_source.course_id = assessment_source_questions.course_id
    )
  );

create policy "Users can update own assessment questions"
  on public.assessment_source_questions
  for update
  to authenticated
  using (
    (select auth.uid()) = assessment_source_questions.user_id
  )
  with check (
    (select auth.uid()) = assessment_source_questions.user_id
    and exists (
      select 1
      from public.assessment_sources as owned_source
      where owned_source.id = assessment_source_questions.source_id
        and owned_source.user_id = (select auth.uid())
        and owned_source.course_id = assessment_source_questions.course_id
    )
  );

revoke all on public.assessment_sources from anon;
revoke all on public.assessment_source_questions from anon;
grant select, insert, update, delete on public.assessment_sources to authenticated;
grant select, insert, update, delete on public.assessment_source_questions to authenticated;

-- ---------------------------------------------------------------------------
-- Canonical topic mappings for whole sources and individual questions.
-- ---------------------------------------------------------------------------

create table if not exists public.assessment_source_topic_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  course_id uuid not null,
  source_id uuid not null,
  topic_id uuid not null,
  relevance_score numeric(4, 3) not null default 1.000
    check (relevance_score >= 0 and relevance_score <= 1),
  match_method text not null default 'ai'
    check (match_method in ('ai', 'explicit', 'unit_scope')),
  question_count integer not null default 0
    check (question_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assessment_source_topic_links_source_scope_fkey
    foreign key (source_id, user_id, course_id)
    references public.assessment_sources (id, user_id, course_id)
    on delete cascade,
  constraint assessment_source_topic_links_topic_scope_fkey
    foreign key (topic_id, user_id, course_id)
    references public.course_topics (id, user_id, course_id)
    on delete cascade,
  constraint assessment_source_topic_links_source_topic_key
    unique (source_id, topic_id)
);

create index if not exists assessment_source_topic_links_course_topic_idx
  on public.assessment_source_topic_links (
    user_id,
    course_id,
    topic_id,
    relevance_score desc
  );

create index if not exists assessment_source_topic_links_source_idx
  on public.assessment_source_topic_links (source_id, relevance_score desc);

alter table public.assessment_source_topic_links enable row level security;

drop policy if exists "Users can view own assessment source topic links"
  on public.assessment_source_topic_links;
drop policy if exists "Users can insert own assessment source topic links"
  on public.assessment_source_topic_links;
drop policy if exists "Users can update own assessment source topic links"
  on public.assessment_source_topic_links;
drop policy if exists "Users can delete own assessment source topic links"
  on public.assessment_source_topic_links;

create policy "Users can view own assessment source topic links"
  on public.assessment_source_topic_links
  for select
  to authenticated
  using ((select auth.uid()) = assessment_source_topic_links.user_id);

create policy "Users can insert own assessment source topic links"
  on public.assessment_source_topic_links
  for insert
  to authenticated
  with check (
    (select auth.uid()) = assessment_source_topic_links.user_id
    and exists (
      select 1
      from public.assessment_sources as owned_source
      where owned_source.id = assessment_source_topic_links.source_id
        and owned_source.user_id = (select auth.uid())
        and owned_source.course_id = assessment_source_topic_links.course_id
    )
    and exists (
      select 1
      from public.course_topics as owned_topic
      where owned_topic.id = assessment_source_topic_links.topic_id
        and owned_topic.user_id = (select auth.uid())
        and owned_topic.course_id = assessment_source_topic_links.course_id
    )
  );

create policy "Users can update own assessment source topic links"
  on public.assessment_source_topic_links
  for update
  to authenticated
  using ((select auth.uid()) = assessment_source_topic_links.user_id)
  with check (
    (select auth.uid()) = assessment_source_topic_links.user_id
    and exists (
      select 1
      from public.assessment_sources as owned_source
      where owned_source.id = assessment_source_topic_links.source_id
        and owned_source.user_id = (select auth.uid())
        and owned_source.course_id = assessment_source_topic_links.course_id
    )
    and exists (
      select 1
      from public.course_topics as owned_topic
      where owned_topic.id = assessment_source_topic_links.topic_id
        and owned_topic.user_id = (select auth.uid())
        and owned_topic.course_id = assessment_source_topic_links.course_id
    )
  );

create policy "Users can delete own assessment source topic links"
  on public.assessment_source_topic_links
  for delete
  to authenticated
  using ((select auth.uid()) = assessment_source_topic_links.user_id);

revoke all on public.assessment_source_topic_links from anon;
grant select, insert, update, delete
  on public.assessment_source_topic_links
  to authenticated;

create table if not exists public.assessment_question_topic_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  course_id uuid not null,
  question_id uuid not null,
  topic_id uuid not null,
  relevance_score numeric(4, 3) not null default 1.000
    check (relevance_score >= 0 and relevance_score <= 1),
  match_method text not null default 'ai'
    check (match_method in ('ai', 'explicit', 'unit_scope')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assessment_question_topic_links_question_scope_fkey
    foreign key (question_id, user_id, course_id)
    references public.assessment_source_questions (id, user_id, course_id)
    on delete cascade,
  constraint assessment_question_topic_links_topic_scope_fkey
    foreign key (topic_id, user_id, course_id)
    references public.course_topics (id, user_id, course_id)
    on delete cascade,
  constraint assessment_question_topic_links_question_topic_key
    unique (question_id, topic_id)
);

create index if not exists assessment_question_topic_links_course_topic_idx
  on public.assessment_question_topic_links (
    user_id,
    course_id,
    topic_id,
    relevance_score desc
  );

create index if not exists assessment_question_topic_links_question_idx
  on public.assessment_question_topic_links (question_id, relevance_score desc);

alter table public.assessment_question_topic_links enable row level security;

drop policy if exists "Users can view own assessment question topic links"
  on public.assessment_question_topic_links;
drop policy if exists "Users can insert own assessment question topic links"
  on public.assessment_question_topic_links;
drop policy if exists "Users can update own assessment question topic links"
  on public.assessment_question_topic_links;
drop policy if exists "Users can delete own assessment question topic links"
  on public.assessment_question_topic_links;

create policy "Users can view own assessment question topic links"
  on public.assessment_question_topic_links
  for select
  to authenticated
  using ((select auth.uid()) = assessment_question_topic_links.user_id);

create policy "Users can insert own assessment question topic links"
  on public.assessment_question_topic_links
  for insert
  to authenticated
  with check (
    (select auth.uid()) = assessment_question_topic_links.user_id
    and exists (
      select 1
      from public.assessment_source_questions as owned_question
      where owned_question.id = assessment_question_topic_links.question_id
        and owned_question.user_id = (select auth.uid())
        and owned_question.course_id = assessment_question_topic_links.course_id
    )
    and exists (
      select 1
      from public.course_topics as owned_topic
      where owned_topic.id = assessment_question_topic_links.topic_id
        and owned_topic.user_id = (select auth.uid())
        and owned_topic.course_id = assessment_question_topic_links.course_id
    )
  );

create policy "Users can update own assessment question topic links"
  on public.assessment_question_topic_links
  for update
  to authenticated
  using ((select auth.uid()) = assessment_question_topic_links.user_id)
  with check (
    (select auth.uid()) = assessment_question_topic_links.user_id
    and exists (
      select 1
      from public.assessment_source_questions as owned_question
      where owned_question.id = assessment_question_topic_links.question_id
        and owned_question.user_id = (select auth.uid())
        and owned_question.course_id = assessment_question_topic_links.course_id
    )
    and exists (
      select 1
      from public.course_topics as owned_topic
      where owned_topic.id = assessment_question_topic_links.topic_id
        and owned_topic.user_id = (select auth.uid())
        and owned_topic.course_id = assessment_question_topic_links.course_id
    )
  );

create policy "Users can delete own assessment question topic links"
  on public.assessment_question_topic_links
  for delete
  to authenticated
  using ((select auth.uid()) = assessment_question_topic_links.user_id);

revoke all on public.assessment_question_topic_links from anon;
grant select, insert, update, delete
  on public.assessment_question_topic_links
  to authenticated;

-- ---------------------------------------------------------------------------
-- Survey feedback can now record the topics covered and the topics that failed.
-- ---------------------------------------------------------------------------

alter table public.assessment_feedback
  add column if not exists covered_topic_ids uuid[],
  add column if not exists weak_topic_ids uuid[];

update public.assessment_feedback
set
  covered_topic_ids = coalesce(covered_topic_ids, '{}'::uuid[]),
  weak_topic_ids = coalesce(weak_topic_ids, '{}'::uuid[])
where covered_topic_ids is null or weak_topic_ids is null;

alter table public.assessment_feedback
  alter column covered_topic_ids set default '{}'::uuid[],
  alter column covered_topic_ids set not null,
  alter column weak_topic_ids set default '{}'::uuid[],
  alter column weak_topic_ids set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.assessment_feedback'::regclass
      and conname = 'assessment_feedback_topic_array_size_check'
  ) then
    alter table public.assessment_feedback
      add constraint assessment_feedback_topic_array_size_check
      check (
        cardinality(covered_topic_ids) <= 100
        and cardinality(weak_topic_ids) <= 100
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.assessment_feedback'::regclass
      and conname = 'assessment_feedback_weak_topics_subset_check'
  ) then
    alter table public.assessment_feedback
      add constraint assessment_feedback_weak_topics_subset_check
      check (weak_topic_ids <@ covered_topic_ids);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.assessment_feedback'::regclass
      and conname = 'assessment_feedback_course_scope_fkey'
  ) then
    alter table public.assessment_feedback
      add constraint assessment_feedback_course_scope_fkey
      foreign key (course_id, user_id)
      references public.courses (id, user_id)
      on delete cascade;
  end if;
end
$$;

create index if not exists assessment_feedback_covered_topics_gin_idx
  on public.assessment_feedback using gin (covered_topic_ids);

create index if not exists assessment_feedback_weak_topics_gin_idx
  on public.assessment_feedback using gin (weak_topic_ids);

drop policy if exists "Users can insert own assessment feedback"
  on public.assessment_feedback;
drop policy if exists "Users can update own assessment feedback"
  on public.assessment_feedback;

create policy "Users can insert own assessment feedback"
  on public.assessment_feedback
  for insert
  to authenticated
  with check (
    (select auth.uid()) = assessment_feedback.user_id
    and exists (
      select 1
      from public.courses as owned_course
      where owned_course.id = assessment_feedback.course_id
        and owned_course.user_id = (select auth.uid())
    )
    and exists (
      select 1
      from public.course_grade_items as owned_grade_item
      where owned_grade_item.id = assessment_feedback.grade_item_id
        and owned_grade_item.user_id = (select auth.uid())
        and owned_grade_item.course_id = assessment_feedback.course_id
    )
    and (
      assessment_feedback.category_id is null
      or exists (
        select 1
        from public.grading_categories as owned_category
        where owned_category.id = assessment_feedback.category_id
          and owned_category.user_id = (select auth.uid())
          and owned_category.course_id = assessment_feedback.course_id
      )
    )
    and not exists (
      select 1
      from unnest(assessment_feedback.covered_topic_ids) as covered(topic_id)
      where not exists (
        select 1
        from public.course_topics as owned_topic
        where owned_topic.id = covered.topic_id
          and owned_topic.user_id = (select auth.uid())
          and owned_topic.course_id = assessment_feedback.course_id
      )
    )
    and not exists (
      select 1
      from unnest(assessment_feedback.weak_topic_ids) as weak(topic_id)
      where not exists (
        select 1
        from public.course_topics as owned_topic
        where owned_topic.id = weak.topic_id
          and owned_topic.user_id = (select auth.uid())
          and owned_topic.course_id = assessment_feedback.course_id
      )
    )
  );

create policy "Users can update own assessment feedback"
  on public.assessment_feedback
  for update
  to authenticated
  using ((select auth.uid()) = assessment_feedback.user_id)
  with check (
    (select auth.uid()) = assessment_feedback.user_id
    and exists (
      select 1
      from public.courses as owned_course
      where owned_course.id = assessment_feedback.course_id
        and owned_course.user_id = (select auth.uid())
    )
    and exists (
      select 1
      from public.course_grade_items as owned_grade_item
      where owned_grade_item.id = assessment_feedback.grade_item_id
        and owned_grade_item.user_id = (select auth.uid())
        and owned_grade_item.course_id = assessment_feedback.course_id
    )
    and (
      assessment_feedback.category_id is null
      or exists (
        select 1
        from public.grading_categories as owned_category
        where owned_category.id = assessment_feedback.category_id
          and owned_category.user_id = (select auth.uid())
          and owned_category.course_id = assessment_feedback.course_id
      )
    )
    and not exists (
      select 1
      from unnest(assessment_feedback.covered_topic_ids) as covered(topic_id)
      where not exists (
        select 1
        from public.course_topics as owned_topic
        where owned_topic.id = covered.topic_id
          and owned_topic.user_id = (select auth.uid())
          and owned_topic.course_id = assessment_feedback.course_id
      )
    )
    and not exists (
      select 1
      from unnest(assessment_feedback.weak_topic_ids) as weak(topic_id)
      where not exists (
        select 1
        from public.course_topics as owned_topic
        where owned_topic.id = weak.topic_id
          and owned_topic.user_id = (select auth.uid())
          and owned_topic.course_id = assessment_feedback.course_id
      )
    )
  );

revoke all on public.assessment_feedback from anon;
grant select, insert, update, delete on public.assessment_feedback to authenticated;

-- ---------------------------------------------------------------------------
-- Guided solver. Answer keys are deliberately not exposed through the Data API
-- to either anon or authenticated roles. A server route must verify ownership
-- through solve_sessions before reading a solution key with the service role.
-- ---------------------------------------------------------------------------

create table if not exists public.solve_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  course_id uuid not null,
  unit_id uuid,
  topic_id uuid,
  origin_kind text not null default 'manual'
    check (
      origin_kind in (
        'manual',
        'study_question',
        'assessment_question',
        'note',
        'lecture',
        'material'
      )
    ),
  origin_id uuid,
  prompt text not null check (length(btrim(prompt)) > 0),
  subject text,
  status text not null default 'active'
    check (status in ('active', 'completed', 'abandoned', 'error')),
  current_step integer not null default 0 check (current_step >= 0),
  step_count integer not null default 1 check (step_count >= 1),
  hint_count integer not null default 0 check (hint_count >= 0),
  answer_revealed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint solve_sessions_course_scope_fkey
    foreign key (course_id, user_id)
    references public.courses (id, user_id)
    on delete cascade,
  constraint solve_sessions_unit_scope_fkey
    foreign key (unit_id, user_id, course_id)
    references public.course_units (id, user_id, course_id)
    on delete set null (unit_id),
  constraint solve_sessions_topic_scope_fkey
    foreign key (topic_id, user_id, course_id)
    references public.course_topics (id, user_id, course_id)
    on delete set null (topic_id)
);

create unique index if not exists solve_sessions_id_user_course_scope_uidx
  on public.solve_sessions (id, user_id, course_id);

create unique index if not exists solve_sessions_id_user_scope_uidx
  on public.solve_sessions (id, user_id);

create index if not exists solve_sessions_user_course_created_idx
  on public.solve_sessions (user_id, course_id, created_at desc);

create index if not exists solve_sessions_origin_idx
  on public.solve_sessions (origin_kind, origin_id)
  where origin_id is not null;

alter table public.solve_sessions enable row level security;

drop policy if exists "Users can view own solve sessions"
  on public.solve_sessions;
drop policy if exists "Users can insert own solve sessions"
  on public.solve_sessions;
drop policy if exists "Users can update own solve sessions"
  on public.solve_sessions;
drop policy if exists "Users can delete own solve sessions"
  on public.solve_sessions;

create policy "Users can view own solve sessions"
  on public.solve_sessions
  for select
  to authenticated
  using ((select auth.uid()) = solve_sessions.user_id);

create policy "Users can insert own solve sessions"
  on public.solve_sessions
  for insert
  to authenticated
  with check (
    (select auth.uid()) = solve_sessions.user_id
    and exists (
      select 1 from public.courses as owned_course
      where owned_course.id = solve_sessions.course_id
        and owned_course.user_id = (select auth.uid())
    )
    and (
      solve_sessions.unit_id is null
      or exists (
        select 1 from public.course_units as owned_unit
        where owned_unit.id = solve_sessions.unit_id
          and owned_unit.user_id = (select auth.uid())
          and owned_unit.course_id = solve_sessions.course_id
      )
    )
    and (
      solve_sessions.topic_id is null
      or exists (
        select 1 from public.course_topics as owned_topic
        where owned_topic.id = solve_sessions.topic_id
          and owned_topic.user_id = (select auth.uid())
          and owned_topic.course_id = solve_sessions.course_id
          and (
            solve_sessions.unit_id is null
            or owned_topic.unit_id = solve_sessions.unit_id
          )
      )
    )
    and (
      solve_sessions.origin_id is null
      or (
        solve_sessions.origin_kind = 'study_question'
        and exists (
          select 1 from public.study_questions as owned_question
          where owned_question.id = solve_sessions.origin_id
            and owned_question.user_id = (select auth.uid())
            and owned_question.course_id = solve_sessions.course_id
        )
      )
      or (
        solve_sessions.origin_kind = 'assessment_question'
        and exists (
          select 1 from public.assessment_source_questions as owned_question
          where owned_question.id = solve_sessions.origin_id
            and owned_question.user_id = (select auth.uid())
            and owned_question.course_id = solve_sessions.course_id
        )
      )
      or (
        solve_sessions.origin_kind = 'note'
        and exists (
          select 1 from public.notes as owned_note
          where owned_note.id = solve_sessions.origin_id
            and owned_note.user_id = (select auth.uid())
            and owned_note.course_id = solve_sessions.course_id
        )
      )
      or (
        solve_sessions.origin_kind = 'lecture'
        and exists (
          select 1 from public.lectures as owned_lecture
          where owned_lecture.id = solve_sessions.origin_id
            and owned_lecture.user_id = (select auth.uid())
            and owned_lecture.course_id = solve_sessions.course_id
        )
      )
      or (
        solve_sessions.origin_kind = 'material'
        and exists (
          select 1 from public.course_files as owned_material
          where owned_material.id = solve_sessions.origin_id
            and owned_material.user_id = (select auth.uid())
            and owned_material.course_id = solve_sessions.course_id
        )
      )
    )
  );

create policy "Users can update own solve sessions"
  on public.solve_sessions
  for update
  to authenticated
  using ((select auth.uid()) = solve_sessions.user_id)
  with check (
    (select auth.uid()) = solve_sessions.user_id
    and exists (
      select 1 from public.courses as owned_course
      where owned_course.id = solve_sessions.course_id
        and owned_course.user_id = (select auth.uid())
    )
    and (
      solve_sessions.unit_id is null
      or exists (
        select 1 from public.course_units as owned_unit
        where owned_unit.id = solve_sessions.unit_id
          and owned_unit.user_id = (select auth.uid())
          and owned_unit.course_id = solve_sessions.course_id
      )
    )
    and (
      solve_sessions.topic_id is null
      or exists (
        select 1 from public.course_topics as owned_topic
        where owned_topic.id = solve_sessions.topic_id
          and owned_topic.user_id = (select auth.uid())
          and owned_topic.course_id = solve_sessions.course_id
          and (
            solve_sessions.unit_id is null
            or owned_topic.unit_id = solve_sessions.unit_id
          )
      )
    )
    and (
      solve_sessions.origin_id is null
      or (
        solve_sessions.origin_kind = 'study_question'
        and exists (
          select 1 from public.study_questions as owned_question
          where owned_question.id = solve_sessions.origin_id
            and owned_question.user_id = (select auth.uid())
            and owned_question.course_id = solve_sessions.course_id
        )
      )
      or (
        solve_sessions.origin_kind = 'assessment_question'
        and exists (
          select 1 from public.assessment_source_questions as owned_question
          where owned_question.id = solve_sessions.origin_id
            and owned_question.user_id = (select auth.uid())
            and owned_question.course_id = solve_sessions.course_id
        )
      )
      or (
        solve_sessions.origin_kind = 'note'
        and exists (
          select 1 from public.notes as owned_note
          where owned_note.id = solve_sessions.origin_id
            and owned_note.user_id = (select auth.uid())
            and owned_note.course_id = solve_sessions.course_id
        )
      )
      or (
        solve_sessions.origin_kind = 'lecture'
        and exists (
          select 1 from public.lectures as owned_lecture
          where owned_lecture.id = solve_sessions.origin_id
            and owned_lecture.user_id = (select auth.uid())
            and owned_lecture.course_id = solve_sessions.course_id
        )
      )
      or (
        solve_sessions.origin_kind = 'material'
        and exists (
          select 1 from public.course_files as owned_material
          where owned_material.id = solve_sessions.origin_id
            and owned_material.user_id = (select auth.uid())
            and owned_material.course_id = solve_sessions.course_id
        )
      )
    )
  );

create policy "Users can delete own solve sessions"
  on public.solve_sessions
  for delete
  to authenticated
  using ((select auth.uid()) = solve_sessions.user_id);

revoke all on public.solve_sessions from anon;
grant select, insert, update, delete on public.solve_sessions to authenticated;

create table if not exists public.solve_attempts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  step_index integer not null default 0 check (step_index >= 0),
  attempt_no integer not null default 1 check (attempt_no >= 1),
  response text not null default '',
  score numeric(5, 4) not null default 0
    check (score >= 0 and score <= 1),
  is_correct boolean not null default false,
  feedback text not null default '',
  hint_level integer not null default 0
    check (hint_level >= 0 and hint_level <= 3),
  verification_method text not null default 'semantic'
    check (
      verification_method in (
        'exact',
        'numeric',
        'semantic',
        'hint',
        'reveal'
      )
    ),
  created_at timestamptz not null default now(),
  constraint solve_attempts_session_scope_fkey
    foreign key (session_id, user_id)
    references public.solve_sessions (id, user_id)
    on delete cascade
);

create index if not exists solve_attempts_user_created_idx
  on public.solve_attempts (user_id, created_at desc);

create index if not exists solve_attempts_session_step_idx
  on public.solve_attempts (session_id, step_index, attempt_no, created_at);

create unique index if not exists solve_attempts_session_step_attempt_uidx
  on public.solve_attempts (session_id, step_index, attempt_no);

alter table public.solve_attempts enable row level security;

drop policy if exists "Users can view own solve attempts"
  on public.solve_attempts;
drop policy if exists "Users can insert own solve attempts"
  on public.solve_attempts;
drop policy if exists "Users can update own solve attempts"
  on public.solve_attempts;
drop policy if exists "Users can delete own solve attempts"
  on public.solve_attempts;

create policy "Users can view own solve attempts"
  on public.solve_attempts
  for select
  to authenticated
  using (
    (select auth.uid()) = solve_attempts.user_id
    and exists (
      select 1 from public.solve_sessions as owned_session
      where owned_session.id = solve_attempts.session_id
        and owned_session.user_id = (select auth.uid())
    )
  );

create policy "Users can insert own solve attempts"
  on public.solve_attempts
  for insert
  to authenticated
  with check (
    (select auth.uid()) = solve_attempts.user_id
    and exists (
      select 1 from public.solve_sessions as owned_session
      where owned_session.id = solve_attempts.session_id
        and owned_session.user_id = (select auth.uid())
    )
  );

create policy "Users can update own solve attempts"
  on public.solve_attempts
  for update
  to authenticated
  using ((select auth.uid()) = solve_attempts.user_id)
  with check (
    (select auth.uid()) = solve_attempts.user_id
    and exists (
      select 1 from public.solve_sessions as owned_session
      where owned_session.id = solve_attempts.session_id
        and owned_session.user_id = (select auth.uid())
    )
  );

create policy "Users can delete own solve attempts"
  on public.solve_attempts
  for delete
  to authenticated
  using ((select auth.uid()) = solve_attempts.user_id);

revoke all on public.solve_attempts from anon;
grant select, insert, update, delete on public.solve_attempts to authenticated;

create table if not exists public.solve_solution_keys (
  session_id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  course_id uuid not null,
  plan jsonb not null,
  final_answer text not null,
  verification jsonb not null default '{}'::jsonb,
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint solve_solution_keys_session_scope_fkey
    foreign key (session_id, user_id, course_id)
    references public.solve_sessions (id, user_id, course_id)
    on delete cascade
);

create index if not exists solve_solution_keys_user_course_idx
  on public.solve_solution_keys (user_id, course_id, created_at desc);

alter table public.solve_solution_keys enable row level security;

-- There are intentionally no anon/authenticated RLS policies on answer keys.
revoke all on public.solve_solution_keys from public, anon, authenticated;
grant select, insert, update, delete on public.solve_solution_keys to service_role;
