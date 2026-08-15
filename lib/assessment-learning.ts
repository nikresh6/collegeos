export type AssessmentFeedbackLike = {
  assessment_kind?: unknown;
  score_percent?: unknown;
  preparedness_percent?: unknown;
  difficulty_percent?: unknown;
  quiz_similarity_percent?: unknown;
  assistant_helpfulness_percent?: unknown;
  study_hours?: unknown;
  difference_notes?: unknown;
  response_status?: unknown;
  created_at?: unknown;
};

export type AssessmentLearningSummary = {
  sampleCount: number;
  confidence: number;
  averageScore: number | null;
  averagePreparedness: number | null;
  averageDifficulty: number | null;
  averageQuizSimilarity: number | null;
  averageHelpfulness: number | null;
  averageStudyHours: number | null;
  preparednessGap: number | null;
  studyLoadMultiplier: number;
  targetQuizDifficulty: 1 | 2 | 3;
  practiceMismatch: number | null;
  recentDifferenceNotes: string[];
};

function clamp(
  value: number,
  minimum: number,
  maximum: number,
) {
  return Math.max(
    minimum,
    Math.min(maximum, value),
  );
}

function optionalNumber(
  value: unknown,
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

function average(
  values: Array<number | null>,
) {
  const usable = values.filter(
    (value): value is number =>
      value !== null &&
      Number.isFinite(value),
  );

  if (usable.length === 0) {
    return null;
  }

  return (
    usable.reduce(
      (sum, value) =>
        sum + value,
      0,
    ) / usable.length
  );
}

function cleanNote(
  value: unknown,
) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 260);
}

export function deriveAssessmentLearning(
  rows: AssessmentFeedbackLike[],
): AssessmentLearningSummary {
  const completed = rows
    .filter(
      (row) =>
        row.response_status ===
        "completed",
    )
    .slice(0, 20);

  const sampleCount =
    completed.length;

  const scores = completed.map(
    (row) => {
      const value =
        optionalNumber(
          row.score_percent,
        );

      return value === null
        ? null
        : clamp(value, 0, 100);
    },
  );

  const preparedness =
    completed.map((row) => {
      const value =
        optionalNumber(
          row.preparedness_percent,
        );

      return value === null
        ? null
        : clamp(value, 0, 100);
    });

  const difficulty =
    completed.map((row) => {
      const value =
        optionalNumber(
          row.difficulty_percent,
        );

      return value === null
        ? null
        : clamp(value, 0, 100);
    });

  const quizSimilarity =
    completed.map((row) => {
      const value =
        optionalNumber(
          row.quiz_similarity_percent,
        );

      return value === null
        ? null
        : clamp(value, 0, 100);
    });

  const helpfulness =
    completed.map((row) => {
      const value =
        optionalNumber(
          row.assistant_helpfulness_percent,
        );

      return value === null
        ? null
        : clamp(value, 0, 100);
    });

  const studyHours =
    completed.map((row) => {
      const value =
        optionalNumber(
          row.study_hours,
        );

      return value === null
        ? null
        : clamp(value, 0, 250);
    });

  const averageScore =
    average(scores);
  const averagePreparedness =
    average(preparedness);
  const averageDifficulty =
    average(difficulty);
  const averageQuizSimilarity =
    average(quizSimilarity);
  const averageHelpfulness =
    average(helpfulness);
  const averageStudyHours =
    average(studyHours);

  const preparednessGap =
    averagePreparedness !== null &&
    averageScore !== null
      ? averagePreparedness -
        averageScore
      : null;

  let rawStudyLoad = 1;

  if (averageScore !== null) {
    rawStudyLoad +=
      Math.max(
        0,
        82 - averageScore,
      ) * 0.006;

    rawStudyLoad -=
      Math.max(
        0,
        averageScore - 93,
      ) * 0.004;
  }

  if (averageDifficulty !== null) {
    rawStudyLoad +=
      Math.max(
        0,
        averageDifficulty - 55,
      ) * 0.004;
  }

  if (
    preparednessGap !== null &&
    preparednessGap > 8
  ) {
    rawStudyLoad +=
      Math.min(
        0.13,
        (preparednessGap - 8) *
          0.004,
      );
  }

  if (
    averageScore !== null &&
    averageScore < 80 &&
    averageStudyHours !== null
  ) {
    rawStudyLoad +=
      averageStudyHours < 3
        ? 0.1
        : averageStudyHours > 8
          ? 0.025
          : 0.055;
  }

  const confidence =
    clamp(
      sampleCount / 5,
      0,
      1,
    );

  const studyLoadMultiplier =
    sampleCount === 0
      ? 1
      : clamp(
          1 +
            (clamp(
              rawStudyLoad,
              0.85,
              1.5,
            ) -
              1) *
              (
                0.35 +
                confidence * 0.65
              ),
          0.88,
          1.45,
        );

  const difficultySignal =
    averageDifficulty ?? 55;

  const scoreSignal =
    averageScore ?? 82;

  const targetRaw =
    1.7 +
    (difficultySignal - 50) /
      45 +
    (82 - scoreSignal) / 32;

  const targetQuizDifficulty =
    clamp(
      Math.round(targetRaw),
      1,
      3,
    ) as 1 | 2 | 3;

  const practiceMismatch =
    averageQuizSimilarity === null
      ? null
      : clamp(
          100 -
            averageQuizSimilarity,
          0,
          100,
        );

  const recentDifferenceNotes =
    completed
      .map((row) => ({
        note: cleanNote(
          row.difference_notes,
        ),
        createdAt:
          typeof row.created_at ===
          "string"
            ? row.created_at
            : "",
      }))
      .filter(
        (item) =>
          Boolean(item.note),
      )
      .sort((a, b) =>
        b.createdAt.localeCompare(
          a.createdAt,
        ),
      )
      .map((item) => item.note)
      .slice(0, 4);

  return {
    sampleCount,
    confidence,
    averageScore,
    averagePreparedness,
    averageDifficulty,
    averageQuizSimilarity,
    averageHelpfulness,
    averageStudyHours,
    preparednessGap,
    studyLoadMultiplier,
    targetQuizDifficulty,
    practiceMismatch,
    recentDifferenceNotes,
  };
}

function percentText(
  value: number | null,
) {
  return value === null
    ? null
    : `${Math.round(value)}%`;
}

export function buildAssessmentLearningContext(
  summary: AssessmentLearningSummary,
) {
  if (summary.sampleCount === 0) {
    return "";
  }

  const lines: string[] = [
    "LEARNING CALIBRATION FROM REAL GRADES",
    "This section is strategy/style feedback only. Never treat it as course facts, source evidence, or answers.",
    `Evidence: ${summary.sampleCount} completed post-grade reflection${summary.sampleCount === 1 ? "" : "s"}.`,
    `Target practice difficulty: ${summary.targetQuizDifficulty}/3.`,
  ];

  const score =
    percentText(
      summary.averageScore,
    );
  const preparedness =
    percentText(
      summary.averagePreparedness,
    );
  const difficulty =
    percentText(
      summary.averageDifficulty,
    );

  if (score) {
    lines.push(
      `Average real graded score: ${score}.`,
    );
  }

  if (preparedness) {
    lines.push(
      `Average self-reported preparedness: ${preparedness}.`,
    );
  }

  if (difficulty) {
    lines.push(
      `Average real-assessment difficulty: ${difficulty}.`,
    );
  }

  if (
    summary.preparednessGap !==
      null &&
    summary.preparednessGap > 10
  ) {
    lines.push(
      "The learner has tended to feel more prepared than the resulting score suggests. Practice should expose weak distinctions, transfer gaps, and false confidence earlier.",
    );
  } else if (
    summary.preparednessGap !==
      null &&
    summary.preparednessGap < -10
  ) {
    lines.push(
      "The learner has tended to outperform how prepared they felt. Keep challenge high without adding unnecessary volume.",
    );
  }

  if (
    summary.practiceMismatch !==
      null
  ) {
    lines.push(
      `Practice-to-assessment mismatch: ${Math.round(
        summary.practiceMismatch,
      )}/100.`,
    );

    if (
      summary.practiceMismatch >=
      35
    ) {
      lines.push(
        "Make practice transfer more closely to the real assessments: favor application, discrimination between similar ideas, and less predictable phrasing while remaining strictly grounded in the supplied course material.",
      );
    }
  }

  if (
    summary.averageHelpfulness !==
      null &&
    summary.averageHelpfulness < 55
  ) {
    lines.push(
      "For assignment-style work, prior CollegeOS help has not felt sufficiently useful. Prefer concise reasoning, concrete course-grounded examples, and fewer generic explanations.",
    );
  }

  if (
    summary.averageStudyHours !==
      null
  ) {
    lines.push(
      `Average reported study time per reflected graded item: ${summary.averageStudyHours.toFixed(
        1,
      )} hours.`,
    );

    if (
      summary.averageStudyHours >
        8 &&
      summary.averageScore !== null &&
      summary.averageScore < 82
    ) {
      lines.push(
        "High study time has not translated proportionally into score. Prioritize targeted weak-topic practice and retrieval over simply increasing volume.",
      );
    }
  }

  if (
    summary.recentDifferenceNotes.length >
    0
  ) {
    lines.push(
      "Recent learner observations about how real assessments differed from practice:",
    );

    for (
      const note of
      summary.recentDifferenceNotes
    ) {
      lines.push(`- ${note}`);
    }
  }

  return lines.join("\n");
}
