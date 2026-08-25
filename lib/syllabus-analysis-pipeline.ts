export type SyllabusTopic = {
  name: string;
  date: string;
  reading: string;
  assignment: string;
};

export type SyllabusAnalysis = {
  courseInfo: {
    courseCode: string;
    courseName: string;
    professor: string;
    term: string;
    credits: number;
  };
  gradingCategories: Array<{
    name: string;
    weightPercent: number;
    notes: string;
  }>;
  gradingScale: Array<{
    letterGrade: string;
    minPercent: number;
    maxPercent: number;
    notes: string;
  }>;
  assessments: Array<{
    name: string;
    type: string;
    date: string;
    notes: string;
  }>;
  units: Array<{
    name: string;
    description: string;
    basisType: "explicit_unit" | "assessment_block";
    basis: string;
    assessmentName: string;
    coverage: string;
    topics: SyllabusTopic[];
  }>;
  unassignedTopics: SyllabusTopic[];
  importantDates: Array<{
    name: string;
    date: string;
    type: string;
  }>;
  policies: Array<{
    category: string;
    summary: string;
  }>;
  scheduleNotes: string[];
  warnings: string[];
  overallConfidence: number;
};

export type SyllabusPipelineChunk = {
  index: number;
  text: string;
  status: "pending" | "ready";
  memory: SyllabusAnalysis | null;
  attempts: number;
  lastError: string | null;
};

export type SyllabusPipelineState = {
  pipelineVersion: 1;
  status: "processing" | "complete";
  fileName: string;
  pageCount: number;
  chunks: SyllabusPipelineChunk[];
  result: SyllabusAnalysis | null;
};

const TARGET_CHUNK_CHARACTERS = 5200;
const CHUNK_OVERLAP_CHARACTERS = 320;

function emptyAnalysis(): SyllabusAnalysis {
  return {
    courseInfo: {
      courseCode: "",
      courseName: "",
      professor: "",
      term: "",
      credits: 0,
    },
    gradingCategories: [],
    gradingScale: [],
    assessments: [],
    units: [],
    unassignedTopics: [],
    importantDates: [],
    policies: [],
    scheduleNotes: [],
    warnings: [],
    overallConfidence: 0,
  };
}

function compact(value: unknown) {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim()
    : "";
}

function numberValue(value: unknown) {
  const parsed = Number(String(value ?? "").replace(/%/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function key(...values: string[]) {
  return values
    .join("|")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalized = key(value);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

export function buildSyllabusChunks(pageTexts: string[]) {
  const pieces: string[] = [];

  pageTexts.forEach((rawPage, pageIndex) => {
    const page = compact(rawPage);
    if (!page) return;

    if (page.length <= TARGET_CHUNK_CHARACTERS) {
      pieces.push(`===== PAGE ${pageIndex + 1} =====\n${page}`);
      return;
    }

    const step = TARGET_CHUNK_CHARACTERS - CHUNK_OVERLAP_CHARACTERS;
    for (let start = 0; start < page.length; start += step) {
      const fragment = page.slice(start, start + TARGET_CHUNK_CHARACTERS);
      pieces.push(
        `===== PAGE ${pageIndex + 1} PART ${Math.floor(start / step) + 1} =====\n${fragment}`,
      );
    }
  });

  const chunks: string[] = [];
  let current = "";

  for (const piece of pieces) {
    if (current && current.length + piece.length + 2 > TARGET_CHUNK_CHARACTERS) {
      chunks.push(current);
      current = "";
    }
    current = current ? `${current}\n\n${piece}` : piece;
  }

  if (current) chunks.push(current);
  return chunks;
}

function unitFor(
  analysis: SyllabusAnalysis,
  unitName: string,
) {
  const normalized = key(unitName);
  let unit = analysis.units.find((candidate) => key(candidate.name) === normalized);
  if (!unit) {
    unit = {
      name: unitName,
      description: "",
      basisType: "explicit_unit",
      basis: "",
      assessmentName: "",
      coverage: "",
      topics: [],
    };
    analysis.units.push(unit);
  }
  return unit;
}

export function parseTaggedSyllabusChunk(text: string): SyllabusAnalysis {
  const analysis = emptyAnalysis();
  const lines = text
    .replace(/^```[^\n]*\n?/i, "")
    .replace(/```$/i, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const fields = line.split("\t").map(compact);
    const tag = fields[0]?.toUpperCase();

    if (tag === "COURSE") {
      analysis.courseInfo = {
        courseCode: fields[1] ?? "",
        courseName: fields[2] ?? "",
        professor: fields[3] ?? "",
        term: fields[4] ?? "",
        credits: numberValue(fields[5]),
      };
    } else if (tag === "GRADE_CATEGORY" && fields[1]) {
      analysis.gradingCategories.push({
        name: fields[1],
        weightPercent: numberValue(fields[2]),
        notes: fields[3] ?? "",
      });
    } else if (tag === "GRADE_SCALE" && fields[1]) {
      analysis.gradingScale.push({
        letterGrade: fields[1],
        minPercent: numberValue(fields[2]),
        maxPercent: numberValue(fields[3]),
        notes: fields[4] ?? "",
      });
    } else if (tag === "ASSESSMENT" && (fields[1] || fields[3])) {
      analysis.assessments.push({
        name: fields[1] ?? "",
        type: fields[2] ?? "",
        date: fields[3] ?? "",
        notes: fields[4] ?? "",
      });
    } else if (tag === "UNIT" && fields[1]) {
      const unit = unitFor(analysis, fields[1]);
      unit.description ||= fields[2] ?? "";
      unit.basisType =
        fields[3] === "assessment_block" ? "assessment_block" : "explicit_unit";
      unit.basis ||= fields[4] ?? "";
      unit.assessmentName ||= fields[5] ?? "";
      unit.coverage ||= fields[6] ?? "";
    } else if (tag === "TOPIC" && fields[2]) {
      const topic = {
        name: fields[2],
        date: fields[3] ?? "",
        reading: fields[4] ?? "",
        assignment: fields[5] ?? "",
      };
      const unitName = fields[1] ?? "UNASSIGNED";
      if (unitName.toUpperCase() === "UNASSIGNED") {
        analysis.unassignedTopics.push(topic);
      } else {
        unitFor(analysis, unitName).topics.push(topic);
      }
    } else if (tag === "DATE" && (fields[1] || fields[2])) {
      analysis.importantDates.push({
        name: fields[1] ?? "",
        date: fields[2] ?? "",
        type: fields[3] ?? "",
      });
    } else if (tag === "POLICY" && (fields[1] || fields[2])) {
      analysis.policies.push({
        category: fields[1] ?? "",
        summary: fields[2] ?? "",
      });
    } else if (tag === "SCHEDULE_NOTE" && fields[1]) {
      analysis.scheduleNotes.push(fields[1]);
    } else if (tag === "WARNING" && fields[1]) {
      analysis.warnings.push(fields[1]);
    } else if (tag === "CONFIDENCE") {
      analysis.overallConfidence = Math.max(
        0,
        Math.min(100, numberValue(fields[1])),
      );
    }
  }

  return analysis;
}

function dedupeBy<T>(items: T[], keyFor: (item: T) => string) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const itemKey = keyFor(item);
    if (!itemKey || seen.has(itemKey)) return false;
    seen.add(itemKey);
    return true;
  });
}

export function mergeSyllabusChunkAnalyses(
  chunks: SyllabusAnalysis[],
): SyllabusAnalysis {
  const merged = emptyAnalysis();

  for (const chunk of chunks) {
    merged.courseInfo.courseCode ||= compact(chunk.courseInfo.courseCode);
    merged.courseInfo.courseName ||= compact(chunk.courseInfo.courseName);
    merged.courseInfo.professor ||= compact(chunk.courseInfo.professor);
    merged.courseInfo.term ||= compact(chunk.courseInfo.term);
    if (!merged.courseInfo.credits && chunk.courseInfo.credits > 0) {
      merged.courseInfo.credits = chunk.courseInfo.credits;
    }

    merged.gradingCategories.push(...chunk.gradingCategories);
    merged.gradingScale.push(...chunk.gradingScale);
    merged.assessments.push(...chunk.assessments);
    merged.importantDates.push(...chunk.importantDates);
    merged.policies.push(...chunk.policies);
    merged.scheduleNotes.push(...chunk.scheduleNotes);
    merged.warnings.push(...chunk.warnings);

    for (const candidate of chunk.units) {
      const unit = unitFor(merged, candidate.name);
      unit.description ||= candidate.description;
      unit.basis ||= candidate.basis;
      unit.assessmentName ||= candidate.assessmentName;
      unit.coverage ||= candidate.coverage;
      if (candidate.basisType === "assessment_block") {
        unit.basisType = "assessment_block";
      }
      unit.topics.push(...candidate.topics);
    }
    merged.unassignedTopics.push(...chunk.unassignedTopics);
  }

  merged.gradingCategories = dedupeBy(
    merged.gradingCategories,
    (item) => key(item.name),
  );
  merged.gradingScale = dedupeBy(
    merged.gradingScale,
    (item) => key(item.letterGrade),
  );
  merged.assessments = dedupeBy(
    merged.assessments,
    (item) => key(item.name, item.date),
  );
  merged.importantDates = dedupeBy(
    merged.importantDates,
    (item) => key(item.name, item.date),
  );
  merged.policies = dedupeBy(
    merged.policies,
    (item) => key(item.category, item.summary),
  );

  for (const unit of merged.units) {
    unit.topics = dedupeBy(
      unit.topics,
      (topic) => key(topic.name, topic.date, topic.assignment),
    );
  }

  const assignedTopicKeys = new Set(
    merged.units.flatMap((unit) =>
      unit.topics.map((topic) => key(topic.name, topic.date, topic.assignment)),
    ),
  );
  merged.unassignedTopics = dedupeBy(
    merged.unassignedTopics.filter(
      (topic) => !assignedTopicKeys.has(key(topic.name, topic.date, topic.assignment)),
    ),
    (topic) => key(topic.name, topic.date, topic.assignment),
  );
  merged.scheduleNotes = uniqueStrings(merged.scheduleNotes);
  merged.warnings = uniqueStrings(merged.warnings);

  const confidenceValues = chunks
    .map((chunk) => chunk.overallConfidence)
    .filter((value) => value > 0);
  merged.overallConfidence = confidenceValues.length
    ? Math.round(
        confidenceValues.reduce((sum, value) => sum + value, 0) /
          confidenceValues.length,
      )
    : 0;

  return merged;
}

export function isSyllabusPipelineState(
  value: unknown,
): value is SyllabusPipelineState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<SyllabusPipelineState>;
  return (
    candidate.pipelineVersion === 1 &&
    (candidate.status === "processing" || candidate.status === "complete") &&
    Array.isArray(candidate.chunks)
  );
}
