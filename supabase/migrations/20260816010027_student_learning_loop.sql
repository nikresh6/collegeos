create table if not exists public.assessment_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  title text not null,
  source_type text not null check (source_type in ('past_exam','past_quiz','study_guide','practice_set','question_set')),
  file_name text,
  storage_path text,
  mime_type text,
  extracted_text text not null default '',
  analysis jsonb not null default '{}'::jsonb,
  question_count integer not null default 0 check (question_count >= 0),
  status text not null default 'uploaded' check (status in ('uploaded','analyzing','ready','error')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists assessment_sources_course_created_idx
  on public.assessment_sources (course_id, created_at desc);
create index if not exists assessment_sources_user_idx
  on public.assessment_sources (user_id);

alter table public.assessment_sources enable row level security;

create policy "Users can view own assessment sources"
  on public.assessment_sources for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Users can insert own assessment sources"
  on public.assessment_sources for insert to authenticated
  with check (
    (select auth.uid()) = user_id and exists (
      select 1 from public.courses c
      where c.id = course_id and c.user_id = (select auth.uid())
    )
  );
create policy "Users can update own assessment sources"
  on public.assessment_sources for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Users can delete own assessment sources"
  on public.assessment_sources for delete to authenticated
  using ((select auth.uid()) = user_id);

create table if not exists public.assessment_source_questions (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.assessment_sources(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  prompt text not null,
  choices jsonb not null default '[]'::jsonb,
  correct_answer text,
  question_type text not null default 'short_answer' check (question_type in ('multiple_choice','true_false','short_answer','essay','problem')),
  topic_hints text[] not null default '{}',
  professor_notes text,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists assessment_source_questions_course_idx
  on public.assessment_source_questions (course_id, created_at desc);
create index if not exists assessment_source_questions_source_idx
  on public.assessment_source_questions (source_id);
create index if not exists assessment_source_questions_user_idx
  on public.assessment_source_questions (user_id);

alter table public.assessment_source_questions enable row level security;

create policy "Users can view own assessment questions"
  on public.assessment_source_questions for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Users can insert own assessment questions"
  on public.assessment_source_questions for insert to authenticated
  with check (
    (select auth.uid()) = user_id and exists (
      select 1 from public.assessment_sources s
      where s.id = source_id and s.user_id = (select auth.uid()) and s.course_id = course_id
    )
  );
create policy "Users can update own assessment questions"
  on public.assessment_source_questions for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Users can delete own assessment questions"
  on public.assessment_source_questions for delete to authenticated
  using ((select auth.uid()) = user_id);

create table if not exists public.note_attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  note_id uuid not null references public.notes(id) on delete cascade,
  course_id uuid references public.courses(id) on delete set null,
  file_name text not null,
  storage_path text not null,
  mime_type text,
  size_bytes bigint,
  caption text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists note_attachments_note_idx
  on public.note_attachments (note_id, created_at);
create index if not exists note_attachments_user_idx
  on public.note_attachments (user_id);
create index if not exists note_attachments_course_idx
  on public.note_attachments (course_id) where course_id is not null;

alter table public.note_attachments enable row level security;

create policy "Users can view own note attachments"
  on public.note_attachments for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Users can insert own note attachments"
  on public.note_attachments for insert to authenticated
  with check (
    (select auth.uid()) = user_id and exists (
      select 1 from public.notes n
      where n.id = note_id and n.user_id = (select auth.uid())
    )
  );
create policy "Users can update own note attachments"
  on public.note_attachments for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Users can delete own note attachments"
  on public.note_attachments for delete to authenticated
  using ((select auth.uid()) = user_id);

create table if not exists public.student_progress (
  user_id uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  xp integer not null default 0 check (xp >= 0),
  current_streak integer not null default 0 check (current_streak >= 0),
  longest_streak integer not null default 0 check (longest_streak >= 0),
  last_completion_on date,
  updated_at timestamptz not null default now()
);

alter table public.student_progress enable row level security;

create policy "Users can view own progress"
  on public.student_progress for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Users can insert own progress"
  on public.student_progress for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Users can update own progress"
  on public.student_progress for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.assessment_sources to authenticated;
grant select, insert, update, delete on public.assessment_source_questions to authenticated;
grant select, insert, update, delete on public.note_attachments to authenticated;
grant select, insert, update on public.student_progress to authenticated;
