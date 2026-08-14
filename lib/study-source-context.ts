import type { SupabaseClient } from "@supabase/supabase-js";

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
  ]);

  if (topicsError) throw topicsError;
  if (notesError) throw notesError;
  if (linksError) throw linksError;

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
      contextText: "",
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

  const topicNames = new Map(
    topics.map((topic) => [
      topic.id,
      topic.name,
    ]),
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

  const budgetPerBlock = Math.max(
    1000,
    Math.floor(
      maxCharacters /
        Math.max(1, blocks.length),
    ),
  );

  const contextText = blocks
    .map((block) =>
      block.slice(0, budgetPerBlock),
    )
    .join("\n\n---\n\n")
    .slice(0, maxCharacters);

  return {
    topics,
    sourceRefs,
    contextText,
  };
}