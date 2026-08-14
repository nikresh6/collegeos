import { NextResponse } from "next/server";
import { generateStructured } from "../../../lib/ai/groq";
import {
  calculateGradebook,
  effectiveGradeScale,
  normalizeGradeScale,
  rankImprovementOpportunities,
  requiredScoreOnNewItem,
  type GradeCategoryInput,
  type GradeItemInput,
  type GradeScaleInput,
} from "../../../lib/grades";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChatContext = {
  course: {
    code: string;
    name: string;
  };
  categories: GradeCategoryInput[];
  items: GradeItemInput[];
  scale: GradeScaleInput[];
};

type ParseResult = {
  intent:
    | "target_score"
    | "improvement_advice"
    | "standing"
    | "category_question"
    | "general";
  targetLetter: string;
  targetPercent: number;
  categoryName: string;
  pointsPossible: number;
  generalAnswer: string;
};

const parseSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    intent: {
      type: "string",
      enum: [
        "target_score",
        "improvement_advice",
        "standing",
        "category_question",
        "general",
      ],
    },
    targetLetter: { type: "string" },
    targetPercent: { type: "number" },
    categoryName: { type: "string" },
    pointsPossible: { type: "number" },
    generalAnswer: { type: "string" },
  },
  required: [
    "intent",
    "targetLetter",
    "targetPercent",
    "categoryName",
    "pointsPossible",
    "generalAnswer",
  ],
};

function isContext(value: unknown): value is ChatContext {
  if (!value || typeof value !== "object") return false;

  const record = value as Record<string, unknown>;

  return (
    typeof record.course === "object" &&
    Array.isArray(record.categories) &&
    Array.isArray(record.items) &&
    Array.isArray(record.scale)
  );
}

function categoryContext(
  categories: GradeCategoryInput[],
  items: GradeItemInput[],
) {
  const summary = calculateGradebook(
    categories,
    items,
    [],
  );

  return summary.categories
    .map((category) => {
      const percent =
        category.percent === null
          ? "no grades yet"
          : `${category.percent.toFixed(2)}%`;

      return `- ${category.name}: ${category.weightPercent}% weight, ${percent}, ${category.earned}/${category.possible} points, ${category.itemCount} graded items`;
    })
    .join("\n");
}

function findCategoryByName(
  categories: GradeCategoryInput[],
  requested: string,
) {
  const normalized = requested
    .trim()
    .toLowerCase();

  if (!normalized) return null;

  const exact = categories.find(
    (category) =>
      category.name.trim().toLowerCase() === normalized,
  );

  if (exact) return exact;

  const partial = categories.find((category) => {
    const name = category.name
      .trim()
      .toLowerCase();

    return (
      name.includes(normalized) ||
      normalized.includes(name)
    );
  });

  return partial ?? null;
}

function formatNumber(value: number) {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(1);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      message?: string;
      history?: Array<{
        role: "user" | "assistant";
        content: string;
      }>;
      context?: unknown;
    };

    const message = body.message?.trim() ?? "";

    if (!message) {
      return NextResponse.json(
        {
          ok: false,
          error: "Ask a grade question first.",
        },
        { status: 400 },
      );
    }

    if (!isContext(body.context)) {
      return NextResponse.json(
        {
          ok: false,
          error: "Grade context is missing.",
        },
        { status: 400 },
      );
    }

    const context = body.context;
    const summary = calculateGradebook(
      context.categories,
      context.items,
      context.scale,
    );
    const scale = normalizeGradeScale(
      effectiveGradeScale(context.scale),
    );

    const historyText = (body.history ?? [])
      .slice(-6)
      .map(
        (entry) =>
          `${entry.role.toUpperCase()}: ${entry.content}`,
      )
      .join("\n");

    const parsed = await generateStructured<ParseResult>({
      system: `You are a grade-planning parser and coach.

Your first job is to understand the student's question.
Do not perform grade arithmetic yourself.

Choose one intent:
- target_score: asking what score is needed on a future assignment, quiz, exam, final, or other graded item to reach a target grade or percentage.
- improvement_advice: asking what to focus on, what is easiest to improve, or where the biggest opportunities are.
- standing: asking where they currently stand or how close they are to the next letter grade.
- category_question: asking about one grading category.
- general: a qualitative grade question that does not fit the above.

Rules:
1. If a category is clearly implied by the student's wording, map categoryName to the closest exact category name supplied below.
2. If the category is ambiguous, return an empty categoryName.
3. targetLetter should be exactly the requested letter grade when one is named, otherwise empty.
4. targetPercent should be the requested numeric target when one is named, otherwise 0.
5. pointsPossible should be the point value of the future item if supplied, otherwise 0.
6. generalAnswer may contain a concise qualitative answer, but it must not invent arithmetic.
7. Do not invent scores, weights, cutoffs, or categories.

COURSE:
${context.course.code} ${context.course.name}

CURRENT GRADE:
${
  summary.currentPercent === null
    ? "No graded work yet"
    : `${summary.currentPercent.toFixed(2)}%`
}
LETTER GRADE:
${summary.letterGrade ?? "Not available"}

CATEGORIES:
${categoryContext(context.categories, context.items)}

GRADE SCALE:
${
  scale.length > 0
    ? scale
        .map(
          (row) =>
            `- ${row.letterGrade}: minimum ${row.minPercent}%`,
        )
        .join("\n")
    : "No course-specific grade scale is configured."
}`,
      user: `${historyText ? `${historyText}\n\n` : ""}CURRENT USER MESSAGE: ${message}`,
      schemaName: "grade_chat_parse",
      schema: parseSchema,
      temperature: 0.05,
      maxTokens: 500,
    });

    if (parsed.intent === "target_score") {
      let targetPercent =
        parsed.targetPercent > 0
          ? parsed.targetPercent
          : 0;

      if (
        targetPercent <= 0 &&
        parsed.targetLetter.trim()
      ) {
        const requested = parsed.targetLetter
          .trim()
          .toLowerCase();

        const level = scale.find(
          (row) =>
            row.letterGrade.toLowerCase() === requested,
        );

        targetPercent = level?.minPercent ?? 0;
      }

      if (targetPercent <= 0) {
        return NextResponse.json({
          ok: true,
          answer:
            "Tell me the target you want to reach, for example B+, A-, or 90%.",
        });
      }

      if (parsed.pointsPossible <= 0) {
        return NextResponse.json({
          ok: true,
          answer:
            "Tell me how many points the upcoming assignment or exam is worth, then I can calculate the exact score you need.",
        });
      }

      let categoryId: string | null = null;
      let categoryName = "";

      if (summary.mode === "weighted") {
        const matchedCategory = findCategoryByName(
          context.categories,
          parsed.categoryName,
        );

        if (!matchedCategory) {
          const categoryList = context.categories
            .map((category) => category.name)
            .join(", ");

          return NextResponse.json({
            ok: true,
            answer: `Which grading category is this item in? Your categories are: ${categoryList}.`,
          });
        }

        categoryId = matchedCategory.id;
        categoryName = matchedCategory.name;
      }

      const calculation = requiredScoreOnNewItem({
        categories: context.categories,
        items: context.items,
        categoryId,
        pointsPossible: parsed.pointsPossible,
        targetPercent,
      });

      if (!calculation) {
        return NextResponse.json({
          ok: true,
          answer:
            "I do not have enough grading information to calculate that scenario yet.",
        });
      }

      const targetLabel =
        parsed.targetLetter.trim() ||
        `${formatNumber(targetPercent)}%`;

      if (calculation.requiredPoints <= 0) {
        return NextResponse.json({
          ok: true,
          answer: `You are already positioned to remain at or above ${targetLabel} even with a very low score on this ${formatNumber(parsed.pointsPossible)} point item, based on the grades currently entered.`,
        });
      }

      if (!calculation.achievable) {
        return NextResponse.json({
          ok: true,
          answer: `This one ${formatNumber(parsed.pointsPossible)} point ${
            categoryName
              ? `${categoryName} `
              : ""
          }item cannot get you to ${targetLabel} by itself. You would need about ${formatNumber(calculation.requiredPoints)} points, or ${formatNumber(calculation.requiredPercent)}%, which is above the available points. Even a perfect score would put the calculated grade around ${formatNumber(calculation.resultingWithMax)}%.`,
        });
      }

      return NextResponse.json({
        ok: true,
        answer: `To reach ${targetLabel}, you need about ${formatNumber(calculation.requiredPoints)}/${formatNumber(parsed.pointsPossible)} on this ${
          categoryName ? `${categoryName} ` : ""
        }item, which is about ${formatNumber(calculation.requiredPercent)}%.`,
      });
    }

    if (parsed.intent === "improvement_advice") {
      const opportunities =
        rankImprovementOpportunities(summary);

      if (opportunities.length === 0) {
        return NextResponse.json({
          ok: true,
          answer:
            "Add a few graded items first and I can tell you where the highest-impact opportunities are.",
        });
      }

      const top = opportunities.slice(0, 2);

      const advice = top
        .map((category) => {
          const score = category.percent ?? 0;
          return `${category.name} is currently ${formatNumber(score)}% and carries ${formatNumber(category.weightPercent)}% of the course weight`;
        })
        .join(". ");

      return NextResponse.json({
        ok: true,
        answer: `The clearest opportunities are in ${top
          .map((category) => category.name)
          .join(" and ")}. ${advice}. Those categories have more room to improve than areas where you are already scoring strongly, so gains there are likely to move your overall grade more efficiently.`,
      });
    }

    if (parsed.intent === "standing") {
      if (summary.currentPercent === null) {
        return NextResponse.json({
          ok: true,
          answer:
            "You do not have enough graded work entered yet to calculate a current standing.",
        });
      }

      if (summary.nextLevel) {
        return NextResponse.json({
          ok: true,
          answer: `You are currently at ${formatNumber(summary.currentPercent)}%${
            summary.letterGrade
              ? `, which maps to ${summary.letterGrade}`
              : ""
          }. The next course-specific level is ${summary.nextLevel.letterGrade} at ${formatNumber(summary.nextLevel.minPercent)}%, so you are ${formatNumber(summary.pointsToNextLevel ?? 0)} percentage points away.`,
        });
      }

      return NextResponse.json({
        ok: true,
        answer: `You are currently at ${formatNumber(summary.currentPercent)}%${
          summary.letterGrade
            ? `, which maps to ${summary.letterGrade}`
            : ""
        }. Based on the grading scale you entered, you are already in the highest configured letter-grade band.`,
      });
    }

    if (parsed.intent === "category_question") {
      const matched = findCategoryByName(
        context.categories,
        parsed.categoryName,
      );

      if (!matched) {
        return NextResponse.json({
          ok: true,
          answer:
            parsed.generalAnswer ||
            "Tell me which grading category you want to look at.",
        });
      }

      const category = summary.categories.find(
        (item) => item.id === matched.id,
      );

      if (!category || category.percent === null) {
        return NextResponse.json({
          ok: true,
          answer: `${matched.name} does not have any graded items entered yet.`,
        });
      }

      return NextResponse.json({
        ok: true,
        answer: `${matched.name} is currently ${formatNumber(category.percent)}% from ${formatNumber(category.earned)}/${formatNumber(category.possible)} points across ${category.itemCount} graded items. It represents ${formatNumber(category.weightPercent)}% of the course.`,
      });
    }

    return NextResponse.json({
      ok: true,
      answer:
        parsed.generalAnswer ||
        "I can help with target scores, category performance, level-up planning, and where to focus for the biggest grade improvement.",
    });
  } catch (error) {
    console.error("Grade Coach failed:", error);

    const message =
      error instanceof Error
        ? error.message
        : "Grade Coach could not answer that.";

    const lower = message.toLowerCase();

    return NextResponse.json(
      {
        ok: false,
        code:
          lower.includes("429") ||
          lower.includes("rate limit")
            ? "GROQ_RATE_LIMITED"
            : "GRADE_CHAT_FAILED",
        error:
          lower.includes("429") ||
          lower.includes("rate limit")
            ? "Grade Coach is temporarily at its AI throughput limit. The grade calculations themselves still work."
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