import type {
  SyllabusAnalysis,
  SyllabusTopic,
} from "./syllabus-analysis-pipeline";

const MONTH_INDEX: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function compact(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function key(...values: string[]) {
  return values
    .join("|")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function dedupeBy<T>(items: T[], identity: (item: T) => string) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const value = identity(item);
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function cloneAnalysis(value: SyllabusAnalysis): SyllabusAnalysis {
  return {
    courseInfo: { ...value.courseInfo },
    gradingCategories: value.gradingCategories.map((item) => ({ ...item })),
    gradingScale: value.gradingScale.map((item) => ({ ...item })),
    assessments: value.assessments.map((item) => ({ ...item })),
    units: value.units.map((unit) => ({
      ...unit,
      topics: unit.topics.map((topic) => ({ ...topic })),
    })),
    unassignedTopics: value.unassignedTopics.map((topic) => ({ ...topic })),
    importantDates: value.importantDates.map((item) => ({ ...item })),
    policies: value.policies.map((item) => ({ ...item })),
    scheduleNotes: [...value.scheduleNotes],
    warnings: [...value.warnings],
    overallConfidence: value.overallConfidence,
  };
}

function canonicalAssessmentName(value: string) {
  return key(value)
    .replace(/\b(exam|examination|option)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseDateOrdinal(value: string): number | null {
  const text = compact(value).replace(/,/g, " ");
  if (!text) return null;

  let match = text.match(
    /\b(\d{1,2})-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\b/i,
  );
  if (match) {
    const month = MONTH_INDEX[match[2].toLowerCase()];
    const day = Number(match[1]);
    if (month && day >= 1 && day <= 31) return month * 100 + day;
  }

  match = text.match(
    /\b(January|February|March|April|May|June|July|August|September|Sept|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\b/i,
  );
  if (match) {
    const month = MONTH_INDEX[match[1].toLowerCase()];
    const day = Number(match[2]);
    if (month && day >= 1 && day <= 31) return month * 100 + day;
  }

  match = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?\b/);
  if (match) {
    const month = Number(match[1]);
    const day = Number(match[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return month * 100 + day;
    }
  }

  return null;
}

function pureDate(value: string) {
  const text = compact(value);
  return Boolean(
    text &&
      parseDateOrdinal(text) !== null &&
      /^(?:\d{1,2}-(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)|(?:January|February|March|April|May|June|July|August|September|Sept|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)$/i.test(
        text,
      )
  );
}

function repairTopicDate(topic: SyllabusTopic) {
  if (parseDateOrdinal(topic.date) !== null) return topic;
  if (pureDate(topic.reading)) {
    return { ...topic, date: topic.reading, reading: "" };
  }
  if (pureDate(topic.assignment)) {
    return { ...topic, date: topic.assignment, assignment: "" };
  }
  return topic;
}

function reconcileGrading(
  analysis: SyllabusAnalysis,
  deterministicFacts: SyllabusAnalysis,
) {
  if (deterministicFacts.gradingScale.length >= 2) {
    analysis.gradingScale = deterministicFacts.gradingScale.map((item) => ({
      ...item,
    }));
  } else {
    analysis.gradingScale = dedupeBy(
      analysis.gradingScale,
      (item) => compact(item.letterGrade).toUpperCase(),
    );
  }

  const deterministicTotal = deterministicFacts.gradingCategories.reduce(
    (sum, item) => sum + Number(item.weightPercent || 0),
    0,
  );

  if (
    deterministicFacts.gradingCategories.length >= 2 &&
    deterministicTotal >= 99 &&
    deterministicTotal <= 101
  ) {
    analysis.gradingCategories = deterministicFacts.gradingCategories.map(
      (item) => ({ ...item }),
    );
  } else {
    analysis.gradingCategories = dedupeBy(
      analysis.gradingCategories,
      (item) => key(item.name),
    );
  }

  const aggregateMidterms = analysis.gradingCategories.find((item) =>
    /^midterm\s+exams?$/i.test(compact(item.name)),
  );
  if (aggregateMidterms) {
    analysis.gradingCategories = analysis.gradingCategories.filter(
      (item) => !/^midterm\s+\d+$/i.test(compact(item.name)),
    );
  }
}

function applyAssessmentWeights(
  analysis: SyllabusAnalysis,
  sourceText: string,
) {
  const normalized = sourceText.replace(/[–—]/g, "-").replace(/\s+/g, " ");
  const midtermWeights = normalized.match(
    /Midterm\s+Exams?:\s*\(\s*(\d+(?:\.\d+)?)\s*%\s*total\s*;\s*(\d+(?:\.\d+)?)\s*%\s*each\s*\)/i,
  );
  if (!midtermWeights) return;

  const each = Number(midtermWeights[2]);
  if (!Number.isFinite(each)) return;

  analysis.assessments = analysis.assessments.map((assessment) =>
    /^midterm\s+\d+$/i.test(compact(assessment.name))
      ? {
          ...assessment,
          notes: assessment.notes
            ? `${assessment.notes} · ${each}% of final grade.`
            : `${each}% of final grade.`,
        }
      : assessment,
  );
}

function assessmentBoundaries(analysis: SyllabusAnalysis) {
  const candidates = [
    ...analysis.assessments.map((item) => ({ name: item.name, date: item.date })),
    ...analysis.importantDates.map((item) => ({ name: item.name, date: item.date })),
  ].filter((item) => /\b(midterm|final\s+exam|exam\s*\d*)\b/i.test(item.name));

  const byName = new Map<
    string,
    { name: string; date: string; ordinal: number }
  >();

  for (const item of candidates) {
    const ordinal = parseDateOrdinal(item.date);
    if (ordinal === null) continue;
    const identity = canonicalAssessmentName(item.name);
    if (!identity) continue;
    const existing = byName.get(identity);
    if (!existing || ordinal < existing.ordinal) {
      byName.set(identity, {
        name: compact(item.name).replace(/\s+option$/i, ""),
        date: item.date,
        ordinal,
      });
    }
  }

  return [...byName.values()].sort((a, b) => a.ordinal - b.ordinal);
}

function groupTopicsIntoAssessmentUnits(analysis: SyllabusAnalysis) {
  const explicitUnits = analysis.units.filter(
    (unit) => unit.basisType === "explicit_unit" && unit.topics.length > 0,
  );
  if (explicitUnits.length > 0) return;

  const boundaries = assessmentBoundaries(analysis);
  if (boundaries.length === 0) return;

  const allTopics = dedupeBy(
    [
      ...analysis.units.flatMap((unit) => unit.topics),
      ...analysis.unassignedTopics,
    ]
      .map((topic) => repairTopicDate({ ...topic }))
      .filter((topic) => topic.name),
    (topic) => key(topic.name, topic.date, topic.assignment),
  );

  const boundaryNames = new Set(
    boundaries.map((boundary) => canonicalAssessmentName(boundary.name)),
  );

  const dated: Array<{ topic: SyllabusTopic; ordinal: number }> = [];
  const undated: SyllabusTopic[] = [];

  for (const topic of allTopics) {
    const topicBoundaryName = canonicalAssessmentName(topic.name);
    if (
      /\b(midterm|final\s+exam|exam\s*\d*)\b/i.test(topic.name) &&
      boundaryNames.has(topicBoundaryName)
    ) {
      continue;
    }

    const ordinal = parseDateOrdinal(topic.date);
    if (ordinal === null) {
      undated.push(topic);
      continue;
    }
    dated.push({ topic, ordinal });
  }

  dated.sort((a, b) => a.ordinal - b.ordinal);

  const units: SyllabusAnalysis["units"] = [];
  let previousOrdinal = -Infinity;
  let previousName = "";

  for (const boundary of boundaries) {
    const topics = dated
      .filter(
        (item) =>
          item.ordinal > previousOrdinal && item.ordinal < boundary.ordinal,
      )
      .map((item) => item.topic);

    if (topics.length > 0) {
      units.push({
        name: `Unit ${units.length + 1}`,
        description: "",
        basisType: "assessment_block",
        basis: previousName
          ? `Chronological syllabus schedule after ${previousName} and before ${boundary.name}`
          : `Chronological syllabus schedule before ${boundary.name}`,
        assessmentName: boundary.name,
        coverage:
          topics.length > 1
            ? `${topics[0].date} through ${topics[topics.length - 1].date}`
            : topics[0].date,
        topics,
      });
    }

    previousOrdinal = boundary.ordinal;
    previousName = boundary.name;
  }

  const afterLast = dated
    .filter((item) => item.ordinal > previousOrdinal)
    .map((item) => item.topic);
  if (afterLast.length > 0) {
    units.push({
      name: `Unit ${units.length + 1}`,
      description: "",
      basisType: "assessment_block",
      basis: `Chronological syllabus schedule after ${previousName}`,
      assessmentName: "",
      coverage:
        afterLast.length > 1
          ? `${afterLast[0].date} through ${afterLast[afterLast.length - 1].date}`
          : afterLast[0].date,
      topics: afterLast,
    });
  }

  if (units.length > 0) {
    analysis.units = units;
    analysis.unassignedTopics = undated;
  }
}

function addAssignmentsToImportantDates(analysis: SyllabusAnalysis) {
  for (const topic of [
    ...analysis.unassignedTopics,
    ...analysis.units.flatMap((unit) => unit.topics),
  ]) {
    if (!topic.assignment || parseDateOrdinal(topic.date) === null) continue;
    analysis.importantDates.push({
      name: topic.assignment,
      date: topic.date,
      type: "assignment",
    });
  }
}

function dedupeImportantDates(analysis: SyllabusAnalysis) {
  analysis.importantDates = dedupeBy(
    analysis.importantDates,
    (item) =>
      key(canonicalAssessmentName(item.name) || item.name, compact(item.date)),
  );
}

export function reconcileSyllabusAnalysis({
  analysis: input,
  deterministicFacts,
  sourceText,
}: {
  analysis: SyllabusAnalysis;
  deterministicFacts: SyllabusAnalysis;
  sourceText: string;
}): SyllabusAnalysis {
  const analysis = cloneAnalysis(input);

  reconcileGrading(analysis, deterministicFacts);
  applyAssessmentWeights(analysis, sourceText);
  groupTopicsIntoAssessmentUnits(analysis);
  addAssignmentsToImportantDates(analysis);
  dedupeImportantDates(analysis);

  analysis.warnings = dedupeBy(analysis.warnings, (warning) => key(warning)).filter(
    (warning) => {
      const lower = warning.toLowerCase();
      if (analysis.gradingScale.length && lower.includes("grading scale")) {
        return false;
      }
      if (analysis.gradingCategories.length && lower.includes("grading categor")) {
        return false;
      }
      if (analysis.units.length && lower.includes("unit hierarchy")) {
        return false;
      }
      return true;
    },
  );

  return analysis;
}
