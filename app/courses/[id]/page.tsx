"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Archive,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  GraduationCap,
  Headphones,
  Home,
  LibraryBig,
  Lightbulb,
  Loader2,
  Image as ImageIcon,
  MoreHorizontal,
  Plus,
  Settings2,
  Sparkles,
  Star,
  Trash2,
  TrendingUp,
  Upload,
  X,
} from "lucide-react";
import { supabase } from "../../../lib/supabase";
import {
  SchoolMark,
  useSchoolIdentity,
} from "../../../components/school-identity";
import { SourceCapturePicker } from "../../../components/source-capture";
import { CalendarScheduleCoach } from "../../../components/calendar-schedule-coach";
import {
  createLectureMaterial,
  lectureDepthLabel,
  type LecturePipelineStage,
} from "../../../lib/lecture-pipeline";

type Course = {
  id: string;
  code: string;
  name: string;
  professor: string;
  credits: number;
  color: string;
  semester_id: string | null;
};


type CourseFile = {
  id: string;
  file_name: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  material_type: string;
  processing_status: string;
  created_at: string;
  unit_id?: string | null;
  is_favorite?: boolean;
  favorited_at?: string | null;
};

type AnalysisDepth = "skim" | "standard" | "deep";

type MaterialAnalysisContent = {
  detailLevel: AnalysisDepth;
  detailPercent?: number;
  sourceKind?: "lecture";
  title: string;
  overview: string;
  whatToKnow: string[];
  sections: Array<{
    heading: string;
    explanation: string;
    keyPoints: string[];
    relatedTopicIds: string[];
    startSeconds?: number;
    endSeconds?: number;
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
  confidence: number;
};

type SavedMaterialTopicNote = {
  topic_id: string;
  summary: string;
  key_points: string[];
};

type SavedMaterialAnalysis = {
  id: string;
  status: string;
  model: string | null;
  summary: string | null;
  explanation: string | null;
  raw_analysis: MaterialAnalysisContent | null;
  topic_notes: SavedMaterialTopicNote[];
};

type CourseMaterial = CourseFile & {
  unit_id: string | null;
  topic_ids: string[];
  is_favorite: boolean;
  favorited_at: string | null;
  analysis: SavedMaterialAnalysis | null;
};

type CourseTopic = {
  id: string;
  unit_id: string | null;
  parent_topic_id: string | null;
  name: string;
  description: string | null;
  position: number;
  source: string;
  source_date_text: string | null;
  scheduled_date: string | null;
  reading: string | null;
  assignment: string | null;
  mastery_score: number;
  mastery_state: string;
};

type CourseUnit = {
  id: string;
  name: string;
  kind: string;
  description: string | null;
  coverage: string | null;
  position: number;
  source: string;
  topics: CourseTopic[];
};

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

function isAnalysisRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function analysisString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function analysisNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/%/g, "").trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function normalizeSyllabusAnalysisForUi(value: unknown): SyllabusAnalysis {
  const raw = isAnalysisRecord(value) ? value : {};
  const courseCandidate =
    raw.courseInfo ?? raw.courseInformation ?? raw.course_information;
  const course = isAnalysisRecord(courseCandidate) ? courseCandidate : {};

  const getArray = (...keys: string[]) => {
    for (const key of keys) {
      if (Array.isArray(raw[key])) return raw[key] as unknown[];
    }
    return [];
  };

  const gradingCategories = getArray(
    "gradingCategories",
    "gradingStructure",
    "grading_categories",
  )
    .map((entry) => {
      const item = isAnalysisRecord(entry) ? entry : {};
      return {
        name: analysisString(item.name ?? item.category ?? item.title),
        weightPercent: analysisNumber(
          item.weightPercent ?? item.weight ?? item.percentage ?? item.percent,
        ),
        notes: analysisString(
          item.notes ?? item.details ?? item.description ?? item.summary,
        ),
      };
    })
    .filter((item) => item.name);

  const assessments = getArray("assessments", "majorAssessments")
    .map((entry) => {
      const item = isAnalysisRecord(entry) ? entry : {};
      return {
        name: analysisString(item.name ?? item.title ?? item.event),
        type: analysisString(item.type ?? item.category ?? item.kind),
        date: analysisString(item.date ?? item.dueDate ?? item.examDate),
        notes: analysisString(
          item.notes ?? item.details ?? item.description ?? item.summary,
        ),
      };
    })
    .filter((item) => item.name || item.date);

  function normalizeTopic(entry: unknown) {
    const item = isAnalysisRecord(entry) ? entry : {};

    return {
      name: analysisString(
        item.name ?? item.topic ?? item.title ?? item.lectureTitle ?? item.lecture,
      ),
      date: analysisString(item.date ?? item.when ?? item.scheduledDate),
      reading: analysisString(
        item.reading ?? item.readings ?? item.chapter ?? item.chapters,
      ),
      assignment: analysisString(
        item.assignment ?? item.assignments ?? item.due ?? item.work,
      ),
    };
  }

  const units = getArray(
    "units",
    "courseUnits",
    "studyUnits",
    "modules",
    "course_units",
  )
    .map((entry) => {
      const item = isAnalysisRecord(entry) ? entry : {};
      const topicCandidates =
        item.topics ??
        item.explicitTopics ??
        item.lectures ??
        item.scheduledTopics;

      const topics = Array.isArray(topicCandidates)
        ? topicCandidates.map(normalizeTopic).filter((topic) => topic.name)
        : [];

      const rawBasisType = analysisString(
        item.basisType ?? item.basis_type ?? item.sourceType,
      );

      return {
        name: analysisString(item.name ?? item.title ?? item.unit ?? item.module),
        description: analysisString(
          item.description ?? item.details ?? item.summary,
        ),
        basisType:
          rawBasisType === "explicit_unit"
            ? ("explicit_unit" as const)
            : ("assessment_block" as const),
        basis: analysisString(
          item.basis ?? item.evidence ?? item.reason ?? item.source,
        ),
        assessmentName: analysisString(
          item.assessmentName ?? item.assessment ?? item.exam,
        ),
        coverage: analysisString(
          item.coverage ?? item.contentCoverage ?? item.chapters,
        ),
        topics,
      };
    })
    .filter((item) => item.name || item.topics.length > 0);

  const unassignedTopics = getArray(
    "unassignedTopics",
    "explicitTopics",
    "topics",
    "scheduledTopics",
  )
    .map(normalizeTopic)
    .filter((topic) => topic.name);

  const importantDates = getArray(
    "importantDates",
    "dates",
    "important_dates",
  )
    .map((entry) => {
      const item = isAnalysisRecord(entry) ? entry : {};
      return {
        name: analysisString(item.name ?? item.event ?? item.title),
        date: analysisString(item.date ?? item.when),
        type: analysisString(
          item.type ?? item.category ?? item.description ?? item.kind,
        ),
      };
    })
    .filter((item) => item.name || item.date);

  const policies = getArray("policies", "coursePolicies", "course_policies")
    .map((entry) => {
      const item = isAnalysisRecord(entry) ? entry : {};
      return {
        category: analysisString(item.category ?? item.name ?? item.title),
        summary: analysisString(
          item.summary ?? item.description ?? item.details ?? item.policy,
        ),
      };
    })
    .filter((item) => item.category || item.summary);

  const scheduleNotes = getArray("scheduleNotes", "schedule_notes", "notes")
    .map(analysisString)
    .filter(Boolean);

  const warnings = getArray("warnings", "uncertainties", "issues")
    .map(analysisString)
    .filter(Boolean);

  return {
    courseInfo: {
      courseCode: analysisString(
        course.courseCode ?? course.code ?? course.course_code,
      ),
      courseName: analysisString(
        course.courseName ??
          course.courseTitle ??
          course.title ??
          course.course_name,
      ),
      professor: analysisString(
        course.professor ??
          course.instructor ??
          course.teacher ??
          course.faculty,
      ),
      term: analysisString(
        course.term ??
          course.semester ??
          course.academicTerm ??
          course.academic_term,
      ),
      credits: analysisNumber(
        course.credits ?? course.creditHours ?? course.credit_hours,
      ),
    },
    gradingCategories,
    assessments,
    units,
    unassignedTopics,
    importantDates,
    policies,
    scheduleNotes,
    warnings,
    overallConfidence: Math.min(
      100,
      Math.max(0, analysisNumber(raw.overallConfidence ?? raw.confidence)),
    ),
  };
}

type Tab = "overview" | "units" | "materials" | "favorites" | "grades";

export default function CoursePage() {
  const params = useParams();
  const router = useRouter();
  const { identity: schoolIdentity } = useSchoolIdentity();

  const [course, setCourse] = useState<Course | null>(null);
  const [semesterName, setSemesterName] = useState("Current semester");
  const [syllabus, setSyllabus] = useState<CourseFile | null>(null);
  const [courseCalendar, setCourseCalendar] = useState<CourseFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [uploadingSyllabus, setUploadingSyllabus] = useState(false);
  const [syllabusError, setSyllabusError] = useState("");
  const [calendarUploadError, setCalendarUploadError] = useState("");
  const [uploadingCalendar, setUploadingCalendar] = useState(false);
  const [analyzingSyllabus, setAnalyzingSyllabus] = useState(false);
  const [syllabusAnalysis, setSyllabusAnalysis] =
    useState<SyllabusAnalysis | null>(null);
  const [analysisError, setAnalysisError] = useState("");
  const [analysisProgress, setAnalysisProgress] = useState("");
  const [courseUnits, setCourseUnits] = useState<CourseUnit[]>([]);
  const [unassignedTopics, setUnassignedTopics] = useState<CourseTopic[]>([]);
  const [loadingStructure, setLoadingStructure] = useState(true);
  const [syllabusAnalyzed, setSyllabusAnalyzed] = useState(false);
  const [courseMaterials, setCourseMaterials] = useState<CourseMaterial[]>([]);
  const [loadingMaterials, setLoadingMaterials] = useState(true);
  const [materialWizardOpen, setMaterialWizardOpen] = useState(false);
  const [materialWizardUnitId, setMaterialWizardUnitId] =
    useState<string | null>(null);
  const [analyzingMaterialIds, setAnalyzingMaterialIds] =
    useState<Record<string, boolean>>({});
  const [showCourseMenu, setShowCourseMenu] = useState(false);
  const [showArchiveDialog, setShowArchiveDialog] = useState(false);
  const [archiveGrade, setArchiveGrade] = useState("");
  const [archivingCourse, setArchivingCourse] = useState(false);
  const [deletingCourse, setDeletingCourse] = useState(false);

  const syllabusInputRef = useRef<HTMLInputElement>(null);
  const calendarInputRef = useRef<HTMLInputElement>(null);
  const courseId = params.id as string;

  useEffect(() => {
    void initializePage();
  }, [courseId]);

  async function initializePage() {
    try {
      setLoading(true);
      setLoadingStructure(true);
      setLoadingMaterials(true);
      setSyllabusError("");

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.replace("/onboarding");
        return;
      }

      const [, loadedSyllabus] = await Promise.all([
        loadCourse(),
        loadSyllabus(),
        loadCourseCalendar(),
        loadCourseStructure(),
        loadCourseMaterials(),
      ]);

      await loadSyllabusConfirmation(loadedSyllabus?.id ?? null);
    } catch (error) {
      console.error("Error initializing course:", error);
      setCourse(null);
    } finally {
      setLoading(false);
      setLoadingStructure(false);
      setLoadingMaterials(false);
    }
  }

  async function loadCourseCalendar() {
    const { data, error } = await supabase
      .from("course_files")
      .select(
        "id, file_name, storage_path, mime_type, size_bytes, material_type, processing_status, created_at",
      )
      .eq("course_id", courseId)
      .eq("material_type", "course_calendar")
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) throw error;

    const latest = data?.[0] ?? null;
    setCourseCalendar(
      latest
        ? {
            ...latest,
            size_bytes:
              latest.size_bytes === null ? null : Number(latest.size_bytes),
          }
        : null,
    );
  }

  async function loadCourse() {
    const { data, error } = await supabase
      .from("courses")
      .select("id, code, name, professor, credits, color, semester_id")
      .eq("id", courseId)
      .single();

    if (error) {
      throw error;
    }

    setCourse({
      id: data.id,
      code: data.code,
      name: data.name,
      professor: data.professor ?? "",
      credits: Number(data.credits),
      color: data.color,
      semester_id: data.semester_id ?? null,
    });

    if (data.semester_id) {
      const { data: semester, error: semesterError } =
        await supabase
          .from("semesters")
          .select("name")
          .eq("id", data.semester_id)
          .maybeSingle();

      if (semesterError) {
        console.warn(
          "Could not load semester name:",
          semesterError,
        );
      }

      setSemesterName(
        semester?.name ?? "Current semester",
      );
    } else {
      setSemesterName("Current semester");
    }
  }

  async function loadSyllabus() {
    const { data, error } = await supabase
      .from("course_files")
      .select(
        "id, file_name, storage_path, mime_type, size_bytes, material_type, processing_status, created_at",
      )
      .eq("course_id", courseId)
      .eq("material_type", "syllabus")
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) {
      throw error;
    }

    const record = data?.[0];

    if (!record) {
      setSyllabus(null);
      return null;
    }

    const loadedSyllabus: CourseFile = {
      id: record.id,
      file_name: record.file_name,
      storage_path: record.storage_path,
      mime_type: record.mime_type,
      size_bytes:
        record.size_bytes === null ? null : Number(record.size_bytes),
      material_type: record.material_type,
      processing_status: record.processing_status,
      created_at: record.created_at,
    };

    setSyllabus(loadedSyllabus);
    return loadedSyllabus;
  }

  async function loadSyllabusConfirmation(courseFileId: string | null) {
    if (!courseFileId) {
      setSyllabusAnalyzed(false);
      setSyllabusAnalysis(null);
      return;
    }

    const { data, error } = await supabase
      .from("syllabus_analyses")
      .select("edited_analysis, raw_analysis, status")
      .eq("course_id", courseId)
      .eq("course_file_id", courseFileId)
      .eq("status", "confirmed")
      .order("confirmed_at", { ascending: false })
      .limit(1);

    if (error) throw error;

    const confirmed = data?.[0];

    if (!confirmed) {
      setSyllabusAnalyzed(false);
      setSyllabusAnalysis(null);
      return;
    }

    setSyllabusAnalyzed(true);
    setSyllabusAnalysis(
      normalizeSyllabusAnalysisForUi(
        confirmed.edited_analysis ?? confirmed.raw_analysis,
      ),
    );
  }

  async function loadCourseStructure() {
    const [
      { data: unitData, error: unitError },
      { data: topicData, error: topicError },
    ] = await Promise.all([
      supabase
        .from("course_units")
        .select("id, name, kind, description, coverage, position, source")
        .eq("course_id", courseId)
        .order("position", { ascending: true }),
      supabase
        .from("course_topics")
        .select(
          "id, unit_id, parent_topic_id, name, description, position, source, source_date_text, scheduled_date, reading, assignment, mastery_score, mastery_state",
        )
        .eq("course_id", courseId)
        .order("position", { ascending: true }),
    ]);

    if (unitError) throw unitError;
    if (topicError) throw topicError;

    const topics: CourseTopic[] = (topicData ?? []).map((topic) => ({
      id: topic.id,
      unit_id: topic.unit_id,
      parent_topic_id: topic.parent_topic_id ?? null,
      name: topic.name,
      description: topic.description ?? null,
      position: Number(topic.position ?? 0),
      source: topic.source ?? "manual",
      source_date_text: topic.source_date_text ?? null,
      scheduled_date: topic.scheduled_date ?? null,
      reading: topic.reading ?? null,
      assignment: topic.assignment ?? null,
      mastery_score: Number(topic.mastery_score ?? 0),
      mastery_state: topic.mastery_state ?? "unseen",
    }));

    const units: CourseUnit[] = (unitData ?? []).map((unit) => ({
      id: unit.id,
      name: unit.name,
      kind: unit.kind ?? "unit",
      description: unit.description ?? null,
      coverage: unit.coverage ?? null,
      position: Number(unit.position ?? 0),
      source: unit.source ?? "manual",
      topics: topics
        .filter((topic) => topic.unit_id === unit.id)
        .sort((a, b) => a.position - b.position),
    }));

    setCourseUnits(units);
    setUnassignedTopics(
      topics
        .filter((topic) => !topic.unit_id)
        .sort((a, b) => a.position - b.position),
    );
  }

  async function loadCourseMaterials() {
    const [
      { data: fileData, error: fileError },
      { data: linkData, error: linkError },
      { data: analysisData, error: analysisLoadError },
      { data: topicNoteData, error: topicNoteError },
    ] = await Promise.all([
      supabase
        .from("course_files")
        .select(
          "id, file_name, storage_path, mime_type, size_bytes, material_type, processing_status, created_at, unit_id, is_favorite, favorited_at",
        )
        .eq("course_id", courseId)
        .order("created_at", { ascending: false }),
      supabase
        .from("course_file_topic_links")
        .select("course_file_id, topic_id")
        .eq("course_id", courseId),
      supabase
        .from("material_analyses")
        .select(
          "id, course_file_id, summary, explanation, raw_analysis, status, model",
        )
        .eq("course_id", courseId),
      supabase
        .from("material_analysis_topic_notes")
        .select("course_file_id, topic_id, summary, key_points")
        .eq("course_id", courseId),
    ]);

    if (fileError) throw fileError;
    if (linkError) throw linkError;
    if (analysisLoadError) throw analysisLoadError;
    if (topicNoteError) throw topicNoteError;

    const materials: CourseMaterial[] = (fileData ?? [])
      .filter(
        (file) =>
          file.material_type !== "syllabus" &&
          file.material_type !== "course_calendar",
      )
      .map((file) => {
        const savedAnalysis = (analysisData ?? []).find(
          (analysis) => analysis.course_file_id === file.id,
        );

        return {
          id: file.id,
          file_name: file.file_name,
          storage_path: file.storage_path,
          mime_type: file.mime_type,
          size_bytes:
            file.size_bytes === null ? null : Number(file.size_bytes),
          material_type: file.material_type,
          processing_status: file.processing_status,
          created_at: file.created_at,
          unit_id: file.unit_id ?? null,
          is_favorite: Boolean(file.is_favorite),
          favorited_at: file.favorited_at ?? null,
          topic_ids: (linkData ?? [])
            .filter((link) => link.course_file_id === file.id)
            .map((link) => link.topic_id),
          analysis: savedAnalysis
            ? {
                id: savedAnalysis.id,
                status: savedAnalysis.status,
                model: savedAnalysis.model ?? null,
                summary: savedAnalysis.summary ?? null,
                explanation: savedAnalysis.explanation ?? null,
                raw_analysis:
                  (savedAnalysis.raw_analysis as MaterialAnalysisContent | null) ??
                  null,
                topic_notes: (topicNoteData ?? [])
                  .filter((note) => note.course_file_id === file.id)
                  .map((note) => ({
                    topic_id: note.topic_id,
                    summary: note.summary ?? "",
                    key_points: Array.isArray(note.key_points)
                      ? (note.key_points as string[])
                      : [],
                  })),
              }
            : null,
        };
      });

    setCourseMaterials(materials);
  }

  async function toggleMaterialFavorite(
    materialId: string,
    nextFavorite: boolean,
  ) {
    const favoritedAt = nextFavorite
      ? new Date().toISOString()
      : null;

    setCourseMaterials((current) =>
      current.map((material) =>
        material.id === materialId
          ? {
              ...material,
              is_favorite: nextFavorite,
              favorited_at: favoritedAt,
            }
          : material,
      ),
    );

    const { error } = await supabase
      .from("course_files")
      .update({
        is_favorite: nextFavorite,
        favorited_at: favoritedAt,
      })
      .eq("id", materialId)
      .eq("course_id", courseId);

    if (error) {
      await loadCourseMaterials();
      throw error;
    }
  }

  function openMaterialWizard(unitId: string | null = null) {
    setMaterialWizardUnitId(unitId);
    setMaterialWizardOpen(true);
  }

  async function refreshAcademicMap() {
    setLoadingStructure(true);
    setLoadingMaterials(true);

    try {
      await Promise.all([
        loadCourseStructure(),
        loadCourseMaterials(),
      ]);
    } finally {
      setLoadingStructure(false);
      setLoadingMaterials(false);
    }
  }

  async function analyzeAndExplainMaterial(
    material: CourseMaterial,
    detailLevel: AnalysisDepth,
  ) {
    if (analyzingMaterialIds[material.id]) return;

    try {
      setAnalyzingMaterialIds((current) => ({
        ...current,
        [material.id]: true,
      }));

      const allTopics = [
        ...courseUnits.flatMap((unit) => unit.topics),
        ...unassignedTopics,
      ];

      const seenTopicIds = new Set<string>();
      const linkedTopics = allTopics.filter((topic) => {
        if (
          !material.topic_ids.includes(topic.id) ||
          seenTopicIds.has(topic.id)
        ) {
          return false;
        }

        seenTopicIds.add(topic.id);
        return true;
      });

      if (linkedTopics.length === 0) {
        throw new Error(
          "This material needs at least one topic before it can be analyzed.",
        );
      }

      const { data: fileBlob, error: downloadError } =
        await supabase.storage
          .from("course-files")
          .download(material.storage_path);

      if (downloadError) throw downloadError;
      if (!fileBlob) throw new Error("Could not download this material.");

      const file = new File(
        [fileBlob],
        material.file_name,
        {
          type:
            material.mime_type ||
            fileBlob.type ||
            "application/octet-stream",
        },
      );

      const formData = new FormData();
      formData.append("file", file);
      formData.append("materialType", material.material_type);
      formData.append("detailLevel", detailLevel);
      formData.append("courseId", courseId);
      formData.append(
        "topics",
        JSON.stringify(
          linkedTopics.map((topic) => ({
            id: topic.id,
            name: topic.name,
          })),
        ),
      );

      const { data: { session: authSession }, error: authSessionError } =
        await supabase.auth.getSession();
      if (authSessionError) throw authSessionError;
      if (!authSession) throw new Error("You must be signed in.");

      const response = await fetch("/api/analyze-material", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authSession.access_token}`,
        },
        body: formData,
      });

      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        model?: string;
        result?: MaterialAnalysisContent;
      };

      if (!response.ok || payload.ok !== true || !payload.result) {
        throw new Error(
          payload.error || "AI could not analyze this material.",
        );
      }

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) throw userError;
      if (!user) throw new Error("You must be signed in.");

      const result = payload.result;

      const { data: savedAnalysis, error: saveAnalysisError } =
        await supabase
          .from("material_analyses")
          .upsert(
            {
              user_id: user.id,
              course_id: courseId,
              course_file_id: material.id,
              summary: result.overview,
              explanation: result.sections
                .map(
                  (section) =>
                    `${section.heading}: ${section.explanation}`,
                )
                .join("\\n\\n"),
              raw_analysis: result,
              status: "ready",
              model:
                payload.model ||
                process.env.NEXT_PUBLIC_GROQ_DISPLAY_MODEL ||
                "openai/gpt-oss-120b",
              analyzed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
            { onConflict: "course_file_id" },
          )
          .select("id")
          .single();

      if (saveAnalysisError) throw saveAnalysisError;

      const { error: clearNotesError } = await supabase
        .from("material_analysis_topic_notes")
        .delete()
        .eq("course_file_id", material.id);

      if (clearNotesError) throw clearNotesError;

      const noteRows = result.topicNotes
        .filter((note) =>
          material.topic_ids.includes(note.topicId),
        )
        .map((note) => ({
          user_id: user.id,
          course_id: courseId,
          course_file_id: material.id,
          material_analysis_id: savedAnalysis.id,
          topic_id: note.topicId,
          summary: note.summary,
          key_points: note.keyPoints,
        }));

      if (noteRows.length > 0) {
        const { error: noteInsertError } = await supabase
          .from("material_analysis_topic_notes")
          .insert(noteRows);

        if (noteInsertError) throw noteInsertError;
      }

      await loadCourseMaterials();
    } finally {
      setAnalyzingMaterialIds((current) => ({
        ...current,
        [material.id]: false,
      }));
    }
  }

  async function archiveCourse() {
    if (!course || archivingCourse) return;

    try {
      setArchivingCourse(true);

      const { error } = await supabase
        .from("courses")
        .update({
          archived_at: new Date().toISOString(),
          archived_grade: archiveGrade.trim() || "Not calculated",
        })
        .eq("id", course.id);

      if (error) throw error;

      router.push("/archived");
    } catch (error) {
      console.error("Could not archive course:", error);
      alert("Could not archive this course.");
    } finally {
      setArchivingCourse(false);
    }
  }

  async function deleteCoursePermanently() {
    if (!course || deletingCourse) return;

    const confirmed = window.confirm(
      `Permanently delete ${course.code}? This removes the course, its materials, notes, units, topics, and saved AI analyses. This cannot be undone.`,
    );

    if (!confirmed) return;

    try {
      setDeletingCourse(true);

      const { data: files, error: filesError } = await supabase
        .from("course_files")
        .select("storage_path")
        .eq("course_id", course.id);

      if (filesError) throw filesError;

      const storagePaths = (files ?? [])
        .map((file) => file.storage_path)
        .filter(Boolean);

      if (storagePaths.length > 0) {
        const { error: storageError } = await supabase.storage
          .from("course-files")
          .remove(storagePaths);

        if (storageError) {
          console.warn(
            "Some storage files could not be removed:",
            storageError,
          );
        }
      }

      const { error: deleteError } = await supabase
        .from("courses")
        .delete()
        .eq("id", course.id);

      if (deleteError) throw deleteError;

      router.push("/");
    } catch (error) {
      console.error("Could not delete course:", error);
      alert("Could not permanently delete this course.");
    } finally {
      setDeletingCourse(false);
    }
  }

  function chooseSyllabus() {
    syllabusInputRef.current?.click();
  }

  function chooseCourseCalendar() {
    calendarInputRef.current?.click();
  }

  async function handleSyllabusSelected(
    event: React.ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    const isPdf =
      file.type === "application/pdf" ||
      file.name.toLowerCase().endsWith(".pdf");

    if (!isPdf) {
      setSyllabusError("Please choose a PDF syllabus.");
      return;
    }

    let uploadedPath = "";

    try {
      setUploadingSyllabus(true);
      setSyllabusError("");
      setAnalysisError("");
      setSyllabusAnalysis(null);

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        throw userError ?? new Error("No signed-in user.");
      }

      const safeFileName = file.name.replace(
        /[^a-zA-Z0-9._-]/g,
        "_",
      );

      const storagePath = `${user.id}/${courseId}/syllabus/${crypto.randomUUID()}-${safeFileName}`;
      uploadedPath = storagePath;

      const { error: uploadError } = await supabase.storage
        .from("course-files")
        .upload(storagePath, file, {
          contentType: file.type || "application/pdf",
          upsert: false,
        });

      if (uploadError) {
        throw uploadError;
      }

      const { data: savedFile, error: databaseError } =
        await supabase
          .from("course_files")
          .insert({
            user_id: user.id,
            course_id: courseId,
            file_name: file.name,
            storage_path: storagePath,
            mime_type: file.type || "application/pdf",
            size_bytes: file.size,
            material_type: "syllabus",
            processing_status: "uploaded",
          })
          .select(
            "id, file_name, storage_path, mime_type, size_bytes, material_type, processing_status, created_at",
          )
          .single();

      if (databaseError) {
        await supabase.storage
          .from("course-files")
          .remove([storagePath]);

        throw databaseError;
      }

      uploadedPath = "";

      const oldSyllabus = syllabus;

      setSyllabus({
        id: savedFile.id,
        file_name: savedFile.file_name,
        storage_path: savedFile.storage_path,
        mime_type: savedFile.mime_type,
        size_bytes:
          savedFile.size_bytes === null
            ? null
            : Number(savedFile.size_bytes),
        material_type: savedFile.material_type,
        processing_status: savedFile.processing_status,
        created_at: savedFile.created_at,
      });
      setSyllabusAnalyzed(false);
      setSyllabusAnalysis(null);

      if (oldSyllabus) {
        const { error: oldDatabaseError } = await supabase
          .from("course_files")
          .delete()
          .eq("id", oldSyllabus.id);

        if (oldDatabaseError) {
          console.warn(
            "Could not remove old syllabus database record:",
            oldDatabaseError,
          );
        } else {
          const { error: oldStorageError } = await supabase.storage
            .from("course-files")
            .remove([oldSyllabus.storage_path]);

          if (oldStorageError) {
            console.warn(
              "Could not remove old syllabus file:",
              oldStorageError,
            );
          }
        }
      }
    } catch (error) {
      if (uploadedPath) {
        const { error: cleanupError } = await supabase.storage
          .from("course-files")
          .remove([uploadedPath]);
        if (cleanupError) {
          console.warn("Could not clean up failed syllabus upload:", cleanupError);
        }
      }
      console.error("Error uploading syllabus:", error);
      setSyllabusError(
        error instanceof Error
          ? error.message
          : "Could not upload the syllabus.",
      );
    } finally {
      setUploadingSyllabus(false);
    }
  }

  async function handleCourseCalendarSelected(
    event: React.ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const supported =
      file.type === "application/pdf" ||
      file.type === "text/calendar" ||
      /\.(pdf|ics)$/i.test(file.name);

    if (!supported) {
      setCalendarUploadError("Choose a PDF or .ics course calendar.");
      return;
    }

    if (file.size > 30 * 1024 * 1024) {
      setCalendarUploadError("Keep the course calendar under 30 MB.");
      return;
    }

    let uploadedPath = "";
    try {
      setUploadingCalendar(true);
      setCalendarUploadError("");
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError || !user) throw userError ?? new Error("You must be signed in.");

      const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      uploadedPath = `${user.id}/${courseId}/course-calendar/${crypto.randomUUID()}-${safeFileName}`;
      const { error: uploadError } = await supabase.storage
        .from("course-files")
        .upload(uploadedPath, file, {
          contentType: file.type || undefined,
          upsert: false,
        });
      if (uploadError) throw uploadError;

      const { data: savedFile, error: databaseError } = await supabase
        .from("course_files")
        .insert({
          user_id: user.id,
          course_id: courseId,
          file_name: file.name,
          storage_path: uploadedPath,
          mime_type: file.type || null,
          size_bytes: file.size,
          material_type: "course_calendar",
          processing_status: "ready",
        })
        .select(
          "id, file_name, storage_path, mime_type, size_bytes, material_type, processing_status, created_at",
        )
        .single();
      if (databaseError) throw databaseError;

      const previous = courseCalendar;
      uploadedPath = "";
      setCourseCalendar({
        ...savedFile,
        size_bytes:
          savedFile.size_bytes === null ? null : Number(savedFile.size_bytes),
      });

      if (previous) {
        const { error: oldDatabaseError } = await supabase
          .from("course_files")
          .delete()
          .eq("id", previous.id)
          .eq("course_id", courseId);
        if (!oldDatabaseError) {
          const { error: oldStorageError } = await supabase.storage
            .from("course-files")
            .remove([previous.storage_path]);
          if (oldStorageError) console.warn("Could not remove old course calendar file:", oldStorageError);
        }
      }
    } catch (error) {
      if (uploadedPath) {
        await supabase.storage.from("course-files").remove([uploadedPath]);
      }
      console.error("Error uploading course calendar:", error);
      setCalendarUploadError(
        error instanceof Error ? error.message : "Could not upload the course calendar.",
      );
    } finally {
      setUploadingCalendar(false);
    }
  }

  async function openCourseCalendar() {
    if (!courseCalendar) return;
    try {
      setCalendarUploadError("");
      const { data, error } = await supabase.storage
        .from("course-files")
        .createSignedUrl(courseCalendar.storage_path, 60);
      if (error) throw error;
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
      console.error("Error opening course calendar:", error);
      setCalendarUploadError("Could not open the course calendar.");
    }
  }

  async function analyzeSyllabus() {
    if (
      !syllabus ||
      syllabusAnalyzed ||
      analyzingSyllabus ||
      uploadingSyllabus
    ) {
      return;
    }

    try {
      setAnalyzingSyllabus(true);
      setAnalysisError("");
      setAnalysisProgress("Preparing the syllabus...");
      setSyllabusError("");

      const { error: processingError } = await supabase
        .from("course_files")
        .update({ processing_status: "processing" })
        .eq("id", syllabus.id);

      if (processingError) {
        throw processingError;
      }

      setSyllabus((current) =>
        current
          ? { ...current, processing_status: "processing" }
          : current,
      );

      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("You must be signed in.");

      let resultRecord: Record<string, unknown> = {};
      for (let cycle = 0; cycle < 80; cycle += 1) {
        const response = await fetch("/api/analyze-syllabus", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ courseId, courseFileId: syllabus.id }),
        });

        const responseText = await response.text();
        let result: unknown = null;
        try {
          result = responseText ? JSON.parse(responseText) : null;
        } catch {
          throw new Error(
            response.status === 504
              ? "Syllabus analysis timed out. Your saved progress is safe—tap Analyze to resume."
              : `Syllabus analysis failed on the server (HTTP ${response.status}).`,
          );
        }

        resultRecord = isAnalysisRecord(result) ? result : {};
        const status = analysisString(resultRecord.status);
        const retryable = resultRecord.retryable === true;
        const retryAfterHeader = Number(response.headers.get("retry-after"));
        const retryAfterMs = Math.max(
          1_000,
          Math.min(
            90_000,
            analysisNumber(resultRecord.retryAfterMs) ||
              (Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
                ? retryAfterHeader * 1000
                : 8_000),
          ),
        );

        if (
          response.status === 202 &&
          resultRecord.ok === true &&
          status === "processing"
        ) {
          const completed = analysisNumber(resultRecord.completedChunks);
          const total = analysisNumber(resultRecord.totalChunks);
          setAnalysisProgress(
            total > 0
              ? `Reading syllabus · ${completed} of ${total} page groups complete`
              : "Reading the next syllabus section...",
          );
          await new Promise((resolve) => window.setTimeout(resolve, retryAfterMs));
          continue;
        }

        if ((!response.ok || resultRecord.ok !== true) && retryable) {
          setAnalysisProgress("AI is briefly busy. Your progress is saved; resuming automatically...");
          await new Promise((resolve) => window.setTimeout(resolve, retryAfterMs));
          continue;
        }

        if (!response.ok || resultRecord.ok !== true) {
          const errorCode = analysisString(resultRecord.code);
          let message =
            analysisString(resultRecord.error) ||
            "AI could not analyze the syllabus.";
          if (errorCode === "GROQ_AUTH_FAILED") {
            message =
              "The deployed AI service is not configured. Add GROQ_API_KEY to the Vercel Production environment and redeploy.";
          }
          throw new Error(message);
        }

        if (status === "complete" || resultRecord.analysis) break;
      }

      if (!resultRecord.analysis) {
        throw new Error(
          "Syllabus analysis is still waiting for AI capacity. Your completed page groups are saved—tap Analyze to resume later.",
        );
      }

      const analysis = normalizeSyllabusAnalysisForUi(
        resultRecord.analysis,
      );
      setSyllabusAnalysis(analysis);

      await saveSyllabusAnalysisDraft(
        resultRecord.analysis,
        analysis,
        analysisString(resultRecord.analysisId),
      );

      const { error: readyError } = await supabase
        .from("course_files")
        .update({ processing_status: "ready" })
        .eq("id", syllabus.id);

      if (readyError) {
        console.warn(
          "Could not update syllabus processing status:",
          readyError,
        );
      }

      setSyllabus((current) =>
        current ? { ...current, processing_status: "ready" } : current,
      );
      router.push(`/courses/${courseId}/setup`);
    } catch (error) {
      console.error("Error analyzing syllabus:", error);

      const message =
        error instanceof Error
          ? error.message
          : "Could not analyze the syllabus.";

      setAnalysisError(message);

      if (syllabus) {
        // A failed analysis must never make a successfully uploaded syllabus
        // look broken or prevent the student from trying again.
        const nextStatus = "uploaded";

        const { error: statusError } = await supabase
          .from("course_files")
          .update({ processing_status: nextStatus })
          .eq("id", syllabus.id);

        if (statusError) {
          console.warn(
            "Could not update syllabus analysis status:",
            statusError,
          );
        }

        setSyllabus((current) =>
          current ? { ...current, processing_status: nextStatus } : current,
        );
      }
    } finally {
      setAnalyzingSyllabus(false);
      setAnalysisProgress("");
    }
  }

  async function saveSyllabusAnalysisDraft(
    rawAnalysis: unknown,
    analysis: SyllabusAnalysis,
    analysisId?: string,
  ) {
    let supersedeQuery = supabase
      .from("syllabus_analyses")
      .update({ status: "superseded" })
      .eq("course_id", courseId)
      .eq("status", "draft");
    if (analysisId) supersedeQuery = supersedeQuery.neq("id", analysisId);
    const { error: supersedeError } = await supersedeQuery;

    if (supersedeError) {
      console.warn("Could not supersede previous syllabus draft:", supersedeError);
    }

    if (analysisId) {
      const { error: updateError } = await supabase
        .from("syllabus_analyses")
        .update({
          edited_analysis: analysis,
          status: "draft",
          confidence: analysis.overallConfidence,
        })
        .eq("id", analysisId)
        .eq("course_id", courseId);
      if (updateError) throw updateError;
      return;
    }

    const { error: draftError } = await supabase
      .from("syllabus_analyses")
      .insert({
        course_id: courseId,
        course_file_id: syllabus?.id ?? null,
        raw_analysis: rawAnalysis,
        edited_analysis: analysis,
        status: "draft",
        confidence: analysis.overallConfidence,
      });

    if (draftError) throw draftError;
  }
  async function openSyllabus() {
    if (!syllabus) {
      return;
    }

    try {
      setSyllabusError("");

      const { data, error } = await supabase.storage
        .from("course-files")
        .createSignedUrl(syllabus.storage_path, 60);

      if (error) {
        throw error;
      }

      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
      console.error("Error opening syllabus:", error);
      setSyllabusError("Could not open the syllabus.");
    }
  }

  async function deleteSyllabus() {
    if (!syllabus || uploadingSyllabus) {
      return;
    }

    const fileToDelete = syllabus;

    try {
      setUploadingSyllabus(true);
      setSyllabusError("");

      const { error: storageError } = await supabase.storage
        .from("course-files")
        .remove([fileToDelete.storage_path]);

      if (storageError) {
        throw storageError;
      }

      const { error: databaseError } = await supabase
        .from("course_files")
        .delete()
        .eq("id", fileToDelete.id);

      if (databaseError) {
        throw databaseError;
      }

      setSyllabus(null);
      setSyllabusAnalyzed(false);
      setSyllabusAnalysis(null);
      setAnalysisError("");
    } catch (error) {
      console.error("Error deleting syllabus:", error);
      setSyllabusError("Could not delete the syllabus.");
    } finally {
      setUploadingSyllabus(false);
    }
  }

  if (loading) {
    return <CourseLoading />;
  }

  if (!course) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#080809] px-6 text-white">
        <div className="text-center">
          <p className="text-sm text-white/35">Course not found.</p>

          <button
            onClick={() => router.push("/")}
            className="mt-5 rounded-full bg-white px-5 py-2.5 text-sm font-medium text-black"
          >
            Return home
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-[#080809] text-[#F5F5F7]">
      <input
        ref={syllabusInputRef}
        type="file"
        accept="application/pdf,.pdf"
        onChange={handleSyllabusSelected}
        className="hidden"
      />
      <input
        ref={calendarInputRef}
        type="file"
        accept="application/pdf,text/calendar,.pdf,.ics"
        onChange={handleCourseCalendarSelected}
        className="hidden"
      />

      {/* Ambient course color */}
      <div
        className="pointer-events-none fixed left-[24%] top-[-320px] h-[620px] w-[780px] rounded-full opacity-[0.08] blur-[140px]"
        style={{ backgroundColor: course.color }}
      />

      <div className="relative flex min-h-screen">
        {/* Desktop sidebar */}
        <aside className="fixed inset-y-0 left-0 z-50 hidden h-screen w-[258px] border-r border-white/[0.065] bg-[#0B0B0D]/88 px-5 py-5 backdrop-blur-2xl md:flex md:flex-col">
          <button
            onClick={() => router.push("/")}
            className="mb-8 flex items-center gap-3 px-2 text-left"
          >
            <SchoolMark
              size={40}
              className="shadow-[0_8px_30px_rgba(0,0,0,0.28)]"
            />

            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium text-white/90">
                {schoolIdentity.shortName}
              </p>
              <p className="mt-[2px] truncate text-[11px] text-white/34">
                {semesterName}
              </p>
            </div>
          </button>

          <div className="mb-3 px-3">
            <p className="text-[10px] font-medium uppercase tracking-[0.15em] text-white/20">
              Course
            </p>
          </div>

          <nav className="space-y-[3px]">
            <SidebarTab
              icon={BookOpen}
              label="Overview"
              color={course.color}
              active={activeTab === "overview"}
              onClick={() => setActiveTab("overview")}
            />

            <SidebarTab
              icon={LibraryBig}
              label="Units"
              color={course.color}
              active={activeTab === "units"}
              onClick={() => setActiveTab("units")}
            />

            <SidebarTab
              icon={FolderOpen}
              label="Materials"
              color={course.color}
              active={activeTab === "materials"}
              onClick={() => setActiveTab("materials")}
            />

            <SidebarTab
              icon={Star}
              label="Favorites"
              color={course.color}
              active={activeTab === "favorites"}
              onClick={() => setActiveTab("favorites")}
            />

            <SidebarTab
              icon={TrendingUp}
              label="Grades"
              color={course.color}
              active={false}
              onClick={() =>
                router.push(`/courses/${courseId}/grades`)
              }
            />
          </nav>

          <div className="mt-auto">
            <div className="space-y-1 border-t border-white/[0.055] pt-5">
              <button
                onClick={() => router.push("/")}
                className="flex w-full items-center gap-3 rounded-[11px] px-3 py-2.5 text-[12px] text-white/35 transition hover:bg-white/[0.03] hover:text-white/65"
              >
                <Home size={15} />
                Home
              </button>

              <button
                onClick={() => router.push("/courses")}
                className="flex w-full items-center gap-3 rounded-[11px] px-3 py-2.5 text-[12px] text-white/35 transition hover:bg-white/[0.03] hover:text-white/65"
              >
                <ArrowLeft size={16} />
                All courses
              </button>
            </div>
          </div>
        </aside>

        {/* Fixed-sidebar spacer */}
        <div
          aria-hidden
          className="hidden w-[258px] shrink-0 md:block"
        />

        {/* Main content */}
        <section className="min-w-0 flex-1">
          {/* Mobile header */}
          <div className="sticky top-0 z-40 flex items-center justify-between border-b border-white/[0.055] bg-[#080809]/88 px-5 py-4 backdrop-blur-2xl md:hidden">
            <button
              type="button"
              aria-label="Back to home"
              onClick={() => router.push("/")}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.055] text-white/65"
            >
              <Home size={16} />
            </button>

            <div className="text-center">
              <p className="text-[11px] font-medium text-white/80">
                {course.code}
              </p>
              <p className="mt-[1px] text-[10px] text-white/34">
                {semesterName}
              </p>
            </div>

            <div className="relative">
              <button
                type="button"
                onClick={() => setShowCourseMenu((current) => !current)}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.055] text-white/50"
              >
                <MoreHorizontal size={17} />
              </button>

              {showCourseMenu && (
                <CourseActionsMenu
                  onArchive={() => {
                    setShowCourseMenu(false);
                    setShowArchiveDialog(true);
                  }}
                  onDelete={() => {
                    setShowCourseMenu(false);
                    void deleteCoursePermanently();
                  }}
                />
              )}
            </div>
          </div>

          <div className="mx-auto max-w-[1400px] px-4 pb-28 pt-6 sm:px-8 sm:pt-8 md:px-10 lg:px-14 lg:pb-16 xl:px-16">
            {/* Desktop breadcrumb */}
            <div className="mb-12 hidden items-center justify-between gap-4 md:flex">
              <div className="flex items-center gap-2 text-[11px] text-white/25">
                <button
                  onClick={() => router.push("/")}
                  className="transition hover:text-white/60"
                >
                  Home
                </button>

                <ChevronRight size={12} className="text-white/15" />

                <button
                  onClick={() => router.push("/courses")}
                  className="transition hover:text-white/60"
                >
                  Courses
                </button>

                <ChevronRight size={12} className="text-white/15" />

                <span>{course.code}</span>
              </div>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowCourseMenu((current) => !current)}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.065] bg-white/[0.02] text-white/28 transition hover:bg-white/[0.045] hover:text-white/60"
                >
                  <MoreHorizontal size={16} />
                </button>

                {showCourseMenu && (
                  <CourseActionsMenu
                    onArchive={() => {
                      setShowCourseMenu(false);
                      setShowArchiveDialog(true);
                    }}
                    onDelete={() => {
                      setShowCourseMenu(false);
                      void deleteCoursePermanently();
                    }}
                  />
                )}
              </div>
            </div>

            {/* Course Hero */}
            <section className="relative">
              <div className="mb-5 flex items-center gap-3">
                <div
                  className="h-[2px] w-10 rounded-full"
                  style={{ backgroundColor: course.color }}
                />

                <p
                  className="text-[10px] font-semibold uppercase tracking-[0.17em]"
                  style={{ color: course.color }}
                >
                  {course.code}
                </p>
              </div>

              <div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
                                <div>
                  <h1 className="max-w-4xl text-[40px] font-medium leading-[1.02] tracking-[-0.055em] sm:text-[52px] lg:text-[60px]">
                    {course.name}
                  </h1>

                  <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-white/30">
                    <span>
                      {course.professor || "Professor not added"}
                    </span>

                    <span className="h-1 w-1 rounded-full bg-white/15" />

                    <span>
                      {formatCredits(course.credits)}{" "}
                      {course.credits === 1 ? "credit" : "credits"}
                    </span>

                    <span className="h-1 w-1 rounded-full bg-white/15" />

                    <span>{semesterName}</span>
                  </div>

                  <div className="mt-6 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        router.push(`/study?course=${courseId}`)
                      }
                      className="flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-[11px] font-medium text-black transition hover:bg-white/90"
                    >
                      <GraduationCap size={13} />
                      Study this course
                    </button>
                  </div>
                </div>

                <div className="hidden lg:block">
                  <div
                    className="flex h-[82px] w-[82px] items-center justify-center rounded-[24px] border text-[24px] font-semibold"
                    style={{
                      backgroundColor: `${course.color}12`,
                      borderColor: `${course.color}30`,
                      color: course.color,
                    }}
                  >
                    {course.code.charAt(0)}
                  </div>
                </div>
              </div>
            </section>

            {/* Mobile course navigation */}
            <div className="mt-10 flex snap-x gap-1 overflow-x-auto border-b border-white/[0.06] pb-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:hidden">
              <MobileTab
                label="Overview"
                active={activeTab === "overview"}
                onClick={() => setActiveTab("overview")}
                color={course.color}
              />

              <MobileTab
                label="Units"
                active={activeTab === "units"}
                onClick={() => setActiveTab("units")}
                color={course.color}
              />

              <MobileTab
                label="Materials"
                active={activeTab === "materials"}
                onClick={() => setActiveTab("materials")}
                color={course.color}
              />

              <MobileTab
                label="Favorites"
                active={activeTab === "favorites"}
                onClick={() => setActiveTab("favorites")}
                color={course.color}
              />

              <MobileTab
                label="Grades"
                active={false}
                onClick={() =>
                  router.push(`/courses/${courseId}/grades`)
                }
                color={course.color}
              />
            </div>

            {/* Divider */}
            <div className="relative my-10 h-px bg-white/[0.06] md:my-12">
              <div
                className="absolute left-0 top-0 h-px w-20"
                style={{ backgroundColor: course.color }}
              />
            </div>

            {/* Active course view */}
            {activeTab === "overview" && (
              <OverviewTab
                course={course}
                syllabus={syllabus}
                courseCalendar={courseCalendar}
                uploadingSyllabus={uploadingSyllabus}
                uploadingCalendar={uploadingCalendar}
                syllabusError={syllabusError}
                calendarUploadError={calendarUploadError}
                analyzingSyllabus={analyzingSyllabus}
                analysisProgress={analysisProgress}
                syllabusAnalysis={syllabusAnalysis}
                syllabusAnalyzed={syllabusAnalyzed}
                unitCount={courseUnits.length}
                materialCount={courseMaterials.length}
                analysisError={analysisError}
                semesterName={semesterName}
                schoolName={schoolIdentity.name}
                onChooseSyllabus={chooseSyllabus}
                onAnalyzeSyllabus={analyzeSyllabus}
                onOpenSyllabus={openSyllabus}
                onDeleteSyllabus={deleteSyllabus}
                onChooseCalendar={chooseCourseCalendar}
                onOpenCalendar={openCourseCalendar}
              />
            )}

            {activeTab === "units" && (
              <UnitsTab
                course={course}
                units={courseUnits}
                unassignedTopics={unassignedTopics}
                materials={courseMaterials}
                loading={loadingStructure || loadingMaterials}
                onAddMaterial={(unitId) => openMaterialWizard(unitId)}
                onAnalyzeMaterial={analyzeAndExplainMaterial}
                analyzingMaterialIds={analyzingMaterialIds}
              />
            )}

            {activeTab === "materials" && (
              <MaterialsTab
                course={course}
                materials={courseMaterials}
                units={courseUnits}
                loading={loadingMaterials}
                onAddMaterial={() => openMaterialWizard(null)}
                onAnalyzeMaterial={analyzeAndExplainMaterial}
                analyzingMaterialIds={analyzingMaterialIds}
                onToggleFavorite={toggleMaterialFavorite}
              />
            )}

            {activeTab === "favorites" && (
              <FavoriteMaterialsTab
                course={course}
                materials={courseMaterials.filter(
                  (material) => material.is_favorite,
                )}
                units={courseUnits}
                loading={loadingMaterials}
                onAnalyzeMaterial={analyzeAndExplainMaterial}
                analyzingMaterialIds={analyzingMaterialIds}
                onToggleFavorite={toggleMaterialFavorite}
                onBrowseMaterials={() =>
                  setActiveTab("materials")
                }
              />
            )}

            {activeTab === "grades" && (
              <GradesTab course={course} />
            )}
          </div>
        </section>
      </div>

      {showArchiveDialog && (
        <ArchiveCourseDialog
          course={course}
          grade={archiveGrade}
          onGradeChange={setArchiveGrade}
          archiving={archivingCourse}
          onClose={() => setShowArchiveDialog(false)}
          onArchive={() => void archiveCourse()}
        />
      )}

      {materialWizardOpen && (
        <MaterialUploadWizard
          course={course}
          units={courseUnits}
          unassignedTopics={unassignedTopics}
          initialUnitId={materialWizardUnitId}
          onClose={() => {
            setMaterialWizardOpen(false);
            setMaterialWizardUnitId(null);
          }}
          onSaved={async () => {
            await refreshAcademicMap();
            setMaterialWizardOpen(false);
            setMaterialWizardUnitId(null);
          }}
        />
      )}
    </main>
  );
}

function OverviewTab({
  course,
  syllabus,
  courseCalendar,
  uploadingSyllabus,
  uploadingCalendar,
  syllabusError,
  calendarUploadError,
  analyzingSyllabus,
  analysisProgress,
  syllabusAnalysis,
  syllabusAnalyzed,
  unitCount,
  materialCount,
  analysisError,
  semesterName,
  schoolName,
  onChooseSyllabus,
  onAnalyzeSyllabus,
  onOpenSyllabus,
  onDeleteSyllabus,
  onChooseCalendar,
  onOpenCalendar,
}: {
  course: Course;
  syllabus: CourseFile | null;
  courseCalendar: CourseFile | null;
  uploadingSyllabus: boolean;
  uploadingCalendar: boolean;
  syllabusError: string;
  calendarUploadError: string;
  analyzingSyllabus: boolean;
  analysisProgress: string;
  syllabusAnalysis: SyllabusAnalysis | null;
  syllabusAnalyzed: boolean;
  unitCount: number;
  materialCount: number;
  analysisError: string;
  semesterName: string;
  schoolName: string;
  onChooseSyllabus: () => void;
  onAnalyzeSyllabus: () => void;
  onOpenSyllabus: () => void;
  onDeleteSyllabus: () => void;
  onChooseCalendar: () => void;
  onOpenCalendar: () => void;
}) {
  return (
    <section>
      <div className="grid gap-12 xl:grid-cols-[1.25fr_.75fr]">
        {/* Main column */}
        <div>
          <div className="mb-6">
            <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.16em] text-white/22">
              Course setup
            </p>

            <h2 className="text-[25px] font-medium tracking-[-0.04em]">
              Build the course workspace
            </h2>

            <p className="mt-2 max-w-xl text-[13px] leading-6 text-white/30">
              Start with the syllabus and course calendar. These give us grading,
              assessments, dates, and any study structure the professor explicitly
              provides.
            </p>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <SyllabusSetupRow
              syllabus={syllabus}
              uploading={uploadingSyllabus}
              error={syllabusError}
              color={course.color}
              analyzing={analyzingSyllabus}
              analysisProgress={analysisProgress}
              analyzed={syllabusAnalyzed}
              onChoose={onChooseSyllabus}
              onAnalyze={onAnalyzeSyllabus}
              onOpen={onOpenSyllabus}
              onDelete={onDeleteSyllabus}
            />

            <SetupRow
              icon={CalendarDays}
              title="Course calendar"
              description={
                courseCalendar
                  ? `${courseCalendar.file_name} · ${formatFileSize(courseCalendar.size_bytes)}`
                  : "Keep the professor's PDF or .ics calendar with this course."
              }
              action={courseCalendar ? "Replace" : "Upload calendar"}
              color={course.color}
              busy={uploadingCalendar}
              status={courseCalendar ? "Uploaded" : "Not uploaded"}
              error={calendarUploadError}
              onAction={onChooseCalendar}
              onView={courseCalendar ? onOpenCalendar : undefined}
            />

            {courseCalendar && (
              <div className="lg:col-span-2">
                <CalendarScheduleCoach
                  courses={[course]}
                  accent={course.color}
                  sourceFileId={courseCalendar.id}
                  sourceCourseId={course.id}
                  onApplied={() => undefined}
                />
              </div>
            )}
          </div>

          {(analyzingSyllabus || analysisError) && (
            <div className="mt-6">
              {analyzingSyllabus ? (
                <div
                  className="overflow-hidden rounded-[24px] border p-6 sm:p-7"
                  style={{
                    borderColor: `${course.color}22`,
                    backgroundColor: `${course.color}08`,
                  }}
                >
                  <div className="flex items-start gap-4">
                    <div
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px]"
                      style={{ backgroundColor: `${course.color}12` }}
                    >
                      <Loader2
                        size={17}
                        className="animate-spin"
                        style={{ color: course.color }}
                      />
                    </div>

                    <div>
                      <p className="text-[13px] font-medium text-white/80">
                        AI is reading your syllabus.
                      </p>
                      <p className="mt-2 max-w-xl text-[11px] leading-5 text-white/28">
                        {analysisProgress ||
                          "Extracting course details, grading, assessments, dates, explicit lecture topics, and any supported study-unit structure."}
                      </p>
                    </div>
                  </div>
                </div>
              ) : analysisError ? (
                <div className="rounded-[22px] border border-red-500/15 bg-red-500/[0.045] p-5">
                  <p className="text-[12px] font-medium text-red-300">
                    Syllabus analysis failed
                  </p>
                  <p className="mt-2 text-[11px] leading-5 text-red-200/45">
                    {analysisError}
                  </p>
                </div>
              ) : null}
            </div>
          )}

          {/* Workspace summary */}
          <div className="mt-12">
            <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.16em] text-white/22">
              Workspace
            </p>

            <h2 className="mb-6 text-[24px] font-medium tracking-[-0.04em]">
              Course at a glance
            </h2>

            <div className="grid gap-8 sm:grid-cols-3">
              <CourseMetric value={String(unitCount)} label="Units" />
              <CourseMetric value={String(materialCount)} label="Materials" />
              <CourseMetric value="--" label="Current grade" />
            </div>
          </div>

          {/* Empty activity */}
          <div className="mt-12 border-y border-white/[0.06] py-8">
            <div className="flex items-start gap-5">
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px]"
                style={{ backgroundColor: `${course.color}10` }}
              >
                <Sparkles size={17} style={{ color: course.color }} />
              </div>

              <div>
                <p className="text-[14px] font-medium text-white/82">
                  Your course intelligence will live here.
                </p>

                <p className="mt-2 max-w-xl text-[13px] leading-6 text-white/29">
                  Once materials are added, this space will surface what matters
                  most, including upcoming work, weak topics, study progress, and
                  eventually AI-generated review.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Right status column */}
        <aside>
          <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.16em] text-white/22">
            Course status
          </p>

          <h2 className="mb-6 text-[24px] font-medium tracking-[-0.04em]">
            Overview
          </h2>

          <div>
            <StatusRow label="Course" value={course.code} />

            <StatusRow
              label="Professor"
              value={course.professor || "Not added"}
              muted={!course.professor}
            />

            <StatusRow
              label="Credits"
              value={formatCredits(course.credits)}
            />

            <StatusRow
              label="Syllabus"
              value={syllabus ? "Uploaded" : "Not uploaded"}
              muted={!syllabus}
            />

            <StatusRow
              label="Course calendar"
              value="Not uploaded"
              muted
            />

            <StatusRow
              label="Current grade"
              value="Not calculated"
              muted
            />
          </div>

          <div
            className="mt-8 rounded-[22px] border p-5"
            style={{
              borderColor: `${course.color}18`,
              backgroundColor: `${course.color}08`,
            }}
          >
            <div className="flex items-center gap-3">
              <div
                className="flex h-9 w-9 items-center justify-center rounded-[12px]"
                style={{ backgroundColor: `${course.color}12` }}
              >
                <GraduationCap
                  size={16}
                  style={{ color: course.color }}
                />
              </div>

              <div>
                <p className="text-[12px] font-medium text-white/75">
                  {semesterName}
                </p>

                <p className="mt-0.5 text-[10px] text-white/34">
                  {schoolName}
                </p>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}

function UnitsTab({
  course,
  units,
  unassignedTopics,
  materials,
  loading,
  onAddMaterial,
  onAnalyzeMaterial,
  analyzingMaterialIds,
}: {
  course: Course;
  units: CourseUnit[];
  unassignedTopics: CourseTopic[];
  materials: CourseMaterial[];
  loading: boolean;
  onAddMaterial: (unitId: string) => void;
  onAnalyzeMaterial: (material: CourseMaterial, detailLevel: AnalysisDepth) => Promise<void>;
  analyzingMaterialIds: Record<string, boolean>;
}) {
  const [openUnits, setOpenUnits] = useState<Record<string, boolean>>({});

  const totalTopics =
    units.reduce((sum, unit) => sum + unit.topics.length, 0) +
    unassignedTopics.length;

  if (loading) {
    return (
      <section>
        <div className="h-8 w-32 animate-pulse rounded-lg bg-white/[0.05]" />
        <div className="mt-8 space-y-3">
          {[0, 1, 2].map((item) => (
            <div
              key={item}
              className="h-24 animate-pulse rounded-[22px] border border-white/[0.055] bg-white/[0.018]"
            />
          ))}
        </div>
      </section>
    );
  }

  return (
    <section>
      <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.16em] text-white/22">
            Course structure
          </p>

          <h2 className="text-[28px] font-medium tracking-[-0.04em]">
            Units
          </h2>

          <p className="mt-2 max-w-2xl text-[13px] leading-6 text-white/30">
            Materials live inside the unit they belong to. Each material can
            connect to multiple syllabus topics, and AI can suggest the best
            matches when you do not want to choose manually.
          </p>
        </div>

        <div className="flex items-center gap-3 text-[13px] text-white/28">
          <span>
            {units.length} {units.length === 1 ? "unit" : "units"}
          </span>
          <span className="h-1 w-1 rounded-full bg-white/15" />
          <span>
            {totalTopics} {totalTopics === 1 ? "topic" : "topics"}
          </span>
        </div>
      </div>

      {units.length === 0 ? (
        <div className="mt-10 rounded-[26px] border border-white/[0.07] bg-[#101012] p-7 sm:p-9">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-[13px]"
            style={{
              backgroundColor: `${course.color}10`,
              color: course.color,
            }}
          >
            <LibraryBig size={18} />
          </div>

          <h3 className="mt-6 text-[23px] font-medium tracking-[-0.04em]">
            No saved units yet.
          </h3>

          <p className="mt-3 max-w-lg text-[13px] leading-6 text-white/30">
            Confirmed syllabus units will appear here automatically.
          </p>
        </div>
      ) : (
        <div className="mt-9 space-y-3">
          {units.map((unit, index) => {
            const isOpen = openUnits[unit.id] ?? index === 0;
            const unitMaterials = materials.filter(
              (material) => material.unit_id === unit.id,
            );

            return (
              <div
                key={unit.id}
                className="overflow-hidden rounded-[24px] border border-white/[0.065] bg-[#101012]"
              >
                <div className="flex items-center gap-3 px-4 py-4 sm:px-5">
                  <button
                    type="button"
                    onClick={() =>
                      setOpenUnits((current) => ({
                        ...current,
                        [unit.id]: !isOpen,
                      }))
                    }
                    className="flex min-w-0 flex-1 items-center gap-4 text-left"
                  >
                    <div
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px]"
                      style={{
                        backgroundColor: `${course.color}10`,
                        color: course.color,
                      }}
                    >
                      <span className="text-[11px] font-semibold">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-[14px] font-medium text-white/82">
                          {unit.name}
                        </p>

                        {unit.source === "syllabus" && (
                          <span
                            className="rounded-full px-2 py-0.5 text-[8px] font-medium uppercase tracking-[0.08em]"
                            style={{
                              backgroundColor: `${course.color}0D`,
                              color: course.color,
                            }}
                          >
                            Syllabus
                          </span>
                        )}
                      </div>

                      <p className="mt-1 text-[13px] text-white/28">
                        {unit.topics.length}{" "}
                        {unit.topics.length === 1 ? "topic" : "topics"} ·{" "}
                        {unitMaterials.length}{" "}
                        {unitMaterials.length === 1
                          ? "material"
                          : "materials"}
                        {unit.coverage ? ` · ${unit.coverage}` : ""}
                      </p>
                    </div>

                    {isOpen ? (
                      <ChevronDown size={15} className="shrink-0 text-white/30" />
                    ) : (
                      <ChevronRight size={15} className="shrink-0 text-white/30" />
                    )}
                  </button>

                  <div className="hidden items-center gap-2 sm:flex">
                    <button
                      type="button"
                      onClick={() => onAddMaterial(unit.id)}
                      className="flex items-center gap-1.5 rounded-full bg-white px-3.5 py-2 text-[10px] font-medium text-black transition hover:bg-white/90"
                    >
                      <Plus size={12} />
                      Add material
                    </button>
                  </div>
                </div>

                {isOpen && (
                  <div className="border-t border-white/[0.05]">
                    <div className="flex items-center gap-2 border-b border-white/[0.045] px-4 py-3.5 sm:hidden">
                      <button
                        type="button"
                        onClick={() => onAddMaterial(unit.id)}
                        className="flex items-center gap-1.5 rounded-full bg-white px-3 py-2 text-[11px] font-medium text-black"
                      >
                        <Plus size={11} />
                        Add material
                      </button>
                    </div>

                    {unit.description && (
                      <div className="border-b border-white/[0.045] px-5 py-4 sm:px-6">
                        <p className="max-w-2xl text-[10px] leading-5 text-white/28">
                          {unit.description}
                        </p>
                      </div>
                    )}

                    {unit.topics.length > 0 ? (
                      <div className="space-y-2 p-3 sm:p-4">
                        {unit.topics
                          .filter((topic) => !topic.parent_topic_id)
                          .map((topic) => (
                            <TopicDropdown
                              key={topic.id}
                              topic={topic}
                              allTopics={unit.topics}
                              materials={materials}
                              course={course}
                              depth={0}
                              onAnalyzeMaterial={onAnalyzeMaterial}
                              analyzingMaterialIds={analyzingMaterialIds}
                            />
                          ))}
                      </div>
                    ) : (
                      <div className="px-5 py-6 sm:px-6">
                        <p className="text-[10px] leading-5 text-white/24">
                          This unit does not have assigned topics yet. Add a
                          material and choose from the unassigned syllabus topics,
                          or let AI decide which ones belong here.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {unassignedTopics.length > 0 && (
        <div className="mt-8">
          <div className="mb-3 flex items-center gap-2">
            <div className="h-1.5 w-1.5 rounded-full bg-amber-200/45" />
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/22">
              Unassigned syllabus topics
            </p>
            <span className="text-[9px] text-white/16">
              {unassignedTopics.length}
            </span>
          </div>

          <p className="mb-3 max-w-2xl text-[10px] leading-5 text-white/24">
            These came from the syllabus but were not safely assigned to an exam
            block. When a material uses one of them, it can be moved into the
            selected unit.
          </p>

          <div className="overflow-hidden rounded-[20px] border border-white/[0.055] bg-white/[0.01]">
            {unassignedTopics.map((topic) => (
              <div
                key={topic.id}
                className="border-b border-white/[0.04] px-5 py-3.5 last:border-b-0"
              >
                <p className="text-[11px] font-medium text-white/58">
                  {topic.name}
                </p>
                <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-white/22">
                  {topic.source_date_text && (
                    <span>{topic.source_date_text}</span>
                  )}
                  {topic.reading && <span>{topic.reading}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function TopicDropdown({
  topic,
  allTopics,
  materials,
  course,
  depth,
  onAnalyzeMaterial,
  analyzingMaterialIds,
}: {
  topic: CourseTopic;
  allTopics: CourseTopic[];
  materials: CourseMaterial[];
  course: Course;
  depth: number;
  onAnalyzeMaterial: (material: CourseMaterial, detailLevel: AnalysisDepth) => Promise<void>;
  analyzingMaterialIds: Record<string, boolean>;
}) {
  const [open, setOpen] = useState(false);

  const topicMaterials = materials.filter((material) =>
    material.topic_ids.includes(topic.id),
  );

  const children = allTopics.filter(
    (candidate) => candidate.parent_topic_id === topic.id,
  );

  return (
    <div
      className={`overflow-hidden rounded-[18px] border border-white/[0.055] bg-white/[0.009] ${
        depth > 0 ? "ml-4" : ""
      }`}
    >
      <div className="flex items-center gap-2.5 px-3.5 py-3">
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <div
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{
              backgroundColor:
                topic.mastery_score > 0 ? course.color : "rgba(255,255,255,0.18)",
            }}
          />

          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-medium text-white/67">
              {topic.name}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-white/22">
              {topic.source_date_text && <span>{topic.source_date_text}</span>}
              <span>
                {topicMaterials.length}{" "}
                {topicMaterials.length === 1 ? "file" : "files"}
              </span>
              {children.length > 0 && (
                <span>
                  {children.length}{" "}
                  {children.length === 1 ? "subtopic" : "subtopics"}
                </span>
              )}
            </div>
          </div>

          {open ? (
            <ChevronDown size={13} className="shrink-0 text-white/24" />
          ) : (
            <ChevronRight size={13} className="shrink-0 text-white/24" />
          )}
        </button>

      </div>

      {open && (
        <div className="border-t border-white/[0.045]">
          {(topic.reading || topic.assignment) && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-white/[0.04] px-4 py-3 text-[9px] text-white/22">
              {topic.reading && <span>Reading: {topic.reading}</span>}
              {topic.assignment && (
                <span>Assignment: {topic.assignment}</span>
              )}
            </div>
          )}

          {topicMaterials.length > 0 ? (
            <div className="space-y-2 p-3">
              {topicMaterials.map((material) => (
                <TopicMaterialRow
                  key={material.id}
                  material={material}
                  course={course}
                  currentTopicId={topic.id}
                  onAnalyzeMaterial={onAnalyzeMaterial}
                  analyzing={Boolean(
                    analyzingMaterialIds[material.id],
                  )}
                />
              ))}
            </div>
          ) : (
            <div className="px-4 py-4">
              <p className="text-[9px] leading-4 text-white/20">
                No materials are connected to this topic yet.
              </p>
            </div>
          )}

          {children.length > 0 && (
            <div className="space-y-2 border-t border-white/[0.045] p-3">
              <p className="px-1 text-[8px] font-medium uppercase tracking-[0.12em] text-white/18">
                Subtopics
              </p>

              {children.map((child) => (
                <TopicDropdown
                  key={child.id}
                  topic={child}
                  allTopics={allTopics}
                  materials={materials}
                  course={course}
                  depth={depth + 1}
                  onAnalyzeMaterial={onAnalyzeMaterial}
                  analyzingMaterialIds={analyzingMaterialIds}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TopicMaterialRow({
  material,
  course,
  currentTopicId,
  onAnalyzeMaterial,
  analyzing,
}: {
  material: CourseMaterial;
  course: Course;
  currentTopicId: string | null;
  onAnalyzeMaterial: (
    material: CourseMaterial,
    detailLevel: AnalysisDepth,
  ) => Promise<void>;
  analyzing: boolean;
}) {
  const [notesOpen, setNotesOpen] = useState(false);
  const [depthPickerOpen, setDepthPickerOpen] = useState(false);
  const [error, setError] = useState("");

  const hasNotes =
    material.analysis?.status === "ready" &&
    Boolean(material.analysis.raw_analysis);
  const imageOnly =
    material.mime_type?.startsWith("image/") ?? false;
  const lectureMaterial =
    material.material_type === "lecture_recording";

  async function openMaterial() {
    const bucket =
      material.material_type === "lecture_recording"
        ? "lecture-audio"
        : "course-files";

    const { data, error: signedUrlError } = await supabase.storage
      .from(bucket)
      .createSignedUrl(material.storage_path, 60);

    if (signedUrlError) {
      console.error("Could not open material:", signedUrlError);
      return;
    }

    if (data?.signedUrl) {
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    }
  }

  async function runAnalysis(detailLevel: AnalysisDepth) {
    try {
      setDepthPickerOpen(false);
      setError("");
      await onAnalyzeMaterial(material, detailLevel);
      setNotesOpen(true);
    } catch (analysisError) {
      console.error("Analyze & Explain failed:", analysisError);
      setError(
        analysisError instanceof Error
          ? analysisError.message
          : "Analyze & Explain failed.",
      );
    }
  }

  return (
    <>
      <div className="overflow-hidden rounded-[16px] border border-white/[0.05] bg-[#0B0B0D]">
        <div className="flex flex-col gap-3 px-3.5 py-3 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={openMaterial}
            className="flex min-w-0 flex-1 items-center gap-3 text-left"
          >
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px]"
              style={{
                backgroundColor: `${course.color}0D`,
                color: course.color,
              }}
            >
              {lectureMaterial ? (
                <Headphones size={13} />
              ) : imageOnly ? (
                <ImageIcon size={13} />
              ) : (
                <FileText size={13} />
              )}
            </div>

            <div className="min-w-0">
              <p className="truncate text-[10px] font-medium text-white/62">
                {material.file_name}
              </p>
              <p className="mt-1 text-[8px] text-white/20">
                {materialTypeLabel(material.material_type)} ·{" "}
                {formatFileSize(material.size_bytes)}
              </p>
            </div>
          </button>

          {hasNotes ? (
            <button
              type="button"
              onClick={() => setNotesOpen(true)}
              className="flex items-center justify-center gap-1.5 rounded-full border border-white/[0.075] bg-white/[0.025] px-3 py-2 text-[11px] font-medium text-white/48 transition hover:bg-white/[0.045] hover:text-white/76"
            >
              <BookOpen size={10} />
              View notes
            </button>
          ) : lectureMaterial ? (
            <span className="rounded-full border border-white/[0.055] bg-white/[0.012] px-3 py-2 text-[10px] font-medium text-white/30">
              {material.processing_status === "error"
                ? "Lecture needs attention"
                : "Processing lecture"}
            </span>
          ) : lectureMaterial ? (
            <span className="rounded-full border border-white/[0.055] bg-white/[0.012] px-3 py-2 text-[10px] font-medium text-white/30">
              {material.processing_status === "error"
                ? "Lecture needs attention"
                : "Processing lecture"}
            </span>
          ) : imageOnly ? (
            <span className="rounded-full border border-white/[0.055] bg-white/[0.012] px-3 py-2 text-[10px] font-medium text-white/30">
              Photo saved
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setDepthPickerOpen(true)}
              disabled={analyzing}
              className="flex items-center justify-center gap-1.5 rounded-full border border-white/[0.07] bg-white/[0.018] px-3 py-2 text-[11px] font-medium text-white/38 transition hover:bg-white/[0.04] hover:text-white/68 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {analyzing ? (
                <Loader2 size={10} className="animate-spin" />
              ) : (
                <Sparkles size={10} />
              )}
              {analyzing ? "Analyzing" : "Analyze & Explain"}
            </button>
          )}
        </div>

        {error && (
          <div className="border-t border-red-500/10 bg-red-500/[0.025] px-4 py-3">
            <p className="text-[9px] leading-4 text-red-200/60">{error}</p>
          </div>
        )}
      </div>

      {depthPickerOpen && (
        <AnalysisDepthPicker
          course={course}
          materialName={material.file_name}
          onClose={() => setDepthPickerOpen(false)}
          onChoose={runAnalysis}
        />
      )}

      {notesOpen &&
        material.analysis?.raw_analysis && (
          <MaterialNotesDocument
            material={material}
            analysis={material.analysis}
            currentTopicId={currentTopicId}
            course={course}
            onClose={() => setNotesOpen(false)}
            onRegenerate={() => {
              setNotesOpen(false);

              if (lectureMaterial) {
                window.location.assign("/lectures");
                return;
              }

              setDepthPickerOpen(true);
            }}
          />
        )}
    </>
  );
}

function AnalysisDepthPicker({
  course,
  materialName,
  onClose,
  onChoose,
}: {
  course: Course;
  materialName: string;
  onClose: () => void;
  onChoose: (detailLevel: AnalysisDepth) => Promise<void>;
}) {
  const [selected, setSelected] =
    useState<AnalysisDepth>("standard");

  const options: Array<{
    id: AnalysisDepth;
    title: string;
    description: string;
    detail: string;
    questions: string;
  }> = [
    {
      id: "skim",
      title: "Skim",
      description:
        "Fast, high-signal notes for a quick review.",
      detail: "Concise explanation",
      questions: "2 quick checks",
    },
    {
      id: "standard",
      title: "Standard",
      description:
        "Balanced notes with enough detail to study from.",
      detail: "Balanced depth",
      questions: "4 quick checks",
    },
    {
      id: "deep",
      title: "Deep dive",
      description:
        "Thorough explanations, relationships, and problem-solving logic.",
      detail: "Maximum useful detail",
      questions: "6 quick checks",
    },
  ];

  return (
    <div className="fixed inset-0 z-[140] flex items-end justify-center bg-black/75 p-0 backdrop-blur-xl sm:items-center sm:p-6">
      <button
        type="button"
        onClick={onClose}
        className="absolute inset-0"
        aria-label="Close detail picker"
      />

      <div className="relative z-10 w-full max-w-[640px] overflow-hidden rounded-t-[28px] border border-white/[0.08] bg-[#0D0D0F] shadow-2xl shadow-black/60 sm:rounded-[28px]">
        <div
          className="pointer-events-none absolute left-1/3 top-[-160px] h-[280px] w-[380px] rounded-full opacity-[0.08] blur-[105px]"
          style={{ backgroundColor: course.color }}
        />

        <div className="relative border-b border-white/[0.06] px-5 py-5 sm:px-7 sm:py-6">
          <div className="flex items-start justify-between gap-5">
            <div>
              <p
                className="text-[12px] font-semibold uppercase tracking-[0.16em]"
                style={{ color: course.color }}
              >
                Analyze & Explain
              </p>
              <h2 className="mt-2 text-[25px] font-medium tracking-[-0.045em]">
                How deep should we go?
              </h2>
              <p className="mt-2 max-w-lg truncate text-[13px] text-white/28">
                {materialName}
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.04] text-white/35 transition hover:bg-white/[0.07] hover:text-white/70"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        <div className="relative space-y-2.5 px-5 py-5 sm:px-7">
          {options.map((option) => {
            const active = option.id === selected;

            return (
              <button
                key={option.id}
                type="button"
                onClick={() => setSelected(option.id)}
                className={`w-full rounded-[18px] border p-4 text-left transition ${
                  active
                    ? "border-white/[0.14] bg-white/[0.04]"
                    : "border-white/[0.055] bg-white/[0.01] hover:border-white/[0.09] hover:bg-white/[0.018]"
                }`}
              >
                <div className="flex items-start gap-4">
                  <div
                    className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px]"
                    style={{
                      backgroundColor: active
                        ? `${course.color}14`
                        : "rgba(255,255,255,0.03)",
                      color: active
                        ? course.color
                        : "rgba(255,255,255,0.25)",
                    }}
                  >
                    {option.id === "skim" ? (
                      <FileText size={13} />
                    ) : option.id === "standard" ? (
                      <BookOpen size={13} />
                    ) : (
                      <Sparkles size={13} />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[12px] font-medium text-white/68">
                        {option.title}
                      </p>
                      {option.id === "standard" && (
                        <span
                          className="rounded-full px-2 py-0.5 text-[8px] font-medium"
                          style={{
                            backgroundColor: `${course.color}0D`,
                            color: course.color,
                          }}
                        >
                          Recommended
                        </span>
                      )}
                    </div>

                    <p className="mt-1.5 text-[9px] leading-4 text-white/25">
                      {option.description}
                    </p>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <span className="rounded-full border border-white/[0.05] px-2.5 py-1 text-[8px] text-white/22">
                        {option.detail}
                      </span>
                      <span className="rounded-full border border-white/[0.05] px-2.5 py-1 text-[8px] text-white/22">
                        {option.questions}
                      </span>
                    </div>
                  </div>

                  <div
                    className={`mt-1 h-4 w-4 shrink-0 rounded-full border ${
                      active
                        ? "border-transparent"
                        : "border-white/[0.12]"
                    }`}
                    style={{
                      backgroundColor: active
                        ? course.color
                        : "transparent",
                    }}
                  />
                </div>
              </button>
            );
          })}
        </div>

        <div className="relative flex items-center justify-between gap-3 border-t border-white/[0.06] px-5 py-4 sm:px-7">
          <p className="hidden text-[9px] text-white/18 sm:block">
            You can regenerate later at a different depth.
          </p>

          <button
            type="button"
            onClick={() => void onChoose(selected)}
            className="ml-auto flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-[10px] font-medium text-black transition hover:bg-white/90"
          >
            <Sparkles size={11} />
            Generate notes
          </button>
        </div>
      </div>
    </div>
  );
}

function MaterialNotesDocument({
  material,
  analysis,
  currentTopicId,
  course,
  onClose,
  onRegenerate,
}: {
  material: CourseMaterial;
  analysis: SavedMaterialAnalysis;
  currentTopicId: string | null;
  course: Course;
  onClose: () => void;
  onRegenerate: () => void;
}) {
  const content = analysis.raw_analysis;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  if (!content) return null;
  const printableContent = content;

  const topicNote = currentTopicId
    ? analysis.topic_notes.find(
        (note) => note.topic_id === currentTopicId,
      )
    : null;

  const depthLabel =
    content.detailLevel === "skim"
      ? "Skim"
      : content.detailLevel === "deep"
        ? "Deep dive"
        : "Standard";

  function saveAsPdf() {
    const notesRoot = document.getElementById(
      "material-notes-print-root",
    );

    if (!notesRoot) return;

    const documentStyles = Array.from(
      document.querySelectorAll(
        'link[rel="stylesheet"], style',
      ),
    )
      .map((node) => node.outerHTML)
      .join("\n");

    const printableNotes = notesRoot.cloneNode(
      true,
    ) as HTMLElement;

    printableNotes
      .querySelectorAll(".notes-print-hide")
      .forEach((element) => element.remove());

    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.style.opacity = "0";
    iframe.style.pointerEvents = "none";

    document.body.appendChild(iframe);

    const printDocument =
      iframe.contentDocument ||
      iframe.contentWindow?.document;

    if (!printDocument || !iframe.contentWindow) {
      iframe.remove();
      return;
    }

    printDocument.open();
    printDocument.write(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtmlForPrint(printableContent.title)} - Study Notes</title>
    ${documentStyles}
    <style>
      @page { size: auto; margin: 0.55in; }

      html, body {
        margin: 0 !important;
        padding: 0 !important;
        width: 100% !important;
        height: auto !important;
        overflow: visible !important;
        background: white !important;
        color: #171717 !important;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }

      #material-notes-print-root {
        position: static !important;
        inset: auto !important;
        display: block !important;
        width: 100% !important;
        height: auto !important;
        min-height: 0 !important;
        max-height: none !important;
        overflow: visible !important;
        background: white !important;
      }

      #material-notes-print-root main {
        display: block !important;
        width: 100% !important;
        max-width: none !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: visible !important;
      }

      #material-notes-print-root * {
        color: #111 !important;
        background: transparent !important;
        opacity: 1 !important;
        filter: none !important;
        box-shadow: none !important;
        text-shadow: none !important;
      }

      #material-notes-print-root .notes-print-card {
        border-color: #dddddd !important;
        break-inside: auto !important;
        page-break-inside: auto !important;
      }

      #material-notes-print-root .notes-print-section {
        break-inside: auto !important;
        page-break-inside: auto !important;
      }

      #material-notes-print-root h1,
      #material-notes-print-root h2,
      #material-notes-print-root h3,
      #material-notes-print-root h4,
      #material-notes-print-root h5 {
        break-after: avoid-page;
        page-break-after: avoid;
      }

      #material-notes-print-root p,
      #material-notes-print-root li {
        orphans: 3;
        widows: 3;
      }
    </style>
  </head>
  <body>
    ${printableNotes.outerHTML}
  </body>
</html>`);
    printDocument.close();

    const printFrame = () => {
      const frameWindow = iframe.contentWindow;
      if (!frameWindow) {
        iframe.remove();
        return;
      }

      const cleanup = () => {
        window.setTimeout(() => iframe.remove(), 250);
      };

      frameWindow.addEventListener(
        "afterprint",
        cleanup,
        { once: true },
      );

      frameWindow.focus();
      frameWindow.print();

      window.setTimeout(cleanup, 2000);
    };

    if (printDocument.readyState === "complete") {
      window.setTimeout(printFrame, 150);
    } else {
      iframe.addEventListener(
        "load",
        () => window.setTimeout(printFrame, 150),
        { once: true },
      );
    }
  }

  return (
    <div
      id="material-notes-print-root"
      className="fixed inset-0 z-[150] overflow-y-auto bg-[#070708] text-[#F5F5F7]"
    >
      <style>{`
        @media print {
          @page {
            size: auto;
            margin: 0.55in;
          }

          html,
          body {
            height: auto !important;
            min-height: 0 !important;
            max-height: none !important;
            overflow: visible !important;
            background: white !important;
          }

          body * {
            visibility: hidden !important;
          }

          #material-notes-print-root,
          #material-notes-print-root * {
            visibility: visible !important;
          }

          #material-notes-print-root {
            position: static !important;
            inset: auto !important;
            display: block !important;
            width: 100% !important;
            height: auto !important;
            min-height: 0 !important;
            max-height: none !important;
            overflow: visible !important;
            background: white !important;
          }

          #material-notes-print-root main {
            display: block !important;
            width: 100% !important;
            max-width: none !important;
            overflow: visible !important;
            padding: 0 !important;
          }

          #material-notes-print-root * {
            color: #111 !important;
            background: transparent !important;
            opacity: 1 !important;
            filter: none !important;
            box-shadow: none !important;
            text-shadow: none !important;
          }

          #material-notes-print-root .notes-print-hide {
            display: none !important;
          }

          #material-notes-print-root .notes-print-card {
            border-color: #dddddd !important;
          }

          /*
            Large note sections must be allowed to flow naturally across pages.
            Keeping break-inside: avoid on a section taller than the remaining
            printable area is what can cause Chrome/Safari to clip the content.
          */
          #material-notes-print-root .notes-print-section {
            break-inside: auto !important;
            page-break-inside: auto !important;
          }

          /*
            Keep only genuinely small cards/questions together when possible.
            If one is too tall, the browser is still allowed to split it.
          */
          #material-notes-print-root .notes-print-card {
            break-inside: auto !important;
            page-break-inside: auto !important;
          }

          #material-notes-print-root h1,
          #material-notes-print-root h2,
          #material-notes-print-root h3,
          #material-notes-print-root h4,
          #material-notes-print-root h5 {
            break-after: avoid-page;
            page-break-after: avoid;
          }

          #material-notes-print-root p,
          #material-notes-print-root li {
            orphans: 3;
            widows: 3;
          }
        }
      `}</style>

      <div
        className="pointer-events-none fixed left-[20%] top-[-340px] h-[620px] w-[760px] rounded-full opacity-[0.07] blur-[150px] notes-print-hide"
        style={{ backgroundColor: course.color }}
      />

      <div className="sticky top-0 z-20 border-b border-white/[0.065] bg-[#09090B]/92 backdrop-blur-2xl notes-print-hide">
        <div className="mx-auto flex max-w-[1160px] items-center gap-3 px-5 py-3.5 sm:px-8">
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/[0.06] bg-white/[0.025] text-white/36 transition hover:bg-white/[0.055] hover:text-white/72"
          >
            <X size={14} />
          </button>

          <div className="min-w-0 flex-1">
            <p className="truncate text-[10px] font-medium text-white/58">
              {content.title}
            </p>
            <p className="mt-0.5 truncate text-[8px] text-white/19">
              {material.file_name}
            </p>
          </div>

          <div className="hidden items-center gap-2 sm:flex">
            <span
              className="rounded-full border px-3 py-2 text-[11px] font-medium"
              style={{
                borderColor: `${course.color}1F`,
                backgroundColor: `${course.color}08`,
                color: course.color,
              }}
            >
              {depthLabel}
            </span>

            <button
              type="button"
              onClick={onRegenerate}
              className="rounded-full border border-white/[0.065] bg-white/[0.018] px-3.5 py-2 text-[11px] font-medium text-white/36 transition hover:bg-white/[0.04] hover:text-white/68"
            >
              Regenerate
            </button>

            <button
              type="button"
              onClick={saveAsPdf}
              className="flex items-center gap-2 rounded-full bg-white px-4 py-2 text-[11px] font-medium text-black transition hover:bg-white/90"
            >
              <Download size={11} />
              Save PDF
            </button>
          </div>
        </div>
      </div>

      <main className="relative mx-auto max-w-[1040px] px-5 py-10 sm:px-8 sm:py-14 md:py-16">
        <header className="border-b border-white/[0.07] pb-10 sm:pb-12">
          <div className="flex flex-wrap items-center gap-2">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-[10px] notes-print-card"
              style={{
                backgroundColor: `${course.color}0D`,
                color: course.color,
              }}
            >
              <Sparkles size={14} />
            </div>

            <p
              className="text-[11px] font-semibold uppercase tracking-[0.17em]"
              style={{ color: course.color }}
            >
              AI study notes
            </p>

            <span className="text-[11px] text-white/14">•</span>
            <span className="text-[11px] text-white/24">
              {depthLabel}
            </span>
          </div>

          <h1 className="mt-6 max-w-4xl text-[42px] font-medium leading-[1.02] tracking-[-0.055em] sm:text-[54px] md:text-[64px]">
            {content.title}
          </h1>

          <p className="mt-5 max-w-3xl text-[16px] leading-8 text-white/42">
            {content.overview}
          </p>

          <div className="mt-7 flex flex-wrap gap-x-5 gap-y-2 text-[11px] text-white/22">
            <span>{material.file_name}</span>
            <span>{materialTypeLabel(material.material_type)}</span>
            <span>{content.quickChecks.length} quick checks</span>
            <span>{Math.round(content.confidence)}% confidence</span>
          </div>
        </header>

        {topicNote && (
          <section
            className="notes-print-card notes-print-section mt-8 rounded-[22px] border p-5 sm:p-6"
            style={{
              borderColor: `${course.color}18`,
              backgroundColor: `${course.color}06`,
            }}
          >
            <div className="flex items-start gap-3">
              <Lightbulb
                size={15}
                className="mt-0.5 shrink-0"
                style={{ color: course.color }}
              />

              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/26">
                  Topic focus
                </p>

                <p className="mt-3 text-[15px] leading-7 text-white/52">
                  {topicNote.summary}
                </p>

                {topicNote.key_points.length > 0 && (
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    {topicNote.key_points.map((point, index) => (
                      <div
                        key={`${point}-${index}`}
                        className="notes-print-card flex items-start gap-2 rounded-[13px] border border-white/[0.05] bg-white/[0.012] px-3.5 py-3"
                      >
                        <div
                          className="mt-[6px] h-1 w-1 shrink-0 rounded-full"
                          style={{ backgroundColor: course.color }}
                        />
                        <p className="text-[13px] leading-6 text-white/36">
                          {point}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        <section className="notes-print-section mt-10">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/22">
                Essential takeaways
              </p>
              <h2 className="mt-2 text-[30px] font-medium tracking-[-0.04em] text-white/86">
                What you need to know
              </h2>
            </div>
          </div>

          <div className="mt-5 grid gap-2.5 sm:grid-cols-2">
            {content.whatToKnow.map((point, index) => (
              <div
                key={`${point}-${index}`}
                className="notes-print-card flex items-start gap-3 rounded-[17px] border border-white/[0.055] bg-white/[0.01] p-4"
              >
                <span
                  className="mt-0.5 text-[12px] font-semibold"
                  style={{ color: course.color }}
                >
                  {String(index + 1).padStart(2, "0")}
                </span>
                <p className="text-[14px] leading-7 text-white/42">
                  {point}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-12">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/22">
            Explanation
          </p>

          <div className="mt-4 space-y-4">
            {content.sections.map((section, index) => (
              <article
                key={`${section.heading}-${index}`}
                className="notes-print-card notes-print-section rounded-[21px] border border-white/[0.055] bg-white/[0.008] p-5 sm:p-6"
              >
                <div className="flex items-start gap-4">
                  <span
                    className="mt-1 text-[12px] font-semibold"
                    style={{ color: course.color }}
                  >
                    {String(index + 1).padStart(2, "0")}
                  </span>

                  <div className="min-w-0 flex-1">
                    <h3 className="text-[20px] font-medium tracking-[-0.025em] text-white/78">
                      {section.heading}
                    </h3>

                    <p className="mt-3 text-[15px] leading-7 text-white/40">
                      {section.explanation}
                    </p>

                    {section.keyPoints.length > 0 && (
                      <div className="mt-4 grid gap-2 border-t border-white/[0.045] pt-4 sm:grid-cols-2">
                        {section.keyPoints.map((point, pointIndex) => (
                          <div
                            key={`${point}-${pointIndex}`}
                            className="flex items-start gap-2"
                          >
                            <div
                              className="mt-[6px] h-1 w-1 shrink-0 rounded-full"
                              style={{ backgroundColor: course.color }}
                            />
                            <p className="text-[13px] leading-6 text-white/32">
                              {point}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        {content.studyTips.length > 0 && (
          <section className="notes-print-section mt-12">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/22">
              Study cues
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              {content.studyTips.map((tip, index) => (
                <span
                  key={`${tip}-${index}`}
                  className="notes-print-card rounded-full border border-white/[0.055] bg-white/[0.01] px-3 py-2 text-[12px] text-white/34"
                >
                  {tip}
                </span>
              ))}
            </div>
          </section>
        )}

        {content.quickChecks.length > 0 && (
          <section className="mt-12 border-t border-white/[0.065] pt-10">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/22">
                  Quick checks
                </p>

                <h2 className="mt-2 text-[30px] font-medium tracking-[-0.04em] text-white/86">
                  Test yourself as you read.
                </h2>

                <p className="mt-2 text-[13px] text-white/28">
                  These stay interactive in the app. The questions are also
                  included when you save the notes as a PDF.
                </p>
              </div>

              <span
                className="rounded-full border px-3 py-2 text-[11px] font-medium"
                style={{
                  borderColor: `${course.color}1E`,
                  backgroundColor: `${course.color}07`,
                  color: course.color,
                }}
              >
                {content.quickChecks.length} questions
              </span>
            </div>

            <div className="mt-5 space-y-3">
              {content.quickChecks.map((question, index) => (
                <QuickCheckCard
                  key={`${question.question}-${index}`}
                  question={question}
                  number={index + 1}
                  color={course.color}
                />
              ))}
            </div>
          </section>
        )}

        <footer className="mt-14 border-t border-white/[0.06] pt-6">
          <p className="text-[11px] leading-5 text-white/20">
            Generated from {material.file_name}. AI notes should be checked
            against the original course material when precision matters.
          </p>
        </footer>
      </main>

      <div className="fixed bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/[0.075] bg-[#111113]/94 p-1.5 shadow-2xl shadow-black/45 backdrop-blur-xl sm:hidden notes-print-hide">
        <button
          type="button"
          onClick={onRegenerate}
          className="rounded-full px-3 py-2 text-[11px] font-medium text-white/38"
        >
          Regenerate
        </button>

        <button
          type="button"
          onClick={saveAsPdf}
          className="flex items-center gap-1.5 rounded-full bg-white px-3.5 py-2 text-[11px] font-medium text-black"
        >
          <Download size={10} />
          Save PDF
        </button>
      </div>
    </div>
  );
}

function QuickCheckCard({
  question,
  number,
  color,
}: {
  question: {
    question: string;
    choices: string[];
    correctIndex: number;
    explanation: string;
    relatedTopicIds: string[];
  };
  number: number;
  color: string;
}) {
  const [selectedIndex, setSelectedIndex] =
    useState<number | null>(null);

  const answered = selectedIndex !== null;
  const correct =
    selectedIndex !== null &&
    selectedIndex === question.correctIndex;

  return (
    <div className="rounded-[16px] border border-white/[0.055] bg-white/[0.008] p-4">
      <div className="flex items-start gap-3">
        <div
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[8px] text-[8px] font-semibold"
          style={{
            backgroundColor: `${color}0D`,
            color,
          }}
        >
          {number}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-medium leading-6 text-white/64">
            {question.question}
          </p>

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {question.choices.map((choice, index) => {
              const isSelected = selectedIndex === index;
              const isCorrectChoice =
                answered &&
                index === question.correctIndex;
              const isWrongSelection =
                answered &&
                isSelected &&
                index !== question.correctIndex;

              return (
                <button
                  key={`${choice}-${index}`}
                  type="button"
                  disabled={answered}
                  onClick={() => setSelectedIndex(index)}
                  className={`rounded-[12px] border px-3 py-2.5 text-left text-[13px] leading-5 transition ${
                    isWrongSelection
                      ? "border-red-400/20 bg-red-400/[0.04] text-red-100/55"
                      : isCorrectChoice
                        ? "text-white/68"
                        : isSelected
                          ? "border-white/[0.14] bg-white/[0.04] text-white/60"
                          : "border-white/[0.05] bg-white/[0.008] text-white/30 hover:border-white/[0.09] hover:text-white/48"
                  }`}
                  style={
                    isCorrectChoice
                      ? {
                          borderColor: `${color}2A`,
                          backgroundColor: `${color}08`,
                        }
                      : undefined
                  }
                >
                  <span className="mr-2 text-white/18">
                    {String.fromCharCode(65 + index)}
                  </span>
                  {choice}
                </button>
              );
            })}
          </div>

          {answered && (
            <div className="mt-3 border-t border-white/[0.04] pt-3">
              <p
                className="text-[11px] font-medium"
                style={{
                  color: correct
                    ? color
                    : "rgba(254,202,202,0.68)",
                }}
              >
                {correct ? "Correct" : "Not quite"}
              </p>
              <p className="mt-1 text-[12px] leading-5 text-white/30">
                {question.explanation}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FavoriteMaterialsTab({
  course,
  materials,
  units,
  loading,
  onAnalyzeMaterial,
  analyzingMaterialIds,
  onToggleFavorite,
  onBrowseMaterials,
}: {
  course: Course;
  materials: CourseMaterial[];
  units: CourseUnit[];
  loading: boolean;
  onAnalyzeMaterial: (
    material: CourseMaterial,
    detailLevel: AnalysisDepth,
  ) => Promise<void>;
  analyzingMaterialIds: Record<string, boolean>;
  onToggleFavorite: (
    materialId: string,
    nextFavorite: boolean,
  ) => Promise<void>;
  onBrowseMaterials: () => void;
}) {
  if (loading) {
    return (
      <section>
        <div className="h-8 w-44 animate-pulse rounded-lg bg-white/[0.05]" />
        <div className="mt-8 h-56 animate-pulse rounded-[24px] bg-white/[0.02]" />
      </section>
    );
  }

  return (
    <section>
      <div className="flex items-end justify-between gap-6">
        <div>
          <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.16em] text-white/22">
            Saved for review
          </p>

          <div className="flex items-center gap-3">
            <h2 className="text-[28px] font-medium tracking-[-0.04em]">
              Favorite materials
            </h2>

            {materials.length > 0 && (
              <span
                className="rounded-full px-2.5 py-1 text-[9px] font-semibold"
                style={{
                  backgroundColor: `${course.color}12`,
                  color: course.color,
                }}
              >
                {materials.length}
              </span>
            )}
          </div>

          <p className="mt-2 max-w-xl text-[13px] leading-6 text-white/30">
            Keep the lectures, notes, slides, assignments, and other sources
            you want to come back to without searching through the full course
            library.
          </p>
        </div>

        {materials.length > 0 && (
          <button
            type="button"
            onClick={onBrowseMaterials}
            className="hidden items-center gap-2 rounded-full border border-white/[0.07] bg-white/[0.015] px-4 py-2.5 text-[11px] font-medium text-white/42 transition hover:bg-white/[0.035] hover:text-white/68 sm:flex"
          >
            <FolderOpen size={12} />
            All materials
          </button>
        )}
      </div>

      {materials.length === 0 ? (
        <div className="mt-10 rounded-[24px] border border-white/[0.06] bg-[#101012] p-6 sm:p-8">
          <div
            className="flex h-11 w-11 items-center justify-center rounded-[14px]"
            style={{
              backgroundColor: `${course.color}10`,
              color: course.color,
            }}
          >
            <Star size={17} />
          </div>

          <h3 className="mt-5 text-[16px] font-medium text-white/76">
            Nothing favorited yet.
          </h3>

          <p className="mt-2 max-w-lg text-[12px] leading-6 text-white/34">
            Star materials you want to revisit. Favorites from quiz feedback
            and the Materials tab will appear here automatically.
          </p>

          <button
            type="button"
            onClick={onBrowseMaterials}
            className="mt-5 flex items-center gap-2 text-[11px] font-medium text-white/50 transition hover:text-white/76"
          >
            Browse materials
            <ArrowRight size={12} />
          </button>
        </div>
      ) : (
        <div className="mt-9 space-y-2">
          {[...materials]
            .sort(
              (a, b) =>
                new Date(
                  b.favorited_at ?? b.created_at,
                ).getTime() -
                new Date(
                  a.favorited_at ?? a.created_at,
                ).getTime(),
            )
            .map((material) => {
              const unit = units.find(
                (item) =>
                  item.id === material.unit_id,
              );

              return (
                <MaterialLibraryRow
                  key={material.id}
                  material={material}
                  course={course}
                  unitName={unit?.name ?? ""}
                  onAnalyzeMaterial={
                    onAnalyzeMaterial
                  }
                  analyzing={Boolean(
                    analyzingMaterialIds[
                      material.id
                    ],
                  )}
                  onToggleFavorite={
                    onToggleFavorite
                  }
                />
              );
            })}
        </div>
      )}

      {materials.length > 0 && (
        <button
          type="button"
          onClick={onBrowseMaterials}
          className="mt-6 flex items-center gap-2 rounded-full border border-white/[0.07] px-4 py-2.5 text-[11px] font-medium text-white/42 sm:hidden"
        >
          <FolderOpen size={12} />
          All materials
        </button>
      )}
    </section>
  );
}

function MaterialsTab({
  course,
  materials,
  units,
  loading,
  onAddMaterial,
  onAnalyzeMaterial,
  analyzingMaterialIds,
  onToggleFavorite,
}: {
  course: Course;
  materials: CourseMaterial[];
  units: CourseUnit[];
  loading: boolean;
  onAddMaterial: () => void;
  onAnalyzeMaterial: (material: CourseMaterial, detailLevel: AnalysisDepth) => Promise<void>;
  analyzingMaterialIds: Record<string, boolean>;
  onToggleFavorite: (
    materialId: string,
    nextFavorite: boolean,
  ) => Promise<void>;
}) {
  if (loading) {
    return (
      <section>
        <div className="h-8 w-40 animate-pulse rounded-lg bg-white/[0.05]" />
        <div className="mt-8 h-56 animate-pulse rounded-[24px] bg-white/[0.02]" />
      </section>
    );
  }

  return (
    <section>
      <div className="flex items-end justify-between gap-6">
        <div>
          <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.16em] text-white/22">
            Course library
          </p>

          <h2 className="text-[28px] font-medium tracking-[-0.04em]">
            Materials
          </h2>

          <p className="mt-2 max-w-xl text-[13px] leading-6 text-white/30">
            Every uploaded material is attached to a unit and one or more
            topics, so the course stays organized as the library grows.
          </p>
        </div>

        <button
          type="button"
          onClick={onAddMaterial}
          className="hidden items-center gap-2 rounded-full bg-white px-4 py-2.5 text-[12px] font-medium text-black transition hover:bg-white/90 sm:flex"
        >
          <Plus size={14} />
          Add material
        </button>
      </div>

      {materials.length === 0 ? (
        <div className="mt-10 border-y border-white/[0.065] py-10">
          <div className="flex max-w-xl items-start gap-5">
            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px]"
              style={{ backgroundColor: `${course.color}10` }}
            >
              <FolderOpen size={18} style={{ color: course.color }} />
            </div>

            <div>
              <h3 className="text-[16px] font-medium text-white/80">
                Your course library is empty.
              </h3>

              <p className="mt-2 text-[13px] leading-6 text-white/30">
                Add a worksheet, slide deck, notes, homework, quiz, exam, or
                reading. Lectures come later.
              </p>

              <button
                type="button"
                onClick={onAddMaterial}
                className="mt-5 flex items-center gap-2 text-[12px] font-medium text-white/55 transition hover:text-white"
              >
                Add your first material
                <ArrowRight size={13} />
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-9 space-y-2">
          {[...materials]
            .sort((a, b) => {
              if (a.is_favorite !== b.is_favorite) {
                return a.is_favorite ? -1 : 1;
              }

              return (
                new Date(b.created_at).getTime() -
                new Date(a.created_at).getTime()
              );
            })
            .map((material) => {
              const unit = units.find(
                (item) => item.id === material.unit_id,
              );

              return (
                <MaterialLibraryRow
                  key={material.id}
                  material={material}
                  course={course}
                  unitName={unit?.name ?? ""}
                  onAnalyzeMaterial={onAnalyzeMaterial}
                  analyzing={Boolean(
                    analyzingMaterialIds[material.id],
                  )}
                  onToggleFavorite={onToggleFavorite}
                />
              );
            })}
        </div>
      )}

      <button
        type="button"
        onClick={onAddMaterial}
        className="mt-6 flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-[11px] font-medium text-black sm:hidden"
      >
        <Plus size={13} />
        Add material
      </button>
    </section>
  );
}

function MaterialLibraryRow({
  material,
  course,
  unitName,
  onAnalyzeMaterial,
  analyzing,
  onToggleFavorite,
}: {
  material: CourseMaterial;
  course: Course;
  unitName: string;
  onAnalyzeMaterial: (
    material: CourseMaterial,
    detailLevel: AnalysisDepth,
  ) => Promise<void>;
  analyzing: boolean;
  onToggleFavorite: (
    materialId: string,
    nextFavorite: boolean,
  ) => Promise<void>;
}) {
  const [notesOpen, setNotesOpen] = useState(false);
  const [depthPickerOpen, setDepthPickerOpen] = useState(false);
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const [openingOriginal, setOpeningOriginal] = useState(false);
  const [error, setError] = useState("");

  const hasNotes =
    material.analysis?.status === "ready" &&
    Boolean(material.analysis.raw_analysis);
  const imageOnly =
    material.mime_type?.startsWith("image/") ?? false;
  const lectureMaterial =
    material.material_type === "lecture_recording";

  async function openOriginalMaterial() {
    if (openingOriginal) return;

    try {
      setOpeningOriginal(true);
      setError("");

      const bucket =
        material.material_type === "lecture_recording"
          ? "lecture-audio"
          : "course-files";

      const { data, error: signedUrlError } =
        await supabase.storage
          .from(bucket)
          .createSignedUrl(
            material.storage_path,
            10 * 60,
          );

      if (signedUrlError) throw signedUrlError;

      window.open(
        data.signedUrl,
        "_blank",
        "noopener,noreferrer",
      );
    } catch (openError) {
      console.error("Could not open material:", openError);
      setError(
        openError instanceof Error
          ? openError.message
          : "Could not open this material.",
      );
    } finally {
      setOpeningOriginal(false);
    }
  }

  async function toggleFavorite() {
    if (favoriteBusy) return;

    try {
      setFavoriteBusy(true);
      setError("");

      await onToggleFavorite(
        material.id,
        !material.is_favorite,
      );
    } catch (favoriteError) {
      console.error(
        "Could not favorite material:",
        favoriteError,
      );
      setError(
        favoriteError instanceof Error
          ? favoriteError.message
          : "Could not update this favorite.",
      );
    } finally {
      setFavoriteBusy(false);
    }
  }

  async function runAnalysis(detailLevel: AnalysisDepth) {
    try {
      setDepthPickerOpen(false);
      setError("");
      await onAnalyzeMaterial(material, detailLevel);
      setNotesOpen(true);
    } catch (analysisError) {
      console.error("Analyze & Explain failed:", analysisError);
      setError(
        analysisError instanceof Error
          ? analysisError.message
          : "Analyze & Explain failed.",
      );
    }
  }

  return (
    <>
      <div className="overflow-hidden rounded-[18px] border border-white/[0.055] bg-white/[0.01]">
        <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center">
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px]"
            style={{
              backgroundColor: `${course.color}0D`,
              color: course.color,
            }}
          >
            {lectureMaterial ? (
              <Headphones size={14} />
            ) : imageOnly ? (
              <ImageIcon size={14} />
            ) : (
              <FileText size={14} />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px] font-medium text-white/66">
              {material.file_name}
            </p>
            <p className="mt-1 text-[11px] text-white/22">
              {materialTypeLabel(material.material_type)}
              {unitName ? ` · ${unitName}` : ""}
              {` · ${material.topic_ids.length} ${
                material.topic_ids.length === 1 ? "topic" : "topics"
              }`}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void toggleFavorite()}
              disabled={favoriteBusy}
              aria-label={
                material.is_favorite
                  ? "Remove from favorites"
                  : "Add to favorites"
              }
              className="flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.065] bg-white/[0.012] text-white/28 transition hover:bg-white/[0.035] hover:text-white/58 disabled:opacity-40"
              style={
                material.is_favorite
                  ? { color: course.color }
                  : undefined
              }
            >
              {favoriteBusy ? (
                <Loader2
                  size={12}
                  className="animate-spin"
                />
              ) : (
                <Star
                  size={13}
                  fill={
                    material.is_favorite
                      ? "currentColor"
                      : "none"
                  }
                />
              )}
            </button>

            <button
              type="button"
              onClick={() =>
                void openOriginalMaterial()
              }
              disabled={openingOriginal}
              className="flex items-center justify-center gap-1.5 rounded-full border border-white/[0.065] bg-white/[0.012] px-3 py-2 text-[10px] font-medium text-white/34 transition hover:bg-white/[0.035] hover:text-white/62 disabled:opacity-40"
            >
              {openingOriginal ? (
                <Loader2
                  size={10}
                  className="animate-spin"
                />
              ) : (
                <ExternalLink size={10} />
              )}
              Open
            </button>

            {hasNotes ? (
              <button
                type="button"
                onClick={() => setNotesOpen(true)}
                className="flex items-center justify-center gap-1.5 rounded-full border border-white/[0.075] bg-white/[0.025] px-3 py-2 text-[11px] font-medium text-white/48 transition hover:bg-white/[0.045] hover:text-white/76"
              >
                <BookOpen size={10} />
                View notes
              </button>
            ) : imageOnly ? (
              <span className="rounded-full border border-white/[0.055] bg-white/[0.012] px-3 py-2 text-[10px] font-medium text-white/30">
                Photo saved
              </span>
            ) : (
              <button
                type="button"
                onClick={() =>
                  setDepthPickerOpen(true)
                }
                disabled={analyzing}
                className="flex items-center justify-center gap-1.5 rounded-full border border-white/[0.07] px-3 py-2 text-[11px] font-medium text-white/34 transition hover:bg-white/[0.035] hover:text-white/62 disabled:opacity-45"
              >
                {analyzing ? (
                  <Loader2
                    size={10}
                    className="animate-spin"
                  />
                ) : (
                  <Sparkles size={10} />
                )}
                {analyzing
                  ? "Analyzing"
                  : "Analyze & Explain"}
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="border-t border-red-500/10 bg-red-500/[0.025] px-4 py-3">
            <p className="text-[9px] leading-4 text-red-200/60">{error}</p>
          </div>
        )}
      </div>

      {depthPickerOpen && (
        <AnalysisDepthPicker
          course={course}
          materialName={material.file_name}
          onClose={() => setDepthPickerOpen(false)}
          onChoose={runAnalysis}
        />
      )}

      {notesOpen &&
        material.analysis?.raw_analysis && (
          <MaterialNotesDocument
            material={material}
            analysis={material.analysis}
            currentTopicId={null}
            course={course}
            onClose={() => setNotesOpen(false)}
            onRegenerate={() => {
              setNotesOpen(false);

              if (lectureMaterial) {
                window.location.assign("/lectures");
                return;
              }

              setDepthPickerOpen(true);
            }}
          />
        )}
    </>
  );
}

type NewTopicSuggestion = {
  name: string;
  parentTopicId: string;
  reason: string;
};

function MaterialUploadWizard({
  course,
  units,
  unassignedTopics,
  initialUnitId,
  onClose,
  onSaved,
}: {
  course: Course;
  units: CourseUnit[];
  unassignedTopics: CourseTopic[];
  initialUnitId: string | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [step, setStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [materialType, setMaterialType] = useState("homework");
  const [lectureDepthPercent, setLectureDepthPercent] =
    useState(60);
  const [lectureProcessMessage, setLectureProcessMessage] =
    useState("");
  const [unitId, setUnitId] = useState(initialUnitId ?? "");
  const [topicMode, setTopicMode] = useState<"manual" | "ai">("manual");
  const [selectedTopicIds, setSelectedTopicIds] = useState<string[]>([]);
  const [newTopicSuggestions, setNewTopicSuggestions] = useState<
    NewTopicSuggestion[]
  >([]);
  const [selectedNewTopics, setSelectedNewTopics] = useState<string[]>([]);
  const [aiRationale, setAiRationale] = useState("");
  const [aiConfidence, setAiConfidence] = useState<number | null>(null);
  const [aiSuggestedFileName, setAiSuggestedFileName] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const selectedUnit = units.find((unit) => unit.id === unitId) ?? null;
  const fileIsImage = Boolean(file?.type?.startsWith("image/"));
  const fileIsAudio = Boolean(
    file &&
      (file.type.startsWith("audio/") ||
        /\.(mp3|m4a|wav|webm|ogg|mp4|mpeg|mpga)$/i.test(
          file.name,
        )),
  );
  const lectureMaterial =
    materialType === "lecture_recording" ||
    fileIsAudio;

  const candidateTopics = selectedUnit
    ? [
        ...selectedUnit.topics,
        ...unassignedTopics.filter(
          (topic) =>
            !selectedUnit.topics.some(
              (unitTopic) => unitTopic.id === topic.id,
            ),
        ),
      ]
    : [];

  function toggleTopic(topicId: string) {
    setSelectedTopicIds((current) =>
      current.includes(topicId)
        ? current.filter((id) => id !== topicId)
        : [...current, topicId],
    );
  }

  function toggleNewTopic(name: string) {
    setSelectedNewTopics((current) =>
      current.includes(name)
        ? current.filter((item) => item !== name)
        : [...current, name],
    );
  }

  function nextFromFile() {
    if (!file) {
      setError("Choose a material first.");
      return;
    }

    if (
      materialType === "lecture_recording" &&
      !fileIsAudio
    ) {
      setError(
        "Lecture recording materials need an audio file such as MP3, M4A, WAV, WebM, OGG, or MP4.",
      );
      return;
    }

    setError("");
    setStep(1);
  }

  function nextFromUnit() {
    if (!unitId) {
      setError("Choose the unit or exam this material belongs to.");
      return;
    }

    setError("");
    setSelectedTopicIds([]);
    setNewTopicSuggestions([]);
    setSelectedNewTopics([]);
    setAiRationale("");
    setAiConfidence(null);
    setAiSuggestedFileName("");
    setLectureProcessMessage("");
    setStep(2);
  }

  async function analyzeTopics() {
    if (!file || !selectedUnit || analyzing) return;

    if (lectureMaterial) {
      setError(
        "Lecture topics are assigned automatically after transcription, so you do not need to classify the audio manually.",
      );
      return;
    }

    if (file.type.startsWith("image/")) {
      setTopicMode("manual");
      setError(
        "This photo can be saved and organized now. AI reading for photographed documents will be added with document vision, so choose its topics manually for now.",
      );
      return;
    }

    try {
      setAnalyzing(true);
      setError("");

      const formData = new FormData();
      formData.append("file", file);
      formData.append("courseId", course.id);
      formData.append("unitId", selectedUnit.id);

      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("You must be signed in.");

      const response = await fetch("/api/analyze-material-topics", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        body: formData,
      });

      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        result?: {
          matchedTopicIds?: string[];
          newTopics?: NewTopicSuggestion[];
          confidence?: number;
          rationale?: string;
          suggestedFileName?: string;
        };
      };

      if (!response.ok || payload.ok !== true || !payload.result) {
        throw new Error(
          payload.error || "AI could not classify this material.",
        );
      }

      setSelectedTopicIds(payload.result.matchedTopicIds ?? []);
      setNewTopicSuggestions(payload.result.newTopics ?? []);
      setSelectedNewTopics(
        (payload.result.newTopics ?? []).map((topic) => topic.name),
      );
      setAiRationale(payload.result.rationale ?? "");
      setAiSuggestedFileName(
        payload.result.suggestedFileName?.trim() ?? "",
      );
      setAiConfidence(
        typeof payload.result.confidence === "number"
          ? payload.result.confidence
          : null,
      );
    } catch (analysisError) {
      console.error("Could not analyze material topics:", analysisError);
      setError(
        analysisError instanceof Error
          ? analysisError.message
          : "AI could not classify this material.",
      );
    } finally {
      setAnalyzing(false);
    }
  }

  async function saveMaterial() {
    if (!file || !selectedUnit || saving) return;

    if (lectureMaterial) {
      try {
        setSaving(true);
        setError("");
        setLectureProcessMessage(
          "Preparing lecture…",
        );

        const cleanTitle = file.name
          .replace(/\.[^.]+$/, "")
          .replace(/[_-]+/g, " ")
          .replace(/\s+/g, " ")
          .trim();

        const handleStage = (
          stage: LecturePipelineStage,
          message: string,
        ) => {
          setLectureProcessMessage(message);
        };

        await createLectureMaterial({
          file,
          courseId: course.id,
          unitId: selectedUnit.id,
          title:
            cleanTitle ||
            `${course.code} Lecture`,
          sourceKind: "upload",
          depthPercent:
            lectureDepthPercent,
          durationSeconds: null,
          onStage: handleStage,
        });

        await onSaved();
        return;
      } catch (lectureError) {
        console.error(
          "Could not process lecture material:",
          lectureError,
        );
        setError(
          lectureError instanceof Error
            ? lectureError.message
            : "Could not process this lecture.",
        );
        return;
      } finally {
        setSaving(false);
      }
    }

    if (
      selectedTopicIds.length === 0 &&
      selectedNewTopics.length === 0
    ) {
      setError("Choose at least one topic before saving.");
      return;
    }

    try {
      setSaving(true);
      setError("");

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) throw userError;
      if (!user) throw new Error("You must be signed in.");

      const displayFileName =
        topicMode === "ai" && aiSuggestedFileName
          ? aiSuggestedFileName
          : file.name;

      const storagePath = `${user.id}/${course.id}/${materialType}/${crypto.randomUUID()}-${sanitizeFileName(
        displayFileName,
      )}`;

      const { error: uploadError } = await supabase.storage
        .from("course-files")
        .upload(storagePath, file, {
          contentType: file.type || undefined,
          upsert: false,
        });

      if (uploadError) throw uploadError;

      const { data: savedFile, error: fileError } = await supabase
        .from("course_files")
        .insert({
          user_id: user.id,
          course_id: course.id,
          unit_id: selectedUnit.id,
          file_name: file.name,
          storage_path: storagePath,
          mime_type: file.type || null,
          size_bytes: file.size,
          material_type: materialType,
          processing_status: "ready",
        })
        .select("id")
        .single();

      if (fileError) {
        await supabase.storage
          .from("course-files")
          .remove([storagePath]);
        throw fileError;
      }

      const selectedExistingTopics = candidateTopics.filter((topic) =>
        selectedTopicIds.includes(topic.id),
      );

      const selectedNewParentIds = newTopicSuggestions
        .filter((suggestion) =>
          selectedNewTopics.includes(suggestion.name),
        )
        .map((suggestion) => suggestion.parentTopicId)
        .filter(Boolean);

      const topicsToMove = Array.from(
        new Set([
          ...selectedExistingTopics
            .filter((topic) => !topic.unit_id)
            .map((topic) => topic.id),
          ...candidateTopics
            .filter(
              (topic) =>
                !topic.unit_id &&
                selectedNewParentIds.includes(topic.id),
            )
            .map((topic) => topic.id),
        ]),
      );

      if (topicsToMove.length > 0) {
        const { error: moveError } = await supabase
          .from("course_topics")
          .update({ unit_id: selectedUnit.id })
          .in("id", topicsToMove);

        if (moveError) throw moveError;
      }

      const createdTopicIds: string[] = [];
      const maxPosition = selectedUnit.topics.reduce(
        (max, topic) => Math.max(max, topic.position),
        -1,
      );

      for (let index = 0; index < newTopicSuggestions.length; index += 1) {
        const suggestion = newTopicSuggestions[index];

        if (!selectedNewTopics.includes(suggestion.name)) continue;

        const { data: createdTopic, error: topicError } = await supabase
          .from("course_topics")
          .insert({
            user_id: user.id,
            course_id: course.id,
            unit_id: selectedUnit.id,
            parent_topic_id: suggestion.parentTopicId || null,
            source_file_id: savedFile.id,
            name: suggestion.name,
            description: suggestion.reason || null,
            position: maxPosition + createdTopicIds.length + 1,
            source: "ai",
            mastery_score: 0,
            mastery_state: "unseen",
          })
          .select("id")
          .single();

        if (topicError) throw topicError;
        createdTopicIds.push(createdTopic.id);
      }

      const allTopicIds = [
        ...selectedTopicIds,
        ...createdTopicIds,
      ];

      const linkRows = allTopicIds.map((topicId) => ({
        user_id: user.id,
        course_id: course.id,
        course_file_id: savedFile.id,
        topic_id: topicId,
        relation_source: topicMode === "ai" ? "ai" : "manual",
        confidence:
          topicMode === "ai" && aiConfidence !== null
            ? Math.max(0, Math.min(1, aiConfidence / 100))
            : null,
      }));

      const { error: linksError } = await supabase
        .from("course_file_topic_links")
        .insert(linkRows);

      if (linksError) throw linksError;

      await onSaved();
    } catch (saveError) {
      console.error("Could not save material:", saveError);
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save this material.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/70 p-0 backdrop-blur-xl sm:items-center sm:p-6">
      <button
        type="button"
        onClick={onClose}
        className="absolute inset-0"
        aria-label="Close material wizard"
      />

      <div className="relative z-10 max-h-[92vh] w-full max-w-[720px] overflow-hidden rounded-t-[28px] border border-white/[0.08] bg-[#0D0D0F] shadow-2xl shadow-black/60 sm:rounded-[28px]">
        <div
          className="pointer-events-none absolute left-1/3 top-[-180px] h-[300px] w-[420px] rounded-full opacity-[0.08] blur-[110px]"
          style={{ backgroundColor: course.color }}
        />

        <div className="relative border-b border-white/[0.06] px-5 py-5 sm:px-7">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p
                className="text-[12px] font-semibold uppercase tracking-[0.16em]"
                style={{ color: course.color }}
              >
                Add material
              </p>
              <h2 className="mt-2 text-[24px] font-medium tracking-[-0.045em]">
                {step === 0
                  ? "Choose the file."
                  : step === 1
                    ? "Where does it belong?"
                    : "Connect the topics."}
              </h2>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.04] text-white/35 transition hover:bg-white/[0.07] hover:text-white/70"
            >
              <X size={15} />
            </button>
          </div>

          <div className="mt-5 grid grid-cols-3 gap-2">
            {[
              "Material",
              "Unit",
              lectureMaterial ? "Analyze" : "Topics",
            ].map((label, index) => (
              <div key={label}>
                <div
                  className="h-1 rounded-full"
                  style={{
                    backgroundColor:
                      index <= step
                        ? course.color
                        : "rgba(255,255,255,0.055)",
                  }}
                />
                <p
                  className={`mt-2 text-[8px] font-medium uppercase tracking-[0.12em] ${
                    index <= step ? "text-white/44" : "text-white/16"
                  }`}
                >
                  {label}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="relative max-h-[64vh] overflow-y-auto px-5 py-6 sm:px-7">
          {error && (
            <div className="mb-5 rounded-[15px] border border-red-500/15 bg-red-500/[0.04] px-4 py-3">
              <p className="text-[10px] leading-5 text-red-200/65">
                {error}
              </p>
            </div>
          )}

          {step === 0 && (
            <div>
              <SourceCapturePicker
                file={file}
                onFileSelected={(nextFile) => {
                  setFile(nextFile);
                  setError("");

                  const nextIsAudio =
                    nextFile.type.startsWith("audio/") ||
                    /\.(mp3|m4a|wav|webm|ogg|mp4|mpeg|mpga)$/i.test(
                      nextFile.name,
                    );

                  if (nextIsAudio) {
                    setMaterialType("lecture_recording");
                    setTopicMode("ai");
                    setSelectedTopicIds([]);
                    setNewTopicSuggestions([]);
                    setSelectedNewTopics([]);
                    setAiRationale("");
                    setAiConfidence(null);
                    setAiSuggestedFileName("");
                  } else if (
                    nextFile.type.startsWith("image/")
                  ) {
                    setTopicMode("manual");
                    setAiRationale("");
                    setAiConfidence(null);
                    setAiSuggestedFileName("");
                  }
                }}
                onClear={() => {
                  setFile(null);
                  setError("");
                }}
                accentColor={course.color}
                accept=".pdf,.pptx,.docx,.txt,.md,.csv,.mp3,.m4a,.wav,.webm,.ogg,.mp4,.mpeg,.mpga,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,text/csv,image/*,audio/*"
                title={
                  lectureMaterial
                    ? "Lecture audio"
                    : "Course material"
                }
                description={
                  lectureMaterial
                    ? "Upload MP3, M4A, WAV, WebM, OGG, or MP4 lecture audio. It will be transcribed, auto-organized into topics, and turned into notes."
                    : "Upload a document, scan, screenshot, or take a photo of paper notes, homework, quizzes, and handouts."
                }
                uploadLabel={
                  lectureMaterial
                    ? "Upload lecture audio"
                    : "Upload material"
                }
                cameraLabel="Take a photo"
                allowCamera={!lectureMaterial}
              />

              {fileIsImage && (
                <div className="mt-3 rounded-[15px] border border-white/[0.055] bg-white/[0.01] px-4 py-3">
                  <p className="text-[11px] leading-5 text-white/38">
                    Photos save normally and can be connected to units and topics.
                    For now, choose topics manually. Image document analysis will
                    be connected in a later vision pass.
                  </p>
                </div>
              )}

              <div className="mt-5">
                <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-white/22">
                  Material type
                </p>

                <select
                  value={materialType}
                  onChange={(event) => {
                    const nextType = event.target.value;
                    setMaterialType(nextType);

                    if (nextType === "lecture_recording") {
                      setTopicMode("ai");
                      setSelectedTopicIds([]);
                      setNewTopicSuggestions([]);
                      setSelectedNewTopics([]);
                    }
                  }}
                  className="w-full rounded-[14px] border border-white/[0.075] bg-white/[0.025] px-3.5 py-3 text-[11px] text-white/70 outline-none"
                >
                  <option value="lecture_slides">Lecture slides</option>
                  <option value="lecture_notes">Lecture notes</option>
                  <option value="lecture_recording">Lecture recording / audio</option>
                  <option value="handwritten_notes">Notes</option>
                  <option value="homework">Homework / worksheet</option>
                  <option value="returned_homework">Returned homework</option>
                  <option value="quiz">Quiz</option>
                  <option value="exam">Exam</option>
                  <option value="study_guide">Study guide</option>
                  <option value="textbook">Textbook / reading</option>
                  <option value="reference">Reference</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-2.5">
              {units.map((unit) => {
                const selected = unit.id === unitId;

                return (
                  <button
                    key={unit.id}
                    type="button"
                    onClick={() => {
                      setUnitId(unit.id);
                      setError("");
                    }}
                    className={`flex w-full items-center gap-4 rounded-[18px] border px-4 py-4 text-left transition ${
                      selected
                        ? "border-white/[0.14] bg-white/[0.04]"
                        : "border-white/[0.055] bg-white/[0.01] hover:border-white/[0.09]"
                    }`}
                  >
                    <div
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px]"
                      style={{
                        backgroundColor: `${course.color}0D`,
                        color: course.color,
                      }}
                    >
                      <LibraryBig size={14} />
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] font-medium text-white/68">
                        {unit.name}
                      </p>
                      <p className="mt-1 text-[11px] text-white/22">
                        {unit.topics.length} assigned topics
                      </p>
                    </div>

                    {selected && (
                      <CheckCircle2
                        size={15}
                        style={{ color: course.color }}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {step === 2 && (
            <div>
              {lectureMaterial ? (
                <div>
                  <div className="rounded-[20px] border border-white/[0.06] bg-white/[0.012] p-5">
                    <div className="flex items-start gap-3">
                      <div
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px]"
                        style={{
                          backgroundColor: `${course.color}12`,
                          color: course.color,
                        }}
                      >
                        <Headphones size={16} />
                      </div>

                      <div>
                        <p className="text-[13px] font-medium text-white/70">
                          Lecture audio is organized like any other material.
                        </p>
                        <p className="mt-1.5 text-[11px] leading-5 text-white/36">
                          After transcription, AI will prefer your existing course
                          topics, link the recording into this unit and its topic
                          sections, and create at most one or two genuinely useful
                          subtopics when the course structure does not already cover it.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 rounded-[20px] border border-white/[0.06] bg-white/[0.012] p-5">
                    <div className="flex flex-wrap items-end justify-between gap-4">
                      <div>
                        <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-white/28">
                          Notes depth
                        </p>
                        <p className="mt-2 text-[13px] font-medium text-white/66">
                          {lectureDepthLabel(
                            lectureDepthPercent,
                          )}
                        </p>
                        <p className="mt-1 max-w-md text-[11px] leading-5 text-white/34">
                          Higher depth produces more explanation, sections,
                          terminology, and practice while staying grounded in
                          the lecture.
                        </p>
                      </div>

                      <p
                        className="text-[28px] font-medium tracking-[-0.05em]"
                        style={{ color: course.color }}
                      >
                        {lectureDepthPercent}%
                      </p>
                    </div>

                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={lectureDepthPercent}
                      disabled={saving}
                      onChange={(event) =>
                        setLectureDepthPercent(
                          Number(event.target.value),
                        )
                      }
                      className="mt-5 w-full cursor-pointer accent-white disabled:opacity-40"
                    />

                    <div className="mt-2 flex items-center justify-between text-[9px] font-medium uppercase tracking-[0.1em] text-white/22">
                      <span>Quick</span>
                      <span>Balanced</span>
                      <span>Deep</span>
                    </div>
                  </div>

                  {lectureProcessMessage && (
                    <div className="mt-4 flex items-center gap-2 rounded-[15px] border border-white/[0.055] bg-white/[0.01] px-4 py-3">
                      {saving && (
                        <Loader2
                          size={12}
                          className="animate-spin text-white/38"
                        />
                      )}
                      <p className="text-[11px] text-white/42">
                        {lectureProcessMessage}
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <>
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setTopicMode("manual")}
                  className={`rounded-[18px] border p-4 text-left transition ${
                    topicMode === "manual"
                      ? "border-white/[0.14] bg-white/[0.04]"
                      : "border-white/[0.055] bg-white/[0.01]"
                  }`}
                >
                  <p className="text-[11px] font-medium text-white/66">
                    Choose manually
                  </p>
                  <p className="mt-1.5 text-[9px] leading-4 text-white/23">
                    Select every syllabus topic this file relates to.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (!fileIsImage) {
                      setTopicMode("ai");
                    }
                  }}
                  disabled={fileIsImage}
                  className={`rounded-[18px] border p-4 text-left transition ${
                    topicMode === "ai"
                      ? "border-white/[0.14] bg-white/[0.04]"
                      : "border-white/[0.055] bg-white/[0.01]"
                  } ${
                    fileIsImage
                      ? "cursor-not-allowed opacity-35"
                      : ""
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Sparkles size={12} style={{ color: course.color }} />
                    <p className="text-[11px] font-medium text-white/66">
                      Let AI choose
                    </p>
                  </div>
                  <p className="mt-1.5 text-[9px] leading-4 text-white/23">
                    {fileIsImage
                      ? "Photo reading comes with document vision. Use manual topics for now."
                      : "AI strongly prefers syllabus topics and adds a new one only when the material truly does not fit."}
                  </p>
                </button>
              </div>

              {topicMode === "ai" && (
                <div className="mt-4 rounded-[18px] border border-white/[0.055] bg-white/[0.01] p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-[10px] font-medium text-white/58">
                        AI topic attribution
                      </p>
                      <p className="mt-1 text-[9px] leading-4 text-white/22">
                        It reads the material, then checks the selected unit plus
                        unassigned syllabus topics.
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={analyzeTopics}
                      disabled={analyzing}
                      className="flex items-center justify-center gap-2 rounded-full bg-white px-3.5 py-2 text-[11px] font-medium text-black disabled:opacity-50"
                    >
                      {analyzing ? (
                        <Loader2 size={11} className="animate-spin" />
                      ) : (
                        <Sparkles size={11} />
                      )}
                      {analyzing ? "Analyzing" : "Analyze topics"}
                    </button>
                  </div>

                  {(aiRationale ||
                    aiConfidence !== null ||
                    aiSuggestedFileName) && (
                    <div className="mt-4 border-t border-white/[0.045] pt-4">
                      {aiSuggestedFileName && (
                        <div className="mb-3 rounded-[13px] border border-white/[0.05] bg-white/[0.01] px-3.5 py-3">
                          <p className="text-[8px] font-medium uppercase tracking-[0.12em] text-white/18">
                            Clean filename
                          </p>
                          <p className="mt-1.5 truncate text-[10px] font-medium text-white/48">
                            {aiSuggestedFileName}
                          </p>
                        </div>
                      )}
                      <p className="text-[9px] leading-4 text-white/30">
                        {aiRationale}
                      </p>
                      {aiConfidence !== null && (
                        <p className="mt-2 text-[8px] text-white/18">
                          {Math.round(aiConfidence)}% confidence
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="mt-5">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-white/22">
                    Topics
                  </p>
                  <p className="text-[8px] text-white/18">
                    Multi-select
                  </p>
                </div>

                <div className="max-h-[280px] space-y-2 overflow-y-auto pr-1">
                  {candidateTopics.map((topic) => {
                    const selected = selectedTopicIds.includes(topic.id);
                    const wasUnassigned = !topic.unit_id;

                    return (
                      <button
                        key={topic.id}
                        type="button"
                        onClick={() => toggleTopic(topic.id)}
                        className={`flex w-full items-center gap-3 rounded-[14px] border px-3.5 py-3 text-left transition ${
                          selected
                            ? "border-white/[0.13] bg-white/[0.04]"
                            : "border-white/[0.05] bg-white/[0.008]"
                        }`}
                      >
                        <div
                          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border ${
                            selected
                              ? "border-transparent"
                              : "border-white/[0.12]"
                          }`}
                          style={{
                            backgroundColor: selected
                              ? course.color
                              : "transparent",
                          }}
                        >
                          {selected && (
                            <CheckCircle2 size={10} className="text-black" />
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[10px] font-medium text-white/56">
                            {topic.name}
                          </p>
                          <p className="mt-0.5 text-[8px] text-white/18">
                            {wasUnassigned
                              ? "Unassigned syllabus topic"
                              : topic.parent_topic_id
                                ? "Existing subtopic"
                                : "Existing topic"}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {newTopicSuggestions.length > 0 && (
                <div className="mt-5">
                  <div className="mb-3 flex items-center gap-2">
                    <Sparkles size={11} style={{ color: course.color }} />
                    <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-white/22">
                      AI-detected new topics
                    </p>
                  </div>

                  <div className="space-y-2">
                    {newTopicSuggestions.map((topic) => {
                      const selected = selectedNewTopics.includes(topic.name);

                      return (
                        <button
                          key={topic.name}
                          type="button"
                          onClick={() => toggleNewTopic(topic.name)}
                          className={`w-full rounded-[14px] border px-3.5 py-3 text-left transition ${
                            selected
                              ? "border-white/[0.13] bg-white/[0.04]"
                              : "border-white/[0.05] bg-white/[0.008]"
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <div
                              className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px]"
                              style={{
                                backgroundColor: selected
                                  ? course.color
                                  : "rgba(255,255,255,0.045)",
                              }}
                            >
                              {selected && (
                                <CheckCircle2 size={10} className="text-black" />
                              )}
                            </div>

                            <div>
                              <p className="text-[10px] font-medium text-white/62">
                                {topic.name}
                              </p>
                              <p className="mt-1 text-[8px] leading-4 text-white/22">
                                {topic.reason}
                              </p>
                              {topic.parentTopicId && (
                                <p className="mt-1 text-[8px] text-white/16">
                                  Will be added as a subtopic.
                                </p>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
                </>
              )}
            </div>
          )}
        </div>

        <div className="relative flex items-center justify-between gap-3 border-t border-white/[0.06] px-5 py-4 sm:px-7">
          <button
            type="button"
            onClick={() => {
              if (step === 0) {
                onClose();
              } else {
                setError("");
                setStep((current) => Math.max(0, current - 1));
              }
            }}
            className="rounded-full px-3 py-2 text-[10px] font-medium text-white/34 transition hover:bg-white/[0.03] hover:text-white/60"
          >
            {step === 0 ? "Cancel" : "Back"}
          </button>

          {step === 0 ? (
            <button
              type="button"
              onClick={nextFromFile}
              className="rounded-full bg-white px-4 py-2.5 text-[10px] font-medium text-black"
            >
              Continue
            </button>
          ) : step === 1 ? (
            <button
              type="button"
              onClick={nextFromUnit}
              className="rounded-full bg-white px-4 py-2.5 text-[10px] font-medium text-black"
            >
              Continue
            </button>
          ) : (
            <button
              type="button"
              onClick={saveMaterial}
              disabled={saving || analyzing}
              className="flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-[10px] font-medium text-black disabled:opacity-50"
            >
              {saving && <Loader2 size={11} className="animate-spin" />}
              {saving
                ? lectureMaterial
                  ? "Processing lecture"
                  : "Saving material"
                : lectureMaterial
                  ? "Process lecture"
                  : "Save material"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}


function sanitizeFileName(fileName: string) {
  const extensionMatch = fileName.match(/(\.[a-zA-Z0-9]+)$/);
  const extension = extensionMatch?.[1] ?? "";
  const baseName = extension
    ? fileName.slice(0, -extension.length)
    : fileName;

  const safeBaseName = baseName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 120);

  return `${safeBaseName || "file"}${extension.toLowerCase()}`;
}

function escapeHtmlForPrint(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function materialTypeLabel(value: string) {
  const labels: Record<string, string> = {
    lecture_slides: "Lecture slides",
    lecture_notes: "Lecture notes",
    lecture_recording: "Lecture recording",
    handwritten_notes: "Notes",
    homework: "Homework / worksheet",
    returned_homework: "Returned homework",
    quiz: "Quiz",
    exam: "Exam",
    study_guide: "Study guide",
    textbook: "Textbook / reading",
    reference: "Reference",
    other: "Other",
  };

  return labels[value] ?? "Material";
}

function GradesTab({ course }: { course: Course }) {
  return (
    <section>
      <div className="grid gap-12 xl:grid-cols-[1fr_360px]">
        <div>
          <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.16em] text-white/22">
            Gradebook
          </p>

          <h2 className="text-[28px] font-medium tracking-[-0.04em]">
            Grades
          </h2>

          <p className="mt-2 max-w-xl text-[13px] leading-6 text-white/30">
            Track every score and understand exactly where you stand in the
            course.
          </p>

          <div className="mt-10 overflow-hidden rounded-[28px] border border-white/[0.07] bg-[#101012]">
            <div className="p-7 sm:p-9">
              <div
                className="mb-7 flex h-10 w-10 items-center justify-center rounded-[13px]"
                style={{
                  backgroundColor: `${course.color}10`,
                  color: course.color,
                }}
              >
                <TrendingUp size={18} />
              </div>

              <h3 className="text-[24px] font-medium tracking-[-0.04em]">
                Set up your grading structure.
              </h3>

              <p className="mt-3 max-w-lg text-[13px] leading-6 text-white/30">
                Add categories such as homework, quizzes, midterms, labs, and
                the final exam. Later, your syllabus will be able to populate
                these automatically.
              </p>

              <button className="mt-8 rounded-full bg-white px-4 py-2.5 text-[12px] font-medium text-black">
                Set up grading
              </button>
            </div>
          </div>
        </div>

        <aside>
          <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.16em] text-white/22">
            Current standing
          </p>

          <h2 className="mb-7 text-[24px] font-medium tracking-[-0.04em]">
            Performance
          </h2>

          <div className="border-y border-white/[0.06] py-6">
            <p className="text-[10px] uppercase tracking-[0.14em] text-white/20">
              Current grade
            </p>

            <p className="mt-3 text-[48px] font-medium tracking-[-0.06em] text-white/75">
              --
            </p>

            <p className="mt-1 text-[11px] text-white/22">
              No graded work yet
            </p>
          </div>

          <div className="mt-7">
            <StatusRow
              label="Grading categories"
              value="Not configured"
              muted
            />

            <StatusRow
              label="Graded items"
              value="0"
            />

            <StatusRow
              label="Projected grade"
              value="Unavailable"
              muted
            />
          </div>
        </aside>
      </div>
    </section>
  );
}

function SyllabusSetupRow({
  syllabus,
  uploading,
  error,
  color,
  analyzing,
  analysisProgress,
  analyzed,
  onChoose,
  onAnalyze,
  onOpen,
  onDelete,
}: {
  syllabus: CourseFile | null;
  uploading: boolean;
  error: string;
  color: string;
  analyzing: boolean;
  analysisProgress: string;
  analyzed: boolean;
  onChoose: () => void;
  onAnalyze: () => void;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="min-w-0 overflow-hidden rounded-[24px] border border-white/[0.07] bg-white/[0.018]">
      <div className="group flex min-w-0 items-start gap-4 p-5 transition hover:bg-white/[0.02]">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px]"
          style={{ backgroundColor: `${color}10` }}
        >
          {uploading || analyzing ? (
            <Loader2
              size={17}
              className="animate-spin"
              style={{ color }}
            />
          ) : syllabus ? (
            <CheckCircle2 size={17} style={{ color }} />
          ) : (
            <FileText size={17} style={{ color }} />
          )}
        </div>

        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-[13px] font-medium text-white/78">
              Course syllabus
            </p>

            {syllabus && !uploading && (
              <span
                className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                style={{
                  backgroundColor: `${color}12`,
                  color,
                }}
              >
                {analyzed ? "Analyzed" : "Uploaded"}
              </span>
            )}
          </div>

          {uploading ? (
            <p className="mt-1 text-[11px] leading-5 text-white/27">
              Uploading your syllabus securely...
            </p>
          ) : analyzing ? (
            <p className="mt-1 text-[11px] leading-5 text-white/27">
              {analysisProgress || "AI is analyzing this syllabus..."}
            </p>
          ) : syllabus ? (
            <div className="mt-1 min-w-0">
              <p className="truncate text-[11px] leading-5 text-white/38">
                {syllabus.file_name}
              </p>

              <p className="text-[10px] text-white/20">
                {formatFileSize(syllabus.size_bytes)} · {analyzed ? "Analyzed and applied" : "Ready for AI analysis"}
              </p>
            </div>
          ) : (
            <p className="mt-1 text-[11px] leading-5 text-white/27">
              Grading, assessments, dates, and explicit schedule topics.
            </p>
          )}
        </div>

      </div>

      <div className="flex min-h-14 flex-wrap items-center gap-2 border-t border-white/[0.055] bg-black/[0.08] px-5 py-3">
          {syllabus && !uploading && !analyzed && (
            <button
              type="button"
              onClick={onAnalyze}
              disabled={analyzing}
              className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-white px-3 text-[10px] font-medium text-black transition hover:bg-white/88 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {analyzing ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Sparkles size={12} />
              )}
              {analyzing ? "Analyzing" : "Analyze"}
            </button>
          )}

          {syllabus && !uploading && analyzed && (
            <div
              className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[10px] font-medium"
              style={{
                borderColor: `${color}22`,
                backgroundColor: `${color}09`,
                color,
              }}
            >
              <CheckCircle2 size={12} />
              Analyzed
            </div>
          )}

          {syllabus && !uploading && (
            <button
              type="button"
              onClick={onOpen}
              className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-white/[0.07] px-3 text-[10px] font-medium text-white/42 transition hover:bg-white/[0.04] hover:text-white/70"
            >
              <ExternalLink size={12} />
              View
            </button>
          )}

          <button
            type="button"
            onClick={onChoose}
            disabled={uploading || analyzing}
            className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-white/[0.07] px-3 text-[10px] font-medium text-white/48 transition hover:bg-white/[0.04] hover:text-white/70 disabled:cursor-not-allowed disabled:opacity-35"
          >
            {uploading
              ? "Uploading..."
              : syllabus
                ? "Replace"
                : "Upload syllabus"}

            {!uploading && <ChevronRight size={12} />}
          </button>

          {syllabus && !uploading && !analyzing && (
            <button
              type="button"
              onClick={onDelete}
              aria-label="Delete syllabus"
              className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/[0.06] text-white/24 transition hover:bg-red-500/10 hover:text-red-400"
            >
              <Trash2 size={13} />
            </button>
          )}
      </div>

      {error && (
        <div className="border-t border-red-500/10 bg-red-500/[0.035] px-5 py-3">
          <p className="text-[10px] text-red-300/75">
            {error}
          </p>
        </div>
      )}
    </div>
  );
}

function SyllabusAnalysisPanel({
  analysis,
  color,
}: {
  analysis: SyllabusAnalysis;
  color: string;
}) {
  const info = analysis.courseInfo;
  const totalTopics =
    analysis.units.reduce((sum, unit) => sum + unit.topics.length, 0) +
    analysis.unassignedTopics.length;

  return (
    <div className="overflow-hidden rounded-[26px] border border-white/[0.07] bg-[#101012]">
      <div className="border-b border-white/[0.055] p-6 sm:p-7">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px]"
              style={{ backgroundColor: `${color}12` }}
            >
              <Sparkles size={17} style={{ color }} />
            </div>

            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[13px] font-medium text-white/82">
                  Syllabus intelligence
                </p>
                <span
                  className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                  style={{ backgroundColor: `${color}12`, color }}
                >
                  {Math.round(analysis.overallConfidence)}% confidence
                </span>
              </div>

              <p className="mt-2 max-w-xl text-[11px] leading-5 text-white/28">
                AI extracted the course setup and any study structure that
                is explicitly supported by the syllabus. Nothing here has been
                saved to your course yet.
              </p>
            </div>
          </div>

          <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/22">
            Review only
          </span>
        </div>
      </div>

      <div className="grid lg:grid-cols-2">
        <AnalysisSection title="Course details">
          <AnalysisValue label="Course code" value={info.courseCode} />
          <AnalysisValue label="Course name" value={info.courseName} />
          <AnalysisValue label="Professor" value={info.professor} />
          <AnalysisValue label="Term" value={info.term} />
          <AnalysisValue
            label="Credits"
            value={info.credits > 0 ? formatCredits(info.credits) : "Not found"}
            last
          />
        </AnalysisSection>

        <AnalysisSection title="Grading structure" bordered>
          {analysis.gradingCategories.length > 0 ? (
            analysis.gradingCategories.map((category, index) => (
              <AnalysisListRow
                key={`${category.name}-${index}`}
                title={category.name}
                value={
                  category.weightPercent > 0
                    ? `${category.weightPercent}%`
                    : "Weight not stated"
                }
                description={category.notes}
                last={index === analysis.gradingCategories.length - 1}
              />
            ))
          ) : (
            <AnalysisEmpty text="No grading categories were clearly identified." />
          )}
        </AnalysisSection>
      </div>

      <div className="grid border-t border-white/[0.055] lg:grid-cols-2">
        <AnalysisSection title="Major assessments">
          {analysis.assessments.length > 0 ? (
            analysis.assessments.map((assessment, index) => (
              <AnalysisListRow
                key={`${assessment.name}-${index}`}
                title={assessment.name}
                value={assessment.date || assessment.type || "Listed"}
                description={assessment.notes}
                last={index === analysis.assessments.length - 1}
              />
            ))
          ) : (
            <AnalysisEmpty text="No major assessments were clearly identified." />
          )}
        </AnalysisSection>

        <AnalysisSection title="Important dates" bordered>
          {analysis.importantDates.length > 0 ? (
            analysis.importantDates.map((item, index) => (
              <AnalysisListRow
                key={`${item.name}-${index}`}
                title={item.name}
                value={item.date || "Date not stated"}
                description={item.type}
                last={index === analysis.importantDates.length - 1}
              />
            ))
          ) : (
            <AnalysisEmpty text="No important dates were clearly identified." />
          )}
        </AnalysisSection>
      </div>

      <div className="border-t border-white/[0.055] p-6 sm:p-7">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.15em] text-white/20">
              Study structure
            </p>
            <p className="mt-2 text-[13px] font-medium text-white/70">
              {analysis.units.length > 0
                ? `${analysis.units.length} ${
                    analysis.units.length === 1 ? "unit" : "units"
                  } · ${totalTopics} explicit ${
                    totalTopics === 1 ? "topic" : "topics"
                  }`
                : `${totalTopics} explicit ${
                    totalTopics === 1 ? "topic" : "topics"
                  }`}
            </p>
          </div>

          <p className="max-w-md text-right text-[10px] leading-5 text-white/22">
            These are seed topics from the syllabus only. Lecture slides,
            assignments, notes, and other materials will refine them later.
          </p>
        </div>

        {analysis.units.length > 0 ? (
          <div className="mt-6 space-y-4">
            {analysis.units.map((unit, unitIndex) => (
              <div
                key={`${unit.name}-${unitIndex}`}
                className="overflow-hidden rounded-[18px] border border-white/[0.06] bg-white/[0.018]"
              >
                <div className="border-b border-white/[0.05] px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-[12px] font-medium text-white/72">
                        {unit.name}
                      </p>
                      {(unit.coverage || unit.assessmentName) && (
                        <p className="mt-1 text-[10px] text-white/27">
                          {[unit.assessmentName, unit.coverage]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      )}
                    </div>

                    <span
                      className="rounded-full px-2 py-1 text-[11px] font-medium"
                      style={{
                        backgroundColor: `${color}10`,
                        color,
                      }}
                    >
                      {unit.topics.length}{" "}
                      {unit.topics.length === 1 ? "topic" : "topics"}
                    </span>
                  </div>

                  {(unit.description || unit.basis) && (
                    <p className="mt-2 max-w-3xl text-[10px] leading-5 text-white/24">
                      {unit.description || unit.basis}
                    </p>
                  )}
                </div>

                {unit.topics.length > 0 ? (
                  <div>
                    {unit.topics.map((topic, topicIndex) => (
                      <div
                        key={`${topic.name}-${topic.date}-${topicIndex}`}
                        className={`grid gap-2 px-5 py-3 sm:grid-cols-[1fr_auto] sm:items-start ${
                          topicIndex === unit.topics.length - 1
                            ? ""
                            : "border-b border-white/[0.045]"
                        }`}
                      >
                        <div>
                          <p className="text-[11px] text-white/58">
                            {topic.name}
                          </p>
                          {(topic.reading || topic.assignment) && (
                            <p className="mt-1 text-[9px] leading-4 text-white/22">
                              {[topic.reading, topic.assignment]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                          )}
                        </div>

                        {topic.date && (
                          <p className="text-[9px] text-white/25">
                            {topic.date}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="px-5 py-4">
                    <AnalysisEmpty text="No explicit topics were assigned to this unit." />
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : analysis.unassignedTopics.length > 0 ? (
          <div className="mt-6 overflow-hidden rounded-[18px] border border-white/[0.06] bg-white/[0.018]">
            {analysis.unassignedTopics.map((topic, index) => (
              <div
                key={`${topic.name}-${topic.date}-${index}`}
                className={`grid gap-2 px-5 py-3 sm:grid-cols-[1fr_auto] ${
                  index === analysis.unassignedTopics.length - 1
                    ? ""
                    : "border-b border-white/[0.045]"
                }`}
              >
                <div>
                  <p className="text-[11px] text-white/58">{topic.name}</p>
                  {(topic.reading || topic.assignment) && (
                    <p className="mt-1 text-[9px] leading-4 text-white/22">
                      {[topic.reading, topic.assignment]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  )}
                </div>

                {topic.date && (
                  <p className="text-[9px] text-white/25">{topic.date}</p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-4">
            <AnalysisEmpty text="No explicit units or scheduled topics were identified in this syllabus." />
          </div>
        )}
      </div>

      {(analysis.scheduleNotes.length > 0 || analysis.warnings.length > 0) && (
        <div className="border-t border-white/[0.055] p-6 sm:p-7">
          {analysis.scheduleNotes.length > 0 && (
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.15em] text-white/20">
                Other schedule details
              </p>
              <div className="mt-3 space-y-2">
                {analysis.scheduleNotes.map((note, index) => (
                  <p
                    key={`${note}-${index}`}
                    className="text-[11px] leading-5 text-white/34"
                  >
                    {note}
                  </p>
                ))}
              </div>
            </div>
          )}

          {analysis.warnings.length > 0 && (
            <div className={analysis.scheduleNotes.length > 0 ? "mt-6" : ""}>
              <p className="text-[11px] font-medium uppercase tracking-[0.15em] text-amber-200/45">
                Needs your review
              </p>
              <div className="mt-3 space-y-2">
                {analysis.warnings.map((warning, index) => (
                  <p
                    key={`${warning}-${index}`}
                    className="text-[11px] leading-5 text-amber-100/45"
                  >
                    {warning}
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AnalysisSection({
  title,
  children,
  bordered = false,
}: {
  title: string;
  children: React.ReactNode;
  bordered?: boolean;
}) {
  return (
    <div
      className={`p-6 sm:p-7 ${
        bordered ? "border-t border-white/[0.055] lg:border-l lg:border-t-0" : ""
      }`}
    >
      <p className="mb-4 text-[11px] font-medium uppercase tracking-[0.15em] text-white/20">
        {title}
      </p>
      <div>{children}</div>
    </div>
  );
}

function AnalysisValue({
  label,
  value,
  last = false,
}: {
  label: string;
  value: string;
  last?: boolean;
}) {
  const displayValue = value.trim() || "Not found";

  return (
    <div
      className={`flex items-start justify-between gap-5 py-3 ${
        last ? "" : "border-b border-white/[0.045]"
      }`}
    >
      <p className="text-[10px] text-white/25">{label}</p>
      <p className="max-w-[65%] text-right text-[11px] text-white/65">
        {displayValue}
      </p>
    </div>
  );
}

function AnalysisListRow({
  title,
  value,
  description,
  last = false,
}: {
  title: string;
  value: string;
  description: string;
  last?: boolean;
}) {
  return (
    <div className={last ? "py-3" : "border-b border-white/[0.045] py-3"}>
      <div className="flex items-start justify-between gap-4">
        <p className="text-[11px] font-medium text-white/62">{title}</p>
        {value && (
          <p className="shrink-0 text-[10px] text-white/32">{value}</p>
        )}
      </div>
      {description && (
        <p className="mt-1.5 text-[10px] leading-5 text-white/25">
          {description}
        </p>
      )}
    </div>
  );
}

function AnalysisEmpty({ text }: { text: string }) {
  return <p className="py-3 text-[10px] leading-5 text-white/22">{text}</p>;
}

function SetupRow({
  icon: Icon,
  title,
  description,
  action,
  color,
  busy = false,
  status,
  error,
  onAction,
  onView,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  action: string;
  color: string;
  busy?: boolean;
  status?: string;
  error?: string;
  onAction?: () => void;
  onView?: () => void;
}) {
  return (
    <div className="min-w-0 overflow-hidden rounded-[24px] border border-white/[0.07] bg-white/[0.018]">
      <div className="group flex min-w-0 items-start gap-4 p-5 transition hover:bg-white/[0.02]">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px]"
          style={{ backgroundColor: `${color}10` }}
        >
          {busy ? <Loader2 size={17} className="animate-spin" style={{ color }} /> : <Icon size={17} style={{ color }} />}
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[13px] font-medium text-white/78">{title}</p>
            {status && (
              <span className="rounded-full px-2 py-0.5 text-[9px] font-medium" style={{ backgroundColor: `${color}12`, color }}>
                {status}
              </span>
            )}
          </div>

          <p className="mt-1 truncate text-[11px] leading-5 text-white/27">
            {busy ? "Uploading your course calendar securely…" : description}
          </p>
        </div>

      </div>

      <div className="flex min-h-14 flex-wrap items-center gap-2 border-t border-white/[0.055] bg-black/[0.08] px-5 py-3">
          {onView && (
            <button type="button" onClick={onView} className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-white/[0.07] px-3 text-[10px] font-medium text-white/42 transition hover:bg-white/[0.04] hover:text-white/70">
              <ExternalLink size={12} /> View
            </button>
          )}
          <button
            type="button"
            onClick={onAction}
            disabled={busy || !onAction}
            className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-white/[0.07] bg-white/[0.02] px-3 text-[10px] font-medium text-white/48 transition hover:bg-white/[0.045] hover:text-white/78 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Uploading…" : action}
            {!busy && <ChevronRight size={12} />}
          </button>
      </div>
      {error && (
        <div className="border-t border-red-500/10 bg-red-500/[0.035] px-5 py-3 sm:pl-[84px]">
          <p className="text-[10px] text-red-300/75">{error}</p>
        </div>
      )}
    </div>
  );
}

function CourseMetric({
  value,
  label,
}: {
  value: string;
  label: string;
}) {
  return (
    <div className="border-l border-white/[0.07] pl-5">
      <p className="text-[30px] font-medium tracking-[-0.05em] text-white/82">
        {value}
      </p>

      <p className="mt-1 text-[9px] uppercase tracking-[0.13em] text-white/20">
        {label}
      </p>
    </div>
  );
}

function StatusRow({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between border-b border-white/[0.055] py-4 first:border-t">
      <p className="text-[11px] text-white/28">{label}</p>

      <p
        className={`text-[11px] ${
          muted ? "text-white/23" : "text-white/70"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function MaterialType({
  icon: Icon,
  title,
  color,
}: {
  icon: React.ElementType;
  title: string;
  color: string;
}) {
  return (
    <div className="border-t border-white/[0.06] pt-5">
      <Icon
        size={16}
        style={{ color }}
        className="mb-3"
      />

      <p className="text-[12px] text-white/55">{title}</p>

      <p className="mt-1 text-[10px] text-white/19">
        No files
      </p>
    </div>
  );
}

function CourseActionsMenu({
  onArchive,
  onDelete,
}: {
  onArchive: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="absolute right-0 top-11 z-[80] w-44 overflow-hidden rounded-[14px] border border-white/[0.08] bg-[#171719]/98 p-1.5 shadow-2xl shadow-black/50 backdrop-blur-2xl">
      <button
        type="button"
        onClick={onArchive}
        className="flex w-full items-center gap-2.5 rounded-[9px] px-3 py-2.5 text-left text-[11px] text-white/48 transition hover:bg-white/[0.045] hover:text-white/76"
      >
        <Archive size={13} />
        Archive course
      </button>

      <div className="my-1 h-px bg-white/[0.05]" />

      <button
        type="button"
        onClick={onDelete}
        className="flex w-full items-center gap-2.5 rounded-[9px] px-3 py-2.5 text-left text-[11px] text-red-300/60 transition hover:bg-red-500/[0.08] hover:text-red-200/85"
      >
        <Trash2 size={13} />
        Delete permanently
      </button>
    </div>
  );
}

function ArchiveCourseDialog({
  course,
  grade,
  archiving,
  onGradeChange,
  onClose,
  onArchive,
}: {
  course: Course;
  grade: string;
  archiving: boolean;
  onGradeChange: (value: string) => void;
  onClose: () => void;
  onArchive: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[130] flex items-end justify-center bg-black/70 backdrop-blur-xl sm:items-center sm:p-6">
      <button
        type="button"
        onClick={onClose}
        className="absolute inset-0"
        aria-label="Close archive dialog"
      />

      <div className="relative z-10 w-full max-w-[520px] overflow-hidden rounded-t-[26px] border border-white/[0.08] bg-[#101012] shadow-2xl shadow-black/55 sm:rounded-[26px]">
        <div
          className="pointer-events-none absolute right-[-80px] top-[-120px] h-[260px] w-[260px] rounded-full opacity-[0.08] blur-[90px]"
          style={{ backgroundColor: course.color }}
        />

        <div className="relative p-6 sm:p-7">
          <div className="flex items-start justify-between gap-5">
            <div>
              <div
                className="flex h-10 w-10 items-center justify-center rounded-[13px]"
                style={{
                  backgroundColor: `${course.color}10`,
                  color: course.color,
                }}
              >
                <Archive size={16} />
              </div>

              <h2 className="mt-5 text-[25px] font-medium tracking-[-0.045em]">
                Archive {course.code}?
              </h2>

              <p className="mt-2 max-w-md text-[11px] leading-5 text-white/30">
                The course leaves your active semester. Its materials and study
                workspace stay stored, but the archive view only shows the
                course and your final grade.
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.04] text-white/30"
            >
              <X size={14} />
            </button>
          </div>

          <label className="mt-6 block">
            <span className="mb-2 block text-[9px] font-medium uppercase tracking-[0.12em] text-white/22">
              Final grade
            </span>

            <input
              value={grade}
              onChange={(event) => onGradeChange(event.target.value)}
              placeholder="A, 92.4%, 3.7, or leave blank"
              className="w-full rounded-[14px] border border-white/[0.075] bg-white/[0.025] px-3.5 py-3 text-[12px] text-white/76 outline-none transition placeholder:text-white/18 focus:border-white/15 focus:bg-white/[0.04]"
            />
          </label>

          <div className="mt-7 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full px-4 py-2.5 text-[10px] font-medium text-white/34 transition hover:bg-white/[0.035] hover:text-white/62"
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={onArchive}
              disabled={archiving}
              className="flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-[10px] font-medium text-black transition hover:bg-white/90 disabled:opacity-50"
            >
              {archiving ? (
                <Loader2 size={11} className="animate-spin" />
              ) : (
                <Archive size={11} />
              )}
              {archiving ? "Archiving" : "Archive course"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SidebarTab({
  icon: Icon,
  label,
  active,
  color,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  active: boolean;
  color: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative flex w-full items-center gap-3 rounded-[11px] px-3 py-[10px] text-[12px] transition ${
        active
          ? "bg-white/[0.055] text-white/88"
          : "text-white/34 hover:bg-white/[0.03] hover:text-white/65"
      }`}
    >
      {active && (
        <div
          className="absolute left-0 h-4 w-[2px] rounded-full"
          style={{ backgroundColor: color }}
        />
      )}

      <Icon size={16} strokeWidth={active ? 2.1 : 1.7} />
      {label}
    </button>
  );
}

function MobileTab({
  label,
  active,
  onClick,
  color,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  color: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative shrink-0 px-3 pb-3 text-[11px] transition ${
        active ? "text-white/85" : "text-white/28"
      }`}
    >
      {label}

      {active && (
        <div
          className="absolute bottom-0 left-3 right-3 h-[2px] rounded-full"
          style={{ backgroundColor: color }}
        />
      )}
    </button>
  );
}

function CourseLoading() {
  return (
    <main className="min-h-screen bg-[#080809] text-white">
      <div className="mx-auto max-w-[1200px] animate-pulse px-8 py-16">
        <div className="h-3 w-24 rounded bg-white/[0.05]" />

        <div className="mt-10 h-12 w-[520px] max-w-full rounded-lg bg-white/[0.055]" />

        <div className="mt-4 h-3 w-64 rounded bg-white/[0.035]" />

        <div className="mt-14 h-px bg-white/[0.05]" />

        <div className="mt-12 h-72 rounded-[28px] bg-white/[0.03]" />
      </div>
    </main>
  );
}

function formatFileSize(value: number | null) {
  if (value === null) {
    return "Size unavailable";
  }

  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatCredits(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
