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

function clampDepth(value: unknown) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return 60;
  }

  return Math.max(
    0,
    Math.min(100, Math.round(numeric)),
  );
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

function depthLabel(depth: number) {
  if (depth <= 20) return "Quick";
  if (depth <= 40) return "Focused";
  if (depth <= 60) return "Balanced";
  if (depth <= 80) return "Detailed";
  return "Deep";
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
      depthPercent?: number;
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

    const depth =
      clampDepth(body.depthPercent);

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
            "Choose at least one topic for the guide.",
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
        maxCharacters:
          depth >= 80
            ? 22000
            : depth >= 50
              ? 18000
              : 14000,
      }),
    ]);

    if (courseError) throw courseError;

    if (!sourceContext.contextText.trim()) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "There is not enough analyzed material connected to those topics yet. Analyze the relevant lecture, notes, slides, or other materials first.",
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

    const maxTokens =
      depth <= 20
        ? 1200
        : depth <= 40
          ? 1600
          : depth <= 60
            ? 2100
            : depth <= 80
              ? 2500
              : 2900;

    const completion =
      await groq.chat.completions.create({
        model:
          GROQ_MODELS.lectureChunk,
        messages: [
          {
            role: "system",
            content: `You create a polished college study guide using ONLY the supplied analyzed course materials.

The requested depth is ${depth}/100 (${depthLabel(
              depth,
            )}).

SOURCE-GROUNDING RULES:
1. Never add outside facts, examples, dates, formulas, interpretations, or definitions.
2. Preserve the terminology and framing of the supplied materials.
3. Cover only selected topics that have actual source support.
4. Keep each section useful for studying, not just summarization.
5. Point out distinctions, repeated ideas, important terminology, and common-confusion signals only when supported.
6. sourceFileIds may only use SOURCE IDs present in the supplied context.
7. topicId must be one of the selected topic IDs.
8. Lower depth should be concise but still cover every supported selected topic.
9. Higher depth should add explanation, structure, connections, and recall practice without adding outside knowledge.

OUTPUT:
Return ONLY one valid JSON object:
{
  "title": string,
  "overview": string,
  "sections": [
    {
      "topicId": string,
      "heading": string,
      "summary": string,
      "keyPoints": string[],
      "mustRemember": string[],
      "connections": string[],
      "commonConfusions": string[],
      "sourceFileIds": string[]
    }
  ],
  "quickRecall": [
    {
      "topicId": string,
      "question": string,
      "answer": string
    }
  ],
  "studyPlan": string[]
}

Do not omit any top-level key. Use [] when a category has no source-grounded content.`,
          },
          {
            role: "user",
            content: `COURSE:
${course.code} ${course.name}

SELECTED TOPICS:
${topicList}

ANALYZED COURSE MATERIAL:
${sourceContext.contextText}`,
          },
        ],
        response_format: {
          type: "json_object",
        },
        reasoning_effort: "low",
        include_reasoning: false,
        temperature: 0.08,
        max_completion_tokens:
          maxTokens,
      });

    const content =
      completion.choices[0]?.message?.content;

    if (!content) {
      throw new Error(
        "Groq returned an empty study guide.",
      );
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error(
        "Groq returned invalid JSON while creating the study guide.",
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

    const sections =
      Array.isArray(value.sections)
        ? value.sections
            .map((section) => {
              if (
                !section ||
                typeof section !== "object" ||
                Array.isArray(section)
              ) {
                return null;
              }

              const item =
                section as Record<
                  string,
                  unknown
                >;

              const topicId =
                typeof item.topicId === "string" &&
                validTopicIds.has(
                  item.topicId,
                )
                  ? item.topicId
                  : "";

              const heading =
                typeof item.heading === "string"
                  ? item.heading.trim()
                  : "";

              const summary =
                typeof item.summary === "string"
                  ? item.summary.trim()
                  : "";

              if (
                !topicId ||
                (!heading && !summary)
              ) {
                return null;
              }

              return {
                topicId,
                heading:
                  heading || "Topic review",
                summary,
                keyPoints:
                  safeStringArray(
                    item.keyPoints,
                    depth >= 80 ? 9 : 7,
                  ),
                mustRemember:
                  safeStringArray(
                    item.mustRemember,
                    depth >= 80 ? 7 : 5,
                  ),
                connections:
                  safeStringArray(
                    item.connections,
                    depth >= 70 ? 6 : 4,
                  ),
                commonConfusions:
                  safeStringArray(
                    item.commonConfusions,
                    depth >= 60 ? 5 : 3,
                  ),
                sourceFileIds:
                  safeStringArray(
                    item.sourceFileIds,
                    8,
                  ).filter((id) =>
                    validSourceIds.has(id),
                  ),
              };
            })
            .filter(Boolean)
        : [];

    const quickRecall =
      Array.isArray(value.quickRecall)
        ? value.quickRecall
            .map((item) => {
              if (
                !item ||
                typeof item !== "object" ||
                Array.isArray(item)
              ) {
                return null;
              }

              const record =
                item as Record<
                  string,
                  unknown
                >;

              const topicId =
                typeof record.topicId ===
                  "string" &&
                validTopicIds.has(
                  record.topicId,
                )
                  ? record.topicId
                  : "";

              const question =
                typeof record.question ===
                "string"
                  ? record.question.trim()
                  : "";

              const answer =
                typeof record.answer ===
                "string"
                  ? record.answer.trim()
                  : "";

              if (
                !topicId ||
                !question ||
                !answer
              ) {
                return null;
              }

              return {
                topicId,
                question,
                answer,
              };
            })
            .filter(Boolean)
            .slice(
              0,
              depth >= 80 ? 12 : 8,
            )
        : [];

    const guide = {
      title:
        typeof value.title === "string" &&
        value.title.trim()
          ? value.title.trim()
          : `${course.code} Study Guide`,
      overview:
        typeof value.overview === "string"
          ? value.overview.trim()
          : "",
      sections,
      quickRecall,
      studyPlan:
        safeStringArray(
          value.studyPlan,
          depth >= 80 ? 8 : 6,
        ),
    };

    if (guide.sections.length === 0) {
      throw new Error(
        "The guide generator could not produce reliable sections from the selected materials.",
      );
    }

    const {
      data: saved,
      error: saveError,
    } = await supabase
      .from("study_guides")
      .insert({
        user_id: user.id,
        course_id: courseId,
        strategy,
        selected_topic_ids:
          topicIds,
        depth_percent: depth,
        title: guide.title,
        content: guide,
        source_refs:
          sourceContext.sourceRefs,
      })
      .select("id")
      .single();

    if (saveError) throw saveError;

    return NextResponse.json({
      ok: true,
      guideId: saved.id,
      title: guide.title,
    });
  } catch (error) {
    const candidate = error as {
      status?: number;
      message?: string;
      headers?: Headers;
    };

    if (
      candidate.status === 429 ||
      candidate.message
        ?.toLowerCase()
        .includes("rate limit")
    ) {
      const raw =
        candidate.headers?.get(
          "retry-after",
        );
      const retryAfter =
        Number.isFinite(Number(raw)) &&
        Number(raw) > 0
          ? Math.ceil(Number(raw))
          : 15;

      return NextResponse.json(
        {
          ok: false,
          retryable: true,
          retryAfterSeconds:
            retryAfter,
          error: `Study guide generation is busy right now. Retry in about ${retryAfter} seconds.`,
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
      "Study guide generation failed:",
      error,
    );

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not generate the study guide.",
      },
      { status: 500 },
    );
  }
}