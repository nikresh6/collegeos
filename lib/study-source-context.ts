import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildAssessmentLearningContext,
  deriveAssessmentLearning,
} from "./assessment-learning";
import {
  deriveAssessmentEvidence,
  type AssessmentSourceRef,
  type AssessmentTopicCoverage,
} from "./assessment-evidence";
import {
  calculatePreparedness,
  studyNeedScore,
} from "./study-mastery";

export type StudySourceRef = {
  fileId: string;
  fileName: string;
  materialType: string;
  topicIds: string[];
};

export type StudyTopicSource = {
  id: string;
  name: string;
  unitId: string | null;
  parentTopicId: string | null;
};

export type StudyTopicSignal = {
  topicId: string;
  assessmentCoverage: number;
  normalizedAssessmentCoverage: number;
  assessmentQuestionCount: number;
  assessmentSourceCount: number;
  verifiedAssessmentQuestionCount: number;
  materialSourceCount: number;
  preparedness: number;
  studyNeed: number;
};

export type StudySourceContext = {
  topics: StudyTopicSource[];
  sourceRefs: StudySourceRef[];
  assessmentSourceRefs: AssessmentSourceRef[];
  assessmentCoverage: AssessmentTopicCoverage[];
  topicSignals: StudyTopicSignal[];
  groundingContextText: string;
  assessmentGroundingContextText: string;
  styleContextText: string;
  coverageContextText: string;
};

function safeText(value: unknown, max = 1400) {
  if (typeof value !== "string") return "";

  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function safePoints(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 8);
}

export async function loadStudySourceContext({
  supabase,
  userId,
  courseId,
  topicIds,
  maxCharacters = 18000,
}: {
  supabase: SupabaseClient;
  userId: string;
  courseId: string;
  topicIds: string[];
  maxCharacters?: number;
}): Promise<StudySourceContext> {
  const uniqueTopicIds = Array.from(new Set(topicIds.filter(Boolean)));

  if (uniqueTopicIds.length === 0) {
    return {
      topics: [],
      sourceRefs: [],
      assessmentSourceRefs: [],
      assessmentCoverage: [],
      topicSignals: [],
      groundingContextText: "",
      assessmentGroundingContextText: "",
      styleContextText: "",
      coverageContextText: "",
    };
  }

  const [
    { data: topicsData, error: topicsError },
    { data: noteData, error: notesError },
    { data: linkData, error: linksError },
    { data: feedbackData, error: feedbackError },
    { data: assessmentSourceData, error: assessmentSourceError },
    { data: assessmentQuestionData, error: assessmentQuestionError },
    { data: assessmentTopicLinkData, error: assessmentTopicLinkError },
    {
      data: assessmentQuestionTopicLinkData,
      error: assessmentQuestionTopicLinkError,
    },
    { data: responseData, error: responseError },
  ] = await Promise.all([
    supabase
      .from("course_topics")
      .select("id, name, unit_id, parent_topic_id")
      .eq("user_id", userId)
      .eq("course_id", courseId)
      .in("id", uniqueTopicIds),
    supabase
      .from("material_analysis_topic_notes")
      .select("topic_id, course_file_id, summary, key_points")
      .eq("user_id", userId)
      .eq("course_id", courseId)
      .in("topic_id", uniqueTopicIds),
    supabase
      .from("course_file_topic_links")
      .select("topic_id, course_file_id")
      .eq("user_id", userId)
      .eq("course_id", courseId)
      .in("topic_id", uniqueTopicIds),
    supabase
      .from("assessment_feedback")
      .select(
        "assessment_kind, score_percent, preparedness_percent, difficulty_percent, quiz_similarity_percent, assistant_helpfulness_percent, study_hours, difference_notes, response_status, created_at",
      )
      .eq("user_id", userId)
      .eq("course_id", courseId)
      .eq("response_status", "completed")
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("assessment_sources")
      .select(
        "id, title, source_type, source_authority, style_weight, coverage_weight, unit_id, assessment_date, analysis, question_count, created_at",
      )
      .eq("user_id", userId)
      .eq("course_id", courseId)
      .eq("status", "ready")
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("assessment_source_questions")
      .select(
        "id, source_id, prompt, choices, correct_answer, answer_is_visible, answer_is_verified, answer_verification_method, answer_evidence_quote, answer_evidence_page, answer_evidence_confidence, question_type",
      )
      .eq("user_id", userId)
      .eq("course_id", courseId)
      .order("created_at", { ascending: false })
      .limit(1000),
    supabase
      .from("assessment_source_topic_links")
      .select(
        "source_id, topic_id, relevance_score, match_method, question_count",
      )
      .eq("user_id", userId)
      .eq("course_id", courseId)
      .in("topic_id", uniqueTopicIds),
    supabase
      .from("assessment_question_topic_links")
      .select("question_id, topic_id, relevance_score")
      .eq("user_id", userId)
      .eq("course_id", courseId)
      .in("topic_id", uniqueTopicIds)
      .order("relevance_score", { ascending: false })
      .limit(1000),
    supabase
      .from("study_responses")
      .select("topic_id, score, answered_at")
      .eq("user_id", userId)
      .eq("course_id", courseId)
      .in("topic_id", uniqueTopicIds)
      .order("answered_at", { ascending: true }),
  ]);

  if (topicsError) throw topicsError;
  if (notesError) throw notesError;
  if (linksError) throw linksError;
  if (feedbackError) throw feedbackError;
  if (assessmentSourceError) throw assessmentSourceError;
  if (assessmentQuestionError) throw assessmentQuestionError;
  if (assessmentTopicLinkError) throw assessmentTopicLinkError;
  if (assessmentQuestionTopicLinkError) throw assessmentQuestionTopicLinkError;
  if (responseError) throw responseError;

  const topicOrder = new Map(uniqueTopicIds.map((id, index) => [id, index]));
  const topics: StudyTopicSource[] = (topicsData ?? [])
    .map((topic) => ({
      id: topic.id,
      name: topic.name,
      unitId: topic.unit_id ?? null,
      parentTopicId: topic.parent_topic_id ?? null,
    }))
    .sort(
      (a, b) =>
        (topicOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (topicOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    );

  const assessmentLearning = deriveAssessmentLearning(feedbackData ?? []);
  const calibrationText = buildAssessmentLearningContext(assessmentLearning).slice(
    0,
    2400,
  );
  const assessmentEvidence = deriveAssessmentEvidence({
    sources: assessmentSourceData ?? [],
    questions: assessmentQuestionData ?? [],
    topicLinks: assessmentTopicLinkData ?? [],
    questionTopicLinks: assessmentQuestionTopicLinkData ?? [],
    topics,
    calibrationText,
  });

  const fileIds = Array.from(
    new Set(
      [
        ...(noteData ?? []).map((note) => note.course_file_id),
        ...(linkData ?? []).map((link) => link.course_file_id),
      ].filter(Boolean),
    ),
  );

  let sourceRefs: StudySourceRef[] = [];
  let groundingContextText = "";

  if (fileIds.length > 0) {
    const [
      { data: filesData, error: filesError },
      { data: analysesData, error: analysesError },
    ] = await Promise.all([
      supabase
        .from("course_files")
        .select("id, file_name, material_type")
        .eq("user_id", userId)
        .eq("course_id", courseId)
        .in("id", fileIds),
      supabase
        .from("material_analyses")
        .select("course_file_id, summary, explanation, raw_analysis")
        .eq("user_id", userId)
        .eq("course_id", courseId)
        .in("course_file_id", fileIds)
        .eq("status", "ready"),
    ]);

    if (filesError) throw filesError;
    if (analysesError) throw analysesError;

    const files = new Map(
      (filesData ?? []).map((file) => [
        file.id,
        {
          id: file.id,
          fileName: file.file_name,
          materialType: file.material_type ?? "material",
        },
      ]),
    );
    const analyses = new Map(
      (analysesData ?? []).map((analysis) => [analysis.course_file_id, analysis]),
    );
    const sourceTopicMap = new Map<string, Set<string>>();

    for (const link of linkData ?? []) {
      const current = sourceTopicMap.get(link.course_file_id) ?? new Set<string>();
      current.add(link.topic_id);
      sourceTopicMap.set(link.course_file_id, current);
    }

    for (const note of noteData ?? []) {
      const current = sourceTopicMap.get(note.course_file_id) ?? new Set<string>();
      current.add(note.topic_id);
      sourceTopicMap.set(note.course_file_id, current);
    }

    const notesByTopic = new Map<string, typeof noteData>();
    for (const note of noteData ?? []) {
      const current = notesByTopic.get(note.topic_id) ?? [];
      current.push(note);
      notesByTopic.set(note.topic_id, current);
    }

    const blocks: string[] = [];

    for (const topic of topics) {
      const topicNotes = notesByTopic.get(topic.id) ?? [];
      const topicLines: string[] = [`TOPIC ${topic.id}: ${topic.name}`];

      for (const note of topicNotes) {
        const file = files.get(note.course_file_id);
        if (!file) continue;

        const summary = safeText(note.summary, 1100);
        const points = safePoints(note.key_points);

        if (!summary && points.length === 0) continue;

        topicLines.push(
          [
            `SOURCE ${file.id}: ${file.fileName} (${file.materialType})`,
            summary ? `SUMMARY: ${summary}` : "",
            points.length
              ? `KEY POINTS:\n${points.map((point) => `- ${point}`).join("\n")}`
              : "",
          ]
            .filter(Boolean)
            .join("\n"),
        );
      }

      const linkedFileIds = Array.from(sourceTopicMap.entries())
        .filter(([, ids]) => ids.has(topic.id))
        .map(([fileId]) => fileId);

      for (const fileId of linkedFileIds) {
        if (topicNotes.some((note) => note.course_file_id === fileId)) continue;

        const file = files.get(fileId);
        const analysis = analyses.get(fileId);
        if (!file || !analysis) continue;

        const summary = safeText(analysis.summary, 900);
        const explanation = safeText(analysis.explanation, 1000);

        if (!summary && !explanation) continue;

        topicLines.push(
          [
            `SOURCE ${file.id}: ${file.fileName} (${file.materialType})`,
            summary ? `SUMMARY: ${summary}` : "",
            explanation ? `EXPLANATION: ${explanation}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        );
      }

      if (topicLines.length > 1) blocks.push(topicLines.join("\n\n"));
    }

    const budgetPerBlock = Math.max(
      900,
      Math.floor(maxCharacters / Math.max(1, blocks.length)),
    );
    groundingContextText = blocks
      .map((block) => block.slice(0, budgetPerBlock))
      .join("\n\n---\n\n")
      .slice(0, maxCharacters);

    const includedTopicsByFile = new Map<string, Set<string>>();
    for (const block of groundingContextText.split("\n\n---\n\n")) {
      const topicId = block.match(/^TOPIC ([^:]+):/)?.[1];
      if (!topicId) continue;

      for (const fileId of fileIds) {
        const sourceOffset = block.indexOf(`SOURCE ${fileId}:`);
        if (
          sourceOffset < 0 ||
          block.slice(sourceOffset).trim().length < 80
        ) {
          continue;
        }
        const current =
          includedTopicsByFile.get(fileId) ?? new Set<string>();
        current.add(topicId);
        includedTopicsByFile.set(fileId, current);
      }
    }

    sourceRefs = fileIds
      .map((fileId) => {
        const file = files.get(fileId);
        const groundedTopicIds = includedTopicsByFile.get(fileId);
        if (!file || !groundedTopicIds?.size) return null;

        return {
          fileId,
          fileName: file.fileName,
          materialType: file.materialType,
          topicIds: Array.from(groundedTopicIds),
        };
      })
      .filter((ref): ref is StudySourceRef => Boolean(ref));
  }

  const assessmentCoverageByTopic = new Map(
    assessmentEvidence.coverageSignals.map((signal) => [signal.topicId, signal]),
  );
  const materialSourceCountByTopic = new Map<string, number>();

  for (const ref of sourceRefs) {
    for (const topicId of ref.topicIds) {
      materialSourceCountByTopic.set(
        topicId,
        (materialSourceCountByTopic.get(topicId) ?? 0) + 1,
      );
    }
  }

  const topicSignals: StudyTopicSignal[] = topics.map((topic) => {
    const evidence = (responseData ?? [])
      .filter((response) => response.topic_id === topic.id)
      .map((response) => ({
        score: Number(response.score ?? 0),
        answered_at: response.answered_at,
      }));
    const preparedness = calculatePreparedness(evidence);
    const assessment = assessmentCoverageByTopic.get(topic.id);

    return {
      topicId: topic.id,
      assessmentCoverage: assessment?.score ?? 0,
      normalizedAssessmentCoverage: assessment?.normalizedScore ?? 0,
      assessmentQuestionCount: assessment?.questionCount ?? 0,
      assessmentSourceCount: assessment?.sourceCount ?? 0,
      verifiedAssessmentQuestionCount:
        assessment?.verifiedQuestionCount ?? 0,
      materialSourceCount: materialSourceCountByTopic.get(topic.id) ?? 0,
      preparedness: preparedness.preparedness,
      studyNeed: studyNeedScore(preparedness),
    };
  });

  return {
    topics,
    sourceRefs,
    assessmentSourceRefs: assessmentEvidence.assessmentSourceRefs,
    assessmentCoverage: assessmentEvidence.coverageSignals,
    topicSignals,
    groundingContextText,
    assessmentGroundingContextText:
      assessmentEvidence.assessmentGroundingContextText,
    styleContextText: assessmentEvidence.styleContextText,
    coverageContextText: assessmentEvidence.coverageContextText,
  };
}
