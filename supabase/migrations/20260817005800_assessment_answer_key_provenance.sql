-- Keep model-extracted answer candidates separate from canonical answer keys.
-- Only server-matched source text or an explicit student confirmation may set
-- correct_answer and become factual grounding for generated study content.

alter table public.assessment_source_questions
  add column if not exists answer_candidate text,
  add column if not exists answer_is_visible boolean not null default false,
  add column if not exists answer_is_verified boolean not null default false,
  add column if not exists answer_verification_method text not null default 'none',
  add column if not exists answer_evidence_quote text,
  add column if not exists answer_evidence_page text,
  add column if not exists answer_evidence_confidence numeric(4, 3),
  add column if not exists answer_verified_at timestamptz,
  add column if not exists answer_verified_by uuid
    references auth.users (id) on delete set null;

-- The original direct-question UI asked the signed-in student to enter an
-- answer only when they knew it. Preserve those rows as user confirmations.
update public.assessment_source_questions as question
set
  answer_candidate = null,
  answer_is_visible = false,
  answer_is_verified = true,
  answer_verification_method = 'user_confirmed',
  answer_evidence_quote = null,
  answer_evidence_page = null,
  answer_evidence_confidence = 1.000,
  answer_verified_at = coalesce(question.answer_verified_at, question.created_at),
  answer_verified_by = question.user_id
from public.assessment_sources as source
where source.id = question.source_id
  and source.user_id = question.user_id
  and source.course_id = question.course_id
  and source.source_type = 'question_set'
  and nullif(btrim(question.correct_answer), '') is not null;

-- Older uploaded-source answers were produced before quote-level provenance
-- existed. Retain them for review, but remove them from the canonical key.
update public.assessment_source_questions as question
set
  answer_candidate = coalesce(
    nullif(btrim(question.answer_candidate), ''),
    nullif(btrim(question.correct_answer), '')
  ),
  correct_answer = null,
  answer_is_visible = false,
  answer_is_verified = false,
  answer_verification_method = 'model_unverified',
  answer_verified_at = null,
  answer_verified_by = null
from public.assessment_sources as source
where source.id = question.source_id
  and source.user_id = question.user_id
  and source.course_id = question.course_id
  and source.source_type <> 'question_set'
  and nullif(btrim(question.correct_answer), '') is not null;

-- The pre-provenance analyzer also duplicated model answers inside the source
-- analysis JSON. Remove that secondary path so future code cannot accidentally
-- treat a historical model answer as a canonical key.
update public.assessment_sources as source
set analysis = jsonb_set(
  source.analysis,
  '{questions}',
  coalesce(
    (
      select jsonb_agg(
        case
          when jsonb_typeof(question_value) = 'object'
          then
            (question_value - 'correctAnswer' - 'answerIsVisible')
            || jsonb_build_object(
              'correctAnswer', '',
              'answerIsVisible', false
            )
          else question_value
        end
        order by question_position
      )
      from jsonb_array_elements(source.analysis -> 'questions')
        with ordinality
        as extracted_question(question_value, question_position)
    ),
    '[]'::jsonb
  ),
  true
)
where source.source_type <> 'question_set'
  and jsonb_typeof(source.analysis -> 'questions') = 'array';

update public.assessment_source_questions
set
  correct_answer = null,
  answer_candidate = null,
  answer_is_visible = false,
  answer_is_verified = false,
  answer_verification_method = 'none',
  answer_evidence_quote = null,
  answer_evidence_page = null,
  answer_evidence_confidence = null,
  answer_verified_at = null,
  answer_verified_by = null
where nullif(btrim(correct_answer), '') is null
  and nullif(btrim(answer_candidate), '') is null;

alter table public.assessment_source_questions
  drop constraint if exists assessment_questions_answer_method_check,
  drop constraint if exists assessment_questions_answer_state_check,
  drop constraint if exists assessment_questions_source_match_check,
  drop constraint if exists assessment_questions_user_confirmation_check,
  drop constraint if exists assessment_questions_answer_confidence_check;

alter table public.assessment_source_questions
  add constraint assessment_questions_answer_method_check
  check (
    answer_verification_method in (
      'none',
      'model_unverified',
      'source_text_match',
      'user_confirmed'
    )
  ),
  add constraint assessment_questions_answer_confidence_check
  check (
    answer_evidence_confidence is null
    or (
      answer_evidence_confidence >= 0
      and answer_evidence_confidence <= 1
    )
  ),
  add constraint assessment_questions_answer_state_check
  check (
    (
      answer_is_verified = false
      and correct_answer is null
      and answer_is_visible = false
      and answer_verification_method in ('none', 'model_unverified')
      and (
        (answer_verification_method = 'none' and answer_candidate is null)
        or (
          answer_verification_method = 'model_unverified'
          and nullif(btrim(answer_candidate), '') is not null
        )
      )
      and answer_verified_at is null
      and answer_verified_by is null
    )
    or
    (
      answer_is_verified = true
      and nullif(btrim(correct_answer), '') is not null
      and answer_candidate is null
      and answer_verification_method in (
        'source_text_match',
        'user_confirmed'
      )
      and answer_verified_at is not null
    )
  ),
  add constraint assessment_questions_source_match_check
  check (
    answer_verification_method <> 'source_text_match'
    or (
      answer_is_visible = true
      and nullif(btrim(answer_evidence_quote), '') is not null
      and answer_evidence_confidence is not null
      and answer_evidence_confidence >= 0.800
      and answer_verified_by is null
    )
  ),
  add constraint assessment_questions_user_confirmation_check
  check (
    answer_verification_method <> 'user_confirmed'
    or (
      answer_is_visible = false
      and answer_verified_by = user_id
      and answer_evidence_confidence is not null
      and answer_evidence_confidence = 1.000
    )
  );

-- A browser may explicitly confirm an answer for its own data, but only a
-- trusted server writer may claim that a quote was independently matched to
-- uploaded source text. This blocks callers from forging source_text_match by
-- writing the provenance columns through the Data API.
create or replace function public.enforce_source_matched_answer_writer()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.answer_verification_method = 'source_text_match'
    and current_user not in ('service_role', 'postgres', 'supabase_admin')
  then
    raise exception
      'source-matched answer provenance requires a trusted server writer'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_source_matched_answer_writer()
  from public, anon, authenticated;

drop trigger if exists enforce_source_matched_answer_writer
  on public.assessment_source_questions;

create trigger enforce_source_matched_answer_writer
before insert or update on public.assessment_source_questions
for each row
execute function public.enforce_source_matched_answer_writer();

grant select, insert on public.assessment_source_questions to service_role;

create index if not exists assessment_questions_verified_course_source_idx
  on public.assessment_source_questions (user_id, course_id, source_id)
  where answer_is_verified = true;

comment on column public.assessment_source_questions.correct_answer is
  'Canonical answer key. Non-null only for source_text_match or user_confirmed provenance.';
comment on column public.assessment_source_questions.answer_candidate is
  'Untrusted model-extracted answer retained for review; never factual grounding.';
comment on column public.assessment_source_questions.answer_is_verified is
  'True only after server source-text matching or explicit student confirmation.';
