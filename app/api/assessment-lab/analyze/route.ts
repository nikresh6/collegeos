import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generateStructured, groq } from "../../../../lib/ai/groq";
import { extractMaterialText, sampleMaterialText } from "../../../../lib/material-text";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Question = {
  prompt: string;
  choices: string[];
  correctAnswer: string;
  questionType: "multiple_choice" | "true_false" | "short_answer" | "essay" | "problem";
  topicHints: string[];
  professorNotes: string;
};

type AssessmentAnalysis = {
  summary: string;
  testedSkills: string[];
  questionStyle: string[];
  difficultySignature: string;
  trapPatterns: string[];
  professorLanguage: string[];
  studyRecommendations: string[];
  questions: Question[];
};

const analysisSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    testedSkills: { type: "array", items: { type: "string" } },
    questionStyle: { type: "array", items: { type: "string" } },
    difficultySignature: { type: "string" },
    trapPatterns: { type: "array", items: { type: "string" } },
    professorLanguage: { type: "array", items: { type: "string" } },
    studyRecommendations: { type: "array", items: { type: "string" } },
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          prompt: { type: "string" },
          choices: { type: "array", items: { type: "string" } },
          correctAnswer: { type: "string" },
          questionType: {
            type: "string",
            enum: ["multiple_choice", "true_false", "short_answer", "essay", "problem"],
          },
          topicHints: { type: "array", items: { type: "string" } },
          professorNotes: { type: "string" },
        },
        required: ["prompt", "choices", "correctAnswer", "questionType", "topicHints", "professorNotes"],
      },
    },
  },
  required: ["summary", "testedSkills", "questionStyle", "difficultySignature", "trapPatterns", "professorLanguage", "studyRecommendations", "questions"],
};

const system = `You analyze real college assessments so future practice matches what the professor actually tests.

Use only the supplied source. Extract every legible question you can find. Do not solve a question unless an answer is visible in the source. An empty correctAnswer means unknown. Identify patterns only when supported by the source: question forms, verbs, recurring traps, amount of application versus recall, and professor-specific wording. Never invent course facts. Keep each observation concise. Return only the requested JSON.`;

function bearerToken(request: Request) {
  const value = request.headers.get("authorization") ?? "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}

function userClient(token: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase public environment variables are missing.");
  return createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function safeName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").slice(-120) || "source";
}

function normalize(value: unknown): AssessmentAnalysis {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const strings = (entry: unknown) => Array.isArray(entry)
    ? entry.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean).slice(0, 18)
    : [];
  const questions = Array.isArray(record.questions) ? record.questions : [];
  return {
    summary: typeof record.summary === "string" ? record.summary.trim() : "Assessment source analyzed.",
    testedSkills: strings(record.testedSkills),
    questionStyle: strings(record.questionStyle),
    difficultySignature: typeof record.difficultySignature === "string" ? record.difficultySignature.trim() : "",
    trapPatterns: strings(record.trapPatterns),
    professorLanguage: strings(record.professorLanguage),
    studyRecommendations: strings(record.studyRecommendations),
    questions: questions.map((entry) => {
      const question = entry && typeof entry === "object" && !Array.isArray(entry)
        ? entry as Record<string, unknown>
        : {};
      const type = typeof question.questionType === "string" && ["multiple_choice", "true_false", "short_answer", "essay", "problem"].includes(question.questionType)
        ? question.questionType as Question["questionType"]
        : "short_answer";
      return {
        prompt: typeof question.prompt === "string" ? question.prompt.trim() : "",
        choices: strings(question.choices).slice(0, 8),
        correctAnswer: typeof question.correctAnswer === "string" ? question.correctAnswer.trim() : "",
        questionType: type,
        topicHints: strings(question.topicHints).slice(0, 8),
        professorNotes: typeof question.professorNotes === "string" ? question.professorNotes.trim() : "",
      };
    }).filter((question) => question.prompt).slice(0, 80),
  };
}

async function analyzeImage(file: File) {
  const encoded = Buffer.from(await file.arrayBuffer()).toString("base64");
  const completion = await groq.chat.completions.create({
    model: process.env.GROQ_VISION_MODEL || "meta-llama/llama-4-scout-17b-16e-instruct",
    messages: [{
      role: "user",
      content: [
        { type: "text", text: `${system}\n\nReturn a JSON object with keys summary, testedSkills, questionStyle, difficultySignature, trapPatterns, professorLanguage, studyRecommendations, and questions. Each question has prompt, choices, correctAnswer, questionType, topicHints, and professorNotes.` },
        { type: "image_url", image_url: { url: `data:${file.type || "image/jpeg"};base64,${encoded}` } },
      ],
    }],
    response_format: { type: "json_object" },
    temperature: 0.05,
    max_completion_tokens: 3500,
  });
  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error("The image analysis returned no result.");
  return normalize(JSON.parse(content));
}

export async function POST(request: Request) {
  const token = bearerToken(request);
  if (!token) return NextResponse.json({ ok: false, error: "You are not signed in." }, { status: 401 });

  try {
    const supabase = userClient(token);
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ ok: false, error: "You are not signed in." }, { status: 401 });

    const form = await request.formData();
    const file = form.get("file");
    const courseId = String(form.get("courseId") ?? "");
    const title = String(form.get("title") ?? "").trim();
    const sourceType = String(form.get("sourceType") ?? "past_exam");
    if (!(file instanceof File) || !courseId || !title) {
      return NextResponse.json({ ok: false, error: "Course, title, and source file are required." }, { status: 400 });
    }
    if (file.size > 20 * 1024 * 1024) {
      return NextResponse.json({ ok: false, error: "Keep assessment sources under 20 MB." }, { status: 413 });
    }
    const { data: course } = await supabase.from("courses").select("id").eq("id", courseId).eq("user_id", user.id).maybeSingle();
    if (!course) return NextResponse.json({ ok: false, error: "Course not found." }, { status: 404 });

    let extractedText = "";
    let analysis: AssessmentAnalysis;
    if (file.type.startsWith("image/")) {
      analysis = await analyzeImage(file);
    } else {
      const extracted = await extractMaterialText(file);
      extractedText = sampleMaterialText(extracted.text, 26000);
      if (extractedText.replace(/\s/g, "").length < 50) throw new Error("This file contains too little readable text. Try a clearer photo.");
      analysis = normalize(await generateStructured<AssessmentAnalysis>({
        system,
        user: `SOURCE TYPE: ${sourceType}\nFILE: ${file.name}\n\nSOURCE TEXT:\n${extractedText}`,
        schemaName: "assessment_evidence_analysis",
        schema: analysisSchema,
        temperature: 0.05,
        maxTokens: 3800,
      }));
    }

    const storagePath = `${user.id}/${courseId}/assessment/${crypto.randomUUID()}-${safeName(file.name)}`;
    const { error: uploadError } = await supabase.storage.from("course-files").upload(storagePath, file, { contentType: file.type || undefined, upsert: false });
    if (uploadError) throw uploadError;

    const { data: source, error: sourceError } = await supabase.from("assessment_sources").insert({
      user_id: user.id,
      course_id: courseId,
      title,
      source_type: sourceType,
      file_name: file.name,
      storage_path: storagePath,
      mime_type: file.type || null,
      extracted_text: extractedText,
      analysis,
      question_count: analysis.questions.length,
      status: "ready",
    }).select("id, course_id, title, source_type, file_name, status, question_count, analysis, created_at").single();
    if (sourceError) {
      await supabase.storage.from("course-files").remove([storagePath]);
      throw sourceError;
    }

    if (analysis.questions.length) {
      const { error: questionsError } = await supabase.from("assessment_source_questions").insert(
        analysis.questions.map((question, position) => ({
          source_id: source.id,
          user_id: user.id,
          course_id: courseId,
          prompt: question.prompt,
          choices: question.choices,
          correct_answer: question.correctAnswer || null,
          question_type: question.questionType,
          topic_hints: question.topicHints,
          professor_notes: question.professorNotes || null,
          position,
        })),
      );
      if (questionsError) throw questionsError;
    }

    return NextResponse.json({ ok: true, source });
  } catch (error) {
    console.error("Assessment source analysis failed:", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not analyze this source." }, { status: 500 });
  }
}
