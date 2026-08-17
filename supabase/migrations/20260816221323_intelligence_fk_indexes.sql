-- Cover the composite ownership foreign keys used by assessment intelligence and
-- Guided Solve. These indexes also keep cascades and ownership checks cheap as
-- a student's evidence history grows.
create index if not exists assessment_feedback_category_fk_idx
  on public.assessment_feedback (category_id);

create index if not exists assessment_feedback_course_scope_fk_idx
  on public.assessment_feedback (course_id, user_id);

create index if not exists assessment_sources_course_scope_fk_idx
  on public.assessment_sources (course_id, user_id);

create index if not exists assessment_sources_unit_scope_fk_idx
  on public.assessment_sources (unit_id, user_id, course_id);

create index if not exists assessment_source_questions_source_scope_fk_idx
  on public.assessment_source_questions (source_id, user_id, course_id);

create index if not exists assessment_source_topic_links_source_scope_fk_idx
  on public.assessment_source_topic_links (source_id, user_id, course_id);

create index if not exists assessment_source_topic_links_topic_scope_fk_idx
  on public.assessment_source_topic_links (topic_id, user_id, course_id);

create index if not exists assessment_question_topic_links_question_scope_fk_idx
  on public.assessment_question_topic_links (question_id, user_id, course_id);

create index if not exists assessment_question_topic_links_topic_scope_fk_idx
  on public.assessment_question_topic_links (topic_id, user_id, course_id);

create index if not exists solve_sessions_course_scope_fk_idx
  on public.solve_sessions (course_id, user_id);

create index if not exists solve_sessions_unit_scope_fk_idx
  on public.solve_sessions (unit_id, user_id, course_id);

create index if not exists solve_sessions_topic_scope_fk_idx
  on public.solve_sessions (topic_id, user_id, course_id);

create index if not exists solve_attempts_session_scope_fk_idx
  on public.solve_attempts (session_id, user_id);

create index if not exists solve_solution_keys_session_scope_fk_idx
  on public.solve_solution_keys (session_id, user_id, course_id);
