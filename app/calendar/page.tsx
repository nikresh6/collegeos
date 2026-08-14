"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import FullCalendar from "@fullcalendar/react";
import themePlugin from "@fullcalendar/react/themes/classic";
import dayGridPlugin from "@fullcalendar/react/daygrid";
import timeGridPlugin from "@fullcalendar/react/timegrid";
import listPlugin from "@fullcalendar/react/list";
import interactionPlugin from "@fullcalendar/react/interaction";
import "@fullcalendar/react/skeleton.css";
import "@fullcalendar/react/themes/classic/theme.css";
import "@fullcalendar/react/themes/classic/palette.css";
import {
  ArrowLeft,
  BrainCircuit,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock3,
  GripVertical,
  Loader2,
  Lock,
  LockOpen,
  MapPin,
  Plus,
  Settings2,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  AnimatePresence,
  MotionConfig,
  motion,
} from "framer-motion";
import { supabase } from "../../lib/supabase";
import {
  SchoolMark,
  useSchoolIdentity,
} from "../../components/school-identity";

type Course = {
  id: string;
  code: string;
  name: string;
  color: string;
  professor: string | null;
};

type CalendarPreferences = {
  timezone: string;
  setup_completed: boolean;
  wake_time: string;
  bedtime_time: string;
  breakfast_start: string | null;
  breakfast_end: string | null;
  lunch_start: string | null;
  lunch_end: string | null;
  dinner_start: string | null;
  dinner_end: string | null;
  preferred_study_period:
    | "morning"
    | "afternoon"
    | "evening"
    | "mixed";
  min_study_minutes: number;
  default_study_minutes: number;
  max_study_minutes: number;
  break_minutes: number;
  buffer_minutes: number;
};

type CalendarItem = {
  id: string;
  user_id?: string;
  course_id: string | null;
  unit_id: string | null;
  title: string;
  item_type: string;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  location: string | null;
  notes: string | null;
  flexibility: "rigid" | "flexible";
  status: "scheduled" | "completed" | "cancelled";
  source: "manual" | "ai" | "syllabus";
  topic_ids: string[];
  color_override: string | null;
  planner_locked: boolean;
  user_modified_at: string | null;
};

type ClassRule = {
  id: string;
  course_id: string;
  title: string;
  meeting_type: string;
  location: string | null;
  days_of_week: number[];
  start_time: string;
  end_time: string;
  start_date: string;
  end_date: string;
  week_pattern: "every" | "odd" | "even";
  color_override: string | null;
};

type CourseEvent = {
  id: string;
  course_id: string;
  name: string;
  event_type: string;
  start_date: string;
  end_date: string | null;
  notes: string | null;
};

type InspectorDraft = {
  kind: "draft" | "item";
  id: string;
  title: string;
  courseId: string;
  itemType: string;
  start: Date;
  end: Date;
  allDay: boolean;
  allDayStartDate: string | null;
  allDayEndDate: string | null;
  location: string;
  notes: string;
  flexibility: "rigid" | "flexible";
  color: string | null;
  source: "manual" | "ai" | "syllabus";
  topicIds: string[];
  plannerLocked: boolean;
};

const defaultPreferences: CalendarPreferences = {
  timezone:
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    "America/Chicago",
  setup_completed: false,
  wake_time: "07:30",
  bedtime_time: "00:00",
  breakfast_start: "08:00",
  breakfast_end: "08:30",
  lunch_start: "12:00",
  lunch_end: "13:00",
  dinner_start: "18:00",
  dinner_end: "19:00",
  preferred_study_period: "evening",
  min_study_minutes: 25,
  default_study_minutes: 45,
  max_study_minutes: 75,
  break_minutes: 10,
  buffer_minutes: 10,
};

const colorChoices = [
  "#CFAE70",
  "#7AA2F7",
  "#7DC4A7",
  "#D98C8C",
  "#B79CED",
  "#E7A86E",
  "#8CB8C9",
  "#C9C9D1",
];

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function localDateString(date: Date) {
  return `${date.getFullYear()}-${pad(
    date.getMonth() + 1,
  )}-${pad(date.getDate())}`;
}

function localDateTimeInput(date: Date) {
  return `${localDateString(date)}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

function parseLocalInput(value: string) {
  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? new Date()
    : date;
}

function addMinutes(
  date: Date,
  minutes: number,
) {
  return new Date(
    date.getTime() +
      minutes * 60 * 1000,
  );
}

function parseDateOnly(value: string) {
  const [year, month, day] =
    value.split("-").map(Number);

  return new Date(
    year,
    month - 1,
    day,
    12,
    0,
    0,
    0,
  );
}

function addDays(
  date: Date,
  days: number,
) {
  const next = new Date(date);
  next.setDate(
    next.getDate() + days,
  );
  return next;
}

function classOccurs(
  rule: ClassRule,
  date: Date,
) {
  const day =
    localDateString(date);

  if (
    day < rule.start_date ||
    day > rule.end_date ||
    !rule.days_of_week.includes(
      date.getDay(),
    )
  ) {
    return false;
  }

  if (
    rule.week_pattern === "every"
  ) {
    return true;
  }

  const start =
    parseDateOnly(
      rule.start_date,
    );

  const weeks =
    Math.floor(
      (date.getTime() -
        start.getTime()) /
        (7 *
          24 *
          60 *
          60 *
          1000),
    );

  const parity =
    Math.max(0, weeks) % 2;

  return rule.week_pattern ===
    "odd"
    ? parity === 0
    : parity === 1;
}

function combineDateTime(
  date: Date,
  clock: string,
) {
  const [hours, minutes] =
    clock.split(":").map(Number);

  const result =
    new Date(date);

  result.setHours(
    Number.isFinite(hours)
      ? hours
      : 0,
    Number.isFinite(minutes)
      ? minutes
      : 0,
    0,
    0,
  );

  return result;
}

function courseColor(
  courseMap: Map<string, Course>,
  courseId: string | null,
  fallback: string,
) {
  return (
    (courseId
      ? courseMap.get(courseId)?.color
      : null) ?? fallback
  );
}

function readableType(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) =>
      char.toUpperCase(),
    );
}

function compactCalendarTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat(
    undefined,
    {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    },
  ).format(date);
}

function calendarDurationMinutes(
  startsAt: string,
  endsAt: string,
) {
  const start = new Date(startsAt);
  const end = new Date(endsAt);

  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime())
  ) {
    return 0;
  }

  return Math.max(
    0,
    Math.round(
      (end.getTime() -
        start.getTime()) /
        (60 * 1000),
    ),
  );
}


function supabaseErrorMessage(
  label: string,
  error: unknown,
) {
  if (
    error &&
    typeof error === "object"
  ) {
    const value = error as {
      message?: string;
      code?: string;
      details?: string;
      hint?: string;
    };

    const parts = [
      value.message,
      value.code
        ? `code ${value.code}`
        : null,
      value.details,
      value.hint
        ? `Hint: ${value.hint}`
        : null,
    ].filter(Boolean);

    if (parts.length > 0) {
      return `${label}: ${parts.join(" · ")}`;
    }
  }

  return `${label}: Unknown Supabase error`;
}

function sourceLabel(
  source: InspectorDraft["source"],
) {
  if (source === "ai") {
    return "AI study";
  }

  if (source === "syllabus") {
    return "Syllabus";
  }

  return "Calendar";
}

export default function CalendarPage() {
  const router = useRouter();
  const { identity } =
    useSchoolIdentity();

  const calendarRef =
    useRef<FullCalendar | null>(
      null,
    );

  const [courses, setCourses] =
    useState<Course[]>([]);
  const [items, setItems] =
    useState<CalendarItem[]>([]);
  const [classRules, setClassRules] =
    useState<ClassRule[]>([]);
  const [courseEvents, setCourseEvents] =
    useState<CourseEvent[]>([]);
  const [preferences, setPreferences] =
    useState<CalendarPreferences>(
      defaultPreferences,
    );
  const [loading, setLoading] =
    useState(true);
  const [planning, setPlanning] =
    useState(false);
  const [error, setError] =
    useState("");
  const [statusMessage, setStatusMessage] =
    useState("");
  const [calendarTitle, setCalendarTitle] =
    useState("");
  const [calendarView, setCalendarView] =
    useState("timeGridWeek");
  const [visibleStart, setVisibleStart] =
    useState<Date | null>(null);
  const [visibleEnd, setVisibleEnd] =
    useState<Date | null>(null);

  const [inspector, setInspector] =
    useState<InspectorDraft | null>(
      null,
    );
  const [inspectorSaving, setInspectorSaving] =
    useState(false);
  const [focusTitle, setFocusTitle] =
    useState(false);

  const [showRhythm, setShowRhythm] =
    useState(false);
  const [showClassSheet, setShowClassSheet] =
    useState(false);

  const loadEverything =
    useCallback(
      async ({
        silent = false,
      }: {
        silent?: boolean;
      } = {}) => {
        try {
          if (!silent) {
            setLoading(true);
          }

          setError("");

          const {
            data: { session },
            error: sessionError,
          } =
            await supabase.auth.getSession();

          if (sessionError) {
            throw sessionError;
          }

          if (!session) {
            router.replace(
              "/onboarding",
            );
            return;
          }

          const [
            {
              data: courseData,
              error: courseError,
            },
            {
              data: itemData,
              error: itemError,
            },
            {
              data: ruleData,
              error: ruleError,
            },
            {
              data: eventData,
              error: eventError,
            },
            {
              data: preferenceData,
              error: preferenceError,
            },
          ] = await Promise.all([
            supabase
              .from("courses")
              .select(
                "id, code, name, color, professor",
              )
              .is(
                "archived_at",
                null,
              )
              .order(
                "created_at",
                {
                  ascending: true,
                },
              ),
            supabase
              .from(
                "calendar_items",
              )
              .select(
                "id, course_id, unit_id, title, item_type, starts_at, ends_at, all_day, location, notes, flexibility, status, source, topic_ids, color_override, planner_locked, user_modified_at",
              )
              .neq(
                "status",
                "cancelled",
              )
              .order(
                "starts_at",
                {
                  ascending: true,
                },
              ),
            supabase
              .from(
                "class_schedule_rules",
              )
              .select(
                "id, course_id, title, meeting_type, location, days_of_week, start_time, end_time, start_date, end_date, week_pattern, color_override",
              )
              .eq(
                "is_active",
                true,
              ),
            supabase
              .from(
                "course_events",
              )
              .select(
                "id, course_id, name, event_type, start_date, end_date, notes",
              )
              .order(
                "start_date",
                {
                  ascending: true,
                },
              ),
            supabase
              .from(
                "calendar_preferences",
              )
              .select(
                "timezone, setup_completed, wake_time, bedtime_time, breakfast_start, breakfast_end, lunch_start, lunch_end, dinner_start, dinner_end, preferred_study_period, min_study_minutes, default_study_minutes, max_study_minutes, break_minutes, buffer_minutes",
              )
              .eq(
                "user_id",
                session.user.id,
              )
              .maybeSingle(),
          ]);

          if (courseError) {
            throw new Error(
              supabaseErrorMessage(
                "courses",
                courseError,
              ),
            );
          }
          if (itemError) {
            throw new Error(
              supabaseErrorMessage(
                "calendar_items",
                itemError,
              ),
            );
          }
          if (ruleError) {
            throw new Error(
              supabaseErrorMessage(
                "class_schedule_rules",
                ruleError,
              ),
            );
          }
          if (eventError) {
            throw new Error(
              supabaseErrorMessage(
                "course_events",
                eventError,
              ),
            );
          }
          if (
            preferenceError &&
            preferenceError.code !==
              "PGRST116"
          ) {
            throw new Error(
              supabaseErrorMessage(
                "calendar_preferences",
                preferenceError,
              ),
            );
          }

          setCourses(
            (courseData ??
              []) as Course[],
          );

          setItems(
            (itemData ?? []).map(
              (item) => ({
                id: item.id,
                course_id:
                  item.course_id ??
                  null,
                unit_id:
                  item.unit_id ??
                  null,
                title:
                  item.title,
                item_type:
                  item.item_type,
                starts_at:
                  item.starts_at,
                ends_at:
                  item.ends_at,
                all_day:
                  Boolean(
                    item.all_day,
                  ),
                location:
                  item.location ??
                  null,
                notes:
                  item.notes ??
                  null,
                flexibility:
                  item.flexibility,
                status:
                  item.status,
                source:
                  item.source,
                topic_ids:
                  Array.isArray(
                    item.topic_ids,
                  )
                    ? item.topic_ids
                    : [],
                color_override:
                  item.color_override ??
                  null,
                planner_locked:
                  Boolean(
                    item.planner_locked,
                  ),
                user_modified_at:
                  item.user_modified_at ??
                  null,
              }),
            ),
          );

          setClassRules(
            (ruleData ?? []).map(
              (rule) => ({
                id: rule.id,
                course_id:
                  rule.course_id,
                title:
                  rule.title,
                meeting_type:
                  rule.meeting_type,
                location:
                  rule.location ??
                  null,
                days_of_week:
                  Array.isArray(
                    rule.days_of_week,
                  )
                    ? rule.days_of_week.map(
                        Number,
                      )
                    : [],
                start_time:
                  rule.start_time,
                end_time:
                  rule.end_time,
                start_date:
                  rule.start_date,
                end_date:
                  rule.end_date,
                week_pattern:
                  rule.week_pattern,
                color_override:
                  rule.color_override ??
                  null,
              }),
            ),
          );

          setCourseEvents(
            (eventData ??
              []) as CourseEvent[],
          );

          const nextPreferences =
            preferenceData
              ? ({
                  timezone:
                    preferenceData.timezone,
                  setup_completed:
                    Boolean(
                      preferenceData.setup_completed,
                    ),
                  wake_time:
                    preferenceData.wake_time,
                  bedtime_time:
                    preferenceData.bedtime_time,
                  breakfast_start:
                    preferenceData.breakfast_start ??
                    null,
                  breakfast_end:
                    preferenceData.breakfast_end ??
                    null,
                  lunch_start:
                    preferenceData.lunch_start ??
                    null,
                  lunch_end:
                    preferenceData.lunch_end ??
                    null,
                  dinner_start:
                    preferenceData.dinner_start ??
                    null,
                  dinner_end:
                    preferenceData.dinner_end ??
                    null,
                  preferred_study_period:
                    preferenceData.preferred_study_period,
                  min_study_minutes:
                    Number(
                      preferenceData.min_study_minutes ??
                        25,
                    ),
                  default_study_minutes:
                    Number(
                      preferenceData.default_study_minutes ??
                        45,
                    ),
                  max_study_minutes:
                    Number(
                      preferenceData.max_study_minutes ??
                        75,
                    ),
                  break_minutes:
                    Number(
                      preferenceData.break_minutes ??
                        10,
                    ),
                  buffer_minutes:
                    Number(
                      preferenceData.buffer_minutes ??
                        10,
                    ),
                } satisfies CalendarPreferences)
              : {
                  ...defaultPreferences,
                  timezone:
                    Intl.DateTimeFormat().resolvedOptions()
                      .timeZone ||
                    defaultPreferences.timezone,
                };

          setPreferences(
            nextPreferences,
          );

          if (
            !nextPreferences.setup_completed
          ) {
            setShowRhythm(true);
          }

        } catch (loadError) {
          console.warn(
            "Could not load calendar:",
            loadError,
          );

          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load calendar.",
          );
        } finally {
          if (!silent) {
            setLoading(false);
          }
        }
      },
      [router],
    );

  useEffect(() => {
    void loadEverything();
  }, [loadEverything]);

  async function sessionToken() {
    const {
      data: { session },
      error,
    } =
      await supabase.auth.getSession();

    if (error) {
      throw error;
    }

    if (!session) {
      throw new Error(
        "You must be signed in.",
      );
    }

    return session.access_token;
  }

  const courseMap = useMemo(
    () =>
      new Map(
        courses.map((course) => [
          course.id,
          course,
        ]),
      ),
    [courses],
  );

  const visibleItems = useMemo(() => {
    if (!visibleStart || !visibleEnd) {
      return items;
    }

    const start =
      visibleStart.getTime();
    const end =
      visibleEnd.getTime();

    return items.filter((item) => {
      const timestamp =
        new Date(
          item.starts_at,
        ).getTime();

      return (
        Number.isFinite(timestamp) &&
        timestamp >= start &&
        timestamp < end
      );
    });
  }, [
    items,
    visibleStart,
    visibleEnd,
  ]);

  const visibleAiItems = useMemo(
    () =>
      visibleItems
        .filter(
          (item) =>
            item.source === "ai" &&
            item.item_type === "study",
        )
        .sort(
          (a, b) =>
            new Date(
              a.starts_at,
            ).getTime() -
            new Date(
              b.starts_at,
            ).getTime(),
        ),
    [visibleItems],
  );

  const visibleStudyMinutes = useMemo(
    () =>
      visibleAiItems.reduce(
        (total, item) =>
          total +
          calendarDurationMinutes(
            item.starts_at,
            item.ends_at,
          ),
        0,
      ),
    [visibleAiItems],
  );

  const upcomingVisibleItems = useMemo(
    () => {
      const now = Date.now();

      return visibleItems
        .filter(
          (item) =>
            new Date(
              item.ends_at,
            ).getTime() >= now,
        )
        .sort(
          (a, b) =>
            new Date(
              a.starts_at,
            ).getTime() -
            new Date(
              b.starts_at,
            ).getTime(),
        )
        .slice(0, 4);
    },
    [visibleItems],
  );

  function handleCalendarDatesSet(
    info: any,
  ) {
    setCalendarTitle(
      info.view.title ?? "",
    );
    setCalendarView(
      info.view.type ??
        "timeGridWeek",
    );
    setVisibleStart(
      new Date(info.start),
    );
    setVisibleEnd(
      new Date(info.end),
    );
  }

  function moveCalendar(
    direction:
      | "prev"
      | "next"
      | "today",
  ) {
    const api =
      calendarRef.current?.getApi();

    if (!api) {
      return;
    }

    if (direction === "prev") {
      api.prev();
    } else if (
      direction === "next"
    ) {
      api.next();
    } else {
      api.today();
    }
  }

  function changeCalendarView(
    view: string,
  ) {
    calendarRef.current
      ?.getApi()
      .changeView(view);
  }

  function jumpToCalendarItem(
    item: CalendarItem,
  ) {
    const api =
      calendarRef.current?.getApi();
    const start =
      new Date(item.starts_at);

    if (
      !api ||
      Number.isNaN(
        start.getTime(),
      )
    ) {
      return;
    }

    api.changeView(
      "timeGridWeek",
      start,
    );

    window.setTimeout(() => {
      const scrollDate =
        addMinutes(start, -30);
      const hour = Math.max(
        0,
        scrollDate.getHours(),
      );

      api.scrollToTime(
        `${pad(hour)}:${pad(
          scrollDate.getMinutes(),
        )}:00`,
      );
    }, 80);
  }

  const fullCalendarEvents =
    useMemo(() => {
      const events: any[] = [];

      for (const item of items) {
        const accent =
          item.color_override ??
          courseColor(
            courseMap,
            item.course_id,
            identity.primary,
          );

        events.push({
          id: `item:${item.id}`,
          title: item.title,
          start: item.all_day
            ? item.starts_at.slice(0, 10)
            : item.starts_at,
          end: item.all_day
            ? item.ends_at.slice(0, 10)
            : item.ends_at,
          allDay:
            item.all_day,
          editable: true,
          backgroundColor:
            item.flexibility ===
            "flexible"
              ? `${accent}18`
              : `${accent}2C`,
          borderColor: accent,
          textColor:
            "#F5F5F7",
          classNames: [
            "student-calendar-event",
            item.flexibility ===
            "flexible"
              ? "student-calendar-event-flexible"
              : "student-calendar-event-rigid",
            item.source === "ai"
              ? "student-calendar-event-ai"
              : "",
          ].filter(Boolean),
          extendedProps: {
            kind: "item",
            localId: item.id,
            courseId:
              item.course_id,
            itemType:
              item.item_type,
            location:
              item.location,
            notes:
              item.notes,
            flexibility:
              item.flexibility,
            source:
              item.source,
            topicIds:
              item.topic_ids,
            color:
              item.color_override,
            plannerLocked:
              item.planner_locked,
          },
        });
      }

      const rangeStart =
        new Date();
      rangeStart.setMonth(
        rangeStart.getMonth() -
          6,
      );

      const rangeEnd =
        new Date();
      rangeEnd.setMonth(
        rangeEnd.getMonth() +
          18,
      );

      for (
        let cursor =
          new Date(rangeStart);
        cursor <= rangeEnd;
        cursor = addDays(
          cursor,
          1,
        )
      ) {
        for (const rule of classRules) {
          if (
            !classOccurs(
              rule,
              cursor,
            )
          ) {
            continue;
          }

          const accent =
            rule.color_override ??
            courseColor(
              courseMap,
              rule.course_id,
              identity.primary,
            );

          events.push({
            id: `class:${rule.id}:${localDateString(
              cursor,
            )}`,
            groupId: `class:${rule.id}`,
            title: rule.title,
            start: combineDateTime(
              cursor,
              rule.start_time,
            ),
            end: combineDateTime(
              cursor,
              rule.end_time,
            ),
            editable: false,
            backgroundColor: `${accent}34`,
            borderColor: accent,
            textColor:
              "#F5F5F7",
            classNames: [
              "student-calendar-event",
              "student-calendar-event-class",
            ],
            extendedProps: {
              kind: "class",
              courseId:
                rule.course_id,
              itemType:
                rule.meeting_type,
              location:
                rule.location,
              source:
                "manual",
              color: accent,
            },
          });
        }
      }

      for (const event of courseEvents) {
        const accent =
          courseColor(
            courseMap,
            event.course_id,
            identity.primary,
          );

        events.push({
          id: `syllabus:${event.id}`,
          title: event.name,
          start:
            event.start_date,
          end:
            event.end_date ??
            undefined,
          allDay: true,
          editable: false,
          backgroundColor: `${accent}14`,
          borderColor: `${accent}70`,
          textColor:
            "#F5F5F7",
          classNames: [
            "student-calendar-event",
            "student-calendar-event-syllabus",
          ],
          extendedProps: {
            kind: "syllabus",
            courseId:
              event.course_id,
            itemType:
              event.event_type,
            notes:
              event.notes,
            source:
              "syllabus",
            color: accent,
          },
        });
      }

      if (
        inspector?.kind ===
        "draft"
      ) {
        const draftAccent =
          inspector.color ??
          courseColor(
            courseMap,
            inspector.courseId ||
              null,
            identity.primary,
          );

        events.push({
          id: inspector.id,
          title:
            inspector.title ||
            "New event",
          start: inspector.start,
          end: inspector.end,
          allDay:
            inspector.allDay,
          editable: true,
          backgroundColor: `${draftAccent}16`,
          borderColor:
            draftAccent,
          textColor:
            "#F5F5F7",
          classNames: [
            "student-calendar-event",
            "student-calendar-event-flexible",
            "student-calendar-event-draft",
          ],
          extendedProps: {
            kind: "draft",
            courseId:
              inspector.courseId ||
              null,
            itemType:
              inspector.itemType,
            location:
              inspector.location,
            source:
              "manual",
            color:
              inspector.color,
          },
        });
      }

      return events;
    }, [
      classRules,
      courseEvents,
      courseMap,
      identity.primary,
      items,
      inspector,
    ]);

  function draftFromRange(
    start: Date,
    end: Date,
    allDay: boolean,
  ) {
    const id =
      `draft:${crypto.randomUUID()}`;

    const draft: InspectorDraft = {
      kind: "draft",
      id,
      title: "New event",
      courseId: "",
      itemType:
        "personal",
      start,
      end,
      allDay,
      allDayStartDate:
        allDay
          ? localDateString(
              start,
            )
          : null,
      allDayEndDate:
        allDay
          ? localDateString(
              end,
            )
          : null,
      location: "",
      notes: "",
      flexibility:
        "rigid",
      color: null,
      source: "manual",
      topicIds: [],
      plannerLocked:
        false,
    };

    setInspector(draft);
    setFocusTitle(true);
  }

  function handleDateClick(info: any) {
    const start =
      info.date as Date;

    const end = info.allDay
      ? addDays(start, 1)
      : addMinutes(
          start,
          60,
        );

    draftFromRange(
      start,
      end,
      Boolean(info.allDay),
    );
  }

  function handleSelect(info: any) {
    draftFromRange(
      info.start,
      info.end,
      Boolean(info.allDay),
    );

    calendarRef.current
      ?.getApi()
      .unselect();
  }

  function inspectorFromEvent(
    event: any,
  ) {
    if (
      event.extendedProps.kind ===
      "draft"
    ) {
      setFocusTitle(false);
      return;
    }

    if (
      event.extendedProps.kind !==
      "item"
    ) {
      return;
    }

    const source =
      event.extendedProps
        .source as InspectorDraft["source"];

    setInspector({
      kind: "item",
      id:
        event.extendedProps.localId,
      title: event.title,
      courseId:
        event.extendedProps.courseId ??
        "",
      itemType:
        event.extendedProps.itemType ??
        "personal",
      start:
        event.start ??
        new Date(),
      end:
        event.end ??
        addMinutes(
          event.start ??
            new Date(),
          60,
        ),
      allDay:
        Boolean(event.allDay),
      allDayStartDate:
        event.allDay
          ? event.startStr
          : null,
      allDayEndDate:
        event.allDay
          ? event.endStr
          : null,
      location:
        event.extendedProps.location ??
        "",
      notes:
        event.extendedProps.notes ??
        "",
      flexibility:
        event.extendedProps.flexibility ===
        "flexible"
          ? "flexible"
          : "rigid",
      color:
        event.extendedProps.color ??
        null,
      source,
      topicIds:
        Array.isArray(
          event.extendedProps.topicIds,
        )
          ? event.extendedProps.topicIds
          : [],
      plannerLocked:
        Boolean(
          event.extendedProps.plannerLocked,
        ),
    });
  }

  function handleEventClick(
    info: any,
  ) {
    inspectorFromEvent(
      info.event,
    );
  }

  function handleEventDidMount(
    info: any,
  ) {
    info.el.ondblclick = (
      event: MouseEvent,
    ) => {
      event.preventDefault();
      inspectorFromEvent(
        info.event,
      );
      setFocusTitle(true);
    };
  }

  async function patchItem(
    id: string,
    changes: Record<
      string,
      unknown
    >,
  ) {
    const token =
      await sessionToken();

    const response = await fetch(
      "/api/calendar/item",
      {
        method: "PATCH",
        headers: {
          "Content-Type":
            "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          id,
          ...changes,
        }),
      },
    );

    const payload =
      (await response.json()) as {
        ok?: boolean;
        item?: CalendarItem;
        error?: string;
      };

    if (
      !response.ok ||
      !payload.ok ||
      !payload.item
    ) {
      throw new Error(
        payload.error ||
          "Could not update event.",
      );
    }

    setItems((current) =>
      current.map((item) =>
        item.id === id
          ? payload.item as CalendarItem
          : item,
      ),
    );

    return payload.item;
  }

  async function handleEventMove(
    info: any,
  ) {
    const event =
      info.event;

    if (
      event.extendedProps.kind ===
      "draft"
    ) {
      if (
        inspector?.kind !==
        "draft" ||
        inspector.id !==
          event.id
      ) {
        return;
      }

      setInspector({
        ...inspector,
        start:
          event.start ??
          inspector.start,
        end:
          event.end ??
          addMinutes(
            event.start ??
              inspector.start,
            60,
          ),
        allDay:
          Boolean(event.allDay),
      });

      return;
    }

    if (
      event.extendedProps.kind !==
      "item"
    ) {
      info.revert();
      return;
    }

    const id =
      event.extendedProps.localId;

    try {
      await patchItem(id, {
        startsAt:
          event.start?.toISOString(),
        endsAt:
          (
            event.end ??
            addMinutes(
              event.start,
              60,
            )
          ).toISOString(),
        allDay:
          Boolean(event.allDay),
      });

      setStatusMessage(
        event.extendedProps.source ===
          "ai"
          ? "Moved. This AI block is now protected from automatic replanning."
          : "Moved.",
      );
    } catch (moveError) {
      info.revert();
      setError(
        moveError instanceof Error
          ? moveError.message
          : "Could not move event.",
      );
    }
  }

  async function saveInspector() {
    if (!inspector) {
      return;
    }

    try {
      setInspectorSaving(
        true,
      );
      setError("");

      const payload = {
        title:
          inspector.title.trim() ||
          "New event",
        courseId:
          inspector.courseId ||
          null,
        itemType:
          inspector.itemType,
        startsAt:
          inspector.start.toISOString(),
        endsAt:
          inspector.end.toISOString(),
        allDay:
          inspector.allDay,
        location:
          inspector.location,
        notes:
          inspector.notes,
        flexibility:
          inspector.flexibility,
        color:
          inspector.color,
        topicIds:
          inspector.topicIds,
        plannerLocked:
          inspector.plannerLocked,
      };

      const token =
        await sessionToken();

      const response = await fetch(
        "/api/calendar/item",
        {
          method:
            inspector.kind ===
            "draft"
              ? "POST"
              : "PATCH",
          headers: {
            "Content-Type":
              "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(
            inspector.kind ===
              "draft"
              ? payload
              : {
                  id:
                    inspector.id,
                  ...payload,
                },
          ),
        },
      );

      const result =
        (await response.json()) as {
          ok?: boolean;
          item?: CalendarItem;
          error?: string;
        };

      if (
        !response.ok ||
        !result.ok ||
        !result.item
      ) {
        throw new Error(
          result.error ||
            "Could not save event.",
        );
      }

      setItems((current) => {
        const exists =
          current.some(
            (item) =>
              item.id ===
              result.item?.id,
          );

        return exists
          ? current.map(
              (item) =>
                item.id ===
                result.item?.id
                  ? result.item as CalendarItem
                  : item,
            )
          : [
              ...current,
              result.item as CalendarItem,
            ];
      });

      setInspector(null);
      setFocusTitle(false);

      setStatusMessage(
        "Saved.",
      );
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save event.",
      );
    } finally {
      setInspectorSaving(
        false,
      );
    }
  }

  async function setInspectorStudyStatus(
    status:
      | "completed"
      | "cancelled",
  ) {
    if (
      !inspector ||
      inspector.kind !==
        "item" ||
      inspector.itemType !==
        "study"
    ) {
      return;
    }

    try {
      setInspectorSaving(
        true,
      );
      setError("");

      const updated =
        await patchItem(
          inspector.id,
          {
            status,
          },
        );

      if (
        status ===
        "cancelled"
      ) {
        setItems(
          (current) =>
            current.filter(
              (item) =>
                item.id !==
                inspector.id,
            ),
        );
      } else {
        setItems(
          (current) =>
            current.map(
              (item) =>
                item.id ===
                updated.id
                  ? updated
                  : item,
            ),
        );
      }

      setInspector(null);
      setFocusTitle(false);

      setStatusMessage(
        status ===
          "completed"
          ? "Study block completed. Planner learning updated."
          : "Study block skipped. Planner learning updated.",
      );
    } catch (statusError) {
      setError(
        statusError instanceof Error
          ? statusError.message
          : "Could not update study block.",
      );
    } finally {
      setInspectorSaving(false);
    }
  }

  async function deleteInspectorItem() {
    if (
      !inspector ||
      inspector.kind !== "item"
    ) {
      setInspector(null);
      return;
    }

    try {
      setInspectorSaving(
        true,
      );

      const token =
        await sessionToken();

      const response = await fetch(
        "/api/calendar/item",
        {
          method: "DELETE",
          headers: {
            "Content-Type":
              "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            id:
              inspector.id,
          }),
        },
      );

      const payload =
        (await response.json()) as {
          ok?: boolean;
          error?: string;
        };

      if (
        !response.ok ||
        !payload.ok
      ) {
        throw new Error(
          payload.error ||
            "Could not delete event.",
        );
      }

      setItems((current) =>
        current.filter(
          (item) =>
            item.id !==
            inspector.id,
        ),
      );

      setInspector(null);
      setStatusMessage(
        "Deleted.",
      );
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not delete event.",
      );
    } finally {
      setInspectorSaving(
        false,
      );
    }
  }

  async function planStudyWeek() {
    try {
      setPlanning(true);
      setError("");
      setStatusMessage(
        "Building flexible study blocks around your real week…",
      );

      const token =
        await sessionToken();

      const api =
        calendarRef.current?.getApi();

      const currentStart =
        api?.view.currentStart ??
        new Date();

      const weekStart =
        new Date(
          currentStart,
        );

      const monday =
        weekStart.getDay() === 1
          ? weekStart
          : addDays(
              weekStart,
              weekStart.getDay() ===
                0
                ? -6
                : 1 -
                    weekStart.getDay(),
            );

      const response = await fetch(
        "/api/calendar/plan-study",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            weekStart:
              localDateString(
                monday,
              ),
            utcOffsetMinutes:
              new Date().getTimezoneOffset(),
          }),
        },
      );

      const payload =
        (await response.json()) as {
          ok?: boolean;
          error?: string;
          message?: string;
          plannedCount?: number;
          blocks?: Array<{
            startsAt: string;
            endsAt: string;
            title: string;
            courseId: string;
          }>;
        };

      if (
        !response.ok ||
        !payload.ok
      ) {
        throw new Error(
          payload.error ||
            "Could not plan study time.",
        );
      }

      setStatusMessage(
        payload.message ??
          "Study plan ready. Drag anything you want to change.",
      );

      await loadEverything({
        silent: true,
      });

      const firstBlock =
        payload.blocks?.[0];

      if (firstBlock) {
        const firstStart =
          new Date(
            firstBlock.startsAt,
          );

        if (
          !Number.isNaN(
            firstStart.getTime(),
          )
        ) {
          api?.changeView(
            "timeGridWeek",
            firstStart,
          );

          window.setTimeout(() => {
            const scrollDate =
              addMinutes(
                firstStart,
                -30,
              );
            const hour =
              Math.max(
                0,
                scrollDate.getHours(),
              );

            api?.scrollToTime(
              `${pad(hour)}:${pad(
                scrollDate.getMinutes(),
              )}:00`,
            );
          }, 100);
        }
      }
    } catch (planError) {
      setError(
        planError instanceof Error
          ? planError.message
          : "Could not plan study time.",
      );
    } finally {
      setPlanning(false);
    }
  }

  const initialView =
    typeof window !==
      "undefined" &&
    window.innerWidth < 768
      ? "timeGridDay"
      : "timeGridWeek";

  const calendarViews = [
    {
      id: "timeGridDay",
      label: "Day",
    },
    {
      id: "timeGridWeek",
      label: "Week",
    },
    {
      id: "dayGridMonth",
      label: "Month",
    },
    {
      id: "listWeek",
      label: "Agenda",
    },
  ];

  return (
    <MotionConfig reducedMotion="user">
      <main className="relative min-h-screen overflow-x-hidden bg-[#080809] text-[#F5F5F7]">
        <motion.div
          aria-hidden
          className="pointer-events-none fixed left-[18%] top-[-280px] h-[580px] w-[760px] rounded-full opacity-[0.09] blur-[130px]"
          style={{
            backgroundColor:
              identity.primary,
          }}
          animate={{
            x: [0, 28, -12, 0],
            y: [0, 14, -8, 0],
            scale: [
              1,
              1.035,
              0.99,
              1,
            ],
          }}
          transition={{
            duration: 24,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />

        <div className="relative mx-auto max-w-[1280px] px-5 pb-24 pt-6 sm:px-8 md:px-10 md:pb-16 md:pt-10">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() =>
                router.push("/")
              }
              className="flex items-center gap-2 rounded-full border border-white/[0.07] bg-white/[0.02] px-3.5 py-2.5 text-[12px] font-medium text-white/48 transition hover:bg-white/[0.045] hover:text-white/78"
            >
              <ArrowLeft size={14} />
              Home
            </button>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() =>
                  setShowRhythm(
                    true,
                  )
                }
                className="flex h-10 w-10 items-center justify-center rounded-full border border-white/[0.07] bg-white/[0.02] text-white/34 transition hover:bg-white/[0.045] hover:text-white/72"
                aria-label="Planning preferences"
              >
                <Settings2
                  size={14}
                />
              </button>

              <button
                type="button"
                onClick={() =>
                  setShowClassSheet(
                    true,
                  )
                }
                disabled={
                  courses.length === 0
                }
                className="hidden items-center gap-2 rounded-full border border-white/[0.07] bg-white/[0.018] px-4 py-2.5 text-[11px] font-medium text-white/46 transition hover:bg-white/[0.04] hover:text-white/76 disabled:opacity-35 sm:flex"
              >
                <CalendarDays
                  size={12}
                />
                Add class
              </button>

              <button
                type="button"
                onClick={() => {
                  const api =
                    calendarRef.current?.getApi();

                  const start =
                    api?.getDate() ??
                    new Date();

                  const rounded =
                    new Date(start);

                  rounded.setMinutes(
                    Math.ceil(
                      rounded.getMinutes() /
                        15,
                    ) * 15,
                    0,
                    0,
                  );

                  draftFromRange(
                    rounded,
                    addMinutes(
                      rounded,
                      60,
                    ),
                    false,
                  );
                }}
                className="flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-[11px] font-medium text-black transition hover:bg-white/90"
              >
                <Plus size={12} />
                New event
              </button>
            </div>
          </div>

          <header className="mt-12 grid gap-9 border-b border-white/[0.065] pb-10 lg:grid-cols-[minmax(0,1fr)_330px] lg:items-end">
            <div>
              <div className="flex items-center gap-3">
                <SchoolMark
                  size={40}
                  quiet
                />
                <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-white/38">
                  Calendar
                </p>
              </div>

              <h1 className="mt-6 max-w-4xl text-[48px] font-medium leading-[0.95] tracking-[-0.062em] sm:text-[62px]">
                Plan the week.
                <br className="hidden sm:block" />
                Change it in seconds.
              </h1>

              <p className="mt-5 max-w-2xl text-[15px] leading-7 text-white/44">
                Your classes, deadlines, personal time, and AI study blocks live
                on one canvas. Click to create, drag to move, stretch to resize,
                and double-click anything you own to edit it.
              </p>
            </div>

            <div className="rounded-[22px] border border-white/[0.07] bg-white/[0.018] p-4">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-white/30">
                  Visible range
                </p>
                <span
                  className="h-2 w-2 rounded-full"
                  style={{
                    backgroundColor:
                      identity.primary,
                  }}
                />
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2">
                <div className="rounded-[15px] border border-white/[0.055] bg-black/10 px-3 py-3">
                  <p className="text-[22px] font-medium tracking-[-0.045em]">
                    {visibleItems.length}
                  </p>
                  <p className="mt-1 text-[9px] text-white/28">
                    scheduled
                  </p>
                </div>

                <div className="rounded-[15px] border border-white/[0.055] bg-black/10 px-3 py-3">
                  <p
                    className="text-[22px] font-medium tracking-[-0.045em]"
                    style={{
                      color:
                        identity.primary,
                    }}
                  >
                    {visibleAiItems.length}
                  </p>
                  <p className="mt-1 text-[9px] text-white/28">
                    AI blocks
                  </p>
                </div>

                <div className="rounded-[15px] border border-white/[0.055] bg-black/10 px-3 py-3">
                  <p className="text-[22px] font-medium tracking-[-0.045em]">
                    {visibleStudyMinutes > 0
                      ? Math.round(
                          visibleStudyMinutes /
                            60,
                        )
                      : 0}
                    <span className="ml-0.5 text-[11px] text-white/28">
                      h
                    </span>
                  </p>
                  <p className="mt-1 text-[9px] text-white/28">
                    AI study
                  </p>
                </div>
              </div>
            </div>
          </header>

          <AnimatePresence mode="wait">
            {(error ||
              statusMessage) && (
              <motion.div
                key={
                  error ||
                  statusMessage
                }
                initial={{
                  opacity: 0,
                  y: -5,
                }}
                animate={{
                  opacity: 1,
                  y: 0,
                }}
                exit={{
                  opacity: 0,
                }}
                className={`mt-5 flex items-start gap-3 rounded-[17px] border px-4 py-3.5 ${
                  error
                    ? "border-red-400/15 bg-red-400/[0.04]"
                    : "border-white/[0.06] bg-white/[0.015]"
                }`}
              >
                <div
                  className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                    error
                      ? "bg-red-300/70"
                      : ""
                  }`}
                  style={
                    error
                      ? undefined
                      : {
                          backgroundColor:
                            identity.primary,
                        }
                  }
                />

                <p
                  className={`text-[11px] leading-5 ${
                    error
                      ? "text-red-100/62"
                      : "text-white/42"
                  }`}
                >
                  {error ||
                    statusMessage}
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          <section className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_286px]">
            <div className="min-w-0 overflow-hidden rounded-[26px] border border-white/[0.07] bg-[#0C0C0E] shadow-[0_28px_90px_rgba(0,0,0,0.22)]">
              <div className="flex flex-col gap-4 border-b border-white/[0.06] px-4 py-4 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex min-w-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      moveCalendar(
                        "prev",
                      )
                    }
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/[0.065] bg-white/[0.018] text-white/38 transition hover:bg-white/[0.045] hover:text-white/72"
                    aria-label="Previous"
                  >
                    <ChevronLeft
                      size={15}
                    />
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      moveCalendar(
                        "next",
                      )
                    }
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/[0.065] bg-white/[0.018] text-white/38 transition hover:bg-white/[0.045] hover:text-white/72"
                    aria-label="Next"
                  >
                    <ChevronRight
                      size={15}
                    />
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      moveCalendar(
                        "today",
                      )
                    }
                    className="ml-1 hidden rounded-full border border-white/[0.065] bg-white/[0.018] px-3.5 py-2 text-[10px] font-medium text-white/42 transition hover:bg-white/[0.045] hover:text-white/72 sm:block"
                  >
                    Today
                  </button>

                  <div className="ml-2 min-w-0">
                    <p className="text-[9px] font-semibold uppercase tracking-[0.13em] text-white/22">
                      {calendarView ===
                      "timeGridDay"
                        ? "Day"
                        : calendarView ===
                            "timeGridWeek"
                          ? "Week"
                          : calendarView ===
                              "dayGridMonth"
                            ? "Month"
                            : "Agenda"}
                    </p>
                    <h2 className="mt-0.5 truncate text-[18px] font-medium tracking-[-0.035em] text-white/78 sm:text-[20px]">
                      {calendarTitle ||
                        "Calendar"}
                    </h2>
                  </div>
                </div>

                <div className="flex items-center gap-1 rounded-full border border-white/[0.06] bg-black/20 p-1">
                  {calendarViews.map(
                    (view) => {
                      const active =
                        calendarView ===
                        view.id;

                      return (
                        <button
                          key={
                            view.id
                          }
                          type="button"
                          onClick={() =>
                            changeCalendarView(
                              view.id,
                            )
                          }
                          className={`rounded-full px-3 py-1.5 text-[9px] font-semibold transition sm:px-3.5 ${
                            active
                              ? "bg-white text-black"
                              : "text-white/30 hover:bg-white/[0.04] hover:text-white/62"
                          }`}
                        >
                          {view.label}
                        </button>
                      );
                    },
                  )}
                </div>
              </div>

              {loading ? (
                <div className="flex min-h-[650px] items-center justify-center">
                  <div className="flex items-center gap-2 text-[11px] text-white/30">
                    <Loader2
                      size={13}
                      className="animate-spin"
                    />
                    Loading calendar
                  </div>
                </div>
              ) : (
                <div className="student-calendar-scroll overflow-x-auto">
                  <div className="student-calendar-shell">
                  <FullCalendar
                    ref={calendarRef}
                    plugins={[
                      themePlugin,
                      dayGridPlugin,
                      timeGridPlugin,
                      listPlugin,
                      interactionPlugin,
                    ]}
                    initialView={
                      initialView
                    }
                    colorScheme="dark"
                    timeZone={
                      preferences.timezone
                    }
                    headerToolbar={
                      false
                    }
                    events={
                      fullCalendarEvents
                    }
                    editable
                    selectable
                    selectMirror
                    eventResizableFromStart
                    nowIndicator
                    allDaySlot
                    slotDuration="00:15:00"
                    snapDuration="00:15:00"
                    slotHeaderInterval="01:00:00"
                    slotHeaderFormat={{
                      hour: "numeric",
                    }}
                    slotMinTime="06:00:00"
                    slotMaxTime="24:00:00"
                    scrollTime="08:00:00"
                    scrollTimeReset={
                      false
                    }
                    height={650}
                    borderless
                    dayMaxEvents
                    weekends
                    firstDay={1}
                    longPressDelay={
                      250
                    }
                    eventLongPressDelay={
                      250
                    }
                    selectLongPressDelay={
                      250
                    }
                    datesSet={
                      handleCalendarDatesSet
                    }
                    dayHeaderAlign="left"
                    dayHeaderClass="student-calendar-day-header"
                    dayHeaderContent={(
                      info: any,
                    ) => {
                      const weekday =
                        new Intl.DateTimeFormat(
                          undefined,
                          {
                            weekday:
                              "short",
                          },
                        ).format(
                          info.date,
                        );
                      const day =
                        info.date.getDate();

                      return (
                        <div
                          className={`flex items-center gap-2 px-1 py-1 ${
                            info.isToday
                              ? "text-white"
                              : "text-white/38"
                          }`}
                        >
                          <span className="text-[9px] font-semibold uppercase tracking-[0.11em]">
                            {weekday}
                          </span>
                          <span
                            className={`flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-[10px] font-medium ${
                              info.isToday
                                ? "text-black"
                                : "text-white/54"
                            }`}
                            style={
                              info.isToday
                                ? {
                                    backgroundColor:
                                      identity.primary,
                                  }
                                : undefined
                            }
                          >
                            {day}
                          </span>
                        </div>
                      );
                    }}
                    allDayHeaderContent={() => (
                      <span className="text-[8px] font-semibold uppercase tracking-[0.12em] text-white/22">
                        All day
                      </span>
                    )}
                    slotHeaderClass="student-calendar-slot-header"
                    slotHeaderContent={(
                      info: any,
                    ) => (
                      <span className="text-[8px] font-medium text-white/20">
                        {info.text}
                      </span>
                    )}
                    slotLaneClass="student-calendar-slot-lane"
                    dayLaneClass="student-calendar-day-lane"
                    dayCellClass="student-calendar-day-cell"
                    viewClass="student-calendar-view"
                    tableClass="student-calendar-table"
                    highlightClass="student-calendar-highlight"
                    eventClass={(
                      info: any,
                    ) => {
                      const props =
                        info.event
                          .extendedProps;

                      return [
                        "student-calendar-event",
                        props.flexibility ===
                        "flexible"
                          ? "student-calendar-event-flexible"
                          : "student-calendar-event-rigid",
                        props.source ===
                        "ai"
                          ? "student-calendar-event-ai"
                          : "",
                        props.kind ===
                        "draft"
                          ? "student-calendar-event-draft"
                          : "",
                      ]
                        .filter(
                          Boolean,
                        )
                        .join(" ");
                    }}
                    dateClick={
                      handleDateClick
                    }
                    select={
                      handleSelect
                    }
                    eventClick={
                      handleEventClick
                    }
                    eventDidMount={
                      handleEventDidMount
                    }
                    eventDrop={
                      handleEventMove
                    }
                    eventResize={
                      handleEventMove
                    }
                    eventContent={(
                      info,
                    ) => (
                      <CalendarEventContent
                        info={
                          info
                        }
                        courseMap={
                          courseMap
                        }
                      />
                    )}
                  />
                  </div>
                </div>
              )}
            </div>

            <aside className="space-y-4">
              <div className="rounded-[24px] border border-white/[0.07] bg-white/[0.018] p-5">
                <div className="flex items-center justify-between">
                  <div
                    className="flex h-9 w-9 items-center justify-center rounded-[13px]"
                    style={{
                      backgroundColor: `${identity.primary}16`,
                      color:
                        identity.primary,
                    }}
                  >
                    <BrainCircuit
                      size={15}
                    />
                  </div>

                  {visibleAiItems.length >
                    0 && (
                    <span className="rounded-full border border-white/[0.06] bg-black/15 px-2.5 py-1 text-[8px] font-semibold uppercase tracking-[0.1em] text-white/28">
                      {
                        visibleAiItems.length
                      }{" "}
                      planned
                    </span>
                  )}
                </div>

                <p className="mt-5 text-[10px] font-semibold uppercase tracking-[0.13em] text-white/26">
                  Adaptive plan
                </p>

                <h3 className="mt-2 text-[22px] font-medium leading-[1.02] tracking-[-0.045em]">
                  Find study time without
                  fighting your week.
                </h3>

                <p className="mt-3 text-[10px] leading-5 text-white/30">
                  Uses classes, sleep,
                  meals, deadlines, and
                  preparedness to place
                  flexible study blocks.
                  Move one yourself and it
                  becomes protected.
                </p>

                <button
                  type="button"
                  onClick={() =>
                    void planStudyWeek()
                  }
                  disabled={
                    planning ||
                    courses.length === 0
                  }
                  className="mt-5 flex w-full items-center justify-center gap-2 rounded-full px-4 py-2.5 text-[10px] font-semibold text-black transition disabled:opacity-35"
                  style={{
                    backgroundColor:
                      identity.primary,
                  }}
                >
                  {planning ? (
                    <Loader2
                      size={11}
                      className="animate-spin"
                    />
                  ) : (
                    <Sparkles
                      size={11}
                    />
                  )}
                  {planning
                    ? "Planning week"
                    : visibleAiItems.length >
                        0
                      ? "Rebuild study plan"
                      : "Plan my study week"}
                </button>

                {visibleAiItems.length >
                  0 && (
                  <div className="mt-5 border-t border-white/[0.055] pt-4">
                    <div className="flex items-center justify-between">
                      <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-white/22">
                        AI blocks
                      </p>
                      <p className="text-[9px] text-white/24">
                        {
                          visibleStudyMinutes
                        }{" "}
                        min
                      </p>
                    </div>

                    <div className="mt-2 space-y-1.5">
                      {visibleAiItems
                        .slice(0, 4)
                        .map(
                          (
                            item,
                          ) => {
                            const course =
                              item.course_id
                                ? courseMap.get(
                                    item.course_id,
                                  )
                                : null;

                            return (
                              <button
                                key={
                                  item.id
                                }
                                type="button"
                                onClick={() =>
                                  jumpToCalendarItem(
                                    item,
                                  )
                                }
                                className="flex w-full items-center gap-3 rounded-[14px] border border-transparent px-2 py-2.5 text-left transition hover:border-white/[0.055] hover:bg-white/[0.018]"
                              >
                                <span
                                  className="h-8 w-1 shrink-0 rounded-full"
                                  style={{
                                    backgroundColor:
                                      item.color_override ??
                                      course?.color ??
                                      identity.primary,
                                  }}
                                />

                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-[10px] font-medium text-white/54">
                                    {
                                      item.title
                                    }
                                  </span>
                                  <span className="mt-1 block text-[8px] text-white/24">
                                    {compactCalendarTime(
                                      item.starts_at,
                                    )}
                                  </span>
                                </span>

                                {item.planner_locked ? (
                                  <Lock
                                    size={10}
                                    className="shrink-0 text-white/26"
                                  />
                                ) : (
                                  <ChevronRight
                                    size={11}
                                    className="shrink-0 text-white/18"
                                  />
                                )}
                              </button>
                            );
                          },
                        )}
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-[24px] border border-white/[0.07] bg-white/[0.012] p-5">
                <div className="flex items-center justify-between">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-white/24">
                    Coming up
                  </p>
                  <Clock3
                    size={12}
                    className="text-white/20"
                  />
                </div>

                {upcomingVisibleItems.length >
                0 ? (
                  <div className="mt-3 space-y-1">
                    {upcomingVisibleItems.map(
                      (item) => {
                        const course =
                          item.course_id
                            ? courseMap.get(
                                item.course_id,
                              )
                            : null;

                        return (
                          <button
                            key={
                              item.id
                            }
                            type="button"
                            onClick={() =>
                              jumpToCalendarItem(
                                item,
                              )
                            }
                            className="flex w-full items-start gap-3 rounded-[14px] px-2 py-2.5 text-left transition hover:bg-white/[0.018]"
                          >
                            <span
                              className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                              style={{
                                backgroundColor:
                                  item.color_override ??
                                  course?.color ??
                                  identity.primary,
                              }}
                            />

                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[10px] font-medium text-white/50">
                                {
                                  item.title
                                }
                              </span>
                              <span className="mt-1 block text-[8px] text-white/22">
                                {compactCalendarTime(
                                  item.starts_at,
                                )}
                                {course
                                  ? ` · ${course.code}`
                                  : ""}
                              </span>
                            </span>
                          </button>
                        );
                      },
                    )}
                  </div>
                ) : (
                  <p className="mt-4 text-[10px] leading-5 text-white/24">
                    No timed events in this
                    visible range yet.
                  </p>
                )}
              </div>

              {courses.length > 0 && (
                <div className="rounded-[24px] border border-white/[0.07] bg-white/[0.012] p-5">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-white/24">
                    Courses
                  </p>

                  <div className="mt-3 space-y-2">
                    {courses.map(
                      (course) => (
                        <div
                          key={
                            course.id
                          }
                          className="flex items-center gap-3"
                        >
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{
                              backgroundColor:
                                course.color,
                            }}
                          />
                          <span className="min-w-0 flex-1 truncate text-[10px] text-white/42">
                            {
                              course.code
                            }
                          </span>
                          <span className="max-w-[120px] truncate text-[8px] text-white/18">
                            {
                              course.name
                            }
                          </span>
                        </div>
                      ),
                    )}
                  </div>
                </div>
              )}
            </aside>
          </section>

          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 px-1 text-[9px] text-white/22">
            <span className="flex items-center gap-2">
              <span className="h-2 w-5 rounded-full border border-white/[0.12] bg-white/[0.04]" />
              Rigid class or event
            </span>

            <span className="flex items-center gap-2">
              <span className="h-2 w-5 rounded-full border border-dashed border-white/[0.18] bg-white/[0.02]" />
              Flexible or AI
            </span>

            <span>
              Click empty time to create. Drag to move. Drag edges to resize.
              Double-click for details.
            </span>
          </div>
        </div>

        <AnimatePresence>
          {inspector && (
            <EventInspector
              draft={inspector}
              courses={courses}
              schoolColor={
                identity.primary
              }
              saving={
                inspectorSaving
              }
              focusTitle={
                focusTitle
              }
              onChange={
                setInspector
              }
              onClose={() => {
                setInspector(null);
                setFocusTitle(false);
              }}
              onSave={() =>
                void saveInspector()
              }
              onDelete={() =>
                void deleteInspectorItem()
              }
              onComplete={() =>
                void setInspectorStudyStatus(
                  "completed",
                )
              }
              onSkip={() =>
                void setInspectorStudyStatus(
                  "cancelled",
                )
              }
            />
          )}

          {showRhythm && (
            <RhythmSheet
              initial={
                preferences
              }
              color={
                identity.primary
              }
              mandatory={
                !preferences.setup_completed
              }
              onClose={() => {
                if (
                  preferences.setup_completed
                ) {
                  setShowRhythm(
                    false,
                  );
                }
              }}
              onSaved={(next) => {
                setPreferences(
                  next,
                );
                setShowRhythm(
                  false,
                );
              }}
            />
          )}

          {showClassSheet && (
            <ClassSheet
              courses={courses}
              color={
                identity.primary
              }
              onClose={() =>
                setShowClassSheet(
                  false,
                )
              }
              onSaved={async () => {
                setShowClassSheet(
                  false,
                );
                await loadEverything({
                  silent: true,
                });
              }}
            />
          )}
        </AnimatePresence>

        <style jsx global>{`
          .student-calendar-shell {
            --fc-classic-background: transparent;
            --fc-classic-faint: rgba(255, 255, 255, 0.018);
            --fc-classic-muted: rgba(255, 255, 255, 0.028);
            --fc-classic-strong: rgba(255, 255, 255, 0.055);
            --fc-classic-foreground: rgba(255, 255, 255, 0.72);
            --fc-classic-faint-foreground: rgba(255, 255, 255, 0.18);
            --fc-classic-muted-foreground: rgba(255, 255, 255, 0.32);
            --fc-classic-border: rgba(255, 255, 255, 0.055);
            --fc-classic-strong-border: rgba(255, 255, 255, 0.09);
            --fc-classic-primary: ${identity.primary};
            --fc-classic-primary-foreground: #080809;
            --fc-classic-highlight: ${identity.primary}18;
            --fc-classic-today: ${identity.primary}08;
            --fc-classic-now: ${identity.primary};
            background:
              linear-gradient(
                180deg,
                rgba(255,255,255,0.012),
                transparent 22%
              );
          }

          .student-calendar-view {
            font-family: inherit;
          }

          .student-calendar-table {
            background: transparent;
          }

          .student-calendar-day-header {
            background: rgba(255,255,255,0.008);
          }

          .student-calendar-slot-header {
            color: rgba(255,255,255,0.2);
          }

          .student-calendar-slot-lane {
            border-color: rgba(255,255,255,0.038) !important;
          }

          .student-calendar-day-lane {
            background: transparent;
          }

          .student-calendar-day-cell {
            background: transparent;
          }

          .student-calendar-highlight {
            background: ${identity.primary}12 !important;
          }

          .student-calendar-event {
            position: relative;
            overflow: hidden;
            border-radius: 9px !important;
            box-shadow:
              0 6px 18px rgba(0,0,0,0.14);
            transition:
              filter 140ms ease,
              transform 140ms ease,
              box-shadow 140ms ease,
              opacity 140ms ease;
          }

          .student-calendar-event:hover {
            filter: brightness(1.1);
            box-shadow:
              0 9px 24px rgba(0,0,0,0.22);
          }

          .student-calendar-event-flexible,
          .student-calendar-event-draft {
            border-style: dashed !important;
          }

          .student-calendar-event-draft {
            box-shadow:
              0 0 0 1px rgba(255,255,255,0.035) inset !important;
          }

          .student-calendar-event-ai::after {
            content: "";
            position: absolute;
            right: 7px;
            top: 7px;
            width: 4px;
            height: 4px;
            border-radius: 999px;
            background: ${identity.primary};
            box-shadow:
              0 0 0 3px ${identity.primary}12;
          }

          .student-calendar-scroll {
            scrollbar-width: thin;
            scrollbar-color:
              rgba(255,255,255,0.09)
              transparent;
          }

          @media (max-width: 767px) {
            .student-calendar-shell {
              min-width: 680px;
            }

            .student-calendar-scroll {
              margin-inline: -2px;
              padding-bottom: 3px;
              overscroll-behavior-x: contain;
              -webkit-overflow-scrolling: touch;
            }
          }
        `}</style>
      </main>
    </MotionConfig>
  );
}

function CalendarEventContent({
  info,
  courseMap,
}: {
  info: any;
  courseMap: Map<string, Course>;
}) {
  const props =
    info.event.extendedProps;

  const course =
    props.courseId
      ? courseMap.get(
          props.courseId,
        )
      : null;

  const source =
    props.source as
      | "manual"
      | "ai"
      | "syllabus";

  const short =
    info.event.end &&
    info.event.start
      ? info.event.end.getTime() -
          info.event.start.getTime() <
        42 * 60 * 1000
      : false;

  return (
    <div
      className={`flex h-full min-w-0 flex-col justify-center px-2 ${
        short
          ? "py-0.5"
          : "py-1"
      }`}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        {source === "ai" && (
          <Sparkles
            size={8}
            className="shrink-0 opacity-72"
          />
        )}

        <span className="truncate text-[8px] font-semibold uppercase tracking-[0.06em] opacity-60">
          {course?.code ??
            readableType(
              props.itemType ??
                "",
            )}
        </span>

        {props.plannerLocked && (
          <Lock
            size={7}
            className="ml-auto shrink-0 opacity-42"
          />
        )}
      </div>

      <div className="mt-0.5 truncate text-[10px] font-semibold leading-3.5">
        {info.event.title}
      </div>

      {!short &&
        info.timeText && (
          <div className="mt-0.5 truncate text-[8px] opacity-48">
            {info.timeText}
            {props.location
              ? ` · ${props.location}`
              : ""}
          </div>
        )}
    </div>
  );
}

function EventInspector({
  draft,
  courses,
  schoolColor,
  saving,
  focusTitle,
  onChange,
  onClose,
  onSave,
  onDelete,
  onComplete,
  onSkip,
}: {
  draft: InspectorDraft;
  courses: Course[];
  schoolColor: string;
  saving: boolean;
  focusTitle: boolean;
  onChange: (
    next: InspectorDraft,
  ) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete: () => void;
  onComplete: () => void;
  onSkip: () => void;
}) {
  const titleRef =
    useRef<HTMLInputElement | null>(
      null,
    );

  useEffect(() => {
    if (focusTitle) {
      window.setTimeout(
        () => {
          titleRef.current?.focus();
          titleRef.current?.select();
        },
        100,
      );
    }
  }, [focusTitle]);

  const accent =
    draft.color ??
    (draft.courseId
      ? courses.find(
          (course) =>
            course.id ===
            draft.courseId,
        )?.color
      : null) ??
    schoolColor;

  function update<
    Key extends keyof InspectorDraft,
  >(
    key: Key,
    value: InspectorDraft[Key],
  ) {
    onChange({
      ...draft,
      [key]: value,
    });
  }

  return (
    <motion.aside
      initial={{
        opacity: 0,
        x: 22,
      }}
      animate={{
        opacity: 1,
        x: 0,
      }}
      exit={{
        opacity: 0,
        x: 18,
      }}
      transition={{
        duration: 0.2,
        ease: [
          0.22,
          1,
          0.36,
          1,
        ],
      }}
      className="fixed inset-x-3 bottom-3 z-[100] max-h-[88vh] overflow-y-auto rounded-[24px] border border-white/[0.09] bg-[#101012]/98 p-4 shadow-2xl shadow-black/60 backdrop-blur-2xl sm:inset-x-auto sm:bottom-auto sm:right-5 sm:top-5 sm:w-[360px] sm:p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <GripVertical
            size={12}
            className="text-white/18"
          />
          <span
            className="h-2 w-2 rounded-full"
            style={{
              backgroundColor:
                accent,
            }}
          />
          <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-white/26">
            {draft.kind ===
            "draft"
              ? "New block"
              : sourceLabel(
                  draft.source,
                )}
          </span>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-full text-white/24 transition hover:bg-white/[0.04] hover:text-white/60"
        >
          <X size={12} />
        </button>
      </div>

      <input
        ref={titleRef}
        value={draft.title}
        onChange={(event) =>
          update(
            "title",
            event.target.value,
          )
        }
        onKeyDown={(event) => {
          if (
            event.key ===
              "Enter" &&
            !event.shiftKey
          ) {
            event.preventDefault();
            onSave();
          }
        }}
        className="mt-4 w-full border-0 bg-transparent p-0 text-[22px] font-medium tracking-[-0.035em] text-white/78 outline-none placeholder:text-white/18"
        placeholder="Name this block"
      />

      <div className="mt-5 grid grid-cols-2 gap-2">
        <select
          value={draft.courseId}
          onChange={(event) => {
            const courseId =
              event.target.value;

            const course =
              courses.find(
                (item) =>
                  item.id ===
                  courseId,
              );

            onChange({
              ...draft,
              courseId,
              color:
                draft.color ??
                course?.color ??
                null,
            });
          }}
          className="rounded-[13px] border border-white/[0.06] bg-white/[0.018] px-3 py-2.5 text-[10px] text-white/50 outline-none [color-scheme:dark]"
        >
          <option value="">
            No course
          </option>
          {courses.map((course) => (
            <option
              key={course.id}
              value={course.id}
            >
              {course.code}
            </option>
          ))}
        </select>

        <select
          value={draft.itemType}
          onChange={(event) =>
            update(
              "itemType",
              event.target.value,
            )
          }
          className="rounded-[13px] border border-white/[0.06] bg-white/[0.018] px-3 py-2.5 text-[10px] text-white/50 outline-none [color-scheme:dark]"
        >
          {[
            "personal",
            "assignment",
            "exam",
            "quiz",
            "meeting",
            "club",
            "work",
            "social",
            "study",
            "focus",
            "travel",
            "other",
          ].map((type) => (
            <option
              key={type}
              value={type}
            >
              {readableType(
                type,
              )}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <label>
          <span className="mb-1.5 block text-[8px] font-semibold uppercase tracking-[0.11em] text-white/20">
            Starts
          </span>
          <input
            type="datetime-local"
            value={localDateTimeInput(
              draft.start,
            )}
            onChange={(event) =>
              update(
                "start",
                parseLocalInput(
                  event.target.value,
                ),
              )
            }
            className="w-full rounded-[13px] border border-white/[0.06] bg-white/[0.018] px-3 py-2.5 text-[9px] text-white/46 outline-none [color-scheme:dark]"
          />
        </label>

        <label>
          <span className="mb-1.5 block text-[8px] font-semibold uppercase tracking-[0.11em] text-white/20">
            Ends
          </span>
          <input
            type="datetime-local"
            value={localDateTimeInput(
              draft.end,
            )}
            onChange={(event) =>
              update(
                "end",
                parseLocalInput(
                  event.target.value,
                ),
              )
            }
            className="w-full rounded-[13px] border border-white/[0.06] bg-white/[0.018] px-3 py-2.5 text-[9px] text-white/46 outline-none [color-scheme:dark]"
          />
        </label>
      </div>

      <button
        type="button"
        onClick={() => {
          const nextAllDay =
            !draft.allDay;

          if (nextAllDay) {
            const startDate =
              localDateString(
                draft.start,
              );
            const endDate =
              localDateString(
                draft.end >
                  draft.start
                  ? draft.end
                  : addDays(
                      draft.start,
                      1,
                    ),
              );

            onChange({
              ...draft,
              allDay: true,
              allDayStartDate:
                startDate,
              allDayEndDate:
                endDate ===
                startDate
                  ? localDateString(
                      addDays(
                        draft.start,
                        1,
                      ),
                    )
                  : endDate,
            });
          } else {
            onChange({
              ...draft,
              allDay: false,
              allDayStartDate:
                null,
              allDayEndDate:
                null,
            });
          }
        }}
        className={`mt-3 flex w-full items-center justify-between rounded-[13px] border px-3 py-2.5 text-left transition ${
          draft.allDay
            ? "border-white/[0.11] bg-white/[0.025]"
            : "border-white/[0.05] bg-white/[0.008]"
        }`}
      >
        <span className="text-[9px] font-medium text-white/36">
          All-day event
        </span>

        <span
          className="flex h-5 w-5 items-center justify-center rounded-full border"
          style={
            draft.allDay
              ? {
                  backgroundColor:
                    accent,
                  borderColor:
                    accent,
                  color:
                    "#080809",
                }
              : {
                  borderColor:
                    "rgba(255,255,255,0.08)",
                }
          }
        >
          {draft.allDay && (
            <Check size={10} />
          )}
        </span>
      </button>

      <div className="mt-4 flex items-center gap-2">
        <MapPin
          size={11}
          className="text-white/18"
        />
        <input
          value={draft.location}
          onChange={(event) =>
            update(
              "location",
              event.target.value,
            )
          }
          placeholder="Add location"
          className="min-w-0 flex-1 border-0 bg-transparent text-[10px] text-white/44 outline-none placeholder:text-white/18"
        />
      </div>

      <textarea
        value={draft.notes}
        onChange={(event) =>
          update(
            "notes",
            event.target.value,
          )
        }
        rows={2}
        placeholder="Notes"
        className="mt-4 w-full resize-none rounded-[13px] border border-white/[0.055] bg-white/[0.012] px-3 py-2.5 text-[10px] leading-5 text-white/42 outline-none placeholder:text-white/16"
      />

      <div className="mt-4">
        <p className="text-[8px] font-semibold uppercase tracking-[0.11em] text-white/20">
          Color
        </p>

        <div className="mt-2 flex flex-wrap gap-2">
          {colorChoices.map(
            (choice) => (
              <button
                key={choice}
                type="button"
                onClick={() =>
                  update(
                    "color",
                    choice,
                  )
                }
                className="flex h-7 w-7 items-center justify-center rounded-full border transition"
                style={{
                  backgroundColor:
                    choice,
                  borderColor:
                    draft.color ===
                    choice
                      ? "#FFFFFF"
                      : `${choice}88`,
                }}
                aria-label={`Use ${choice}`}
              >
                {draft.color ===
                  choice && (
                  <Check
                    size={10}
                    className="text-black"
                  />
                )}
              </button>
            ),
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={() =>
          update(
            "flexibility",
            draft.flexibility ===
              "flexible"
              ? "rigid"
              : "flexible",
          )
        }
        className={`mt-4 flex w-full items-center justify-between rounded-[14px] border px-3.5 py-3 text-left transition ${
          draft.flexibility ===
          "flexible"
            ? "border-dashed border-white/[0.12] bg-white/[0.025]"
            : "border-white/[0.055] bg-white/[0.01]"
        }`}
      >
        <div>
          <p className="text-[10px] font-medium text-white/48">
            Flexible block
          </p>
          <p className="mt-1 text-[8px] leading-4 text-white/20">
            Flexible blocks are visually lighter and safe to move around freely.
          </p>
        </div>

        <span
          className="flex h-5 w-5 items-center justify-center rounded-full border"
          style={
            draft.flexibility ===
            "flexible"
              ? {
                  borderColor:
                    accent,
                  backgroundColor:
                    accent,
                  color:
                    "#080809",
                }
              : {
                  borderColor:
                    "rgba(255,255,255,0.08)",
                }
          }
        >
          {draft.flexibility ===
            "flexible" && (
            <Check size={10} />
          )}
        </span>
      </button>

      {draft.source === "ai" && (
        <button
          type="button"
          onClick={() =>
            update(
              "plannerLocked",
              !draft.plannerLocked,
            )
          }
          className="mt-2 flex w-full items-center gap-3 rounded-[14px] border border-white/[0.055] bg-white/[0.01] px-3.5 py-3 text-left transition hover:bg-white/[0.02]"
        >
          {draft.plannerLocked ? (
            <Lock
              size={12}
              className="text-white/32"
            />
          ) : (
            <LockOpen
              size={12}
              className="text-white/32"
            />
          )}

          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-medium text-white/46">
              {draft.plannerLocked
                ? "Protected from AI replanning"
                : "AI may move this again"}
            </p>
            <p className="mt-1 text-[8px] text-white/20">
              Moving or resizing an AI block protects your change automatically.
            </p>
          </div>
        </button>
      )}

      {draft.kind === "item" &&
        draft.itemType === "study" && (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onComplete}
            disabled={saving}
            className="flex items-center justify-center gap-2 rounded-[13px] border border-emerald-300/10 bg-emerald-300/[0.025] px-3 py-2.5 text-[8px] font-medium text-emerald-100/52 transition hover:bg-emerald-300/[0.045] hover:text-emerald-100/74 disabled:opacity-35"
          >
            <Check
              size={9}
            />
            Mark completed
          </button>

          <button
            type="button"
            onClick={onSkip}
            disabled={saving}
            className="flex items-center justify-center gap-2 rounded-[13px] border border-white/[0.05] bg-white/[0.008] px-3 py-2.5 text-[8px] font-medium text-white/28 transition hover:bg-white/[0.02] hover:text-white/48 disabled:opacity-35"
          >
            Skip this block
          </button>
        </div>
      )}

      <div className="mt-5 flex items-center gap-2 border-t border-white/[0.05] pt-4">
        {draft.kind ===
          "item" && (
          <button
            type="button"
            onClick={onDelete}
            disabled={saving}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-red-400/10 text-red-200/30 transition hover:bg-red-400/[0.05] hover:text-red-200/60 disabled:opacity-40"
          >
            <Trash2
              size={12}
            />
          </button>
        )}

        <div className="flex-1" />

        <button
          type="button"
          onClick={onClose}
          className="rounded-full px-3.5 py-2.5 text-[9px] font-medium text-white/30 transition hover:text-white/56"
        >
          Cancel
        </button>

        <button
          type="button"
          onClick={onSave}
          disabled={
            saving ||
            draft.end <=
              draft.start
          }
          className="flex min-w-[74px] items-center justify-center gap-2 rounded-full bg-white px-4 py-2.5 text-[9px] font-medium text-black disabled:opacity-35"
        >
          {saving && (
            <Loader2
              size={10}
              className="animate-spin"
            />
          )}
          Done
        </button>
      </div>
    </motion.aside>
  );
}

function RhythmSheet({
  initial,
  color,
  mandatory,
  onClose,
  onSaved,
}: {
  initial: CalendarPreferences;
  color: string;
  mandatory: boolean;
  onClose: () => void;
  onSaved: (
    next: CalendarPreferences,
  ) => void;
}) {
  const [form, setForm] =
    useState(initial);
  const [saving, setSaving] =
    useState(false);
  const [error, setError] =
    useState("");

  async function save() {
    try {
      setSaving(true);
      setError("");

      const {
        data: { user },
        error: userError,
      } =
        await supabase.auth.getUser();

      if (userError) {
        throw userError;
      }
      if (!user) {
        throw new Error(
          "You must be signed in.",
        );
      }

      const next = {
        ...form,
        setup_completed: true,
        timezone:
          Intl.DateTimeFormat().resolvedOptions().timeZone ||
          form.timezone,
      };

      const { error } =
        await supabase
          .from(
            "calendar_preferences",
          )
          .upsert(
            {
              user_id:
                user.id,
              ...next,
            },
            {
              onConflict:
                "user_id",
            },
          );

      if (error) {
        throw error;
      }

      onSaved(next);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save preferences.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <motion.div
      initial={{
        opacity: 0,
      }}
      animate={{
        opacity: 1,
      }}
      exit={{
        opacity: 0,
      }}
      className="fixed inset-0 z-[120] flex items-end justify-center bg-black/72 sm:items-center sm:p-6"
    >
      {!mandatory && (
        <button
          type="button"
          onClick={onClose}
          className="absolute inset-0"
          aria-label="Close"
        />
      )}

      <motion.div
        initial={{
          y: 20,
          opacity: 0,
        }}
        animate={{
          y: 0,
          opacity: 1,
        }}
        exit={{
          y: 12,
          opacity: 0,
        }}
        className="relative z-10 w-full max-w-[640px] rounded-t-[26px] border border-white/[0.08] bg-[#101012] p-5 shadow-2xl sm:rounded-[26px] sm:p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p
              className="text-[9px] font-semibold uppercase tracking-[0.12em]"
              style={{
                color,
              }}
            >
              {mandatory
                ? "One-time setup"
                : "Planning rhythm"}
            </p>
            <h2 className="mt-2 text-[26px] font-medium tracking-[-0.04em]">
              Protect the parts of your day that matter.
            </h2>
            <p className="mt-2 max-w-xl text-[10px] leading-5 text-white/28">
              AI planning uses these as constraints. You can still drag any suggested study block afterward.
            </p>
          </div>

          {!mandatory && (
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-full text-white/26 hover:bg-white/[0.04] hover:text-white/56"
            >
              <X size={12} />
            </button>
          )}
        </div>

        {error && (
          <p className="mt-4 text-[10px] text-red-200/60">
            {error}
          </p>
        )}

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <TimeField
            label="Wake up"
            value={form.wake_time}
            onChange={(value) =>
              setForm({
                ...form,
                wake_time: value,
              })
            }
          />
          <TimeField
            label="Bedtime"
            value={form.bedtime_time}
            onChange={(value) =>
              setForm({
                ...form,
                bedtime_time:
                  value,
              })
            }
          />
          <TimeField
            label="Lunch starts"
            value={
              form.lunch_start ??
              ""
            }
            onChange={(value) =>
              setForm({
                ...form,
                lunch_start:
                  value || null,
              })
            }
          />
          <TimeField
            label="Lunch ends"
            value={
              form.lunch_end ??
              ""
            }
            onChange={(value) =>
              setForm({
                ...form,
                lunch_end:
                  value || null,
              })
            }
          />
          <TimeField
            label="Dinner starts"
            value={
              form.dinner_start ??
              ""
            }
            onChange={(value) =>
              setForm({
                ...form,
                dinner_start:
                  value || null,
              })
            }
          />
          <TimeField
            label="Dinner ends"
            value={
              form.dinner_end ??
              ""
            }
            onChange={(value) =>
              setForm({
                ...form,
                dinner_end:
                  value || null,
              })
            }
          />
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label>
            <span className="text-[9px] font-semibold uppercase tracking-[0.1em] text-white/24">
              Best study time
            </span>
            <select
              value={
                form.preferred_study_period
              }
              onChange={(event) =>
                setForm({
                  ...form,
                  preferred_study_period:
                    event.target.value as CalendarPreferences["preferred_study_period"],
                })
              }
              className="mt-2 w-full rounded-[13px] border border-white/[0.06] bg-white/[0.018] px-3 py-2.5 text-[10px] text-white/48 outline-none [color-scheme:dark]"
            >
              <option value="morning">
                Morning
              </option>
              <option value="afternoon">
                Afternoon
              </option>
              <option value="evening">
                Evening
              </option>
              <option value="mixed">
                No preference
              </option>
            </select>
          </label>

          <label>
            <span className="text-[9px] font-semibold uppercase tracking-[0.1em] text-white/24">
              Buffer around events
            </span>
            <select
              value={
                form.buffer_minutes
              }
              onChange={(event) =>
                setForm({
                  ...form,
                  buffer_minutes:
                    Number(
                      event.target.value,
                    ),
                })
              }
              className="mt-2 w-full rounded-[13px] border border-white/[0.06] bg-white/[0.018] px-3 py-2.5 text-[10px] text-white/48 outline-none [color-scheme:dark]"
            >
              {[0, 5, 10, 15, 20, 30].map(
                (value) => (
                  <option
                    key={value}
                    value={value}
                  >
                    {value} min
                  </option>
                ),
              )}
            </select>
          </label>
        </div>

        <div className="mt-5 rounded-[17px] border border-white/[0.055] bg-white/[0.01] p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[10px] font-medium text-white/48">
                Study session range
              </p>
              <p className="mt-1 text-[8px] text-white/20">
                Preparedness and deadline pressure choose the actual length.
              </p>
            </div>

            <span
              className="text-[10px] font-semibold"
              style={{
                color,
              }}
            >
              {form.min_study_minutes}–{form.max_study_minutes} min
            </span>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <input
              type="range"
              min="15"
              max="60"
              step="5"
              value={
                form.min_study_minutes
              }
              onChange={(event) =>
                setForm({
                  ...form,
                  min_study_minutes:
                    Number(
                      event.target.value,
                    ),
                })
              }
              className="accent-white"
            />
            <input
              type="range"
              min="45"
              max="120"
              step="5"
              value={
                form.max_study_minutes
              }
              onChange={(event) =>
                setForm({
                  ...form,
                  max_study_minutes:
                    Number(
                      event.target.value,
                    ),
                })
              }
              className="accent-white"
            />
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={() =>
              void save()
            }
            disabled={saving}
            className="flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-[10px] font-medium text-black disabled:opacity-40"
          >
            {saving ? (
              <Loader2
                size={11}
                className="animate-spin"
              />
            ) : (
              <Check size={11} />
            )}
            Save rhythm
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function TimeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (
    value: string,
  ) => void;
}) {
  return (
    <label>
      <span className="text-[9px] font-semibold uppercase tracking-[0.1em] text-white/24">
        {label}
      </span>
      <input
        type="time"
        value={value}
        onChange={(event) =>
          onChange(
            event.target.value,
          )
        }
        className="mt-2 w-full rounded-[13px] border border-white/[0.06] bg-white/[0.018] px-3 py-2.5 text-[10px] text-white/48 outline-none [color-scheme:dark]"
      />
    </label>
  );
}

function ClassSheet({
  courses,
  color,
  onClose,
  onSaved,
}: {
  courses: Course[];
  color: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const first =
    courses[0] ?? null;

  const [courseId, setCourseId] =
    useState(
      first?.id ?? "",
    );
  const [title, setTitle] =
    useState(
      first
        ? `${first.code} Class`
        : "",
    );
  const [days, setDays] =
    useState<number[]>([
      1,
      3,
      5,
    ]);
  const [startTime, setStartTime] =
    useState("10:00");
  const [endTime, setEndTime] =
    useState("10:50");
  const [startDate, setStartDate] =
    useState(
      localDateString(
        new Date(),
      ),
    );
  const [endDate, setEndDate] =
    useState(
      localDateString(
        addDays(
          new Date(),
          120,
        ),
      ),
    );
  const [location, setLocation] =
    useState("");
  const [weekPattern, setWeekPattern] =
    useState<
      "every" | "odd" | "even"
    >("every");
  const [saving, setSaving] =
    useState(false);
  const [error, setError] =
    useState("");

  const selected =
    courses.find(
      (course) =>
        course.id === courseId,
    ) ?? null;

  async function save() {
    try {
      setSaving(true);
      setError("");

      const token =
        (
          await supabase.auth.getSession()
        ).data.session
          ?.access_token;

      if (!token) {
        throw new Error(
          "You must be signed in.",
        );
      }

      const response = await fetch(
        "/api/calendar/class",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            courseId,
            title,
            meetingType:
              "class",
            location,
            daysOfWeek: days,
            startTime,
            endTime,
            startDate,
            endDate,
            weekPattern,
            color:
              selected?.color ??
              color,
          }),
        },
      );

      const payload =
        (await response.json()) as {
          ok?: boolean;
          error?: string;
        };

      if (
        !response.ok ||
        !payload.ok
      ) {
        throw new Error(
          payload.error ||
            "Could not add class.",
        );
      }

      await onSaved();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not add class.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <motion.aside
      initial={{
        opacity: 0,
        x: 22,
      }}
      animate={{
        opacity: 1,
        x: 0,
      }}
      exit={{
        opacity: 0,
        x: 18,
      }}
      className="fixed inset-x-3 bottom-3 z-[110] max-h-[88vh] overflow-y-auto rounded-[24px] border border-white/[0.09] bg-[#101012]/98 p-5 shadow-2xl backdrop-blur-2xl sm:inset-x-auto sm:bottom-auto sm:right-5 sm:top-5 sm:w-[380px]"
    >
      <div className="flex items-center justify-between">
        <div>
          <p
            className="text-[9px] font-semibold uppercase tracking-[0.12em]"
            style={{
              color:
                selected?.color ??
                color,
            }}
          >
            Recurring class
          </p>
          <h2 className="mt-2 text-[22px] font-medium tracking-[-0.035em]">
            Put your class on the week.
          </h2>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-full text-white/24 hover:bg-white/[0.04] hover:text-white/56"
        >
          <X size={12} />
        </button>
      </div>

      {error && (
        <p className="mt-4 text-[9px] text-red-200/60">
          {error}
        </p>
      )}

      <div className="mt-5 grid gap-2">
        <select
          value={courseId}
          onChange={(event) => {
            const next =
              event.target.value;
            setCourseId(next);

            const course =
              courses.find(
                (item) =>
                  item.id === next,
              );

            if (course) {
              setTitle(
                `${course.code} Class`,
              );
            }
          }}
          className="rounded-[13px] border border-white/[0.06] bg-white/[0.018] px-3 py-2.5 text-[10px] text-white/48 outline-none [color-scheme:dark]"
        >
          {courses.map((course) => (
            <option
              key={course.id}
              value={course.id}
            >
              {course.code} ·{" "}
              {course.name}
            </option>
          ))}
        </select>

        <input
          value={title}
          onChange={(event) =>
            setTitle(
              event.target.value,
            )
          }
          className="rounded-[13px] border border-white/[0.06] bg-white/[0.018] px-3 py-2.5 text-[10px] text-white/48 outline-none"
          placeholder="Class name"
        />

        <input
          value={location}
          onChange={(event) =>
            setLocation(
              event.target.value,
            )
          }
          className="rounded-[13px] border border-white/[0.06] bg-white/[0.018] px-3 py-2.5 text-[10px] text-white/48 outline-none"
          placeholder="Location"
        />
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {[
          [1, "M"],
          [2, "T"],
          [3, "W"],
          [4, "T"],
          [5, "F"],
          [6, "S"],
          [0, "S"],
        ].map(
          ([value, label]) => {
            const day =
              Number(value);

            const active =
              days.includes(day);

            return (
              <button
                key={`${value}-${label}`}
                type="button"
                onClick={() =>
                  setDays(
                    (current) =>
                      active
                        ? current.filter(
                            (item) =>
                              item !==
                              day,
                          )
                        : [
                            ...current,
                            day,
                          ],
                  )
                }
                className={`flex h-9 w-9 items-center justify-center rounded-full border text-[9px] font-medium ${
                  active
                    ? "border-white/[0.14] bg-white/[0.05] text-white/64"
                    : "border-white/[0.05] text-white/24"
                }`}
              >
                {label}
              </button>
            );
          },
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <input
          type="time"
          value={startTime}
          onChange={(event) =>
            setStartTime(
              event.target.value,
            )
          }
          className="rounded-[13px] border border-white/[0.06] bg-white/[0.018] px-3 py-2.5 text-[9px] text-white/48 outline-none [color-scheme:dark]"
        />
        <input
          type="time"
          value={endTime}
          onChange={(event) =>
            setEndTime(
              event.target.value,
            )
          }
          className="rounded-[13px] border border-white/[0.06] bg-white/[0.018] px-3 py-2.5 text-[9px] text-white/48 outline-none [color-scheme:dark]"
        />
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <input
          type="date"
          value={startDate}
          onChange={(event) =>
            setStartDate(
              event.target.value,
            )
          }
          className="rounded-[13px] border border-white/[0.06] bg-white/[0.018] px-3 py-2.5 text-[9px] text-white/48 outline-none [color-scheme:dark]"
        />
        <input
          type="date"
          value={endDate}
          onChange={(event) =>
            setEndDate(
              event.target.value,
            )
          }
          className="rounded-[13px] border border-white/[0.06] bg-white/[0.018] px-3 py-2.5 text-[9px] text-white/48 outline-none [color-scheme:dark]"
        />
      </div>

      <select
        value={weekPattern}
        onChange={(event) =>
          setWeekPattern(
            event.target.value as
              | "every"
              | "odd"
              | "even",
          )
        }
        className="mt-2 w-full rounded-[13px] border border-white/[0.06] bg-white/[0.018] px-3 py-2.5 text-[9px] text-white/48 outline-none [color-scheme:dark]"
      >
        <option value="every">
          Every week
        </option>
        <option value="odd">
          Week A
        </option>
        <option value="even">
          Week B
        </option>
      </select>

      <button
        type="button"
        onClick={() =>
          void save()
        }
        disabled={
          saving ||
          !courseId ||
          days.length === 0
        }
        className="mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-white px-4 py-2.5 text-[10px] font-medium text-black disabled:opacity-35"
      >
        {saving ? (
          <Loader2
            size={11}
            className="animate-spin"
          />
        ) : (
          <Plus size={11} />
        )}
        Add class
      </button>
    </motion.aside>
  );
}