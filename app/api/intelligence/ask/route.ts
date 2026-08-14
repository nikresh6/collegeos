import {
  NextResponse,
} from "next/server";
import Groq from "groq-sdk";
import {
  userContext,
} from "../../../../lib/server-auth";
import {
  buildAttentionSnapshot,
} from "../../../../lib/attention-engine";

export const runtime =
  "nodejs";
export const dynamic =
  "force-dynamic";

type SourceKind =
  | "course"
  | "topic"
  | "note"
  | "lecture"
  | "material"
  | "assignment"
  | "calendar"
  | "study_guide";

type AnswerSource = {
  key: string;
  kind: SourceKind;
  title: string;
  subtitle: string;
  href: string;
  color: string | null;
};

type ContextRecord =
  AnswerSource & {
    body: string;
    courseId: string | null;
    timestamp: string | null;
  };

type Course = {
  id: string;
  code: string;
  name: string;
  color: string;
};

const groq =
  new Groq({
    apiKey:
      process.env.GROQ_API_KEY,
  });

const MODELS = [
  "openai/gpt-oss-20b",
  "qwen/qwen3.6-27b",
] as const;

const STOP_WORDS =
  new Set([
    "a",
    "about",
    "all",
    "am",
    "an",
    "and",
    "are",
    "can",
    "could",
    "did",
    "do",
    "does",
    "for",
    "from",
    "have",
    "how",
    "i",
    "in",
    "is",
    "it",
    "me",
    "my",
    "of",
    "on",
    "should",
    "tell",
    "the",
    "this",
    "to",
    "was",
    "what",
    "when",
    "where",
    "which",
    "who",
    "why",
    "with",
  ]);

function normalize(
  value: string,
) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(
      /[^\p{L}\p{N}\s]/gu,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function tokensFrom(
  value: string,
) {
  return Array.from(
    new Set(
      normalize(value)
        .split(" ")
        .filter(
          (token) =>
            token.length >= 3 &&
            !STOP_WORDS.has(
              token,
            ),
        ),
    ),
  ).slice(0, 8);
}

function truncate(
  value: unknown,
  length: number,
) {
  if (
    typeof value !==
    "string"
  ) {
    return "";
  }

  const clean =
    value
      .replace(/\s+/g, " ")
      .trim();

  return clean.length > length
    ? `${clean.slice(
        0,
        length,
      )}…`
    : clean;
}

function courseMapFrom(
  courses: Course[],
) {
  return new Map(
    courses.map(
      (course) => [
        course.id,
        course,
      ],
    ),
  );
}

function mentionedCourse(
  question: string,
  courses: Course[],
) {
  const normalized =
    normalize(question);

  const ranked =
    courses
      .map((course) => {
        const code =
          normalize(
            course.code,
          );

        const name =
          normalize(
            course.name,
          );

        let score = 0;

        if (
          normalized.includes(
            code,
          )
        ) {
          score += 100;
        }

        if (
          normalized.includes(
            name,
          )
        ) {
          score += 90;
        }

        score +=
          name
            .split(" ")
            .filter(
              (token) =>
                token.length >= 4 &&
                normalized.includes(
                  token,
                ),
            ).length * 18;

        return {
          course,
          score,
        };
      })
      .sort(
        (a, b) =>
          b.score - a.score,
      );

  return ranked[0] &&
    ranked[0].score >= 18
    ? ranked[0].course
    : null;
}

function formatDate(
  value: string,
  timeZone: string,
) {
  if (
    /^\d{4}-\d{2}-\d{2}$/.test(
      value,
    )
  ) {
    const [
      year,
      month,
      day,
    ] = value
      .split("-")
      .map(Number);

    return new Intl.DateTimeFormat(
      "en-US",
      {
        timeZone: "UTC",
        weekday: "short",
        month: "short",
        day: "numeric",
      },
    ).format(
      new Date(
        Date.UTC(
          year,
          month - 1,
          day,
          12,
        ),
      ),
    );
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return value;
  }

  return new Intl.DateTimeFormat(
    "en-US",
    {
      timeZone,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    },
  ).format(date);
}

function relevanceScore({
  record,
  question,
  tokens,
  courseId,
}: {
  record: ContextRecord;
  question: string;
  tokens: string[];
  courseId: string | null;
}) {
  const title =
    normalize(record.title);

  const subtitle =
    normalize(
      record.subtitle,
    );

  const body =
    normalize(record.body);

  let score = 0;

  for (
    const token of tokens
  ) {
    if (
      title.includes(token)
    ) {
      score += 24;
    }

    if (
      subtitle.includes(token)
    ) {
      score += 14;
    }

    if (
      body.includes(token)
    ) {
      score += 7;
    }
  }

  if (
    courseId &&
    record.courseId ===
      courseId
  ) {
    score += 28;
  }

  const normalizedQuestion =
    normalize(question);

  if (
    /\b(lecture|professor|covered|said|class)\b/.test(
      normalizedQuestion,
    ) &&
    record.kind ===
      "lecture"
  ) {
    score += 28;
  }

  if (
    /\b(note|notes|wrote)\b/.test(
      normalizedQuestion,
    ) &&
    record.kind === "note"
  ) {
    score += 24;
  }

  if (
    /\b(exam|quiz|assignment|deadline|due|test)\b/.test(
      normalizedQuestion,
    ) &&
    (
      record.kind ===
        "assignment" ||
      record.kind ===
        "calendar"
    )
  ) {
    score += 30;
  }

  if (
    /\b(study guide|guide|review)\b/.test(
      normalizedQuestion,
    ) &&
    record.kind ===
      "study_guide"
  ) {
    score += 24;
  }

  if (
    /\b(file|material|slide|pdf|reading)\b/.test(
      normalizedQuestion,
    ) &&
    record.kind ===
      "material"
  ) {
    score += 22;
  }

  if (
    /\b(topic|mastery|prepared|preparedness|weak)\b/.test(
      normalizedQuestion,
    ) &&
    record.kind === "topic"
  ) {
    score += 24;
  }

  if (
    record.timestamp
  ) {
    const ageDays =
      Math.max(
        0,
        (
          Date.now() -
          new Date(
            record.timestamp,
          ).getTime()
        ) /
          86400000,
      );

    score +=
      Math.max(
        0,
        8 -
          ageDays / 10,
      );
  }

  return score;
}

function isRateLimit(
  error: unknown,
) {
  const candidate =
    error as {
      status?: number;
      message?: string;
    };

  return (
    candidate.status ===
      429 ||
    candidate.message
      ?.toLowerCase()
      .includes(
        "rate limit",
      ) === true
  );
}

async function groundedCompletion({
  question,
  contextText,
  currentTime,
}: {
  question: string;
  contextText: string;
  currentTime: string;
}) {
  let lastError:
    unknown = null;

  for (
    const model of MODELS
  ) {
    try {
      const completion =
        await groq.chat.completions.create({
          model,
          messages: [
            {
              role: "system",
              content: `You are the Command Center for a personal college academic operating system.

Answer the student's question using ONLY the supplied academic workspace context.

Rules:
1. Never invent a deadline, course fact, lecture fact, grade, topic, or schedule item.
2. If the workspace does not contain enough information, say exactly what is missing.
3. Prefer a direct answer over a generic explanation.
4. For operational questions, name the relevant course/item and date or status.
5. For course-content questions, synthesize only what the notes, lecture summaries/transcripts, materials, topics, or study guides support.
6. Keep the answer compact, usually 2-6 sentences or a short list.
7. Do not tell the student to search the app manually if the answer is present in the context.
8. Do not output markdown tables.
9. The current local date/time is ${currentTime}.

Return exactly this shape:
ANSWER
<your answer>
SOURCES
<S1,S2 or NONE>`,
            },
            {
              role: "user",
              content: `QUESTION:
${question}

ACADEMIC WORKSPACE CONTEXT:
${contextText}`,
            },
          ],
          reasoning_format:
            "hidden",
          reasoning_effort:
            model.startsWith(
              "qwen/",
            )
              ? "none"
              : "low",
          temperature: 0.12,
          max_completion_tokens:
            650,
        });

      const content =
        completion
          .choices[0]
          ?.message
          ?.content
          ?.trim();

      if (!content) {
        throw new Error(
          "Academic OS returned an empty answer.",
        );
      }

      return content;
    } catch (error) {
      lastError = error;

      if (
        !isRateLimit(error)
      ) {
        throw error;
      }
    }
  }

  throw (
    lastError ??
    new Error(
      "Academic OS is busy right now. Try again in a minute.",
    )
  );
}

function parseCompletion(
  value: string,
) {
  const answerMatch =
    value.match(
      /ANSWER\s*\n([\s\S]*?)(?:\nSOURCES\s*\n|$)/i,
    );

  const sourceMatch =
    value.match(
      /SOURCES\s*\n([^\n]+)/i,
    );

  const answer =
    answerMatch?.[1]
      ?.trim() ||
    value
      .replace(
        /SOURCES\s*[\s\S]*$/i,
        "",
      )
      .replace(
        /^ANSWER\s*/i,
        "",
      )
      .trim();

  const keys =
    sourceMatch?.[1]
      ?.split(/[,\s]+/)
      .map((item) =>
        item.trim(),
      )
      .filter(
        (item) =>
          /^S\d+$/i.test(
            item,
          ),
      ) ?? [];

  return {
    answer,
    keys,
  };
}

export async function POST(
  request: Request,
) {
  const context =
    await userContext(
      request,
    );

  if (!context) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "You are not signed in.",
      },
      {
        status: 401,
      },
    );
  }

  try {
    const body =
      (await request.json()) as {
        question?: string;
        timeZone?: string;
      };

    const question =
      body.question
        ?.trim()
        .slice(0, 600) ??
      "";

    const timeZone =
      body.timeZone ||
      "America/Chicago";

    if (
      question.length < 2
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Ask a question first.",
        },
        {
          status: 400,
        },
      );
    }

    const [
      {
        data: courses,
        error: coursesError,
      },
      {
        data: topics,
        error: topicsError,
      },
      {
        data: notes,
        error: notesError,
      },
      {
        data: lectures,
        error: lecturesError,
      },
      {
        data: files,
        error: filesError,
      },
      {
        data: analyses,
        error: analysesError,
      },
      {
        data: events,
        error: eventsError,
      },
      {
        data: calendarItems,
        error: calendarError,
      },
      {
        data: guides,
        error: guidesError,
      },
    ] =
      await Promise.all([
        context.supabase
          .from("courses")
          .select(
            "id, code, name, color",
          )
          .eq(
            "user_id",
            context.user.id,
          )
          .is(
            "archived_at",
            null,
          ),

        context.supabase
          .from(
            "course_topics",
          )
          .select(
            "id, course_id, parent_topic_id, name, description, mastery_score, mastery_state, created_at",
          )
          .eq(
            "user_id",
            context.user.id,
          )
          .limit(120),

        context.supabase
          .from("notes")
          .select(
            "id, course_id, title, raw_content, enhanced_content, updated_at",
          )
          .eq(
            "user_id",
            context.user.id,
          )
          .order(
            "updated_at",
            {
              ascending: false,
            },
          )
          .limit(30),

        context.supabase
          .from("lectures")
          .select(
            "id, course_id, title, summary, transcript_text, status, captured_at, updated_at",
          )
          .eq(
            "user_id",
            context.user.id,
          )
          .order(
            "captured_at",
            {
              ascending: false,
            },
          )
          .limit(20),

        context.supabase
          .from(
            "course_files",
          )
          .select(
            "id, course_id, file_name, material_type",
          )
          .eq(
            "user_id",
            context.user.id,
          )
          .limit(40),

        context.supabase
          .from(
            "material_analyses",
          )
          .select(
            "id, course_id, course_file_id, summary",
          )
          .eq(
            "user_id",
            context.user.id,
          )
          .limit(30),

        context.supabase
          .from(
            "course_events",
          )
          .select(
            "id, course_id, name, event_type, start_date, notes",
          )
          .eq(
            "user_id",
            context.user.id,
          )
          .order(
            "start_date",
            {
              ascending: true,
            },
          )
          .limit(50),

        context.supabase
          .from(
            "calendar_items",
          )
          .select(
            "id, course_id, title, item_type, starts_at, ends_at, status, source, notes, topic_ids",
          )
          .eq(
            "user_id",
            context.user.id,
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
          )
          .limit(60),

        context.supabase
          .from(
            "study_guides",
          )
          .select(
            "id, course_id, title, content, depth_percent, updated_at",
          )
          .eq(
            "user_id",
            context.user.id,
          )
          .order(
            "updated_at",
            {
              ascending: false,
            },
          )
          .limit(12),
      ]);

    const errors =
      [
        coursesError,
        topicsError,
        notesError,
        lecturesError,
        filesError,
        analysesError,
        eventsError,
        calendarError,
        guidesError,
      ].filter(Boolean);

    if (
      errors.length > 0
    ) {
      throw errors[0];
    }

    const activeCourses =
      (courses ?? []) as Course[];

    const courseMap =
      courseMapFrom(
        activeCourses,
      );

    const course =
      mentionedCourse(
        question,
        activeCourses,
      );

    const normalizedQuestion =
      normalize(question);

    const latestLectureQuestion =
      /\b(last|latest|most recent|recent)\b/.test(
        normalizedQuestion,
      ) &&
      /\blecture\b/.test(
        normalizedQuestion,
      );

    if (
      latestLectureQuestion
    ) {
      const latest =
        (lectures ?? []).find(
          (lecture) =>
            !course ||
            lecture.course_id ===
              course.id,
        );

      if (!latest) {
        return NextResponse.json({
          ok: true,
          answer:
            course
              ? `I do not have a recorded lecture for ${course.code} yet.`
              : "I do not have a recorded lecture in your workspace yet.",
          sources: [],
          mode:
            "deterministic",
        });
      }

      const lectureCourse =
        courseMap.get(
          latest.course_id,
        );

      const summary =
        truncate(
          latest.summary,
          420,
        );

      return NextResponse.json({
        ok: true,
        answer:
          summary
            ? `Your most recent${lectureCourse ? ` ${lectureCourse.code}` : ""} lecture is “${latest.title}.” ${summary}`
            : `Your most recent${lectureCourse ? ` ${lectureCourse.code}` : ""} lecture is “${latest.title}.” Its analysis does not have a summary yet.`,
        sources: [
          {
            key: "S1",
            kind:
              "lecture",
            title:
              latest.title,
            subtitle:
              `${lectureCourse?.code ?? "Lecture"} · ${latest.status}`,
            href:
              `/lectures/${latest.id}`,
            color:
              lectureCourse?.color ??
              null,
          },
        ],
        mode:
          "deterministic",
      });
    }

    const asksPriority =
      /\b(what should i do|what should i study|what matters|priority|priorities|focus on|study next)\b/.test(
        normalizedQuestion,
      );

    if (asksPriority) {
      const snapshot =
        await buildAttentionSnapshot({
          supabase:
            context.supabase,
          userId:
            context.user.id,
          timeZone,
        });

      if (
        !snapshot.primary
      ) {
        return NextResponse.json({
          ok: true,
          answer:
            "Nothing is currently urgent. You are clear enough to study a weak topic, review a recent lecture, or work ahead.",
          sources: [],
          mode:
            "deterministic",
        });
      }

      return NextResponse.json({
        ok: true,
        answer:
          `${snapshot.primary.title}. ${snapshot.primary.detail}`,
        sources: [
          {
            key: "S1",
            kind:
              snapshot.primary.kind ===
              "weak_topic"
                ? "topic"
                : "assignment",
            title:
              snapshot.primary.title,
            subtitle:
              snapshot.primary.courseCode ??
              "Academic priority",
            href:
              snapshot.primary.action.href,
            color:
              snapshot.primary.color,
          },
        ],
        mode:
          "deterministic",
      });
    }

    const nextType =
      /\bnext\b/.test(
        normalizedQuestion,
      )
        ? /\bexam\b/.test(
            normalizedQuestion,
          )
          ? "exam"
          : /\bquiz\b/.test(
                normalizedQuestion,
              )
            ? "quiz"
            : /\bassignment|homework\b/.test(
                  normalizedQuestion,
                )
              ? "assignment"
              : /\bdeadline|due\b/.test(
                    normalizedQuestion,
                  )
                ? "deadline"
                : null
        : null;

    if (nextType) {
      const now =
        Date.now();

      const candidates =
        [
          ...(events ?? []).map(
            (event) => ({
              id: event.id,
              courseId:
                event.course_id,
              title:
                event.name,
              type:
                String(
                  event.event_type,
                ).toLowerCase(),
              when:
                event.start_date,
              href:
                "/calendar",
            }),
          ),
          ...(calendarItems ?? [])
            .filter(
              (item) =>
                [
                  "assignment",
                  "exam",
                  "quiz",
                ].includes(
                  item.item_type,
                ),
            )
            .map((item) => ({
              id: item.id,
              courseId:
                item.course_id,
              title:
                item.title,
              type:
                item.item_type,
              when:
                item.starts_at,
              href:
                "/calendar",
            })),
        ]
          .filter(
            (item) => {
              if (
                course &&
                item.courseId !==
                  course.id
              ) {
                return false;
              }

              const time =
                new Date(
                  item.when,
                ).getTime();

              if (
                !Number.isFinite(
                  time,
                ) ||
                time < now -
                  86400000
              ) {
                return false;
              }

              if (
                nextType ===
                "deadline"
              ) {
                return true;
              }

              return item.type.includes(
                nextType,
              );
            })
          .sort(
            (a, b) =>
              new Date(
                a.when,
              ).getTime() -
              new Date(
                b.when,
              ).getTime(),
          );

      const next =
        candidates[0];

      if (!next) {
        return NextResponse.json({
          ok: true,
          answer:
            `I do not have an upcoming ${nextType}${course ? ` for ${course.code}` : ""} in your current academic data.`,
          sources: [],
          mode:
            "deterministic",
        });
      }

      const nextCourse =
        next.courseId
          ? courseMap.get(
              next.courseId,
            )
          : null;

      return NextResponse.json({
        ok: true,
        answer:
          `Your next ${nextType}${nextCourse ? ` for ${nextCourse.code}` : ""} is “${next.title}” on ${formatDate(
            next.when,
            timeZone,
          )}.`,
        sources: [
          {
            key: "S1",
            kind:
              "assignment",
            title:
              next.title,
            subtitle:
              nextCourse?.code ??
              nextType,
            href:
              next.href,
            color:
              nextCourse?.color ??
              null,
          },
        ],
        mode:
          "deterministic",
      });
    }

    type FileRow = {
      id: string;
      course_id: string;
      file_name: string;
      material_type: string;
    };

    const fileRows =
      (files ?? []) as FileRow[];

    const fileMap =
      new Map<string, FileRow>(
        fileRows.map(
          (file) => [
            file.id,
            file,
          ],
        ),
      );

    const records:
      ContextRecord[] = [];

    for (
      const topic of
      topics ?? []
    ) {
      const topicCourse =
        courseMap.get(
          topic.course_id,
        );

      records.push({
        key: "",
        kind: "topic",
        title: topic.name,
        subtitle:
          `${topicCourse?.code ?? "Topic"} · ${Math.round(
            Number(
              topic.mastery_score ??
                0,
            ),
          )}% mastery`,
        href:
          `/study?course=${topic.course_id}&topics=${topic.id}`,
        color:
          topicCourse?.color ??
          null,
        body:
          `${truncate(
            topic.description,
            700,
          )} Mastery state: ${topic.mastery_state}. Mastery score: ${Math.round(
            Number(
              topic.mastery_score ??
                0,
            ),
          )}%.`,
        courseId:
          topic.course_id,
        timestamp:
          topic.created_at ??
          null,
      });
    }

    for (
      const note of
      notes ?? []
    ) {
      const noteCourse =
        note.course_id
          ? courseMap.get(
              note.course_id,
            )
          : null;

      records.push({
        key: "",
        kind: "note",
        title:
          note.title ||
          "Untitled note",
        subtitle:
          noteCourse
            ? `${noteCourse.code} · note`
            : "Standalone note",
        href:
          `/notes?note=${note.id}`,
        color:
          noteCourse?.color ??
          null,
        body:
          truncate(
            note.enhanced_content ||
              note.raw_content,
            2200,
          ),
        courseId:
          note.course_id ??
          null,
        timestamp:
          note.updated_at,
      });
    }

    for (
      const lecture of
      lectures ?? []
    ) {
      const lectureCourse =
        courseMap.get(
          lecture.course_id,
        );

      records.push({
        key: "",
        kind: "lecture",
        title: lecture.title,
        subtitle:
          `${lectureCourse?.code ?? "Lecture"} · ${lecture.status}`,
        href:
          `/lectures/${lecture.id}`,
        color:
          lectureCourse?.color ??
          null,
        body:
          [
            truncate(
              lecture.summary,
              1000,
            ),
            truncate(
              lecture.transcript_text,
              2200,
            ),
          ]
            .filter(Boolean)
            .join(" "),
        courseId:
          lecture.course_id,
        timestamp:
          lecture.captured_at ??
          lecture.updated_at ??
          null,
      });
    }

    for (
      const analysis of
      analyses ?? []
    ) {
      const file =
        fileMap.get(
          analysis.course_file_id,
        );

      const materialCourse =
        courseMap.get(
          analysis.course_id,
        );

      records.push({
        key: "",
        kind: "material",
        title:
          file?.file_name ??
          "Analyzed material",
        subtitle:
          `${materialCourse?.code ?? "Material"} · ${file?.material_type?.replaceAll(
            "_",
            " ",
          ) ?? "analysis"}`,
        href:
          `/courses/${analysis.course_id}?material=${analysis.course_file_id}`,
        color:
          materialCourse?.color ??
          null,
        body:
          truncate(
            analysis.summary,
            1800,
          ),
        courseId:
          analysis.course_id,
        timestamp: null,
      });
    }

    for (
      const event of
      events ?? []
    ) {
      const eventCourse =
        courseMap.get(
          event.course_id,
        );

      records.push({
        key: "",
        kind:
          "assignment",
        title: event.name,
        subtitle:
          `${eventCourse?.code ?? "Course"} · ${event.event_type}`,
        href: "/calendar",
        color:
          eventCourse?.color ??
          null,
        body:
          `${event.name}. Type: ${event.event_type}. Date: ${event.start_date}. ${truncate(
            event.notes,
            500,
          )}`,
        courseId:
          event.course_id,
        timestamp:
          event.start_date,
      });
    }

    for (
      const item of
      calendarItems ?? []
    ) {
      const itemCourse =
        item.course_id
          ? courseMap.get(
              item.course_id,
            )
          : null;

      records.push({
        key: "",
        kind: "calendar",
        title: item.title,
        subtitle:
          `${itemCourse?.code ?? "Calendar"} · ${item.item_type}`,
        href: "/calendar",
        color:
          itemCourse?.color ??
          null,
        body:
          `${item.title}. Type: ${item.item_type}. Starts: ${item.starts_at}. Ends: ${item.ends_at}. Status: ${item.status}. ${truncate(
            item.notes,
            500,
          )}`,
        courseId:
          item.course_id ??
          null,
        timestamp:
          item.starts_at,
      });
    }

    for (
      const guide of
      guides ?? []
    ) {
      const guideCourse =
        courseMap.get(
          guide.course_id,
        );

      records.push({
        key: "",
        kind:
          "study_guide",
        title: guide.title,
        subtitle:
          `${guideCourse?.code ?? "Study"} · ${guide.depth_percent}% guide`,
        href:
          `/study/guide/${guide.id}`,
        color:
          guideCourse?.color ??
          null,
        body:
          truncate(
            JSON.stringify(
              guide.content ??
                {},
            ),
            2600,
          ),
        courseId:
          guide.course_id,
        timestamp:
          guide.updated_at,
      });
    }

    for (
      const activeCourse of
      activeCourses
    ) {
      records.push({
        key: "",
        kind: "course",
        title:
          activeCourse.code,
        subtitle:
          activeCourse.name,
        href:
          `/courses/${activeCourse.id}`,
        color:
          activeCourse.color,
        body:
          `${activeCourse.code}: ${activeCourse.name}`,
        courseId:
          activeCourse.id,
        timestamp: null,
      });
    }

    const tokens =
      tokensFrom(
        question,
      );

    const ranked =
      records
        .map((record) => ({
          record,
          score:
            relevanceScore({
              record,
              question,
              tokens,
              courseId:
                course?.id ??
                null,
            }),
        }))
        .sort(
          (a, b) =>
            b.score - a.score,
        );

    let selected =
      ranked
        .filter(
          (entry) =>
            entry.score > 0,
        )
        .slice(0, 8)
        .map(
          (entry) =>
            entry.record,
        );

    if (
      selected.length === 0
    ) {
      selected =
        ranked
          .slice(0, 6)
          .map(
            (entry) =>
              entry.record,
          );
    }

    if (
      selected.length === 0
    ) {
      return NextResponse.json({
        ok: true,
        answer:
          "I do not have enough academic data in your workspace to answer that yet.",
        sources: [],
        mode: "grounded",
      });
    }

    const keyed =
      selected.map(
        (record, index) => ({
          ...record,
          key:
            `S${index + 1}`,
        }),
      );

    const contextText =
      keyed
        .map(
          (record) =>
            `[${record.key}] ${record.kind.toUpperCase()} | ${record.title} | ${record.subtitle}\n${record.body}`,
        )
        .join("\n\n");

    const currentTime =
      new Intl.DateTimeFormat(
        "en-US",
        {
          timeZone,
          dateStyle:
            "full",
          timeStyle:
            "short",
        },
      ).format(
        new Date(),
      );

    const completion =
      await groundedCompletion({
        question,
        contextText,
        currentTime,
      });

    const parsed =
      parseCompletion(
        completion,
      );

    const requestedKeys =
      new Set(
        parsed.keys.map(
          (key) =>
            key.toUpperCase(),
        ),
      );

    const chosenSources =
      (
        requestedKeys.size > 0
          ? keyed.filter(
              (record) =>
                requestedKeys.has(
                  record.key,
                ),
            )
          : keyed.slice(0, 3)
      ).slice(0, 5);

    const sources:
      AnswerSource[] =
      chosenSources.map(
        (record) => ({
          key: record.key,
          kind: record.kind,
          title: record.title,
          subtitle:
            record.subtitle,
          href: record.href,
          color: record.color,
        }),
      );

    return NextResponse.json({
      ok: true,
      answer:
        parsed.answer ||
        "I found relevant academic context, but could not form a clean answer.",
      sources,
      mode: "grounded",
    });
  } catch (error) {
    console.error(
      "Academic OS question failed:",
      error,
    );

    const candidate =
      error as {
        status?: number;
        message?: string;
      };

    const rateLimited =
      candidate.status ===
        429 ||
      candidate.message
        ?.toLowerCase()
        .includes(
          "rate limit",
        );

    return NextResponse.json(
      {
        ok: false,
        error:
          rateLimited
            ? "Academic OS is busy because the AI provider is rate-limited. Search still works, and you can try the question again shortly."
            : candidate.message ||
              "Could not answer that question.",
      },
      {
        status: 500,
      },
    );
  }
}