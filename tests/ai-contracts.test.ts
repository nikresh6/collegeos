import assert from "node:assert/strict";
import test from "node:test";

import {
  buildQuizTopicBlueprint,
  assessmentSourceWeights,
} from "../lib/assessment-evidence";
import {
  deriveUploadedAnswerProvenance,
  userConfirmedAnswerProvenance,
} from "../lib/assessment-answer-provenance";
import {
  calculateGpa,
  calculateTrackedCumulativeGpa,
  gradePointFromStoredGrade,
} from "../lib/gpa";
import { calculateGradebook } from "../lib/grades";
import {
  assertPublicSolvePlanDoesNotLeak,
  answersDeterministicallyAgree,
  normalizeSolvePlan,
  parseSingleComparableNumber,
} from "../app/api/solve/_shared";
import {
  buildSyllabusChunks,
  deriveDeterministicSyllabusFacts,
  isSyllabusPipelineState,
  mergeSyllabusChunkAnalyses,
  parseTaggedSyllabusChunk,
} from "../lib/syllabus-analysis-pipeline";
import { parseSyllabusDateRange } from "../lib/syllabus-date";
import { structuredModelCandidates } from "../lib/ai/groq";
import { parseIcs } from "../lib/calendar-ics";

test("weighted grade calculations remain deterministic", () => {
  const summary = calculateGradebook(
    [
      { id: "exam", name: "Exams", weight_percent: 60 },
      { id: "work", name: "Coursework", weight_percent: 40 },
    ],
    [
      { id: "e1", category_id: "exam", name: "Midterm", points_earned: 80, points_possible: 100 },
      { id: "w1", category_id: "work", name: "Project", points_earned: 100, points_possible: 100 },
    ],
    [],
  );

  assert.equal(summary.mode, "weighted");
  assert.equal(summary.currentPercent, 88);
  assert.equal(summary.letterGrade, "B+");
});

test("GPA calculations ignore ungraded courses and preserve credit weighting", () => {
  const active = [
    { id: "a", code: "A", name: "A", credits: 4, letterGrade: "A", currentPercent: 95 },
    { id: "b", code: "B", name: "B", credits: 2, letterGrade: "B", currentPercent: 85 },
    { id: "c", code: "C", name: "C", credits: 3, letterGrade: null, currentPercent: null },
  ];
  const semester = calculateGpa(active);
  const cumulative = calculateTrackedCumulativeGpa({
    activeCourses: active,
    historicalCourses: [
      { id: "h", code: "H", name: "History", credits: 3, gradePoints: 3.3 },
    ],
  });

  assert.equal(semester.gradedCredits, 6);
  assert.equal(Number(semester.gpa?.toFixed(4)), 3.6667);
  assert.equal(Number(cumulative.gpa?.toFixed(4)), 3.5444);
  assert.equal(gradePointFromStoredGrade("92%"), 3.7);
});

test("uploaded answer keys require explicit, source-matched provenance", () => {
  const verified = deriveUploadedAnswerProvenance({
    extracted: {
      correctAnswer: "Paris",
      answerIsVisible: true,
      answerEvidenceQuote: "Correct answer: Paris",
      answerEvidencePage: "2",
      answerEvidenceConfidence: 0.97,
    },
    sourceText: "Question 4. Capital of France? Correct answer: Paris",
  });
  const inferred = deriveUploadedAnswerProvenance({
    extracted: {
      correctAnswer: "Paris",
      answerIsVisible: true,
      answerEvidenceQuote: "Answer the following: London or Paris",
      answerEvidencePage: "2",
      answerEvidenceConfidence: 0.99,
    },
    sourceText: "Answer the following: London or Paris",
  });

  assert.equal(verified.answerVerificationMethod, "source_text_match");
  assert.equal(verified.correctAnswer, "Paris");
  assert.equal(inferred.answerVerificationMethod, "model_unverified");
  assert.equal(inferred.correctAnswer, null);
  assert.equal(userConfirmedAnswerProvenance("  B ").correctAnswer, "B");
});

test("assessment weighting favors instructor evidence and guide coverage", () => {
  const date = new Date().toISOString();
  const instructorExam = assessmentSourceWeights({
    id: "exam",
    title: "Exam",
    source_type: "past_exam",
    source_authority: "instructor",
    created_at: date,
  });
  const studentExam = assessmentSourceWeights({
    id: "student",
    title: "Student exam",
    source_type: "past_exam",
    source_authority: "student",
    created_at: date,
  });
  const guide = assessmentSourceWeights({
    id: "guide",
    title: "Guide",
    source_type: "study_guide",
    source_authority: "instructor",
    created_at: date,
  });

  assert.ok(instructorExam.style > studentExam.style);
  assert.ok(guide.coverage > guide.style);
});

test("quiz blueprint allocates the exact requested count across supported topics", () => {
  const blueprint = buildQuizTopicBlueprint({
    questionCount: 7,
    strategy: "adaptive",
    topics: [
      { id: "micro", name: "Micro", assessmentCoverage: 10, studyNeed: 2, materialSourceCount: 1, verifiedAssessmentQuestionCount: 2 },
      { id: "macro", name: "Macro", assessmentCoverage: 3, studyNeed: 10, materialSourceCount: 2, verifiedAssessmentQuestionCount: 1 },
      { id: "unsupported", name: "Unsupported", assessmentCoverage: 100, studyNeed: 100, materialSourceCount: 0, verifiedAssessmentQuestionCount: 0 },
    ],
  });

  assert.equal(blueprint.reduce((sum, topic) => sum + topic.targetQuestions, 0), 7);
  assert.deepEqual(blueprint.map((topic) => topic.topicId).sort(), ["macro", "micro"]);
  assert.ok(blueprint.every((topic) => topic.targetQuestions >= 1));
});

test("structured AI generation always has a distinct fallback model", () => {
  const candidates = structuredModelCandidates("openai/gpt-oss-120b");
  assert.equal(candidates[0], "openai/gpt-oss-120b");
  assert.equal(new Set(candidates).size, candidates.length);
  assert.ok(candidates.length >= 2);
});

test("calendar imports preserve local ICS dates instead of shifting through UTC", () => {
  const drafts = parseIcs([
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:all-day",
    "DTSTART;VALUE=DATE:20260901",
    "DTEND;VALUE=DATE:20260902",
    "SUMMARY:Reading due",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:class-time",
    "DTSTART;TZID=America/Chicago:20260902T090000",
    "DTEND;TZID=America/Chicago:20260902T101500",
    "SUMMARY:Class meeting",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n"), "course-1");

  assert.deepEqual(
    drafts.map(({ title, date, startTime, endDate, endTime, allDay }) => ({
      title, date, startTime, endDate, endTime, allDay,
    })),
    [
      { title: "Reading due", date: "2026-09-01", startTime: "", endDate: "2026-09-01", endTime: "", allDay: true },
      { title: "Class meeting", date: "2026-09-02", startTime: "09:00", endDate: "2026-09-02", endTime: "10:15", allDay: false },
    ],
  );
});

test("syllabus pipeline preserves pages and rejects stale cached versions", () => {
  const pages = ["Page one", "Page two", "Page three"];
  const chunks = buildSyllabusChunks(pages);
  assert.equal(chunks.length, pages.length);
  assert.ok(chunks.every((chunk, index) => chunk.includes(`PAGE ${index + 1}`)));
  assert.ok(chunks.every((chunk, index) => chunk.endsWith(pages[index])));
  assert.equal(isSyllabusPipelineState({ pipelineVersion: 1 }), false);
});

test("syllabus deterministic pass recovers grading structure and exam dates", () => {
  const facts = deriveDeterministicSyllabusFacts(`
Participation/In-class Exercises: (20%)
Midterm Exams: (30% total; 15 each)
Final exam: (30%)
Group project: (20%)
A 100-93 A- 92.9-90 B+ 89.9-87 B 86.9-83 B- 82.9-80
C+ 79.9-77 C 76.9-73 C- 72.9-70 D+ 69.9-67 D 66.9-63 D- 62.9-60 F 59.9-0
Midterm 1, Friday, October 2
Midterm 2, Friday, November 6
Final Exam Option 1: Monday, December 7 at noon
  `);

  assert.equal(facts.gradingCategories.length, 4);
  assert.equal(facts.gradingCategories.reduce((sum, row) => sum + row.weightPercent, 0), 100);
  assert.equal(facts.gradingScale.length, 12);
  assert.ok(facts.importantDates.some((item) => /midterm 1/i.test(item.name)));
});

test("syllabus merge removes warnings contradicted by extracted facts", () => {
  const deterministic = deriveDeterministicSyllabusFacts("Final exam: (30%)\nA 100-93\nMidterm 1, Friday, October 2");
  const model = parseTaggedSyllabusChunk([
    "WARNING\tNo grading categories were found.",
    "WARNING\tNo explicit grading scale is present.",
    "CONFIDENCE\t85",
  ].join("\n"));
  const merged = mergeSyllabusChunkAnalyses([deterministic, model]);

  assert.equal(merged.gradingCategories.length, 1);
  assert.equal(merged.gradingScale.length, 1);
  assert.equal(merged.warnings.length, 0);
});

test("syllabus dates honor the supplied academic term year", () => {
  assert.deepEqual(parseSyllabusDateRange("October 2", "Fall 2026"), {
    start: "2026-10-02",
    end: null,
  });
  assert.deepEqual(parseSyllabusDateRange("12/7-12/10", "Fall '26"), {
    start: "2026-12-07",
    end: "2026-12-10",
  });
});

test("guided solve numeric comparison supports fractions without accepting partial tuples", () => {
  assert.equal(parseSingleComparableNumber("1/2"), 0.5);
  assert.equal(parseSingleComparableNumber("50%"), 0.5);
  assert.equal(answersDeterministicallyAgree("0.5", "1/2"), true);
  assert.equal(answersDeterministicallyAgree("x=999, y=5", "x=4, y=5"), false);
});

test("guided solve rejects plans that expose private answers early", () => {
  const safe = normalizeSolvePlan({
    problemSummary: "Evaluate the expression.",
    subject: "Algebra",
    givens: ["2 + 2"],
    goal: "Compute the sum.",
    assumptions: [],
    steps: [
      {
        title: "Set up",
        learnerPrompt: "What operation combines the two values?",
        concept: "Identify the operation before calculating.",
        hints: ["Think about how the quantities are combined."],
        expectedAnswer: "addition",
        verification: { kind: "exact", acceptedAnswers: ["add"], tolerance: 0, units: "" },
        explanationAfterSuccess: "Addition is the correct operation.",
      },
      {
        title: "Calculate",
        learnerPrompt: "Now perform that operation.",
        concept: "Compute carefully.",
        hints: [],
        expectedAnswer: "4",
        verification: { kind: "numeric", acceptedAnswers: [], tolerance: 0.001, units: "" },
        explanationAfterSuccess: "The calculation is complete.",
      },
    ],
    finalAnswer: "4",
    finalCheck: "Substitute the result.",
  });
  assert.doesNotThrow(() => assertPublicSolvePlanDoesNotLeak(safe));

  const leaking = structuredClone(safe);
  leaking.steps[0].hints = ["The final answer is 4."];
  assert.throws(
    () => assertPublicSolvePlanDoesNotLeak(leaking),
    /reveal a private answer/i,
  );
});
