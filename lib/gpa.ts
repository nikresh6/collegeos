import {
  calculateGradebook,
  effectiveGradeScale,
  normalizeGradeScale,
  type GradeCategoryInput,
  type GradeItemInput,
  type GradeScaleInput,
} from "./grades";

export const LETTER_GRADE_POINTS: Record<string, number> = {
  A: 4.0,
  "A-": 3.7,
  "B+": 3.3,
  B: 3.0,
  "B-": 2.7,
  "C+": 2.3,
  C: 2.0,
  "C-": 1.7,
  "D+": 1.3,
  D: 1.0,
  "D-": 0.7,
  F: 0,
};

export type GpaCourse = {
  id: string;
  code: string;
  name: string;
  credits: number;
  letterGrade: string | null;
  currentPercent: number | null;
};

export type HistoricalGpaCourse = {
  id: string;
  code: string;
  name: string;
  credits: number;
  gradePoints: number | null;
};

export function normalizeLetterGrade(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

export function gradePointForLetter(
  letterGrade: string | null | undefined,
) {
  if (!letterGrade) return null;

  const normalized = normalizeLetterGrade(letterGrade);

  if (normalized === "A+") return 4.0;

  return LETTER_GRADE_POINTS[normalized] ?? null;
}

export function letterGradeForPercent(
  percent: number,
  scaleRows: GradeScaleInput[],
) {
  const scale = normalizeGradeScale(
    effectiveGradeScale(scaleRows),
  );

  let current: string | null = null;

  for (const level of scale) {
    if (percent + 1e-9 >= level.minPercent) {
      current = level.letterGrade;
    }
  }

  return current;
}

export function gradePointFromStoredGrade(
  storedGrade: string | null | undefined,
  scaleRows: GradeScaleInput[] = [],
) {
  if (!storedGrade) return null;

  const trimmed = storedGrade.trim();
  if (!trimmed) return null;

  const directLetter = gradePointForLetter(trimmed);
  if (directLetter !== null) return directLetter;

  const numericMatch = trimmed.match(/-?\d+(?:\.\d+)?/);

  if (!numericMatch) return null;

  const numeric = Number(numericMatch[0]);
  if (!Number.isFinite(numeric)) return null;

  const looksLikeGpa =
    !trimmed.includes("%") && numeric >= 0 && numeric <= 4;

  if (looksLikeGpa) {
    return Math.min(4, Math.max(0, numeric));
  }

  if (numeric >= 0 && numeric <= 100) {
    const letter = letterGradeForPercent(
      numeric,
      scaleRows,
    );

    return gradePointForLetter(letter);
  }

  return null;
}

export function calculateGpa(courses: GpaCourse[]) {
  let qualityPoints = 0;
  let gradedCredits = 0;
  let gradedCourses = 0;

  for (const course of courses) {
    const gradePoints = gradePointForLetter(
      course.letterGrade,
    );

    if (
      gradePoints === null ||
      !Number.isFinite(course.credits) ||
      course.credits <= 0
    ) {
      continue;
    }

    qualityPoints += gradePoints * course.credits;
    gradedCredits += course.credits;
    gradedCourses += 1;
  }

  return {
    gpa:
      gradedCredits > 0
        ? qualityPoints / gradedCredits
        : null,
    qualityPoints,
    gradedCredits,
    gradedCourses,
  };
}

export function calculateTrackedCumulativeGpa({
  activeCourses,
  historicalCourses,
}: {
  activeCourses: GpaCourse[];
  historicalCourses: HistoricalGpaCourse[];
}) {
  const active = calculateGpa(activeCourses);

  let historicalQualityPoints = 0;
  let historicalCredits = 0;
  let historicalCount = 0;

  for (const course of historicalCourses) {
    if (
      course.gradePoints === null ||
      !Number.isFinite(course.credits) ||
      course.credits <= 0
    ) {
      continue;
    }

    historicalQualityPoints +=
      course.gradePoints * course.credits;
    historicalCredits += course.credits;
    historicalCount += 1;
  }

  const totalCredits =
    active.gradedCredits + historicalCredits;

  const totalQualityPoints =
    active.qualityPoints + historicalQualityPoints;

  return {
    gpa:
      totalCredits > 0
        ? totalQualityPoints / totalCredits
        : null,
    credits: totalCredits,
    courseCount:
      active.gradedCourses + historicalCount,
    active,
    historicalCredits,
  };
}

export function goalProgress(
  currentGpa: number | null,
  targetGpa: number,
) {
  if (
    currentGpa === null ||
    !Number.isFinite(currentGpa) ||
    !Number.isFinite(targetGpa) ||
    targetGpa <= 0
  ) {
    return {
      reached: false,
      gap: null,
      progress: 0,
    };
  }

  const gap = Math.max(0, targetGpa - currentGpa);
  const progress = Math.min(
    1,
    Math.max(0, currentGpa / targetGpa),
  );

  return {
    reached: currentGpa + 1e-9 >= targetGpa,
    gap,
    progress,
  };
}

export function projectCourseLetter({
  activeCourses,
  historicalCourses,
  courseId,
  letterGrade,
}: {
  activeCourses: GpaCourse[];
  historicalCourses: HistoricalGpaCourse[];
  courseId: string;
  letterGrade: string;
}) {
  const projectedActive = activeCourses.map((course) =>
    course.id === courseId
      ? {
          ...course,
          letterGrade,
        }
      : course,
  );

  return calculateTrackedCumulativeGpa({
    activeCourses: projectedActive,
    historicalCourses,
  });
}

export function projectWeightedCategoryPercent({
  categories,
  items,
  scale,
  categoryId,
  categoryPercent,
}: {
  categories: GradeCategoryInput[];
  items: GradeItemInput[];
  scale: GradeScaleInput[];
  categoryId: string;
  categoryPercent: number;
}) {
  const current = calculateGradebook(
    categories,
    items,
    scale,
  );

  if (current.mode !== "weighted") {
    return null;
  }

  const targetCategory = current.categories.find(
    (category) => category.id === categoryId,
  );

  if (
    !targetCategory ||
    targetCategory.weightPercent <= 0
  ) {
    return null;
  }

  const activeCategories = current.categories.filter(
    (category) =>
      category.weightPercent > 0 &&
      (category.percent !== null ||
        category.id === categoryId),
  );

  const activeWeight = activeCategories.reduce(
    (sum, category) => sum + category.weightPercent,
    0,
  );

  if (activeWeight <= 0) return null;

  const weightedContribution = activeCategories.reduce(
    (sum, category) => {
      const percent =
        category.id === categoryId
          ? categoryPercent
          : category.percent ?? 0;

      return (
        sum +
        (percent * category.weightPercent) / 100
      );
    },
    0,
  );

  const projectedPercent =
    (weightedContribution / activeWeight) * 100;

  return {
    projectedPercent,
    projectedLetterGrade: letterGradeForPercent(
      projectedPercent,
      scale,
    ),
  };
}