import {
  createClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

export type SolveVerification = {
  kind: "exact" | "numeric" | "semantic";
  acceptedAnswers: string[];
  tolerance: number;
  units: string;
};

export type SolveStep = {
  title: string;
  learnerPrompt: string;
  concept: string;
  hints: string[];
  expectedAnswer: string;
  verification: SolveVerification;
  explanationAfterSuccess: string;
};

export type SolvePlan = {
  problemSummary: string;
  subject: string;
  givens: string[];
  goal: string;
  assumptions: string[];
  steps: SolveStep[];
  finalAnswer: string;
  finalCheck: string;
};

export type SolvePrivateVerification = {
  currentStep: number;
  hintCount: number;
  completedAt: string | null;
  answerRevealedAt: string | null;
  stepCount: number;
  finalCheck: string;
};

export type SolveSessionRow = {
  id: string;
  user_id: string;
  course_id: string;
  unit_id: string | null;
  topic_id: string | null;
  origin_kind: string;
  origin_id: string | null;
  prompt: string;
  subject: string | null;
  status: string;
  current_step: number;
  step_count: number;
  hint_count: number;
  answer_revealed_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PublicSolveState = {
  id: string;
  courseId: string;
  unitId: string | null;
  topicId: string | null;
  originKind: string;
  prompt: string;
  problemSummary: string;
  subject: string;
  givens: string[];
  goal: string;
  assumptions: string[];
  status: string;
  currentStepIndex: number;
  stepCount: number;
  hintCount: number;
  progressPercent: number;
  currentStep: {
    index: number;
    title: string;
    learnerPrompt: string;
    concept: string;
  } | null;
  completedSteps: Array<{
    index: number;
    title: string;
    explanation: string;
  }>;
  answer: {
    finalAnswer: string;
    finalCheck: string;
    steps: Array<{
      index: number;
      title: string;
      explanation: string;
    }>;
  } | null;
};

export const SOLVE_SESSION_SELECT =
  "id, user_id, course_id, unit_id, topic_id, origin_kind, origin_id, prompt, subject, status, current_step, step_count, hint_count, answer_revealed_at, completed_at, created_at, updated_at";

function cleanText(
  value: unknown,
  maximum = 1400,
) {
  if (typeof value !== "string") return "";

  return value
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

function cleanList(
  value: unknown,
  maximum = 8,
  itemMaximum = 420,
) {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => cleanText(item, itemMaximum))
    .filter(Boolean)
    .slice(0, maximum);
}

function verificationKind(
  value: unknown,
): SolveVerification["kind"] {
  return value === "exact" ||
    value === "numeric" ||
    value === "semantic"
    ? value
    : "semantic";
}

export function normalizeSolvePlan(
  value: unknown,
): SolvePlan {
  const record =
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  const rawSteps = Array.isArray(record.steps)
    ? record.steps
    : [];

  const steps = rawSteps
    .map((entry) => {
      const step =
        entry &&
        typeof entry === "object" &&
        !Array.isArray(entry)
          ? (entry as Record<string, unknown>)
          : {};

      const verificationRecord =
        step.verification &&
        typeof step.verification === "object" &&
        !Array.isArray(step.verification)
          ? (step.verification as Record<string, unknown>)
          : {};

      const learnerPrompt = cleanText(
        step.learnerPrompt,
        900,
      );
      const expectedAnswer = cleanText(
        step.expectedAnswer,
        900,
      );

      if (!learnerPrompt || !expectedAnswer) {
        return null;
      }

      const rawTolerance = Number(
        verificationRecord.tolerance ?? 0.001,
      );
      const requestedVerificationKind = verificationKind(
        verificationRecord.kind,
      );
      const expectedNumeric = parseSingleComparableNumber(expectedAnswer);
      const maximumTolerance = expectedNumeric === null
        ? 0.01
        : Math.min(
            1,
            Math.max(0.0001, Math.abs(expectedNumeric) * 0.01),
          );

      return {
        title:
          cleanText(step.title, 120) ||
          "Work the next step",
        learnerPrompt,
        concept: cleanText(step.concept, 260),
        hints: cleanList(step.hints, 3, 500),
        expectedAnswer,
        verification: {
          kind:
            requestedVerificationKind === "numeric" &&
            expectedNumeric === null
              ? "semantic"
              : requestedVerificationKind,
          acceptedAnswers: cleanList(
            verificationRecord.acceptedAnswers,
            8,
            260,
          ),
          tolerance: Number.isFinite(rawTolerance)
            ? Math.max(
                0,
                Math.min(maximumTolerance, rawTolerance),
              )
            : 0.001,
          units: cleanText(
            verificationRecord.units,
            80,
          ),
        },
        explanationAfterSuccess:
          cleanText(
            step.explanationAfterSuccess,
            900,
          ) || "That completes this step.",
      } satisfies SolveStep;
    })
    .filter((step): step is SolveStep => Boolean(step))
    .slice(0, 10);

  if (steps.length === 0) {
    throw new Error(
      "The tutor could not create a reliable step-by-step plan for that problem.",
    );
  }

  const finalAnswer = cleanText(
    record.finalAnswer,
    1800,
  );

  if (!finalAnswer) {
    throw new Error(
      "The tutor could not verify a final answer for that problem.",
    );
  }

  return {
    problemSummary:
      cleanText(record.problemSummary, 900) ||
      "Work through the problem one decision at a time.",
    subject:
      cleanText(record.subject, 100) || "Academic problem",
    givens: cleanList(record.givens, 10, 320),
    goal:
      cleanText(record.goal, 500) ||
      "Reach and verify the requested result.",
    assumptions: cleanList(
      record.assumptions,
      8,
      320,
    ),
    steps,
    finalAnswer,
    finalCheck:
      cleanText(record.finalCheck, 900) ||
      "Check that the result answers the original question and is consistent with the given information.",
  };
}

function containsStandaloneAnswer(text: string, answer: string) {
  const candidate = answer.trim();
  if (!candidate) return false;

  const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const normalizedCandidate = normalizeComparable(candidate);
  const normalizedText = text.normalize("NFKC").toLowerCase();

  if (["true", "false", "yes", "no"].includes(normalizedCandidate)) {
    const opposite = {
      true: "false",
      false: "true",
      yes: "no",
      no: "yes",
    }[normalizedCandidate];
    const disclosureText = opposite
      ? normalizedText
          .replaceAll(`${normalizedCandidate} or ${opposite}`, "")
          .replaceAll(`${opposite} or ${normalizedCandidate}`, "")
          .replaceAll(`${normalizedCandidate}/${opposite}`, "")
          .replaceAll(`${opposite}/${normalizedCandidate}`, "")
      : normalizedText;

    return new RegExp(
      `(?:` +
        `(?:answer|result|statement|claim|conclusion|choice|option|it|this)\\s*(?:is|=|:)\\s*${escaped}(?:$|[^\\p{L}\\p{N}])` +
        `|(?:choose|select)\\s+${escaped}(?:$|[^\\p{L}\\p{N}])` +
        `|${escaped}\\s+(?:is\\s+)?(?:correct|right)(?:$|[^\\p{L}\\p{N}])` +
      `)`,
      "iu",
    ).test(disclosureText);
  }

  const compactCandidate = normalizeComparable(candidate).replace(
    /[^\p{L}\p{N}]+/gu,
    "",
  );
  if (compactCandidate.length === 1) {
    if (/^[a-d]$/i.test(compactCandidate)) {
      return new RegExp(
        `(?:` +
          `(?:answer|result)\\s*(?:is|=|:)\\s*${escaped}(?:$|[^\\p{L}\\p{N}])` +
          `|(?:choice|option)\\s*${escaped}\\s*(?:is\\s*)?(?:correct|right)` +
          `|(?:choose|select)\\s*${escaped}(?!\\s*(?:,|\\bor\\b|/)\\s*[a-d])(?:$|[^\\p{L}\\p{N}])` +
        `)`,
        "iu",
      ).test(text);
    }

    return new RegExp(
      `(?:answer|result|equals?|=|therefore|thus)\\s*(?:is\\s*)?${escaped}(?:$|[^\\p{L}\\p{N}])`,
      "iu",
    ).test(text);
  }

  const needsBoundary = /^[\p{L}\p{N}_.+-]+$/u.test(candidate);
  const pattern = needsBoundary
    ? new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, "iu")
    : new RegExp(escaped, "iu");

  if (pattern.test(text)) return true;

  const compactAnswer = normalizeComparable(candidate).replace(
    /[^\p{L}\p{N}]+/gu,
    "",
  );
  const compactText = normalizeComparable(text).replace(
    /[^\p{L}\p{N}]+/gu,
    "",
  );
  if (
    compactAnswer.length >= 3 &&
    compactText.includes(compactAnswer)
  ) {
    return true;
  }

  const answerNumber = parseSingleComparableNumber(candidate);
  if (answerNumber === null) return false;

  const numericTokens = Array.from(
    text.matchAll(
      /[-+]?\d*\.?\d+(?:e[-+]?\d+)?(?:\s*\/\s*[-+]?\d*\.?\d+(?:e[-+]?\d+)?)?%?/gi,
    ),
  );
  return numericTokens.some((match) => {
    const token = match[0];
    const tokenNumber = parseSingleComparableNumber(token);
    if (tokenNumber === null) return false;
    const tolerance = Math.max(1e-9, Math.abs(answerNumber) * 1e-7);
    if (Math.abs(tokenNumber - answerNumber) > tolerance) return false;

    const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const trimmed = text.trim();
    if (trimmed === token) return true;

    return new RegExp(
      `(?:answer|result|value|equals?|is|gives?|becomes?|therefore|thus|use|choose|select|correct|=)\\s*(?:is\\s*)?${escapedToken}(?:$|[^\\p{L}\\p{N}])`,
      "iu",
    ).test(text);
  });
}

export function assertPublicSolvePlanDoesNotLeak(plan: SolvePlan) {
  for (let index = 0; index < plan.steps.length; index += 1) {
    const step = plan.steps[index];
    const publicFields = [
      step.learnerPrompt,
      step.concept,
      ...step.hints,
    ];
    const stillPrivateAnswers = Array.from(
      new Set([
        plan.finalAnswer,
        ...plan.steps.slice(index).flatMap((privateStep) => [
          privateStep.expectedAnswer,
          ...privateStep.verification.acceptedAnswers,
        ]),
      ]),
    ).filter((answer) => normalizeComparable(answer).length > 0);

    const leaksBeforeStepCompletion = publicFields.some((field) =>
      stillPrivateAnswers.some((answer) =>
        containsStandaloneAnswer(field, answer),
      ),
    );
    const answersPrivateAfterThisStep = Array.from(
      new Set([
        plan.finalAnswer,
        ...plan.steps.slice(index + 1).flatMap((privateStep) => [
          privateStep.expectedAnswer,
          ...privateStep.verification.acceptedAnswers,
        ]),
      ]),
    ).filter((answer) => normalizeComparable(answer).length > 0);
    const leaksAfterStepCompletion = answersPrivateAfterThisStep.some(
      (answer) =>
        containsStandaloneAnswer(
          step.explanationAfterSuccess,
          answer,
        ),
    );

    if (leaksBeforeStepCompletion || leaksAfterStepCompletion) {
      throw new Error(
        "The tutor tried to reveal a private answer too early. Please retry the problem.",
      );
    }
  }
}

export function answersDeterministicallyAgree(
  proposed: string,
  canonical: string,
) {
  const normalizedProposed = normalizeComparable(proposed);
  const normalizedCanonical = normalizeComparable(canonical);
  if (!normalizedProposed || !normalizedCanonical) return false;
  if (normalizedProposed === normalizedCanonical) return true;

  const proposedTokens = proposed
    .replaceAll(",", "")
    .match(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?(?:\s*\/\s*[-+]?\d*\.?\d+(?:e[-+]?\d+)?)?/gi);
  const canonicalTokens = canonical
    .replaceAll(",", "")
    .match(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?(?:\s*\/\s*[-+]?\d*\.?\d+(?:e[-+]?\d+)?)?/gi);
  if (proposedTokens?.length !== 1 || canonicalTokens?.length !== 1) {
    return false;
  }

  const proposedNumber = parseConstrainedNumber(proposed);
  const canonicalNumber = parseConstrainedNumber(canonical);
  if (proposedNumber === null || canonicalNumber === null) return false;

  const tolerance = Math.max(
    1e-9,
    Math.abs(canonicalNumber) * 1e-6,
  );
  return Math.abs(proposedNumber - canonicalNumber) <= tolerance;
}

export function parseSingleComparableNumber(value: string) {
  const tokens = value
    .replaceAll(",", "")
    .match(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?(?:\s*\/\s*[-+]?\d*\.?\d+(?:e[-+]?\d+)?)?%?/gi);
  if (!tokens || tokens.length !== 1) return null;

  const token = tokens[0];
  const percent = token.endsWith("%");
  const parsed = parseConstrainedNumber(
    percent ? token.slice(0, -1) : token,
  );
  if (parsed === null) return null;
  return percent ? parsed / 100 : parsed;
}

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "The private solver store is not configured on the server.",
    );
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export async function loadOwnedSolveSession({
  supabase,
  userId,
  sessionId,
}: {
  supabase: SupabaseClient;
  userId: string;
  sessionId: string;
}) {
  const { data, error } = await supabase
    .from("solve_sessions")
    .select(SOLVE_SESSION_SELECT)
    .eq("id", sessionId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;

  return (data as SolveSessionRow | null) ?? null;
}

export async function loadPrivateSolvePlan({
  sessionId,
  userId,
}: {
  sessionId: string;
  userId: string;
}) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("solve_solution_keys")
    .select("plan, final_answer, verification, model")
    .eq("session_id", sessionId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    throw new Error(
      "The private solution plan could not be found.",
    );
  }

  const plan = normalizeSolvePlan(data.plan);

  if (
    typeof data.final_answer === "string" &&
    data.final_answer.trim()
  ) {
    plan.finalAnswer = data.final_answer.trim();
  }

  const rawVerification =
    data.verification &&
    typeof data.verification === "object" &&
    !Array.isArray(data.verification)
      ? (data.verification as Record<string, unknown>)
      : {};
  const rawCurrentStep = Number(
    rawVerification.currentStep ?? 0,
  );
  const rawHintCount = Number(
    rawVerification.hintCount ?? 0,
  );

  const verification: SolvePrivateVerification = {
    currentStep: Number.isFinite(rawCurrentStep)
      ? Math.max(
          0,
          Math.min(plan.steps.length, Math.round(rawCurrentStep)),
        )
      : 0,
    hintCount: Number.isFinite(rawHintCount)
      ? Math.max(0, Math.round(rawHintCount))
      : 0,
    completedAt:
      typeof rawVerification.completedAt === "string"
        ? rawVerification.completedAt
        : null,
    answerRevealedAt:
      typeof rawVerification.answerRevealedAt === "string"
        ? rawVerification.answerRevealedAt
        : null,
    stepCount: plan.steps.length,
    finalCheck:
      typeof rawVerification.finalCheck === "string"
        ? rawVerification.finalCheck
        : plan.finalCheck,
  };

  return {
    plan,
    verification,
    model:
      typeof data.model === "string"
        ? data.model
        : "",
  };
}

export function publicSolveState(
  session: SolveSessionRow,
  plan: SolvePlan,
  privateVerification?: SolvePrivateVerification,
): PublicSolveState {
  const currentStepIndex = Math.max(
    0,
    Math.min(
      plan.steps.length,
      privateVerification?.currentStep ??
        Number(session.current_step ?? 0),
    ),
  );
  const completed =
    Boolean(privateVerification?.completedAt) ||
    (!privateVerification && session.status === "completed") ||
    currentStepIndex >= plan.steps.length;
  const revealed = Boolean(
    privateVerification
      ? privateVerification.answerRevealedAt
      : session.answer_revealed_at,
  );
  const mayShowAnswer = completed || revealed;

  return {
    id: session.id,
    courseId: session.course_id,
    unitId: session.unit_id,
    topicId: session.topic_id,
    originKind: session.origin_kind,
    prompt: session.prompt,
    problemSummary: plan.problemSummary,
    subject: session.subject || plan.subject,
    givens: plan.givens,
    goal: plan.goal,
    assumptions: plan.assumptions,
    status: completed ? "completed" : session.status,
    currentStepIndex,
    stepCount: plan.steps.length,
    hintCount:
      privateVerification?.hintCount ??
      Number(session.hint_count ?? 0),
    progressPercent: Math.round(
      (currentStepIndex /
        Math.max(1, plan.steps.length)) *
        100,
    ),
    currentStep:
      completed || !plan.steps[currentStepIndex]
        ? null
        : {
            index: currentStepIndex,
            title: plan.steps[currentStepIndex].title,
            learnerPrompt:
              plan.steps[currentStepIndex].learnerPrompt,
            concept:
              plan.steps[currentStepIndex].concept,
          },
    completedSteps: plan.steps
      .slice(0, currentStepIndex)
      .map((step, index) => ({
        index,
        title: step.title,
        explanation: step.explanationAfterSuccess,
      })),
    answer: mayShowAnswer
      ? {
          finalAnswer: plan.finalAnswer,
          finalCheck: plan.finalCheck,
          steps: plan.steps.map((step, index) => ({
            index,
            title: step.title,
            explanation: step.explanationAfterSuccess,
          })),
        }
      : null,
  };
}

export function normalizeComparable(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[−–—]/g, "-")
    .replace(/[×·]/g, "*")
    .replace(/\s+/g, "")
    .replace(/[.,;:!?]+$/g, "");
}

export function parseConstrainedNumber(value: string) {
  const normalized = value.replaceAll(",", "").trim();
  const fractionMatches = Array.from(
    normalized.matchAll(
      /([-+]?\d*\.?\d+(?:e[-+]?\d+)?)\s*\/\s*([-+]?\d*\.?\d+(?:e[-+]?\d+)?)/gi,
    ),
  );
  const fraction = fractionMatches.at(-1);

  if (fraction) {
    const numerator = Number(fraction[1]);
    const denominator = Number(fraction[2]);
    if (
      Number.isFinite(numerator) &&
      Number.isFinite(denominator) &&
      denominator !== 0
    ) {
      return numerator / denominator;
    }
  }

  const matches = Array.from(
    normalized.matchAll(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?/gi),
  );
  const match = matches.at(-1)?.[0];
  if (!match) return null;

  const parsed = Number(match);
  return Number.isFinite(parsed) ? parsed : null;
}

export function firstFiniteNumber(value: string) {
  return parseConstrainedNumber(value);
}
