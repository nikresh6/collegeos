import type {
  SyllabusAnalysis,
  SyllabusTopic,
} from "./syllabus-analysis-pipeline";

const DATE_TOKEN =
  "(?:\\d{1,2}-(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\s+\\d{1,2}|\\d{1,2}\\/\\d{1,2}(?:\\/\\d{2,4})?)";

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

function compact(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function key(topic: SyllabusTopic) {
  return `${topic.date}|${topic.name}|${topic.assignment}`
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Extracts explicit dated schedule rows directly from the text geometry emitted
 * by lib/pdf.ts. This is deliberately conservative. It only treats a line as a
 * schedule row when the line begins with a recognizable date and either uses
 * the PDF column separator (`|`) or the very distinctive `DD-Mon` date style.
 * It gives CollegeOS a usable topic timeline even when every AI model is rate
 * limited.
 */
export function deriveDeterministicScheduleFacts(
  sourceText: string,
): SyllabusAnalysis {
  const facts = emptyAnalysis();
  const topics: SyllabusTopic[] = [];
  const seen = new Set<string>();
  const datedLine = new RegExp(`^\\s*(${DATE_TOKEN})\\s*(.*)$`, "i");

  for (const rawLine of sourceText.split(/\r?\n/)) {
    if (!rawLine || /^=+\s*PAGE\s+\d+/i.test(rawLine)) continue;
    const match = rawLine.match(datedLine);
    if (!match) continue;

    const date = compact(match[1]);
    let remainder = match[2].trim();
    if (!remainder) continue;

    const hasColumns = remainder.includes("|");
    const distinctiveShortDate = /^\d{1,2}-(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)$/i.test(
      date,
    );
    if (!hasColumns && !distinctiveShortDate) continue;

    remainder = remainder.replace(/^\|\s*/, "");
    const cells = remainder.split("|").map(compact);
    const name = cells[0] ?? "";
    if (!name || /^(?:topic|topics|class|date|reading|assignment)s?$/i.test(name)) {
      continue;
    }

    const topic: SyllabusTopic = {
      name,
      date,
      reading: cells[1] ?? "",
      assignment: cells.slice(2).filter(Boolean).join(" | "),
    };

    const identity = key(topic);
    if (!identity || seen.has(identity)) continue;
    seen.add(identity);
    topics.push(topic);
  }

  facts.unassignedTopics = topics;
  if (topics.length > 0) {
    facts.overallConfidence = 90;
  }
  return facts;
}
