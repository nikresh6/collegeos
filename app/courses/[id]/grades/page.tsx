"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Calculator,
  Check,
  ChevronRight,
  Gauge,
  Loader2,
  Pencil,
  Plus,
  Send,
  Target,
  Trash2,
  Trophy,
  X,
} from "lucide-react";
import { supabase } from "../../../../lib/supabase";
import {
  calculateGradebook,
  DEFAULT_COLLEGE_GRADE_SCALE,
  effectiveGradeScale,
  normalizeGradeScale,
  requiredCategoryAverageForTarget,
  type GradeCategoryInput,
  type GradeItemInput,
  type GradeScaleInput,
} from "../../../../lib/grades";
import {
  SchoolLandmarkBackdrop,
  SchoolLandmarkLabel,
  SchoolMark,
} from "../../../../components/school-identity";

type Course = {
  id: string;
  code: string;
  name: string;
  professor: string;
  color: string;
};

type GradeCategory = GradeCategoryInput & {
  notes: string | null;
  position: number;
};

type GradeItem = GradeItemInput & {
  notes: string | null;
  graded_at: string | null;
  created_at: string;
};

type GradeScaleRow = GradeScaleInput & {
  id: string;
  notes: string | null;
  position: number;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

const inputClass =
  "w-full rounded-[14px] border border-white/[0.075] bg-white/[0.025] px-3.5 py-3 text-[13px] text-white/82 outline-none transition placeholder:text-white/26 hover:border-white/[0.12] focus:border-white/18 focus:bg-white/[0.04]";

export default function CourseGradesPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const courseId = params.id;

  const [course, setCourse] = useState<Course | null>(null);
  const [categories, setCategories] = useState<GradeCategory[]>([]);
  const [items, setItems] = useState<GradeItem[]>([]);
  const [scale, setScale] = useState<GradeScaleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [showGradeModal, setShowGradeModal] = useState(false);
  const [editingItem, setEditingItem] = useState<GradeItem | null>(null);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [editingCategory, setEditingCategory] =
    useState<GradeCategory | null>(null);
  const [showScaleModal, setShowScaleModal] = useState(false);

  useEffect(() => {
    void initialize();
  }, [courseId]);

  async function initialize() {
    try {
      setLoading(true);
      setLoadError("");

      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) throw sessionError;

      if (!session) {
        router.replace("/onboarding");
        return;
      }

      const results = await Promise.allSettled([
        loadCourse(),
        loadCategories(),
        loadItems(),
        loadScale(),
      ]);

      const rejected = results.find(
        (result) => result.status === "rejected",
      );

      if (rejected?.status === "rejected") {
        throw rejected.reason;
      }
    } catch (error) {
      console.error("Could not load gradebook:", error);
      setLoadError(
        error instanceof Error
          ? error.message
          : "Could not load this gradebook.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadCourse() {
    const { data, error } = await supabase
      .from("courses")
      .select("id, code, name, professor, color")
      .eq("id", courseId)
      .single();

    if (error) throw error;

    setCourse({
      id: data.id,
      code: data.code,
      name: data.name,
      professor: data.professor ?? "",
      color: data.color,
    });
  }

  async function loadCategories() {
    const { data, error } = await supabase
      .from("grading_categories")
      .select("id, name, weight_percent, notes, position")
      .eq("course_id", courseId)
      .order("position", { ascending: true });

    if (error) throw error;

    setCategories(
      (data ?? []).map((category) => ({
        id: category.id,
        name: category.name,
        weight_percent: Number(category.weight_percent || 0),
        notes: category.notes ?? null,
        position: Number(category.position || 0),
      })),
    );
  }

  async function loadItems() {
    const { data, error } = await supabase
      .from("course_grade_items")
      .select(
        "id, category_id, name, points_earned, points_possible, notes, graded_at, created_at",
      )
      .eq("course_id", courseId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    setItems(
      (data ?? []).map((item) => ({
        id: item.id,
        category_id: item.category_id,
        name: item.name,
        points_earned: Number(item.points_earned),
        points_possible: Number(item.points_possible),
        notes: item.notes ?? null,
        graded_at: item.graded_at ?? null,
        created_at: item.created_at,
      })),
    );
  }

  async function loadScale() {
    const { data, error } = await supabase
      .from("course_grade_scale")
      .select(
        "id, letter_grade, min_percent, max_percent, notes, position",
      )
      .eq("course_id", courseId)
      .order("position", { ascending: true });

    if (error) throw error;

    setScale(
      (data ?? []).map((row) => ({
        id: row.id,
        letter_grade: row.letter_grade,
        min_percent:
          row.min_percent === null
            ? null
            : Number(row.min_percent),
        max_percent:
          row.max_percent === null
            ? null
            : Number(row.max_percent),
        notes: row.notes ?? null,
        position: Number(row.position || 0),
      })),
    );
  }


  async function deleteItem(item: GradeItem) {
    const confirmed = window.confirm(
      `Delete ${item.name} from this gradebook?`,
    );

    if (!confirmed) return;

    const { error } = await supabase
      .from("course_grade_items")
      .delete()
      .eq("id", item.id);

    if (error) {
      console.error("Could not delete grade:", error);
      return;
    }

    setItems((current) =>
      current.filter((entry) => entry.id !== item.id),
    );
  }

  const usingDefaultScale = scale.length === 0;

  const activeScale = useMemo(
    () => effectiveGradeScale(scale),
    [scale],
  );

  const summary = useMemo(
    () =>
      calculateGradebook(
        categories,
        items,
        activeScale,
      ),
    [categories, items, activeScale],
  );

  const scaleLevels = useMemo(
    () => normalizeGradeScale(activeScale),
    [activeScale],
  );

  if (loading) {
    return (
      <main className="min-h-screen bg-[#080809] text-white">
        <div className="mx-auto max-w-[1320px] px-5 py-8 sm:px-8 md:px-10">
          <div className="h-10 w-10 animate-pulse rounded-full bg-white/[0.05]" />
          <div className="mt-14 h-14 w-[520px] max-w-full animate-pulse rounded-2xl bg-white/[0.05]" />
          <div className="mt-10 grid gap-5 lg:grid-cols-[1fr_360px]">
            <div className="h-[680px] animate-pulse rounded-[28px] bg-white/[0.02]" />
            <div className="h-[520px] animate-pulse rounded-[28px] bg-white/[0.02]" />
          </div>
        </div>
      </main>
    );
  }

  if (loadError && !course) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#080809] px-6 text-white">
        <div className="max-w-md text-center">
          <p className="text-[15px] font-medium text-white/76">
            Grade Lab could not load.
          </p>
          <p className="mt-2 text-[12px] leading-5 text-white/42">
            {loadError}
          </p>
          <button
            type="button"
            onClick={() => void initialize()}
            className="mt-5 rounded-full bg-white px-4 py-2.5 text-[12px] font-medium text-black"
          >
            Try again
          </button>
        </div>
      </main>
    );
  }

  if (!course) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#080809] text-white">
        Course not found.
      </main>
    );
  }

  const currentPercent = summary.currentPercent;
  const currentGrade = summary.letterGrade ?? "--";
  const nextLevel = summary.nextLevel;
  const targetPercent = nextLevel?.minPercent ?? null;

  return (
      <main className="relative min-h-screen overflow-x-hidden bg-[#080809] pb-16 text-[#F5F5F7]">
        <div
          className="pointer-events-none fixed inset-x-0 top-0 h-[520px] opacity-[0.12]"
          style={{
            background: `radial-gradient(circle at 35% 0%, ${course.color}55 0%, transparent 58%)`,
          }}
        />

        <div className="relative mx-auto max-w-[1320px] px-5 py-6 sm:px-8 md:px-10 md:py-9">
          <div className="flex items-center justify-between gap-4">
            <button
              type="button"
              onClick={() => router.push(`/courses/${courseId}`)}
              className="flex items-center gap-2 rounded-full border border-white/[0.07] bg-white/[0.025] px-3.5 py-2.5 text-[12px] font-medium text-white/42 transition hover:bg-white/[0.05] hover:text-white/72"
            >
              <ArrowLeft size={13} />
              Course
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowScaleModal(true)}
                className="hidden rounded-full border border-white/[0.07] bg-white/[0.018] px-3.5 py-2.5 text-[12px] font-medium text-white/48 transition hover:bg-white/[0.04] hover:text-white/68 sm:block"
              >
                {usingDefaultScale
                  ? "Default grade scale"
                  : "Grade scale"}
              </button>

              <button
                type="button"
                onClick={() => {
                  setEditingItem(null);
                  setShowGradeModal(true);
                }}
                className="flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-[12px] font-semibold text-black transition hover:bg-white/90"
              >
                <Plus size={12} />
                Add grade
              </button>
            </div>
          </div>

          <header className="relative mt-10 overflow-hidden border-b border-white/[0.065] pb-10 pt-2 md:mt-14 md:pb-12">
            <SchoolLandmarkBackdrop
              opacity={0.045}
              align="right"
            />
            <div className="relative z-10 flex flex-col gap-8 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <div className="flex items-center gap-3">
                  <SchoolMark size={38} quiet />
                  <div>
                    <p
                      className="text-[11px] font-semibold uppercase tracking-[0.17em]"
                      style={{ color: course.color }}
                    >
                      {course.code} Grade Lab
                    </p>
                    <SchoolLandmarkLabel className="mt-1" />
                  </div>
                </div>

                <h1 className="mt-4 max-w-4xl text-[48px] font-medium leading-[0.97] tracking-[-0.062em] sm:text-[60px] md:text-[68px]">
                  Know exactly what every point can do.
                </h1>

                <p className="mt-5 max-w-2xl text-[15px] leading-7 text-white/42">
                  Track every score, see the next letter-grade threshold, and
                  focus on the categories that can move you fastest.
                </p>
              </div>

              <div className="min-w-[320px]">
                <div className="grid grid-cols-2 gap-2">
                  <MiniStat
                    label="Graded items"
                    value={String(summary.gradedItemCount)}
                  />
                  <MiniStat
                    label={
                      summary.mode === "weighted"
                        ? "Weight live"
                        : "Points tracked"
                    }
                    value={
                      summary.mode === "weighted"
                        ? `${summary.activeWeight.toFixed(0)}%`
                        : summary.totalPossible.toFixed(0)
                    }
                  />
                </div>

                {usingDefaultScale && (
                  <button
                    type="button"
                    onClick={() => setShowScaleModal(true)}
                    className="mt-3 flex w-full items-center justify-between gap-4 rounded-[14px] border border-white/[0.055] bg-white/[0.01] px-4 py-3 text-left transition hover:border-white/[0.09] hover:bg-white/[0.02]"
                  >
                    <div>
                      <p className="text-[13px] font-medium text-white/48">
                        Default college grade scale
                      </p>
                      <p className="mt-1 text-[12px] text-white/34">
                        A starts at 93%, A- at 90%, B+ at 87%
                      </p>
                    </div>

                    <ChevronRight
                      size={13}
                      className="shrink-0 text-white/26"
                    />
                  </button>
                )}
              </div>
            </div>
          </header>

          <section className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
            <div className="space-y-6">
              <LevelUpCard
                course={course}
                summary={summary}
                scaleConfigured={scaleLevels.length > 0}
                onEditScale={() => setShowScaleModal(true)}
              />

              {categories.length === 0 ? (
                <EmptyGradeStructure
                  course={course}
                  onAddCategory={() => {
                    setEditingCategory(null);
                    setShowCategoryModal(true);
                  }}
                />
              ) : (
                <>
                  <section className="overflow-hidden rounded-[28px] border border-white/[0.07] bg-[#101012]/90">
                    <div className="flex flex-col gap-4 border-b border-white/[0.055] p-5 sm:flex-row sm:items-end sm:justify-between sm:p-6">
                      <div>
                        <p className="text-[11px] font-medium uppercase tracking-[0.15em] text-white/30">
                          Gradebook
                        </p>
                        <h2 className="mt-2 text-[28px] font-medium tracking-[-0.04em]">
                          Categories
                        </h2>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setEditingCategory(null);
                          setShowCategoryModal(true);
                        }}
                        className="flex items-center gap-2 text-[12px] font-medium text-white/46 transition hover:text-white/68"
                      >
                        <Plus size={12} />
                        Add category
                      </button>
                    </div>

                    <div className="space-y-3 p-4 sm:p-5">
                      {categories.map((category) => {
                        const performance =
                          summary.categories.find(
                            (entry) =>
                              entry.id === category.id,
                          );

                        const categoryItems = items.filter(
                          (item) =>
                            item.category_id === category.id,
                        );

                        return (
                          <CategoryCard
                            key={category.id}
                            course={course}
                            category={category}
                            performance={performance}
                            items={categoryItems}
                            onAddGrade={() => {
                              setEditingItem({
                                id: "",
                                category_id: category.id,
                                name: "",
                                points_earned: 0,
                                points_possible: 0,
                                notes: null,
                                graded_at: null,
                                created_at: "",
                              });
                              setShowGradeModal(true);
                            }}
                            onEditCategory={() => {
                              setEditingCategory(category);
                              setShowCategoryModal(true);
                            }}
                            onEditItem={(item) => {
                              setEditingItem(item);
                              setShowGradeModal(true);
                            }}
                            onDeleteItem={deleteItem}
                          />
                        );
                      })}
                    </div>
                  </section>

                  <PathToNextLevel
                    course={course}
                    categories={categories}
                    items={items}
                    nextLevel={nextLevel}
                  />
                </>
              )}
            </div>

            <aside className="xl:sticky xl:top-8 xl:self-start">
              <GradeCoach
                course={course}
                categories={categories}
                items={items}
                scale={activeScale}
                summary={summary}
              />

              <div className="mt-5 rounded-[22px] border border-white/[0.06] bg-white/[0.012] p-5">
                <div className="flex items-center gap-2">
                  <Gauge size={13} style={{ color: course.color }} />
                  <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/32">
                    Calculation
                  </p>
                </div>

                <p className="mt-3 text-[12px] leading-5 text-white/40">
                  {summary.mode === "weighted"
                    ? "Category averages are calculated from earned points, then weighted using the syllabus percentages. Empty categories are excluded from the current standing until they receive a grade."
                    : "No category weights are configured, so the gradebook is using total points earned divided by total points possible."}
                </p>

                {summary.mode === "weighted" &&
                  summary.configuredWeight > 0 &&
                  Math.abs(summary.configuredWeight - 100) > 0.01 && (
                    <div className="mt-4 flex items-start gap-2 rounded-[14px] border border-amber-200/[0.08] bg-amber-200/[0.025] p-3">
                      <AlertTriangle
                        size={12}
                        className="mt-0.5 shrink-0 text-amber-200/50"
                      />
                      <p className="text-[11px] leading-4 text-amber-100/35">
                        Your category weights total{" "}
                        {summary.configuredWeight.toFixed(1)}%, not 100%.
                        Edit the categories if that is not intentional.
                      </p>
                    </div>
                  )}
              </div>
            </aside>
          </section>
        </div>

        <>
          {showGradeModal && (
            <GradeItemModal
              course={course}
              categories={categories}
              item={editingItem}
              onClose={() => {
                setShowGradeModal(false);
                setEditingItem(null);
              }}
              onSaved={async () => {
                await loadItems();
                setShowGradeModal(false);
                setEditingItem(null);
              }}
            />
          )}

          {showCategoryModal && (
            <CategoryModal
              course={course}
              category={editingCategory}
              position={categories.length}
              onClose={() => {
                setShowCategoryModal(false);
                setEditingCategory(null);
              }}
              onSaved={async () => {
                await loadCategories();
                setShowCategoryModal(false);
                setEditingCategory(null);
              }}
            />
          )}

          {showScaleModal && (
            <GradeScaleModal
              course={course}
              rows={scale}
              onClose={() => setShowScaleModal(false)}
              onSaved={async () => {
                await loadScale();
                setShowScaleModal(false);
              }}
            />
          )}
        </>
      </main>
  );
}

function LevelUpCard({
  course,
  summary,
  scaleConfigured,
  onEditScale,
}: {
  course: Course;
  summary: ReturnType<typeof calculateGradebook>;
  scaleConfigured: boolean;
  onEditScale: () => void;
}) {
  const percent = summary.currentPercent;

  return (
    <section className="relative overflow-hidden rounded-[30px] border border-white/[0.075] bg-[#111113] p-6 sm:p-8">
      <div
        className="pointer-events-none absolute right-[-120px] top-[-180px] h-[360px] w-[360px] rounded-full opacity-[0.1] blur-[105px]"
        style={{ backgroundColor: course.color }}
      />

      <div className="relative grid gap-8 lg:grid-cols-[260px_1fr] lg:items-center">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.15em] text-white/32">
            Current level
          </p>

          <div className="mt-3 flex items-end gap-3">
            <p className="text-[72px] font-medium leading-none tracking-[-0.075em] text-white/90">
              {summary.letterGrade ?? "--"}
            </p>

            <p className="pb-2 text-[20px] font-medium tracking-[-0.04em] text-white/50">
              {percent === null
                ? "--"
                : `${percent.toFixed(2)}%`}
            </p>
          </div>

          <p className="mt-3 text-[12px] text-white/34">
            {summary.gradedItemCount === 0
              ? "Add your first grade to start tracking."
              : summary.mode === "weighted"
                ? `Based on ${summary.activeWeight.toFixed(0)}% of configured course weight`
                : `${summary.totalEarned}/${summary.totalPossible} total points`}
          </p>
        </div>

        <div className="rounded-[22px] border border-white/[0.06] bg-white/[0.012] p-5 sm:p-6">
          {summary.currentPercent === null ? (
            <div>
              <div className="flex h-10 w-10 items-center justify-center rounded-[12px] bg-white/[0.035] text-white/40">
                <Target size={16} />
              </div>
              <h3 className="mt-4 text-[18px] font-medium tracking-[-0.03em]">
                Your next level starts with one score.
              </h3>
              <p className="mt-2 text-[12px] leading-5 text-white/36">
                Add Attendance 10/10, Exam 1 98/104, or any other graded item.
              </p>
            </div>
          ) : !scaleConfigured ? (
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.13em] text-white/30">
                Level progress
              </p>
              <h3 className="mt-3 text-[22px] font-medium tracking-[-0.035em]">
                Add the course letter-grade scale.
              </h3>
              <p className="mt-2 text-[12px] leading-5 text-white/36">
                Once the cutoffs are configured, this becomes a live progress
                bar from your current letter grade to the next one.
              </p>
              <button
                type="button"
                onClick={onEditScale}
                className="mt-4 rounded-full bg-white px-3.5 py-2 text-[11px] font-medium text-black"
              >
                Configure scale
              </button>
            </div>
          ) : summary.nextLevel ? (
            <div>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-[0.13em] text-white/30">
                    Level progress
                  </p>
                  <p className="mt-2 text-[17px] font-medium text-white/70">
                    {summary.letterGrade ?? "Current"}{" "}
                    <ChevronRight
                      size={13}
                      className="inline text-white/30"
                    />{" "}
                    {summary.nextLevel.letterGrade}
                  </p>
                </div>

                <div
                  className="flex h-10 w-10 items-center justify-center rounded-full"
                  style={{
                    backgroundColor: `${course.color}12`,
                    color: course.color,
                  }}
                >
                  <Trophy size={16} />
                </div>
              </div>

              <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/[0.05]">
                <div
                  className="h-full rounded-full transition-[width] duration-500"
                  style={{
                    width: `${Math.max(
                      3,
                      summary.levelProgress * 100,
                    )}%`,
                    backgroundColor: course.color,
                  }}
                />
              </div>

              <div className="mt-3 flex items-center justify-between gap-4">
                <p className="text-[11px] text-white/23">
                  {summary.currentPercent?.toFixed(2)}%
                </p>
                <p
                  className="text-[12px] font-medium"
                  style={{ color: course.color }}
                >
                  {summary.pointsToNextLevel?.toFixed(2)} pts to{" "}
                  {summary.nextLevel.letterGrade}
                </p>
                <p className="text-[11px] text-white/23">
                  {summary.nextLevel.minPercent.toFixed(2)}%
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-4">
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
                style={{
                  backgroundColor: `${course.color}12`,
                  color: course.color,
                }}
              >
                <Trophy size={16} />
              </div>
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.13em] text-white/30">
                  Highest configured level
                </p>
                <h3 className="mt-2 text-[22px] font-medium tracking-[-0.035em]">
                  You are at the top.
                </h3>
                <p className="mt-2 text-[12px] leading-5 text-white/36">
                  Keep the current pace to protect this standing.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function CategoryCard({
  course,
  category,
  performance,
  items,
  onAddGrade,
  onEditCategory,
  onEditItem,
  onDeleteItem,
}: {
  course: Course;
  category: GradeCategory;
  performance:
    | ReturnType<typeof calculateGradebook>["categories"][number]
    | undefined;
  items: GradeItem[];
  onAddGrade: () => void;
  onEditCategory: () => void;
  onEditItem: (item: GradeItem) => void;
  onDeleteItem: (item: GradeItem) => void;
}) {
  const [open, setOpen] = useState(true);
  const percent = performance?.percent ?? null;

  return (
    <div className="overflow-hidden rounded-[20px] border border-white/[0.06] bg-white/[0.012]">
      <div className="flex items-center gap-5 px-4 py-5 sm:px-5">
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="min-w-0 flex-1 text-left"
        >
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[15px] font-medium text-white/76">
              {category.name}
            </p>
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-medium"
              style={{
                backgroundColor: `${course.color}0D`,
                color: course.color,
              }}
            >
              {category.weight_percent.toFixed(
                Number.isInteger(category.weight_percent)
                  ? 0
                  : 1,
              )}
              %
            </span>
          </div>

          <div className="mt-1.5 flex flex-wrap gap-x-3 text-[11px] text-white/30">
            <span>
              {items.length} {items.length === 1 ? "grade" : "grades"}
            </span>
            {performance && performance.possible > 0 && (
              <span>
                {performance.earned}/{performance.possible} pts
              </span>
            )}
          </div>
        </button>

        <div className="text-right">
          <p className="text-[24px] font-medium tracking-[-0.04em] text-white/78">
            {percent === null
              ? "--"
              : `${percent.toFixed(1)}%`}
          </p>
          <div className="mt-1 h-1.5 w-20 overflow-hidden rounded-full bg-white/[0.045]">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.min(
                  100,
                  Math.max(0, percent ?? 0),
                )}%`,
                backgroundColor: course.color,
              }}
            />
          </div>
        </div>
      </div>

      {open && (
        <div className="border-t border-white/[0.045]">
          {items.length > 0 ? (
            <div>
              {items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-3 border-b border-white/[0.04] px-4 py-3.5 last:border-b-0 sm:px-5"
                >
                  <button
                    type="button"
                    onClick={() => onEditItem(item)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="truncate text-[13px] font-medium text-white/62">
                      {item.name}
                    </p>
                    <p className="mt-1 text-[11px] text-white/32">
                      {item.points_earned}/{item.points_possible} points
                    </p>
                  </button>

                  <p className="text-[14px] font-medium text-white/58">
                    {(
                      (item.points_earned /
                        item.points_possible) *
                      100
                    ).toFixed(1)}
                    %
                  </p>

                  <button
                    type="button"
                    onClick={() => void onDeleteItem(item)}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-white/13 transition hover:bg-red-500/10 hover:text-red-300/65"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-4 py-5 sm:px-5">
              <p className="text-[11px] text-white/30">
                No graded items in this category yet.
              </p>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 border-t border-white/[0.04] px-4 py-3 sm:px-5">
            <button
              type="button"
              onClick={onEditCategory}
              className="flex items-center gap-1.5 text-[11px] font-medium text-white/32 transition hover:text-white/52"
            >
              <Pencil size={10} />
              Edit category
            </button>

            <button
              type="button"
              onClick={onAddGrade}
              className="flex items-center gap-1.5 rounded-full border border-white/[0.06] bg-white/[0.015] px-3 py-2 text-[11px] font-medium text-white/50 transition hover:bg-white/[0.04] hover:text-white/68"
            >
              <Plus size={10} />
              Add grade
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PathToNextLevel({
  course,
  categories,
  items,
  nextLevel,
}: {
  course: Course;
  categories: GradeCategory[];
  items: GradeItem[];
  nextLevel: ReturnType<
    typeof calculateGradebook
  >["nextLevel"];
}) {
  if (!nextLevel) return null;

  const currentSummary = calculateGradebook(
    categories,
    items,
    [],
  );

  return (
    <section className="overflow-hidden rounded-[28px] border border-white/[0.07] bg-[#101012]/90">
      <div className="border-b border-white/[0.055] p-5 sm:p-6">
        <div className="flex items-center gap-3">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-[12px]"
            style={{
              backgroundColor: `${course.color}10`,
              color: course.color,
            }}
          >
            <Target size={15} />
          </div>

          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/30">
              Path to next level
            </p>
            <h2 className="mt-1 text-[22px] font-medium tracking-[-0.035em]">
              What would move you to {nextLevel.letterGrade}?
            </h2>
          </div>
        </div>
      </div>

      <div className="grid gap-2 p-4 sm:grid-cols-2 sm:p-5">
        {categories.map((category) => {
          const required = requiredCategoryAverageForTarget({
            categories,
            items,
            categoryId: category.id,
            targetPercent: nextLevel.minPercent,
          });

          const current = currentSummary.categories.find(
            (item) => item.id === category.id,
          );

          let status = "Needs more data";

          if (required) {
            if (required.requiredCategoryPercent > 100) {
              status = "Cannot do it alone";
            } else if (
              current?.percent !== null &&
              current?.percent !== undefined &&
              current.percent >=
                required.requiredCategoryPercent
            ) {
              status = "Already on target pace";
            } else {
              status = `${required.requiredCategoryPercent.toFixed(
                1,
              )}% category average`;
            }
          }

          return (
            <div
              key={category.id}
              className="rounded-[17px] border border-white/[0.05] bg-white/[0.008] p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-[12px] font-medium text-white/52">
                  {category.name}
                </p>
                <span className="text-[10px] text-white/26">
                  {category.weight_percent}% weight
                </span>
              </div>

              <p
                className="mt-3 text-[13px] font-medium"
                style={{
                  color:
                    status === "Already on target pace"
                      ? course.color
                      : "rgba(255,255,255,0.55)",
                }}
              >
                {status}
              </p>

              <p className="mt-1 text-[10px] leading-4 text-white/26">
                Assumes every other currently graded category stays at its
                present average.
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function GradeCoach({
  course,
  categories,
  items,
  scale,
  summary,
}: {
  course: Course;
  categories: GradeCategory[];
  items: GradeItem[];
  scale: GradeScaleRow[];
  summary: ReturnType<typeof calculateGradebook>;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "Ask me what you need on an upcoming exam, how close you are to the next letter grade, or where the easiest points are hiding.",
    },
  ]);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  async function sendMessage(text?: string) {
    const nextMessage = (text ?? message).trim();

    if (!nextMessage || sending) return;

    const userMessage: ChatMessage = {
      role: "user",
      content: nextMessage,
    };

    const nextHistory = [...messages, userMessage];

    setMessages(nextHistory);
    setMessage("");
    setSending(true);

    try {
      const response = await fetch("/api/grade-chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: nextMessage,
          history: messages,
          context: {
            course: {
              code: course.code,
              name: course.name,
            },
            categories,
            items,
            scale,
          },
        }),
      });

      const payload = (await response.json()) as {
        ok?: boolean;
        answer?: string;
        error?: string;
      };

      if (!response.ok || payload.ok !== true) {
        throw new Error(
          payload.error || "Grade Coach could not answer.",
        );
      }

      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content:
            payload.answer ||
            "I could not calculate that scenario.",
        },
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content:
            error instanceof Error
              ? error.message
              : "Grade Coach could not answer.",
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  const quickPrompts = [
    summary.nextLevel
      ? `How close am I to ${summary.nextLevel.letterGrade}?`
      : "Where do I stand?",
    "What should I improve first?",
    "What are my weakest categories?",
  ];

  return (
    <div className="overflow-hidden rounded-[26px] border border-white/[0.075] bg-[#111113]/95 shadow-2xl shadow-black/20">
      <div className="border-b border-white/[0.055] p-5">
        <div className="flex items-start gap-3">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px]"
            style={{
              backgroundColor: `${course.color}11`,
              color: course.color,
            }}
          >
            <Bot size={16} />
          </div>

          <div>
            <p
              className="text-[11px] font-semibold uppercase tracking-[0.14em]"
              style={{ color: course.color }}
            >
              Grade Coach
            </p>
            <h2 className="mt-1.5 text-[22px] font-medium tracking-[-0.035em]">
              Ask your gradebook.
            </h2>
          </div>
        </div>
      </div>

      <div className="max-h-[460px] space-y-3 overflow-y-auto p-5">
        {messages.map((entry, index) => (
          <div
            key={`${entry.role}-${index}`}
            className={`flex ${
              entry.role === "user"
                ? "justify-end"
                : "justify-start"
            }`}
          >
            <div
              className={`max-w-[88%] rounded-[16px] px-3.5 py-3 text-[12px] leading-5 ${
                entry.role === "user"
                  ? "bg-white text-black"
                  : "border border-white/[0.055] bg-white/[0.012] text-white/50"
              }`}
            >
              {entry.content}
            </div>
          </div>
        ))}

        {sending && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-[16px] border border-white/[0.055] bg-white/[0.012] px-3.5 py-3 text-[11px] text-white/35">
              <Loader2 size={11} className="animate-spin" />
              Calculating
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-white/[0.05] p-4">
        <div className="mb-3 flex flex-wrap gap-1.5">
          {quickPrompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => void sendMessage(prompt)}
              className="rounded-full border border-white/[0.055] bg-white/[0.01] px-2.5 py-1.5 text-[10px] text-white/35 transition hover:bg-white/[0.03] hover:text-white/50"
            >
              {prompt}
            </button>
          ))}
        </div>

        <div className="flex items-end gap-2 rounded-[16px] border border-white/[0.065] bg-white/[0.015] p-2">
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey
              ) {
                event.preventDefault();
                void sendMessage();
              }
            }}
            rows={3}
            placeholder='Try: "My next exam is 100 points. What do I need for a B+?"'
            className="min-h-[48px] flex-1 resize-none bg-transparent px-2 py-1.5 text-[12px] leading-5 text-white/55 outline-none placeholder:text-white/16"
          />

          <button
            type="button"
            onClick={() => void sendMessage()}
            disabled={!message.trim() || sending}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-black transition disabled:opacity-25"
          >
            <Send size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}

function GradeItemModal({
  course,
  categories,
  item,
  onClose,
  onSaved,
}: {
  course: Course;
  categories: GradeCategory[];
  item: GradeItem | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const isEditing = Boolean(item?.id);
  const [categoryId, setCategoryId] = useState(
    item?.category_id ??
      categories[0]?.id ??
      "",
  );
  const [name, setName] = useState(item?.name ?? "");
  const [earned, setEarned] = useState(
    item?.id ? String(item.points_earned) : "",
  );
  const [possible, setPossible] = useState(
    item?.id ? String(item.points_possible) : "",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    const earnedNumber = Number(earned);
    const possibleNumber = Number(possible);

    if (!name.trim()) {
      setError("Give this graded item a name.");
      return;
    }

    if (
      !Number.isFinite(earnedNumber) ||
      !Number.isFinite(possibleNumber) ||
      possibleNumber <= 0
    ) {
      setError("Enter valid earned and possible points.");
      return;
    }

    try {
      setSaving(true);
      setError("");

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        throw new Error("You must be signed in.");
      }

      if (isEditing && item) {
        const { error: updateError } = await supabase
          .from("course_grade_items")
          .update({
            category_id: categoryId || null,
            name: name.trim(),
            points_earned: earnedNumber,
            points_possible: possibleNumber,
            updated_at: new Date().toISOString(),
          })
          .eq("id", item.id);

        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await supabase
          .from("course_grade_items")
          .insert({
            user_id: user.id,
            course_id: course.id,
            category_id: categoryId || null,
            name: name.trim(),
            points_earned: earnedNumber,
            points_possible: possibleNumber,
          });

        if (insertError) throw insertError;
      }

      await onSaved();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save this grade.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell
      title={isEditing ? "Edit grade" : "Add a grade"}
      eyebrow={course.code}
      color={course.color}
      onClose={onClose}
    >
      {categories.length > 0 && (
        <label className="block">
          <span className="mb-2 block text-[11px] font-medium uppercase tracking-[0.12em] text-white/32">
            Section
          </span>
          <select
            value={categoryId}
            onChange={(event) =>
              setCategoryId(event.target.value)
            }
            className={inputClass}
          >
            {categories.map((category) => (
              <option
                key={category.id}
                value={category.id}
              >
                {category.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="mt-4 block">
        <span className="mb-2 block text-[11px] font-medium uppercase tracking-[0.12em] text-white/32">
          Grade name
        </span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Exam 1, Attendance, Homework 4"
          className={inputClass}
        />
      </label>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <label>
          <span className="mb-2 block text-[11px] font-medium uppercase tracking-[0.12em] text-white/32">
            Earned
          </span>
          <input
            value={earned}
            onChange={(event) => setEarned(event.target.value)}
            inputMode="decimal"
            placeholder="98"
            className={inputClass}
          />
        </label>

        <label>
          <span className="mb-2 block text-[11px] font-medium uppercase tracking-[0.12em] text-white/32">
            Possible
          </span>
          <input
            value={possible}
            onChange={(event) => setPossible(event.target.value)}
            inputMode="decimal"
            placeholder="104"
            className={inputClass}
          />
        </label>
      </div>

      {earned &&
        possible &&
        Number(possible) > 0 &&
        Number.isFinite(Number(earned)) && (
          <div className="mt-4 rounded-[15px] border border-white/[0.055] bg-white/[0.01] px-4 py-3">
            <p className="text-[11px] text-white/32">
              Score
            </p>
            <p
              className="mt-1 text-[18px] font-medium"
              style={{ color: course.color }}
            >
              {(
                (Number(earned) / Number(possible)) *
                100
              ).toFixed(2)}
              %
            </p>
          </div>
        )}

      {error && (
        <p className="mt-4 text-[11px] text-red-300/65">
          {error}
        </p>
      )}

      <div className="mt-6 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-full px-4 py-2.5 text-[12px] font-medium text-white/46"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-[12px] font-medium text-black disabled:opacity-50"
        >
          {saving ? (
            <Loader2 size={11} className="animate-spin" />
          ) : (
            <Check size={11} />
          )}
          {saving ? "Saving" : "Save grade"}
        </button>
      </div>
    </ModalShell>
  );
}

function CategoryModal({
  course,
  category,
  position,
  onClose,
  onSaved,
}: {
  course: Course;
  category: GradeCategory | null;
  position: number;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(category?.name ?? "");
  const [weight, setWeight] = useState(
    category ? String(category.weight_percent) : "",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    const weightNumber = Number(weight);

    if (!name.trim()) {
      setError("Give this category a name.");
      return;
    }

    if (
      !Number.isFinite(weightNumber) ||
      weightNumber < 0
    ) {
      setError("Enter a valid weight.");
      return;
    }

    try {
      setSaving(true);
      setError("");

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) throw new Error("You must be signed in.");

      if (category) {
        const { error: updateError } = await supabase
          .from("grading_categories")
          .update({
            name: name.trim(),
            weight_percent: weightNumber,
          })
          .eq("id", category.id);

        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await supabase
          .from("grading_categories")
          .insert({
            user_id: user.id,
            course_id: course.id,
            name: name.trim(),
            weight_percent: weightNumber,
            notes: null,
            position,
          });

        if (insertError) throw insertError;
      }

      await onSaved();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save this category.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell
      title={category ? "Edit category" : "Add category"}
      eyebrow="Grading structure"
      color={course.color}
      onClose={onClose}
    >
      <label className="block">
        <span className="mb-2 block text-[11px] font-medium uppercase tracking-[0.12em] text-white/32">
          Category
        </span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Homework, Exams, Attendance"
          className={inputClass}
        />
      </label>

      <label className="mt-4 block">
        <span className="mb-2 block text-[11px] font-medium uppercase tracking-[0.12em] text-white/32">
          Course weight
        </span>
        <div className="relative">
          <input
            value={weight}
            onChange={(event) => setWeight(event.target.value)}
            inputMode="decimal"
            placeholder="25"
            className={`${inputClass} pr-10`}
          />
          <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[12px] text-white/30">
            %
          </span>
        </div>
      </label>

      {error && (
        <p className="mt-4 text-[11px] text-red-300/65">
          {error}
        </p>
      )}

      <div className="mt-6 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-full px-4 py-2.5 text-[12px] font-medium text-white/46"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-[12px] font-medium text-black disabled:opacity-50"
        >
          {saving ? (
            <Loader2 size={11} className="animate-spin" />
          ) : (
            <Check size={11} />
          )}
          Save category
        </button>
      </div>
    </ModalShell>
  );
}

function GradeScaleModal({
  course,
  rows,
  onClose,
  onSaved,
}: {
  course: Course;
  rows: GradeScaleRow[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(
    (rows.length > 0
      ? rows
      : DEFAULT_COLLEGE_GRADE_SCALE
    ).map((row) => ({
      letterGrade: row.letter_grade,
      minPercent:
        row.min_percent === null
          ? ""
          : String(row.min_percent),
    })),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    const cleaned = draft
      .map((row) => ({
        letterGrade: row.letterGrade.trim(),
        minPercent: Number(row.minPercent),
      }))
      .filter(
        (row) =>
          row.letterGrade &&
          Number.isFinite(row.minPercent),
      )
      .sort((a, b) => b.minPercent - a.minPercent);

    if (cleaned.length === 0) {
      setError("Add at least one letter-grade cutoff.");
      return;
    }

    try {
      setSaving(true);
      setError("");

      const { error: deleteError } = await supabase
        .from("course_grade_scale")
        .delete()
        .eq("course_id", course.id);

      if (deleteError) throw deleteError;

      const rowsToInsert = cleaned.map((row, index) => {
        const nextLower = cleaned[index + 1];

        return {
          course_id: course.id,
          letter_grade: row.letterGrade,
          min_percent: row.minPercent,
          max_percent:
            index === 0
              ? 100
              : cleaned[index - 1].minPercent - 0.001,
          notes: null,
          position: index,
          source: "manual",
        };
      });

      const { error: insertError } = await supabase
        .from("course_grade_scale")
        .insert(rowsToInsert);

      if (insertError) throw insertError;

      await onSaved();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save the grade scale.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell
      title="Letter-grade scale"
      eyebrow="Course-specific cutoffs"
      color={course.color}
      onClose={onClose}
    >
      <p className="text-[12px] leading-5 text-white/40">
        Add the minimum percentage for each letter grade. This is what powers
        the level-up progress bar and target calculations.
      </p>

      <div className="mt-5 space-y-2">
        {draft.map((row, index) => (
          <div
            key={index}
            className="grid grid-cols-[110px_1fr_34px] gap-2"
          >
            <input
              value={row.letterGrade}
              onChange={(event) =>
                setDraft((current) =>
                  current.map((item, itemIndex) =>
                    itemIndex === index
                      ? {
                          ...item,
                          letterGrade: event.target.value,
                        }
                      : item,
                  ),
                )
              }
              placeholder="A"
              className={inputClass}
            />

            <div className="relative">
              <input
                value={row.minPercent}
                onChange={(event) =>
                  setDraft((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index
                        ? {
                            ...item,
                            minPercent: event.target.value,
                          }
                        : item,
                    ),
                  )
                }
                inputMode="decimal"
                placeholder="93"
                className={`${inputClass} pr-10`}
              />
              <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[11px] text-white/30">
                min
              </span>
            </div>

            <button
              type="button"
              onClick={() =>
                setDraft((current) =>
                  current.filter(
                    (_, itemIndex) => itemIndex !== index,
                  ),
                )
              }
              className="flex h-11 w-8 items-center justify-center rounded-full text-white/15 transition hover:bg-red-500/10 hover:text-red-300/65"
            >
              <Trash2 size={11} />
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() =>
          setDraft((current) => [
            ...current,
            {
              letterGrade: "",
              minPercent: "",
            },
          ])
        }
        className="mt-3 flex items-center gap-2 text-[11px] font-medium text-white/42 transition hover:text-white/60"
      >
        <Plus size={11} />
        Add cutoff
      </button>

      {error && (
        <p className="mt-4 text-[11px] text-red-300/65">
          {error}
        </p>
      )}

      <div className="mt-6 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-full px-4 py-2.5 text-[12px] font-medium text-white/46"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-[12px] font-medium text-black disabled:opacity-50"
        >
          {saving ? (
            <Loader2 size={11} className="animate-spin" />
          ) : (
            <Check size={11} />
          )}
          Save scale
        </button>
      </div>
    </ModalShell>
  );
}

function ModalShell({
  title,
  eyebrow,
  color,
  onClose,
  children,
}: {
  title: string;
  eyebrow: string;
  color: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[130] flex items-end justify-center bg-black/70 sm:items-center sm:p-6">
      <button
        type="button"
        onClick={onClose}
        className="absolute inset-0"
        aria-label="Close"
      />

      <div className="relative z-10 w-full max-w-[560px] overflow-hidden rounded-t-[28px] border border-white/[0.08] bg-[#101012] shadow-2xl shadow-black/60 sm:rounded-[28px]">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-32 opacity-[0.08]"
          style={{
            background: `radial-gradient(circle at 85% 0%, ${color} 0%, transparent 70%)`,
          }}
        />

        <div className="relative border-b border-white/[0.055] px-5 py-5 sm:px-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p
                className="text-[11px] font-semibold uppercase tracking-[0.14em]"
                style={{ color }}
              >
                {eyebrow}
              </p>
              <h2 className="mt-2 text-[24px] font-medium tracking-[-0.045em]">
                {title}
              </h2>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.04] text-white/42"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="relative max-h-[70vh] overflow-y-auto p-5 sm:p-6">
          {children}
        </div>
      </div>
    </div>
  );
}

function EmptyGradeStructure({
  course,
  onAddCategory,
}: {
  course: Course;
  onAddCategory: () => void;
}) {
  return (
    <div className="rounded-[28px] border border-white/[0.07] bg-[#101012] p-7 sm:p-9">
      <div
        className="flex h-11 w-11 items-center justify-center rounded-[14px]"
        style={{
          backgroundColor: `${course.color}10`,
          color: course.color,
        }}
      >
        <Calculator size={18} />
      </div>

      <h2 className="mt-6 text-[26px] font-medium tracking-[-0.04em]">
        Add your grading sections.
      </h2>

      <p className="mt-3 max-w-xl text-[12px] leading-6 text-white/40">
        If the syllabus did not provide weights, add categories such as Exams,
        Homework, Attendance, Labs, or Projects. Set a weight of 0 if the course
        is purely points-based.
      </p>

      <button
        type="button"
        onClick={onAddCategory}
        className="mt-6 flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-[12px] font-medium text-black"
      >
        <Plus size={12} />
        Add category
      </button>
    </div>
  );
}

function MiniStat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[15px] border border-white/[0.06] bg-white/[0.012] p-3.5">
      <p className="text-[10px] font-medium uppercase tracking-[0.11em] text-white/26">
        {label}
      </p>
      <p className="mt-1.5 text-[15px] font-medium text-white/58">
        {value}
      </p>
    </div>
  );
}