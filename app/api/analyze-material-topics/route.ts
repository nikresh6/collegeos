import { NextResponse } from "next/server";
import { generateStructured } from "../../../lib/ai/groq";
import {
  extractMaterialText,
  sampleMaterialText,
} from "../../../lib/material-text";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CandidateTopic = {
  id: string;
  name: string;
  parentTopicId?: string | null;
};

type TopicAttribution = {
  suggestedFileName: string;
  matchedTopicIds: string[];
  newTopics: Array<{
    name: string;
    parentTopicId: string;
    reason: string;
  }>;
  confidence: number;
  rationale: string;
};

const topicAttributionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    suggestedFileName: { type: "string" },
    matchedTopicIds: {
      type: "array",
      items: { type: "string" },
    },
    newTopics: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          parentTopicId: { type: "string" },
          reason: { type: "string" },
        },
        required: ["name", "parentTopicId", "reason"],
      },
    },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 100,
    },
    rationale: { type: "string" },
  },
  required: [
    "suggestedFileName",
    "matchedTopicIds",
    "newTopics",
    "confidence",
    "rationale",
  ],
};

const systemPrompt = `You classify a college course material into syllabus topics.

The student has already chosen the unit/exam that this material belongs to.

STRICT RULES:
1. Prefer existing syllabus topics whenever there is any reasonable semantic fit.
2. A narrower concept, example, person, theorem, event, case, or sub-concept does NOT automatically justify a new topic.
3. Create a new topic ONLY when the material substantially focuses on a concept that is genuinely not represented by any existing candidate topic.
4. New topics should be rare.
5. If the material clearly relates to multiple existing topics, select all of them.
6. Usually choose between 1 and 5 existing topics.
7. Never choose a topic just because a single word overlaps. Use the actual academic content.
8. If you create a new topic that is best understood as a subtopic of an existing topic, set parentTopicId to that existing topic id.
9. If a truly new topic has no appropriate parent, set parentTopicId to an empty string.
10. matchedTopicIds must contain only ids from the supplied candidate list.
11. Do not create a new topic with the same meaning as an existing topic.
12. Keep new topic names short and course-appropriate.
13. Keep rationale and reasons concise.
14. Return only the structured result.`;

function parseTopics(value: FormDataEntryValue | null): CandidateTopic[] {
  if (typeof value !== "string") return [];

  try {
    const parsed = JSON.parse(value) as unknown;

    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((item) => {
        if (
          typeof item !== "object" ||
          item === null ||
          typeof (item as Record<string, unknown>).id !== "string" ||
          typeof (item as Record<string, unknown>).name !== "string"
        ) {
          return null;
        }

        const record = item as Record<string, unknown>;

        return {
          id: String(record.id),
          name: String(record.name),
          parentTopicId:
            typeof record.parentTopicId === "string"
              ? record.parentTopicId
              : null,
        };
      })
      .filter((item): item is CandidateTopic => Boolean(item));
  } catch {
    return [];
  }
}

function cleanSuggestedFileName(
  suggested: string,
  originalName: string,
) {
  const originalExtension =
    originalName.match(/(\.[a-zA-Z0-9]+)$/)?.[1] ?? "";

  const suggestedWithoutExtension = suggested
    .trim()
    .replace(/\.[a-zA-Z0-9]+$/i, "")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);

  const fallbackBase = originalName
    .replace(/\.[a-zA-Z0-9]+$/i, "")
    .trim();

  return `${suggestedWithoutExtension || fallbackBase || "Course Material"}${originalExtension.toLowerCase()}`;
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const candidate = formData.get("file");
    const unitName =
      typeof formData.get("unitName") === "string"
        ? String(formData.get("unitName"))
        : "";
    const topics = parseTopics(formData.get("topics"));

    if (!(candidate instanceof File)) {
      return NextResponse.json(
        {
          ok: false,
          error: "A material file is required.",
        },
        { status: 400 },
      );
    }

    if (!unitName.trim()) {
      return NextResponse.json(
        {
          ok: false,
          error: "Choose a unit before asking AI to assign topics.",
        },
        { status: 400 },
      );
    }

    if (candidate.size > 30 * 1024 * 1024) {
      return NextResponse.json(
        {
          ok: false,
          error: "Keep materials under 30 MB for topic analysis.",
        },
        { status: 413 },
      );
    }

    const extracted = await extractMaterialText(candidate);

    if (extracted.text.replace(/\s/g, "").length < 80) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "This file contains too little extractable text for topic analysis.",
        },
        { status: 422 },
      );
    }

    const sampledText = sampleMaterialText(extracted.text, 16000);

    const candidateList = topics
      .map(
        (topic) =>
          `- ${topic.id}: ${topic.name}${
            topic.parentTopicId
              ? ` (subtopic of ${topic.parentTopicId})`
              : ""
          }`,
      )
      .join("\n");

    const result = await generateStructured<TopicAttribution>({
      system: systemPrompt,
      user: `UNIT:
${unitName}

FILE:
${candidate.name}

EXISTING CANDIDATE TOPICS:
${candidateList || "(No existing topics are available.)"}

MATERIAL TEXT:
${sampledText}`,
      schemaName: "material_topic_attribution",
      schema: topicAttributionSchema,
      temperature: 0.05,
      maxTokens: 700,
    });

    const allowedIds = new Set(topics.map((topic) => topic.id));

    const matchedTopicIds = result.matchedTopicIds.filter((id) =>
      allowedIds.has(id),
    );

    const newTopics = result.newTopics
      .map((topic) => ({
        name: topic.name.trim(),
        parentTopicId:
          topic.parentTopicId && allowedIds.has(topic.parentTopicId)
            ? topic.parentTopicId
            : "",
        reason: topic.reason.trim(),
      }))
      .filter((topic) => topic.name)
      .slice(0, 3);

    return NextResponse.json({
      ok: true,
      provider: "groq",
      result: {
        suggestedFileName: cleanSuggestedFileName(
          result.suggestedFileName,
          candidate.name,
        ),
        matchedTopicIds,
        newTopics,
        confidence: Math.min(
          100,
          Math.max(0, Number(result.confidence || 0)),
        ),
        rationale: result.rationale.trim(),
      },
      extraction: {
        kind: extracted.kind,
        pageCount: extracted.pageCount,
        extractedCharacters: extracted.text.length,
        sampledCharacters: sampledText.length,
      },
    });
  } catch (error) {
    console.error("Material topic analysis failed:", error);

    const message =
      error instanceof Error
        ? error.message
        : "AI could not classify this material.";

    const lower = message.toLowerCase();

    if (
      lower.includes("rate limit") ||
      lower.includes("rate_limit") ||
      lower.includes("429")
    ) {
      return NextResponse.json(
        {
          ok: false,
          code: "GROQ_RATE_LIMITED",
          retryable: true,
          error:
            "Groq's current throughput limit was reached. Wait for the token window to reset and try again.",
        },
        { status: 429 },
      );
    }

    return NextResponse.json(
      {
        ok: false,
        code: "MATERIAL_TOPIC_ANALYSIS_FAILED",
        retryable: true,
        error: message,
      },
      { status: 500 },
    );
  }
}