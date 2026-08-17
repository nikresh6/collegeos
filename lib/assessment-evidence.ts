export type AssessmentSourceEvidenceRow = {
  id: string;
  title: string;
  source_type: string;
  source_authority?: string | null;
  style_weight?: number | string | null;
  coverage_weight?: number | string | null;
  analysis?: unknown;
  question_count?: number | string | null;
  unit_id?: string | null;
  assessment_date?: string | null;
  created_at?: string | null;
};

export type AssessmentQuestionEvidenceRow = {
  id: string;
  source_id: string;
  prompt: string;
  choices?: unknown;
  correct_answer?: string | null;
  answer_is_visible?: boolean | null;
  answer_is_verified?: boolean | null;
  answer_verification_method?: string | null;
  answer_evidence_quote?: string | null;
  answer_evidence_page?: string | null;
  answer_evidence_confidence?: number | string | null;
  question_type?: string | null;
};

export type AssessmentQuestionTopicLinkEvidenceRow = {
  question_id: string;
  topic_id: string;
  relevance_score?: number | string | null;
};

export type AssessmentTopicLinkEvidenceRow = {
  source_id: string;
  topic_id: string;
  relevance_score?: number | string | null;
  match_method?: string | null;
  question_count?: number | string | null;
};

export type AssessmentTopicCoverage = {
  topicId: string;
  score: number;
  normalizedScore: number;
  questionCount: number;
  sourceCount: number;
  sourceIds: string[];
  verifiedQuestionCount: number;
  verifiedSourceIds: string[];
  reasons: string[];
};

export type AssessmentSourceRef = {
  sourceId: string;
  title: string;
  sourceType: string;
  authority: string;
  topicIds: string[];
  styleWeight: number;
  coverageWeight: number;
};

export type QuizBlueprintInput = {
  id: string;
  name: string;
  assessmentCoverage: number;
  studyNeed: number;
  materialSourceCount: number;
  verifiedAssessmentQuestionCount: number;
};

export type QuizTopicBlueprint = {
  topicId: string;
  topicName: string;
  targetQuestions: number;
  priority: number;
  reasons: string[];
};

const DEFAULT_WEIGHTS: Record<
  string,
  { style: number; coverage: number }
> = {
  past_exam: { style: 1, coverage: 0.9 },
  past_quiz: { style: 0.9, coverage: 0.75 },
  practice_exam: { style: 0.9, coverage: 1.1 },
  study_guide: { style: 0.25, coverage: 1.2 },
  practice_set: { style: 0.65, coverage: 1 },
  question_set: { style: 0.65, coverage: 0.6 },
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function optionalNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function cleanText(value: unknown, max = 700) {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, max)
    : "";
}

function cleanStringArray(value: unknown, max = 8) {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => cleanText(item, 260))
        .filter(Boolean)
        .slice(0, max)
    : [];
}

function cleanChoices(value: unknown) {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => cleanText(item, 220))
        .filter(Boolean)
        .slice(0, 6)
    : [];
}

function analysisRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function verifiedAnswer(question: AssessmentQuestionEvidenceRow | undefined) {
  if (question?.answer_is_verified !== true) return "";
  if (
    question.answer_verification_method !== "source_text_match" &&
    question.answer_verification_method !== "user_confirmed"
  ) {
    return "";
  }

  if (
    question.answer_verification_method === "source_text_match" &&
    (
      question.answer_is_visible !== true ||
      !cleanText(question.answer_evidence_quote, 1200) ||
      (optionalNumber(question.answer_evidence_confidence) ?? 0) < 0.8
    )
  ) {
    return "";
  }

  return cleanText(question.correct_answer, 420);
}

export function assessmentStyleCalibration(value: unknown) {
  const analysis = analysisRecord(value);

  return JSON.stringify({
    questionStyle: cleanStringArray(analysis.questionStyle, 7),
    difficultySignature: cleanText(analysis.difficultySignature, 420),
    trapPatterns: cleanStringArray(analysis.trapPatterns, 5),
    professorLanguage: cleanStringArray(analysis.professorLanguage, 5),
  });
}

function authorityMultiplier(authority: string) {
  const normalized = authority.toLowerCase();

  if (/professor|instructor|official/.test(normalized)) return 1.2;
  if (/textbook|publisher/.test(normalized)) return 1;
  if (/student|self/.test(normalized)) return 0.8;
  return 0.9;
}

function recencyMultiplier(createdAt: string | null | undefined) {
  if (!createdAt) return 1;

  const timestamp = new Date(createdAt).getTime();
  if (!Number.isFinite(timestamp)) return 1;

  const ageDays = Math.max(0, (Date.now() - timestamp) / 86_400_000);
  return clamp(Math.pow(0.5, ageDays / 730), 0.72, 1);
}

export function assessmentSourceWeights(source: AssessmentSourceEvidenceRow) {
  const defaults = DEFAULT_WEIGHTS[source.source_type] ?? {
    style: 0.5,
    coverage: 0.6,
  };
  const authority = source.source_authority || "unspecified";
  const authorityFactor = authorityMultiplier(authority);
  const recencyFactor = recencyMultiplier(
    source.assessment_date ?? source.created_at,
  );
  const styleOverride = optionalNumber(source.style_weight);
  const coverageOverride = optionalNumber(source.coverage_weight);

  return {
    authority,
    style: clamp(
      (styleOverride ?? defaults.style) * authorityFactor * recencyFactor,
      0,
      2,
    ),
    coverage: clamp(
      (coverageOverride ?? defaults.coverage) * authorityFactor * recencyFactor,
      0,
      2,
    ),
  };
}

export function deriveAssessmentEvidence({
  sources,
  questions,
  topicLinks,
  questionTopicLinks,
  topics,
  calibrationText = "",
}: {
  sources: AssessmentSourceEvidenceRow[];
  questions: AssessmentQuestionEvidenceRow[];
  topicLinks: AssessmentTopicLinkEvidenceRow[];
  questionTopicLinks: AssessmentQuestionTopicLinkEvidenceRow[];
  topics: Array<{ id: string; name: string }>;
  calibrationText?: string;
}) {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const topicNameById = new Map(topics.map((topic) => [topic.id, topic.name]));
  const linksBySource = new Map<string, AssessmentTopicLinkEvidenceRow[]>();

  for (const link of topicLinks) {
    if (!topicNameById.has(link.topic_id) || !sourceById.has(link.source_id)) {
      continue;
    }

    const current = linksBySource.get(link.source_id) ?? [];
    current.push(link);
    linksBySource.set(link.source_id, current);
  }

  const rankedSources = [...sources]
    .map((source) => ({ source, weights: assessmentSourceWeights(source) }))
    .sort(
      (a, b) =>
        b.weights.style - a.weights.style ||
        String(b.source.created_at ?? "").localeCompare(
          String(a.source.created_at ?? ""),
        ),
    );

  const questionTypesBySource = new Map<string, Map<string, number>>();
  for (const question of questions) {
    const type = cleanText(question.question_type || "unknown", 40);
    if (!sourceById.has(question.source_id)) continue;
    const counts =
      questionTypesBySource.get(question.source_id) ?? new Map<string, number>();
    counts.set(
      type,
      (counts.get(type) ?? 0) + 1,
    );
    questionTypesBySource.set(question.source_id, counts);
  }

  const questionTypeCounts = new Map<string, number>();
  for (const [sourceId, counts] of questionTypesBySource) {
    const source = sourceById.get(sourceId);
    if (!source) continue;
    const influence = assessmentSourceWeights(source).style;
    const total = Array.from(counts.values()).reduce(
      (sum, count) => sum + count,
      0,
    );
    if (influence <= 0 || total <= 0) continue;

    for (const [type, count] of counts) {
      questionTypeCounts.set(
        type,
        (questionTypeCounts.get(type) ?? 0) +
          influence * (count / total),
      );
    }
  }

  const styleBlocks = rankedSources.slice(0, 10).map(({ source, weights }) => {
    const analysis = analysisRecord(source.analysis);
    const patterns = cleanStringArray(analysis.questionStyle, 7);
    const traps = cleanStringArray(analysis.trapPatterns, 5);
    const language = cleanStringArray(analysis.professorLanguage, 5);
    const difficulty = cleanText(analysis.difficultySignature, 420);

    return [
      `STYLE SOURCE: ${source.title} (${source.source_type}; ${weights.authority} authority; influence ${weights.style.toFixed(2)})`,
      patterns.length ? `QUESTION FORMS: ${patterns.join(" | ")}` : "",
      difficulty ? `DIFFICULTY PATTERN: ${difficulty}` : "",
      traps.length ? `DISTRACTOR/TRAP PATTERNS: ${traps.join(" | ")}` : "",
      language.length ? `PROFESSOR LANGUAGE: ${language.join(" | ")}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  });

  const typeDistribution = Array.from(questionTypeCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `${type}: ${count.toFixed(1)} weighted`)
    .join(", ");

  const styleContextText = [
    styleBlocks.length
      ? "PROFESSOR STYLE CALIBRATION\nUse this only for wording, cognitive demand, difficulty, and distractor design. It is never factual course evidence."
      : "",
    typeDistribution ? `OBSERVED QUESTION-TYPE MIX: ${typeDistribution}` : "",
    ...styleBlocks,
    calibrationText,
  ]
    .filter(Boolean)
    .join("\n\n---\n\n")
    .slice(0, 6500);

  const questionById = new Map(questions.map((question) => [question.id, question]));
  const verifiedQuestionLinks = questionTopicLinks
    .map((link) => {
      const question = questionById.get(link.question_id);
      const source = question ? sourceById.get(question.source_id) : null;
      const answer = verifiedAnswer(question);

      if (
        !question ||
        !source ||
        !answer ||
        !topicNameById.has(link.topic_id)
      ) {
        return null;
      }

      const weights = assessmentSourceWeights(source);
      const relevance = clamp(optionalNumber(link.relevance_score) ?? 0.7, 0, 1);

      return {
        topicId: link.topic_id,
        question,
        source,
        answer,
        rank: weights.coverage * relevance,
        authority: weights.authority,
        evidenceQuote: cleanText(question.answer_evidence_quote, 360),
        evidencePage: cleanText(question.answer_evidence_page, 80),
        verificationMethod: question.answer_verification_method,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  const includedVerifiedByTopic = new Map<
    string,
    { questionIds: Set<string>; sourceIds: Set<string> }
  >();
  const perTopicGroundingBudget = Math.max(
    1_250,
    Math.floor(12_000 / Math.max(1, topics.length)),
  );
  const assessmentGroundingBlocks: string[] = [];

  for (const topic of topics) {
    const candidates = verifiedQuestionLinks
      .filter((item) => item.topicId === topic.id)
      .sort(
        (a, b) =>
          b.rank - a.rank ||
          a.question.id.localeCompare(b.question.id),
      )
      .slice(0, 5);
    let block = `TOPIC ${topic.id}: ${topic.name}`;
    const included = {
      questionIds: new Set<string>(),
      sourceIds: new Set<string>(),
    };

    for (const example of candidates) {
      const choices = cleanChoices(example.question.choices);
      let evidence = [
        `ASSESSMENT SOURCE ${example.source.id}: ${cleanText(example.source.title, 180)} (${example.source.source_type}; ${example.authority} authority)`,
        `VERIFIED QUESTION: ${cleanText(example.question.prompt, 260)}`,
        choices.length
          ? `CHOICES: ${choices.map((choice) => cleanText(choice, 80)).join(" | ")}`
          : "",
        `${example.verificationMethod === "user_confirmed" ? "USER-CONFIRMED ANSWER KEY" : "SOURCE-MATCHED ANSWER KEY"}: ${cleanText(example.answer, 180)}`,
        example.evidenceQuote
          ? `ANSWER EVIDENCE${example.evidencePage ? ` (${example.evidencePage})` : ""}: ${cleanText(example.evidenceQuote, 220)}`
          : "",
      ]
        .filter(Boolean)
        .join("\n");
      let candidateBlock = `${block}\n\n${evidence}`;

      if (
        candidateBlock.length > perTopicGroundingBudget &&
        included.questionIds.size === 0
      ) {
        evidence = [
          `ASSESSMENT SOURCE ${example.source.id}: ${cleanText(example.source.title, 100)} (${example.source.source_type})`,
          `VERIFIED QUESTION: ${cleanText(example.question.prompt, 180)}`,
          `${example.verificationMethod === "user_confirmed" ? "USER-CONFIRMED ANSWER KEY" : "SOURCE-MATCHED ANSWER KEY"}: ${cleanText(example.answer, 180)}`,
        ].join("\n");
        candidateBlock = `${block}\n\n${evidence}`;
      }

      if (candidateBlock.length > perTopicGroundingBudget) continue;

      block = candidateBlock;
      included.questionIds.add(example.question.id);
      included.sourceIds.add(example.source.id);
    }

    if (included.questionIds.size > 0) {
      includedVerifiedByTopic.set(topic.id, included);
      assessmentGroundingBlocks.push(block);
    }
  }

  const assessmentGroundingContextText =
    assessmentGroundingBlocks.join("\n\n---\n\n");

  const coverageByTopic = new Map<
    string,
    { score: number; questionCount: number; sources: Map<string, number> }
  >();

  for (const link of topicLinks) {
    const source = sourceById.get(link.source_id);
    if (!source || !topicNameById.has(link.topic_id)) continue;

    const weights = assessmentSourceWeights(source);
    const relevance = clamp(optionalNumber(link.relevance_score) ?? 0.7, 0, 1);
    const questionCount = Math.max(0, Math.round(optionalNumber(link.question_count) ?? 0));
    const signal =
      weights.coverage * relevance * (1 + Math.log1p(questionCount) * 0.24);
    const current = coverageByTopic.get(link.topic_id) ?? {
      score: 0,
      questionCount: 0,
      sources: new Map<string, number>(),
    };

    current.score += signal;
    current.questionCount += questionCount;
    current.sources.set(source.id, signal);
    coverageByTopic.set(link.topic_id, current);
  }

  const maximumCoverage = Math.max(
    0,
    ...Array.from(coverageByTopic.values()).map((value) => value.score),
  );

  const coverageSignals: AssessmentTopicCoverage[] = topics.map((topic) => {
    const value = coverageByTopic.get(topic.id);
    const sourcesForTopic = value
      ? Array.from(value.sources.entries()).sort((a, b) => b[1] - a[1])
      : [];
    const reasons = sourcesForTopic.slice(0, 3).map(([sourceId]) => {
      const source = sourceById.get(sourceId);
      const link = (linksBySource.get(sourceId) ?? []).find(
        (candidate) => candidate.topic_id === topic.id,
      );
      const count = Math.max(0, Math.round(optionalNumber(link?.question_count) ?? 0));
      return source
        ? `${source.title} (${source.source_type}; ${assessmentSourceWeights(source).authority} authority${count ? `; ${count} matched question${count === 1 ? "" : "s"}` : ""})`
        : "";
    }).filter(Boolean);

    return {
      topicId: topic.id,
      score: Number((value?.score ?? 0).toFixed(4)),
      normalizedScore:
        maximumCoverage > 0
          ? Number(((value?.score ?? 0) / maximumCoverage).toFixed(4))
          : 0,
      questionCount: value?.questionCount ?? 0,
      sourceCount: value?.sources.size ?? 0,
      sourceIds: sourcesForTopic.map(([sourceId]) => sourceId),
      verifiedQuestionCount:
        includedVerifiedByTopic.get(topic.id)?.questionIds.size ?? 0,
      verifiedSourceIds: Array.from(
        includedVerifiedByTopic.get(topic.id)?.sourceIds ?? [],
      ),
      reasons,
    };
  });

  const coverageContextText = coverageSignals
    .filter((signal) => signal.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((signal) => {
      const topicName = topicNameById.get(signal.topicId) ?? signal.topicId;
      return [
        `TOPIC PRIORITY: ${signal.topicId} — ${topicName}`,
        `WEIGHTED ASSESSMENT COVERAGE: ${signal.normalizedScore.toFixed(2)} (${signal.questionCount} matched questions across ${signal.sourceCount} sources)`,
        signal.reasons.length ? `WHY: ${signal.reasons.join(" | ")}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n")
    .slice(0, 4200);

  const assessmentSourceRefs: AssessmentSourceRef[] = rankedSources
    .map(({ source, weights }) => {
      const topicIds = (linksBySource.get(source.id) ?? []).map(
        (link) => link.topic_id,
      );

      if (topicIds.length === 0) return null;

      return {
        sourceId: source.id,
        title: source.title,
        sourceType: source.source_type,
        authority: weights.authority,
        topicIds: Array.from(new Set(topicIds)),
        styleWeight: Number(weights.style.toFixed(3)),
        coverageWeight: Number(weights.coverage.toFixed(3)),
      };
    })
    .filter((ref): ref is AssessmentSourceRef => Boolean(ref));

  return {
    assessmentGroundingContextText,
    styleContextText,
    coverageContextText,
    coverageSignals,
    assessmentSourceRefs,
  };
}

function normalizeAcross(values: number[]) {
  const maximum = Math.max(0, ...values);
  return values.map((value) => (maximum > 0 ? value / maximum : 0));
}

export function buildQuizTopicBlueprint({
  topics,
  questionCount,
  strategy,
}: {
  topics: QuizBlueprintInput[];
  questionCount: number;
  strategy: "manual" | "adaptive";
}): QuizTopicBlueprint[] {
  const supported = topics.filter(
    (topic) =>
      topic.materialSourceCount > 0 ||
      topic.verifiedAssessmentQuestionCount > 0,
  );
  if (supported.length === 0 || questionCount <= 0) return [];

  const coverage = normalizeAcross(
    supported.map((topic) => Math.max(0, topic.assessmentCoverage)),
  );
  const need = normalizeAcross(
    supported.map((topic) => Math.max(0, topic.studyNeed)),
  );
  const support = normalizeAcross(
    supported.map((topic) => Math.log1p(Math.max(0, topic.materialSourceCount))),
  );

  const ranked = supported
    .map((topic, index) => {
      const priority = strategy === "adaptive"
        ? 0.4 * coverage[index] + 0.35 * need[index] + 0.15 * support[index] + 0.1
        : 0.45 * coverage[index] + 0.15 * need[index] + 0.3 * support[index] + 0.1;
      const reasons: string[] = [];
      if (coverage[index] >= 0.67) reasons.push("strong assessment coverage");
      if (need[index] >= 0.67) reasons.push("low preparedness or limited practice");
      if (support[index] >= 0.67) reasons.push("strong source support");
      if (reasons.length === 0) reasons.push("balanced selected-topic coverage");

      return {
        topicId: topic.id,
        topicName: topic.name,
        priority,
        reasons,
        index,
      };
    })
    .sort((a, b) => b.priority - a.priority || a.index - b.index);

  const active = ranked.slice(0, Math.min(questionCount, ranked.length));
  const allocations = new Map(active.map((topic) => [topic.topicId, 1]));
  let remaining = questionCount - active.length;
  const totalPriority = active.reduce((sum, topic) => sum + topic.priority, 0);

  if (remaining > 0) {
    const shares = active.map((topic) => {
      const exact = totalPriority > 0
        ? (remaining * topic.priority) / totalPriority
        : remaining / active.length;
      const floor = Math.floor(exact);
      allocations.set(topic.topicId, (allocations.get(topic.topicId) ?? 0) + floor);
      return { topic, remainder: exact - floor };
    });

    remaining -= shares.reduce(
      (sum, share) => sum + Math.floor(
        totalPriority > 0
          ? ((questionCount - active.length) * share.topic.priority) / totalPriority
          : (questionCount - active.length) / active.length,
      ),
      0,
    );

    shares
      .sort(
        (a, b) =>
          b.remainder - a.remainder ||
          b.topic.priority - a.topic.priority ||
          a.topic.index - b.topic.index,
      )
      .slice(0, remaining)
      .forEach(({ topic }) => {
        allocations.set(topic.topicId, (allocations.get(topic.topicId) ?? 0) + 1);
      });
  }

  return active
    .sort((a, b) => a.index - b.index)
    .map((topic) => ({
      topicId: topic.topicId,
      topicName: topic.topicName,
      targetQuestions: allocations.get(topic.topicId) ?? 0,
      priority: Number(topic.priority.toFixed(4)),
      reasons: topic.reasons,
    }));
}
