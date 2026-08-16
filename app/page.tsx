"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AnimatePresence,
  MotionConfig,
  motion,
} from "framer-motion";
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  ChevronRight,
  Flag,
  FileQuestion,
  Gauge,
  Target,
  Trophy,
  Command,
  Home,
  LibraryBig,
  LogOut,
  Mic2,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Sparkles,
  TrendingUp,
  UserRound,
  X,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import {
  calculateGradebook,
  type GradeCategoryInput,
  type GradeItemInput,
  type GradeScaleInput,
} from "../lib/grades";
import {
  calculateGpa,
  goalProgress,
  type GpaCourse,
} from "../lib/gpa";
import {
  SchoolMark,
} from "../components/school-identity";

type Course = {
  id: string;
  code: string;
  name: string;
  professor: string;
  credits: number;
  color: string;
};

type DashboardCourseGrade = GpaCourse & {
  color: string;
  nextLetter: string | null;
  pointsToNextLevel: number | null;
  levelProgress: number;
};

type UpcomingEvent = {
  id: string;
  course_id: string;
  name: string;
  event_type: string;
  start_date: string;
  notes: string | null;
};


type SchoolTheme = {
  name: string;
  shortName: string;
  initial: string;
  accent: string;
  accentLight: string;
  accentDark: string;
  brandColors: string[];
};

const defaultSchoolTheme: SchoolTheme = {
  name: "College Assistant",
  shortName: "Your school",
  initial: "C",
  accent: "#CFAE70",
  accentLight: "#F3DFB6",
  accentDark: "#8A713E",
  brandColors: [
    "#CFAE70",
    "#8BA18E",
    "#B3C9CD",
    "#ECB748",
    "#946E24",
    "#A5A5AA",
  ],
};

const SchoolThemeContext = createContext<SchoolTheme>(defaultSchoolTheme);

function useSchoolTheme() {
  return useContext(SchoolThemeContext);
}

const revealTransition = {
  duration: 0.68,
  ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
};

export default function Dashboard() {
  const router = useRouter();

  const [courses, setCourses] = useState<Course[]>([]);
  const [showAddCourse, setShowAddCourse] = useState(false);
  const [loadingCourses, setLoadingCourses] = useState(true);
  const [now, setNow] = useState<Date | null>(null);
  const [localTimeZone, setLocalTimeZone] = useState("");
  const [schoolTheme, setSchoolTheme] =
    useState<SchoolTheme>(defaultSchoolTheme);
  const [semesterName, setSemesterName] = useState("Current semester");
  const [currentSemesterId, setCurrentSemesterId] =
    useState<string | null>(null);
  const [targetGpa, setTargetGpa] = useState(3.7);
  const [preferredName, setPreferredName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [accountEmail, setAccountEmail] = useState("");
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [courseGrades, setCourseGrades] = useState<
    DashboardCourseGrade[]
  >([]);
  const [upcomingEvents, setUpcomingEvents] = useState<
    UpcomingEvent[]
  >([]);

  const totalCredits = useMemo(
    () => courses.reduce((sum, course) => sum + course.credits, 0),
    [courses],
  );

  const semesterGpaResult = useMemo(
    () => calculateGpa(courseGrades),
    [courseGrades],
  );

  const semesterGpa = semesterGpaResult.gpa;

  const gpaGoal = useMemo(
    () => goalProgress(semesterGpa, targetGpa),
    [semesterGpa, targetGpa],
  );

  const courseById = useMemo(
    () =>
      new Map(
        courses.map((course) => [course.id, course]),
      ),
    [courses],
  );

  const trackedCourseGrades = useMemo(
    () =>
      courseGrades
        .filter(
          (course) =>
            course.letterGrade &&
            course.currentPercent !== null,
        )
        .sort(
          (a, b) =>
            (b.currentPercent ?? 0) -
            (a.currentPercent ?? 0),
        ),
    [courseGrades],
  );

  const accountName = useMemo(() => {
    const fullName = [firstName.trim(), lastName.trim()]
      .filter(Boolean)
      .join(" ");

    return fullName || preferredName || "Your profile";
  }, [firstName, lastName, preferredName]);

  const accountInitials = useMemo(() => {
    const initials = `${firstName.trim().charAt(0)}${lastName
      .trim()
      .charAt(0)}`
      .toUpperCase()
      .trim();

    return (
      initials ||
      preferredName.trim().charAt(0).toUpperCase() ||
      schoolTheme.initial
    );
  }, [firstName, lastName, preferredName, schoolTheme.initial]);

  useEffect(() => {
    void initializeApp();
  }, []);

  useEffect(() => {
    const saved = window.localStorage.getItem(
      "college-assistant-sidebar-collapsed",
    );

    if (saved === "false") {
      setSidebarCollapsed(false);
    } else {
      setSidebarCollapsed(true);
    }
  }, []);

  function toggleSidebar() {
    setSidebarCollapsed((current) => {
      const next = !current;

      window.localStorage.setItem(
        "college-assistant-sidebar-collapsed",
        String(next),
      );

      return next;
    });
  }

  useEffect(() => {
    function updateLocalTime() {
      setNow(new Date());
      setLocalTimeZone(
        Intl.DateTimeFormat().resolvedOptions().timeZone,
      );
    }

    updateLocalTime();

    const interval = window.setInterval(updateLocalTime, 30_000);

    return () => window.clearInterval(interval);
  }, []);

  const greeting = useMemo(() => {
    if (!now) return preferredName ? `Welcome, ${preferredName}.` : "Welcome.";

    const hour = now.getHours();
    let base = "Good evening";

    if (hour < 5) base = "Good night";
    else if (hour < 12) base = "Good morning";
    else if (hour < 17) base = "Good afternoon";

    return preferredName ? `${base}, ${preferredName}.` : `${base}.`;
  }, [now, preferredName]);

  const formattedDate = useMemo(() => {
    if (!now) return "";

    return new Intl.DateTimeFormat(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    }).format(now);
  }, [now]);

  const formattedTime = useMemo(() => {
    if (!now) return "";

    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(now);
  }, [now]);

  async function initializeApp() {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.replace("/onboarding");
        return;
      }

      const userId = session.user.id;

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select(
          "school_id, first_name, last_name, preferred_name, target_gpa, onboarding_completed, current_semester_id",
        )
        .eq("id", userId)
        .maybeSingle();

      if (profileError) {
        throw profileError;
      }

      if (!profile?.onboarding_completed || !profile.school_id) {
        router.replace("/onboarding");
        return;
      }

      setFirstName(profile.first_name ?? "");
      setLastName(profile.last_name ?? "");
      setPreferredName(
        profile.preferred_name ?? profile.first_name ?? "",
      );
      setAccountEmail(session.user.email ?? "");
      setTargetGpa(Number(profile.target_gpa ?? 3.7));
      setCurrentSemesterId(profile.current_semester_id ?? null);

      const [{ data: school, error: schoolError }, semesterResult] =
        await Promise.all([
          supabase
            .from("schools")
            .select(
              "name, short_name, primary_color, secondary_color, brand_colors",
            )
            .eq("id", profile.school_id)
            .single(),
          profile.current_semester_id
            ? supabase
                .from("semesters")
                .select("name")
                .eq("id", profile.current_semester_id)
                .single()
            : Promise.resolve({ data: null, error: null }),
        ]);

      if (schoolError) {
        throw schoolError;
      }

      if (semesterResult.error) {
        throw semesterResult.error;
      }

      const primary = school.primary_color || defaultSchoolTheme.accent;
      const secondary =
        school.secondary_color || defaultSchoolTheme.accentDark;
      const shortName = school.short_name || school.name;

      setSchoolTheme({
        name: school.name,
        shortName,
        initial: shortName.charAt(0).toUpperCase(),
        accent: primary,
        accentLight: mixHex(primary, "#FFFFFF", 0.34),
        accentDark: mixHex(secondary, "#000000", 0.18),
        brandColors: buildThemePalette(
          school.brand_colors ?? [],
          primary,
          secondary,
        ),
      });

      setSemesterName(semesterResult.data?.name ?? "Current semester");

      const loadedCourses = await loadCourses(
        profile.current_semester_id ?? null,
      );

      await loadDashboardAcademicData(loadedCourses);
    } catch (error) {
      console.error("Initialization error:", error);

      alert(
        "There was a problem connecting to the database. Check the browser console.",
      );
    } finally {
      setLoadingCourses(false);
    }
  }

  async function handleLogout() {
    if (loggingOut) return;

    try {
      setLoggingOut(true);
      setAccountMenuOpen(false);

      const { error } = await supabase.auth.signOut();

      if (error) {
        throw error;
      }

      router.replace("/onboarding");
      router.refresh();
    } catch (error) {
      console.error("Logout error:", error);
      alert("Could not log out. Please try again.");
      setLoggingOut(false);
    }
  }

  async function loadCourses(semesterId: string | null) {
    let query = supabase
      .from("courses")
      .select("id, code, name, professor, credits, color")
      .is("archived_at", null)
      .order("created_at", { ascending: true });

    if (semesterId) {
      query = query.eq("semester_id", semesterId);
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    const loadedCourses: Course[] = (data ?? []).map((course) => ({
      id: course.id,
      code: course.code,
      name: course.name,
      professor: course.professor ?? "",
      credits: Number(course.credits),
      color: course.color,
    }));

    setCourses(loadedCourses);
    return loadedCourses;
  }

  async function loadDashboardAcademicData(
    loadedCourses: Course[],
  ) {
    if (loadedCourses.length === 0) {
      setCourseGrades([]);
      setUpcomingEvents([]);
      return;
    }

    const courseIds = loadedCourses.map(
      (course) => course.id,
    );

    const today = localDateKey(new Date());

    const [
      { data: categoryData, error: categoryError },
      { data: itemData, error: itemError },
      { data: scaleData, error: scaleError },
      { data: eventData, error: eventError },
    ] = await Promise.all([
      supabase
        .from("grading_categories")
        .select("id, course_id, name, weight_percent")
        .in("course_id", courseIds),
      supabase
        .from("course_grade_items")
        .select(
          "id, course_id, category_id, name, points_earned, points_possible",
        )
        .in("course_id", courseIds),
      supabase
        .from("course_grade_scale")
        .select(
          "course_id, letter_grade, min_percent, max_percent",
        )
        .in("course_id", courseIds),
      supabase
        .from("course_events")
        .select(
          "id, course_id, name, event_type, start_date, notes",
        )
        .in("course_id", courseIds)
        .gte("start_date", today)
        .order("start_date", { ascending: true })
        .limit(6),
    ]);

    if (categoryError) throw categoryError;
    if (itemError) throw itemError;
    if (scaleError) throw scaleError;
    if (eventError) throw eventError;

    const gradeSnapshots = loadedCourses.map(
      (course): DashboardCourseGrade => {
        const categories: GradeCategoryInput[] = (
          categoryData ?? []
        )
          .filter(
            (category) =>
              category.course_id === course.id,
          )
          .map((category) => ({
            id: category.id,
            name: category.name,
            weight_percent: Number(
              category.weight_percent || 0,
            ),
          }));

        const items: GradeItemInput[] = (
          itemData ?? []
        )
          .filter(
            (item) => item.course_id === course.id,
          )
          .map((item) => ({
            id: item.id,
            category_id: item.category_id,
            name: item.name,
            points_earned: Number(item.points_earned),
            points_possible: Number(item.points_possible),
          }));

        const scale: GradeScaleInput[] = (
          scaleData ?? []
        )
          .filter(
            (row) => row.course_id === course.id,
          )
          .map((row) => ({
            letter_grade: row.letter_grade,
            min_percent:
              row.min_percent === null
                ? null
                : Number(row.min_percent),
            max_percent:
              row.max_percent === null
                ? null
                : Number(row.max_percent),
          }));

        const summary = calculateGradebook(
          categories,
          items,
          scale,
        );

        return {
          id: course.id,
          code: course.code,
          name: course.name,
          credits: course.credits,
          letterGrade: summary.letterGrade,
          currentPercent: summary.currentPercent,
          color: course.color,
          nextLetter: summary.nextLevel?.letterGrade ?? null,
          pointsToNextLevel: summary.pointsToNextLevel,
          levelProgress: summary.levelProgress,
        };
      },
    );

    setCourseGrades(gradeSnapshots);
    setUpcomingEvents(
      (eventData ?? []) as UpcomingEvent[],
    );
  }

  async function addCourse(course: Omit<Course, "id">) {
    const { data, error } = await supabase
      .from("courses")
      .insert({
        semester_id: currentSemesterId,
        code: course.code,
        name: course.name,
        professor: course.professor || null,
        credits: course.credits,
        color: course.color,
      })
      .select("id, code, name, professor, credits, color")
      .single();

    if (error) {
      console.error("Error adding course:", error);
      alert("Could not save the course.");
      return;
    }

    const savedCourse: Course = {
      id: data.id,
      code: data.code,
      name: data.name,
      professor: data.professor ?? "",
      credits: Number(data.credits),
      color: data.color,
    };

    const nextCourses = [...courses, savedCourse];
    setCourses(nextCourses);
    setShowAddCourse(false);
    await loadDashboardAcademicData(nextCourses);
  }

  async function deleteCourse(id: string) {
    const { error } = await supabase
      .from("courses")
      .delete()
      .eq("id", id);

    if (error) {
      console.error("Error deleting course:", error);
      alert("Could not delete the course.");
      return;
    }

    const nextCourses = courses.filter(
      (course) => course.id !== id,
    );
    setCourses(nextCourses);
    await loadDashboardAcademicData(nextCourses);
  }

  return (
    <SchoolThemeContext.Provider value={schoolTheme}>
      <MotionConfig reducedMotion="user">
      <main className="relative min-h-screen overflow-x-hidden bg-[#080809] text-[#F5F5F7]">
        {/* Ambient school identity */}
        <motion.div
          aria-hidden
          className="pointer-events-none fixed left-[18%] top-[-260px] h-[520px] w-[720px] rounded-full opacity-[0.09] blur-[120px]"
          style={{ backgroundColor: schoolTheme.accent }}
          animate={{
            x: [0, 34, -12, 0],
            y: [0, 18, -8, 0],
            scale: [1, 1.05, 0.985, 1],
          }}
          transition={{
            duration: 22,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />

        <motion.div
          aria-hidden
          className="pointer-events-none fixed bottom-[-380px] right-[-220px] h-[620px] w-[620px] rounded-full opacity-[0.055] blur-[140px]"
          style={{ backgroundColor: schoolTheme.accent }}
          animate={{
            x: [0, -24, 14, 0],
            y: [0, -18, 10, 0],
            scale: [1, 0.97, 1.045, 1],
          }}
          transition={{
            duration: 27,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />

        <div className="relative flex min-h-screen">
          {/* Desktop Sidebar */}
          <motion.aside
            initial={{ opacity: 0, x: -12 }}
            animate={{
              opacity: 1,
              x: 0,
              width: sidebarCollapsed ? 88 : 258,
            }}
            transition={{
              opacity: {
                delay: 0.08,
                duration: 0.5,
              },
              x: {
                delay: 0.08,
                duration: 0.55,
                ease: [0.22, 1, 0.36, 1],
              },
              width: {
                duration: 0.34,
                ease: [0.22, 1, 0.36, 1],
              },
            }}
            className={`fixed bottom-0 left-0 top-0 z-50 hidden h-screen border-r border-white/[0.065] bg-[#0B0B0D]/94 py-5 backdrop-blur-2xl lg:flex lg:flex-col ${
              sidebarCollapsed ? "px-3" : "px-5"
            }`}
          >
            <button
              type="button"
              onClick={toggleSidebar}
              title={
                sidebarCollapsed
                  ? "Expand sidebar"
                  : "Collapse sidebar"
              }
              aria-label={
                sidebarCollapsed
                  ? "Expand sidebar"
                  : "Collapse sidebar"
              }
              className="absolute -right-3 top-[74px] z-30 flex h-7 w-7 items-center justify-center rounded-full border border-white/[0.09] bg-[#141416] text-white/42 shadow-lg shadow-black/30 transition hover:border-white/[0.15] hover:bg-[#1A1A1D] hover:text-white/78"
            >
              {sidebarCollapsed ? (
                <PanelLeftOpen size={13} />
              ) : (
                <PanelLeftClose size={13} />
              )}
            </button>

            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                delay: 0.16,
                ...revealTransition,
              }}
              className={`flex items-center pb-8 pt-1 ${
                sidebarCollapsed
                  ? "justify-center"
                  : "gap-3 px-2"
              }`}
            >
              <SchoolMark
                size={40}
                className="shadow-[0_8px_30px_rgba(0,0,0,0.28)]"
              />

              <AnimatePresence initial={false}>
                {!sidebarCollapsed && (
                  <motion.div
                    key="school-sidebar-copy"
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -6 }}
                    transition={{ duration: 0.18 }}
                    className="min-w-0"
                  >
                    <p className="truncate text-[13px] font-medium tracking-[-0.01em] text-white/90">
                      {schoolTheme.shortName}
                    </p>

                    <p className="mt-[2px] text-[11px] text-white/48">
                      {semesterName}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>

            {!sidebarCollapsed ? (
              <div className="mb-3 px-3">
                <p className="text-[12px] font-medium uppercase tracking-[0.15em] text-white/34">
                  Workspace
                </p>
              </div>
            ) : (
              <div className="mx-auto mb-3 h-px w-7 bg-white/[0.07]" />
            )}

            <nav
              className={
                sidebarCollapsed
                  ? "space-y-2"
                  : "space-y-[3px]"
              }
            >
              <NavigationItem
                icon={Home}
                label="Home"
                active
                collapsed={sidebarCollapsed}
                onClick={() => router.push("/")}
              />
              <NavigationItem
                icon={BookOpen}
                label="Courses"
                collapsed={sidebarCollapsed}
                onClick={() => router.push("/courses")}
              />
              <NavigationItem
                icon={Sparkles}
                label="Study"
                collapsed={sidebarCollapsed}
                onClick={() => router.push("/study")}
              />
              <NavigationItem
                icon={LibraryBig}
                label="Notebook"
                collapsed={sidebarCollapsed}
                onClick={() => router.push("/notes")}
              />
              <NavigationItem
                icon={FileQuestion}
                label="Exam Intelligence"
                collapsed={sidebarCollapsed}
                onClick={() => router.push("/assessment-lab")}
              />
              <NavigationItem
                icon={Mic2}
                label="Lectures"
                collapsed={sidebarCollapsed}
                onClick={() => router.push("/lectures")}
              />
              <NavigationItem
                icon={CalendarDays}
                label="Calendar"
                collapsed={sidebarCollapsed}
                onClick={() => router.push("/calendar")}
              />
              <NavigationItem
                icon={TrendingUp}
                label="Grades"
                collapsed={sidebarCollapsed}
                onClick={() => router.push("/grades")}
              />
            </nav>

            <div className="mt-auto">
              <div className="mb-5 border-t border-white/[0.055] pt-5">
                {sidebarCollapsed ? (
                  <button
                    type="button"
                    onClick={() => router.push("/grades")}
                    title={`GPA target ${formatGpa(targetGpa)}`}
                    aria-label={`GPA target ${formatGpa(targetGpa)}`}
                    className="mx-auto flex h-10 w-10 items-center justify-center rounded-[13px] border border-white/[0.055] bg-white/[0.018] transition hover:border-white/[0.1] hover:bg-white/[0.04]"
                    style={{ color: schoolTheme.accent }}
                  >
                    <TrendingUp size={16} />
                  </button>
                ) : (
                  <div className="px-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[12px] uppercase tracking-[0.12em] text-white/40">
                          GPA Target
                        </p>

                        <p className="mt-1 text-[24px] font-medium tracking-[-0.045em]">
                          {formatGpa(targetGpa)}
                        </p>
                      </div>

                      <motion.button
                        type="button"
                        onClick={() => router.push("/grades")}
                        whileHover={{ scale: 1.06 }}
                        whileTap={{ scale: 0.96 }}
                        className="flex h-8 w-8 items-center justify-center rounded-full"
                        style={{
                          backgroundColor: `${schoolTheme.accent}12`,
                        }}
                        aria-label="Open grades"
                      >
                        <TrendingUp
                          size={14}
                          style={{
                            color: schoolTheme.accent,
                          }}
                        />
                      </motion.button>
                    </div>
                  </div>
                )}
              </div>

              <NavigationItem
                icon={UserRound}
                label="Profile"
                collapsed={sidebarCollapsed}
                onClick={() => window.location.assign("/profile")}
              />
            </div>
          </motion.aside>

          <motion.div
            aria-hidden
            initial={false}
            animate={{
              width: sidebarCollapsed ? 88 : 258,
            }}
            transition={{
              duration: 0.34,
              ease: [0.22, 1, 0.36, 1],
            }}
            className="hidden h-screen shrink-0 lg:block"
          />

          {/* Main */}
          <section className="min-w-0 flex-1">
            {/* Mobile Top Bar */}
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
              className="sticky top-0 z-40 flex items-center justify-between border-b border-white/[0.055] bg-[#080809]/88 px-4 py-3 backdrop-blur-2xl sm:px-5 sm:py-4 lg:hidden"
            >
              <div className="flex items-center gap-2.5">
                <SchoolMark size={32} quiet />

                <div>
                  <p className="text-[12px] font-medium">
                    {schoolTheme.shortName}
                  </p>

                  <p className="text-[12px] text-white/46">
                    {semesterName}
                  </p>
                </div>
              </div>

              <div className="relative">
                <motion.button
                  type="button"
                  onClick={() => setAccountMenuOpen((current) => !current)}
                  whileHover={{ scale: 1.04 }}
                  whileTap={{ scale: 0.96 }}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.07] bg-white/[0.055] text-[12px] font-semibold text-white/70"
                  aria-label="Open profile menu"
                >
                  {accountInitials}
                </motion.button>

                <AccountMenu
                  open={accountMenuOpen}
                  name={accountName}
                  email={accountEmail}
                  onProfile={() => {
                    setAccountMenuOpen(false);
                    window.location.assign("/profile");
                  }}
                  onLogout={handleLogout}
                  loggingOut={loggingOut}
                  mobile
                />
              </div>
            </motion.div>

            <div className="mx-auto max-w-[1480px] px-4 pb-24 pt-6 sm:px-8 sm:pb-32 sm:pt-8 md:px-10 md:pb-24 md:pt-7 lg:px-14 lg:pb-16 xl:px-16">
              {/* Desktop Utility Bar */}
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  delay: 0.12,
                  duration: 0.48,
                  ease: [0.22, 1, 0.36, 1],
                }}
                className="mb-14 hidden items-center justify-between lg:flex"
              >
                <div className="flex items-center gap-2 text-[11px] text-white/44">
                  <span>{schoolTheme.name}</span>
                  <span className="text-white/26">/</span>
                  <span>{semesterName}</span>

                  {formattedTime && (
                    <>
                      <span className="text-white/26">/</span>
                      <span
                        title={localTimeZone}
                        className="tabular-nums text-white/40"
                      >
                        {formattedTime}
                      </span>
                    </>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <motion.button
                    whileHover={{ y: -1 }}
                    whileTap={{ scale: 0.98 }}
                    className="flex h-9 items-center gap-2 rounded-full border border-white/[0.07] bg-white/[0.025] px-3 text-[12px] text-white/40 transition hover:border-white/[0.12] hover:bg-white/[0.05] hover:text-white/70"
                  >
                    <Search size={14} />

                    Search

                    <span className="ml-2 flex items-center gap-[2px] text-[12px] text-white/36">
                      <Command size={10} />
                      K
                    </span>
                  </motion.button>

                  <div className="relative">
                    <motion.button
                      type="button"
                      onClick={() =>
                        setAccountMenuOpen((current) => !current)
                      }
                      whileHover={{ scale: 1.04 }}
                      whileTap={{ scale: 0.96 }}
                      className="flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.07] bg-white/[0.055] text-[12px] font-semibold text-white/70"
                      aria-label="Open profile menu"
                    >
                      {accountInitials}
                    </motion.button>

                    <AccountMenu
                      open={accountMenuOpen}
                      name={accountName}
                      email={accountEmail}
                      onProfile={() => {
                        setAccountMenuOpen(false);
                        window.location.assign("/profile");
                      }}
                      onLogout={handleLogout}
                      loggingOut={loggingOut}
                    />
                  </div>
                </div>
              </motion.div>

              {/* Semester command center */}
              <motion.section
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.08, ...revealTransition }}
              >
                <div className="flex flex-col gap-6 sm:gap-8 xl:flex-row xl:items-end xl:justify-between">
                  <div className="max-w-4xl">
                    <div className="mb-5 flex flex-wrap items-center gap-3">
                      <motion.div
                        className="h-[2px] w-10 origin-left rounded-full"
                        style={{
                          backgroundColor: schoolTheme.accent,
                        }}
                        initial={{ scaleX: 0 }}
                        animate={{ scaleX: 1 }}
                        transition={{
                          delay: 0.3,
                          duration: 0.65,
                          ease: [0.22, 1, 0.36, 1],
                        }}
                      />

                      <p
                        className="text-[11px] font-semibold uppercase tracking-[0.16em]"
                        style={{ color: schoolTheme.accent }}
                      >
                        {formattedDate || "Today"}
                      </p>

                      <span className="h-1 w-1 rounded-full bg-white/15" />

                      <p className="text-[12px] text-white/46">
                        {semesterName}
                      </p>

                    </div>

                    <motion.h1
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{
                        delay: 0.15,
                        duration: 0.72,
                        ease: [0.22, 1, 0.36, 1],
                      }}
                      className="text-[43px] font-medium leading-[0.96] tracking-[-0.058em] sm:text-[64px] lg:text-[74px]"
                    >
                      {greeting}
                    </motion.h1>

                    <motion.p
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{
                        delay: 0.23,
                        duration: 0.64,
                        ease: [0.22, 1, 0.36, 1],
                      }}
                      className="mt-4 max-w-2xl text-[14px] leading-6 text-white/48 sm:mt-5 sm:text-[16px] sm:leading-7 sm:text-white/54"
                    >
                      Keep the semester moving in one direction. Your grades,
                      deadlines, and GPA goal now meet in the same place.
                    </motion.p>
                  </div>

                  <div className="grid grid-cols-3 gap-3 border-t border-white/[0.065] pt-5 sm:gap-6 xl:min-w-[390px] xl:border-l xl:border-t-0 xl:pl-7 xl:pt-0">
                    <Stat
                      label="Courses"
                      value={String(courses.length)}
                    />
                    <Stat
                      label="Credits"
                      value={formatCredits(totalCredits)}
                    />
                    <Stat
                      label="GPA credits"
                      value={formatCredits(
                        semesterGpaResult.gradedCredits,
                      )}
                    />
                  </div>
                </div>

                <motion.div
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    delay: 0.2,
                    duration: 0.7,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                  className="relative mt-7 overflow-hidden rounded-[24px] border border-white/[0.075] bg-[#101012] sm:mt-10 sm:rounded-[32px]"
                >
                  <div
                    className="pointer-events-none absolute inset-x-0 top-0 h-[260px] opacity-[0.13]"
                    style={{
                      background: `radial-gradient(circle at 16% 0%, ${schoolTheme.accent}60 0%, transparent 58%)`,
                    }}
                  />

                  <button
                    type="button"
                    onClick={() => router.push("/grades")}
                    className="group relative block w-full p-5 text-left sm:p-8 lg:p-9"
                  >
                    <div className="grid gap-6 sm:gap-9 lg:grid-cols-[minmax(0,1fr)_230px] lg:items-center">
                      <div>
                        <div className="flex flex-wrap items-center gap-3">
                          <div
                            className="flex h-10 w-10 items-center justify-center rounded-[13px]"
                            style={{
                              backgroundColor: `${schoolTheme.accent}12`,
                              color: schoolTheme.accent,
                            }}
                          >
                            <Gauge size={17} />
                          </div>

                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-white/46">
                              Semester GPA
                            </p>
                            <p className="mt-1 text-[12px] text-white/40">
                              Live from the grades you have entered
                            </p>
                          </div>

                          {semesterGpa !== null && (
                            <span
                              className="ml-0 rounded-full border px-3 py-1.5 text-[12px] font-semibold uppercase tracking-[0.08em] sm:ml-auto"
                              style={{
                                borderColor: `${schoolTheme.accent}24`,
                                backgroundColor: `${schoolTheme.accent}08`,
                                color: schoolTheme.accent,
                              }}
                            >
                              {gpaGoal.reached
                                ? "Goal reached"
                                : gpaGoal.gap !== null &&
                                    gpaGoal.gap <= 0.1
                                  ? "Within striking distance"
                                  : gpaGoal.gap !== null &&
                                      gpaGoal.gap <= 0.25
                                    ? "Closing in"
                                    : "Building"}
                            </span>
                          )}
                        </div>

                        <div className="mt-7 flex flex-wrap items-end gap-x-6 gap-y-4">
                          <div>
                            <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-white/36">
                              Current
                            </p>
                            <p className="mt-1 text-[62px] font-medium leading-[0.88] tracking-[-0.075em] text-white/94 sm:text-[92px]">
                              {semesterGpa === null
                                ? "--"
                                : semesterGpa.toFixed(2)}
                            </p>
                          </div>

                          <div className="pb-3 text-white/30">
                            <ArrowRight size={22} />
                          </div>

                          <div className="pb-1">
                            <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-white/36">
                              Target
                            </p>
                            <p
                              className="mt-1 text-[40px] font-medium leading-none tracking-[-0.06em] sm:text-[48px]"
                              style={{ color: schoolTheme.accent }}
                            >
                              {targetGpa.toFixed(2)}
                            </p>
                          </div>
                        </div>

                        <div className="mt-6 max-w-3xl sm:mt-8">
                          <div className="relative h-3 overflow-hidden rounded-full bg-white/[0.055]">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{
                                width: `${
                                  semesterGpa === null
                                    ? 0
                                    : Math.max(
                                        3,
                                        gpaGoal.progress * 100,
                                      )
                                }%`,
                              }}
                              transition={{
                                duration: 0.9,
                                ease: [0.22, 1, 0.36, 1],
                              }}
                              className="h-full rounded-full"
                              style={{
                                backgroundColor: schoolTheme.accent,
                              }}
                            />
                          </div>

                          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                            <p className="text-[13px] font-medium text-white/42">
                              {semesterGpa === null
                                ? "Add a few grades and your GPA mission will activate."
                                : gpaGoal.reached
                                  ? `You are ${(
                                      semesterGpa - targetGpa
                                    ).toFixed(2)} above your target.`
                                  : `${gpaGoal.gap?.toFixed(
                                      2,
                                    )} GPA points remain between you and ${targetGpa.toFixed(
                                      2,
                                    )}.`}
                            </p>

                            <div className="flex items-center gap-2 text-[12px] font-medium text-white/50 transition group-hover:text-white/68">
                              Open GPA strategy
                              <ChevronRight
                                size={13}
                                className="transition group-hover:translate-x-0.5"
                              />
                            </div>
                          </div>
                        </div>
                      </div>

                      <GoalRing
                        currentGpa={semesterGpa}
                        targetGpa={targetGpa}
                        progress={gpaGoal.progress}
                        gap={gpaGoal.gap}
                        reached={gpaGoal.reached}
                        color={schoolTheme.accent}
                      />
                    </div>
                  </button>

                  {trackedCourseGrades.length > 0 && (
                    <div className="relative border-t border-white/[0.055] px-5 py-5 sm:px-8 sm:py-6">
                      <div className="mb-4 flex items-center justify-between gap-4">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">
                            Course pulse
                          </p>
                          <p className="mt-1 text-[13px] text-white/44">
                            The grades currently feeding your GPA.
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() => router.push("/grades")}
                          className="hidden items-center gap-1.5 text-[12px] font-medium text-white/44 transition hover:text-white/60 sm:flex"
                        >
                          All grades
                          <ChevronRight size={12} />
                        </button>
                      </div>

                      <div className="grid gap-2 lg:grid-cols-2">
                        {trackedCourseGrades
                          .slice(0, 4)
                          .map((course) => (
                            <button
                              key={course.id}
                              type="button"
                              onClick={() =>
                                router.push(
                                  `/courses/${course.id}/grades`,
                                )
                              }
                              className="group/course flex items-center gap-4 rounded-[18px] border border-white/[0.05] bg-white/[0.01] px-4 py-4 text-left transition hover:border-white/[0.09] hover:bg-white/[0.025]"
                            >
                              <div
                                className="h-9 w-1 shrink-0 rounded-full"
                                style={{
                                  backgroundColor: course.color,
                                }}
                              />

                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <p className="truncate text-[13px] font-semibold text-white/66">
                                    {course.code}
                                  </p>
                                  <span className="text-[12px] text-white/40">
                                    {course.currentPercent?.toFixed(
                                      1,
                                    )}
                                    %
                                  </span>
                                </div>

                                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
                                  <div
                                    className="h-full rounded-full"
                                    style={{
                                      width: `${Math.max(
                                        3,
                                        course.levelProgress * 100,
                                      )}%`,
                                      backgroundColor: course.color,
                                    }}
                                  />
                                </div>
                              </div>

                              <div className="min-w-[82px] text-right">
                                <p className="text-[20px] font-medium tracking-[-0.04em] text-white/78">
                                  {course.letterGrade}
                                </p>
                                <p className="mt-1 text-[12px] text-white/36">
                                  {course.nextLetter
                                    ? `${course.pointsToNextLevel?.toFixed(
                                        1,
                                      )} pts to ${course.nextLetter}`
                                    : "Top level"}
                                </p>
                              </div>

                              <ChevronRight
                                size={13}
                                className="text-white/12 transition group-hover/course:translate-x-0.5 group-hover/course:text-white/54"
                              />
                            </button>
                          ))}
                      </div>
                    </div>
                  )}
                </motion.div>
              </motion.section>

              {/* School Line */}
              <div className="relative my-9 h-px bg-white/[0.06] sm:my-12">
                <motion.div
                  className="absolute left-0 top-0 h-px"
                  style={{ backgroundColor: schoolTheme.accent }}
                  initial={{ width: 0 }}
                  animate={{ width: 76 }}
                  transition={{
                    delay: 0.28,
                    duration: 0.75,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                />
              </div>

              {/* Courses */}
              <motion.section
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  delay: 0.16,
                  duration: 0.62,
                  ease: [0.22, 1, 0.36, 1],
                }}
              >
                <div className="mb-6 flex items-end justify-between gap-6">
                  <div>
                    <p className="mb-2 text-[12px] font-medium uppercase tracking-[0.16em] text-white/40">
                      Academic workspace
                    </p>

                    <h2 className="text-[28px] font-medium tracking-[-0.04em]">
                      Your courses
                    </h2>
                  </div>

                  <motion.button
                    onClick={() => setShowAddCourse(true)}
                    whileHover={{ y: -1, scale: 1.01 }}
                    whileTap={{ scale: 0.98 }}
                    className="group flex shrink-0 items-center gap-2 rounded-full bg-white px-3.5 py-2.5 text-[12px] font-medium text-black transition duration-200 hover:bg-white/88 sm:px-4 sm:text-[13px]"
                  >
                    <Plus size={15} />
                    Add<span className="hidden sm:inline"> course</span>
                  </motion.button>
                </div>

                {loadingCourses ? (
                  <CoursesLoading />
                ) : courses.length === 0 ? (
                  <EmptyCourses
                    onAdd={() => setShowAddCourse(true)}
                  />
                ) : (
                  <div className="overflow-hidden rounded-[26px] border border-white/[0.07] bg-white/[0.018]">
                    <AnimatePresence initial={false}>
                      {courses.map((course, index) => (
                        <CourseRow
                          key={course.id}
                          course={course}
                          index={index}
                          onDelete={() =>
                            deleteCourse(course.id)
                          }
                          last={index === courses.length - 1}
                        />
                      ))}
                    </AnimatePresence>

                    <motion.button
                      onClick={() => setShowAddCourse(true)}
                      whileHover={{ backgroundColor: "rgba(255,255,255,0.025)" }}
                      whileTap={{ scale: 0.995 }}
                      className="flex w-full items-center gap-4 border-t border-white/[0.06] px-5 py-5 text-left text-[13px] text-white/46 transition hover:text-white/60"
                    >
                      <motion.div
                        whileHover={{ rotate: 90 }}
                        transition={{ duration: 0.22 }}
                        className="flex h-9 w-9 items-center justify-center rounded-[11px] border border-dashed border-white/[0.12]"
                      >
                        <Plus size={15} />
                      </motion.div>

                      Add another course
                    </motion.button>
                  </div>
                )}
              </motion.section>

              {/* Lower Content */}
              <motion.section
                initial={{ opacity: 0, y: 18 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.2 }}
                transition={{
                  duration: 0.65,
                  ease: [0.22, 1, 0.36, 1],
                }}
                className="mt-10 grid gap-9 sm:mt-14 sm:gap-12 lg:grid-cols-[1.15fr_.85fr]"
              >
                {/* Upcoming */}
                <div>
                  <div className="mb-6 flex items-end justify-between">
                    <div>
                      <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.15em] text-white/42">
                        Schedule
                      </p>

                      <h2 className="text-[30px] font-medium tracking-[-0.045em] text-white/92">
                        Coming up
                      </h2>
                    </div>

                    <button
                      type="button"
                      onClick={() => router.push("/calendar")}
                      className="flex items-center gap-1.5 text-[13px] font-medium text-white/46 transition hover:text-white/76"
                    >
                      View calendar
                      <ChevronRight size={12} />
                    </button>
                  </div>

                  {upcomingEvents.length === 0 ? (
                    <motion.div
                      whileHover={{ x: 2 }}
                      transition={{ duration: 0.22 }}
                      className="group border-y border-white/[0.07] py-8"
                    >
                      <div className="flex items-start gap-5">
                        <motion.div
                          whileHover={{ scale: 1.04 }}
                          className="mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px]"
                          style={{
                            backgroundColor: `${schoolTheme.accent}12`,
                          }}
                        >
                          <CalendarDays
                            size={18}
                            style={{
                              color: schoolTheme.accent,
                            }}
                          />
                        </motion.div>

                        <div>
                          <p className="text-[16px] font-medium text-white/84">
                            Your schedule is clear.
                          </p>

                          <p className="mt-2 max-w-lg text-[14px] leading-6 text-white/50">
                            Assignments, exams, and course deadlines will surface
                            here as your semester takes shape.
                          </p>
                        </div>
                      </div>
                    </motion.div>
                  ) : (
                    <div className="border-y border-white/[0.07]">
                      {upcomingEvents.slice(0, 4).map(
                        (event, index) => {
                          const eventCourse = courseById.get(
                            event.course_id,
                          );

                          return (
                            <button
                              key={event.id}
                              type="button"
                              onClick={() =>
                                router.push("/calendar")
                              }
                              className={`group flex w-full items-center gap-4 py-4.5 text-left transition hover:bg-white/[0.018] ${
                                index ===
                                Math.min(
                                  upcomingEvents.length,
                                  4,
                                ) -
                                  1
                                  ? ""
                                  : "border-b border-white/[0.055]"
                              }`}
                            >
                              <div className="w-14 shrink-0">
                                <p
                                  className="text-[12px] font-semibold uppercase tracking-[0.09em]"
                                  style={{
                                    color:
                                      eventCourse?.color ??
                                      schoolTheme.accent,
                                  }}
                                >
                                  {formatEventMonthDay(
                                    event.start_date,
                                  )}
                                </p>
                              </div>

                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  {eventCourse && (
                                    <span className="text-[12px] font-medium text-white/46">
                                      {eventCourse.code}
                                    </span>
                                  )}

                                  <span className="rounded-full border border-white/[0.06] px-2 py-0.5 text-[11px] capitalize text-white/40">
                                    {event.event_type.replaceAll(
                                      "_",
                                      " ",
                                    )}
                                  </span>
                                </div>

                                <p className="mt-1.5 truncate text-[15px] font-medium text-white/76 transition group-hover:text-white/92">
                                  {event.name}
                                </p>
                              </div>

                              <ChevronRight
                                size={14}
                                className="shrink-0 text-white/28 transition group-hover:translate-x-0.5 group-hover:text-white/58"
                              />
                            </button>
                          );
                        },
                      )}
                    </div>
                  )}
                </div>

                {/* Academic Status */}
                <div>
                  <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.15em] text-white/42">
                    Academic status
                  </p>

                  <div className="mb-6 flex items-end justify-between gap-5">
                    <h2 className="text-[30px] font-medium tracking-[-0.045em] text-white/92">
                      Semester
                    </h2>

                    <button
                      type="button"
                      onClick={() => router.push("/grades")}
                      className="flex items-center gap-1.5 text-[12px] font-medium text-white/42 transition hover:text-white/72"
                    >
                      Grade strategy
                      <ChevronRight size={11} />
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => router.push("/grades")}
                    className="group block w-full border-y border-white/[0.07] py-6 text-left"
                  >
                    <div className="flex items-end justify-between gap-6">
                      <div>
                        <p className="text-[12px] font-medium text-white/44">
                          Current GPA
                        </p>

                        <div className="mt-2 flex items-baseline gap-2.5">
                          <p className="text-[42px] font-medium leading-none tracking-[-0.055em] text-white/88">
                            {semesterGpa === null
                              ? "--"
                              : semesterGpa.toFixed(2)}
                          </p>

                          <p className="text-[13px] text-white/44">
                            of {targetGpa.toFixed(2)} target
                          </p>
                        </div>
                      </div>

                      <ChevronRight
                        size={14}
                        className="mb-2 text-white/28 transition group-hover:translate-x-0.5 group-hover:text-white/58"
                      />
                    </div>

                    <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/[0.06]">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${
                            semesterGpa === null
                              ? 0
                              : Math.max(
                                  3,
                                  gpaGoal.progress * 100,
                                )
                          }%`,
                          backgroundColor: schoolTheme.accent,
                        }}
                      />
                    </div>

                    <p className="mt-3 text-[12px] font-medium text-white/46">
                      {semesterGpa === null
                        ? "Add grades to activate GPA tracking."
                        : gpaGoal.reached
                          ? "Your GPA target is currently reached."
                          : `${gpaGoal.gap?.toFixed(
                              2,
                            )} GPA points from your target.`}
                    </p>
                  </button>

                  <div>
                    <SemesterLine
                      label="Credit load"
                      value={
                        totalCredits === 0
                          ? "Not set"
                          : `${formatCredits(totalCredits)} credits`
                      }
                      muted={totalCredits === 0}
                    />

                    <SemesterLine
                      label="GPA credits"
                      value={
                        semesterGpaResult.gradedCredits > 0
                          ? `${formatCredits(
                              semesterGpaResult.gradedCredits,
                            )} graded`
                          : "No graded courses"
                      }
                      muted={
                        semesterGpaResult.gradedCredits === 0
                      }
                    />

                    <SemesterLine
                      label="Term status"
                      value={
                        semesterGpa !== null
                          ? "Tracking"
                          : "Setup"
                      }
                      muted={semesterGpa === null}
                    />
                  </div>
                </div>
              </motion.section>
            </div>

          </section>
        </div>

        <AnimatePresence>
          {showAddCourse && (
            <AddCourseModal
              semesterName={semesterName}
              onClose={() => setShowAddCourse(false)}
              onAdd={addCourse}
            />
          )}
        </AnimatePresence>
      </main>
      </MotionConfig>
    </SchoolThemeContext.Provider>
  );
}

function EmptyCourses({
  onAdd,
}: {
  onAdd: () => void;
}) {
  const schoolTheme = useSchoolTheme();

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={revealTransition}
      className="relative overflow-hidden rounded-[30px] border border-white/[0.07] bg-[#101012]"
    >
      <motion.div
        aria-hidden
        className="pointer-events-none absolute right-[-80px] top-[-120px] h-[320px] w-[320px] rounded-full opacity-[0.11] blur-[90px]"
        style={{ backgroundColor: schoolTheme.accent }}
        animate={{
          x: [0, -12, 8, 0],
          y: [0, 10, -6, 0],
        }}
        transition={{
          duration: 18,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />

      <div className="grid min-h-[330px] lg:grid-cols-[1.05fr_.95fr]">
        <div className="relative flex flex-col justify-between p-7 sm:p-9">
          <div>
            <motion.div
              whileHover={{ scale: 1.05, rotate: -2 }}
              className="mb-8 flex h-10 w-10 items-center justify-center rounded-[13px]"
              style={{
                backgroundColor: `${schoolTheme.accent}10`,
                color: schoolTheme.accent,
              }}
            >
              <LibraryBig size={18} />
            </motion.div>

            <h3 className="max-w-sm text-[26px] font-medium leading-tight tracking-[-0.04em]">
              Build your semester.
            </h3>

            <p className="mt-3 max-w-md text-[13px] leading-6 text-white/48">
              Add your courses first. Materials, grades, study guides, and
              everything else will organize around them.
            </p>
          </div>

          <motion.button
            onClick={onAdd}
            whileHover={{ x: 3 }}
            whileTap={{ scale: 0.98 }}
            className="mt-9 flex w-fit items-center gap-2 text-[12px] font-medium text-white/65 transition hover:text-white"
          >
            Add your first course
            <ArrowRight size={14} />
          </motion.button>
        </div>

        <div className="relative hidden overflow-hidden border-l border-white/[0.055] lg:block">
          <motion.div
            aria-hidden
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 select-none text-[180px] font-semibold tracking-[-0.08em]"
            style={{
              color: `${schoolTheme.accent}0D`,
            }}
            animate={{
              scale: [1, 1.025, 1],
              opacity: [0.75, 1, 0.75],
            }}
            transition={{
              duration: 8,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          >
            {schoolTheme.initial}
          </motion.div>

          <div className="absolute inset-x-10 top-1/2 h-px bg-white/[0.055]" />

          <div className="absolute bottom-10 left-1/2 top-10 w-px bg-white/[0.045]" />

          <motion.div
            aria-hidden
            className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{ backgroundColor: schoolTheme.accent }}
            animate={{
              boxShadow: [
                `0 0 0 0 ${schoolTheme.accent}00`,
                `0 0 0 10px ${schoolTheme.accent}10`,
                `0 0 0 0 ${schoolTheme.accent}00`,
              ],
            }}
            transition={{
              duration: 3.4,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          />

          <div className="absolute bottom-8 right-8 text-right">
            <p className="text-[12px] uppercase tracking-[0.16em] text-white/34">
              Current institution
            </p>

            <p className="mt-1.5 text-[12px] text-white/44">
              {schoolTheme.name}
            </p>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function CourseRow({
  course,
  onDelete,
  last,
  index,
}: {
  course: Course;
  onDelete: () => void;
  last: boolean;
  index: number;
}) {
  const [showMenu, setShowMenu] = useState(false);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{
        opacity: 1,
        y: 0,
        transition: {
          delay: Math.min(index * 0.055, 0.28),
          duration: 0.46,
          ease: [0.22, 1, 0.36, 1],
        },
      }}
      exit={{
        opacity: 0,
        y: -8,
        transition: {
          duration: 0.2,
          ease: [0.4, 0, 1, 1],
        },
      }}
      className={`group relative ${
        last ? "" : "border-b border-white/[0.055]"
      }`}
    >
      <Link
        href={`/courses/${course.id}`}
        className="grid grid-cols-[44px_1fr] items-center gap-4 px-5 py-5 pr-14 transition duration-200 hover:bg-white/[0.03] sm:grid-cols-[52px_1fr_auto] sm:gap-5"
      >
        <motion.div
          whileHover={{ scale: 1.045, rotate: -1 }}
          transition={{ type: "spring", stiffness: 320, damping: 24 }}
          className="flex h-11 w-11 items-center justify-center rounded-[14px] text-[13px] font-semibold text-black"
          style={{ backgroundColor: course.color }}
        >
          {course.code.charAt(0)}
        </motion.div>

        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <p className="text-[12px] font-semibold uppercase tracking-[0.13em] text-white/27">
              {course.code}
            </p>

            <span className="h-[2px] w-[2px] rounded-full bg-white/20" />

            <p className="text-[12px] text-white/40">
              {formatCredits(course.credits)}{" "}
              {course.credits === 1 ? "credit" : "credits"}
            </p>
          </div>

          <h3 className="mt-1.5 truncate text-[16px] font-medium tracking-[-0.02em] text-white/88 transition group-hover:text-white">
            {course.name}
          </h3>

          <p className="mt-1 truncate text-[12px] text-white/27">
            {course.professor || "Professor not added"}
          </p>
        </div>

        <div className="hidden items-center gap-1.5 text-[11px] text-white/32 transition duration-200 group-hover:translate-x-[2px] group-hover:text-white/48 sm:flex">
          View course
          <ChevronRight size={13} />
        </div>
      </Link>

      <div className="absolute right-4 top-1/2 z-20 -translate-y-1/2">
        <motion.button
          type="button"
          onClick={() =>
            setShowMenu((current) => !current)
          }
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.94 }}
          aria-label={`Options for ${course.code}`}
          className="flex h-8 w-8 items-center justify-center rounded-full text-white/36 transition hover:bg-white/[0.065] hover:text-white/65"
        >
          <MoreHorizontal size={17} />
        </motion.button>

        <AnimatePresence>
          {showMenu && (
            <motion.div
              initial={{ opacity: 0, y: -5, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.98 }}
              transition={{
                duration: 0.18,
                ease: [0.22, 1, 0.36, 1],
              }}
              className="absolute right-0 top-10 z-30 w-40 overflow-hidden rounded-[14px] border border-white/[0.08] bg-[#1A1A1D]/98 p-1.5 shadow-2xl backdrop-blur-2xl"
            >
              <button
                type="button"
                onClick={() => {
                  setShowMenu(false);
                  onDelete();
                }}
                className="w-full rounded-[9px] px-3 py-2 text-left text-[12px] text-red-400 transition hover:bg-red-500/10"
              >
                Delete course
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

function AddCourseModal({
  semesterName,
  onClose,
  onAdd,
}: {
  semesterName: string;
  onClose: () => void;
  onAdd: (course: Omit<Course, "id">) => void;
}) {
  const schoolTheme = useSchoolTheme();
  const courseColors = useMemo(
    () => buildThemePalette(
      schoolTheme.brandColors,
      schoolTheme.accent,
      schoolTheme.accentDark,
    ),
    [schoolTheme],
  );

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [professor, setProfessor] = useState("");
  const [credits, setCredits] = useState("");
  const [color, setColor] = useState(schoolTheme.accent);

  const parsedCredits = Number(credits);

  const validCredits =
    credits.trim().length > 0 &&
    Number.isFinite(parsedCredits) &&
    parsedCredits > 0;

  const canSave =
    code.trim().length > 0 &&
    name.trim().length > 0 &&
    validCredits;

  function saveCourse() {
    if (!canSave) return;

    onAdd({
      code: code.trim().toUpperCase(),
      name: name.trim(),
      professor: professor.trim(),
      credits: parsedCredits,
      color,
    });
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/65 backdrop-blur-md sm:items-center sm:p-6"
    >
      <motion.div
        initial={{
          opacity: 0,
          y: 24,
          scale: 0.985,
        }}
        animate={{
          opacity: 1,
          y: 0,
          scale: 1,
        }}
        exit={{
          opacity: 0,
          y: 16,
          scale: 0.99,
        }}
        transition={{
          duration: 0.42,
          ease: [0.22, 1, 0.36, 1],
        }}
        className="relative w-full overflow-hidden border-t border-white/[0.09] bg-[#121214] shadow-[0_-30px_100px_rgba(0,0,0,0.55)] sm:max-w-[560px] sm:rounded-[28px] sm:border"
      >
        <motion.div
          className="absolute left-0 top-0 h-[2px] w-full origin-center"
          style={{
            background: `linear-gradient(90deg, transparent, ${schoolTheme.accent}, transparent)`,
          }}
          initial={{ scaleX: 0, opacity: 0 }}
          animate={{ scaleX: 1, opacity: 1 }}
          transition={{
            delay: 0.12,
            duration: 0.55,
            ease: [0.22, 1, 0.36, 1],
          }}
        />

        <div className="p-6 sm:p-8">
          <div className="mb-8 flex items-start justify-between gap-5">
            <div>
              <div className="mb-4 flex items-center gap-2">
                <motion.div
                  className="h-1.5 w-1.5 rounded-full"
                  style={{
                    backgroundColor: schoolTheme.accent,
                  }}
                  animate={{
                    opacity: [0.55, 1, 0.55],
                  }}
                  transition={{
                    duration: 2.8,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }}
                />

                <p
                  className="text-[11px] font-semibold uppercase tracking-[0.18em]"
                  style={{
                    color: schoolTheme.accent,
                  }}
                >
                  {schoolTheme.shortName} · {semesterName}
                </p>
              </div>

              <h2 className="text-[28px] font-medium tracking-[-0.045em]">
                Add a course
              </h2>

              <p className="mt-2 text-[13px] leading-5 text-white/46">
                Start with the basics. Everything else can be added later.
              </p>
            </div>

            <motion.button
              onClick={onClose}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.94 }}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.055] text-white/50 transition hover:bg-white/[0.09] hover:text-white/70"
            >
              <X size={15} />
            </motion.button>
          </div>

          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-[1fr_125px]">
              <FormField label="Course code">
                <input
                  value={code}
                  onChange={(event) =>
                    setCode(event.target.value)
                  }
                  placeholder="PHYS 211"
                  autoFocus
                  className={inputClass}
                />
              </FormField>

              <FormField label="Credits">
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.5"
                  value={credits}
                  onChange={(event) =>
                    setCredits(event.target.value)
                  }
                  placeholder="3.5"
                  className={inputClass}
                />
              </FormField>
            </div>

            <FormField label="Course name">
              <input
                value={name}
                onChange={(event) =>
                  setName(event.target.value)
                }
                placeholder="University Physics: Mechanics"
                className={inputClass}
              />
            </FormField>

            <FormField label="Professor">
              <input
                value={professor}
                onChange={(event) =>
                  setProfessor(event.target.value)
                }
                placeholder="Optional"
                className={inputClass}
              />
            </FormField>

            <FormField label="Course marker">
              <div className="flex flex-wrap gap-3 pt-1">
                {courseColors.map((courseColor) => (
                  <motion.button
                    key={courseColor}
                    type="button"
                    onClick={() =>
                      setColor(courseColor)
                    }
                    whileHover={{ scale: 1.08 }}
                    whileTap={{ scale: 0.94 }}
                    className={`relative flex h-8 w-8 items-center justify-center rounded-full transition ${
                      color === courseColor
                        ? "scale-110 ring-1 ring-white/55 ring-offset-[3px] ring-offset-[#121214]"
                        : "opacity-70 hover:opacity-100"
                    }`}
                    style={{
                      backgroundColor: courseColor,
                    }}
                  >
                    <AnimatePresence>
                      {color === courseColor && (
                        <motion.div
                          initial={{ scale: 0, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          exit={{ scale: 0, opacity: 0 }}
                          transition={{
                            type: "spring",
                            stiffness: 420,
                            damping: 24,
                          }}
                          className="h-[6px] w-[6px] rounded-full bg-black/65"
                        />
                      )}
                    </AnimatePresence>
                  </motion.button>
                ))}
              </div>
            </FormField>
          </div>

          <div className="mt-9 flex items-center justify-between gap-4">
            <p className="hidden text-[12px] text-white/32 sm:block">
              You can edit these details anytime.
            </p>

            <div className="ml-auto flex items-center gap-2">
              <motion.button
                onClick={onClose}
                whileTap={{ scale: 0.97 }}
                className="rounded-full px-4 py-2.5 text-[12px] font-medium text-white/50 transition hover:bg-white/[0.04] hover:text-white/65"
              >
                Cancel
              </motion.button>

              <motion.button
                onClick={saveCourse}
                disabled={!canSave}
                whileHover={canSave ? { y: -1 } : undefined}
                whileTap={canSave ? { scale: 0.98 } : undefined}
                className="rounded-full bg-white px-5 py-2.5 text-[12px] font-medium text-black transition hover:bg-white/88 disabled:cursor-not-allowed disabled:opacity-20"
              >
                Add course
              </motion.button>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function AccountMenu({
  open,
  name,
  email,
  onProfile,
  onLogout,
  loggingOut,
  mobile = false,
}: {
  open: boolean;
  name: string;
  email: string;
  onProfile: () => void;
  onLogout: () => void;
  loggingOut: boolean;
  mobile?: boolean;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: -5, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -4, scale: 0.98 }}
          transition={{
            duration: 0.18,
            ease: [0.22, 1, 0.36, 1],
          }}
          className={`absolute z-50 w-[230px] overflow-hidden rounded-[17px] border border-white/[0.08] bg-[#17171A]/98 p-2 shadow-[0_24px_70px_rgba(0,0,0,0.55)] backdrop-blur-2xl ${
            mobile
              ? "right-0 top-12"
              : "right-0 top-11"
          }`}
        >
          <div className="border-b border-white/[0.055] px-3 pb-3 pt-2">
            <p className="truncate text-[11px] font-medium text-white/72">
              {name}
            </p>
            <p className="mt-1 truncate text-[11px] text-white/40">
              {email || "Account"}
            </p>
          </div>

          <div className="pt-1.5">
            <button
              type="button"
              onClick={onProfile}
              className="flex w-full items-center gap-2.5 rounded-[11px] px-3 py-2.5 text-left text-[12px] text-white/42 transition hover:bg-white/[0.045] hover:text-white/75"
            >
              <UserRound size={13} />
              Profile & account
            </button>

            <button
              type="button"
              onClick={onLogout}
              disabled={loggingOut}
              className="flex w-full items-center gap-2.5 rounded-[11px] px-3 py-2.5 text-left text-[12px] text-red-300/55 transition hover:bg-red-500/[0.07] hover:text-red-200 disabled:opacity-35"
            >
              <LogOut size={13} />
              {loggingOut ? "Logging out" : "Log out"}
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function NavigationItem({
  icon: Icon,
  label,
  active = false,
  collapsed = false,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  active?: boolean;
  collapsed?: boolean;
  onClick?: () => void;
}) {
  const schoolTheme = useSchoolTheme();

  return (
    <motion.button
      type="button"
      onClick={onClick}
      title={collapsed ? label : undefined}
      aria-label={collapsed ? label : undefined}
      whileHover={{
        x: collapsed || active ? 0 : 2,
        scale: collapsed ? 1.035 : 1,
      }}
      whileTap={{ scale: 0.97 }}
      className={`group relative flex w-full items-center rounded-[12px] text-[12px] transition ${
        collapsed
          ? "h-11 justify-center px-0"
          : "gap-3 px-3 py-[10px]"
      } ${
        active
          ? "bg-white/[0.055] text-white/88"
          : "text-white/50 hover:bg-white/[0.03] hover:text-white/72"
      }`}
    >
      {active && (
        <motion.div
          layoutId="desktop-nav-active"
          className={`absolute rounded-full ${
            collapsed
              ? "bottom-1.5 h-[2px] w-4"
              : "left-0 h-4 w-[2px]"
          }`}
          style={{
            backgroundColor: schoolTheme.accent,
          }}
          transition={{
            type: "spring",
            stiffness: 360,
            damping: 30,
          }}
        />
      )}

      <Icon
        size={collapsed ? 18 : 16}
        strokeWidth={active ? 2.1 : 1.7}
      />

      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.span
            key={`${label}-copy`}
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -4 }}
            transition={{ duration: 0.15 }}
            className="whitespace-nowrap"
          >
            {label}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}

function GoalRing({
  currentGpa,
  targetGpa,
  progress,
  gap,
  reached,
  color,
}: {
  currentGpa: number | null;
  targetGpa: number;
  progress: number;
  gap: number | null;
  reached: boolean;
  color: string;
}) {
  const percentage =
    currentGpa === null
      ? 0
      : Math.min(100, Math.max(0, progress * 100));

  return (
    <div className="mx-auto flex flex-col items-center lg:mx-0">
      <div
        className="relative flex h-[184px] w-[184px] items-center justify-center rounded-full p-[1px]"
        style={{
          background: `conic-gradient(${color} ${percentage}%, rgba(255,255,255,0.07) ${percentage}% 100%)`,
        }}
      >
        <div className="flex h-full w-full items-center justify-center rounded-full bg-[#101012] p-4">
          <div className="text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-white/36">
              Goal meter
            </p>
            <p className="mt-2 text-[34px] font-medium tracking-[-0.055em] text-white/80">
              {currentGpa === null
                ? "--"
                : `${Math.round(percentage)}%`}
            </p>
            <p className="mt-1 text-[11px] text-white/40">
              of {targetGpa.toFixed(2)}
            </p>
          </div>
        </div>
      </div>

      <p
        className="mt-4 text-center text-[12px] font-medium"
        style={{ color }}
      >
        {currentGpa === null
          ? "Waiting for grades"
          : reached
            ? "Target cleared"
            : `${gap?.toFixed(2)} left to close`}
      </p>
    </div>
  );
}

function HeroMetric({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  const schoolTheme = useSchoolTheme();

  return (
    <div className="flex items-center justify-between gap-4 border-b border-white/[0.045] pb-4 last:border-b-0 last:pb-0">
      <p className="text-[11px] text-white/36">
        {label}
      </p>

      <p
        className="text-[12px] font-medium text-white/56"
        style={
          accent
            ? { color: schoolTheme.accent }
            : undefined
        }
      >
        {value}
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        delay: 0.22,
        duration: 0.52,
        ease: [0.22, 1, 0.36, 1],
      }}
    >
      <p className="text-[24px] font-medium tracking-[-0.045em] text-white/88">
        {value}
      </p>

      <p className="mt-1 text-[11px] uppercase tracking-[0.12em] text-white/34">
        {label}
      </p>
    </motion.div>
  );
}

function SemesterLine({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-5 border-b border-white/[0.06] py-4.5 first:pt-5">
      <p className="text-[13px] text-white/44">
        {label}
      </p>

      <p
        className={`text-[13px] font-medium ${
          muted
            ? "text-white/38"
            : "text-white/72"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function AcademicRow({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <motion.div
      whileHover={{ x: 2 }}
      transition={{ duration: 0.2 }}
      className="flex items-center justify-between border-b border-white/[0.055] py-4 first:border-t"
    >
      <p className="text-[12px] text-white/46">
        {label}
      </p>

      <p
        className={`text-[12px] ${
          muted
            ? "text-white/27"
            : "text-white/78"
        }`}
      >
        {value}
      </p>
    </motion.div>
  );
}

function FormField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-[12px] font-medium uppercase tracking-[0.09em] text-white/40">
        {label}
      </span>

      {children}
    </label>
  );
}

const inputClass =
  "w-full rounded-[13px] border border-white/[0.075] bg-white/[0.035] px-3.5 py-3 text-[13px] text-white outline-none transition placeholder:text-white/17 hover:border-white/[0.12] focus:border-white/20 focus:bg-white/[0.055] focus:ring-4 focus:ring-white/[0.025]";

function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(
    2,
    "0",
  );
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatEventMonthDay(value: string) {
  const parsed = new Date(`${value}T12:00:00`);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  })
    .format(parsed)
    .toUpperCase();
}

function formatGpa(value: number) {
  return Number.isFinite(value) ? value.toFixed(2) : "3.70";
}

function buildThemePalette(
  brandColors: string[],
  primary: string,
  secondary: string,
) {
  const candidates = [
    ...brandColors,
    primary,
    secondary,
    mixHex(primary, "#FFFFFF", 0.22),
    mixHex(secondary, "#FFFFFF", 0.2),
    mixHex(primary, "#000000", 0.15),
    mixHex(primary, secondary, 0.5),
  ]
    .filter(isHex)
    .map((color) => color.toUpperCase())
    .filter(
      (color) =>
        !["#000000", "#FFFFFF", "#1C1C1C", "#F5F5F5"].includes(color),
    );

  const unique = [...new Set(candidates)];

  return unique.length >= 6
    ? unique.slice(0, 6)
    : [
        ...unique,
        "#8BA18E",
        "#B3C9CD",
        "#ECB748",
        "#946E24",
        "#A5A5AA",
      ].slice(0, 6);
}

function isHex(value: string) {
  return /^#[0-9A-Fa-f]{6}$/.test(value);
}

function mixHex(colorA: string, colorB: string, amount: number) {
  if (!isHex(colorA) || !isHex(colorB)) return colorA;

  const a = hexToRgb(colorA);
  const b = hexToRgb(colorB);
  const ratio = Math.min(1, Math.max(0, amount));

  const channel = (start: number, end: number) =>
    Math.round(start + (end - start) * ratio);

  return rgbToHex(
    channel(a.r, b.r),
    channel(a.g, b.g),
    channel(a.b, b.b),
  );
}

function hexToRgb(value: string) {
  const hex = value.replace("#", "");

  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

function rgbToHex(r: number, g: number, b: number) {
  return `#${[r, g, b]
    .map((value) =>
      Math.max(0, Math.min(255, value))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function formatCredits(value: number) {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(1);
}

function CoursesLoading() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="overflow-hidden rounded-[30px] border border-white/[0.07] bg-[#101012]"
    >
      <div className="animate-pulse p-8 sm:p-9">
        <div className="h-10 w-10 rounded-[13px] bg-white/[0.05]" />

        <div className="mt-8 h-6 w-52 rounded-md bg-white/[0.055]" />

        <div className="mt-3 h-3 w-80 max-w-full rounded bg-white/[0.035]" />

        <div className="mt-2 h-3 w-64 max-w-full rounded bg-white/[0.035]" />
      </div>
    </motion.div>
  );
}
