import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  groq,
  GROQ_MODELS,
} from "../../../../lib/ai/groq";
import {
  loadStudySourceContext,
} from "../../../../lib/study-source-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type QuestionType =
  | "multiple_choice"
  | "true_false"
  | "short_answer";

type GeneratedQuestion = {
  topicId: string;
  type: QuestionType;
  prompt: string;
  choices: string[];
  correctAnswer: string;
  explanation: string;
  difficulty: number;
  sourceFileIds: string[];
};

function createUserClient(accessToken: string) {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env
      .NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Supabase public environment variables are missing.",
    );
  }

  return createClient(url, key, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function bearerToken(request: Request) {
  const authorization =
    request.headers.get("authorization") ?? "";

  return authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
}

function safeStringArray(
  value: unknown,
  max: number,
) {
  if (!Array.isArray(value)) return [];

  return value
    .filter(
      (item): item is string =>
        typeof item === "string",
    )
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, max);
}

function normalizeType(
  value: unknown,
  allowed: QuestionType[],
): QuestionType {
  const candidate =
    typeof value === "string"
      ? value.trim()
      : "";

  if (
    candidate === "multiple_choice" ||
    candidate === "true_false" ||
    candidate === "short_answer"
  ) {
    if (allowed.includes(candidate)) {
      return candidate;
    }
  }

  return allowed[0] ?? "multiple_choice";
}

function isRateLimitError(error: unknown) {
  const candidate = error as {
    status?: number;
    message?: string;
  };

  const message =
    candidate?.message?.toLowerCase() ?? "";

  return (
    candidate?.status === 429 ||
    message.includes("429") ||
    message.includes("rate limit") ||
    message.includes("rate_limit")
  );
}

function retryAfterSeconds(error: unknown) {
  const candidate = error as {
    headers?:
      | Headers
      | Record<string, string | undefined>;
  };

  const headers = candidate?.headers;
  let raw: string | null | undefined;

  if (
    headers &&
    typeof (headers as Headers).get === "function"
  ) {
    raw = (headers as Headers).get("retry-after");
  } else if (headers) {
    raw =
      (headers as Record<string, string | undefined>)[
        "retry-after"
      ];
  }

  const parsed = Number(raw);

  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(90, Math.ceil(parsed))
    : 15;
}

export async function POST(request: Request) {
  const accessToken = bearerToken(request);

  if (!accessToken) {
    return NextResponse.json(
      {
        ok: false,
        error: "You are not signed in.",
      },
      { status: 401 },
    );
  }

  const supabase =
    createUserClient(accessToken);

  try {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError) throw userError;

    if (!user) {
      return NextResponse.json(
        {
          ok: false,
          error: "You are not signed in.",
        },
        { status: 401 },
      );
    }

    const body = (await request.json()) as {
      courseId?: string;
      topicIds?: string[];
      strategy?: "manual" | "adaptive";
      questionCount?: number;
      questionTypes?: QuestionType[];
    };

    const courseId =
      body.courseId?.trim() ?? "";

    const topicIds = Array.from(
      new Set(
        (body.topicIds ?? []).filter(Boolean),
      ),
    ).slice(0, 12);

    const strategy =
      body.strategy === "adaptive"
        ? "adaptive"
        : "manual";

    const questionCount = Math.max(
      3,
      Math.min(
        20,
        Math.round(
          Number(body.questionCount ?? 10),
        ),
      ),
    );

    const allowedTypes = Array.from(
      new Set(
        (body.questionTypes ?? []).filter(
          (
            type,
          ): type is QuestionType =>
            type === "multiple_choice" ||
            type === "true_false" ||
            type === "short_answer",
        ),
      ),
    );

    if (!courseId) {
      return NextResponse.json(
        {
          ok: false,
          error: "Choose a course.",
        },
        { status: 400 },
      );
    }

    if (topicIds.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Choose at least one topic to study.",
        },
        { status: 400 },
      );
    }

    if (allowedTypes.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Choose at least one question type.",
        },
        { status: 400 },
      );
    }

    const [
      { data: course, error: courseError },
      sourceContext,
    ] = await Promise.all([
      supabase
        .from("courses")
        .select("id, code, name")
        .eq("id", courseId)
        .single(),
      loadStudySourceContext({
        supabase,
        courseId,
        topicIds,
        maxCharacters: 18000,
      }),
    ]);

    if (courseError) throw courseError;

    if (!sourceContext.contextText.trim()) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "There is not enough analyzed material connected to those topics yet. Analyze a lecture, notes, slides, or another material first.",
        },
        { status: 400 },
      );
    }

    const topicList =
      sourceContext.topics
        .map(
          (topic) =>
            `- ${topic.id}: ${topic.name}`,
        )
        .join("\n");

    const typeInstruction =
      allowedTypes
        .map((type) => {
          if (type === "multiple_choice") {
            return "multiple_choice: exactly 4 choices, correctAnswer must exactly match one choice";
          }

          if (type === "true_false") {
            return 'true_false: choices must be ["True","False"], correctAnswer must be exactly "True" or "False"';
          }

          return "short_answer: choices must be [], correctAnswer should be a concise model answer";
        })
        .join("\n");

    const completion =
      await groq.chat.completions.create({
        model:
          GROQ_MODELS.lectureChunk,
        messages: [
          {
            role: "system",
            content: `You create a college practice quiz using ONLY the supplied course-material context.

SOURCE-GROUNDING RULES:
1. Every question must be answerable from the supplied material context.
2. Never add outside facts, examples, dates, terminology, or interpretations.
3. Preserve the course's terminology and framing.
4. Avoid trivia unless the source treats the detail as meaningful.
5. Prefer conceptual understanding, distinctions, cause/effect, application of ideas explicitly taught, and professor-emphasized points.
6. Do not ask duplicate questions.
7. Spread questions across the selected topics when the source coverage allows.
8. topicId must be one of the supplied topic IDs.
9. sourceFileIds may only use SOURCE IDs that appear in the context for that topic.
10. Difficulty is 1, 2, or 3.
11. Mix the requested question types as evenly as practical.

REQUESTED QUESTION TYPES:
${typeInstruction}

OUTPUT:
Return ONLY one valid JSON object:
{
  "title": string,
  "questions": [
    {
      "topicId": string,
      "type": "multiple_choice" | "true_false" | "short_answer",
      "prompt": string,
      "choices": string[],
      "correctAnswer": string,
      "explanation": string,
      "difficulty": number,
      "sourceFileIds": string[]
    }
  ]
}

Return about ${questionCount} questions. Do not omit "questions".`,
          },
          {
            role: "user",
            content: `COURSE:
${course.code} ${course.name}

SELECTED TOPICS:
${topicList}

SOURCE MATERIAL:
${sourceContext.contextText}`,
          },
        ],
        response_format: {
          type: "json_object",
        },
        reasoning_effort: "low",
        include_reasoning: false,
        temperature: 0.16,
        max_completion_tokens:
          Math.min(
            3000,
            850 +
              questionCount * 115,
          ),
      });

    const content =
      completion.choices[0]?.message?.content;

    if (!content) {
      throw new Error(
        "Groq returned an empty quiz.",
      );
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error(
        "Groq returned invalid JSON while creating the quiz.",
      );
    }

    const value =
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};

    const validTopicIds = new Set(
      sourceContext.topics.map(
        (topic) => topic.id,
      ),
    );

    const validSourceIds = new Set(
      sourceContext.sourceRefs.map(
        (source) => source.fileId,
      ),
    );

    const questions: GeneratedQuestion[] =
      Array.isArray(value.questions)
        ? value.questions
            .map((question) => {
              if (
                !question ||
                typeof question !== "object" ||
                Array.isArray(question)
              ) {
                return null;
              }

              const item =
                question as Record<
                  string,
                  unknown
                >;

              const prompt =
                typeof item.prompt === "string"
                  ? item.prompt.trim()
                  : "";

              const topicId =
                typeof item.topicId === "string" &&
                validTopicIds.has(
                  item.topicId,
                )
                  ? item.topicId
                  : "";

              if (!prompt || !topicId) {
                return null;
              }

              const type =
                normalizeType(
                  item.type,
                  allowedTypes,
                );

              let choices =
                safeStringArray(
                  item.choices,
                  4,
                );

              let correctAnswer =
                typeof item.correctAnswer ===
                "string"
                  ? item.correctAnswer.trim()
                  : "";

              if (
                type === "multiple_choice"
              ) {
                if (
                  choices.length !== 4 ||
                  !choices.includes(
                    correctAnswer,
                  )
                ) {
                  return null;
                }
              }

              if (type === "true_false") {
                choices = [
                  "True",
                  "False",
                ];

                if (
                  correctAnswer !== "True" &&
                  correctAnswer !== "False"
                ) {
                  return null;
                }
              }

              if (type === "short_answer") {
                choices = [];

                if (!correctAnswer) {
                  return null;
                }
              }

              const difficulty = Math.max(
                1,
                Math.min(
                  3,
                  Math.round(
                    Number(
                      item.difficulty ?? 2,
                    ),
                  ),
                ),
              );

              const sourceFileIds =
                safeStringArray(
                  item.sourceFileIds,
                  6,
                ).filter((id) =>
                  validSourceIds.has(id),
                );

              return {
                topicId,
                type,
                prompt,
                choices,
                correctAnswer,
                explanation:
                  typeof item.explanation ===
                  "string"
                    ? item.explanation.trim()
                    : "",
                difficulty,
                sourceFileIds,
              };
            })
            .filter(
              (
                question,
              ): question is GeneratedQuestion =>
                Boolean(question),
            )
            .slice(0, questionCount)
        : [];

    if (questions.length < 3) {
      throw new Error(
        "The quiz generator could not create enough reliable questions from the selected materials. Try choosing more topics or analyzing more course material.",
      );
    }

    const title =
      typeof value.title === "string" &&
      value.title.trim()
        ? value.title.trim()
        : `${course.code} Practice`;

    const {
      data: session,
      error: sessionError,
    } = await supabase
      .from("study_sessions")
      .insert({
        user_id: user.id,
        course_id: courseId,
        mode: "quiz",
        strategy,
        selected_topic_ids:
          topicIds,
        question_types:
          allowedTypes,
        requested_question_count:
          questionCount,
        status: "ready",
      })
      .select("id")
      .single();

    if (sessionError) throw sessionError;

    const sourceById = new Map(
      sourceContext.sourceRefs.map(
        (source) => [
          source.fileId,
          source,
        ],
      ),
    );

    const {
      error: questionsError,
    } = await supabase
      .from("study_questions")
      .insert(
        questions.map(
          (question, index) => ({
            session_id: session.id,
            user_id: user.id,
            course_id: courseId,
            topic_id:
              question.topicId,
            question_type:
              question.type,
            prompt: question.prompt,
            choices:
              question.choices,
            correct_answer:
              question.correctAnswer,
            explanation:
              question.explanation,
            difficulty:
              question.difficulty,
            source_refs:
              question.sourceFileIds
                .map((fileId) => {
                  const source =
                    sourceById.get(
                      fileId,
                    );

                  return source
                    ? {
                        fileId:
                          source.fileId,
                        fileName:
                          source.fileName,
                        materialType:
                          source.materialType,
                      }
                    : null;
                })
                .filter(Boolean),
            position: index,
          }),
        ),
      );

    if (questionsError) {
      await supabase
        .from("study_sessions")
        .delete()
        .eq("id", session.id);

      throw questionsError;
    }

    return NextResponse.json({
      ok: true,
      sessionId: session.id,
      title,
      questionCount:
        questions.length,
    });
  } catch (error) {
    if (isRateLimitError(error)) {
      const retryAfter =
        retryAfterSeconds(error);

      return NextResponse.json(
        {
          ok: false,
          retryable: true,
          code: "GROQ_RATE_LIMITED",
          retryAfterSeconds:
            retryAfter,
          error: `Study generation is busy right now. Retry in about ${retryAfter} seconds.`,
        },
        {
          status: 429,
          headers: {
            "Retry-After":
              String(retryAfter),
          },
        },
      );
    }

    console.error(
      "Quiz generation failed:",
      error,
    );

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not generate the quiz.",
      },
      { status: 500 },
    );
  }
}