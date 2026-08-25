import ICAL from "ical.js";

export type IcsEventDraft = {
  courseId: string;
  title: string;
  itemType: string;
  date: string;
  startTime: string;
  endDate: string;
  endTime: string;
  allDay: boolean;
  location: string;
  notes: string;
  confidence: number;
  startsAt?: string;
  endsAt?: string;
};

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function parts(time: ICAL.Time) {
  return {
    date: `${time.year}-${pad(time.month)}-${pad(time.day)}`,
    time: `${pad(time.hour)}:${pad(time.minute)}`,
  };
}

function inclusiveAllDayEnd(time: ICAL.Time) {
  // RFC 5545 all-day DTEND values are exclusive. Work in calendar fields
  // instead of UTC so an imported date cannot move a day in another timezone.
  return new Date(Date.UTC(time.year, time.month - 1, time.day) - 86_400_000)
    .toISOString()
    .slice(0, 10);
}

export function parseIcs(text: string, courseId: string): IcsEventDraft[] {
  const calendar = new ICAL.Component(ICAL.parse(text));
  const drafts: IcsEventDraft[] = [];
  const rangeStart = new Date();
  rangeStart.setMonth(rangeStart.getMonth() - 6);
  const rangeEnd = new Date();
  rangeEnd.setMonth(rangeEnd.getMonth() + 24);

  function addOccurrence(event: ICAL.Event, start: ICAL.Time, end: ICAL.Time) {
    const startParts = parts(start);
    const endParts = parts(end);
    const allDay = Boolean(start.isDate || event.startDate.isDate);
    drafts.push({
      courseId,
      title: (event.summary || "Course event").slice(0, 200),
      itemType: "other",
      date: startParts.date,
      startTime: allDay ? "" : startParts.time,
      endDate: allDay ? inclusiveAllDayEnd(end) : endParts.date,
      endTime: allDay ? "" : endParts.time,
      allDay,
      location: (event.location || "").slice(0, 300),
      notes: (event.description || "").slice(0, 2000),
      confidence: 100,
      startsAt: start.toJSDate().toISOString(),
      endsAt: end.toJSDate().toISOString(),
    });
  }

  for (const component of calendar.getAllSubcomponents("vevent")) {
    if (drafts.length >= 100) break;
    const event = new ICAL.Event(component);
    if (!event.isRecurring()) {
      const start = event.startDate;
      const end = event.endDate ?? start.clone();
      if (!event.endDate) end.adjust(0, 1, 0, 0);
      addOccurrence(event, start, end);
      continue;
    }

    const iterator = event.iterator();
    for (let scanned = 0; scanned < 2000 && drafts.length < 100; scanned += 1) {
      const next = iterator.next();
      if (!next) break;
      const occurrence = event.getOccurrenceDetails(next);
      const start = occurrence.startDate;
      const startDate = start.toJSDate();
      if (startDate > rangeEnd) break;
      if (startDate < rangeStart) continue;
      addOccurrence(event, start, occurrence.endDate);
    }
  }

  return drafts;
}
