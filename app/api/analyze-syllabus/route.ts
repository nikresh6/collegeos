import { NextResponse } from "next/server";
import { generateStructured } from "../../../lib/ai/groq";
import { extractPdfText } from "../../../lib/pdf";
import { userContext } from "../../../lib/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type SyllabusAnalysis = {
  courseInfo: {
    courseCode: string;
    courseName: string;
    professor: string;
    term: string;
    credits: number;
  };
  gradingCategories: Array<{
    name: string;
    weightPercent: number;
    notes: string;
  }>;
  gradingScale: Array<{
    letterGrade: string;
    minPercent: number;
    maxPercent: number;
    notes: string;
  }>;
  assessments: Array<{
    name: string;
    type: string;
    date: string;
    notes: string;
  }>;
  units: Array<{
    name: string;
    description: string;
    basisType: "explicit_unit" | "assessment_block";
    basis: string;
    assessmentName: string;
    coverage: string;
    topics: Array<{
      name: string;
      date: string;
      reading: string;
      assignment: string;
    }>;
  }>;
  unassignedTopics: Array<{
    name: string;
    date: string;
    reading: string;
    assignment: string;
  }>;
  importantDates: Array<{
    name: string;
    date: string;
    type: string;
  }>;
  policies: Array<{
    category: string;
    summary: string;
  }>;
  scheduleNotes: string[];
  warnings: string[];
  overallConfidence: number;
};

const topicSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string" },
    date: { type: "string" },
    reading: { type: "string" },
    assignment: { type: "string" },
  },
  required: ["name", "date", "reading", "assignment"],
};

const syllabusSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    courseInfo: {
      type: "object",
      additionalProperties: false,
      properties: {
        courseCode: { type: "string" },
        courseName: { type: "string" },
        professor: { type: "string" },
        term: { type: "string" },
        credits: { type: "number" },
      },
      required: [
        "courseCode",
        "courseName",
        "professor",
        "term",
        "credits",
      ],
    },
    gradingCategories: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          weightPercent: { type: "number" },
          notes: { type: "string" },
        },
        required: ["name", "weightPercent", "notes"],
      },
    },
    gradingScale: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          letterGrade: { type: "string" },
          minPercent: { type: "number" },
          maxPercent: { type: "number" },
          notes: { type: "string" },
        },
        required: [
          "letterGrade",
          "minPercent",
          "maxPercent",
          "notes",
        ],
      },
    },
    assessments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          type: { type: "string" },
          date: { type: "string" },
          notes: { type: "string" },
        },
        required: ["name", "type", "date", "notes"],
      },
    },
    units: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          basisType: {
            type: "string",
            enum: ["explicit_unit", "assessment_block"],
          },
          basis: { type: "string" },
          assessmentName: { type: "string" },
          coverage: { type: "string" },
          topics: {
            type: "array",
            items: topicSchema,
          },
        },
        required: [
          "name",
          "description",
          "basisType",
          "basis",
          "assessmentName",
          "coverage",
          "topics",
        ],
      },
    },
    unassignedTopics: {
      type: "array",
      items: topicSchema,
    },
    importantDates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          date: { type: "string" },
          type: { type: "string" },
        },
        required: ["name", "date", "type"],
      },
    },
    policies: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          category: { type: "string" },
          summary: { type: "string" },
        },
        required: ["category", "summary"],
      },
    },
    scheduleNotes: {
      type: "array",
      items: { type: "string" },
    },
    warnings: {
      type: "array",
      items: { type: "string" },
    },
    overallConfidence: {
      type: "number",
      minimum: 0,
      maximum: 100,
    },
  },
  required: [
    "courseInfo",
    "gradingCategories",
    "gradingScale",
    "assessments",
    "units",
    "unassignedTopics",
    "importantDates",
    "policies",
    "scheduleNotes",
    "warnings",
    "overallConfidence",
  ],
};

const systemPrompt = `You are the syllabus extraction engine for a college academic assistant.

Your job is faithful extraction, not interpretation or curriculum design.

STRICT RULES:
1. Use only information explicitly supported by the supplied syllabus text.
2. Never invent a topic, lecture, unit, date, reading, assignment, grade weight, professor, credit count, or policy.
3. Preserve explicit topic and lecture titles as written. Do not decompose one syllabus topic into smaller invented concepts.
4. If the syllabus explicitly defines Units, Modules, Sections, Blocks, or another course hierarchy, preserve that hierarchy and use basisType "explicit_unit".
5. If there is no explicit unit hierarchy, but exams or major assessments explicitly divide course material into ranges, you may create assessment-based study blocks such as "Exam 1 Material". Use basisType "assessment_block" and state the supporting evidence in basis/coverage.
6. If a topic is explicit but its grouping is uncertain, keep it in unassignedTopics. Never drop it merely because the correct unit is unclear.
7. Keep dates in the form used by the syllabus when possible. Do not guess a year.
8. If credits are not explicitly stated, set credits to 0.
9. If a field is not supported, use an empty string, 0, or an empty array as appropriate.
10. overallConfidence is 0-100 and should reflect extraction confidence, not how good the course is.
11. warnings should identify genuine ambiguities or missing information that the student should review.
12. Do not merge distinct explicit topics just because they are similar.
13. Do not duplicate the same explicit topic in both a unit and unassignedTopics.
14. Extract grading categories, the percentage-to-letter-grade scale, assessments, dates, policies, schedule notes, and course metadata when explicitly present.
15. gradingScale is ONLY for an explicitly stated course grading scale such as A = 93-100, A- = 90-92.99, B+ = 87-89.99, etc.
16. Never infer a standard grading scale. Different courses use different cutoffs.
17. For gradingScale, preserve every explicitly listed letter grade or grade label, including plus/minus grades when present.
18. Convert clearly stated percentage thresholds or ranges to minPercent and maxPercent. Examples: "A: 93-100" -> 93 and 100; "A: 93% and above" -> 93 and 100; "F: below 60%" -> 0 and 59.999 when the boundary is explicit.
19. If the syllabus states a letter grade but the numeric boundary is not clear, set minPercent and maxPercent to 0 and explain the wording in notes.
20. If no explicit percentage-to-letter-grade scale is present, return gradingScale as an empty array.
21. Your response must conform exactly to the supplied JSON schema.
22. Preserve every explicit scheduled topic even when there are many topics.
23. Be concise in notes, descriptions, policies, basis, and coverage fields. Do not repeat the same information in multiple prose fields.
24. For assessment-based units, description may be an empty string when the unit name, assessmentName, basis, and coverage already make the grouping clear.
25. Do not spend output space explaining your reasoning. Return only the structured extraction.`;

function isGroqRateLimitError(message: string) {
  const lower = message.toLowerCase();

  return (
    lower.includes("rate limit") ||
    lower.includes("rate_limit") ||
    lower.includes("429") ||
    lower.includes("tokens per") ||
    lower.includes("requests per")
  );
}

function isGroqAuthError(message: string) {
  const lower = message.toLowerCase();

  return (
    lower.includes("api key") ||
    lower.includes("unauthorized") ||
    lower.includes("authentication") ||
    lower.includes("401")
  );
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();

  try {
    const context = await userContext(request);
    if (!context) {
      return NextResponse.json(
        { ok: false, error: "You are not signed in." },
        { status: 401 },
      );
    }

    const contentType = request.headers.get("content-type") ?? "";
    let candidate: File | null = null;
    let courseId = "";
    let courseFileId = "";

    if (contentType.includes("application/json")) {
      const body = (await request.json()) as {
        courseId?: unknown;
        courseFileId?: unknown;
      };
      courseId = typeof body.courseId === "string" ? body.courseId : "";
      courseFileId =
        typeof body.courseFileId === "string" ? body.courseFileId : "";
    } else {
      const formData = await request.formData();
      const uploaded = formData.get("file");
      candidate = uploaded instanceof File ? uploaded : null;
      const rawCourseId = formData.get("courseId");
      courseId = typeof rawCourseId === "string" ? rawCourseId : "";
    }

    if (!courseId) {
      return NextResponse.json(
        { ok: false, error: "A course is required." },
        { status: 400 },
      );
    }

    const { data: course, error: courseError } = await context.supabase
      .from("courses")
      .select("id")
      .eq("id", courseId)
      .eq("user_id", context.user.id)
      .maybeSingle();

    if (courseError) throw courseError;
    if (!course) {
      return NextResponse.json(
        { ok: false, error: "Course not found." },
        { status: 404 },
      );
    }

    if (courseFileId) {
      const { data: storedFile, error: storedFileError } =
        await context.supabase
          .from("course_files")
          .select("id, file_name, storage_path, mime_type, size_bytes")
          .eq("id", courseFileId)
          .eq("course_id", courseId)
          .eq("user_id", context.user.id)
          .eq("material_type", "syllabus")
          .maybeSingle();

      if (storedFileError) throw storedFileError;
      if (!storedFile) {
        return NextResponse.json(
          { ok: false, requestId, error: "Syllabus file not found." },
          { status: 404 },
        );
      }

      const { data: storedBlob, error: downloadError } =
        await context.supabase.storage
          .from("course-files")
          .download(storedFile.storage_path);

      if (downloadError || !storedBlob) {
        throw downloadError ?? new Error("Could not download the stored syllabus.");
      }

      candidate = new File([storedBlob], storedFile.file_name, {
        type: storedFile.mime_type || "application/pdf",
      });
    }

    if (!candidate) {
      return NextResponse.json(
        {
          ok: false,
          requestId,
          error: "A stored syllabus PDF is required.",
        },
        { status: 400 },
      );
    }

    const isPdf =
      candidate.type === "application/pdf" ||
      candidate.name.toLowerCase().endsWith(".pdf");

    if (!isPdf) {
      return NextResponse.json(
        {
          ok: false,
          requestId,
          error: "The syllabus must be a PDF.",
        },
        { status: 400 },
      );
    }

    if (candidate.size > 30 * 1024 * 1024) {
      return NextResponse.json(
        {
          ok: false,
          requestId,
          error: "The syllabus PDF is too large. Keep it under 30 MB.",
        },
        { status: 413 },
      );
    }

    const { text, pageCount } = await extractPdfText(candidate);

    if (text.replace(/\s/g, "").length < 150) {
      return NextResponse.json(
        {
          ok: false,
          code: "PDF_TEXT_NOT_EXTRACTABLE",
          retryable: false,
          requestId,
          error:
            "This PDF contains too little extractable text. It may be scanned or image-based. OCR fallback has not been enabled yet.",
        },
        { status: 422 },
      );
    }

    console.log("Syllabus analysis payload:", {
      fileName: candidate.name,
      pageCount,
      extractedCharacters: text.length,
      roughInputTokens: Math.ceil(text.length / 4),
    });

    const analysis = await generateStructured<SyllabusAnalysis>({
      system: systemPrompt,
      user: `Analyze this syllabus faithfully.

FILE NAME: ${candidate.name}
PAGE COUNT: ${pageCount}

SYLLABUS TEXT:
${text}`,
      schemaName: "syllabus_analysis",
      schema: syllabusSchema,
      temperature: 0.05,
      maxTokens: 4200,
    });

    return NextResponse.json({
      ok: true,
      requestId,
      provider: "groq",
      model:
        process.env.GROQ_SYLLABUS_MODEL ||
        "openai/gpt-oss-120b",
      analysis,
    });
  } catch (error) {
    console.error("Groq syllabus analysis failed:", error);

    const message =
      error instanceof Error
        ? error.message
        : "Groq could not analyze the syllabus.";

    const rateLimited = isGroqRateLimitError(message);
    const authFailed = isGroqAuthError(message);

    if (rateLimited) {
      return NextResponse.json(
        {
          ok: false,
          requestId,
          code: "GROQ_RATE_LIMITED",
          retryable: true,
          error:
            "Groq's current usage limit was reached. Try again after the limit resets.",
        },
        { status: 429 },
      );
    }

    if (authFailed) {
      return NextResponse.json(
        {
          ok: false,
          requestId,
          code: "GROQ_AUTH_FAILED",
          retryable: false,
          error:
            "Groq authentication failed. Check GROQ_API_KEY in .env.local and restart the development server.",
        },
        { status: 500 },
      );
    }

    return NextResponse.json(
      {
        ok: false,
        requestId,
        code: "GROQ_ANALYSIS_FAILED",
        retryable: true,
        error: message,
      },
      { status: 500 },
    );
  }
}
