import { NextResponse } from "next/server";
import { generateStructured } from "../../../lib/ai/groq";
import {
  calculateGradebook,
  effectiveGradeScale,
  normalizeGradeScale,
  type GradeCategoryInput,
  type GradeItemInput,
  type GradeScaleInput,
} from "../../../lib/grades";
import {
  calculateTrackedCumulativeGpa,
  gradePointForLetter,
  goalProgress,
  projectCourseLetter,
  projectWeightedCategoryPercent,
  type GpaCourse,
  type HistoricalGpaCourse,
} from "../../../lib/gpa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CourseContext = GpaCourse & {
  color?: string;
  categories: GradeCategoryInput[];
  items: GradeItemInput[];
  scale: GradeScaleInput[];
};

type GpaChatContext = {
  targetGpa: number;
  activeCourses: CourseContext[];
  historicalCourses: HistoricalGpaCourse[];
};

type ParseResult = {
  intent:
    | "course_letter_scenario"
    | "category_letter_scenario"
    | "category_percent_scenario"
    | "gpa_standing"
    | "goal_strategy"
    | "course_standing"
    | "general";
  courseMention: string;
  categoryMention: string;
  targetLetter: string;
  targetPercent: number;
  generalAnswer: string;
};

const parseSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    intent: {
      type: "string",
      enum: [
        "course_letter_scenario",
        "category_letter_scenario",
        "category_percent_scenario",
        "gpa_standing",
        "goal_strategy",
        "course_standing",
        "general",
      ],
    },
    courseMention: { type: "string" },
    categoryMention: { type: "string" },
    targetLetter: { type: "string" },
    targetPercent: { type: "number" },
    generalAnswer: { type: "string" },
  },
  required: [
    "intent",
    "courseMention",
    "categoryMention",
    "targetLetter",
    "targetPercent",
    "generalAnswer",
  ],
};

function findCourse(
  courses: CourseContext[],
  mention: string,
) {
  const normalized = mention
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");

  if (!normalized) {
    return courses.length === 1 ? courses[0] : null;
  }

  const exact = courses.find((course) => {
    const code = course.code
      .toLowerCase()
      .replace(/\s+/g, "");
    const name = course.name
      .toLowerCase()
      .replace(/\s+/g, "");

    return (
      code === normalized ||
      name === normalized
    );
  });

  if (exact) return exact;

  return (
    courses.find((course) => {
      const code = course.code
        .toLowerCase()
        .replace(/\s+/g, "");
      const name = course.name
        .toLowerCase()
        .replace(/\s+/g, "");

      return (
        code.includes(normalized) ||
        normalized.includes(code) ||
        name.includes(normalized) ||
        normalized.includes(name)
      );
    }) ?? null
  );
}

function findCategory(
  course: CourseContext,
  mention: string,
) {
  const normalized = mention.trim().toLowerCase();

  if (!normalized) return null;

  const exact = course.categories.find(
    (category) =>
      category.name.trim().toLowerCase() === normalized,
  );

  if (exact) return exact;

  return (
    course.categories.find((category) => {
      const name = category.name.trim().toLowerCase();

      return (
        name.includes(normalized) ||
        normalized.includes(name)
      );
    }) ?? null
  );
}

function formatGpa(value: number | null) {
  return value === null ? "--" : value.toFixed(2);
}

function formatPercent(value: number) {
  return Number.isInteger(value)
    ? `${value}%`
    : `${value.toFixed(1)}%`;
}

function courseLines(courses: CourseContext[]) {
  return courses
    .map((course) => {
      const categories = course.categories
        .map((category) => category.name)
        .join(", ");

      return `- ${course.code} | ${course.name} | ${course.credits} credits | current ${course.letterGrade ?? "ungraded"} (${course.currentPercent === null ? "no percentage" : `${course.currentPercent.toFixed(2)}%`}) | categories: ${categories || "none"}`;
    })
    .join("\n");
}

function normalizedTargetLetter(
  value: string,
) {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      message?: string;
      history?: Array<{
        role: "user" | "assistant";
        content: string;
      }>;
      context?: GpaChatContext;
    };

    const message = body.message?.trim() ?? "";
    const context = body.context;

    if (!message) {
      return NextResponse.json(
        {
          ok: false,
          error: "Ask a GPA question first.",
        },
        { status: 400 },
      );
    }

    if (
      !context ||
      !Array.isArray(context.activeCourses) ||
      !Array.isArray(context.historicalCourses)
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: "GPA context is missing.",
        },
        { status: 400 },
      );
    }

    const currentCumulative =
      calculateTrackedCumulativeGpa({
        activeCourses: context.activeCourses,
        historicalCourses: context.historicalCourses,
      });

    const currentSemester = calculateTrackedCumulativeGpa({
      activeCourses: context.activeCourses,
      historicalCourses: [],
    });

    const historyText = (body.history ?? [])
      .slice(-6)
      .map(
        (entry) =>
          `${entry.role.toUpperCase()}: ${entry.content}`,
      )
      .join("\n");

    const parsed = await generateStructured<ParseResult>({
      system: `You are a parser for a college GPA planning assistant.

Your job is to identify what the student wants. Do not do GPA arithmetic yourself.

INTENTS:
- course_letter_scenario: hypothetical where an entire course ends at a specific letter grade, such as "If I get MATH 2500 up to an A, what happens to my GPA?"
- category_letter_scenario: hypothetical where a grading category such as Final, Exams, Homework, or Attendance finishes at a letter-grade level, such as "If I get an A- on the final, what would my GPA be?"
- category_percent_scenario: hypothetical where a grading category finishes at a numeric percentage.
- gpa_standing: current GPA, gap to target, or general progress toward target.
- goal_strategy: asks what course or area would help GPA most, or how to reach the target efficiently.
- course_standing: asks about one course's current grade.
- general: qualitative question that does not fit the above.

RULES:
1. courseMention should map to the closest course code or course name supplied below.
2. categoryMention should map to the closest grading category name when relevant.
3. If the user says "final" and the course has a category called Final, Final Exam, Final Exam(s), or similar, use that category.
4. targetLetter should be the requested letter grade, otherwise empty.
5. targetPercent should be the requested numeric percentage, otherwise 0.
6. Never invent a course, category, grade, target, or score.
7. If the user is vague and there are multiple possible courses, leave courseMention empty.
8. generalAnswer may contain a short qualitative response but must not invent arithmetic.

TARGET GPA:
${context.targetGpa.toFixed(2)}

TRACKED SEMESTER GPA:
${formatGpa(currentSemester.gpa)}

TRACKED CUMULATIVE GPA:
${formatGpa(currentCumulative.gpa)}

ACTIVE COURSES:
${courseLines(context.activeCourses)}

IMPORTANT:
"cumulative GPA" here means the GPA across courses currently tracked in the app, including archived courses with recorded final grades and active courses with current calculated grades.`,
      user: `${historyText ? `${historyText}\n\n` : ""}CURRENT USER MESSAGE: ${message}`,
      schemaName: "gpa_chat_parse",
      schema: parseSchema,
      temperature: 0.05,
      maxTokens: 500,
    });

    if (parsed.intent === "gpa_standing") {
      if (currentSemester.gpa === null) {
        return NextResponse.json({
          ok: true,
          answer:
            "You do not have enough graded course data yet to calculate a GPA.",
        });
      }

      const goal = goalProgress(
        currentSemester.gpa,
        context.targetGpa,
      );

      return NextResponse.json({
        ok: true,
        answer: goal.reached
          ? `Your tracked semester GPA is ${currentSemester.gpa.toFixed(2)}, which is at or above your ${context.targetGpa.toFixed(2)} goal. Your tracked cumulative GPA is ${formatGpa(currentCumulative.gpa)}.`
          : `Your tracked semester GPA is ${currentSemester.gpa.toFixed(2)}. You are ${goal.gap?.toFixed(2)} GPA points from your ${context.targetGpa.toFixed(2)} goal. Your tracked cumulative GPA is ${formatGpa(currentCumulative.gpa)}.`,
      });
    }

    if (parsed.intent === "course_standing") {
      const course = findCourse(
        context.activeCourses,
        parsed.courseMention,
      );

      if (!course) {
        return NextResponse.json({
          ok: true,
          answer:
            "Which course do you want me to look at?",
        });
      }

      if (
        course.currentPercent === null ||
        !course.letterGrade
      ) {
        return NextResponse.json({
          ok: true,
          answer: `${course.code} does not have enough entered grades to calculate a current standing yet.`,
        });
      }

      return NextResponse.json({
        ok: true,
        answer: `${course.code} is currently ${course.currentPercent.toFixed(2)}%, which maps to ${course.letterGrade}. It carries ${course.credits} credits in the GPA calculation.`,
      });
    }

    if (parsed.intent === "course_letter_scenario") {
      const course = findCourse(
        context.activeCourses,
        parsed.courseMention,
      );

      if (!course) {
        return NextResponse.json({
          ok: true,
          answer:
            context.activeCourses.length > 1
              ? "Which course do you want to change in that scenario?"
              : "I could not identify the course in that scenario.",
        });
      }

      const targetLetter = normalizedTargetLetter(
        parsed.targetLetter,
      );

      if (
        !targetLetter ||
        gradePointForLetter(targetLetter) === null
      ) {
        return NextResponse.json({
          ok: true,
          answer:
            "Tell me the letter grade you want to model, for example A, A-, or B+.",
        });
      }

      const projected = projectCourseLetter({
        activeCourses: context.activeCourses,
        historicalCourses: context.historicalCourses,
        courseId: course.id,
        letterGrade: targetLetter,
      });

      const before = currentCumulative.gpa;
      const after = projected.gpa;

      if (after === null) {
        return NextResponse.json({
          ok: true,
          answer:
            "I do not have enough tracked credit and grade data to calculate that projection yet.",
        });
      }

      const goalBefore = goalProgress(
        before,
        context.targetGpa,
      );
      const goalAfter = goalProgress(
        after,
        context.targetGpa,
      );

      const movement =
        before === null ? null : after - before;

      const movementText =
        movement === null
          ? ""
          : movement >= 0
            ? ` That raises the tracked cumulative GPA by about ${movement.toFixed(2)}.`
            : ` That lowers the tracked cumulative GPA by about ${Math.abs(movement).toFixed(2)}.`;

      const goalText = goalAfter.reached
        ? ` You would be at or above your ${context.targetGpa.toFixed(2)} GPA goal.`
        : ` You would be about ${goalAfter.gap?.toFixed(2)} away from your ${context.targetGpa.toFixed(2)} goal${
            goalBefore.gap !== null &&
            goalAfter.gap !== null &&
            goalAfter.gap < goalBefore.gap
              ? `, closing the gap by ${(goalBefore.gap - goalAfter.gap).toFixed(2)}`
              : ""
          }.`;

      return NextResponse.json({
        ok: true,
        answer: `If ${course.code} finished at ${targetLetter}, your tracked cumulative GPA would be about ${after.toFixed(2)}.${movementText}${goalText}`,
      });
    }

    if (
      parsed.intent === "category_letter_scenario" ||
      parsed.intent === "category_percent_scenario"
    ) {
      const course = findCourse(
        context.activeCourses,
        parsed.courseMention,
      );

      if (!course) {
        return NextResponse.json({
          ok: true,
          answer:
            context.activeCourses.length > 1
              ? "Which course is that final or grading category for?"
              : "I could not identify the course.",
        });
      }

      const category = findCategory(
        course,
        parsed.categoryMention,
      );

      if (!category) {
        return NextResponse.json({
          ok: true,
          answer: `Which ${course.code} grading category do you mean? The configured categories are ${course.categories.map((item) => item.name).join(", ") || "not set yet"}.`,
        });
      }

      let categoryPercent = parsed.targetPercent;

      if (parsed.intent === "category_letter_scenario") {
        const targetLetter = normalizedTargetLetter(
          parsed.targetLetter,
        );

        if (!targetLetter) {
          return NextResponse.json({
            ok: true,
            answer:
              "What letter grade do you want to model for that category?",
          });
        }

        const level = normalizeGradeScale(
          effectiveGradeScale(course.scale),
        ).find(
          (row) =>
            row.letterGrade
              .trim()
              .toUpperCase() === targetLetter,
        );

        if (!level) {
          return NextResponse.json({
            ok: true,
            answer: `I could not map ${targetLetter} to the configured ${course.code} grade scale.`,
          });
        }

        categoryPercent = level.minPercent;
      }

      if (
        !Number.isFinite(categoryPercent) ||
        categoryPercent < 0
      ) {
        return NextResponse.json({
          ok: true,
          answer:
            "Tell me the grade or percentage you want to model for that category.",
        });
      }

      const projectedCourse =
        projectWeightedCategoryPercent({
          categories: course.categories,
          items: course.items,
          scale: course.scale,
          categoryId: category.id,
          categoryPercent,
        });

      if (!projectedCourse) {
        return NextResponse.json({
          ok: true,
          answer: `${course.code} is not configured in a way that lets me model that category cleanly yet. If this is a points-based course, give me the final's point value in the course-specific Grade Coach instead.`,
        });
      }

      if (!projectedCourse.projectedLetterGrade) {
        return NextResponse.json({
          ok: true,
          answer:
            "I could calculate the projected course percentage, but the course does not have a usable letter-grade scale.",
        });
      }

      const projectedGpa = projectCourseLetter({
        activeCourses: context.activeCourses,
        historicalCourses: context.historicalCourses,
        courseId: course.id,
        letterGrade:
          projectedCourse.projectedLetterGrade,
      });

      const goal = goalProgress(
        projectedGpa.gpa,
        context.targetGpa,
      );

      return NextResponse.json({
        ok: true,
        answer: `If ${course.code}'s ${category.name} category finished around ${formatPercent(categoryPercent)}, the currently entered gradebook would project the course to about ${projectedCourse.projectedPercent.toFixed(2)}% (${projectedCourse.projectedLetterGrade}). That would put your tracked cumulative GPA around ${formatGpa(projectedGpa.gpa)}${
          goal.reached
            ? `, at or above your ${context.targetGpa.toFixed(2)} goal.`
            : goal.gap === null
              ? "."
              : `, about ${goal.gap.toFixed(2)} away from your ${context.targetGpa.toFixed(2)} goal.`
        }`,
      });
    }

    if (parsed.intent === "goal_strategy") {
      const current = currentSemester.gpa;

      if (current === null) {
        return NextResponse.json({
          ok: true,
          answer:
            "Add current grades to at least one course first and I can rank the best GPA improvement opportunities.",
        });
      }

      const candidates = context.activeCourses
        .filter(
          (course) =>
            course.letterGrade &&
            gradePointForLetter(course.letterGrade) !== null &&
            course.credits > 0,
        )
        .map((course) => {
          const scale = normalizeGradeScale(
            effectiveGradeScale(course.scale),
          );

          const currentIndex = scale.findIndex(
            (row) =>
              row.letterGrade === course.letterGrade,
          );

          const nextLevel =
            currentIndex >= 0 &&
            currentIndex < scale.length - 1
              ? scale[currentIndex + 1]
              : null;

          if (!nextLevel) {
            return null;
          }

          const projected = projectCourseLetter({
            activeCourses: context.activeCourses,
            historicalCourses: [],
            courseId: course.id,
            letterGrade: nextLevel.letterGrade,
          });

          return {
            course,
            nextLetter: nextLevel.letterGrade,
            projectedGpa: projected.gpa,
            gain:
              projected.gpa === null
                ? 0
                : projected.gpa - current,
          };
        })
        .filter(
          (
            item,
          ): item is NonNullable<typeof item> =>
            Boolean(item),
        )
        .sort((a, b) => b.gain - a.gain);

      const best = candidates[0];

      if (!best || best.gain <= 0) {
        return NextResponse.json({
          ok: true,
          answer:
            "You are already at the highest configured letter-grade level in the graded courses I can evaluate.",
        });
      }

      return NextResponse.json({
        ok: true,
        answer: `${best.course.code} currently has the clearest GPA leverage. Moving it from ${best.course.letterGrade} to ${best.nextLetter} would raise your tracked semester GPA by about ${best.gain.toFixed(2)}, to roughly ${best.projectedGpa?.toFixed(2)}. Because GPA is credit-weighted, higher-credit courses generally have more leverage when the letter-grade jump is similar.`,
      });
    }

    return NextResponse.json({
      ok: true,
      answer:
        parsed.generalAnswer ||
        "I can model course letter-grade changes, finals and grading categories, your distance from your GPA goal, and which course has the most GPA leverage.",
    });
  } catch (error) {
    console.error("GPA Coach failed:", error);

    const message =
      error instanceof Error
        ? error.message
        : "GPA Coach could not answer that.";

    const lower = message.toLowerCase();

    return NextResponse.json(
      {
        ok: false,
        code:
          lower.includes("429") ||
          lower.includes("rate limit")
            ? "GROQ_RATE_LIMITED"
            : "GPA_CHAT_FAILED",
        error:
          lower.includes("429") ||
          lower.includes("rate limit")
            ? "GPA Coach is temporarily at its AI throughput limit. Your grade and GPA calculations still work."
            : message,
      },
      {
        status:
          lower.includes("429") ||
          lower.includes("rate limit")
            ? 429
            : 500,
      },
    );
  }
}