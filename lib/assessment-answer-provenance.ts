export type ExtractedAnswerEvidence = {
  correctAnswer: string;
  answerIsVisible: boolean;
  answerEvidenceQuote: string;
  answerEvidencePage: string;
  answerEvidenceConfidence: number;
};

export type StoredAnswerProvenance = {
  correctAnswer: string | null;
  answerCandidate: string | null;
  answerIsVisible: boolean;
  answerIsVerified: boolean;
  answerVerificationMethod:
    | "none"
    | "model_unverified"
    | "source_text_match"
    | "user_confirmed";
  answerEvidenceQuote: string | null;
  answerEvidencePage: string | null;
  answerEvidenceConfidence: number | null;
};

function cleanText(value: unknown, max: number) {
  return typeof value === "string"
    ? value.replace(/\u0000/g, "").replace(/\s+/g, " ").trim().slice(0, max)
    : "";
}

function clampConfidence(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 0;
}

function normalizeForMatch(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function quoteSupportsAnswer(quote: string, answer: string) {
  const normalizedQuote = normalizeForMatch(quote);
  const normalizedAnswer = normalizeForMatch(answer);

  if (!normalizedQuote || !normalizedAnswer) return false;

  const escaped = normalizedAnswer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const answerTail = `${escaped}(?:$|[^\\p{L}\\p{N}])`;

  // The answer must follow an explicit key/solution assertion. Merely finding
  // the candidate somewhere in a question containing words like "correct
  // answer" is not provenance.
  const explicitAssertion = new RegExp(
    `(?:answer\\s+key|correct\\s+(?:answer|choice|option)|solution)\\s*(?:is\\s+|[:=-]\\s*)(?:\\d{1,3}[.)-]\\s*)?(?:choice|option)?\\s*${answerTail}`,
    "iu",
  );
  if (explicitAssertion.test(normalizedQuote)) return true;

  // Also support compact headed keys such as "ANSWER KEY 1. B".
  return new RegExp(
    `answer\\s+key\\s+(?:\\d{1,3}[.)-]\\s*)?(?:choice|option)?\\s*${answerTail}`,
    "iu",
  ).test(normalizedQuote);
}

/**
 * Promotes a model-extracted answer only when the server can independently
 * match the quoted answer-key evidence against the exact text sent to the
 * model. A non-empty model answer by itself is never verified.
 */
export function deriveUploadedAnswerProvenance({
  extracted,
  sourceText,
}: {
  extracted: ExtractedAnswerEvidence;
  sourceText: string;
}): StoredAnswerProvenance {
  const candidate = cleanText(extracted.correctAnswer, 1200);
  const quote = cleanText(extracted.answerEvidenceQuote, 1200);
  const page = cleanText(extracted.answerEvidencePage, 120);
  const confidence = clampConfidence(extracted.answerEvidenceConfidence);
  const normalizedSource = normalizeForMatch(sourceText);
  const normalizedQuote = normalizeForMatch(quote);

  const quoteMatchesSource =
    normalizedSource.length > 0 &&
    normalizedQuote.length >= 4 &&
    normalizedSource.includes(normalizedQuote);
  const verified =
    Boolean(candidate) &&
    extracted.answerIsVisible === true &&
    confidence >= 0.8 &&
    quoteMatchesSource &&
    quoteSupportsAnswer(quote, candidate);

  if (verified) {
    return {
      correctAnswer: candidate,
      answerCandidate: null,
      answerIsVisible: true,
      answerIsVerified: true,
      answerVerificationMethod: "source_text_match",
      answerEvidenceQuote: quote,
      answerEvidencePage: page || null,
      answerEvidenceConfidence: confidence,
    };
  }

  if (candidate) {
    return {
      correctAnswer: null,
      answerCandidate: candidate,
      answerIsVisible: false,
      answerIsVerified: false,
      answerVerificationMethod: "model_unverified",
      answerEvidenceQuote: quote || null,
      answerEvidencePage: page || null,
      answerEvidenceConfidence: confidence || null,
    };
  }

  return {
    correctAnswer: null,
    answerCandidate: null,
    answerIsVisible: false,
    answerIsVerified: false,
    answerVerificationMethod: "none",
    answerEvidenceQuote: null,
    answerEvidencePage: null,
    answerEvidenceConfidence: null,
  };
}

export function userConfirmedAnswerProvenance(
  value: string,
): StoredAnswerProvenance {
  const answer = cleanText(value, 1200);

  if (!answer) {
    return {
      correctAnswer: null,
      answerCandidate: null,
      answerIsVisible: false,
      answerIsVerified: false,
      answerVerificationMethod: "none",
      answerEvidenceQuote: null,
      answerEvidencePage: null,
      answerEvidenceConfidence: null,
    };
  }

  return {
    correctAnswer: answer,
    answerCandidate: null,
    answerIsVisible: false,
    answerIsVerified: true,
    answerVerificationMethod: "user_confirmed",
    answerEvidenceQuote: null,
    answerEvidencePage: null,
    answerEvidenceConfidence: 1,
  };
}
