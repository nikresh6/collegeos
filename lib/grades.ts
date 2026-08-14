export type GradeCategoryInput = {
  id: string;
  name: string;
  weight_percent: number;
};

export type GradeItemInput = {
  id: string;
  category_id: string | null;
  name: string;
  points_earned: number;
  points_possible: number;
};

export type GradeScaleInput = {
  letter_grade: string;
  min_percent: number | null;
  max_percent: number | null;
};

export const DEFAULT_COLLEGE_GRADE_SCALE: GradeScaleInput[] = [
  { letter_grade: "A", min_percent: 93, max_percent: 100 },
  { letter_grade: "A-", min_percent: 90, max_percent: 92.999 },
  { letter_grade: "B+", min_percent: 87, max_percent: 89.999 },
  { letter_grade: "B", min_percent: 83, max_percent: 86.999 },
  { letter_grade: "B-", min_percent: 80, max_percent: 82.999 },
  { letter_grade: "C+", min_percent: 77, max_percent: 79.999 },
  { letter_grade: "C", min_percent: 73, max_percent: 76.999 },
  { letter_grade: "C-", min_percent: 70, max_percent: 72.999 },
  { letter_grade: "D+", min_percent: 67, max_percent: 69.999 },
  { letter_grade: "D", min_percent: 63, max_percent: 66.999 },
  { letter_grade: "D-", min_percent: 60, max_percent: 62.999 },
  { letter_grade: "F", min_percent: 0, max_percent: 59.999 },
];

export function effectiveGradeScale(
  rows: GradeScaleInput[],
): GradeScaleInput[] {
  return rows.length > 0 ? rows : DEFAULT_COLLEGE_GRADE_SCALE;
}


export type CategoryPerformance = {
  id: string;
  name: string;
  weightPercent: number;
  earned: number;
  possible: number;
  percent: number | null;
  itemCount: number;
  contribution: number;
};

export type GradeLevel = {
  letterGrade: string;
  minPercent: number;
  maxPercent: number | null;
};

export type GradebookSummary = {
  mode: "weighted" | "points";
  currentPercent: number | null;
  letterGrade: string | null;
  categories: CategoryPerformance[];
  gradedItemCount: number;
  totalEarned: number;
  totalPossible: number;
  activeWeight: number;
  configuredWeight: number;
  coveragePercent: number;
  nextLevel: GradeLevel | null;
  currentLevel: GradeLevel | null;
  levelProgress: number;
  pointsToNextLevel: number | null;
};

export function roundGrade(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function normalizeGradeScale(
  rows: GradeScaleInput[],
): GradeLevel[] {
  return rows
    .map((row) => ({
      letterGrade: row.letter_grade.trim(),
      minPercent:
        row.min_percent === null ? Number.NaN : Number(row.min_percent),
      maxPercent:
        row.max_percent === null ? null : Number(row.max_percent),
    }))
    .filter(
      (row) =>
        row.letterGrade &&
        Number.isFinite(row.minPercent),
    )
    .sort((a, b) => a.minPercent - b.minPercent);
}

export function findGradeLevel(
  percent: number | null,
  scaleRows: GradeScaleInput[],
) {
  if (percent === null || !Number.isFinite(percent)) {
    return {
      currentLevel: null,
      nextLevel: null,
      letterGrade: null,
      levelProgress: 0,
      pointsToNextLevel: null,
    };
  }

  const scale = normalizeGradeScale(
    effectiveGradeScale(scaleRows),
  );

  if (scale.length === 0) {
    return {
      currentLevel: null,
      nextLevel: null,
      letterGrade: null,
      levelProgress: 0,
      pointsToNextLevel: null,
    };
  }

  let currentLevel: GradeLevel | null = null;

  for (const level of scale) {
    if (percent + 1e-9 >= level.minPercent) {
      currentLevel = level;
    }
  }

  const nextLevel =
    scale.find((level) => level.minPercent > percent + 1e-9) ?? null;

  if (!nextLevel) {
    return {
      currentLevel,
      nextLevel: null,
      letterGrade: currentLevel?.letterGrade ?? null,
      levelProgress: 1,
      pointsToNextLevel: 0,
    };
  }

  const floor =
    currentLevel?.minPercent ??
    Math.min(0, nextLevel.minPercent);

  const span = nextLevel.minPercent - floor;
  const progress =
    span <= 0
      ? 0
      : Math.min(
          1,
          Math.max(0, (percent - floor) / span),
        );

  return {
    currentLevel,
    nextLevel,
    letterGrade: currentLevel?.letterGrade ?? null,
    levelProgress: progress,
    pointsToNextLevel: Math.max(
      0,
      nextLevel.minPercent - percent,
    ),
  };
}

export function calculateGradebook(
  categories: GradeCategoryInput[],
  items: GradeItemInput[],
  scaleRows: GradeScaleInput[],
): GradebookSummary {
  const safeItems = items.filter(
    (item) =>
      Number.isFinite(Number(item.points_earned)) &&
      Number.isFinite(Number(item.points_possible)) &&
      Number(item.points_possible) > 0,
  );

  const categoryPerformances: CategoryPerformance[] =
    categories.map((category) => {
      const categoryItems = safeItems.filter(
        (item) => item.category_id === category.id,
      );

      const earned = categoryItems.reduce(
        (sum, item) => sum + Number(item.points_earned),
        0,
      );

      const possible = categoryItems.reduce(
        (sum, item) => sum + Number(item.points_possible),
        0,
      );

      const percent =
        possible > 0 ? (earned / possible) * 100 : null;

      const weightPercent = Math.max(
        0,
        Number(category.weight_percent || 0),
      );

      return {
        id: category.id,
        name: category.name,
        weightPercent,
        earned,
        possible,
        percent,
        itemCount: categoryItems.length,
        contribution:
          percent === null
            ? 0
            : (percent * weightPercent) / 100,
      };
    });

  const configuredWeight = categoryPerformances.reduce(
    (sum, category) => sum + category.weightPercent,
    0,
  );

  const hasWeights = configuredWeight > 0.0001;

  let currentPercent: number | null = null;
  let activeWeight = 0;

  if (hasWeights) {
    const activeCategories = categoryPerformances.filter(
      (category) =>
        category.percent !== null &&
        category.weightPercent > 0,
    );

    activeWeight = activeCategories.reduce(
      (sum, category) => sum + category.weightPercent,
      0,
    );

    if (activeWeight > 0) {
      const weightedContribution = activeCategories.reduce(
        (sum, category) =>
          sum +
          ((category.percent ?? 0) * category.weightPercent) /
            100,
        0,
      );

      currentPercent =
        (weightedContribution / activeWeight) * 100;
    }
  } else {
    const totalEarned = safeItems.reduce(
      (sum, item) => sum + Number(item.points_earned),
      0,
    );
    const totalPossible = safeItems.reduce(
      (sum, item) => sum + Number(item.points_possible),
      0,
    );

    if (totalPossible > 0) {
      currentPercent = (totalEarned / totalPossible) * 100;
    }
  }

  const totalEarned = safeItems.reduce(
    (sum, item) => sum + Number(item.points_earned),
    0,
  );
  const totalPossible = safeItems.reduce(
    (sum, item) => sum + Number(item.points_possible),
    0,
  );

  const gradeLevel = findGradeLevel(
    currentPercent,
    scaleRows,
  );

  const coveragePercent =
    hasWeights && configuredWeight > 0
      ? Math.min(
          100,
          Math.max(0, (activeWeight / configuredWeight) * 100),
        )
      : totalPossible > 0
        ? 100
        : 0;

  return {
    mode: hasWeights ? "weighted" : "points",
    currentPercent:
      currentPercent === null
        ? null
        : roundGrade(currentPercent),
    letterGrade: gradeLevel.letterGrade,
    categories: categoryPerformances.map((category) => ({
      ...category,
      earned: roundGrade(category.earned),
      possible: roundGrade(category.possible),
      percent:
        category.percent === null
          ? null
          : roundGrade(category.percent),
      contribution: roundGrade(category.contribution),
    })),
    gradedItemCount: safeItems.length,
    totalEarned: roundGrade(totalEarned),
    totalPossible: roundGrade(totalPossible),
    activeWeight: roundGrade(activeWeight),
    configuredWeight: roundGrade(configuredWeight),
    coveragePercent: roundGrade(coveragePercent),
    nextLevel: gradeLevel.nextLevel,
    currentLevel: gradeLevel.currentLevel,
    levelProgress: gradeLevel.levelProgress,
    pointsToNextLevel:
      gradeLevel.pointsToNextLevel === null
        ? null
        : roundGrade(gradeLevel.pointsToNextLevel),
  };
}

export function requiredCategoryAverageForTarget({
  categories,
  items,
  categoryId,
  targetPercent,
}: {
  categories: GradeCategoryInput[];
  items: GradeItemInput[];
  categoryId: string;
  targetPercent: number;
}) {
  const summary = calculateGradebook(categories, items, []);

  if (summary.mode !== "weighted") {
    return null;
  }

  const targetCategory = summary.categories.find(
    (category) => category.id === categoryId,
  );

  if (
    !targetCategory ||
    targetCategory.weightPercent <= 0
  ) {
    return null;
  }

  const otherActive = summary.categories.filter(
    (category) =>
      category.id !== categoryId &&
      category.percent !== null &&
      category.weightPercent > 0,
  );

  const otherContribution = otherActive.reduce(
    (sum, category) =>
      sum +
      ((category.percent ?? 0) * category.weightPercent) /
        100,
    0,
  );

  const targetIsActive = targetCategory.percent !== null;

  const denominatorWeight =
    otherActive.reduce(
      (sum, category) => sum + category.weightPercent,
      0,
    ) +
    targetCategory.weightPercent;

  if (denominatorWeight <= 0) {
    return null;
  }

  const required =
    ((targetPercent * denominatorWeight) / 100 -
      otherContribution) /
    (targetCategory.weightPercent / 100);

  return {
    requiredCategoryPercent: roundGrade(required),
    targetIsActive,
    achievable: required <= 100.0001,
  };
}

export function requiredScoreOnNewItem({
  categories,
  items,
  categoryId,
  pointsPossible,
  targetPercent,
}: {
  categories: GradeCategoryInput[];
  items: GradeItemInput[];
  categoryId: string | null;
  pointsPossible: number;
  targetPercent: number;
}) {
  if (
    !Number.isFinite(pointsPossible) ||
    pointsPossible <= 0
  ) {
    return null;
  }

  const summary = calculateGradebook(categories, items, []);

  if (summary.mode === "points") {
    const requiredPoints =
      (targetPercent / 100) *
        (summary.totalPossible + pointsPossible) -
      summary.totalEarned;

    const resultingWithMax =
      ((summary.totalEarned + pointsPossible) /
        (summary.totalPossible + pointsPossible)) *
      100;

    return {
      requiredPoints: roundGrade(requiredPoints),
      requiredPercent: roundGrade(
        (requiredPoints / pointsPossible) * 100,
      ),
      achievable:
        requiredPoints <= pointsPossible + 1e-9,
      resultingWithMax: roundGrade(resultingWithMax),
      mode: "points" as const,
    };
  }

  if (!categoryId) {
    return null;
  }

  const targetCategory = summary.categories.find(
    (category) => category.id === categoryId,
  );

  if (
    !targetCategory ||
    targetCategory.weightPercent <= 0
  ) {
    return null;
  }

  const otherCategories = summary.categories.filter(
    (category) =>
      category.id !== categoryId &&
      category.percent !== null &&
      category.weightPercent > 0,
  );

  const otherContribution = otherCategories.reduce(
    (sum, category) =>
      sum +
      ((category.percent ?? 0) * category.weightPercent) /
        100,
    0,
  );

  const otherWeight = otherCategories.reduce(
    (sum, category) => sum + category.weightPercent,
    0,
  );

  const denominatorWeight =
    otherWeight + targetCategory.weightPercent;

  const requiredCategoryPercent =
    ((targetPercent * denominatorWeight) / 100 -
      otherContribution) /
    (targetCategory.weightPercent / 100);

  const requiredPoints =
    (requiredCategoryPercent / 100) *
      (targetCategory.possible + pointsPossible) -
    targetCategory.earned;

  const maxCategoryPercent =
    ((targetCategory.earned + pointsPossible) /
      (targetCategory.possible + pointsPossible)) *
    100;

  const resultingWithMax =
    ((otherContribution +
      (maxCategoryPercent *
        targetCategory.weightPercent) /
        100) /
      denominatorWeight) *
    100;

  return {
    requiredPoints: roundGrade(requiredPoints),
    requiredPercent: roundGrade(
      (requiredPoints / pointsPossible) * 100,
    ),
    achievable:
      requiredPoints <= pointsPossible + 1e-9,
    resultingWithMax: roundGrade(resultingWithMax),
    mode: "weighted" as const,
  };
}

export function rankImprovementOpportunities(
  summary: GradebookSummary,
) {
  return summary.categories
    .filter(
      (category) =>
        category.percent !== null &&
        category.weightPercent > 0,
    )
    .map((category) => ({
      ...category,
      opportunityScore:
        category.weightPercent *
        Math.max(0, 100 - (category.percent ?? 0)),
    }))
    .sort(
      (a, b) =>
        b.opportunityScore - a.opportunityScore,
    );
}