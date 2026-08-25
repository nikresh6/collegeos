import { getGroqClient } from "./ai/groq";

const NOTE_MODELS = [
  "openai/gpt-oss-20b",
  "qwen/qwen3.6-27b",
] as const;

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

export async function noteCompletion({
  system,
  user,
  maxTokens,
}: {
  system: string;
  user: string;
  maxTokens: number;
}) {
  let lastError:
    unknown = null;

  for (
    const model of
    NOTE_MODELS
  ) {
    try {
      const completion =
        await getGroqClient().chat.completions.create({
          model,
          messages: [
            {
              role:
                "system",
              content:
                system,
            },
            {
              role:
                "user",
              content:
                user,
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
          temperature:
            model.startsWith(
              "qwen/",
            )
              ? 0.55
              : 0.15,
          max_completion_tokens:
            maxTokens,
        });

      const content =
        completion
          .choices[0]
          ?.message
          ?.content
          ?.trim();

      if (!content) {
        throw new Error(
          "The note AI returned an empty response.",
        );
      }

      return {
        content,
        model,
      };
    } catch (
      error
    ) {
      lastError =
        error;

      if (
        !isRateLimit(
          error,
        )
      ) {
        throw error;
      }
    }
  }

  throw (
    lastError ??
    new Error(
      "Groq is busy right now. Try again in a minute.",
    )
  );
}

export function friendlyNoteAiError(
  error: unknown,
) {
  const candidate =
    error as {
      status?: number;
      message?: string;
    };

  if (
    candidate.status ===
      429 ||
    candidate.message
      ?.toLowerCase()
      .includes(
        "rate limit",
      )
  ) {
    return "Groq is busy right now. Your note is safe. Try again in about a minute.";
  }

  return (
    candidate.message ||
    "Could not run note AI."
  );
}
