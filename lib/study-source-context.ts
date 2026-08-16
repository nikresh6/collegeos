import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildAssessmentLearningContext,
  deriveAssessmentLearning,
} from "./assessment-learning";

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

export type StudySourceContext = {
  topics: StudyTopicSource[];
  sourceRefs: StudySourceRef[];
  contextText: string;
};

function safeText(value: unknown, max = 1400) {
  if (typeof value !== "string") return "";

  return value
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function safePoints(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value
    .filter(
      (item): item is string =>
        typeof item === "string",
    )
    .map((item) =>
      item.replace(/\s+/g, " ").trim(),
    )
    .filter(Boolean)
    .slice(0, 8);
}

export async function loadStudySourceContext({
  supabase,
  courseId,
  topicIds,
  maxCharacters = 22000,
}: {
  supabase: SupabaseClient;
  courseId: string;
  topicIds: string[];
  maxCharacters?: number;
}): Promise<StudySourceContext> {
  const uniqueTopicIds = Array.from(
    new Set(topicIds.filter(Boolean)),
  );

  if (uniqueTopicIds.length === 0) {
    return {
      topics: [],
      sourceRefs: [],
      contextText: "",
    };
  }

  const [
    { data: topicsData, error: topicsError },
    { data: noteData, error: notesError },
    { data: linkData, error: linksError },
    {
      data: feedbackData,
      error: feedbackError,
    },
    {
      data: assessmentSourceData,
      error: assessmentSourceError,
    },
    {
      data: assessmentQuestionData,
      error: assessmentQuestionError,
    },
  ] = await Promise.all([
    supabase
      .from("course_topics")
      .select(
        "id, name, unit_id, parent_topic_id",
      )
      .eq("course_id", courseId)
      .in("id", uniqueTopicIds),
    supabase
      .from("material_analysis_topic_notes")
      .select(
        "topic_id, course_file_id, summary, key_points",
      )
      .eq("course_id", courseId)
      .in("topic_id", uniqueTopicIds),
    supabase
      .from("course_file_topic_links")
      .select(
        "topic_id, course_file_id",
      )
      .eq("course_id", courseId)
      .in("topic_id", uniqueTopicIds),
    supabase
      .from("assessment_feedback")
      .select(
        "assessment_kind, score_percent, preparedness_percent, difficulty_percent, quiz_similarity_percent, assistant_helpfulness_percent, study_hours, difference_notes, response_status, created_at",
      )
      .eq("course_id", courseId)
      .eq(
        "response_status",
        "completed",
      )
      .order("created_at", {
        ascending: false,
      })
      .limit(16),
    supabase
      .from("assessment_sources")
      .select("id, title, source_type, analysis, question_count, created_at")
      .eq("course_id", courseId)
      .eq("status", "ready")
      .order("created_at", { ascending: false })
      .limit(12),
    supabase
      .from("assessment_source_questions")
      .select("source_id, prompt, choices, correct_answer, question_type, topic_hints, professor_notes")
      .eq("course_id", courseId)
      .order("created_at", { ascending: false })
      .limit(80),
  ]);

  if (topicsError) throw topicsError;
  if (notesError) throw notesError;
  if (linksError) throw linksError;
  if (feedbackError) throw feedbackError;
  if (assessmentSourceError) throw assessmentSourceError;
  if (assessmentQuestionError) throw assessmentQuestionError;

  const assessmentLearning =
    deriveAssessmentLearning(feedbackData ?? []);

  const calibrationText =
    buildAssessmentLearningContext(
      assessmentLearning,
    ).slice(0, 2200);

  const questionsBySource = new Map<string, typeof assessmentQuestionData>();
  for (const question of assessmentQuestionData ?? []) {
    const current = questionsBySource.get(question.source_id) ?? [];
    current.push(question);
    questionsBySource.set(question.source_id, current);
  }

  const assessmentEvidenceText = (assessmentSourceData ?? [])
    .map((source) => {
      const analysis = source.analysis && typeof source.analysis === "object"
        ? source.analysis as Record<string, unknown>
        : {};
      const evidenceQuestions = questionsBySource.get(source.id) ?? [];
      return [
        `REAL ASSESSMENT EVIDENCE: ${source.title} (${source.source_type})`,
        `PROFESSOR PATTERN: ${safeText(JSON.stringify(analysis), 1800)}`,
        evidenceQuestions.length
          ? `REAL QUESTION EXAMPLES:\n${evidenceQuestions.slice(0, 12).map((question) => {
              const choices = Array.isArray(question.choices) && question.choices.length
                ? ` [Choices: ${question.choices.join(" | ")}]`
                : "";
              const answer = question.correct_answer ? ` [Known answer: ${question.correct_answer}]` : "";
              return `- ${question.prompt}${choices}${answer}`;
            }).join("\n")}`
          : "",
      ].filter(Boolean).join("\n");
    })
    .join("\n\n---\n\n")
    .slice(0, 7000);

  const learningContext = [assessmentEvidenceText, calibrationText]
    .filter(Boolean)
    .join("\n\n---\n\n");

  const topics: StudyTopicSource[] = (
    topicsData ?? []
  ).map((topic) => ({
    id: topic.id,
    name: topic.name,
    unitId: topic.unit_id ?? null,
    parentTopicId:
      topic.parent_topic_id ?? null,
  }));

  const fileIds = Array.from(
    new Set(
      [
        ...(noteData ?? []).map(
          (note) => note.course_file_id,
        ),
        ...(linkData ?? []).map(
          (link) => link.course_file_id,
        ),
      ].filter(Boolean),
    ),
  );

  if (fileIds.length === 0) {
    return {
      topics,
      sourceRefs: [],
      contextText: learningContext.slice(0, maxCharacters),
    };
  }

  const [
    { data: filesData, error: filesError },
    {
      data: analysesData,
      error: analysesError,
    },
  ] = await Promise.all([
    supabase
      .from("course_files")
      .select(
        "id, file_name, material_type",
      )
      .eq("course_id", courseId)
      .in("id", fileIds),
    supabase
      .from("material_analyses")
      .select(
        "course_file_id, summary, explanation, raw_analysis",
      )
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
        materialType:
          file.material_type ?? "material",
      },
    ]),
  );

  const analyses = new Map(
    (analysesData ?? []).map(
      (analysis) => [
        analysis.course_file_id,
        analysis,
      ],
    ),
  );

  const sourceTopicMap =
    new Map<string, Set<string>>();

  for (const link of linkData ?? []) {
    if (!sourceTopicMap.has(link.course_file_id)) {
      sourceTopicMap.set(
        link.course_file_id,
        new Set(),
      );
    }

    sourceTopicMap
      .get(link.course_file_id)
      ?.add(link.topic_id);
  }

  for (const note of noteData ?? []) {
    if (!sourceTopicMap.has(note.course_file_id)) {
      sourceTopicMap.set(
        note.course_file_id,
        new Set(),
      );
    }

    sourceTopicMap
      .get(note.course_file_id)
      ?.add(note.topic_id);
  }

  const notesByTopic =
    new Map<string, typeof noteData>();

  for (const note of noteData ?? []) {
    const current =
      notesByTopic.get(note.topic_id) ?? [];
    current.push(note);
    notesByTopic.set(
      note.topic_id,
      current,
    );
  }

  const sourceRefs: StudySourceRef[] =
    fileIds
      .map((fileId) => {
        const file = files.get(fileId);

        if (!file) return null;

        return {
          fileId,
          fileName: file.fileName,
          materialType:
            file.materialType,
          topicIds: Array.from(
            sourceTopicMap.get(fileId) ??
              [],
          ),
        };
      })
      .filter(
        (
          ref,
        ): ref is StudySourceRef =>
          Boolean(ref),
      );

  const blocks: string[] = [];

  for (const topic of topics) {
    const topicNotes =
      notesByTopic.get(topic.id) ?? [];

    const topicLines: string[] = [
      `TOPIC ${topic.id}: ${topic.name}`,
    ];

    for (const note of topicNotes) {
      const file = files.get(
        note.course_file_id,
      );

      if (!file) continue;

      const summary = safeText(
        note.summary,
        1100,
      );
      const points = safePoints(
        note.key_points,
      );

      topicLines.push(
        [
          `SOURCE ${file.id}: ${file.fileName} (${file.materialType})`,
          summary
            ? `SUMMARY: ${summary}`
            : "",
          points.length
            ? `KEY POINTS:\n${points
                .map(
                  (point) => `- ${point}`,
                )
                .join("\n")}`
            : "",
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }

    // Fallback for materials linked to the topic but without
    // dedicated topic notes.
    const linkedFileIds = Array.from(
      sourceTopicMap.entries(),
    )
      .filter(([, ids]) =>
        ids.has(topic.id),
      )
      .map(([fileId]) => fileId);

    for (const fileId of linkedFileIds) {
      if (
        topicNotes.some(
          (note) =>
            note.course_file_id === fileId,
        )
      ) {
        continue;
      }

      const file = files.get(fileId);
      const analysis = analyses.get(fileId);

      if (!file || !analysis) continue;

      const summary = safeText(
        analysis.summary,
        900,
      );
      const explanation = safeText(
        analysis.explanation,
        1000,
      );

      topicLines.push(
        [
          `SOURCE ${file.id}: ${file.fileName} (${file.materialType})`,
          summary
            ? `SUMMARY: ${summary}`
            : "",
          explanation
            ? `EXPLANATION: ${explanation}`
            : "",
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }

    if (topicLines.length > 1) {
      blocks.push(
        topicLines.join("\n\n"),
      );
    }
  }

  const separator =
    learningContext
      ? "\n\n---\n\n"
      : "";

  const materialBudget = Math.max(
    1000,
    maxCharacters -
      learningContext.length -
      separator.length,
  );

  const budgetPerBlock = Math.max(
    1000,
    Math.floor(
      materialBudget /
        Math.max(1, blocks.length),
    ),
  );

  const materialContext = blocks
    .map((block) =>
      block.slice(0, budgetPerBlock),
    )
    .join("\n\n---\n\n")
    .slice(0, materialBudget);

  const contextText = materialContext
    ? `${materialContext}${separator}${learningContext}`.slice(
        0,
        maxCharacters,
      )
    : learningContext.slice(0, maxCharacters);

  return {
    topics,
    sourceRefs,
    contextText,
  };
}
