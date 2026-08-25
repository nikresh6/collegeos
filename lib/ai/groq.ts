import Groq from "groq-sdk";

let groqClient: Groq | null = null;

export function getGroqClient() {
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    throw new Error(
      "GROQ_API_KEY is missing from the server environment.",
    );
  }

  groqClient ??= new Groq({ apiKey });
  return groqClient;
}

// Backward-compatible lazy facade for routes that use specialized Groq APIs
// (audio transcription, raw chat completions, etc.). Accessing it inside a
// request initializes the client; importing the module never crashes a route.
export const groq = new Proxy({} as Groq, {
  get(_target, property) {
    const client = getGroqClient();
    const value = Reflect.get(client, property, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

export const GROQ_MODELS = {
  syllabus:
    process.env.GROQ_SYLLABUS_MODEL ||
    "openai/gpt-oss-120b",
  lecture:
    process.env.GROQ_LECTURE_MODEL ||
    process.env.GROQ_SYLLABUS_MODEL ||
    "openai/gpt-oss-120b",
  lectureChunk:
    process.env.GROQ_LECTURE_CHUNK_MODEL ||
    "openai/gpt-oss-20b",
  fast: "llama-3.1-8b-instant",
  transcription: "whisper-large-v3-turbo",
} as const;

type JsonSchema = Record<string, unknown>;

const DEFAULT_STRUCTURED_FALLBACK_MODEL = "openai/gpt-oss-20b";

export function structuredModelCandidates(primaryModel: string) {
  return [
    primaryModel,
    process.env.GROQ_STRUCTURED_FALLBACK_MODEL ||
      (primaryModel === DEFAULT_STRUCTURED_FALLBACK_MODEL
        ? GROQ_MODELS.syllabus
        : DEFAULT_STRUCTURED_FALLBACK_MODEL),
  ].filter((candidate, index, candidates) =>
    Boolean(candidate) && candidates.indexOf(candidate) === index,
  );
}

function isRetryableModelError(error: unknown) {
  if (!(error instanceof Error)) return false;
  const status = "status" in error && typeof error.status === "number"
    ? error.status
    : null;
  return status === 408 || status === 409 || status === 429 ||
    (status !== null && status >= 500) ||
    /empty response|could not be parsed|token limit|length|rate limit|temporar/i.test(error.message);
}

export async function generateStructured<T>({
  system,
  user,
  schemaName,
  schema,
  temperature = 0.05,
  maxTokens = 4200,
  model = GROQ_MODELS.syllabus,
}: {
  system: string;
  user: string;
  schemaName: string;
  schema: JsonSchema;
  temperature?: number;
  maxTokens?: number;
  model?: string;
}): Promise<T> {
  let lastError: unknown = null;

  for (const candidateModel of structuredModelCandidates(model)) {
    try {
      const completion = await getGroqClient().chat.completions.create({
        model: candidateModel,

        messages: [
          {
            role: "system",
            content: system,
          },
          {
            role: "user",
            content: user,
          },
        ],

        response_format: {
          type: "json_schema",
          json_schema: {
            name: schemaName,
            strict: true,
            schema,
          },
        },

        // Syllabus extraction is mostly parsing, not deep reasoning.
        // Keep reasoning low so GPT-OSS does not waste the free-tier token budget.
        reasoning_effort: "low",
        include_reasoning: false,

        temperature,
        max_completion_tokens: maxTokens,
      });

      const choice = completion.choices[0];
      if (choice?.finish_reason === "length") {
        throw new Error("The AI response reached its token limit.");
      }

      const content = choice?.message?.content;

      if (!content) {
        throw new Error("Groq returned an empty response.");
      }

      try {
        return JSON.parse(content) as T;
      } catch {
        throw new Error(
          "Groq returned a response that could not be parsed as JSON.",
        );
      }
    } catch (error) {
      lastError = error;
      if (!isRetryableModelError(error)) throw error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("The AI service is temporarily unavailable.");
}
