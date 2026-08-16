import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  groq,
} from "../../../../lib/ai/groq";
import { noteContentToPlainText } from "../../../../lib/note-content";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TopicRow = {
  id: string;
  name: string;
  description: string | null;
  unit_id: string | null;
  parent_topic_id: string | null;
  source_file_id: string | null;
  position: number;
};

type SegmentRow = {
  position: number;
  start_seconds: number;
  end_seconds: number;
  text: string;
};

type ChunkDefinition = {
  index: number;
  startSeconds: number;
  endSeconds: number;
  text: string;
};

type ChunkMemory = {
  overview: string;
  keyPoints: string[];
  sections: Array<{
    heading: string;
    startSeconds: number;
    endSeconds: number;
    summary: string;
    keyPoints: string[];
  }>;
  terms: Array<{
    term: string;
    definition: string;
  }>;
  studySignals: Array<{
    label: string;
    explanation: string;
    startSeconds: number;
  }>;
};

type ChunkRow = {
  id: string;
  chunk_index: number;
  start_seconds: number;
  end_seconds: number;
  source_characters: number;
  status: "pending" | "ready" | "error";
  memory: ChunkMemory | null;
  attempts: number;
  last_error: string | null;
};

type TopicAttribution = {
  matchedTopicIds: string[];
  newSubtopics: Array<{
    name: string;
    parentTopicId: string;
    reason: string;
  }>;
  confidence: number;
  rationale: string;
};

type StoredTopicAssignment = {
  matchedTopicIds: string[];
  createdSubtopicIds: string[];
  finalTopicIds: string[];
  inferredUnitId: string | null;
  confidence: number;
  rationale: string;
};

type LectureAnalysis = {
  title: string;
  overview: string;
  whatToKnow: string[];
  sections: Array<{
    heading: string;
    startSeconds: number;
    endSeconds: number;
    explanation: string;
    keyPoints: string[];
    relatedTopicIds: string[];
  }>;
  quickChecks: Array<{
    question: string;
    choices: string[];
    correctIndex: number;
    explanation: string;
    relatedTopicIds: string[];
  }>;
  studyTips: string[];
  topicNotes: Array<{
    topicId: string;
    summary: string;
    keyPoints: string[];
  }>;
  terms: Array<{
    term: string;
    definition: string;
  }>;
  studySignals: Array<{
    label: string;
    explanation: string;
    startSeconds: number;
  }>;
  confidence: number;
};

type DepthProfile = {
  depthPercent: number;
  detailLevel: "skim" | "standard" | "deep";
  label: string;
  maxTokens: number;
  takeawaysMax: number;
  sectionsMax: number;
  quickChecksMax: number;
  tipsMax: number;
};

type ProcessingState = {
  topicAssignment?: StoredTopicAssignment;
  organizationModel?: string | null;
  organizationFallback?: boolean;
  cancelRequested?: boolean;
  cancelledAt?: string;
};

/*
 * Free-tier Groq pools are much more reliable when each independent
 * extraction request stays compact. ~4,200 transcript characters is usually
 * around 1,000 to 1,300 input tokens before prompt overhead, leaving useful
 * headroom inside the per-model TPM window.
 */
const TARGET_CHUNK_CHARACTERS = 4200;
const LEGACY_LARGE_CHUNK_CHARACTERS = 6200;

const PRIMARY_CHUNK_MODEL_POOL = [
  "openai/gpt-oss-20b",
  "qwen/qwen3.6-27b",
] as const;

/*
 * For longer lectures, borrow GPT-OSS 120B as a third independent Groq
 * rate-limit lane during the early chunk pass. Once only a few chunks remain,
 * stop using 120B so its TPM window can recover before final synthesis.
 */
const BURST_CHUNK_MODEL_POOL = [
  "openai/gpt-oss-20b",
  "qwen/qwen3.6-27b",
  "openai/gpt-oss-120b",
] as const;

/*
 * The 68% organizer and the final synthesis used to depend on one model.
 * That meant a single exhausted model pool could hold a completely-condensed
 * lecture forever. These stages now fail over independently.
 */
const ORGANIZATION_MODEL_POOL = [
  "qwen/qwen3.6-27b",
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
] as const;

const FINAL_SYNTHESIS_MODEL_POOL = [
  "openai/gpt-oss-120b",
  "qwen/qwen3.6-27b",
  "openai/gpt-oss-20b",
] as const;

const BURST_POOL_MIN_PENDING_CHUNKS = 6;

const chunkMemorySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    overview: { type: "string" },
    keyPoints: {
      type: "array",
      maxItems: 8,
      items: { type: "string" },
    },
    sections: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          heading: { type: "string" },
          startSeconds: { type: "number" },
          endSeconds: { type: "number" },
          summary: { type: "string" },
          keyPoints: {
            type: "array",
            maxItems: 5,
            items: { type: "string" },
          },
        },
        required: [
          "heading",
          "startSeconds",
          "endSeconds",
          "summary",
          "keyPoints",
        ],
      },
    },
    terms: {
      type: "array",
      maxItems: 7,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          term: { type: "string" },
          definition: { type: "string" },
        },
        required: ["term", "definition"],
      },
    },
    studySignals: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          label: { type: "string" },
          explanation: { type: "string" },
          startSeconds: { type: "number" },
        },
        required: [
          "label",
          "explanation",
          "startSeconds",
        ],
      },
    },
  },
  required: [
    "overview",
    "keyPoints",
    "sections",
    "terms",
    "studySignals",
  ],
};

const topicAttributionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    matchedTopicIds: {
      type: "array",
      maxItems: 6,
      items: { type: "string" },
    },
    newSubtopics: {
      type: "array",
      maxItems: 2,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          parentTopicId: { type: "string" },
          reason: { type: "string" },
        },
        required: [
          "name",
          "parentTopicId",
          "reason",
        ],
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
    "matchedTopicIds",
    "newSubtopics",
    "confidence",
    "rationale",
  ],
};

function createUserClient(
  accessToken: string,
) {
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


function createAdminClient() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL;

  const key =
    process.env.SUPABASE_SECRET_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Server-side Supabase secret environment variables are missing.",
    );
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function isTrustedWorker(
  request: Request,
) {
  const expected =
    process.env.LECTURE_WORKER_SECRET;

  const supplied =
    request.headers.get(
      "x-lecture-worker-secret",
    );

  return Boolean(
    expected &&
      supplied &&
      supplied === expected,
  );
}

function bearerToken(
  request: Request,
) {
  const authorization =
    request.headers.get(
      "authorization",
    ) ?? "";

  return authorization.startsWith(
    "Bearer ",
  )
    ? authorization.slice(
        "Bearer ".length,
      )
    : "";
}

function clampDepth(
  value: unknown,
) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return 60;
  }

  return Math.max(
    0,
    Math.min(
      100,
      Math.round(number),
    ),
  );
}

function depthProfile(
  value: unknown,
): DepthProfile {
  const depth =
    clampDepth(value);

  if (depth <= 20) {
    return {
      depthPercent: depth,
      detailLevel: "skim",
      label: "Quick",
      maxTokens: 1200,
      takeawaysMax: 4,
      sectionsMax: 3,
      quickChecksMax: 3,
      tipsMax: 2,
    };
  }

  if (depth <= 40) {
    return {
      depthPercent: depth,
      detailLevel: "skim",
      label: "Focused",
      maxTokens: 1600,
      takeawaysMax: 5,
      sectionsMax: 4,
      quickChecksMax: 4,
      tipsMax: 3,
    };
  }

  if (depth <= 60) {
    return {
      depthPercent: depth,
      detailLevel: "standard",
      label: "Balanced",
      maxTokens: 1800,
      takeawaysMax: 6,
      sectionsMax: 5,
      quickChecksMax: 5,
      tipsMax: 4,
    };
  }

  if (depth <= 80) {
    return {
      depthPercent: depth,
      detailLevel: "deep",
      label: "Detailed",
      maxTokens: 2300,
      takeawaysMax: 8,
      sectionsMax: 7,
      quickChecksMax: 7,
      tipsMax: 5,
    };
  }

  return {
    depthPercent: depth,
    detailLevel: "deep",
    label: "Deep",
    maxTokens: 2600,
    takeawaysMax: 10,
    sectionsMax: 8,
    quickChecksMax: 8,
    tipsMax: 6,
  };
}

function formatTimestamp(
  seconds: number,
) {
  const safe = Math.max(
    0,
    Math.round(seconds),
  );
  const minutes =
    Math.floor(safe / 60);
  const remainder =
    safe % 60;

  return `${String(
    minutes,
  ).padStart(2, "0")}:${String(
    remainder,
  ).padStart(2, "0")}`;
}

function segmentLine(
  segment: SegmentRow,
) {
  return `[${formatTimestamp(
    segment.start_seconds,
  )}-${formatTimestamp(
    segment.end_seconds,
  )}] ${segment.text}`;
}

function buildChunks(
  segments: SegmentRow[],
  transcriptText: string,
): ChunkDefinition[] {
  if (segments.length === 0) {
    const chunks: ChunkDefinition[] =
      [];

    for (
      let start = 0, index = 0;
      start <
      transcriptText.length;
      start +=
        TARGET_CHUNK_CHARACTERS,
        index += 1
    ) {
      chunks.push({
        index,
        startSeconds: 0,
        endSeconds: 0,
        text: transcriptText.slice(
          start,
          start +
            TARGET_CHUNK_CHARACTERS,
        ),
      });
    }

    return chunks;
  }

  const chunks: ChunkDefinition[] =
    [];

  let current:
    | SegmentRow[] = [];
  let currentCharacters = 0;

  function flush() {
    if (
      current.length === 0
    ) {
      return;
    }

    chunks.push({
      index: chunks.length,
      startSeconds:
        current[0].start_seconds,
      endSeconds:
        current[
          current.length - 1
        ].end_seconds,
      text: current
        .map(segmentLine)
        .join("\n"),
    });

    current = [];
    currentCharacters = 0;
  }

  for (
    const segment of segments
  ) {
    const line =
      segmentLine(segment);

    const nextCharacters =
      currentCharacters +
      line.length +
      1;

    if (
      current.length > 0 &&
      nextCharacters >
        TARGET_CHUNK_CHARACTERS
    ) {
      flush();
    }

    current.push(segment);
    currentCharacters +=
      line.length + 1;
  }

  flush();

  return chunks;
}

function normalizeName(
  value: string,
) {
  return value
    .toLowerCase()
    .replace(
      /[^\p{L}\p{N}]+/gu,
      " ",
    )
    .trim();
}

function inferUnitId(
  topics: TopicRow[],
  topicIds: string[],
) {
  const counts =
    new Map<string, number>();

  for (
    const topic of topics
  ) {
    if (
      !topicIds.includes(
        topic.id,
      ) ||
      !topic.unit_id
    ) {
      continue;
    }

    counts.set(
      topic.unit_id,
      (counts.get(
        topic.unit_id,
      ) ?? 0) + 1,
    );
  }

  const ranked =
    Array.from(
      counts.entries(),
    ).sort(
      (a, b) =>
        b[1] - a[1],
    );

  if (
    ranked.length === 0
  ) {
    return null;
  }

  if (
    ranked.length > 1 &&
    ranked[0][1] ===
      ranked[1][1]
  ) {
    return null;
  }

  return ranked[0][0];
}

function clampTimestamp(
  value: unknown,
  minimum: number,
  maximum: number,
) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return minimum;
  }

  if (
    maximum <= minimum
  ) {
    return Math.max(
      0,
      number,
    );
  }

  return Math.max(
    minimum,
    Math.min(
      maximum,
      number,
    ),
  );
}

function cleanStringArray(
  value: unknown,
  maxItems: number,
) {
  return Array.isArray(value)
    ? value
        .filter(
          (
            item,
          ): item is string =>
            typeof item ===
            "string",
        )
        .map((item) =>
          item.trim(),
        )
        .filter(Boolean)
        .slice(0, maxItems)
    : [];
}

/*
 * This function was missing from the previous route.
 * It is deliberately self-contained so every chunk pass
 * uses the same Groq structured-output helper as the rest
 * of the lecture analysis pipeline.
 */
function compactField(
  value: string,
) {
  return value
    .replace(/\t/g, " ")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseTaggedChunkMemory({
  text,
  startSeconds,
  endSeconds,
}: {
  text: string;
  startSeconds: number;
  endSeconds: number;
}): ChunkMemory {
  const overviewParts: string[] = [];
  const keyPoints: string[] = [];
  const sections: ChunkMemory["sections"] = [];
  const terms: ChunkMemory["terms"] = [];
  const studySignals: ChunkMemory["studySignals"] = [];

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const parts = line.split("\t");
    const tag = parts[0]?.trim().toUpperCase();

    if (tag === "OVERVIEW") {
      const value = compactField(parts.slice(1).join(" "));
      if (value) overviewParts.push(value);
      continue;
    }

    if (tag === "KEY") {
      const value = compactField(parts.slice(1).join(" "));
      if (value && keyPoints.length < 6) keyPoints.push(value);
      continue;
    }

    if (tag === "SECTION") {
      const rawStart = Number(parts[1]);
      const rawEnd = Number(parts[2]);
      const heading = compactField(parts[3] ?? "");
      const summary = compactField(parts[4] ?? "");
      const pointText = compactField(parts.slice(5).join(" "));
      const sectionPoints = pointText
        ? pointText
            .split(" || ")
            .map(compactField)
            .filter(Boolean)
            .slice(0, 3)
        : [];

      if (!heading && !summary) continue;

      const safeStart = clampTimestamp(
        rawStart,
        startSeconds,
        endSeconds,
      );
      const safeEnd = Math.max(
        safeStart,
        clampTimestamp(
          rawEnd,
          startSeconds,
          endSeconds,
        ),
      );

      if (sections.length < 4) {
        sections.push({
          heading: heading || "Lecture section",
          startSeconds: safeStart,
          endSeconds: safeEnd,
          summary,
          keyPoints: sectionPoints,
        });
      }
      continue;
    }

    if (tag === "TERM") {
      const term = compactField(parts[1] ?? "");
      const definition = compactField(parts.slice(2).join(" "));
      if (term && definition && terms.length < 5) {
        terms.push({ term, definition });
      }
      continue;
    }

    if (tag === "SIGNAL") {
      const rawStart = Number(parts[1]);
      const label = compactField(parts[2] ?? "");
      const explanation = compactField(parts.slice(3).join(" "));

      if (
        label &&
        explanation &&
        studySignals.length < 3
      ) {
        studySignals.push({
          label,
          explanation,
          startSeconds: clampTimestamp(
            rawStart,
            startSeconds,
            endSeconds,
          ),
        });
      }
    }
  }

  /*
   * Plain-text fallback. Even if a model ignores the tagged format, do not
   * fail the lecture. Preserve its response as compact memory and continue.
   */
  if (
    overviewParts.length === 0 &&
    keyPoints.length === 0 &&
    sections.length === 0
  ) {
    const fallback = compactField(text).slice(0, 1800);

    return {
      overview: fallback,
      keyPoints: [],
      sections: [],
      terms: [],
      studySignals: [],
    };
  }

  return {
    overview: overviewParts.join(" ").slice(0, 1200),
    keyPoints,
    sections,
    terms,
    studySignals,
  };
}

async function generateChunkMemory({
  system,
  user,
  startSeconds,
  endSeconds,
  model,
}: {
  system: string;
  user: string;
  startSeconds: number;
  endSeconds: number;
  model: string;
}): Promise<ChunkMemory> {
  /*
   * Deliberately use normal text output here, not JSON Object Mode or JSON
   * Schema Mode. These intermediate chunk passes only need compact memory,
   * and tagged text removes json_validate_failed as a failure mode.
   */
  const reasoningOptions =
    model.startsWith("qwen/")
      ? {
          reasoning_format:
            "hidden" as const,
          reasoning_effort:
            "none" as const,
        }
      : {
          reasoning_format:
            "hidden" as const,
          reasoning_effort:
            "low" as const,
        };

  const completion =
    await groq.chat.completions.create({
      model,
      messages: [
        {
          role: "user",
          content: `${system}

OUTPUT FORMAT:
Return ONLY lines in this tagged format. Use literal TAB characters between fields.

OVERVIEW<TAB>one or two compact sentences
KEY<TAB>important factual point
KEY<TAB>another important factual point
SECTION<TAB>startSeconds<TAB>endSeconds<TAB>short heading<TAB>compact summary<TAB>point 1 || point 2
TERM<TAB>term<TAB>definition
SIGNAL<TAB>startSeconds<TAB>short label<TAB>what the professor explicitly emphasized

Rules for output:
- OVERVIEW: exactly 1 line.
- KEY: 0 to 6 lines.
- SECTION: 0 to 4 lines.
- TERM: 0 to 5 lines.
- SIGNAL: 0 to 3 lines.
- Do not output JSON.
- Do not output markdown.
- Do not output a code fence.
- Do not include TAB characters inside a field.
- Omit TERM or SIGNAL lines when none are supported.
- Stay strictly inside the supplied transcript and timestamp range.

${user}`,
        },
      ],
      ...reasoningOptions,
      temperature:
        model.startsWith("qwen/")
          ? 0.6
          : 0.1,
      max_completion_tokens: 300,
    });

  const content =
    completion.choices[0]
      ?.message?.content;

  if (!content) {
    throw new Error(
      "Groq returned an empty lecture chunk response.",
    );
  }

  return parseTaggedChunkMemory({
    text: content,
    startSeconds,
    endSeconds,
  });
}

async function generateTopicAttribution({
  system,
  user,
  model,
}: {
  system: string;
  user: string;
  model: string;
}): Promise<TopicAttribution> {
  const reasoningOptions =
    model.startsWith("qwen/")
      ? {
          reasoning_format:
            "hidden" as const,
          reasoning_effort:
            "none" as const,
        }
      : {
          reasoning_format:
            "hidden" as const,
          reasoning_effort:
            "low" as const,
        };

  const completion =
    await groq.chat.completions.create({
      model,
      messages: [
        {
          role: "user",
          content: `${system}

OUTPUT FORMAT:
Return ONLY lines in this tagged format, with literal TAB characters between fields.

MATCH<TAB>existing-topic-id
NEW<TAB>existing-parent-topic-id<TAB>new subtopic name<TAB>short reason
CONFIDENCE<TAB>0-100
RATIONALE<TAB>one short sentence

Rules:
- MATCH: 0 to 6 lines.
- NEW: 0 to 2 lines.
- Do not output JSON.
- Do not output markdown.
- Every MATCH id must come from the supplied candidate list.
- Every NEW parent id must come from the supplied candidate list.

${user}`,
        },
      ],
      ...reasoningOptions,
      temperature:
        model.startsWith("qwen/")
          ? 0.55
          : 0.1,
      max_completion_tokens: 350,
    });

  const content =
    completion.choices[0]
      ?.message?.content;

  if (!content) {
    throw new Error(
      "Groq returned an empty topic-assignment response.",
    );
  }

  const matchedTopicIds: string[] = [];
  const newSubtopics: TopicAttribution["newSubtopics"] = [];
  let confidence = 0;
  let rationale = "";

  for (
    const line of content
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean)
  ) {
    const parts = line.split("\t");
    const tag = parts[0]?.trim().toUpperCase();

    if (tag === "MATCH") {
      const id = compactField(parts[1] ?? "");
      if (id && matchedTopicIds.length < 6) {
        matchedTopicIds.push(id);
      }
      continue;
    }

    if (tag === "NEW") {
      const parentTopicId =
        compactField(parts[1] ?? "");
      const name =
        compactField(parts[2] ?? "");
      const reason =
        compactField(parts.slice(3).join(" "));

      if (
        parentTopicId &&
        name &&
        newSubtopics.length < 2
      ) {
        newSubtopics.push({
          name,
          parentTopicId,
          reason,
        });
      }
      continue;
    }

    if (tag === "CONFIDENCE") {
      const value = Number(parts[1]);
      if (Number.isFinite(value)) {
        confidence = Math.max(
          0,
          Math.min(100, value),
        );
      }
      continue;
    }

    if (tag === "RATIONALE") {
      rationale =
        compactField(parts.slice(1).join(" "));
    }
  }

  return {
    matchedTopicIds:
      Array.from(
        new Set(matchedTopicIds),
      ).slice(0, 6),
    newSubtopics,
    confidence,
    rationale,
  };
}

function isRateLimitError(
  error: unknown,
) {
  const candidate =
    error as {
      status?: number;
      message?: string;
    };

  const message =
    candidate?.message?.toLowerCase() ??
    "";

  return (
    candidate?.status === 429 ||
    message.includes("429") ||
    message.includes(
      "rate limit",
    ) ||
    message.includes(
      "rate_limit",
    )
  );
}

function isTransientGroqError(
  error: unknown,
) {
  const candidate =
    error as {
      status?: number;
      message?: string;
      code?: string;
    };

  const status =
    Number(
      candidate?.status,
    );

  const message =
    candidate?.message?.toLowerCase() ??
    "";

  const code =
    candidate?.code?.toLowerCase() ??
    "";

  return (
    status === 422 ||
    status === 424 ||
    status === 429 ||
    status === 498 ||
    status >= 500 ||
    code.includes(
      "json_validate_failed",
    ) ||
    message.includes(
      "json_validate_failed",
    ) ||
    message.includes(
      "failed_generation",
    ) ||
    message.includes(
      "does not match the expected schema",
    ) ||
    message.includes(
      "temporarily unavailable",
    ) ||
    message.includes(
      "service unavailable",
    ) ||
    message.includes(
      "capacity",
    ) ||
    message.includes(
      "timeout",
    )
  );
}

function isFormattingGroqError(
  error: unknown,
) {
  const candidate =
    error as {
      message?: string;
      code?: string;
    };

  const message =
    candidate?.message?.toLowerCase() ??
    "";

  const code =
    candidate?.code?.toLowerCase() ??
    "";

  return (
    code.includes(
      "json_validate_failed",
    ) ||
    message.includes(
      "json_validate_failed",
    ) ||
    message.includes(
      "failed_generation",
    ) ||
    message.includes(
      "does not match the expected schema",
    ) ||
    message.includes(
      "unreadable json",
    ) ||
    message.includes(
      "invalid json",
    )
  );
}

function retryAfterSeconds(
  error: unknown,
) {
  const candidate =
    error as {
      headers?:
        | Headers
        | Record<
            string,
            string | undefined
          >;
    };

  const headers =
    candidate?.headers;

  let raw:
    | string
    | null
    | undefined;

  if (
    headers &&
    typeof (
      headers as Headers
    ).get === "function"
  ) {
    raw = (
      headers as Headers
    ).get(
      "retry-after",
    );
  } else if (headers) {
    raw = (
      headers as Record<
        string,
        string | undefined
      >
    )["retry-after"];
  }

  const parsed =
    Number(raw);

  if (
    Number.isFinite(parsed) &&
    parsed > 0
  ) {
    return Math.min(
      90,
      Math.ceil(parsed),
    );
  }

  return 20;
}


function meaningfulTokens(
  value: string,
) {
  return normalizeName(value)
    .split(/\s+/)
    .filter(
      (token) =>
        token.length >= 4,
    );
}

function heuristicTopicAttribution({
  candidates,
  compactSource,
}: {
  candidates: TopicRow[];
  compactSource: string;
}): TopicAttribution {
  const sourceNormalized =
    normalizeName(
      compactSource,
    );

  const sourceTokens =
    new Set(
      meaningfulTokens(
        compactSource,
      ),
    );

  const ranked =
    candidates
      .map((topic) => {
        const normalizedName =
          normalizeName(
            topic.name,
          );

        const nameTokens =
          meaningfulTokens(
            topic.name,
          );

        const descriptionTokens =
          meaningfulTokens(
            topic.description ??
              "",
          );

        const exactPhrase =
          normalizedName.length >=
            4 &&
          sourceNormalized.includes(
            normalizedName,
          )
            ? 32
            : 0;

        const nameOverlap =
          nameTokens.filter(
            (token) =>
              sourceTokens.has(
                token,
              ),
          ).length * 12;

        const descriptionOverlap =
          descriptionTokens
            .filter(
              (token) =>
                sourceTokens.has(
                  token,
                ),
            )
            .slice(0, 6)
            .length * 2;

        return {
          topic,
          score:
            exactPhrase +
            nameOverlap +
            descriptionOverlap,
        };
      })
      .filter(
        (candidate) =>
          candidate.score >= 12,
      )
      .sort(
        (a, b) =>
          b.score -
          a.score,
      )
      .slice(0, 5);

  return {
    matchedTopicIds:
      ranked.map(
        (candidate) =>
          candidate.topic.id,
      ),
    newSubtopics: [],
    confidence:
      ranked.length > 0
        ? Math.max(
            35,
            Math.min(
              68,
              Math.round(
                ranked[0].score,
              ),
            ),
          )
        : 0,
    rationale:
      ranked.length > 0
        ? "Matched from terminology already present in the saved lecture memory because the live AI organizer was unavailable."
        : "No reliable existing topic match was available while the live AI organizer was unavailable.",
  };
}

async function generateTopicAttributionResilient({
  system,
  user,
  candidates,
  compactSource,
}: {
  system: string;
  user: string;
  candidates: TopicRow[];
  compactSource: string;
}): Promise<{
  attribution: TopicAttribution;
  model: string | null;
  fallback: boolean;
}> {
  let lastTemporaryError:
    unknown = null;

  for (
    const model of
    ORGANIZATION_MODEL_POOL
  ) {
    try {
      const attribution =
        await generateTopicAttribution({
          system,
          user,
          model,
        });

      return {
        attribution,
        model,
        fallback: false,
      };
    } catch (error) {
      if (
        isRateLimitError(
          error,
        ) ||
        isTransientGroqError(
          error,
        ) ||
        isFormattingGroqError(
          error,
        )
      ) {
        lastTemporaryError =
          error;
        continue;
      }

      throw error;
    }
  }

  if (lastTemporaryError) {
    console.warn(
      "All live topic-organization model lanes were unavailable. Falling back to deterministic topic matching.",
      lastTemporaryError,
    );
  }

  return {
    attribution:
      heuristicTopicAttribution({
        candidates,
        compactSource,
      }),
    model: null,
    fallback: true,
  };
}

function uniqueStrings(
  values: string[],
  maxItems: number,
) {
  const seen =
    new Set<string>();

  const result:
    string[] = [];

  for (
    const raw of values
  ) {
    const value =
      raw.trim();

    const key =
      normalizeName(
        value,
      );

    if (
      !value ||
      !key ||
      seen.has(key)
    ) {
      continue;
    }

    seen.add(key);
    result.push(value);

    if (
      result.length >=
      maxItems
    ) {
      break;
    }
  }

  return result;
}

function evenlySample<T>(
  items: T[],
  maximum: number,
) {
  if (
    maximum <= 0 ||
    items.length === 0
  ) {
    return [];
  }

  if (
    items.length <=
    maximum
  ) {
    return items;
  }

  if (
    maximum === 1
  ) {
    return [
      items[
        Math.floor(
          items.length / 2,
        )
      ],
    ];
  }

  const result:
    T[] = [];

  for (
    let index = 0;
    index <
    maximum;
    index += 1
  ) {
    const sourceIndex =
      Math.round(
        (index *
          (items.length - 1)) /
          (maximum - 1),
      );

    result.push(
      items[sourceIndex],
    );
  }

  return result;
}

function buildDeterministicLectureAnalysis({
  chunks,
  profile,
  lectureTitle,
}: {
  chunks: ChunkRow[];
  profile: DepthProfile;
  lectureTitle: string;
}): LectureAnalysis {
  const ready =
    chunks
      .filter(
        (chunk) =>
          chunk.status ===
            "ready" &&
          chunk.memory,
      )
      .sort(
        (a, b) =>
          a.chunk_index -
          b.chunk_index,
      );

  const memories =
    ready.map(
      (chunk) =>
        chunk.memory as ChunkMemory,
    );

  const overview =
    evenlySample(
      memories
        .map(
          (memory) =>
            memory.overview,
        )
        .filter(Boolean),
      4,
    )
      .join(" ")
      .slice(0, 1800);

  const whatToKnow =
    uniqueStrings(
      memories.flatMap(
        (memory) =>
          memory.keyPoints,
      ),
      profile.takeawaysMax,
    );

  const sectionCandidates =
    ready.map(
      (chunk) => {
        const memory =
          chunk.memory as ChunkMemory;

        const firstSection =
          memory.sections[0];

        return {
          heading:
            firstSection
              ?.heading ||
            `Lecture section ${
              chunk.chunk_index +
              1
            }`,
          startSeconds:
            chunk.start_seconds,
          endSeconds:
            chunk.end_seconds,
          explanation:
            memory.overview,
          keyPoints:
            uniqueStrings(
              memory.keyPoints,
              6,
            ),
          relatedTopicIds:
            [] as string[],
        };
      },
    );

  const sections =
    evenlySample(
      sectionCandidates,
      profile.sectionsMax,
    );

  const termsSeen =
    new Set<string>();

  const terms:
    LectureAnalysis["terms"] =
    [];

  for (
    const memory of
    memories
  ) {
    for (
      const term of
      memory.terms
    ) {
      const key =
        normalizeName(
          term.term,
        );

      if (
        !key ||
        termsSeen.has(
          key,
        )
      ) {
        continue;
      }

      termsSeen.add(key);
      terms.push(term);

      if (
        terms.length >= 14
      ) {
        break;
      }
    }

    if (
      terms.length >= 14
    ) {
      break;
    }
  }

  const signalSeen =
    new Set<string>();

  const studySignals:
    LectureAnalysis["studySignals"] =
    [];

  for (
    const memory of
    memories
  ) {
    for (
      const signal of
      memory.studySignals
    ) {
      const key =
        `${normalizeName(
          signal.label,
        )}:${Math.round(
          signal.startSeconds,
        )}`;

      if (
        signalSeen.has(
          key,
        )
      ) {
        continue;
      }

      signalSeen.add(key);
      studySignals.push(
        signal,
      );

      if (
        studySignals.length >=
        8
      ) {
        break;
      }
    }

    if (
      studySignals.length >=
      8
    ) {
      break;
    }
  }

  return {
    title:
      lectureTitle,
    overview:
      overview ||
      "The lecture transcript was processed successfully, but the final polishing model was temporarily unavailable. The saved section summaries below preserve the lecture content.",
    whatToKnow,
    sections,
    quickChecks: [],
    studyTips: [],
    topicNotes: [],
    terms,
    studySignals,
    confidence:
      ready.length > 0
        ? 62
        : 0,
  };
}

function compactMemories(
  chunks: ChunkRow[],
  maxCharacters = 13000,
) {
  const ready =
    chunks
      .filter(
        (chunk) =>
          chunk.status ===
            "ready" &&
          chunk.memory,
      )
      .sort(
        (a, b) =>
          a.chunk_index -
          b.chunk_index,
      );

  if (
    ready.length === 0
  ) {
    return "";
  }

  const perChunkBudget =
    Math.max(
      650,
      Math.floor(
        maxCharacters /
          ready.length,
      ),
    );

  return ready
    .map((chunk) => {
      const memory =
        chunk.memory as ChunkMemory;

      const block = [
        `CHUNK ${
          chunk.chunk_index + 1
        }`,
        `TIME ${formatTimestamp(
          chunk.start_seconds,
        )}-${formatTimestamp(
          chunk.end_seconds,
        )}`,
        `OVERVIEW: ${
          memory.overview
        }`,
        memory.keyPoints.length
          ? `KEY POINTS:\n${memory.keyPoints
              .slice(0, 6)
              .map(
                (point) =>
                  `- ${point}`,
              )
              .join("\n")}`
          : "",
        memory.sections.length
          ? `SECTIONS:\n${memory.sections
              .slice(0, 4)
              .map(
                (section) =>
                  `- [${formatTimestamp(
                    section.startSeconds,
                  )}-${formatTimestamp(
                    section.endSeconds,
                  )}] ${section.heading}: ${section.summary}\n  ${section.keyPoints
                    .slice(0, 4)
                    .map(
                      (point) =>
                        `• ${point}`,
                    )
                    .join(
                      "\n  ",
                    )}`,
              )
              .join("\n")}`
          : "",
        memory.terms.length
          ? `TERMS:\n${memory.terms
              .slice(0, 5)
              .map(
                (term) =>
                  `- ${term.term}: ${term.definition}`,
              )
              .join("\n")}`
          : "",
        memory.studySignals.length
          ? `SIGNALS:\n${memory.studySignals
              .slice(0, 4)
              .map(
                (signal) =>
                  `- [${formatTimestamp(
                    signal.startSeconds,
                  )}] ${signal.label}: ${signal.explanation}`,
              )
              .join("\n")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n");

      return block.slice(
        0,
        perChunkBudget,
      );
    })
    .join("\n\n")
    .slice(
      0,
      maxCharacters,
    );
}

function parseProcessingState(
  value: unknown,
): ProcessingState {
  if (
    !value ||
    typeof value !==
      "object" ||
    Array.isArray(value)
  ) {
    return {};
  }

  return value as ProcessingState;
}

function cancelledResponse() {
  return NextResponse.json({
    ok: true,
    status: "cancelled",
    phase: "cancelled",
    progress: 0,
    message: "Lecture analysis cancelled.",
  });
}

async function analysisWasCancelled(
  supabase: ReturnType<typeof createUserClient>,
  lectureId: string,
) {
  const { data, error } =
    await supabase
      .from("lectures")
      .select("processing_state")
      .eq("id", lectureId)
      .single();

  if (error) {
    throw error;
  }

  return (
    parseProcessingState(
      data.processing_state,
    ).cancelRequested === true
  );
}

async function updateLectureProgress(
  supabase: ReturnType<
    typeof createUserClient
  >,
  lectureId: string,
  stage:
    | "condensing"
    | "organizing"
    | "synthesizing"
    | "ready",
  progress: number,
  state?: ProcessingState,
) {
  if (
    await analysisWasCancelled(
      supabase,
      lectureId,
    )
  ) {
    return;
  }

  const payload:
    Record<string, unknown> = {
    status:
      stage === "ready"
        ? "ready"
        : "analyzing",
    analysis_stage: stage,
    analysis_progress:
      Math.max(
        0,
        Math.min(
          100,
          Math.round(
            progress,
          ),
        ),
      ),
    error_message: null,
  };

  if (state) {
    payload.processing_state =
      state;
  }

  const { error } =
    await supabase
      .from("lectures")
      .update(payload)
      .eq(
        "id",
        lectureId,
      );

  if (error) {
    throw error;
  }
}

async function generateFinalLectureAnalysis({
  system,
  user,
  profile,
  model,
}: {
  system: string;
  user: string;
  profile: DepthProfile;
  model: string;
}): Promise<LectureAnalysis> {
  const reasoningOptions =
    model.startsWith("qwen/")
      ? {
          reasoning_format:
            "hidden" as const,
          reasoning_effort:
            "none" as const,
        }
      : {
          reasoning_format:
            "hidden" as const,
          reasoning_effort:
            "low" as const,
        };

  const completion =
    await groq.chat.completions.create(
      {
        model,
        messages: [
          {
            role: "system",
            content: `${system}

OUTPUT FORMAT:
Return ONLY one valid JSON object with exactly these top-level keys:
{
  "title": string,
  "overview": string,
  "whatToKnow": string[],
  "sections": [
    {
      "heading": string,
      "startSeconds": number,
      "endSeconds": number,
      "explanation": string,
      "keyPoints": string[],
      "relatedTopicIds": string[]
    }
  ],
  "quickChecks": [
    {
      "question": string,
      "choices": string[],
      "correctIndex": number,
      "explanation": string,
      "relatedTopicIds": string[]
    }
  ],
  "studyTips": string[],
  "topicNotes": [
    {
      "topicId": string,
      "summary": string,
      "keyPoints": string[]
    }
  ],
  "terms": [
    {
      "term": string,
      "definition": string
    }
  ],
  "studySignals": [
    {
      "label": string,
      "explanation": string,
      "startSeconds": number
    }
  ],
  "confidence": number
}

Do not omit any top-level key.
If there are no useful items for an array field, return an empty array.
Every quickCheck must contain exactly four choices and correctIndex must be 0, 1, 2, or 3.`,
          },
          {
            role: "user",
            content: user,
          },
        ],
        response_format: {
          type: "json_object",
        },
        ...reasoningOptions,
        temperature:
          model.startsWith("qwen/")
            ? 0.45
            : 0.05,
        max_completion_tokens:
          profile.maxTokens,
      },
    );

  const content =
    completion.choices[0]
      ?.message?.content;

  if (!content) {
    throw new Error(
      "Groq returned an empty final lecture analysis.",
    );
  }

  let parsed: unknown;

  try {
    parsed =
      JSON.parse(content);
  } catch {
    throw new Error(
      "Groq returned invalid JSON while building the final lecture notes.",
    );
  }

  const value =
    parsed &&
    typeof parsed ===
      "object" &&
    !Array.isArray(parsed)
      ? (parsed as Record<
          string,
          unknown
        >)
      : {};

  const sections =
    Array.isArray(
      value.sections,
    )
      ? value.sections
          .map((raw) => {
            if (
              !raw ||
              typeof raw !==
                "object" ||
              Array.isArray(raw)
            ) {
              return null;
            }

            const item =
              raw as Record<
                string,
                unknown
              >;

            const heading =
              typeof item.heading ===
              "string"
                ? item.heading.trim()
                : "";

            const explanation =
              typeof item.explanation ===
              "string"
                ? item.explanation.trim()
                : "";

            if (
              !heading &&
              !explanation
            ) {
              return null;
            }

            const start =
              Number(
                item.startSeconds,
              );
            const end =
              Number(
                item.endSeconds,
              );

            return {
              heading:
                heading ||
                "Lecture section",
              startSeconds:
                Number.isFinite(
                  start,
                )
                  ? start
                  : 0,
              endSeconds:
                Number.isFinite(
                  end,
                )
                  ? end
                  : Number.isFinite(
                        start,
                      )
                    ? start
                    : 0,
              explanation,
              keyPoints:
                cleanStringArray(
                  item.keyPoints,
                  7,
                ),
              relatedTopicIds:
                cleanStringArray(
                  item.relatedTopicIds,
                  5,
                ),
            };
          })
          .filter(
            (
              section,
            ): section is LectureAnalysis["sections"][number] =>
              Boolean(section),
          )
          .slice(
            0,
            profile.sectionsMax,
          )
      : [];

  const quickChecks =
    Array.isArray(
      value.quickChecks,
    )
      ? value.quickChecks
          .map((raw) => {
            if (
              !raw ||
              typeof raw !==
                "object" ||
              Array.isArray(raw)
            ) {
              return null;
            }

            const item =
              raw as Record<
                string,
                unknown
              >;

            const question =
              typeof item.question ===
              "string"
                ? item.question.trim()
                : "";

            const choices =
              cleanStringArray(
                item.choices,
                4,
              );

            const correctIndex =
              Number(
                item.correctIndex,
              );

            if (
              !question ||
              choices.length !==
                4 ||
              !Number.isInteger(
                correctIndex,
              ) ||
              correctIndex < 0 ||
              correctIndex > 3
            ) {
              return null;
            }

            return {
              question,
              choices,
              correctIndex,
              explanation:
                typeof item.explanation ===
                "string"
                  ? item.explanation.trim()
                  : "",
              relatedTopicIds:
                cleanStringArray(
                  item.relatedTopicIds,
                  5,
                ),
            };
          })
          .filter(
            (
              check,
            ): check is LectureAnalysis["quickChecks"][number] =>
              Boolean(check),
          )
          .slice(
            0,
            profile.quickChecksMax,
          )
      : [];

  const topicNotes =
    Array.isArray(
      value.topicNotes,
    )
      ? value.topicNotes
          .map((raw) => {
            if (
              !raw ||
              typeof raw !==
                "object" ||
              Array.isArray(raw)
            ) {
              return null;
            }

            const item =
              raw as Record<
                string,
                unknown
              >;

            const topicId =
              typeof item.topicId ===
              "string"
                ? item.topicId.trim()
                : "";

            const summary =
              typeof item.summary ===
              "string"
                ? item.summary.trim()
                : "";

            if (
              !topicId ||
              !summary
            ) {
              return null;
            }

            return {
              topicId,
              summary,
              keyPoints:
                cleanStringArray(
                  item.keyPoints,
                  6,
                ),
            };
          })
          .filter(
            (
              note,
            ): note is LectureAnalysis["topicNotes"][number] =>
              Boolean(note),
          )
          .slice(0, 8)
      : [];

  const terms =
    Array.isArray(
      value.terms,
    )
      ? value.terms
          .map((raw) => {
            if (
              !raw ||
              typeof raw !==
                "object" ||
              Array.isArray(raw)
            ) {
              return null;
            }

            const item =
              raw as Record<
                string,
                unknown
              >;

            const term =
              typeof item.term ===
              "string"
                ? item.term.trim()
                : "";

            const definition =
              typeof item.definition ===
              "string"
                ? item.definition.trim()
                : "";

            return term &&
              definition
              ? {
                  term,
                  definition,
                }
              : null;
          })
          .filter(
            (
              term,
            ): term is LectureAnalysis["terms"][number] =>
              Boolean(term),
          )
          .slice(0, 14)
      : [];

  const studySignals =
    Array.isArray(
      value.studySignals,
    )
      ? value.studySignals
          .map((raw) => {
            if (
              !raw ||
              typeof raw !==
                "object" ||
              Array.isArray(raw)
            ) {
              return null;
            }

            const item =
              raw as Record<
                string,
                unknown
              >;

            const label =
              typeof item.label ===
              "string"
                ? item.label.trim()
                : "";

            const explanation =
              typeof item.explanation ===
              "string"
                ? item.explanation.trim()
                : "";

            if (
              !label ||
              !explanation
            ) {
              return null;
            }

            const startSeconds =
              Number(
                item.startSeconds,
              );

            return {
              label,
              explanation,
              startSeconds:
                Number.isFinite(
                  startSeconds,
                )
                  ? startSeconds
                  : 0,
            };
          })
          .filter(
            (
              signal,
            ): signal is LectureAnalysis["studySignals"][number] =>
              Boolean(signal),
          )
          .slice(0, 8)
      : [];

  const confidence =
    Number(
      value.confidence,
    );

  return {
    title:
      typeof value.title ===
      "string"
        ? value.title.trim()
        : "",
    overview:
      typeof value.overview ===
      "string"
        ? value.overview.trim()
        : "",
    whatToKnow:
      cleanStringArray(
        value.whatToKnow,
        profile.takeawaysMax,
      ),
    sections,
    quickChecks,
    studyTips:
      cleanStringArray(
        value.studyTips,
        profile.tipsMax,
      ),
    topicNotes,
    terms,
    studySignals,
    confidence:
      Number.isFinite(
        confidence,
      )
        ? Math.max(
            0,
            Math.min(
              100,
              confidence,
            ),
          )
        : 0,
  };
}


async function generateFinalLectureAnalysisResilient({
  system,
  user,
  profile,
  chunks,
  lectureTitle,
}: {
  system: string;
  user: string;
  profile: DepthProfile;
  chunks: ChunkRow[];
  lectureTitle: string;
}): Promise<{
  result: LectureAnalysis;
  model: string;
  fallback: boolean;
}> {
  let lastTemporaryError:
    unknown = null;

  for (
    const model of
    FINAL_SYNTHESIS_MODEL_POOL
  ) {
    try {
      const result =
        await generateFinalLectureAnalysis({
          system,
          user,
          profile,
          model,
        });

      return {
        result,
        model,
        fallback: false,
      };
    } catch (error) {
      if (
        isRateLimitError(
          error,
        ) ||
        isTransientGroqError(
          error,
        ) ||
        isFormattingGroqError(
          error,
        )
      ) {
        lastTemporaryError =
          error;
        continue;
      }

      throw error;
    }
  }

  if (lastTemporaryError) {
    console.warn(
      "All final-synthesis model lanes were unavailable. Completing lecture from saved chunk memory instead of leaving it stuck.",
      lastTemporaryError,
    );
  }

  return {
    result:
      buildDeterministicLectureAnalysis({
        chunks,
        profile,
        lectureTitle,
      }),
    model:
      "deterministic-chunk-fallback",
    fallback: true,
  };
}

export async function POST(
  request: Request,
) {
  const trustedWorker =
    isTrustedWorker(request);

  const accessToken =
    trustedWorker
      ? ""
      : bearerToken(request);

  if (
    !trustedWorker &&
    !accessToken
  ) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "You are not signed in.",
      },
      { status: 401 },
    );
  }

  let body: {
    lectureId?: string;
    depthPercent?: number;
  };

  try {
    body =
      (await request.json()) as {
        lectureId?: string;
        depthPercent?: number;
      };
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Invalid lecture analysis request.",
      },
      { status: 400 },
    );
  }

  let lectureId =
    body.lectureId?.trim() ??
    "";

  if (!lectureId) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "lectureId is required.",
      },
      { status: 400 },
    );
  }

  const supabase =
    trustedWorker
      ? createAdminClient()
      : createUserClient(
          accessToken,
        );

  let courseFileId:
    | string
    | null = null;

  let activePhase:
    | "condensing"
    | "organizing"
    | "synthesizing" =
    "condensing";

  let currentUserId = "";

  try {
    if (trustedWorker) {
      const {
        data: owner,
        error: ownerError,
      } = await supabase
        .from("lectures")
        .select("user_id")
        .eq("id", lectureId)
        .single();

      if (ownerError) {
        throw ownerError;
      }

      currentUserId =
        owner.user_id;
    } else {
      const {
        data: { user },
        error: userError,
      } =
        await supabase.auth.getUser();

      if (userError) {
        throw userError;
      }

      if (!user) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "You are not signed in.",
          },
          { status: 401 },
        );
      }

      currentUserId =
        user.id;
    }

    const {
      data: lecture,
      error: lectureError,
    } = await supabase
      .from("lectures")
      .select(
        "id, course_id, unit_id, course_file_id, title, transcript_text, notes_depth_percent, processing_state",
      )
      .eq("id", lectureId)
      .single();

    if (lectureError) {
      throw lectureError;
    }

    if (
      parseProcessingState(
        lecture.processing_state,
      ).cancelRequested === true
    ) {
      return cancelledResponse();
    }

    courseFileId =
      lecture.course_file_id ??
      null;

    if (!courseFileId) {
      throw new Error(
        "This lecture is not connected to a course material.",
      );
    }

    const transcriptText =
      lecture.transcript_text?.trim() ??
      "";

    if (!transcriptText) {
      throw new Error(
        "This lecture does not have a transcript yet.",
      );
    }

    const profile =
      depthProfile(
        body.depthPercent ??
          lecture.notes_depth_percent ??
          60,
      );

    const [
      {
        data: course,
        error: courseError,
      },
      {
        data: unit,
        error: unitError,
      },
      {
        data: topicData,
        error: topicsError,
      },
      {
        data: segmentData,
        error: segmentsError,
      },
      {
        data: chunkData,
        error: chunksError,
      },
      {
        data: linkedNoteData,
        error: linkedNotesError,
      },
    ] = await Promise.all([
      supabase
        .from("courses")
        .select(
          "code, name",
        )
        .eq(
          "id",
          lecture.course_id,
        )
        .single(),

      lecture.unit_id
        ? supabase
            .from(
              "course_units",
            )
            .select(
              "id, name",
            )
            .eq(
              "id",
              lecture.unit_id,
            )
            .maybeSingle()
        : Promise.resolve({
            data: null,
            error: null,
          }),

      supabase
        .from("course_topics")
        .select(
          "id, name, description, unit_id, parent_topic_id, source_file_id, position",
        )
        .eq(
          "course_id",
          lecture.course_id,
        )
        .order(
          "position",
          {
            ascending: true,
          },
        ),

      supabase
        .from(
          "lecture_transcript_segments",
        )
        .select(
          "position, start_seconds, end_seconds, text",
        )
        .eq(
          "lecture_id",
          lectureId,
        )
        .order(
          "position",
          {
            ascending: true,
          },
        ),

      supabase
        .from(
          "lecture_analysis_chunks",
        )
        .select(
          "id, chunk_index, start_seconds, end_seconds, source_characters, status, memory, attempts, last_error",
        )
        .eq(
          "lecture_id",
          lectureId,
        )
        .order(
          "chunk_index",
          {
            ascending: true,
          },
        ),

      supabase
        .from("notes")
        .select(
          "id, title, raw_content, updated_at",
        )
        .eq(
          "lecture_id",
          lectureId,
        )
        .order(
          "updated_at",
          {
            ascending: false,
          },
        )
        .limit(8),
    ]);

    if (courseError) {
      throw courseError;
    }
    if (unitError) {
      throw unitError;
    }
    if (topicsError) {
      throw topicsError;
    }
    if (segmentsError) {
      throw segmentsError;
    }
    if (chunksError) {
      throw chunksError;
    }
    if (linkedNotesError) {
      throw linkedNotesError;
    }

    const linkedNotes =
      (linkedNoteData ?? [])
        .map((note) => ({
          id: note.id as string,
          title:
            typeof note.title === "string"
              ? note.title.trim()
              : "Lecture note",
          rawContent:
            typeof note.raw_content === "string"
              ? noteContentToPlainText(note.raw_content)
              : "",
        }))
        .filter((note) =>
          Boolean(note.rawContent),
        );

    const userNotesText =
      linkedNotes
        .map(
          (note, index) =>
            `NOTE ${index + 1}: ${note.title}\n${note.rawContent}`,
        )
        .join("\n\n")
        .slice(0, 5000);

    const userNotesBlock =
      userNotesText
        ? `\n\nSTUDENT LIVE NOTES (secondary emphasis signal, not an independent factual source):\n${userNotesText}`
        : "";

    const allTopics:
      TopicRow[] =
      (topicData ?? []).map(
        (topic) => ({
          id: topic.id,
          name: topic.name,
          description:
            topic.description ??
            null,
          unit_id:
            topic.unit_id ??
            null,
          parent_topic_id:
            topic.parent_topic_id ??
            null,
          source_file_id:
            topic.source_file_id ??
            null,
          position:
            Number(
              topic.position ??
                0,
            ),
        }),
      );

    const segments:
      SegmentRow[] =
      (segmentData ??
        []).map(
        (segment) => ({
          position:
            Number(
              segment.position,
            ),
          start_seconds:
            Number(
              segment.start_seconds,
            ),
          end_seconds:
            Number(
              segment.end_seconds,
            ),
          text:
            segment.text,
        }),
      );

    const definitions =
      buildChunks(
        segments,
        transcriptText,
      );

    let chunks:
      ChunkRow[] =
      (chunkData ?? []).map(
        (chunk) => ({
          id: chunk.id,
          chunk_index:
            Number(
              chunk.chunk_index,
            ),
          start_seconds:
            Number(
              chunk.start_seconds,
            ),
          end_seconds:
            Number(
              chunk.end_seconds,
            ),
          source_characters:
            Number(
              chunk.source_characters,
            ),
          status:
            chunk.status,
          memory:
            (chunk.memory as ChunkMemory | null) ??
            null,
          attempts:
            Number(
              chunk.attempts ??
                0,
            ),
          last_error:
            chunk.last_error ??
            null,
        }),
      );

    /*
     * Older builds created ~7,600-character chunks. If none of those chunks
     * has completed yet, they are safe to discard and rebuild using the new
     * smaller chunk size. If even one chunk is already ready, preserve all
     * existing work and resume it rather than wasting completed AI output.
     */
    const readyChunkCount =
      chunks.filter(
        (chunk) =>
          chunk.status ===
          "ready",
      ).length;

    const hasLegacyOversizedPendingChunks =
      chunks.length > 0 &&
      readyChunkCount === 0 &&
      chunks.some(
        (chunk) =>
          chunk.source_characters >
          LEGACY_LARGE_CHUNK_CHARACTERS,
      );

    if (
      hasLegacyOversizedPendingChunks
    ) {
      const {
        error:
          legacyChunkDeleteError,
      } = await supabase
        .from(
          "lecture_analysis_chunks",
        )
        .delete()
        .eq(
          "lecture_id",
          lectureId,
        );

      if (
        legacyChunkDeleteError
      ) {
        throw legacyChunkDeleteError;
      }

      chunks = [];
    }

    if (
      chunks.length === 0
    ) {
      if (
        definitions.length ===
        0
      ) {
        throw new Error(
          "The lecture transcript is empty.",
        );
      }

      const {
        data: inserted,
        error: insertError,
      } = await supabase
        .from(
          "lecture_analysis_chunks",
        )
        .insert(
          definitions.map(
            (chunk) => ({
              lecture_id:
                lectureId,
              user_id:
                currentUserId,
              chunk_index:
                chunk.index,
              start_seconds:
                chunk.startSeconds,
              end_seconds:
                chunk.endSeconds,
              source_characters:
                chunk.text.length,
              status:
                "pending",
            }),
          ),
        )
        .select(
          "id, chunk_index, start_seconds, end_seconds, source_characters, status, memory, attempts, last_error",
        )
        .order(
          "chunk_index",
          {
            ascending: true,
          },
        );

      if (insertError) {
        throw insertError;
      }

      chunks =
        (inserted ?? []).map(
          (chunk) => ({
            id: chunk.id,
            chunk_index:
              Number(
                chunk.chunk_index,
              ),
            start_seconds:
              Number(
                chunk.start_seconds,
              ),
            end_seconds:
              Number(
                chunk.end_seconds,
              ),
            source_characters:
              Number(
                chunk.source_characters,
              ),
            status:
              chunk.status,
            memory:
              (chunk.memory as ChunkMemory | null) ??
              null,
            attempts:
              Number(
                chunk.attempts ??
                  0,
              ),
            last_error:
              chunk.last_error ??
              null,
          }),
        );
    }

    const pendingChunks =
      chunks.filter(
        (chunk) =>
          chunk.status !== "ready",
      );

    if (pendingChunks.length > 0) {
      activePhase = "condensing";

      const alreadyComplete =
        chunks.filter(
          (chunk) =>
            chunk.status === "ready",
        ).length;

      await updateLectureProgress(
        supabase,
        lectureId,
        "condensing",
        8 +
          (alreadyComplete /
            Math.max(1, chunks.length)) *
            52,
      );

      const activeChunkModelPool =
        pendingChunks.length >=
        BURST_POOL_MIN_PENDING_CHUNKS
          ? BURST_CHUNK_MODEL_POOL
          : PRIMARY_CHUNK_MODEL_POOL;

      const batch =
        pendingChunks.slice(
          0,
          activeChunkModelPool.length,
        );

      const jobs = batch.map(
        (pendingChunk, batchIndex) => {
          const definition =
            definitions.find(
              (chunk) =>
                chunk.index ===
                pendingChunk.chunk_index,
            ) ?? null;

          if (!definition) {
            return Promise.reject(
              new Error(
                "Lecture chunk metadata no longer matches the transcript. Re-transcribe the lecture and retry.",
              ),
            );
          }

          /*
           * Rotate a retry onto a different model lane. This matters most
           * when only one chunk remains. Without the attempt offset, that
           * last chunk would always hit pool[0] and could get stuck forever
           * if that one model was rate-limited while another lane was free.
           */
          const model =
            activeChunkModelPool[
              (batchIndex +
                pendingChunk.attempts) %
                activeChunkModelPool.length
            ];

          return generateChunkMemory({
            model,
            system: `You compress ONE chronological chunk of a college lecture into compact source-grounded memory.

RULES:
1. Use only information actually stated in this transcript chunk.
2. Do not add outside facts or fix the professor's content.
3. Preserve examples, distinctions, definitions, equations described in speech, warnings, and professor emphasis.
4. Keep the result compact because a stronger final model creates the polished notes later.
5. Timestamps must stay within the supplied timestamp range.
6. If there is no explicit study or exam signal, return an empty studySignals array.
7. Do not discuss course-topic IDs here.
8. Avoid filler and repeated wording.`,
            user: `COURSE:
${course?.code ?? ""} ${course?.name ?? ""}

LECTURE:
${lecture.title}

CHUNK:
${pendingChunk.chunk_index + 1} of ${chunks.length}

ALLOWED TIMESTAMP RANGE:
${formatTimestamp(definition.startSeconds)}-${formatTimestamp(definition.endSeconds)}

TRANSCRIPT:
${definition.text}`,
            startSeconds: definition.startSeconds,
            endSeconds: definition.endSeconds,
          }).then((memory) => ({
            pendingChunk,
            memory,
            model,
          }));
        },
      );

      const results =
        await Promise.allSettled(jobs);

      let completedThisBatch = 0;
      let transientFailures = 0;
      let firstPermanentError: unknown | null = null;
      const transientRetryDelays: number[] = [];
      let canRotateImmediately = false;

      for (let index = 0; index < results.length; index += 1) {
        const result = results[index];
        const pendingChunk = batch[index];

        if (result.status === "fulfilled") {
          const { error: chunkUpdateError } =
            await supabase
              .from("lecture_analysis_chunks")
              .update({
                status: "ready",
                memory: result.value.memory,
                attempts: pendingChunk.attempts + 1,
                last_error: null,
              })
              .eq("id", pendingChunk.id);

          if (chunkUpdateError) {
            throw chunkUpdateError;
          }

          pendingChunk.status = "ready";
          pendingChunk.memory = result.value.memory;
          pendingChunk.attempts += 1;
          pendingChunk.last_error = null;
          completedThisBatch += 1;
          continue;
        }

        const failure = result.reason;

        if (
          isRateLimitError(failure) ||
          isTransientGroqError(failure)
        ) {
          transientFailures += 1;

          if (isRateLimitError(failure)) {
            transientRetryDelays.push(
              retryAfterSeconds(failure),
            );

            /*
             * If this chunk has not yet tried every available lane, retry
             * almost immediately on the next model instead of sleeping for
             * the exhausted model's reset window.
             */
            const nextAttempt =
              pendingChunk.attempts + 1;

            if (
              activeChunkModelPool.length > 1 &&
              nextAttempt %
                activeChunkModelPool.length !==
                0
            ) {
              canRotateImmediately = true;
            }
          }

          await supabase
            .from("lecture_analysis_chunks")
            .update({
              attempts: pendingChunk.attempts + 1,
              last_error:
                failure instanceof Error
                  ? `${failure.message.slice(0, 420)} | next retry rotates model lane`
                  : "Temporary Groq model-pool error. Next retry rotates to another model lane.",
            })
            .eq("id", pendingChunk.id);

          continue;
        }

        firstPermanentError ??= failure;
      }

      if (
        await analysisWasCancelled(
          supabase,
          lectureId,
        )
      ) {
        return cancelledResponse();
      }

      if (
        completedThisBatch === 0 &&
        firstPermanentError
      ) {
        throw firstPermanentError;
      }

      const completed =
        alreadyComplete + completedThisBatch;

      const progress =
        8 +
        (completed / Math.max(1, chunks.length)) * 52;

      await updateLectureProgress(
        supabase,
        lectureId,
        "condensing",
        progress,
      );

      const remaining =
        Math.max(0, chunks.length - completed);

      const providerRetryDelay =
        transientRetryDelays.length > 0
          ? Math.max(
              1,
              Math.min(
                90,
                Math.max(...transientRetryDelays),
              ),
            )
          : 1;

      return NextResponse.json({
        ok: true,
        status: "processing",
        phase: "condensing",
        progress: Math.round(progress),
        completedChunks: completed,
        totalChunks: chunks.length,
        retryAfterSeconds:
          completedThisBatch > 0 ||
          canRotateImmediately
            ? 1
            : transientFailures > 0
              ? providerRetryDelay
              : 1,
        message:
          remaining === 0
            ? "Lecture sections condensed. Organizing topics next…"
            : transientFailures > 0
              ? completedThisBatch > 0
                ? `Condensed ${completedThisBatch} section${completedThisBatch === 1 ? "" : "s"} in parallel. Rotating the remaining ${remaining} section${remaining === 1 ? "" : "s"} onto another available model lane.`
                : `All attempted model lanes are temporarily busy. Waiting for Groq's reset window, then rotating the remaining ${remaining} section${remaining === 1 ? "" : "s"} across the model pool.`
              : `Condensed ${completedThisBatch} lecture section${completedThisBatch === 1 ? "" : "s"} in parallel. ${remaining} remaining.`,
      });
    }

    let state =
      parseProcessingState(
        lecture.processing_state,
      );

    if (
      !state.topicAssignment
    ) {
      activePhase =
        "organizing";

      await updateLectureProgress(
        supabase,
        lectureId,
        "organizing",
        68,
      );

      const candidates =
        lecture.unit_id
          ? allTopics.filter(
              (topic) =>
                topic.unit_id ===
                  lecture.unit_id ||
                topic.unit_id ===
                  null,
            )
          : allTopics;

      const candidateIds =
        new Set(
          candidates.map(
            (topic) =>
              topic.id,
          ),
        );

      const compactSource =
        compactMemories(
          chunks,
        );

      let attribution:
        TopicAttribution;

      if (
        candidates.length ===
        0
      ) {
        attribution = {
          matchedTopicIds:
            [],
          newSubtopics: [],
          confidence: 0,
          rationale:
            "No existing course topics were available to match.",
        };
      } else {
        const candidateList =
          candidates
            .map(
              (topic) => {
                const parent =
                  topic.parent_topic_id
                    ? candidates.find(
                        (
                          candidate,
                        ) =>
                          candidate.id ===
                          topic.parent_topic_id,
                      )
                    : null;

                return `- ${topic.id}: ${topic.name}${
                  parent
                    ? ` (subtopic of ${parent.name})`
                    : ""
                }${
                  topic.description
                    ? `: ${topic.description.slice(
                        0,
                        100,
                      )}`
                    : ""
                }`;
              },
            )
            .join("\n");

        if (
          await analysisWasCancelled(
            supabase,
            lectureId,
          )
        ) {
          return cancelledResponse();
        }

        const organization =
          await generateTopicAttributionResilient({
            system: `You classify a college lecture into the student's existing course topics.

STRICT RULES:
1. Prefer existing course topics whenever there is a reasonable semantic fit.
2. Usually select 1 to 5 existing topics when the lecture substantially covers them.
3. matchedTopicIds may contain ONLY IDs from the supplied candidate list.
4. Never create a new top-level topic from a lecture.
5. New subtopics are rare and may only clarify a durable concept useful for future study.
6. Propose AT MOST TWO new subtopics total.
7. Every new subtopic MUST sit under an existing supplied topic ID.
8. Do not create a subtopic duplicating an existing topic or subtopic.
9. Use only the compact lecture memory supplied below.
10. Return only the requested tagged lines.`,
            user: `COURSE:
${course?.code ?? ""} ${course?.name ?? ""}

SELECTED UNIT:
${unit?.name ?? "No unit manually selected"}

LECTURE:
${lecture.title}

EXISTING CANDIDATE TOPICS:
${candidateList}

WHOLE-LECTURE COMPACT MEMORY:
${compactSource}${userNotesBlock}`,
            candidates,
            compactSource,
          });

        attribution =
          organization.attribution;

        state = {
          ...state,
          organizationModel:
            organization.model,
          organizationFallback:
            organization.fallback,
        };
      }

      if (
        await analysisWasCancelled(
          supabase,
          lectureId,
        )
      ) {
        return cancelledResponse();
      }

      const matchedTopicIds =
        Array.from(
          new Set(
            (
              attribution.matchedTopicIds ??
              []
            ).filter(
              (id) =>
                candidateIds.has(
                  id,
                ),
            ),
          ),
        ).slice(0, 6);

      const createdTopicIds:
        string[] = [];

      const existingLectureSubtopicCount =
        allTopics.filter(
          (topic) =>
            topic.source_file_id ===
              courseFileId &&
            Boolean(
              topic.parent_topic_id,
            ),
        ).length;

      const remainingSlots =
        Math.max(
          0,
          2 -
            existingLectureSubtopicCount,
        );

      const proposed =
        (
          attribution.newSubtopics ??
          []
        )
          .map(
            (suggestion) => ({
              name:
                suggestion.name.trim(),
              parentTopicId:
                suggestion.parentTopicId,
              reason:
                suggestion.reason.trim(),
            }),
          )
          .filter(
            (suggestion) =>
              suggestion.name &&
              candidateIds.has(
                suggestion.parentTopicId,
              ),
          )
          .slice(
            0,
            remainingSlots,
          );

      for (
        let index = 0;
        index <
        proposed.length;
        index += 1
      ) {
        const suggestion =
          proposed[index];

        const parent =
          allTopics.find(
            (topic) =>
              topic.id ===
              suggestion.parentTopicId,
          ) ?? null;

        if (!parent) {
          continue;
        }

        const duplicate =
          allTopics.find(
            (topic) =>
              topic.parent_topic_id ===
                parent.id &&
              normalizeName(
                topic.name,
              ) ===
                normalizeName(
                  suggestion.name,
                ),
          );

        if (duplicate) {
          createdTopicIds.push(
            duplicate.id,
          );
          continue;
        }

        const targetUnitId =
          lecture.unit_id ??
          parent.unit_id ??
          null;

        const maxPosition =
          allTopics.reduce(
            (
              maximum,
              topic,
            ) =>
              Math.max(
                maximum,
                topic.position,
              ),
            0,
          );

        const {
          data: created,
          error:
            createTopicError,
        } = await supabase
          .from(
            "course_topics",
          )
          .insert({
            user_id:
              currentUserId,
            course_id:
              lecture.course_id,
            unit_id:
              targetUnitId,
            parent_topic_id:
              parent.id,
            source_file_id:
              courseFileId,
            name:
              suggestion.name,
            description:
              suggestion.reason ||
              null,
            position:
              maxPosition +
              index +
              1,
            source: "ai",
            mastery_score: 0,
            mastery_state:
              "unseen",
          })
          .select(
            "id, name, description, unit_id, parent_topic_id, source_file_id, position",
          )
          .single();

        if (
          createTopicError
        ) {
          throw createTopicError;
        }

        const createdTopic:
          TopicRow = {
          id: created.id,
          name: created.name,
          description:
            created.description ??
            null,
          unit_id:
            created.unit_id ??
            null,
          parent_topic_id:
            created.parent_topic_id ??
            null,
          source_file_id:
            created.source_file_id ??
            courseFileId,
          position:
            Number(
              created.position ??
                0,
            ),
        };

        allTopics.push(
          createdTopic,
        );
        createdTopicIds.push(
          createdTopic.id,
        );
      }

      const finalTopicIds =
        Array.from(
          new Set([
            ...matchedTopicIds,
            ...createdTopicIds,
          ]),
        );

      const inferredUnitId =
        lecture.unit_id ??
        inferUnitId(
          allTopics,
          finalTopicIds,
        );

      if (
        inferredUnitId &&
        inferredUnitId !==
          lecture.unit_id
      ) {
        const [
          {
            error:
              lectureUnitError,
          },
          {
            error:
              fileUnitError,
          },
        ] =
          await Promise.all([
            supabase
              .from(
                "lectures",
              )
              .update({
                unit_id:
                  inferredUnitId,
              })
              .eq(
                "id",
                lectureId,
              ),
            supabase
              .from(
                "course_files",
              )
              .update({
                unit_id:
                  inferredUnitId,
              })
              .eq(
                "id",
                courseFileId,
              ),
          ]);

        if (
          lectureUnitError
        ) {
          throw lectureUnitError;
        }

        if (fileUnitError) {
          throw fileUnitError;
        }
      }

      const [
        {
          error:
            clearMaterialLinksError,
        },
        {
          error:
            clearLectureLinksError,
        },
      ] =
        await Promise.all([
          supabase
            .from(
              "course_file_topic_links",
            )
            .delete()
            .eq(
              "course_file_id",
              courseFileId,
            ),
          supabase
            .from(
              "lecture_topic_links",
            )
            .delete()
            .eq(
              "lecture_id",
              lectureId,
            ),
        ]);

      if (
        clearMaterialLinksError
      ) {
        throw clearMaterialLinksError;
      }

      if (
        clearLectureLinksError
      ) {
        throw clearLectureLinksError;
      }

      const confidence =
        Math.max(
          0,
          Math.min(
            100,
            Number(
              attribution.confidence ??
                0,
            ),
          ),
        );

      if (
        finalTopicIds.length >
        0
      ) {
        const [
          {
            error:
              materialLinkError,
          },
          {
            error:
              lectureLinkError,
          },
        ] =
          await Promise.all([
            supabase
              .from(
                "course_file_topic_links",
              )
              .insert(
                finalTopicIds.map(
                  (topicId) => ({
                    user_id:
                      currentUserId,
                    course_id:
                      lecture.course_id,
                    course_file_id:
                      courseFileId,
                    topic_id:
                      topicId,
                    relation_source:
                      "ai",
                    confidence:
                      confidence /
                      100,
                  }),
                ),
              ),
            supabase
              .from(
                "lecture_topic_links",
              )
              .insert(
                finalTopicIds.map(
                  (topicId) => ({
                    lecture_id:
                      lectureId,
                    user_id:
                      currentUserId,
                    course_id:
                      lecture.course_id,
                    topic_id:
                      topicId,
                    confidence:
                      confidence /
                      100,
                    rationale:
                      attribution.rationale ??
                      "",
                  }),
                ),
              ),
          ]);

        if (
          materialLinkError
        ) {
          throw materialLinkError;
        }

        if (
          lectureLinkError
        ) {
          throw lectureLinkError;
        }
      }

      const topicAssignment:
        StoredTopicAssignment = {
        matchedTopicIds,
        createdSubtopicIds:
          createdTopicIds,
        finalTopicIds,
        inferredUnitId:
          inferredUnitId ??
          null,
        confidence,
        rationale:
          attribution.rationale ??
          "",
      };

      state = {
        ...state,
        topicAssignment,
      };

      await updateLectureProgress(
        supabase,
        lectureId,
        "synthesizing",
        78,
        state,
      );
    }

    activePhase =
      "synthesizing";

    await updateLectureProgress(
      supabase,
      lectureId,
      "synthesizing",
      82,
    );

    const topicAssignment =
      state.topicAssignment;

    if (!topicAssignment) {
      throw new Error(
        "Lecture topic organization is missing. Retry analysis.",
      );
    }

    const validTopicIds =
      new Set(
        allTopics.map(
          (topic) =>
            topic.id,
        ),
      );

    const finalTopicIds =
      topicAssignment.finalTopicIds.filter(
        (id) =>
          validTopicIds.has(
            id,
          ),
      );

    const finalTopics =
      allTopics.filter(
        (topic) =>
          finalTopicIds.includes(
            topic.id,
          ),
      );

    const finalTopicList =
      finalTopics
        .map(
          (topic) =>
            `- ${topic.id}: ${topic.name}${
              topic.parent_topic_id
                ? " (subtopic)"
                : ""
            }`,
        )
        .join("\n");

    const compactSource =
      compactMemories(
        chunks,
      );

    if (!compactSource) {
      throw new Error(
        "Lecture chunk memory is empty. Retry analysis.",
      );
    }

    if (
      await analysisWasCancelled(
        supabase,
        lectureId,
      )
    ) {
      return cancelledResponse();
    }

    const finalSynthesis =
      await generateFinalLectureAnalysisResilient(
        {
          profile,
          chunks,
          lectureTitle:
            lecture.title,
          system: `You turn a compact, chronological memory of a college lecture into polished, source-grounded study material.

The student's requested note depth is ${profile.depthPercent}/100 (${profile.label}).

DEPTH BEHAVIOR:
- Lower depth still covers the whole lecture, but compresses it to the essentials.
- Higher depth adds explanation, structure, key points, terminology, professor signals, topic-specific notes, and practice questions.
- Higher depth NEVER allows outside information.

NON-NEGOTIABLE RULES:
1. Use only information preserved in the whole-lecture compact memory below.
2. Do not add outside facts, definitions, examples, dates, equations, or claims.
3. Preserve the professor's terminology, examples, distinctions, warnings, and framing.
4. Timestamps must come from timestamps present in the compact memory.
5. Never invent exam relevance. Only preserve explicit professor signals.
6. relatedTopicIds and topicNotes may ONLY use IDs from FINAL LINKED TOPICS.
7. Create a topicNotes entry for each linked topic that is genuinely supported.
8. Quick checks must have exactly four choices and exactly one correct answer.
9. Keep the result useful to a student who missed class.
10. Student live notes are a HIGH-PRIORITY emphasis signal. Use them to notice what the student thought mattered, questions they wrote, shorthand they want expanded, and explicit reminders such as “professor says this is important.”
11. Student notes are NOT automatically factual. If a note conflicts with or is not supported by the transcript memory, do not present it as a professor-stated fact. Preserve it as a question or student reminder instead.
12. When a student note highlights something that is supported by the lecture, give that concept extra clarity and prominence in whatToKnow and the relevant section.
13. Return plain text inside JSON fields, no markdown.`,
          user: `COURSE:
${course?.code ?? ""} ${course?.name ?? ""}

LECTURE:
${lecture.title}

FINAL LINKED TOPICS:
${finalTopicList || "(No linked topics)"}

WHOLE-LECTURE COMPACT MEMORY:
${compactSource}${userNotesBlock}`,
        },
      );

    const result =
      finalSynthesis.result;

    const finalModel =
      finalSynthesis.model;

    const usedFallback =
      finalSynthesis.fallback;

    if (
      await analysisWasCancelled(
        supabase,
        lectureId,
      )
    ) {
      return cancelledResponse();
    }

    const allowedFinalTopicIds =
      new Set(
        finalTopicIds,
      );

    const cleanTopicIds =
      (ids: string[]) =>
        Array.from(
          new Set(
            ids.filter(
              (id) =>
                allowedFinalTopicIds.has(
                  id,
                ),
            ),
          ),
        );

    const materialAnalysis = {
      detailLevel:
        profile.detailLevel,
      detailPercent:
        profile.depthPercent,
      sourceKind:
        "lecture" as const,
      title:
        result.title.trim() ||
        lecture.title,
      overview:
        result.overview.trim(),
      whatToKnow:
        result.whatToKnow,
      sections:
        result.sections.map(
          (section) => ({
            heading:
              section.heading,
            explanation:
              section.explanation,
            keyPoints:
              section.keyPoints,
            relatedTopicIds:
              cleanTopicIds(
                section.relatedTopicIds,
              ),
            startSeconds:
              section.startSeconds,
            endSeconds:
              section.endSeconds,
          }),
        ),
      quickChecks:
        result.quickChecks.map(
          (question) => ({
            question:
              question.question,
            choices:
              question.choices,
            correctIndex:
              question.correctIndex,
            explanation:
              question.explanation,
            relatedTopicIds:
              cleanTopicIds(
                question.relatedTopicIds,
              ),
          }),
        ),
      studyTips:
        result.studyTips,
      topicNotes:
        result.topicNotes
          .filter((note) =>
            allowedFinalTopicIds.has(
              note.topicId,
            ),
          )
          .map((note) => ({
            topicId:
              note.topicId,
            summary:
              note.summary,
            keyPoints:
              note.keyPoints,
          })),
      confidence:
        Math.max(
          0,
          Math.min(
            100,
            Number(
              result.confidence ??
                0,
            ),
          ),
        ),
    };

    const {
      data:
        savedAnalysis,
      error:
        analysisSaveError,
    } = await supabase
      .from(
        "material_analyses",
      )
      .upsert(
        {
          user_id:
            currentUserId,
          course_id:
            lecture.course_id,
          course_file_id:
            courseFileId,
          summary:
            materialAnalysis.overview,
          explanation:
            materialAnalysis.sections
              .map(
                (section) =>
                  `${section.heading}: ${section.explanation}`,
              )
              .join(
                "\n\n",
              ),
          raw_analysis:
            materialAnalysis,
          status: "ready",
          model:
            finalModel,
          analyzed_at:
            new Date().toISOString(),
          updated_at:
            new Date().toISOString(),
        },
        {
          onConflict:
            "course_file_id",
        },
      )
      .select("id")
      .single();

    if (
      analysisSaveError
    ) {
      throw analysisSaveError;
    }

    const {
      error:
        clearTopicNotesError,
    } = await supabase
      .from(
        "material_analysis_topic_notes",
      )
      .delete()
      .eq(
        "course_file_id",
        courseFileId,
      );

    if (
      clearTopicNotesError
    ) {
      throw clearTopicNotesError;
    }

    const topicNoteRows =
      materialAnalysis.topicNotes.map(
        (note) => ({
          user_id:
            currentUserId,
          course_id:
            lecture.course_id,
          course_file_id:
            courseFileId,
          material_analysis_id:
            savedAnalysis.id,
          topic_id:
            note.topicId,
          summary:
            note.summary,
          key_points:
            note.keyPoints,
        }),
      );

    if (
      topicNoteRows.length >
      0
    ) {
      const {
        error:
          topicNoteInsertError,
      } = await supabase
        .from(
          "material_analysis_topic_notes",
        )
        .insert(
          topicNoteRows,
        );

      if (
        topicNoteInsertError
      ) {
        throw topicNoteInsertError;
      }
    }

    const lectureNotes = {
      depthPercent:
        profile.depthPercent,
      depthLabel:
        profile.label,
      materialAnalysis,
      terms:
        result.terms,
      studySignals:
        result.studySignals,
      topicAssignment,
      analysisQuality:
        usedFallback
          ? "saved-chunk-fallback"
          : "full-ai",
      analysisModel:
        finalModel,
      topicOrganizationMode:
        state.organizationFallback
          ? "deterministic-fallback"
          : "ai",
      userNotesUsed:
        Boolean(userNotesText),
      userNoteIds:
        linkedNotes.map(
          (note) => note.id,
        ),
    };

    const [
      {
        error:
          lectureUpdateError,
      },
      {
        error:
          courseFileUpdateError,
      },
    ] =
      await Promise.all([
        supabase
          .from("lectures")
          .update({
            unit_id:
              topicAssignment.inferredUnitId ??
              lecture.unit_id ??
              null,
            notes_depth_percent:
              profile.depthPercent,
            summary:
              materialAnalysis.overview,
            notes:
              lectureNotes,
            analysis_model:
              finalModel,
            status:
              "ready",
            analysis_stage:
              "ready",
            analysis_progress:
              100,
            error_message:
              null,
            processed_at:
              new Date().toISOString(),
          })
          .eq(
            "id",
            lectureId,
          ),

        supabase
          .from(
            "course_files",
          )
          .update({
            unit_id:
              topicAssignment.inferredUnitId ??
              lecture.unit_id ??
              null,
            processing_status:
              "ready",
          })
          .eq(
            "id",
            courseFileId,
          ),
      ]);

    if (
      lectureUpdateError
    ) {
      throw lectureUpdateError;
    }

    if (
      courseFileUpdateError
    ) {
      throw courseFileUpdateError;
    }

    return NextResponse.json({
      ok: true,
      status: "ready",
      phase: "ready",
      progress: 100,
      lectureId,
      courseFileId,
      message:
        usedFallback
          ? "Lecture ready. Groq's live synthesis pools were busy, so the app finished immediately from the saved chunk memory instead of leaving the lecture stuck. You can rebuild later for a more polished pass."
          : "Lecture ready.",
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Lecture analysis failed.";

    if (
      isRateLimitError(
        error,
      ) ||
      isTransientGroqError(
        error,
      )
    ) {
      const rateLimited =
        isRateLimitError(
          error,
        );

      const formattingIssue =
        isFormattingGroqError(
          error,
        );

      const retryAfter =
        rateLimited
          ? retryAfterSeconds(
              error,
            )
          : formattingIssue
            ? 20
            : 60;

      if (lectureId) {
        await supabase
          .from("lectures")
          .update({
            status:
              "analyzing",
            analysis_stage:
              activePhase,
            error_message:
              null,
          })
          .eq(
            "id",
            lectureId,
          );
      }

      if (courseFileId) {
        await supabase
          .from(
            "course_files",
          )
          .update({
            processing_status:
              "processing",
          })
          .eq(
            "id",
            courseFileId,
          );
      }

      const friendlyMessage =
        rateLimited
          ? `Groq is busy right now. Your lecture is safe. Retrying automatically in about ${retryAfter} seconds.`
          : formattingIssue
            ? `Groq had a temporary response-format issue. Your lecture is safe. Retrying automatically in about ${retryAfter} seconds.`
            : `Groq is temporarily unavailable. Your lecture is safe. Retrying automatically in about ${retryAfter} seconds.`;

      return NextResponse.json(
        {
          ok: false,
          code:
            rateLimited
              ? "GROQ_RATE_LIMITED"
              : formattingIssue
                ? "GROQ_FORMAT_RETRY"
                : "GROQ_TEMPORARY_ERROR",
          retryable: true,
          retryAfterSeconds:
            retryAfter,
          phase:
            activePhase,
          message:
            friendlyMessage,
          error:
            friendlyMessage,
        },
        {
          status:
            rateLimited
              ? 429
              : 503,
          headers: {
            "Retry-After":
              String(
                retryAfter,
              ),
          },
        },
      );
    }

    console.error(
      "Lecture analysis failed:",
      error,
    );

    if (lectureId) {
      await supabase
        .from("lectures")
        .update({
          status: "error",
          analysis_stage:
            "error",
          error_message:
            message,
        })
        .eq(
          "id",
          lectureId,
        );
    }

    if (courseFileId) {
      await supabase
        .from(
          "course_files",
        )
        .update({
          processing_status:
            "error",
        })
        .eq(
          "id",
          courseFileId,
        );
    }

    return NextResponse.json(
      {
        ok: false,
        code:
          "LECTURE_ANALYSIS_FAILED",
        retryable: true,
        error: message,
      },
      { status: 500 },
    );
  }
}
