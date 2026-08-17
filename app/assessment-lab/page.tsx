"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, BrainCircuit, Check, ChevronRight, FileQuestion, Loader2, Plus, ScanSearch, Sparkles, Target, Upload, X } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { userConfirmedAnswerProvenance } from "../../lib/assessment-answer-provenance";
import { SchoolMark, useSchoolIdentity } from "../../components/school-identity";
import { SourceCapturePicker } from "../../components/source-capture";

type Course = { id: string; code: string; name: string; color: string };
type Unit = { id: string; course_id: string; name: string; position: number };
type Topic = { id: string; course_id: string; unit_id: string | null; name: string; position: number };
type Analysis = {
  summary?: string;
  testedSkills?: string[];
  questionStyle?: string[];
  difficultySignature?: string;
  trapPatterns?: string[];
  studyRecommendations?: string[];
};
type Source = {
  id: string;
  course_id: string;
  unit_id: string | null;
  title: string;
  source_type: string;
  source_authority: string;
  style_weight: number;
  coverage_weight: number;
  file_name: string | null;
  storage_path: string | null;
  status: string;
  question_count: number;
  analysis: Analysis;
  created_at: string;
};
type SourceQuestion = {
  id: string;
  prompt: string;
  position: number;
  answer_candidate: string | null;
  answer_is_verified: boolean;
  answer_verification_method: string;
  answer_evidence_quote: string | null;
  answer_evidence_page: string | null;
};

const sourceTypes = [
  ["past_exam", "Past exam"],
  ["past_quiz", "Past quiz"],
  ["practice_exam", "Practice test"],
  ["study_guide", "Study guide"],
  ["practice_set", "Practice set"],
] as const;

export default function AssessmentLabPage() {
  const router = useRouter();
  const { identity } = useSchoolIdentity();
  const [courses, setCourses] = useState<Course[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [courseId, setCourseId] = useState("");
  const [title, setTitle] = useState("");
  const [sourceType, setSourceType] = useState("past_exam");
  const [sourceAuthority, setSourceAuthority] = useState("instructor");
  const [assessmentDate, setAssessmentDate] = useState("");
  const [unitId, setUnitId] = useState("");
  const [topicIds, setTopicIds] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [selected, setSelected] = useState<Source | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [showQuestion, setShowQuestion] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [answerConfirmed, setAnswerConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return router.replace("/onboarding");
      const [
        { data: courseData, error: courseError },
        { data: unitData, error: unitError },
        { data: topicData, error: topicError },
        { data: sourceData, error: sourceError },
      ] = await Promise.all([
        supabase.from("courses").select("id, code, name, color").eq("user_id", session.user.id).is("archived_at", null).order("created_at"),
        supabase.from("course_units").select("id, course_id, name, position").eq("user_id", session.user.id).order("position"),
        supabase.from("course_topics").select("id, course_id, unit_id, name, position").eq("user_id", session.user.id).order("position"),
        supabase.from("assessment_sources").select("id, course_id, unit_id, title, source_type, source_authority, style_weight, coverage_weight, file_name, storage_path, status, question_count, analysis, created_at").eq("user_id", session.user.id).order("created_at", { ascending: false }),
      ]);
      if (courseError) throw courseError;
      if (unitError) throw unitError;
      if (topicError) throw topicError;
      if (sourceError) throw sourceError;
      const nextCourses = (courseData ?? []) as Course[];
      const nextSources = (sourceData ?? []) as Source[];
      setCourses(nextCourses);
      setUnits((unitData ?? []) as Unit[]);
      setTopics((topicData ?? []) as Topic[]);
      setSources(nextSources);
      setCourseId((current) => current || nextCourses[0]?.id || "");
      setSelected((current) => current || nextSources[0] || null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not open Exam Intelligence.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  // Loading authenticated remote state is the synchronization this effect owns.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const courseMap = useMemo(() => new Map(courses.map((course) => [course.id, course])), [courses]);
  const selectedCourse = courseMap.get(courseId);
  const courseUnits = useMemo(() => units.filter((unit) => unit.course_id === courseId), [units, courseId]);
  const courseTopics = useMemo(() => topics.filter((topic) => topic.course_id === courseId && (!unitId || topic.unit_id === unitId)), [topics, courseId, unitId]);
  const accent = selectedCourse?.color ?? identity.primary;
  const totalQuestions = sources.reduce((sum, source) => sum + Number(source.question_count || 0), 0);
  const coursesTrained = new Set(sources.map((source) => source.course_id)).size;

  async function analyze() {
    if (!file || !courseId || !title.trim()) return;
    try {
      setBusy(true);
      setMessage("");
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("You must be signed in.");
      const form = new FormData();
      form.set("file", file);
      form.set("courseId", courseId);
      form.set("title", title.trim());
      form.set("sourceType", sourceType);
      form.set("sourceAuthority", sourceAuthority);
      form.set("assessmentDate", assessmentDate);
      form.set("unitId", unitId);
      form.set("topicIds", JSON.stringify(topicIds));
      const response = await fetch("/api/assessment-lab/analyze", { method: "POST", headers: { Authorization: `Bearer ${session.access_token}` }, body: form });
      const payload = await response.json() as { ok?: boolean; source?: Source; error?: string };
      if (!response.ok || !payload.ok || !payload.source) throw new Error(payload.error || "Could not analyze this source.");
      setSources((current) => [payload.source as Source, ...current]);
      setSelected(payload.source);
      setFile(null);
      setTitle("");
      setAssessmentDate("");
      setTopicIds([]);
      setShowUpload(false);
      setMessage(`Learned ${payload.source.question_count} questions and the professor's testing pattern.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not analyze this source.");
    } finally {
      setBusy(false);
    }
  }

  async function saveQuestion() {
    if (!courseId || !question.trim()) return;
    if (topicIds.length === 0) {
      setMessage("Choose at least one topic so CollegeOS knows where this question belongs.");
      return;
    }
    try {
      setBusy(true);
      const answerProvenance = userConfirmedAnswerProvenance(
        answerConfirmed ? answer : "",
      );
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("You must be signed in.");
      const { data: source, error: sourceError } = await supabase.from("assessment_sources").insert({
        user_id: session.user.id,
        course_id: courseId,
        title: title.trim() || "Question from class",
        source_type: "question_set",
        source_authority: sourceAuthority,
        unit_id: unitId || null,
        style_weight: 0.65,
        coverage_weight: 0.6,
        analysis: { summary: "Question entered by the student as direct evidence of what this course tests.", testedSkills: [], questionStyle: ["Student-entered assessment question"], studyRecommendations: [] },
        question_count: 1,
        status: "analyzing",
      }).select("id, course_id, unit_id, title, source_type, source_authority, style_weight, coverage_weight, file_name, storage_path, status, question_count, analysis, created_at").single();
      if (sourceError) throw sourceError;
      const { data: savedQuestion, error: questionError } = await supabase.from("assessment_source_questions").insert({
        source_id: source.id,
        user_id: session.user.id,
        course_id: courseId,
        prompt: question.trim(),
        correct_answer: answerProvenance.correctAnswer,
        answer_candidate: answerProvenance.answerCandidate,
        answer_is_visible: answerProvenance.answerIsVisible,
        answer_is_verified: answerProvenance.answerIsVerified,
        answer_verification_method:
          answerProvenance.answerVerificationMethod,
        answer_evidence_quote: answerProvenance.answerEvidenceQuote,
        answer_evidence_page: answerProvenance.answerEvidencePage,
        answer_evidence_confidence:
          answerProvenance.answerEvidenceConfidence,
        answer_verified_at: answerProvenance.answerIsVerified
          ? new Date().toISOString()
          : null,
        answer_verified_by: answerProvenance.answerIsVerified
          ? session.user.id
          : null,
        question_type: "short_answer",
      }).select("id").single();
      if (questionError) throw questionError;
      if (topicIds.length) {
        const sourceLinks = topicIds.map((topicId) => ({
          source_id: source.id,
          user_id: session.user.id,
          course_id: courseId,
          topic_id: topicId,
          relevance_score: 1,
          match_method: "explicit",
          question_count: 1,
        }));
        const questionLinks = topicIds.map((topicId) => ({
          question_id: savedQuestion.id,
          user_id: session.user.id,
          course_id: courseId,
          topic_id: topicId,
          relevance_score: 1,
          match_method: "explicit",
        }));
        const [{ error: sourceLinkError }, { error: questionLinkError }] = await Promise.all([
          supabase.from("assessment_source_topic_links").insert(sourceLinks),
          supabase.from("assessment_question_topic_links").insert(questionLinks),
        ]);
        if (sourceLinkError) throw sourceLinkError;
        if (questionLinkError) throw questionLinkError;
      }
      const { data: readySource, error: readyError } = await supabase
        .from("assessment_sources")
        .update({ status: "ready" })
        .eq("id", source.id)
        .eq("user_id", session.user.id)
        .select("id, course_id, unit_id, title, source_type, source_authority, style_weight, coverage_weight, file_name, storage_path, status, question_count, analysis, created_at")
        .single();
      if (readyError) throw readyError;

      const normalized = readySource as Source;
      setSources((current) => [normalized, ...current]);
      setSelected(normalized);
      setQuestion("");
      setAnswer("");
      setAnswerConfirmed(false);
      setTitle("");
      setTopicIds([]);
      setShowQuestion(false);
      setMessage("Question saved. Future quizzes can now mirror it.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save this question.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <main className="flex min-h-screen items-center justify-center bg-[#080809] text-white/40"><Loader2 className="animate-spin" size={16} /></main>;

  return (
    <main className="min-h-screen bg-[#080809] px-4 pb-32 pt-6 text-[#F5F5F7] sm:px-8 lg:px-10 lg:pb-16">
      <div className="mx-auto max-w-[1280px]">
        <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button onClick={() => router.push("/")} className="flex items-center gap-2 rounded-full border border-white/[.07] bg-white/[.02] px-3.5 py-2.5 text-[12px] text-white/48"><ArrowLeft size={14} /> Home</button>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <button onClick={() => setShowQuestion(true)} className="flex items-center justify-center rounded-full border border-white/[.08] bg-white/[.025] px-3 py-2.5 text-[10px] text-white/65 sm:px-4 sm:text-[11px]"><Plus size={12} className="mr-2" />Add question</button>
            <button onClick={() => setShowUpload(true)} className="flex items-center justify-center rounded-full bg-white px-3 py-2.5 text-[10px] font-medium text-black sm:px-4 sm:text-[11px]"><Upload size={12} className="mr-2" />Upload source</button>
          </div>
        </div>

        <header className="mt-9 grid gap-7 border-b border-white/[.065] pb-8 sm:mt-12 sm:gap-8 sm:pb-10 lg:grid-cols-[1fr_420px] lg:items-end">
          <div>
            <div className="flex items-center gap-3"><SchoolMark size={40} quiet /><p className="text-[11px] font-semibold uppercase tracking-[.15em] text-white/38">Exam Intelligence</p></div>
            <h1 className="mt-5 max-w-4xl text-[40px] font-medium leading-[.95] tracking-[-.057em] sm:mt-6 sm:text-[64px]">Teach CollegeOS<br />how your professor tests.</h1>
            <p className="mt-4 max-w-2xl text-[13px] leading-6 text-white/42 sm:mt-5 sm:text-[15px] sm:leading-7 sm:text-white/44">Upload old tests, quizzes, study guides, or a quick photo. CollegeOS extracts the questions and learns the wording, difficulty, skills, and traps your next practice should imitate.</p>
          </div>
          <div className="grid grid-cols-3 gap-1.5 rounded-[20px] border border-white/[.07] bg-white/[.018] p-2 sm:gap-2 sm:rounded-[24px] sm:p-3">
            {[[sources.length, "sources"], [totalQuestions, "questions"], [coursesTrained, "courses trained"]].map(([value, label]) => <div key={String(label)} className="rounded-[14px] border border-white/[.055] bg-black/15 px-2 py-3 sm:rounded-[17px] sm:px-3 sm:py-4"><p className="text-[22px] font-medium tracking-[-.05em] sm:text-[25px]" style={{ color: label === "questions" ? identity.primary : undefined }}>{value}</p><p className="mt-1 text-[8px] leading-3 text-white/27 sm:text-[9px]">{label}</p></div>)}
          </div>
        </header>

        {message && <div className="mt-5 flex items-center gap-2 rounded-[16px] border border-white/[.07] bg-white/[.02] px-4 py-3 text-[11px] text-white/52"><Sparkles size={12} style={{ color: identity.primary }} />{message}</div>}

        <div className="mt-8 grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
          <aside className="rounded-[26px] border border-white/[.07] bg-[#0D0D0F] p-3">
            <div className="px-3 pb-3 pt-2"><p className="text-[10px] font-semibold uppercase tracking-[.14em] text-white/28">Professor evidence</p><p className="mt-1 text-[10px] text-white/20">Ranked by source type, scope, authority, and recency.</p></div>
            <div className="space-y-1.5">
              {sources.map((source) => {
                const course = courseMap.get(source.course_id);
                return <button key={source.id} onClick={() => setSelected(source)} className={`w-full rounded-[17px] border p-3.5 text-left transition ${selected?.id === source.id ? "border-white/[.1] bg-white/[.04]" : "border-transparent hover:bg-white/[.02]"}`}>
                  <div className="flex items-center gap-3"><span className="h-9 w-1 rounded-full" style={{ backgroundColor: course?.color ?? identity.primary }} /><div className="min-w-0 flex-1"><p className="truncate text-[11px] font-medium text-white/67">{source.title}</p><p className="mt-1 text-[9px] text-white/25">{course?.code} · {source.question_count} questions</p></div><ChevronRight size={12} className="text-white/18" /></div>
                </button>;
              })}
              {!sources.length && <div className="px-4 py-16 text-center"><ScanSearch size={20} className="mx-auto text-white/16" /><p className="mt-3 text-[11px] text-white/32">No test evidence yet.</p><p className="mt-1 text-[9px] leading-5 text-white/18">A single quiz is enough to start learning a professor&apos;s pattern.</p></div>}
            </div>
          </aside>

          <section className="min-h-[560px] rounded-[28px] border border-white/[.07] bg-white/[.012] p-6 sm:p-8">
            {selected ? <SourceReport source={selected} course={courseMap.get(selected.course_id)} accent={courseMap.get(selected.course_id)?.color ?? identity.primary} /> : <div className="flex min-h-[480px] flex-col items-center justify-center text-center"><Target size={22} className="text-white/14" /><h2 className="mt-4 text-[24px] font-medium tracking-[-.04em]">Build the feedback loop.</h2><p className="mt-2 max-w-sm text-[11px] leading-5 text-white/24">Add an old assessment or study guide. The resulting pattern becomes context for every generated quiz in that course.</p><button onClick={() => setShowUpload(true)} className="mt-5 rounded-full bg-white px-4 py-2.5 text-[10px] text-black">Add first source</button></div>}
          </section>
        </div>
      </div>

      <AnimatePresence>
        {(showUpload || showQuestion) && <motion.div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/75 p-0 backdrop-blur-sm sm:items-center sm:p-5" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-[30px] border border-white/[.09] bg-[#101012] p-5 sm:rounded-[30px] sm:p-7" initial={{ y: 35, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 35, opacity: 0 }}>
            <div className="flex items-start justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[.14em] text-white/28">{showQuestion ? "Direct evidence" : "Professor pattern"}</p><h2 className="mt-2 text-[28px] font-medium tracking-[-.045em]">{showQuestion ? "Enter a real question" : "Train from a source"}</h2></div><button onClick={() => { setShowUpload(false); setShowQuestion(false); }} className="h-9 w-9 rounded-full border border-white/[.07] text-white/35"><X size={14} className="mx-auto" /></button></div>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <label className="text-[10px] text-white/30">Course<select value={courseId} onChange={(event) => { setCourseId(event.target.value); setUnitId(""); setTopicIds([]); }} className="mt-2 w-full rounded-[14px] border border-white/[.08] bg-black/25 px-3 py-3 text-[11px] text-white/70 [color-scheme:dark]">{courses.map((course) => <option key={course.id} value={course.id}>{course.code} · {course.name}</option>)}</select></label>
              {!showQuestion && <label className="text-[10px] text-white/30">Source type<select value={sourceType} onChange={(event) => setSourceType(event.target.value)} className="mt-2 w-full rounded-[14px] border border-white/[.08] bg-black/25 px-3 py-3 text-[11px] text-white/70 [color-scheme:dark]">{sourceTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
            </div>
            <label className="mt-4 block text-[10px] text-white/30">Title<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={showQuestion ? "Midterm question on momentum" : "Exam 1 · Fall 2025"} className="mt-2 w-full rounded-[14px] border border-white/[.08] bg-black/25 px-3 py-3 text-[11px] text-white/72 outline-none" /></label>
            <div className="mt-4 rounded-[18px] border border-white/[.07] bg-white/[.015] p-4">
              <div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-medium text-white/46">What does this cover?</p><p className="mt-1 text-[9px] leading-4 text-white/22">This prevents one unit&apos;s evidence from changing an unrelated quiz.</p></div><span className="rounded-full bg-white/[.04] px-2 py-1 text-[8px] text-white/28">Recommended</span></div>
              <label className="mt-3 block text-[9px] text-white/26">Unit<select value={unitId} onChange={(event) => { setUnitId(event.target.value); setTopicIds([]); }} className="mt-1.5 w-full rounded-[13px] border border-white/[.07] bg-black/25 px-3 py-2.5 text-[10px] text-white/65 [color-scheme:dark]"><option value="">All / let CollegeOS infer</option>{courseUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
              {courseTopics.length > 0 && <div className="mt-3"><p className="text-[9px] text-white/26">Topics <span className="text-white/16">(choose any you know)</span></p><div className="mt-2 flex max-h-28 flex-wrap gap-1.5 overflow-y-auto pr-1">{courseTopics.map((topic) => { const active = topicIds.includes(topic.id); return <button key={topic.id} type="button" onClick={() => setTopicIds((current) => active ? current.filter((id) => id !== topic.id) : [...current, topic.id])} className={`rounded-full border px-2.5 py-1.5 text-[9px] transition ${active ? "border-white/[.16] bg-white/[.08] text-white/72" : "border-white/[.055] text-white/28 hover:text-white/52"}`}>{active && <Check size={9} className="mr-1 inline" />}{topic.name}</button>; })}</div></div>}
            </div>
            {!showQuestion && <div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-[10px] text-white/30">Source authority<select value={sourceAuthority} onChange={(event) => setSourceAuthority(event.target.value)} className="mt-2 w-full rounded-[14px] border border-white/[.08] bg-black/25 px-3 py-3 text-[11px] text-white/70 [color-scheme:dark]"><option value="instructor">Professor / TA</option><option value="textbook">Textbook / publisher</option><option value="student">Student-created</option></select></label><label className="text-[10px] text-white/30">Assessment date <span className="text-white/16">(optional)</span><input type="date" value={assessmentDate} onChange={(event) => setAssessmentDate(event.target.value)} className="mt-2 w-full rounded-[14px] border border-white/[.08] bg-black/25 px-3 py-3 text-[11px] text-white/70 [color-scheme:dark]" /></label></div>}
            {showQuestion ? <><label className="mt-4 block text-[10px] text-white/30">Question<textarea value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Enter the question as your professor wrote it…" className="mt-2 min-h-32 w-full rounded-[16px] border border-white/[.08] bg-black/25 p-4 text-[12px] leading-6 text-white/72 outline-none" /></label><label className="mt-4 block text-[10px] text-white/30">Correct answer <span className="text-white/16">(optional)</span><textarea value={answer} onChange={(event) => { setAnswer(event.target.value); setAnswerConfirmed(false); }} placeholder="Leave this blank if the answer is uncertain." className="mt-2 min-h-20 w-full rounded-[16px] border border-white/[.08] bg-black/25 p-4 text-[12px] text-white/72 outline-none" /></label>{answer.trim() && <label className="mt-3 flex cursor-pointer items-start gap-2.5 rounded-[14px] border border-white/[.07] bg-white/[.015] p-3 text-[9px] leading-4 text-white/35"><input type="checkbox" checked={answerConfirmed} onChange={(event) => setAnswerConfirmed(event.target.checked)} className="mt-0.5 accent-white" /><span>I confirm this is the real answer key, not my guess. CollegeOS may use it as factual evidence for this topic.</span></label>}</> : <div className="mt-4"><SourceCapturePicker file={file} onFileSelected={setFile} onClear={() => setFile(null)} accentColor={accent} accept=".pdf,.docx,.pptx,.txt,.md,image/*" title="Test, quiz, guide, or photo" description="Clear, straight-on photos work best for handwritten or printed pages." uploadLabel="Choose document" cameraLabel="Scan with camera" /></div>}
            <button disabled={busy || !courseId || (showQuestion ? !question.trim() || topicIds.length === 0 || (Boolean(answer.trim()) && !answerConfirmed) : !file || !title.trim())} onClick={() => void (showQuestion ? saveQuestion() : analyze())} className="mt-5 flex w-full items-center justify-center gap-2 rounded-full py-3 text-[11px] font-semibold text-black disabled:opacity-35" style={{ backgroundColor: accent }}>{busy ? <Loader2 size={13} className="animate-spin" /> : showQuestion ? <Check size={13} /> : <BrainCircuit size={13} />}{busy ? "Learning pattern…" : showQuestion ? "Save as training evidence" : "Analyze and train CollegeOS"}</button>
          </motion.div>
        </motion.div>}
      </AnimatePresence>
    </main>
  );
}

function SourceReport({ source, course, accent }: { source: Source; course?: Course; accent: string }) {
  const analysis = source.analysis ?? {};
  const [questions, setQuestions] = useState<SourceQuestion[]>([]);
  const [reviewingQuestionId, setReviewingQuestionId] = useState("");
  const [updatingQuestionId, setUpdatingQuestionId] = useState("");
  const [answerReviewMessage, setAnswerReviewMessage] = useState("");
  const [visibleQuestionCounts, setVisibleQuestionCounts] = useState<Record<string, number>>({});
  const visibleQuestionCount = visibleQuestionCounts[source.id] ?? 12;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session || cancelled) return;
      const { data, error } = await supabase
        .from("assessment_source_questions")
        .select(
          "id, prompt, position, answer_candidate, answer_is_verified, answer_verification_method, answer_evidence_quote, answer_evidence_page",
        )
        .eq("source_id", source.id)
        .eq("course_id", source.course_id)
        .eq("user_id", session.user.id)
        .order("position")
        .limit(80);

        if (cancelled) return;
        if (error) {
          console.error("Could not load assessment questions:", error);
          setQuestions([]);
          return;
        }
        setQuestions((data ?? []) as SourceQuestion[]);
    })();
    return () => { cancelled = true; };
  }, [source.id, source.course_id]);

  async function resolveAnswerCandidate(
    question: SourceQuestion,
    action: "confirm" | "dismiss",
  ) {
    const candidate = question.answer_candidate?.trim();
    if (!candidate || question.answer_is_verified) return;

    try {
      setUpdatingQuestionId(question.id);
      setAnswerReviewMessage("");
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("You must be signed in.");

      const now = new Date().toISOString();
      const changes = action === "confirm"
        ? {
            correct_answer: candidate,
            answer_candidate: null,
            answer_is_visible: false,
            answer_is_verified: true,
            answer_verification_method: "user_confirmed",
            answer_evidence_quote: null,
            answer_evidence_page: null,
            answer_evidence_confidence: 1,
            answer_verified_at: now,
            answer_verified_by: session.user.id,
          }
        : {
            correct_answer: null,
            answer_candidate: null,
            answer_is_visible: false,
            answer_is_verified: false,
            answer_verification_method: "none",
            answer_evidence_quote: null,
            answer_evidence_page: null,
            answer_evidence_confidence: null,
            answer_verified_at: null,
            answer_verified_by: null,
          };
      const { data, error } = await supabase
        .from("assessment_source_questions")
        .update(changes)
        .eq("id", question.id)
        .eq("source_id", source.id)
        .eq("course_id", source.course_id)
        .eq("user_id", session.user.id)
        .eq("answer_is_verified", false)
        .eq("answer_candidate", question.answer_candidate)
        .select(
          "id, prompt, position, answer_candidate, answer_is_verified, answer_verification_method, answer_evidence_quote, answer_evidence_page",
        )
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        throw new Error(
          "That candidate changed in another tab. Reload the source and review it again.",
        );
      }

      setQuestions((current) =>
        current.map((item) =>
          item.id === question.id ? data as SourceQuestion : item,
        ),
      );
      setReviewingQuestionId("");
      setAnswerReviewMessage(
        action === "confirm"
          ? "Answer key confirmed. It can now ground practice for this topic."
          : "Unverified answer candidate removed. The question still trains style and coverage.",
      );
    } catch (error) {
      setAnswerReviewMessage(
        error instanceof Error
          ? error.message
          : "Could not update this answer candidate.",
      );
    } finally {
      setUpdatingQuestionId("");
    }
  }

  async function openOriginalSource() {
    if (!source.storage_path) {
      setAnswerReviewMessage("This manually entered question has no uploaded source file.");
      return;
    }

    try {
      const { data, error } = await supabase.storage
        .from("course-files")
        .createSignedUrl(source.storage_path, 120);
      if (error) throw error;
      const link = document.createElement("a");
      link.href = data.signedUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.click();
    } catch (error) {
      setAnswerReviewMessage(
        error instanceof Error
          ? error.message
          : "Could not open the uploaded source.",
      );
    }
  }

  function solveQuestion(question: SourceQuestion) {
    window.dispatchEvent(new CustomEvent("collegeos:open-solver", {
      detail: {
        prompt: question.prompt,
        courseId: source.course_id,
        originKind: "assessment_question",
        originId: question.id,
      },
    }));
  }
  const groups: Array<[string, string[] | undefined]> = [
    ["What gets tested", analysis.testedSkills],
    ["Question fingerprint", analysis.questionStyle],
    ["Common traps", analysis.trapPatterns],
    ["How to prepare", analysis.studyRecommendations],
  ];
  return <div>
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/[.06] pb-6"><div><div className="flex items-center gap-2"><span className="rounded-full px-2.5 py-1 text-[8px] font-semibold uppercase tracking-[.12em]" style={{ color: accent, backgroundColor: `${accent}12` }}>{course?.code ?? "Course"}</span><span className="text-[9px] text-white/22">{source.source_type.replaceAll("_", " ")}</span><span className="text-[9px] text-white/18">· {source.source_authority}</span></div><h2 className="mt-4 text-[32px] font-medium tracking-[-.05em]">{source.title}</h2><p className="mt-3 max-w-2xl text-[12px] leading-6 text-white/36">{analysis.summary || "This source is ready to calibrate future practice."}</p></div><div className="rounded-[18px] border border-white/[.07] bg-black/15 px-4 py-3 text-center"><p className="text-[25px] font-medium" style={{ color: accent }}>{source.question_count}</p><p className="text-[8px] text-white/24">questions learned</p></div></div>
    <div className="mt-4 grid grid-cols-2 gap-2"><div className="rounded-[16px] border border-white/[.06] bg-white/[.012] px-4 py-3"><p className="text-[8px] uppercase tracking-[.12em] text-white/22">Style signal</p><p className="mt-1 text-[12px] text-white/54">{Math.round(Number(source.style_weight ?? 0) * 100)}%</p></div><div className="rounded-[16px] border border-white/[.06] bg-white/[.012] px-4 py-3"><p className="text-[8px] uppercase tracking-[.12em] text-white/22">Coverage signal</p><p className="mt-1 text-[12px] text-white/54">{Math.round(Number(source.coverage_weight ?? 0) * 100)}%</p></div></div>
    {analysis.difficultySignature && <div className="mt-5 rounded-[20px] border border-white/[.07] bg-white/[.016] p-5"><p className="text-[9px] font-semibold uppercase tracking-[.13em] text-white/25">Difficulty signature</p><p className="mt-2 text-[13px] leading-6 text-white/52">{analysis.difficultySignature}</p></div>}
    <div className="mt-4 grid gap-3 sm:grid-cols-2">{groups.map(([label, items]) => <div key={label} className="rounded-[20px] border border-white/[.065] bg-white/[.012] p-5"><p className="text-[9px] font-semibold uppercase tracking-[.13em] text-white/25">{label}</p><div className="mt-3 space-y-2">{items?.length ? items.slice(0, 6).map((item) => <div key={item} className="flex gap-2 text-[11px] leading-5 text-white/42"><span className="mt-2 h-1 w-1 shrink-0 rounded-full" style={{ backgroundColor: accent }} />{item}</div>) : <p className="text-[10px] text-white/18">More evidence will sharpen this signal.</p>}</div></div>)}</div>
    {questions.length > 0 && <div className="mt-5 rounded-[20px] border border-white/[.065] bg-white/[.012] p-4 sm:p-5"><div className="flex items-center justify-between gap-3"><div><p className="text-[9px] font-semibold uppercase tracking-[.13em] text-white/25">Questions found</p><p className="mt-1 text-[9px] text-white/20">Work through unanswered problems without revealing the solution.</p></div><BrainCircuit size={14} style={{ color: accent }} /></div>{answerReviewMessage && <p className="mt-3 rounded-[12px] border border-white/[.06] bg-white/[.02] px-3 py-2 text-[9px] leading-4 text-white/38">{answerReviewMessage}</p>}<div className="mt-3 space-y-2">{questions.slice(0, visibleQuestionCount).map((question, index) => <div key={question.id} className="rounded-[14px] border border-white/[.05] bg-black/10 p-3"><div className="flex items-start gap-3"><span className="mt-0.5 text-[9px] text-white/20">{index + 1}</span><p className="min-w-0 flex-1 text-[10px] leading-5 text-white/42">{question.prompt}</p><div className="flex shrink-0 items-center gap-1.5">{question.answer_is_verified && <span className="rounded-full border border-emerald-300/15 bg-emerald-300/[.05] px-2 py-1 text-[7px] font-semibold uppercase tracking-[.08em] text-emerald-200/55">Key verified</span>}{question.answer_candidate && !question.answer_is_verified && <button type="button" onClick={() => setReviewingQuestionId((current) => current === question.id ? "" : question.id)} className="rounded-full border border-amber-200/15 bg-amber-200/[.035] px-2.5 py-1.5 text-[8px] font-medium text-amber-100/55 transition hover:bg-amber-200/[.07] hover:text-amber-100/75">Review proposed key</button>}<button type="button" onClick={() => solveQuestion(question)} className="rounded-full border border-white/[.07] px-2.5 py-1.5 text-[8px] font-medium text-white/42 transition hover:bg-white/[.04] hover:text-white/68">Solve</button></div></div>{reviewingQuestionId === question.id && question.answer_candidate && !question.answer_is_verified && <div className="ml-5 mt-3 rounded-[13px] border border-amber-200/10 bg-amber-200/[.025] p-3"><p className="text-[8px] font-semibold uppercase tracking-[.1em] text-amber-100/42">AI-extracted candidate · not trusted yet</p><p className="mt-2 text-[11px] leading-5 text-white/58">{question.answer_candidate}</p>{question.answer_evidence_quote && <p className="mt-2 text-[9px] leading-4 text-white/28">Extracted evidence{question.answer_evidence_page ? ` · ${question.answer_evidence_page}` : ""}: “{question.answer_evidence_quote}”</p>}<p className="mt-2 text-[8px] leading-4 text-white/22">Check this against the uploaded source. Confirm only if it is the real answer key—not a guess or an AI-solved answer.</p><div className="mt-3 flex flex-wrap gap-2">{source.storage_path && <button type="button" disabled={updatingQuestionId === question.id} onClick={() => void openOriginalSource()} className="rounded-full border border-white/[.07] px-3 py-1.5 text-[8px] text-white/42 disabled:opacity-40">Open source</button>}<button type="button" disabled={updatingQuestionId === question.id} onClick={() => void resolveAnswerCandidate(question, "dismiss")} className="rounded-full border border-white/[.07] px-3 py-1.5 text-[8px] text-white/34 disabled:opacity-40">Not an answer</button><button type="button" disabled={updatingQuestionId === question.id} onClick={() => void resolveAnswerCandidate(question, "confirm")} className="rounded-full bg-white px-3 py-1.5 text-[8px] font-semibold text-black disabled:opacity-40">{updatingQuestionId === question.id ? "Saving…" : "I checked it · confirm"}</button></div></div>}</div>)}{visibleQuestionCount < questions.length && <button type="button" onClick={() => setVisibleQuestionCounts((current) => ({ ...current, [source.id]: Math.min(questions.length, visibleQuestionCount + 12) }))} className="w-full rounded-[12px] border border-white/[.055] py-2.5 text-[8px] font-medium text-white/32 transition hover:bg-white/[.025] hover:text-white/52">Show {Math.min(12, questions.length - visibleQuestionCount)} more · {questions.length - visibleQuestionCount} remaining</button>}</div></div>}
    <div className="mt-5 flex items-center gap-2 rounded-[18px] border border-white/[.06] bg-black/10 px-4 py-3 text-[10px] text-white/28"><FileQuestion size={12} style={{ color: accent }} />Future generated quizzes now receive this professor fingerprint as calibration context.</div>
  </div>;
}
