export type StudyEvidence = {
  score: number;
  answered_at: string;
};

export type PreparednessState =
  | "unseen"
  | "starting"
  | "building"
  | "strong"
  | "prepared";

export type PreparednessResult = {
  preparedness: number;
  accuracy: number;
  answeredCount: number;
  effectiveCount: number;
  confidence: number;
  trend: number;
  state: PreparednessState;
  curve: number[];
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function ageDays(value: string, now: number) {
  const timestamp = new Date(value).getTime();

  if (!Number.isFinite(timestamp)) return 0;

  return Math.max(
    0,
    (now - timestamp) / (1000 * 60 * 60 * 24),
  );
}

function stateForScore(
  score: number,
  answeredCount: number,
): PreparednessState {
  if (answeredCount === 0) return "unseen";
  if (score < 35) return "starting";
  if (score < 55) return "building";
  if (score < 75) return "strong";
  return "prepared";
}

function average(values: number[]) {
  if (values.length === 0) return 0;

  return (
    values.reduce(
      (sum, value) => sum + value,
      0,
    ) / values.length
  );
}

export function calculatePreparedness(
  evidence: StudyEvidence[],
  now = Date.now(),
): PreparednessResult {
  const clean = evidence
    .map((item) => ({
      score: clamp(Number(item.score) || 0, 0, 1),
      answered_at: item.answered_at,
    }))
    .filter((item) => item.answered_at)
    .sort(
      (a, b) =>
        new Date(a.answered_at).getTime() -
        new Date(b.answered_at).getTime(),
    );

  if (clean.length === 0) {
    return {
      preparedness: 0,
      accuracy: 0,
      answeredCount: 0,
      effectiveCount: 0,
      confidence: 0,
      trend: 0,
      state: "unseen",
      curve: [],
    };
  }

  let weightedScore = 0;
  let totalWeight = 0;

  for (const item of clean) {
    const days = ageDays(item.answered_at, now);

    // 21-day half-life. Old reps still count,
    // but recent performance matters more.
    const recencyWeight = Math.pow(
      0.5,
      days / 21,
    );

    weightedScore += item.score * recencyWeight;
    totalWeight += recencyWeight;
  }

  const weightedAccuracy =
    totalWeight > 0
      ? weightedScore / totalWeight
      : 0;

  // Confidence grows with meaningful repetitions.
  // One lucky question cannot create "100% prepared".
  const confidence =
    1 - Math.exp(-totalWeight / 4);

  const lastFour = clean
    .slice(-4)
    .map((item) => item.score);

  const previousFour = clean
    .slice(-8, -4)
    .map((item) => item.score);

  let rawTrend = 0;

  if (previousFour.length >= 2) {
    rawTrend =
      average(lastFour) -
      average(previousFour);
  } else if (clean.length >= 3) {
    const recent = clean
      .slice(-2)
      .map((item) => item.score);
    const earlier = clean
      .slice(0, -2)
      .map((item) => item.score);

    rawTrend =
      average(recent) -
      average(earlier);
  }

  // Trend can move preparedness by at most 8 points.
  const trendAdjustment = clamp(
    rawTrend * 12,
    -8,
    8,
  );

  // Preparedness blends performance with repetition.
  // Repetition is intentionally required for high scores.
  const evidenceBase =
    weightedAccuracy *
      100 *
      confidence +
    20 * confidence;

  const preparedness = Math.round(
    clamp(
      evidenceBase + trendAdjustment,
      0,
      100,
    ),
  );

  // Sparkline curve uses an EWMA so improvement shows visibly.
  const curve: number[] = [];
  let running = 0;

  clean.slice(-12).forEach((item, index) => {
    const alpha = 0.38;
    running =
      index === 0
        ? item.score * 100
        : alpha * item.score * 100 +
          (1 - alpha) * running;

    const reps = index + 1;
    const localConfidence =
      1 - Math.exp(-reps / 3.5);

    curve.push(
      Math.round(
        clamp(
          running * localConfidence +
            12 * localConfidence,
          0,
          100,
        ),
      ),
    );
  });

  return {
    preparedness,
    accuracy: Math.round(
      weightedAccuracy * 100,
    ),
    answeredCount: clean.length,
    effectiveCount: Number(
      totalWeight.toFixed(2),
    ),
    confidence: Number(
      confidence.toFixed(3),
    ),
    trend: Math.round(rawTrend * 100),
    state: stateForScore(
      preparedness,
      clean.length,
    ),
    curve,
  };
}

export function aggregatePreparedness(
  results: PreparednessResult[],
) {
  if (results.length === 0) {
    return {
      preparedness: 0,
      answeredCount: 0,
      trend: 0,
    };
  }

  const preparedness = Math.round(
    average(
      results.map(
        (result) => result.preparedness,
      ),
    ),
  );

  const answeredCount =
    results.reduce(
      (sum, result) =>
        sum + result.answeredCount,
      0,
    );

  const trended = results.filter(
    (result) =>
      result.answeredCount >= 3,
  );

  const trend =
    trended.length > 0
      ? Math.round(
          average(
            trended.map(
              (result) => result.trend,
            ),
          ),
        )
      : 0;

  return {
    preparedness,
    answeredCount,
    trend,
  };
}

export function preparednessLabel(
  result: PreparednessResult,
) {
  if (result.answeredCount === 0) {
    return "Unseen";
  }

  if (result.preparedness < 35) {
    return "Needs reps";
  }

  if (result.preparedness < 55) {
    return "Developing";
  }

  if (result.preparedness < 75) {
    return "Solid";
  }

  if (result.preparedness < 90) {
    return "Ready";
  }

  return "Locked in";
}

export function studyNeedScore(
  result: PreparednessResult,
) {
  const missingPreparation =
    100 - result.preparedness;

  const lowEvidence =
    (1 - result.confidence) * 28;

  const recentDip =
    result.trend < 0
      ? Math.min(18, Math.abs(result.trend) * 0.55)
      : 0;

  const unseenBoost =
    result.answeredCount === 0
      ? 18
      : 0;

  return (
    missingPreparation +
    lowEvidence +
    recentDip +
    unseenBoost
  );
}

export function weaknessReason(
  result: PreparednessResult,
) {
  if (result.answeredCount === 0) {
    return "No practice data yet";
  }

  if (result.trend <= -15) {
    return "Recent performance is slipping";
  }

  if (result.accuracy < 55) {
    return "Low recent accuracy";
  }

  if (result.answeredCount < 5) {
    return "Needs more repetitions";
  }

  if (result.preparedness < 75) {
    return "Still building consistency";
  }

  return "Good, but still has room to sharpen";
}