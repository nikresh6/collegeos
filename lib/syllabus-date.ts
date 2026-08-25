const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

const MONTH_PATTERN =
  "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec";

function validIsoDate(year: number, month: number, day: number) {
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1) {
    return null;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function yearFromText(dateText: string, term: string) {
  const fourDigit = `${dateText} ${term}`.match(/\b(19\d{2}|20\d{2}|21\d{2})\b/);
  if (fourDigit) return Number(fourDigit[1]);

  const termYear = term.match(/\b(?:fall|spring|summer|winter)\s*['’]?(\d{2})\b/i);
  return termYear ? 2000 + Number(termYear[1]) : null;
}

export function parseSyllabusDateRange(dateText: string, term: string) {
  const clean = dateText
    .trim()
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ");

  if (!clean) {
    return { start: null as string | null, end: null as string | null };
  }

  const isoRange = clean.match(
    /\b(\d{4})-(\d{1,2})-(\d{1,2})(?:\s*(?:-|to|through)\s*(?:(\d{4})-)?(\d{1,2})-(\d{1,2}))?\b/i,
  );
  if (isoRange) {
    const start = validIsoDate(
      Number(isoRange[1]),
      Number(isoRange[2]),
      Number(isoRange[3]),
    );
    const end = isoRange[6]
      ? validIsoDate(
          Number(isoRange[4] || isoRange[1]),
          Number(isoRange[5]),
          Number(isoRange[6]),
        )
      : null;
    return { start, end: end === start ? null : end };
  }

  const fallbackYear = yearFromText(clean, term);
  const numeric = clean.match(
    /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?:\s*(?:-|to|through)\s*(?:(\d{1,2})\/)?(\d{1,2})(?:\/(\d{2,4}))?)?\b/i,
  );
  if (numeric) {
    const normalizeYear = (raw: string | undefined) => {
      if (!raw) return fallbackYear;
      const value = Number(raw);
      return value < 100 ? 2000 + value : value;
    };
    const startYear = normalizeYear(numeric[3]);
    const endYear = normalizeYear(numeric[6]) ?? startYear;
    if (startYear && endYear) {
      const startMonth = Number(numeric[1]);
      const start = validIsoDate(startYear, startMonth, Number(numeric[2]));
      const end = numeric[5]
        ? validIsoDate(
            endYear,
            numeric[4] ? Number(numeric[4]) : startMonth,
            Number(numeric[5]),
          )
        : null;
      return { start, end: end === start ? null : end };
    }
  }

  if (!fallbackYear) {
    return { start: null as string | null, end: null as string | null };
  }

  const monthFirst = clean.toLowerCase().match(
    new RegExp(
      `\\b(${MONTH_PATTERN})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*(?:-|to|through)\\s*(?:(${MONTH_PATTERN})\\.?\\s+)?(\\d{1,2})(?:st|nd|rd|th)?)?`,
      "i",
    ),
  );
  if (monthFirst) {
    const startMonth = MONTHS[monthFirst[1].toLowerCase()];
    const endMonth = monthFirst[3]
      ? MONTHS[monthFirst[3].toLowerCase()]
      : startMonth;
    const start = validIsoDate(fallbackYear, startMonth, Number(monthFirst[2]));
    const end = monthFirst[4]
      ? validIsoDate(fallbackYear, endMonth, Number(monthFirst[4]))
      : null;
    return { start, end: end === start ? null : end };
  }

  const dayFirst = clean.toLowerCase().match(
    new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_PATTERN})\\b`, "i"),
  );
  if (dayFirst) {
    return {
      start: validIsoDate(
        fallbackYear,
        MONTHS[dayFirst[2].toLowerCase()],
        Number(dayFirst[1]),
      ),
      end: null as string | null,
    };
  }

  return { start: null as string | null, end: null as string | null };
}
