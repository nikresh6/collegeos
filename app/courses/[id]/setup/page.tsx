"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileText,
  GraduationCap,
  Layers3,
  Loader2,
  PencilLine,
  Percent,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  AnimatePresence,
  motion,
  MotionConfig,
} from "framer-motion";
import { supabase } from "../../../../lib/supabase";

type Course = {
  id: string;
  code: string;
  name: string;
  professor: string;
  credits: number;
  color: string;
};

type Topic = {
  name: string;
  date: string;
  reading: string;
  assignment: string;
};

type Unit = {
  name: string;
  description: string;
  basisType: "explicit_unit" | "assessment_block";
  basis: string;
  assessmentName: string;
  coverage: string;
  topics: Topic[];
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
  units: Unit[];
  unassignedTopics: Topic[];
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

type AnalysisRow = {
  id: string;
  course_file_id: string | null;
  raw_analysis: unknown;
  edited_analysis: unknown;
  status: "draft" | "confirmed" | "superseded";
  confidence: number | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/%/g, "").trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function normalizeAnalysis(value: unknown): SyllabusAnalysis {
  const raw = isRecord(value) ? value : {};
  const courseCandidate =
    raw.courseInfo ?? raw.courseInformation ?? raw.course_information;
  const course = isRecord(courseCandidate) ? courseCandidate : {};

  const getArray = (...keys: string[]) => {
    for (const key of keys) {
      if (Array.isArray(raw[key])) return raw[key] as unknown[];
    }
    return [];
  };

  const normalizeTopic = (entry: unknown): Topic => {
    const item = isRecord(entry) ? entry : {};
    return {
      name: stringValue(
        item.name ?? item.topic ?? item.title ?? item.lectureTitle ?? item.lecture,
      ),
      date: stringValue(item.date ?? item.when ?? item.scheduledDate),
      reading: stringValue(
        item.reading ?? item.readings ?? item.chapter ?? item.chapters,
      ),
      assignment: stringValue(
        item.assignment ?? item.assignments ?? item.due ?? item.work,
      ),
    };
  };

  const gradingCategories = getArray(
    "gradingCategories",
    "gradingStructure",
    "grading_categories",
  )
    .map((entry) => {
      const item = isRecord(entry) ? entry : {};
      return {
        name: stringValue(item.name ?? item.category ?? item.title),
        weightPercent: numberValue(
          item.weightPercent ?? item.weight ?? item.percentage ?? item.percent,
        ),
        notes: stringValue(
          item.notes ?? item.details ?? item.description ?? item.summary,
        ),
      };
    })
    .filter((item) => item.name);

  const gradingScale = getArray(
    "gradingScale",
    "gradeScale",
    "letterGradeScale",
    "grading_scale",
  )
    .map((entry) => {
      const item = isAnalysisRecord(entry) ? entry : {};
      return {
        letterGrade: analysisString(
          item.letterGrade ?? item.grade ?? item.letter ?? item.label,
        ),
        minPercent: analysisNumber(
          item.minPercent ?? item.minimum ?? item.min ?? item.lowerBound,
        ),
        maxPercent: analysisNumber(
          item.maxPercent ?? item.maximum ?? item.max ?? item.upperBound,
        ),
        notes: analysisString(
          item.notes ?? item.details ?? item.description,
        ),
      };
    })
    .filter((item) => item.letterGrade);

  const assessments = getArray("assessments", "majorAssessments")
    .map((entry) => {
      const item = isRecord(entry) ? entry : {};
      return {
        name: stringValue(item.name ?? item.title ?? item.event),
        type: stringValue(item.type ?? item.category ?? item.kind),
        date: stringValue(item.date ?? item.dueDate ?? item.examDate),
        notes: stringValue(
          item.notes ?? item.details ?? item.description ?? item.summary,
        ),
      };
    })
    .filter((item) => item.name || item.date);

  const units = getArray(
    "units",
    "courseUnits",
    "studyUnits",
    "modules",
    "course_units",
  )
    .map((entry) => {
      const item = isRecord(entry) ? entry : {};
      const topicCandidates =
        item.topics ??
        item.explicitTopics ??
        item.lectures ??
        item.scheduledTopics;

      const rawBasisType = stringValue(
        item.basisType ?? item.basis_type ?? item.sourceType,
      );

      return {
        name: stringValue(item.name ?? item.title ?? item.unit ?? item.module),
        description: stringValue(
          item.description ?? item.details ?? item.summary,
        ),
        basisType:
          rawBasisType === "explicit_unit"
            ? ("explicit_unit" as const)
            : ("assessment_block" as const),
        basis: stringValue(
          item.basis ?? item.evidence ?? item.reason ?? item.source,
        ),
        assessmentName: stringValue(
          item.assessmentName ?? item.assessment ?? item.exam,
        ),
        coverage: stringValue(
          item.coverage ?? item.contentCoverage ?? item.chapters,
        ),
        topics: Array.isArray(topicCandidates)
          ? topicCandidates.map(normalizeTopic).filter((topic) => topic.name)
          : [],
      };
    })
    .filter((item) => item.name || item.topics.length > 0);

  return {
    courseInfo: {
      courseCode: stringValue(
        course.courseCode ?? course.code ?? course.course_code,
      ),
      courseName: stringValue(
        course.courseName ??
          course.courseTitle ??
          course.title ??
          course.course_name,
      ),
      professor: stringValue(
        course.professor ??
          course.instructor ??
          course.teacher ??
          course.faculty,
      ),
      term: stringValue(
        course.term ??
          course.semester ??
          course.academicTerm ??
          course.academic_term,
      ),
      credits: numberValue(
        course.credits ?? course.creditHours ?? course.credit_hours,
      ),
    },
    gradingCategories,
    gradingScale,
    assessments,
    units,
    unassignedTopics: getArray(
      "unassignedTopics",
      "explicitTopics",
      "topics",
      "scheduledTopics",
    )
      .map(normalizeTopic)
      .filter((topic) => topic.name),
    importantDates: getArray(
      "importantDates",
      "dates",
      "important_dates",
    )
      .map((entry) => {
        const item = isRecord(entry) ? entry : {};
        return {
          name: stringValue(item.name ?? item.event ?? item.title),
          date: stringValue(item.date ?? item.when),
          type: stringValue(
            item.type ?? item.category ?? item.description ?? item.kind,
          ),
        };
      })
      .filter((item) => item.name || item.date),
    policies: getArray("policies", "coursePolicies", "course_policies")
      .map((entry) => {
        const item = isRecord(entry) ? entry : {};
        return {
          category: stringValue(item.category ?? item.name ?? item.title),
          summary: stringValue(
            item.summary ?? item.description ?? item.details ?? item.policy,
          ),
        };
      })
      .filter((item) => item.category || item.summary),
    scheduleNotes: getArray("scheduleNotes", "schedule_notes", "notes")
      .map(stringValue)
      .filter(Boolean),
    warnings: getArray("warnings", "uncertainties", "issues")
      .map(stringValue)
      .filter(Boolean),
    overallConfidence: Math.min(
      100,
      Math.max(0, numberValue(raw.overallConfidence ?? raw.confidence)),
    ),
  };
}

const inputClass =
  "w-full rounded-[14px] border border-white/[0.08] bg-white/[0.025] px-3.5 py-3 text-[12px] text-white/86 outline-none transition duration-200 placeholder:text-white/18 hover:border-white/[0.13] hover:bg-white/[0.035] focus:border-white/20 focus:bg-white/[0.045] focus:ring-4 focus:ring-white/[0.025]";

const compactInputClass =
  "w-full rounded-[11px] border border-white/[0.07] bg-white/[0.015] px-2.5 py-2.5 text-[11px] text-white/72 outline-none transition duration-200 placeholder:text-white/16 hover:border-white/[0.12] hover:bg-white/[0.025] focus:border-white/18 focus:bg-white/[0.035]";

export default function ReviewCourseSetupPage() {
  const params = useParams();
  const router = useRouter();
  const courseId = params.id as string;

  const [course, setCourse] = useState<Course | null>(null);
  const [draft, setDraft] = useState<AnalysisRow | null>(null);
  const [analysis, setAnalysis] = useState<SyllabusAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingDraft, setSavingDraft] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [savedMessage, setSavedMessage] = useState("");
  const [error, setError] = useState("");
  const [openUnits, setOpenUnits] = useState<Record<number, boolean>>({});

  useEffect(() => {
    void initialize();
  }, [courseId]);

  const gradingTotal = useMemo(
    () =>
      analysis?.gradingCategories.reduce(
        (sum, category) => sum + Number(category.weightPercent || 0),
        0,
      ) ?? 0,
    [analysis],
  );

  const totalTopics = useMemo(
    () =>
      (analysis?.units.reduce((sum, unit) => sum + unit.topics.length, 0) ?? 0) +
      (analysis?.unassignedTopics.length ?? 0),
    [analysis],
  );

  async function initialize() {
    try {
      setLoading(true);
      setError("");

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.replace("/onboarding");
        return;
      }

      const [{ data: courseData, error: courseError }, { data: draftData, error: draftError }] =
        await Promise.all([
          supabase
            .from("courses")
            .select("id, code, name, professor, credits, color")
            .eq("id", courseId)
            .single(),
          supabase
            .from("syllabus_analyses")
            .select(
              "id, course_file_id, raw_analysis, edited_analysis, status, confidence",
            )
            .eq("course_id", courseId)
            .order("created_at", { ascending: false })
            .limit(1),
        ]);

      if (courseError) throw courseError;
      if (draftError) throw draftError;

      setCourse({
        id: courseData.id,
        code: courseData.code,
        name: courseData.name,
        professor: courseData.professor ?? "",
        credits: Number(courseData.credits),
        color: courseData.color,
      });

      const latest = draftData?.[0] as AnalysisRow | undefined;

      if (!latest) {
        setDraft(null);
        setAnalysis(null);
        return;
      }

      setDraft(latest);
      setAnalysis(
        normalizeAnalysis(latest.edited_analysis ?? latest.raw_analysis),
      );
    } catch (initializationError) {
      console.error("Could not load review setup:", initializationError);
      setError("Could not load the syllabus review.");
    } finally {
      setLoading(false);
    }
  }

  function updateCourseInfo(
    key: keyof SyllabusAnalysis["courseInfo"],
    value: string,
  ) {
    setAnalysis((current) => {
      if (!current) return current;

      return {
        ...current,
        courseInfo: {
          ...current.courseInfo,
          [key]: key === "credits" ? Number(value) || 0 : value,
        },
      };
    });
  }

  function updateGradingCategory(
    index: number,
    key: "name" | "weightPercent" | "notes",
    value: string,
  ) {
    setAnalysis((current) => {
      if (!current) return current;

      const next = [...current.gradingCategories];
      next[index] = {
        ...next[index],
        [key]: key === "weightPercent" ? Number(value) || 0 : value,
      };

      return { ...current, gradingCategories: next };
    });
  }

  function removeGradingCategory(index: number) {
    setAnalysis((current) =>
      current
        ? {
            ...current,
            gradingCategories: current.gradingCategories.filter(
              (_, itemIndex) => itemIndex !== index,
            ),
          }
        : current,
    );
  }

  function updateGradingScale(
    index: number,
    key:
      | "letterGrade"
      | "minPercent"
      | "maxPercent"
      | "notes",
    value: string,
  ) {
    setAnalysis((current) => {
      if (!current) return current;

      const next = [...current.gradingScale];
      const item = { ...next[index] };

      if (key === "minPercent" || key === "maxPercent") {
        item[key] =
          value.trim() === "" || !Number.isFinite(Number(value))
            ? 0
            : Number(value);
      } else {
        item[key] = value;
      }

      next[index] = item;

      return {
        ...current,
        gradingScale: next,
      };
    });
  }

  function addGradingScaleRow() {
    setAnalysis((current) =>
      current
        ? {
            ...current,
            gradingScale: [
              ...current.gradingScale,
              {
                letterGrade: "",
                minPercent: 0,
                maxPercent: 0,
                notes: "",
              },
            ],
          }
        : current,
    );
  }

  function removeGradingScaleRow(index: number) {
    setAnalysis((current) =>
      current
        ? {
            ...current,
            gradingScale: current.gradingScale.filter(
              (_, itemIndex) => itemIndex !== index,
            ),
          }
        : current,
    );
  }

  function addGradingCategory() {
    setAnalysis((current) =>
      current
        ? {
            ...current,
            gradingCategories: [
              ...current.gradingCategories,
              { name: "", weightPercent: 0, notes: "" },
            ],
          }
        : current,
    );
  }

  function updateAssessment(
    index: number,
    key: "name" | "type" | "date" | "notes",
    value: string,
  ) {
    setAnalysis((current) => {
      if (!current) return current;
      const next = [...current.assessments];
      next[index] = { ...next[index], [key]: value };
      return { ...current, assessments: next };
    });
  }

  function removeAssessment(index: number) {
    setAnalysis((current) =>
      current
        ? {
            ...current,
            assessments: current.assessments.filter(
              (_, itemIndex) => itemIndex !== index,
            ),
          }
        : current,
    );
  }

  function addAssessment() {
    setAnalysis((current) =>
      current
        ? {
            ...current,
            assessments: [
              ...current.assessments,
              { name: "", type: "", date: "", notes: "" },
            ],
          }
        : current,
    );
  }

  function updateImportantDate(
    index: number,
    key: "name" | "date" | "type",
    value: string,
  ) {
    setAnalysis((current) => {
      if (!current) return current;
      const next = [...current.importantDates];
      next[index] = { ...next[index], [key]: value };
      return { ...current, importantDates: next };
    });
  }

  function removeImportantDate(index: number) {
    setAnalysis((current) =>
      current
        ? {
            ...current,
            importantDates: current.importantDates.filter(
              (_, itemIndex) => itemIndex !== index,
            ),
          }
        : current,
    );
  }

  function addImportantDate() {
    setAnalysis((current) =>
      current
        ? {
            ...current,
            importantDates: [
              ...current.importantDates,
              { name: "", date: "", type: "" },
            ],
          }
        : current,
    );
  }

  function updateUnit(
    unitIndex: number,
    key: "name" | "description" | "coverage",
    value: string,
  ) {
    setAnalysis((current) => {
      if (!current) return current;
      const units = [...current.units];
      units[unitIndex] = { ...units[unitIndex], [key]: value };
      return { ...current, units };
    });
  }

  function removeUnit(unitIndex: number) {
    setAnalysis((current) =>
      current
        ? {
            ...current,
            units: current.units.filter((_, index) => index !== unitIndex),
          }
        : current,
    );
  }

  function addUnit() {
    setAnalysis((current) =>
      current
        ? {
            ...current,
            units: [
              ...current.units,
              {
                name: "New unit",
                description: "",
                basisType: "explicit_unit",
                basis: "Added during review",
                assessmentName: "",
                coverage: "",
                topics: [],
              },
            ],
          }
        : current,
    );
  }

  function updateTopic(
    unitIndex: number,
    topicIndex: number,
    key: keyof Topic,
    value: string,
  ) {
    setAnalysis((current) => {
      if (!current) return current;

      const units = [...current.units];
      const topics = [...units[unitIndex].topics];
      topics[topicIndex] = { ...topics[topicIndex], [key]: value };
      units[unitIndex] = { ...units[unitIndex], topics };

      return { ...current, units };
    });
  }

  function removeTopic(unitIndex: number, topicIndex: number) {
    setAnalysis((current) => {
      if (!current) return current;

      const units = [...current.units];
      units[unitIndex] = {
        ...units[unitIndex],
        topics: units[unitIndex].topics.filter(
          (_, index) => index !== topicIndex,
        ),
      };

      return { ...current, units };
    });
  }

  function addTopic(unitIndex: number) {
    setAnalysis((current) => {
      if (!current) return current;

      const units = [...current.units];
      units[unitIndex] = {
        ...units[unitIndex],
        topics: [
          ...units[unitIndex].topics,
          { name: "", date: "", reading: "", assignment: "" },
        ],
      };

      return { ...current, units };
    });
  }

  function updateUnassignedTopic(
    topicIndex: number,
    key: keyof Topic,
    value: string,
  ) {
    setAnalysis((current) => {
      if (!current) return current;
      const topics = [...current.unassignedTopics];
      topics[topicIndex] = { ...topics[topicIndex], [key]: value };
      return { ...current, unassignedTopics: topics };
    });
  }

  function removeUnassignedTopic(topicIndex: number) {
    setAnalysis((current) =>
      current
        ? {
            ...current,
            unassignedTopics: current.unassignedTopics.filter(
              (_, index) => index !== topicIndex,
            ),
          }
        : current,
    );
  }

  async function saveDraft() {
    if (!analysis || !draft || savingDraft || confirming) return;

    try {
      setSavingDraft(true);
      setError("");
      setSavedMessage("");

      const { error: saveError } = await supabase
        .from("syllabus_analyses")
        .update({
          edited_analysis: analysis,
          confidence: analysis.overallConfidence,
          status: draft.status === "confirmed" ? "confirmed" : "draft",
        })
        .eq("id", draft.id);

      if (saveError) throw saveError;

      setSavedMessage("Draft saved");
      window.setTimeout(() => setSavedMessage(""), 2200);
    } catch (saveError) {
      console.error("Could not save syllabus draft:", saveError);
      setError("Could not save your edits.");
    } finally {
      setSavingDraft(false);
    }
  }

  async function confirmSetup() {
    if (!analysis || !draft || !course || confirming) return;

    const confirmedCode =
      analysis.courseInfo.courseCode.trim() || course.code.trim();
    const confirmedName =
      analysis.courseInfo.courseName.trim() || course.name.trim();

    if (!confirmedCode || !confirmedName) {
      setError("Course code and course name are required before confirming.");
      return;
    }

    try {
      setConfirming(true);
      setError("");
      setSavedMessage("");

      const courseUpdate: Record<string, string | number | null> = {
        code: confirmedCode,
        name: confirmedName,
        professor:
          analysis.courseInfo.professor.trim() || course.professor || null,
      };

      if (analysis.courseInfo.credits > 0) {
        courseUpdate.credits = analysis.courseInfo.credits;
      }

      const { error: courseUpdateError } = await supabase
        .from("courses")
        .update(courseUpdate)
        .eq("id", courseId);

      if (courseUpdateError) throw courseUpdateError;

      const { error: deleteTopicsError } = await supabase
        .from("course_topics")
        .delete()
        .eq("course_id", courseId);

      if (deleteTopicsError) throw deleteTopicsError;

      const { error: deleteUnitsError } = await supabase
        .from("course_units")
        .delete()
        .eq("course_id", courseId);

      if (deleteUnitsError) throw deleteUnitsError;

      const { error: deleteGradesError } = await supabase
        .from("grading_categories")
        .delete()
        .eq("course_id", courseId);

      if (deleteGradesError) throw deleteGradesError;

      const { error: deleteEventsError } = await supabase
        .from("course_events")
        .delete()
        .eq("course_id", courseId);

      if (deleteEventsError) throw deleteEventsError;

      const { error: deleteScaleError } = await supabase
        .from("course_grade_scale")
        .delete()
        .eq("course_id", courseId);

      if (deleteScaleError) throw deleteScaleError;


      const gradingRows = analysis.gradingCategories
        .filter((category) => category.name.trim())
        .map((category, index) => ({
          course_id: courseId,
          name: category.name.trim(),
          weight_percent: category.weightPercent || null,
          notes: category.notes.trim() || null,
          position: index,
        }));

      if (gradingRows.length > 0) {
        const { error: gradingError } = await supabase
          .from("grading_categories")
          .insert(gradingRows);

        if (gradingError) throw gradingError;
      }

      const gradeScaleRows = analysis.gradingScale
        .filter((row) => row.letterGrade.trim())
        .map((row, index) => ({
          course_id: courseId,
          letter_grade: row.letterGrade.trim(),
          min_percent:
            row.minPercent > 0 || row.maxPercent > 0
              ? row.minPercent
              : null,
          max_percent:
            row.minPercent > 0 || row.maxPercent > 0
              ? row.maxPercent
              : null,
          notes: row.notes.trim() || null,
          position: index,
          source: "syllabus",
        }));

      if (gradeScaleRows.length > 0) {
        const { error: gradeScaleError } = await supabase
          .from("course_grade_scale")
          .insert(gradeScaleRows);

        if (gradeScaleError) throw gradeScaleError;
      }

      const topicRows: Array<Record<string, unknown>> = [];

      for (let unitIndex = 0; unitIndex < analysis.units.length; unitIndex += 1) {
        const unit = analysis.units[unitIndex];
        if (!unit.name.trim()) continue;

        const { data: insertedUnit, error: unitError } = await supabase
          .from("course_units")
          .insert({
            course_id: courseId,
            name: unit.name.trim(),
            kind: inferUnitKind(unit),
            description: unit.description.trim() || null,
            coverage: unit.coverage.trim() || null,
            position: unitIndex,
            source: "syllabus",
          })
          .select("id")
          .single();

        if (unitError) throw unitError;

        unit.topics.forEach((topic, topicIndex) => {
          if (!topic.name.trim()) return;

          topicRows.push({
            course_id: courseId,
            unit_id: insertedUnit.id,
            source_file_id: draft.course_file_id,
            name: topic.name.trim(),
            position: topicIndex,
            source: "syllabus",
            source_date_text: topic.date.trim() || null,
            scheduled_date: parseDateRange(
              topic.date,
              analysis.courseInfo.term,
            ).start,
            reading: topic.reading.trim() || null,
            assignment: topic.assignment.trim() || null,
          });
        });
      }

      analysis.unassignedTopics.forEach((topic, index) => {
        if (!topic.name.trim()) return;

        topicRows.push({
          course_id: courseId,
          unit_id: null,
          source_file_id: draft.course_file_id,
          name: topic.name.trim(),
          position: index,
          source: "syllabus",
          source_date_text: topic.date.trim() || null,
          scheduled_date: parseDateRange(
            topic.date,
            analysis.courseInfo.term,
          ).start,
          reading: topic.reading.trim() || null,
          assignment: topic.assignment.trim() || null,
        });
      });

      if (topicRows.length > 0) {
        const { error: topicsError } = await supabase
          .from("course_topics")
          .insert(topicRows);

        if (topicsError) throw topicsError;
      }

      const eventMap = new Map<string, Record<string, unknown>>();

      const addEvent = (
        name: string,
        date: string,
        type: string,
        notes: string,
      ) => {
        const cleanName = name.trim();
        if (!cleanName) return;

        const parsed = parseDateRange(date, analysis.courseInfo.term);
        const key = `${cleanName.toLowerCase()}|${date.trim().toLowerCase()}`;

        eventMap.set(key, {
          course_id: courseId,
          name: cleanName,
          event_type: normalizeEventType(type || cleanName),
          start_date: parsed.start,
          end_date: parsed.end,
          source_date_text: date.trim() || null,
          notes: notes.trim() || null,
          source: "syllabus",
        });
      };

      analysis.importantDates.forEach((item) =>
        addEvent(item.name, item.date, item.type, ""),
      );

      analysis.assessments.forEach((item) =>
        addEvent(item.name, item.date, item.type, item.notes),
      );

      const eventRows = [...eventMap.values()];

      if (eventRows.length > 0) {
        const { error: eventsError } = await supabase
          .from("course_events")
          .insert(eventRows);

        if (eventsError) throw eventsError;
      }

      const { error: confirmError } = await supabase
        .from("syllabus_analyses")
        .update({
          edited_analysis: analysis,
          status: "confirmed",
          confidence: analysis.overallConfidence,
          confirmed_at: new Date().toISOString(),
        })
        .eq("id", draft.id);

      if (confirmError) throw confirmError;

      setDraft({ ...draft, status: "confirmed", edited_analysis: analysis });
      router.push(`/courses/${courseId}`);
    } catch (confirmError) {
      console.error("Could not confirm course setup:", confirmError);
      setError(
        "Could not finish saving the course setup. Your syllabus analysis is still safe.",
      );
    } finally {
      setConfirming(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-[#070708] text-white">
        <div className="mx-auto max-w-[1240px] px-5 py-8 sm:px-8 md:px-10">
          <div className="h-10 w-10 animate-pulse rounded-full bg-white/[0.05]" />
          <div className="mt-14 max-w-3xl">
            <div className="h-3 w-40 animate-pulse rounded-full bg-white/[0.04]" />
            <div className="mt-5 h-14 w-[620px] max-w-full animate-pulse rounded-2xl bg-white/[0.055]" />
            <div className="mt-4 h-5 w-[520px] max-w-full animate-pulse rounded-xl bg-white/[0.035]" />
          </div>
          <div className="mt-12 grid gap-5 lg:grid-cols-[1fr_330px]">
            <div className="h-[620px] animate-pulse rounded-[28px] border border-white/[0.05] bg-white/[0.018]" />
            <div className="h-[360px] animate-pulse rounded-[28px] border border-white/[0.05] bg-white/[0.018]" />
          </div>
        </div>
      </main>
    );
  }

  if (!course) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#070708] px-6 text-white">
        <button
          onClick={() => router.push("/")}
          className="rounded-full bg-white px-5 py-2.5 text-sm font-medium text-black transition hover:bg-white/90"
        >
          Return home
        </button>
      </main>
    );
  }

  if (!analysis || !draft) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#070708] px-6 text-white">
        <div className="max-w-md text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-white/[0.07] bg-white/[0.025]">
            <FileText size={20} className="text-white/35" />
          </div>
          <h1 className="mt-6 text-[26px] font-medium tracking-[-0.045em]">
            Nothing to review yet.
          </h1>
          <p className="mt-3 text-[12px] leading-6 text-white/34">
            Analyze a syllabus first. The extracted course structure will appear
            here for review before anything is written into the course.
          </p>
          <button
            onClick={() => router.push(`/courses/${courseId}`)}
            className="mt-7 rounded-full bg-white px-5 py-2.5 text-[12px] font-medium text-black transition hover:bg-white/90"
          >
            Back to course
          </button>
        </div>
      </main>
    );
  }

  const gradingComplete = Math.abs(gradingTotal - 100) < 0.01;

  return (
    <MotionConfig reducedMotion="user">
      <main className="relative min-h-screen overflow-x-hidden bg-[#070708] pb-28 text-[#F5F5F7] lg:pb-16">
        <div
          className="pointer-events-none fixed left-[18%] top-[-360px] h-[700px] w-[820px] rounded-full opacity-[0.09] blur-[155px]"
          style={{ backgroundColor: course.color }}
        />
        <div
          className="pointer-events-none fixed right-[-280px] top-[28%] h-[520px] w-[520px] rounded-full opacity-[0.035] blur-[150px]"
          style={{ backgroundColor: course.color }}
        />

        <div className="relative mx-auto max-w-[1240px] px-5 py-6 sm:px-8 md:px-10 md:py-9">
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className="flex items-center justify-between"
          >
            <button
              onClick={() => router.push(`/courses/${courseId}`)}
              className="group flex h-10 items-center gap-2 rounded-full border border-white/[0.07] bg-white/[0.025] px-3.5 text-[10px] font-medium text-white/45 transition hover:border-white/[0.11] hover:bg-white/[0.05] hover:text-white/82"
            >
              <ArrowLeft size={14} className="transition group-hover:-translate-x-0.5" />
              Course
            </button>

            <div className="flex items-center gap-2">
              <div className="rounded-full border border-white/[0.065] bg-black/20 px-3 py-2 backdrop-blur-xl">
                <span className="text-[9px] text-white/28">Status </span>
                <span className="text-[9px] font-medium text-white/68">
                  {draft.status === "confirmed" ? "Confirmed" : "Reviewing"}
                </span>
              </div>
            </div>
          </motion.div>

          <motion.header
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.04 }}
            className="mt-10 border-b border-white/[0.065] pb-10 md:mt-14 md:pb-12"
          >
            <div className="max-w-4xl">
              <div className="mb-5 flex items-center gap-2.5">
                <div
                  className="flex h-6 w-6 items-center justify-center rounded-full"
                  style={{
                    backgroundColor: `${course.color}14`,
                    color: course.color,
                  }}
                >
                  <CheckCircle2 size={13} />
                </div>
                <p
                  className="text-[9px] font-semibold uppercase tracking-[0.17em]"
                  style={{ color: course.color }}
                >
                  Extraction complete
                </p>
              </div>

              <h1 className="max-w-4xl text-[40px] font-medium leading-[0.98] tracking-[-0.06em] sm:text-[52px] md:text-[64px]">
                Review what we found.
              </h1>

              <p className="mt-5 max-w-2xl text-[13px] leading-6 text-white/34">
                We turned your syllabus into a structured course foundation.
                Check the details below, make any edits you want, then confirm.
              </p>
            </div>

            <div className="mt-9 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
              <ExtractionStat
                icon={<GraduationCap size={14} />}
                label="Course"
                value={analysis.courseInfo.courseCode.trim() || course.code}
                color={course.color}
              />
              <ExtractionStat
                icon={<Percent size={14} />}
                label="Grading"
                value={`${analysis.gradingCategories.length} categories`}
                color={course.color}
              />
              <ExtractionStat
                icon={<GraduationCap size={14} />}
                label="Grade scale"
                value={
                  analysis.gradingScale.length > 0
                    ? `${analysis.gradingScale.length} cutoffs`
                    : "Not found"
                }
                color={course.color}
              />
              <ExtractionStat
                icon={<Layers3 size={14} />}
                label="Structure"
                value={`${analysis.units.length} ${
                  analysis.units.length === 1 ? "unit" : "units"
                }`}
                color={course.color}
              />
              <ExtractionStat
                icon={<BookOpen size={14} />}
                label="Topics"
                value={String(totalTopics)}
                color={course.color}
              />
              <ExtractionStat
                icon={<CalendarDays size={14} />}
                label="Dates"
                value={String(analysis.importantDates.length)}
                color={course.color}
              />
            </div>
          </motion.header>

          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="mt-6 flex items-start gap-3 rounded-[18px] border border-red-500/15 bg-red-500/[0.045] px-4 py-4"
              >
                <AlertTriangle
                  size={15}
                  className="mt-0.5 shrink-0 text-red-300/60"
                />
                <p className="text-[11px] leading-5 text-red-200/68">{error}</p>
              </motion.div>
            )}
          </AnimatePresence>

          <section className="mt-8 grid gap-7 lg:grid-cols-[minmax(0,1fr)_330px]">
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: 0.08 }}
              className="space-y-5"
            >
              <ReviewSection
                eyebrow="01"
                icon={<GraduationCap size={15} />}
                title="Course identity"
                description="The basic information that will appear across the course workspace."
                color={course.color}
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Course code">
                    <input
                      className={inputClass}
                      value={analysis.courseInfo.courseCode}
                      onChange={(event) =>
                        updateCourseInfo("courseCode", event.target.value)
                      }
                      placeholder={course.code}
                    />
                  </Field>

                  <Field label="Term">
                    <input
                      className={inputClass}
                      value={analysis.courseInfo.term}
                      onChange={(event) =>
                        updateCourseInfo("term", event.target.value)
                      }
                      placeholder="Fall 2026"
                    />
                  </Field>

                  <div className="sm:col-span-2">
                    <Field label="Course name">
                      <input
                        className={inputClass}
                        value={analysis.courseInfo.courseName}
                        onChange={(event) =>
                          updateCourseInfo("courseName", event.target.value)
                        }
                        placeholder={course.name}
                      />
                    </Field>
                  </div>

                  <Field label="Professor">
                    <input
                      className={inputClass}
                      value={analysis.courseInfo.professor}
                      onChange={(event) =>
                        updateCourseInfo("professor", event.target.value)
                      }
                      placeholder={course.professor || "Not specified"}
                    />
                  </Field>

                  <Field label="Credits">
                    <input
                      className={inputClass}
                      type="number"
                      inputMode="decimal"
                      step="0.5"
                      value={
                        analysis.courseInfo.credits > 0
                          ? analysis.courseInfo.credits
                          : ""
                      }
                      onChange={(event) =>
                        updateCourseInfo("credits", event.target.value)
                      }
                      placeholder={String(course.credits)}
                    />
                  </Field>
                </div>
              </ReviewSection>

              <ReviewSection
                eyebrow="02"
                icon={<Percent size={15} />}
                title="Grading structure"
                description="These categories become the starting point for your gradebook."
                color={course.color}
                right={
                  <div
                    className="flex items-center gap-2 rounded-full border px-3 py-1.5"
                    style={{
                      borderColor: gradingComplete
                        ? `${course.color}25`
                        : "rgba(251,191,36,0.16)",
                      backgroundColor: gradingComplete
                        ? `${course.color}09`
                        : "rgba(251,191,36,0.045)",
                    }}
                  >
                    {gradingComplete ? (
                      <CheckCircle2 size={11} style={{ color: course.color }} />
                    ) : (
                      <AlertTriangle size={11} className="text-amber-200/55" />
                    )}
                    <span
                      className="text-[9px] font-medium"
                      style={{
                        color: gradingComplete
                          ? course.color
                          : "rgba(253,230,138,0.72)",
                      }}
                    >
                      {gradingTotal.toFixed(
                        Number.isInteger(gradingTotal) ? 0 : 1,
                      )}
                      % total
                    </span>
                  </div>
                }
              >
                <div className="space-y-2.5">
                  {analysis.gradingCategories.map((category, index) => {
                    const width = Math.min(
                      100,
                      Math.max(0, Number(category.weightPercent || 0)),
                    );

                    return (
                      <motion.div
                        layout
                        key={`grade-${index}`}
                        className="group relative overflow-hidden rounded-[17px] border border-white/[0.055] bg-white/[0.012] p-3.5 transition hover:border-white/[0.09] hover:bg-white/[0.02]"
                      >
                        <div
                          className="pointer-events-none absolute bottom-0 left-0 h-[2px] opacity-65"
                          style={{
                            width: `${width}%`,
                            backgroundColor: course.color,
                          }}
                        />

                        <div className="grid gap-2.5 sm:grid-cols-[1fr_110px_38px] sm:items-center">
                          <input
                            className={compactInputClass}
                            value={category.name}
                            onChange={(event) =>
                              updateGradingCategory(
                                index,
                                "name",
                                event.target.value,
                              )
                            }
                            placeholder="Category"
                          />

                          <div className="relative">
                            <input
                              className={`${compactInputClass} pr-8`}
                              type="number"
                              inputMode="decimal"
                              value={category.weightPercent || ""}
                              onChange={(event) =>
                                updateGradingCategory(
                                  index,
                                  "weightPercent",
                                  event.target.value,
                                )
                              }
                              placeholder="0"
                            />
                            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-white/24">
                              %
                            </span>
                          </div>

                          <button
                            onClick={() => removeGradingCategory(index)}
                            className="flex h-9 w-9 items-center justify-center rounded-full text-white/16 transition hover:bg-red-500/10 hover:text-red-300/70"
                            aria-label="Remove grading category"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>

                        {category.notes && (
                          <p className="mt-2 px-1 text-[9px] leading-4 text-white/22">
                            {category.notes}
                          </p>
                        )}
                      </motion.div>
                    );
                  })}

                  <button
                    onClick={addGradingCategory}
                    className="mt-3 flex items-center gap-2 rounded-full border border-dashed border-white/[0.08] px-3.5 py-2.5 text-[10px] font-medium text-white/34 transition hover:border-white/[0.14] hover:bg-white/[0.025] hover:text-white/68"
                  >
                    <Plus size={12} />
                    Add grading category
                  </button>
                </div>
              </ReviewSection>

              <ReviewSection
                eyebrow="03"
                icon={<GraduationCap size={15} />}
                title="Letter grade scale"
                description="These course-specific cutoffs determine how your calculated percentage translates into a letter grade. We never assume a standard scale."
                color={course.color}
                right={
                  analysis.gradingScale.length > 0 ? (
                    <div
                      className="flex items-center gap-2 rounded-full border px-3 py-1.5"
                      style={{
                        borderColor: `${course.color}20`,
                        backgroundColor: `${course.color}08`,
                      }}
                    >
                      <CheckCircle2
                        size={11}
                        style={{ color: course.color }}
                      />
                      <span
                        className="text-[9px] font-medium"
                        style={{ color: course.color }}
                      >
                        Found in syllabus
                      </span>
                    </div>
                  ) : (
                    <span className="text-[9px] text-white/20">
                      Not stated
                    </span>
                  )
                }
              >
                {analysis.gradingScale.length > 0 ? (
                  <div className="overflow-hidden rounded-[18px] border border-white/[0.055] bg-white/[0.01]">
                    <div className="hidden grid-cols-[110px_1fr_1fr_40px] gap-2 border-b border-white/[0.045] px-3.5 py-2.5 sm:grid">
                      <p className="text-[8px] font-medium uppercase tracking-[0.12em] text-white/18">
                        Grade
                      </p>
                      <p className="text-[8px] font-medium uppercase tracking-[0.12em] text-white/18">
                        Minimum
                      </p>
                      <p className="text-[8px] font-medium uppercase tracking-[0.12em] text-white/18">
                        Maximum
                      </p>
                      <span />
                    </div>

                    {analysis.gradingScale.map((row, index) => (
                      <div
                        key={`grade-scale-${index}`}
                        className={`grid gap-2 p-3.5 sm:grid-cols-[110px_1fr_1fr_40px] sm:items-center ${
                          index === analysis.gradingScale.length - 1
                            ? ""
                            : "border-b border-white/[0.04]"
                        }`}
                      >
                        <input
                          className={compactInputClass}
                          value={row.letterGrade}
                          onChange={(event) =>
                            updateGradingScale(
                              index,
                              "letterGrade",
                              event.target.value,
                            )
                          }
                          placeholder="A"
                        />

                        <div className="relative">
                          <input
                            className={`${compactInputClass} pr-8`}
                            type="number"
                            inputMode="decimal"
                            value={
                              row.minPercent > 0
                                ? row.minPercent
                                : ""
                            }
                            onChange={(event) =>
                              updateGradingScale(
                                index,
                                "minPercent",
                                event.target.value,
                              )
                            }
                            placeholder="93"
                          />
                          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[9px] text-white/20">
                            %
                          </span>
                        </div>

                        <div className="relative">
                          <input
                            className={`${compactInputClass} pr-8`}
                            type="number"
                            inputMode="decimal"
                            value={
                              row.maxPercent > 0
                                ? row.maxPercent
                                : ""
                            }
                            onChange={(event) =>
                              updateGradingScale(
                                index,
                                "maxPercent",
                                event.target.value,
                              )
                            }
                            placeholder="100"
                          />
                          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[9px] text-white/20">
                            %
                          </span>
                        </div>

                        <button
                          type="button"
                          onClick={() =>
                            removeGradingScaleRow(index)
                          }
                          className="flex h-9 w-9 items-center justify-center rounded-full text-white/15 transition hover:bg-red-500/10 hover:text-red-300/70"
                          aria-label="Remove letter grade cutoff"
                        >
                          <Trash2 size={12} />
                        </button>

                        {row.notes && (
                          <p className="text-[8px] leading-4 text-white/20 sm:col-span-4">
                            {row.notes}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-[17px] border border-white/[0.05] bg-white/[0.008] p-4">
                    <p className="text-[10px] leading-5 text-white/26">
                      This syllabus did not clearly state letter-grade cutoffs.
                      You can add them manually now, or configure them later in
                      Grades.
                    </p>
                  </div>
                )}

                <button
                  type="button"
                  onClick={addGradingScaleRow}
                  className="mt-4 flex items-center gap-2 rounded-full border border-dashed border-white/[0.08] px-3.5 py-2.5 text-[10px] font-medium text-white/34 transition hover:border-white/[0.14] hover:bg-white/[0.025] hover:text-white/68"
                >
                  <Plus size={12} />
                  Add letter grade
                </button>
              </ReviewSection>

              <ReviewSection
                eyebrow="04"
                icon={<CalendarDays size={15} />}
                title="Assessments & key dates"
                description="The milestones that should appear on the course timeline."
                color={course.color}
              >
                <div className="grid gap-6 xl:grid-cols-2">
                  <div>
                    <div className="mb-3 flex items-center justify-between">
                      <p className="text-[9px] font-medium uppercase tracking-[0.14em] text-white/22">
                        Major assessments
                      </p>
                      <span className="text-[9px] text-white/18">
                        {analysis.assessments.length}
                      </span>
                    </div>

                    <div className="space-y-2">
                      {analysis.assessments.map((assessment, index) => (
                        <motion.div
                          layout
                          key={`assessment-${index}`}
                          className="rounded-[16px] border border-white/[0.055] bg-white/[0.012] p-3.5"
                        >
                          <div className="grid gap-2 sm:grid-cols-[1fr_118px_34px]">
                            <input
                              className={compactInputClass}
                              value={assessment.name}
                              onChange={(event) =>
                                updateAssessment(
                                  index,
                                  "name",
                                  event.target.value,
                                )
                              }
                              placeholder="Assessment"
                            />
                            <input
                              className={compactInputClass}
                              value={assessment.date}
                              onChange={(event) =>
                                updateAssessment(
                                  index,
                                  "date",
                                  event.target.value,
                                )
                              }
                              placeholder="Date"
                            />
                            <button
                              onClick={() => removeAssessment(index)}
                              className="flex h-9 w-8 items-center justify-center rounded-full text-white/16 transition hover:bg-red-500/10 hover:text-red-300/70"
                              aria-label="Remove assessment"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>

                          <input
                            className={`${compactInputClass} mt-2`}
                            value={assessment.notes}
                            onChange={(event) =>
                              updateAssessment(
                                index,
                                "notes",
                                event.target.value,
                              )
                            }
                            placeholder="Optional notes"
                          />
                        </motion.div>
                      ))}

                      <button
                        onClick={addAssessment}
                        className="mt-3 flex items-center gap-2 text-[10px] font-medium text-white/34 transition hover:text-white/68"
                      >
                        <Plus size={12} />
                        Add assessment
                      </button>
                    </div>
                  </div>

                  <div>
                    <div className="mb-3 flex items-center justify-between">
                      <p className="text-[9px] font-medium uppercase tracking-[0.14em] text-white/22">
                        Important dates
                      </p>
                      <span className="text-[9px] text-white/18">
                        {analysis.importantDates.length}
                      </span>
                    </div>

                    <div className="space-y-2">
                      {analysis.importantDates.map((item, index) => (
                        <motion.div
                          layout
                          key={`date-${index}`}
                          className="grid gap-2 rounded-[16px] border border-white/[0.055] bg-white/[0.012] p-3.5 sm:grid-cols-[1fr_118px_34px]"
                        >
                          <input
                            className={compactInputClass}
                            value={item.name}
                            onChange={(event) =>
                              updateImportantDate(
                                index,
                                "name",
                                event.target.value,
                              )
                            }
                            placeholder="Event"
                          />
                          <input
                            className={compactInputClass}
                            value={item.date}
                            onChange={(event) =>
                              updateImportantDate(
                                index,
                                "date",
                                event.target.value,
                              )
                            }
                            placeholder="Date"
                          />
                          <button
                            onClick={() => removeImportantDate(index)}
                            className="flex h-9 w-8 items-center justify-center rounded-full text-white/16 transition hover:bg-red-500/10 hover:text-red-300/70"
                            aria-label="Remove important date"
                          >
                            <Trash2 size={12} />
                          </button>
                        </motion.div>
                      ))}

                      <button
                        onClick={addImportantDate}
                        className="mt-3 flex items-center gap-2 text-[10px] font-medium text-white/34 transition hover:text-white/68"
                      >
                        <Plus size={12} />
                        Add important date
                      </button>
                    </div>
                  </div>
                </div>
              </ReviewSection>

              <ReviewSection
                eyebrow="05"
                icon={<Layers3 size={15} />}
                title="Course structure"
                description="Units and topics become the academic map for everything you add later."
                color={course.color}
                right={
                  <p className="text-[9px] text-white/24">
                    {analysis.units.length}{" "}
                    {analysis.units.length === 1 ? "unit" : "units"} ·{" "}
                    {totalTopics} {totalTopics === 1 ? "topic" : "topics"}
                  </p>
                }
              >
                <div className="space-y-3">
                  {analysis.units.map((unit, unitIndex) => {
                    const isOpen = openUnits[unitIndex] ?? unitIndex === 0;

                    return (
                      <motion.div
                        layout
                        key={`unit-${unitIndex}`}
                        className="overflow-hidden rounded-[19px] border border-white/[0.06] bg-white/[0.012]"
                      >
                        <div className="flex items-center gap-3 px-4 py-4">
                          <button
                            onClick={() =>
                              setOpenUnits((current) => ({
                                ...current,
                                [unitIndex]: !isOpen,
                              }))
                            }
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/[0.055] bg-white/[0.025] text-white/35 transition hover:bg-white/[0.05] hover:text-white/65"
                            aria-label={isOpen ? "Collapse unit" : "Expand unit"}
                          >
                            {isOpen ? (
                              <ChevronDown size={14} />
                            ) : (
                              <ChevronRight size={14} />
                            )}
                          </button>

                          <div
                            className="h-7 w-[2px] shrink-0 rounded-full"
                            style={{ backgroundColor: course.color }}
                          />

                          <div className="min-w-0 flex-1">
                            <input
                              className="w-full bg-transparent text-[12px] font-medium text-white/82 outline-none placeholder:text-white/20"
                              value={unit.name}
                              onChange={(event) =>
                                updateUnit(
                                  unitIndex,
                                  "name",
                                  event.target.value,
                                )
                              }
                              placeholder="Unit name"
                            />
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-[9px] text-white/22">
                              <span>
                                {unit.topics.length}{" "}
                                {unit.topics.length === 1 ? "topic" : "topics"}
                              </span>
                              <span className="text-white/10">•</span>
                              <span>
                                {unit.basisType === "assessment_block"
                                  ? "Assessment-based"
                                  : "Explicit syllabus unit"}
                              </span>
                            </div>
                          </div>

                          <button
                            onClick={() => removeUnit(unitIndex)}
                            className="flex h-8 w-8 items-center justify-center rounded-full text-white/14 transition hover:bg-red-500/10 hover:text-red-300/70"
                            aria-label="Remove unit"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>

                        <AnimatePresence initial={false}>
                          {isOpen && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.24 }}
                              className="overflow-hidden border-t border-white/[0.05]"
                            >
                              <div className="grid gap-3 border-b border-white/[0.045] bg-white/[0.008] p-4 sm:grid-cols-2">
                                <Field label="Coverage">
                                  <input
                                    className={compactInputClass}
                                    value={unit.coverage}
                                    onChange={(event) =>
                                      updateUnit(
                                        unitIndex,
                                        "coverage",
                                        event.target.value,
                                      )
                                    }
                                    placeholder="Chapters, weeks, or scope"
                                  />
                                </Field>

                                <Field label="Description">
                                  <input
                                    className={compactInputClass}
                                    value={unit.description}
                                    onChange={(event) =>
                                      updateUnit(
                                        unitIndex,
                                        "description",
                                        event.target.value,
                                      )
                                    }
                                    placeholder="Optional"
                                  />
                                </Field>
                              </div>

                              <div>
                                {unit.topics.map((topic, topicIndex) => (
                                  <div
                                    key={`topic-${unitIndex}-${topicIndex}`}
                                    className="grid gap-2 border-b border-white/[0.04] p-3.5 last:border-b-0 xl:grid-cols-[1.3fr_112px_1fr_1fr_32px]"
                                  >
                                    <input
                                      className={compactInputClass}
                                      value={topic.name}
                                      onChange={(event) =>
                                        updateTopic(
                                          unitIndex,
                                          topicIndex,
                                          "name",
                                          event.target.value,
                                        )
                                      }
                                      placeholder="Topic"
                                    />

                                    <input
                                      className={compactInputClass}
                                      value={topic.date}
                                      onChange={(event) =>
                                        updateTopic(
                                          unitIndex,
                                          topicIndex,
                                          "date",
                                          event.target.value,
                                        )
                                      }
                                      placeholder="Date"
                                    />

                                    <input
                                      className={compactInputClass}
                                      value={topic.reading}
                                      onChange={(event) =>
                                        updateTopic(
                                          unitIndex,
                                          topicIndex,
                                          "reading",
                                          event.target.value,
                                        )
                                      }
                                      placeholder="Reading"
                                    />

                                    <input
                                      className={compactInputClass}
                                      value={topic.assignment}
                                      onChange={(event) =>
                                        updateTopic(
                                          unitIndex,
                                          topicIndex,
                                          "assignment",
                                          event.target.value,
                                        )
                                      }
                                      placeholder="Assignment"
                                    />

                                    <button
                                      onClick={() =>
                                        removeTopic(
                                          unitIndex,
                                          topicIndex,
                                        )
                                      }
                                      className="flex h-9 w-8 items-center justify-center rounded-full text-white/14 transition hover:bg-red-500/10 hover:text-red-300/70"
                                      aria-label="Remove topic"
                                    >
                                      <Trash2 size={12} />
                                    </button>
                                  </div>
                                ))}

                                <button
                                  onClick={() => addTopic(unitIndex)}
                                  className="m-4 flex items-center gap-2 text-[10px] font-medium text-white/32 transition hover:text-white/65"
                                >
                                  <Plus size={12} />
                                  Add topic
                                </button>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </motion.div>
                    );
                  })}

                  <button
                    onClick={addUnit}
                    className="flex items-center gap-2 rounded-full border border-dashed border-white/[0.09] px-3.5 py-2.5 text-[10px] font-medium text-white/34 transition hover:border-white/[0.14] hover:bg-white/[0.025] hover:text-white/68"
                  >
                    <Plus size={12} />
                    Add unit
                  </button>
                </div>

                {analysis.unassignedTopics.length > 0 && (
                  <div className="mt-7">
                    <div className="mb-3 flex items-center gap-2">
                      <div className="h-1.5 w-1.5 rounded-full bg-amber-200/45" />
                      <p className="text-[9px] font-medium uppercase tracking-[0.14em] text-white/24">
                        Unassigned topics
                      </p>
                      <span className="text-[9px] text-white/16">
                        {analysis.unassignedTopics.length}
                      </span>
                    </div>

                    <div className="overflow-hidden rounded-[17px] border border-white/[0.055] bg-white/[0.008]">
                      {analysis.unassignedTopics.map((topic, index) => (
                        <div
                          key={`unassigned-${index}`}
                          className="grid gap-2 border-b border-white/[0.04] p-3.5 last:border-b-0 sm:grid-cols-[1fr_120px_32px]"
                        >
                          <input
                            className={compactInputClass}
                            value={topic.name}
                            onChange={(event) =>
                              updateUnassignedTopic(
                                index,
                                "name",
                                event.target.value,
                              )
                            }
                            placeholder="Topic"
                          />
                          <input
                            className={compactInputClass}
                            value={topic.date}
                            onChange={(event) =>
                              updateUnassignedTopic(
                                index,
                                "date",
                                event.target.value,
                              )
                            }
                            placeholder="Date"
                          />
                          <button
                            onClick={() => removeUnassignedTopic(index)}
                            className="flex h-9 w-8 items-center justify-center rounded-full text-white/14 transition hover:bg-red-500/10 hover:text-red-300/70"
                            aria-label="Remove unassigned topic"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </ReviewSection>
            </motion.div>

            <motion.aside
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.45, delay: 0.14 }}
              className="lg:sticky lg:top-8 lg:self-start"
            >
              <div className="overflow-hidden rounded-[26px] border border-white/[0.075] bg-[#0D0D0F]/90 shadow-2xl shadow-black/25 backdrop-blur-2xl">
                <div className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[9px] font-medium uppercase tracking-[0.15em] text-white/22">
                        Final review
                      </p>
                      <h2 className="mt-2 text-[20px] font-medium tracking-[-0.04em] text-white/86">
                        Ready to build?
                      </h2>
                    </div>

                    <div
                      className="flex h-10 w-10 items-center justify-center rounded-full border"
                      style={{
                        borderColor: `${course.color}20`,
                        backgroundColor: `${course.color}0B`,
                        color: course.color,
                      }}
                    >
                      <ShieldCheck size={17} />
                    </div>
                  </div>

                  <div className="mt-6 overflow-hidden rounded-[17px] border border-white/[0.055] bg-white/[0.012]">
                    <SummaryRow
                      label="Course"
                      value={
                        analysis.courseInfo.courseCode.trim() || course.code
                      }
                    />
                    <SummaryRow
                      label="Grading"
                      value={`${analysis.gradingCategories.length} categories`}
                    />
                    <SummaryRow
                      label="Grade scale"
                      value={
                        analysis.gradingScale.length > 0
                          ? `${analysis.gradingScale.length} cutoffs`
                          : "Not stated"
                      }
                    />
                    <SummaryRow
                      label="Units"
                      value={String(analysis.units.length)}
                    />
                    <SummaryRow
                      label="Topics"
                      value={String(totalTopics)}
                    />
                    <SummaryRow
                      label="Dates"
                      value={String(analysis.importantDates.length)}
                      last
                    />
                  </div>

                  <div className="mt-5">
                    <div className="flex items-center justify-between">
                      <p className="text-[9px] font-medium uppercase tracking-[0.14em] text-white/20">
                        Extraction confidence
                      </p>
                      <span
                        className="text-[11px] font-medium"
                        style={{ color: course.color }}
                      >
                        {Math.round(analysis.overallConfidence)}%
                      </span>
                    </div>

                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.045]">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{
                          width: `${Math.min(
                            100,
                            Math.max(0, analysis.overallConfidence),
                          )}%`,
                        }}
                        transition={{ duration: 0.8, delay: 0.25 }}
                        className="h-full rounded-full"
                        style={{ backgroundColor: course.color }}
                      />
                    </div>
                  </div>

                  <div
                    className="mt-5 rounded-[17px] border p-4"
                    style={{
                      borderColor: `${course.color}17`,
                      backgroundColor: `${course.color}06`,
                    }}
                  >
                    <div className="flex items-start gap-3">
                      <Sparkles
                        size={14}
                        className="mt-0.5 shrink-0"
                        style={{ color: course.color }}
                      />
                      <p className="text-[10px] leading-5 text-white/31">
                        Nothing is final yet. Confirming turns this extraction
                        into the editable foundation for the course.
                      </p>
                    </div>
                  </div>

                  {analysis.warnings.length > 0 && (
                    <div className="mt-5 rounded-[17px] border border-amber-200/[0.08] bg-amber-200/[0.025] p-4">
                      <div className="flex items-center gap-2">
                        <AlertTriangle
                          size={12}
                          className="text-amber-200/50"
                        />
                        <p className="text-[9px] font-medium uppercase tracking-[0.14em] text-amber-100/44">
                          Worth checking
                        </p>
                      </div>

                      <div className="mt-3 space-y-2.5">
                        {analysis.warnings.slice(0, 4).map((warning, index) => (
                          <p
                            key={`${warning}-${index}`}
                            className="text-[9px] leading-4 text-amber-50/33"
                          >
                            {warning}
                          </p>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="mt-6 hidden space-y-2 lg:block">
                    <button
                      onClick={confirmSetup}
                      disabled={confirming || savingDraft}
                      className="flex w-full items-center justify-center gap-2 rounded-[14px] bg-white px-4 py-3.5 text-[11px] font-semibold text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {confirming ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <Check size={13} />
                      )}
                      {confirming
                        ? "Building course"
                        : "Confirm course setup"}
                    </button>

                    <button
                      onClick={saveDraft}
                      disabled={savingDraft || confirming}
                      className="flex w-full items-center justify-center gap-2 rounded-[14px] border border-white/[0.07] bg-white/[0.018] px-4 py-3 text-[10px] font-medium text-white/42 transition hover:bg-white/[0.04] hover:text-white/72 disabled:opacity-35"
                    >
                      {savingDraft ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <PencilLine size={12} />
                      )}
                      {savingDraft ? "Saving" : "Save draft"}
                    </button>

                    <AnimatePresence>
                      {savedMessage && (
                        <motion.p
                          initial={{ opacity: 0, y: -3 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0 }}
                          className="pt-1 text-center text-[9px] text-white/30"
                        >
                          {savedMessage}
                        </motion.p>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              </div>
            </motion.aside>
          </section>
        </div>

        <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-white/[0.07] bg-[#09090B]/92 backdrop-blur-2xl lg:hidden">
          <div className="mx-auto flex max-w-[1240px] items-center justify-between gap-4 px-5 py-3.5 sm:px-8">
            <div className="min-w-0">
              <p className="truncate text-[10px] font-medium text-white/58">
                {savedMessage || `${totalTopics} topics ready to confirm`}
              </p>
              <p className="mt-0.5 text-[8px] text-white/20">
                You can edit this later.
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={saveDraft}
                disabled={savingDraft || confirming}
                className="flex h-10 items-center gap-2 rounded-full px-3.5 text-[10px] font-medium text-white/38 transition hover:bg-white/[0.04] hover:text-white/68 disabled:opacity-35"
              >
                {savingDraft && <Loader2 size={11} className="animate-spin" />}
                Save
              </button>

              <button
                onClick={confirmSetup}
                disabled={confirming || savingDraft}
                className="flex h-10 items-center gap-2 rounded-full bg-white px-4 text-[10px] font-semibold text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {confirming ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Check size={12} />
                )}
                {confirming ? "Building" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      </main>
    </MotionConfig>
  );
}

function ExtractionStat({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="group rounded-[16px] border border-white/[0.06] bg-white/[0.012] p-3.5 transition hover:border-white/[0.095] hover:bg-white/[0.02]">
      <div
        className="flex h-7 w-7 items-center justify-center rounded-[9px]"
        style={{
          backgroundColor: `${color}0C`,
          color,
        }}
      >
        {icon}
      </div>
      <p className="mt-3 text-[8px] font-medium uppercase tracking-[0.12em] text-white/18">
        {label}
      </p>
      <p className="mt-1 truncate text-[11px] font-medium text-white/68">
        {value}
      </p>
    </div>
  );
}

function ReviewSection({
  eyebrow,
  icon,
  title,
  description,
  right,
  color,
  children,
}: {
  eyebrow: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  right?: React.ReactNode;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-[25px] border border-white/[0.07] bg-[#0D0D0F]/82 shadow-[0_18px_70px_rgba(0,0,0,0.14)] backdrop-blur-xl">
      <div className="border-b border-white/[0.055] p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div
              className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px]"
              style={{
                backgroundColor: `${color}0C`,
                color,
              }}
            >
              {icon}
            </div>

            <div>
              <p className="text-[8px] font-medium uppercase tracking-[0.15em] text-white/18">
                {eyebrow}
              </p>
              <h2 className="mt-1.5 text-[20px] font-medium tracking-[-0.04em] text-white/84">
                {title}
              </h2>
              <p className="mt-2 max-w-xl text-[10px] leading-5 text-white/27">
                {description}
              </p>
            </div>
          </div>

          {right}
        </div>
      </div>

      <div className="p-5 sm:p-6">{children}</div>
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-[8px] font-medium uppercase tracking-[0.12em] text-white/22">
        {label}
      </span>
      {children}
    </label>
  );
}

function SummaryRow({
  label,
  value,
  last = false,
}: {
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-4 px-3.5 py-3 ${
        last ? "" : "border-b border-white/[0.045]"
      }`}
    >
      <p className="text-[9px] text-white/24">{label}</p>
      <p className="truncate text-right text-[9px] font-medium text-white/64">
        {value}
      </p>
    </div>
  );
}

function inferUnitKind(unit: Unit) {
  if (unit.basisType === "assessment_block") return "exam";

  const name = unit.name.toLowerCase();
  if (name.includes("module")) return "module";
  if (name.includes("section")) return "section";
  if (name.includes("block")) return "block";
  return "unit";
}

function normalizeEventType(value: string) {
  const text = value.toLowerCase();
  if (text.includes("exam") || text.includes("midterm") || text.includes("final")) {
    return "exam";
  }
  if (text.includes("quiz")) return "quiz";
  if (text.includes("essay")) return "essay";
  if (text.includes("assignment") || text.includes("homework")) return "assignment";
  if (text.includes("project")) return "project";
  if (text.includes("class") || text.includes("holiday") || text.includes("break")) {
    return "schedule";
  }
  return "other";
}

function parseDateRange(dateText: string, term: string) {
  const clean = dateText.trim();

  if (!clean) {
    return { start: null as string | null, end: null as string | null };
  }

  const yearMatch = `${term} ${clean}`.match(/\b(20\d{2}|19\d{2})\b/);
  const year = yearMatch ? Number(yearMatch[1]) : null;

  if (!year) {
    return { start: null as string | null, end: null as string | null };
  }

  const months: Record<string, number> = {
    january: 1,
    february: 2,
    march: 3,
    april: 4,
    may: 5,
    june: 6,
    july: 7,
    august: 8,
    september: 9,
    october: 10,
    november: 11,
    december: 12,
    jan: 1,
    feb: 2,
    mar: 3,
    apr: 4,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    sept: 9,
    oct: 10,
    nov: 11,
    dec: 12,
  };

  const monthMatch = clean
    .toLowerCase()
    .match(
      /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/,
    );

  if (!monthMatch) {
    return { start: null as string | null, end: null as string | null };
  }

  const month = months[monthMatch[1]];
  const afterMonth = clean.slice(
    clean.toLowerCase().indexOf(monthMatch[1]) + monthMatch[1].length,
  );

  const dayMatch = afterMonth.match(/\b(\d{1,2})(?:\s*[-–]\s*(\d{1,2}))?/);

  if (!dayMatch) {
    return { start: null as string | null, end: null as string | null };
  }

  const startDay = Number(dayMatch[1]);
  const endDay = dayMatch[2] ? Number(dayMatch[2]) : startDay;

  const format = (day: number) =>
    `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  return {
    start: format(startDay),
    end: endDay !== startDay ? format(endDay) : null,
  };
}