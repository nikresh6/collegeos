import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  groq,
  GROQ_MODELS,
} from "../../../../lib/ai/groq";
import {
  calculatePreparedness,
} from "../../../../lib/study-mastery";

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

function normalizeAnswer(value: string) {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function stateForPreparedness(score: number) {
  if (score < 35) return "starting";
  if (score < 55) return "building";
  if (score < 75) return "strong";
  return "prepared";
}

async function gradeShortAnswer({
  prompt,
  studentAnswer,
  referenceAnswer,
  explanation,
}: {
  prompt: string;
  studentAnswer: string;
  referenceAnswer: string;
  explanation: string;
}) {
  const completion =
    await groq.chat.completions.create({
      model:
        GROQ_MODELS.lectureChunk,
      messages: [
        {
          role: "system",
          content: `You grade one college short-answer practice response.

RULES:
1. Grade only against the supplied reference answer and explanation.
2. Do not require identical wording.
3. Give full credit when the student's answer captures the essential idea.
4. Partial credit is allowed.
5. Do not introduce outside facts.
6. Score must be between 0 and 1.

Return ONLY valid JSON:
{
  "score": number,
  "feedback": string
}`,
        },
        {
          role: "user",
          content: `QUESTION:
${prompt}

STUDENT ANSWER:
${studentAnswer}

REFERENCE ANSWER:
${referenceAnswer}

SOURCE-GROUNDED EXPLANATION:
${explanation}`,
        },
      ],
      response_format: {
        type: "json_object",
      },
      reasoning_effort: "low",
      include_reasoning: false,
      temperature: 0.02,
      max_completion_tokens: 220,
    });

  const content =
    completion.choices[0]?.message?.content;

  if (!content) {
    throw new Error(
      "The short-answer grader returned an empty response.",
    );
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(
      "The short-answer grader returned invalid JSON.",
    );
  }

  const value =
    parsed &&
    typeof parsed === "object" &&
    !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};

  const rawScore = Number(value.score);
  const score = Number.isFinite(rawScore)
    ? Math.max(0, Math.min(1, rawScore))
    : 0;

  const feedback =
    typeof value.feedback === "string"
      ? value.feedback.trim()
      : "";

  return {
    score,
    feedback,
  };
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
      questionId?: string;
      answer?: string;
      responseTimeMs?: number;
    };

    const questionId =
      body.questionId?.trim() ?? "";
    const answer =
      body.answer?.trim() ?? "";

    if (!questionId) {
      return NextResponse.json(
        {
          ok: false,
          error: "questionId is required.",
        },
        { status: 400 },
      );
    }

    const {
      data: question,
      error: questionError,
    } = await supabase
      .from("study_questions")
      .select(
        "id, session_id, course_id, topic_id, question_type, prompt, correct_answer, explanation",
      )
      .eq("id", questionId)
      .single();

    if (questionError) throw questionError;

    let score = 0;
    let feedback = "";

    if (
      question.question_type ===
      "short_answer"
    ) {
      if (!answer) {
        score = 0;
        feedback =
          "No answer was submitted.";
      } else {
        const graded =
          await gradeShortAnswer({
            prompt: question.prompt,
            studentAnswer: answer,
            referenceAnswer:
              question.correct_answer,
            explanation:
              question.explanation,
          });

        score = graded.score;
        feedback =
          graded.feedback;
      }
    } else {
      const correct =
        normalizeAnswer(answer) ===
        normalizeAnswer(
          question.correct_answer,
        );

      score = correct ? 1 : 0;
      feedback = correct
        ? "Correct."
        : question.explanation ||
          `The correct answer is ${question.correct_answer}.`;
    }

    const isCorrect = score >= 0.85;

    const responseTimeMs =
      Number.isFinite(
        Number(body.responseTimeMs),
      )
        ? Math.max(
            0,
            Math.round(
              Number(body.responseTimeMs),
            ),
          )
        : null;

    const {
      error: responseError,
    } = await supabase
      .from("study_responses")
      .upsert(
        {
          session_id:
            question.session_id,
          question_id:
            question.id,
          user_id: user.id,
          course_id:
            question.course_id,
          topic_id:
            question.topic_id,
          question_type:
            question.question_type,
          answer_text: answer,
          score,
          is_correct: isCorrect,
          feedback,
          response_time_ms:
            responseTimeMs,
          answered_at:
            new Date().toISOString(),
        },
        {
          onConflict: "question_id",
        },
      );

    if (responseError) {
      throw responseError;
    }

    let preparedness = null;

    if (question.topic_id) {
      const {
        data: evidence,
        error: evidenceError,
      } = await supabase
        .from("study_responses")
        .select("score, answered_at")
        .eq("course_id", question.course_id)
        .eq("topic_id", question.topic_id)
        .order("answered_at", {
          ascending: true,
        });

      if (evidenceError) {
        throw evidenceError;
      }

      preparedness =
        calculatePreparedness(
          (evidence ?? []).map(
            (item) => ({
              score: Number(
                item.score ?? 0,
              ),
              answered_at:
                item.answered_at,
            }),
          ),
        );

      const {
        error: masteryError,
      } = await supabase
        .from("course_topics")
        .update({
          mastery_score:
            preparedness.preparedness,
          mastery_state:
            stateForPreparedness(
              preparedness.preparedness,
            ),
        })
        .eq("id", question.topic_id);

      if (masteryError) {
        console.warn(
          "Could not sync topic mastery:",
          masteryError,
        );
      }
    }

    const [
      {
        count: totalQuestions,
        error: totalError,
      },
      {
        data: sessionResponses,
        error: sessionResponsesError,
      },
    ] = await Promise.all([
      supabase
        .from("study_questions")
        .select("id", {
          count: "exact",
          head: true,
        })
        .eq(
          "session_id",
          question.session_id,
        ),
      supabase
        .from("study_responses")
        .select("score")
        .eq(
          "session_id",
          question.session_id,
        ),
    ]);

    if (totalError) throw totalError;
    if (sessionResponsesError) {
      throw sessionResponsesError;
    }

    const answeredCount =
      sessionResponses?.length ?? 0;

    const scorePercent =
      answeredCount > 0
        ? ((sessionResponses ?? []).reduce(
            (sum, item) =>
              sum +
              Number(item.score ?? 0),
            0,
          ) /
            answeredCount) *
          100
        : 0;

    const complete =
      Boolean(totalQuestions) &&
      answeredCount >=
        Number(totalQuestions);

    const {
      error: sessionError,
    } = await supabase
      .from("study_sessions")
      .update({
        status: complete
          ? "completed"
          : "in_progress",
        answered_count:
          answeredCount,
        score_percent:
          Number(
            scorePercent.toFixed(2),
          ),
        started_at:
          new Date().toISOString(),
        completed_at: complete
          ? new Date().toISOString()
          : null,
      })
      .eq("id", question.session_id);

    if (sessionError) throw sessionError;

    return NextResponse.json({
      ok: true,
      score,
      isCorrect,
      feedback,
      correctAnswer:
        question.correct_answer,
      explanation:
        question.explanation,
      preparedness,
      session: {
        answeredCount,
        totalQuestions:
          Number(totalQuestions ?? 0),
        scorePercent:
          Math.round(scorePercent),
        complete,
      },
    });
  } catch (error) {
    console.error(
      "Study answer grading failed:",
      error,
    );

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not grade the answer.",
      },
      { status: 500 },
    );
  }
}