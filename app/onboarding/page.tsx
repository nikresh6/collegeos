"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AnimatePresence,
  MotionConfig,
  motion,
} from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CalendarDays,
  Check,
  ChevronDown,
  GraduationCap,
  Loader2,
  Plus,
  Search,
  Sparkles,
  Target,
  Trash2,
} from "lucide-react";
import { supabase } from "../../lib/supabase";

type School = {
  id: string;
  name: string;
  short_name: string | null;
  aliases: string[];
  primary_color: string;
  secondary_color: string;
  brand_colors: string[];
  color_verified: boolean;
  sort_priority: number;
};

type CourseDraft = {
  id: string;
  code: string;
  name: string;
  professor: string;
  credits: string;
  color: string;
};

const goals = [
  "Stay ahead of deadlines",
  "Improve exam performance",
  "Build consistent study habits",
  "Master difficult material",
];

const fallbackColors = [
  "#CFAE70",
  "#8BA18E",
  "#B3C9CD",
  "#ECB748",
  "#946E24",
  "#A5A5AA",
];

const transition = {
  duration: 0.55,
  ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
};

export default function OnboardingPage() {
  const router = useRouter();

  const [schools, setSchools] = useState<School[]>([]);
  const [selectedSchool, setSelectedSchool] = useState<School | null>(null);
  const [schoolQuery, setSchoolQuery] = useState("");
  const [schoolPickerOpen, setSchoolPickerOpen] = useState(false);

  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [finishing, setFinishing] = useState(false);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState("");

  const [authenticated, setAuthenticated] = useState(false);
  const [authMode, setAuthMode] = useState<"signup" | "signin">("signup");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authMessage, setAuthMessage] = useState("");

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [graduationYear, setGraduationYear] = useState("");
  const [semesterName, setSemesterName] = useState(defaultSemesterName());
  const [semesterStart, setSemesterStart] = useState("");
  const [semesterEnd, setSemesterEnd] = useState("");
  const [targetGpa, setTargetGpa] = useState("3.70");
  const [studyGoals, setStudyGoals] = useState<string[]>([]);
  const [timezone, setTimezone] = useState("");
  const [courses, setCourses] = useState<CourseDraft[]>([]);

  useEffect(() => {
    void initialize();
  }, []);

  const accent = selectedSchool?.primary_color ?? "#CFAE70";
  const accentSecondary = selectedSchool?.secondary_color ?? "#8A713E";

  const coursePalette = useMemo(
    () => buildCoursePalette(selectedSchool),
    [selectedSchool],
  );

  const totalCredits = useMemo(
    () =>
      courses.reduce((sum, course) => {
        const value = Number(course.credits);
        return sum + (Number.isFinite(value) ? value : 0);
      }, 0),
    [courses],
  );

  const filteredSchools = useMemo(() => {
    const meaningfulTokens = normalizeSearch(schoolQuery);

    if (meaningfulTokens.length === 0) {
      return schools.slice(0, 12);
    }

    return schools
      .map((school) => {
        const haystack = normalizeSearch(
          [
            school.name,
            school.short_name ?? "",
            ...(school.aliases ?? []),
          ].join(" "),
        );

        const everyTokenMatches = meaningfulTokens.every((token) =>
          haystack.some(
            (candidate) =>
              candidate.includes(token) || token.includes(candidate),
          ),
        );

        const exactBonus =
          school.name.toLowerCase() === schoolQuery.trim().toLowerCase() ||
          school.short_name?.toLowerCase() === schoolQuery.trim().toLowerCase()
            ? 10000
            : 0;

        return {
          school,
          matches: everyTokenMatches,
          score: exactBonus - school.sort_priority,
        };
      })
      .filter((item) => item.matches)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map((item) => item.school);
  }, [schools, schoolQuery]);

  const canContinue = useMemo(() => {
    if (step === 0) return authenticated;
    if (step === 1) return Boolean(selectedSchool);
    if (step === 2) return semesterName.trim().length > 0;
    if (step === 3) {
      return courses.every(
        (course) =>
          course.code.trim().length > 0 &&
          course.name.trim().length > 0 &&
          Number(course.credits) > 0,
      );
    }
    if (step === 4) {
      const gpa = Number(targetGpa);
      return Number.isFinite(gpa) && gpa >= 0 && gpa <= 4;
    }
    return true;
  }, [step, authenticated, selectedSchool, semesterName, courses, targetGpa]);

  async function initialize() {
    try {
      setLoading(true);
      setError("");

      const detectedTimezone =
        Intl.DateTimeFormat().resolvedOptions().timeZone || "";
      setTimezone(detectedTimezone);

      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) {
        throw sessionError;
      }

      if (!session) {
        setAuthenticated(false);
        setStep(0);
        return;
      }

      await continueAfterAuthentication(session.user);
    } catch (initializationError) {
      console.error("Onboarding initialization error:", initializationError);
      setError(
        initializationError instanceof Error
          ? initializationError.message
          : "Could not load onboarding.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadSchools() {
    const { data, error: schoolError } = await supabase
      .from("schools")
      .select(
        "id, name, short_name, aliases, primary_color, secondary_color, brand_colors, color_verified, sort_priority",
      )
      .order("sort_priority", { ascending: true })
      .order("name", { ascending: true });

    if (schoolError) {
      throw schoolError;
    }

    setSchools(
      (data ?? []).map((school) => ({
        id: school.id,
        name: school.name,
        short_name: school.short_name,
        aliases: school.aliases ?? [],
        primary_color: school.primary_color,
        secondary_color: school.secondary_color,
        brand_colors: school.brand_colors ?? [],
        color_verified: Boolean(school.color_verified),
        sort_priority: Number(school.sort_priority),
      })),
    );
  }

  async function continueAfterAuthentication(user: {
    id: string;
    email?: string | null;
    user_metadata?: Record<string, unknown>;
  }) {
    setAuthenticated(true);
    setCurrentUserId(user.id);

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select(
        "first_name, last_name, preferred_name, onboarding_completed, school_id, current_semester_id",
      )
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      throw profileError;
    }

    if (profile?.onboarding_completed && profile.school_id) {
      router.replace("/");
      return;
    }

    const metadata = user.user_metadata ?? {};
    const metadataFirstName =
      typeof metadata.first_name === "string"
        ? metadata.first_name
        : typeof metadata.given_name === "string"
          ? metadata.given_name
          : "";

    const metadataLastName =
      typeof metadata.last_name === "string"
        ? metadata.last_name
        : typeof metadata.family_name === "string"
          ? metadata.family_name
          : "";

    const resolvedFirstName =
      profile?.first_name?.trim() ||
      profile?.preferred_name?.trim() ||
      metadataFirstName.trim();

    const resolvedLastName =
      profile?.last_name?.trim() || metadataLastName.trim();

    if (resolvedFirstName) {
      setFirstName(resolvedFirstName);
    }

    if (resolvedLastName) {
      setLastName(resolvedLastName);
    }

    if (resolvedFirstName || resolvedLastName) {
      const { error: profileUpsertError } = await supabase
        .from("profiles")
        .upsert(
          {
            id: user.id,
            first_name: resolvedFirstName || null,
            last_name: resolvedLastName || null,
            preferred_name: resolvedFirstName || null,
          },
          { onConflict: "id" },
        );

      if (profileUpsertError) {
        throw profileUpsertError;
      }
    }

    await loadSchools();

    if (!resolvedFirstName || !resolvedLastName) {
      setStep(0);
      return;
    }

    setStep(1);
  }

  async function savePersonalDetailsAndContinue() {
    if (!currentUserId) {
      setError("Your session could not be found. Please sign in again.");
      return;
    }

    const cleanFirstName = firstName.trim();
    const cleanLastName = lastName.trim();

    if (!cleanFirstName || !cleanLastName) {
      setError("Enter your first and last name.");
      return;
    }

    try {
      setAuthLoading(true);
      setError("");

      const { error: authUpdateError } = await supabase.auth.updateUser({
        data: {
          first_name: cleanFirstName,
          last_name: cleanLastName,
          full_name: `${cleanFirstName} ${cleanLastName}`,
          preferred_name: cleanFirstName,
        },
      });

      if (authUpdateError) {
        throw authUpdateError;
      }

      const { error: profileError } = await supabase
        .from("profiles")
        .upsert(
          {
            id: currentUserId,
            first_name: cleanFirstName,
            last_name: cleanLastName,
            preferred_name: cleanFirstName,
          },
          { onConflict: "id" },
        );

      if (profileError) {
        throw profileError;
      }

      if (schools.length === 0) {
        await loadSchools();
      }

      setStep(1);
    } catch (detailsError) {
      console.error("Could not save personal details:", detailsError);
      setError(
        detailsError instanceof Error
          ? detailsError.message
          : "Could not save your name.",
      );
    } finally {
      setAuthLoading(false);
    }
  }

  async function submitEmailAuth() {
    if (authLoading) return;

    const email = authEmail.trim().toLowerCase();
    const password = authPassword;

    if (!email || !password) {
      setError("Enter your email and password.");
      return;
    }

    if (authMode === "signup" && (!firstName.trim() || !lastName.trim())) {
      setError("Enter your first and last name.");
      return;
    }

    if (password.length < 6) {
      setError("Use a password with at least 6 characters.");
      return;
    }

    try {
      setAuthLoading(true);
      setError("");
      setAuthMessage("");

      if (authMode === "signup") {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/onboarding`,
            data: {
              first_name: firstName.trim() || undefined,
              last_name: lastName.trim() || undefined,
              full_name:
                firstName.trim() && lastName.trim()
                  ? `${firstName.trim()} ${lastName.trim()}`
                  : undefined,
              preferred_name: firstName.trim() || undefined,
            },
          },
        });

        if (signUpError) {
          throw signUpError;
        }

        if (!data.session || !data.user) {
          setAuthMessage(
            "Check your email to confirm your account, then return here to continue setup.",
          );
          return;
        }

        await continueAfterAuthentication(data.user);
        return;
      }

      const { data, error: signInError } =
        await supabase.auth.signInWithPassword({
          email,
          password,
        });

      if (signInError) {
        throw signInError;
      }

      if (!data.user) {
        throw new Error("Could not sign in.");
      }

      await continueAfterAuthentication(data.user);
    } catch (authError) {
      console.error("Authentication error:", authError);
      setError(
        authError instanceof Error
          ? authError.message
          : "Could not authenticate.",
      );
    } finally {
      setAuthLoading(false);
    }
  }

  async function signInWithGoogle() {
    if (authLoading) return;

    try {
      setAuthLoading(true);
      setError("");
      setAuthMessage("");

      const { error: googleError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/onboarding`,
        },
      });

      if (googleError) {
        throw googleError;
      }
    } catch (googleError) {
      console.error("Google authentication error:", googleError);
      setError(
        googleError instanceof Error
          ? googleError.message
          : "Could not start Google sign in.",
      );
      setAuthLoading(false);
    }
  }

  function chooseSchool(school: School) {
    setSelectedSchool(school);
    setSchoolQuery(school.name);
    setSchoolPickerOpen(false);

    setCourses((current) =>
      current.map((course, index) => ({
        ...course,
        color: coursePaletteFromSchool(school)[
          index % coursePaletteFromSchool(school).length
        ],
      })),
    );
  }

  function goNext() {
    if (!canContinue) return;

    if (step === 2 && courses.length === 0) {
      setCourses([createCourse(coursePalette[0])]);
    }

    setStep((current) => Math.min(4, current + 1));
  }

  function goBack() {
    setStep((current) => Math.max(0, current - 1));
  }

  function addCourse() {
    const color =
      coursePalette[courses.length % Math.max(coursePalette.length, 1)] ??
      accent;

    setCourses((current) => [...current, createCourse(color)]);
  }

  function updateCourse(
    id: string,
    field: keyof Omit<CourseDraft, "id">,
    value: string,
  ) {
    setCourses((current) =>
      current.map((course) =>
        course.id === id ? { ...course, [field]: value } : course,
      ),
    );
  }

  function removeCourse(id: string) {
    setCourses((current) => current.filter((course) => course.id !== id));
  }

  function toggleGoal(goal: string) {
    setStudyGoals((current) =>
      current.includes(goal)
        ? current.filter((item) => item !== goal)
        : [...current, goal],
    );
  }

  async function finishOnboarding() {
    if (!selectedSchool || finishing) return;

    try {
      setFinishing(true);
      setError("");

      const graduationYearValue = graduationYear
        ? Number(graduationYear)
        : null;

      const cleanFirstName = firstName.trim();
      const cleanLastName = lastName.trim();

      if (!cleanFirstName || !cleanLastName) {
        throw new Error("First and last name are required.");
      }

      const { error: authUpdateError } = await supabase.auth.updateUser({
        data: {
          first_name: cleanFirstName,
          last_name: cleanLastName,
          full_name: `${cleanFirstName} ${cleanLastName}`,
          preferred_name: cleanFirstName,
        },
      });

      if (authUpdateError) {
        throw authUpdateError;
      }

      const { error: rpcError } = await supabase.rpc("complete_onboarding", {
        p_school_id: selectedSchool.id,
        p_first_name: cleanFirstName,
        p_last_name: cleanLastName,
        p_graduation_year:
          graduationYearValue && Number.isFinite(graduationYearValue)
            ? graduationYearValue
            : null,
        p_target_gpa: Number(targetGpa),
        p_timezone: timezone || null,
        p_study_goals: studyGoals,
        p_semester_name: semesterName.trim(),
        p_semester_start: semesterStart || null,
        p_semester_end: semesterEnd || null,
        p_courses: courses.map((course) => ({
          code: course.code.trim(),
          name: course.name.trim(),
          professor: course.professor.trim(),
          credits: Number(course.credits),
          color: course.color,
        })),
      });

      if (rpcError) {
        throw rpcError;
      }

      setFinished(true);
    } catch (finishError) {
      console.error("Could not complete onboarding:", finishError);
      setError(
        finishError instanceof Error
          ? finishError.message
          : "Could not finish onboarding.",
      );
    } finally {
      setFinishing(false);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#080809] text-white">
        <div className="flex items-center gap-3 text-[12px] text-white/35">
          <Loader2 size={15} className="animate-spin" />
          Preparing your workspace
        </div>
      </main>
    );
  }

  return (
    <MotionConfig reducedMotion="user">
      <main className="relative min-h-screen overflow-hidden bg-[#080809] text-[#F5F5F7]">
        <motion.div
          aria-hidden
          className="pointer-events-none fixed left-[10%] top-[-360px] h-[700px] w-[820px] rounded-full opacity-[0.12] blur-[150px]"
          animate={{ backgroundColor: accent }}
          transition={{ duration: 0.7 }}
        />

        <motion.div
          aria-hidden
          className="pointer-events-none fixed bottom-[-420px] right-[-220px] h-[680px] w-[680px] rounded-full opacity-[0.07] blur-[150px]"
          animate={{ backgroundColor: accentSecondary }}
          transition={{ duration: 0.7 }}
        />

        <div className="relative mx-auto flex min-h-screen max-w-[1500px]">
          <aside className="hidden w-[300px] shrink-0 border-r border-white/[0.06] px-8 py-8 lg:flex lg:flex-col">
            <div className="flex items-center gap-3">
              <motion.div
                animate={{
                  backgroundColor: `${accent}18`,
                  borderColor: `${accent}55`,
                  color: accent,
                }}
                className="flex h-10 w-10 items-center justify-center rounded-[13px] border text-[15px] font-semibold"
              >
                {selectedSchool
                  ? schoolInitial(selectedSchool)
                  : <GraduationCap size={17} />}
              </motion.div>

              <div>
                <p className="text-[12px] font-medium text-white/76">
                  College Assistant
                </p>
                <p className="mt-0.5 text-[10px] text-white/24">
                  Semester setup
                </p>
              </div>
            </div>

            <div className="mt-16">
              {["Account", "School", "Semester", "Courses", "Goals"].map(
                (label, index) => {
                  const active = step === index;
                  const complete = step > index || finished;

                  return (
                    <div
                      key={label}
                      className="relative flex min-h-[58px] items-start gap-3"
                    >
                      {index < 4 && (
                        <div className="absolute left-[10px] top-[22px] h-[36px] w-px bg-white/[0.06]" />
                      )}

                      <motion.div
                        animate={{
                          backgroundColor:
                            active || complete ? accent : "rgba(255,255,255,0.04)",
                          borderColor:
                            active || complete ? accent : "rgba(255,255,255,0.08)",
                          color:
                            active || complete ? "#080809" : "rgba(255,255,255,0.28)",
                        }}
                        className="relative z-10 flex h-[21px] w-[21px] shrink-0 items-center justify-center rounded-full border text-[9px] font-semibold"
                      >
                        {complete ? <Check size={11} /> : index + 1}
                      </motion.div>

                      <div className="pt-[2px]">
                        <p
                          className={`text-[11px] transition ${
                            active ? "text-white/75" : "text-white/28"
                          }`}
                        >
                          {label}
                        </p>
                      </div>
                    </div>
                  );
                },
              )}
            </div>

            <div className="mt-auto border-t border-white/[0.055] pt-6">
              <p className="text-[9px] uppercase tracking-[0.14em] text-white/17">
                Local timezone
              </p>
              <p className="mt-2 text-[10px] text-white/32">
                {timezone || "Detected automatically"}
              </p>
            </div>
          </aside>

          <section className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center justify-between px-5 py-5 sm:px-8 lg:px-12">
              <button
                onClick={step === 0 ? undefined : goBack}
                disabled={step === 0}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.07] bg-white/[0.025] text-white/38 transition hover:bg-white/[0.055] hover:text-white/70 disabled:cursor-default disabled:opacity-20"
              >
                <ArrowLeft size={15} />
              </button>

              <div className="flex items-center gap-2 lg:hidden">
                {[0, 1, 2, 3, 4].map((index) => (
                  <motion.div
                    key={index}
                    animate={{
                      width: index === step ? 20 : 5,
                      backgroundColor:
                        index <= step ? accent : "rgba(255,255,255,0.1)",
                    }}
                    className="h-[5px] rounded-full"
                    transition={{
                      type: "spring",
                      stiffness: 340,
                      damping: 28,
                    }}
                  />
                ))}
              </div>

              <p className="text-[10px] tabular-nums text-white/22">
                {Math.min(step + 1, 5)} / 5
              </p>
            </div>

            <div className="flex flex-1 items-center justify-center px-5 pb-28 pt-5 sm:px-8 lg:px-12">
              <div className="w-full max-w-[900px]">
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-6 rounded-[17px] border border-red-500/15 bg-red-500/[0.04] px-4 py-3"
                  >
                    <p className="text-[10px] leading-5 text-red-200/60">
                      {error}
                    </p>
                  </motion.div>
                )}

                <AnimatePresence mode="wait">
                  {finished ? (
                    <FinishedStep
                      key="finished"
                      school={selectedSchool}
                      semesterName={semesterName}
                      courses={courses}
                      totalCredits={totalCredits}
                      targetGpa={targetGpa}
                      accent={accent}
                      onEnter={() => router.push("/")}
                    />
                  ) : (
                    <motion.div
                      key={step}
                      initial={{ opacity: 0, y: 18, filter: "blur(4px)" }}
                      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                      exit={{ opacity: 0, y: -10, filter: "blur(3px)" }}
                      transition={transition}
                    >
                      {step === 0 && (
                        <WelcomeStep
                          firstName={firstName}
                          onFirstNameChange={setFirstName}
                          lastName={lastName}
                          onLastNameChange={setLastName}
                          authenticated={authenticated}
                          accent={accent}
                          authMode={authMode}
                          onAuthModeChange={setAuthMode}
                          email={authEmail}
                          onEmailChange={setAuthEmail}
                          password={authPassword}
                          onPasswordChange={setAuthPassword}
                          authLoading={authLoading}
                          authMessage={authMessage}
                          onSubmit={
                            authenticated
                              ? savePersonalDetailsAndContinue
                              : submitEmailAuth
                          }
                          onGoogle={signInWithGoogle}
                        />
                      )}

                      {step === 1 && (
                        <SchoolStep
                          query={schoolQuery}
                          onQueryChange={(value) => {
                            setSchoolQuery(value);
                            setSchoolPickerOpen(true);
                          }}
                          open={schoolPickerOpen}
                          onOpenChange={setSchoolPickerOpen}
                          results={filteredSchools}
                          selectedSchool={selectedSchool}
                          onSelect={chooseSchool}
                          accent={accent}
                        />
                      )}

                      {step === 2 && (
                        <SemesterStep
                          semesterName={semesterName}
                          setSemesterName={setSemesterName}
                          semesterStart={semesterStart}
                          setSemesterStart={setSemesterStart}
                          semesterEnd={semesterEnd}
                          setSemesterEnd={setSemesterEnd}
                          graduationYear={graduationYear}
                          setGraduationYear={setGraduationYear}
                          accent={accent}
                        />
                      )}

                      {step === 3 && (
                        <CoursesStep
                          courses={courses}
                          palette={coursePalette}
                          onAdd={addCourse}
                          onUpdate={updateCourse}
                          onRemove={removeCourse}
                          accent={accent}
                        />
                      )}

                      {step === 4 && (
                        <GoalsStep
                          targetGpa={targetGpa}
                          setTargetGpa={setTargetGpa}
                          studyGoals={studyGoals}
                          onToggleGoal={toggleGoal}
                          selectedSchool={selectedSchool}
                          semesterName={semesterName}
                          courses={courses}
                          totalCredits={totalCredits}
                          accent={accent}
                        />
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {!finished && step > 0 && (
              <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-white/[0.065] bg-[#0B0B0D]/90 backdrop-blur-2xl lg:left-[300px]">
                <div className="mx-auto flex max-w-[1000px] items-center justify-between gap-4 px-5 py-4 sm:px-8">
                  <div>
                    <p className="text-[10px] text-white/25">
                      {step === 3 && courses.length === 0
                        ? "Courses are optional for now."
                        : step === 4
                          ? "You can change any of this later."
                          : "A few details, then your workspace is ready."}
                    </p>
                  </div>

                  {step < 4 ? (
                    <motion.button
                      onClick={goNext}
                      disabled={!canContinue}
                      whileHover={canContinue ? { y: -1 } : undefined}
                      whileTap={canContinue ? { scale: 0.98 } : undefined}
                      className="flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-[11px] font-medium text-black transition disabled:cursor-not-allowed disabled:opacity-20"
                    >
                      Continue
                      <ArrowRight size={13} />
                    </motion.button>
                  ) : (
                    <motion.button
                      onClick={finishOnboarding}
                      disabled={!canContinue || finishing}
                      whileHover={
                        canContinue && !finishing ? { y: -1 } : undefined
                      }
                      whileTap={
                        canContinue && !finishing ? { scale: 0.98 } : undefined
                      }
                      className="flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-[11px] font-medium text-black transition disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      {finishing ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <Sparkles size={13} />
                      )}
                      {finishing ? "Building workspace" : "Finish setup"}
                    </motion.button>
                  )}
                </div>
              </div>
            )}
          </section>
        </div>
      </main>
    </MotionConfig>
  );
}

function WelcomeStep({
  firstName,
  onFirstNameChange,
  lastName,
  onLastNameChange,
  authenticated,
  accent,
  authMode,
  onAuthModeChange,
  email,
  onEmailChange,
  password,
  onPasswordChange,
  authLoading,
  authMessage,
  onSubmit,
  onGoogle,
}: {
  firstName: string;
  onFirstNameChange: (value: string) => void;
  lastName: string;
  onLastNameChange: (value: string) => void;
  authenticated: boolean;
  accent: string;
  authMode: "signup" | "signin";
  onAuthModeChange: (mode: "signup" | "signin") => void;
  email: string;
  onEmailChange: (value: string) => void;
  password: string;
  onPasswordChange: (value: string) => void;
  authLoading: boolean;
  authMessage: string;
  onSubmit: () => void;
  onGoogle: () => void;
}) {
  const isSignup = authMode === "signup";

  return (
    <div className="grid gap-12 lg:grid-cols-[1.02fr_.78fr] lg:items-center">
      <div>
        <div className="mb-6 flex items-center gap-3">
          <motion.div
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ delay: 0.18, ...transition }}
            className="h-[2px] w-10 origin-left rounded-full"
            style={{ backgroundColor: accent }}
          />

          <p
            className="text-[9px] font-semibold uppercase tracking-[0.18em]"
            style={{ color: accent }}
          >
            Your account
          </p>
        </div>

        <h1 className="max-w-3xl text-[44px] font-medium leading-[0.98] tracking-[-0.06em] sm:text-[58px] lg:text-[68px]">
          Start with you.
        </h1>

        <p className="mt-7 max-w-xl text-[15px] leading-7 text-white/34">
          Your name and account stay attached to the academic workspace you
          build next.
        </p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 14, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ delay: 0.12, ...transition }}
        className="rounded-[28px] border border-white/[0.075] bg-[#101012]/92 p-5 shadow-[0_30px_100px_rgba(0,0,0,0.3)] backdrop-blur-2xl sm:p-6"
      >
        <div className="mb-6">
          <p className="text-[20px] font-medium tracking-[-0.035em] text-white/86">
            {authenticated
              ? "Complete your profile"
              : isSignup
                ? "Create your account"
                : "Welcome back"}
          </p>

          <p className="mt-2 text-[10px] leading-5 text-white/25">
            {authenticated
              ? "Confirm your personal information before we build your semester."
              : isSignup
                ? "Your account becomes the home for your academic workspace."
                : "Sign in and continue exactly where you left off."}
          </p>
        </div>

        {authenticated ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="First name">
                <input
                  value={firstName}
                  onChange={(event) =>
                    onFirstNameChange(event.target.value)
                  }
                  placeholder="First name"
                  autoFocus
                  className={inputClass}
                />
              </Field>

              <Field label="Last name">
                <input
                  value={lastName}
                  onChange={(event) =>
                    onLastNameChange(event.target.value)
                  }
                  placeholder="Last name"
                  className={inputClass}
                />
              </Field>
            </div>

            <motion.button
              type="button"
              onClick={onSubmit}
              disabled={authLoading}
              whileHover={!authLoading ? { y: -1 } : undefined}
              whileTap={!authLoading ? { scale: 0.985 } : undefined}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-[11px] font-medium text-black disabled:cursor-not-allowed disabled:opacity-40"
            >
              {authLoading && <Loader2 size={13} className="animate-spin" />}
              {authLoading ? "Saving" : "Continue setup"}
            </motion.button>
          </>
        ) : (
          <>
            {isSignup && (
              <div className="mb-4 grid gap-4 sm:grid-cols-2">
                <Field label="First name">
                  <input
                    value={firstName}
                    onChange={(event) =>
                      onFirstNameChange(event.target.value)
                    }
                    placeholder="First name"
                    autoFocus
                    className={inputClass}
                  />
                </Field>

                <Field label="Last name">
                  <input
                    value={lastName}
                    onChange={(event) =>
                      onLastNameChange(event.target.value)
                    }
                    placeholder="Last name"
                    className={inputClass}
                  />
                </Field>
              </div>
            )}

            <motion.button
              type="button"
              onClick={onGoogle}
              disabled={authLoading}
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.985 }}
              className="flex w-full items-center justify-center gap-3 rounded-[14px] border border-white/[0.08] bg-white/[0.035] px-4 py-3 text-[11px] font-medium text-white/70 transition hover:bg-white/[0.06] hover:text-white/90 disabled:opacity-40"
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-[10px] font-bold text-black">
                G
              </span>
              Continue with Google
            </motion.button>

            <div className="my-5 flex items-center gap-3">
              <div className="h-px flex-1 bg-white/[0.055]" />
              <span className="text-[8px] uppercase tracking-[0.12em] text-white/16">
                or
              </span>
              <div className="h-px flex-1 bg-white/[0.055]" />
            </div>

            <div className="space-y-4">
              <Field label="Email">
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => onEmailChange(event.target.value)}
                  placeholder="you@school.edu"
                  className={inputClass}
                />
              </Field>

              <Field label="Password">
                <input
                  type="password"
                  autoComplete={isSignup ? "new-password" : "current-password"}
                  value={password}
                  onChange={(event) => onPasswordChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") onSubmit();
                  }}
                  placeholder={isSignup ? "At least 6 characters" : "Your password"}
                  className={inputClass}
                />
              </Field>
            </div>

            {authMessage && (
              <div className="mt-4 rounded-[14px] border border-white/[0.06] bg-white/[0.025] px-3.5 py-3">
                <p className="text-[10px] leading-5 text-white/42">
                  {authMessage}
                </p>
              </div>
            )}

            <motion.button
              type="button"
              onClick={onSubmit}
              disabled={authLoading}
              whileHover={!authLoading ? { y: -1 } : undefined}
              whileTap={!authLoading ? { scale: 0.985 } : undefined}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-[11px] font-medium text-black disabled:cursor-not-allowed disabled:opacity-40"
            >
              {authLoading && <Loader2 size={13} className="animate-spin" />}
              {authLoading
                ? "Working"
                : isSignup
                  ? "Create account"
                  : "Sign in"}
            </motion.button>

            <button
              type="button"
              onClick={() =>
                onAuthModeChange(isSignup ? "signin" : "signup")
              }
              className="mt-5 w-full text-center text-[10px] text-white/27 transition hover:text-white/60"
            >
              {isSignup
                ? "Already have an account? Sign in"
                : "New here? Create an account"}
            </button>
          </>
        )}
      </motion.div>
    </div>
  );
}

function SchoolStep({
  query,
  onQueryChange,
  open,
  onOpenChange,
  results,
  selectedSchool,
  onSelect,
  accent,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  open: boolean;
  onOpenChange: (value: boolean) => void;
  results: School[];
  selectedSchool: School | null;
  onSelect: (school: School) => void;
  accent: string;
}) {
  return (
    <div>
      <Eyebrow label="Your university" accent={accent} />

      <h1 className="max-w-3xl text-[40px] font-medium leading-[1.02] tracking-[-0.055em] sm:text-[52px]">
        Make the workspace yours.
      </h1>

      <p className="mt-5 max-w-xl text-[13px] leading-6 text-white/30">
        Your university sets the visual identity of the app. Search by full
        name, common name, or abbreviation.
      </p>

      <div className="relative mt-10 max-w-[680px]">
        <div
          className={`relative rounded-[20px] border bg-[#101012] transition ${
            open
              ? "border-white/[0.14]"
              : "border-white/[0.075]"
          }`}
        >
          <Search
            size={16}
            className="absolute left-4 top-1/2 -translate-y-1/2 text-white/22"
          />

          <input
            value={query}
            onFocus={() => onOpenChange(true)}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search universities"
            className="w-full bg-transparent py-4 pl-11 pr-11 text-[13px] text-white/80 outline-none placeholder:text-white/18"
          />

          <ChevronDown
            size={15}
            className={`absolute right-4 top-1/2 -translate-y-1/2 text-white/20 transition ${
              open ? "rotate-180" : ""
            }`}
          />
        </div>

        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, y: -6, scale: 0.99 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -5, scale: 0.99 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="absolute left-0 right-0 top-[calc(100%+8px)] z-30 max-h-[390px] overflow-y-auto rounded-[22px] border border-white/[0.08] bg-[#121214]/98 p-2 shadow-[0_30px_100px_rgba(0,0,0,0.55)] backdrop-blur-2xl"
            >
              {results.length > 0 ? (
                results.map((school) => (
                  <button
                    key={school.id}
                    type="button"
                    onClick={() => onSelect(school)}
                    className="group flex w-full items-center gap-3 rounded-[15px] px-3 py-3 text-left transition hover:bg-white/[0.045]"
                  >
                    <div
                      className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[12px] border text-[12px] font-semibold"
                      style={{
                        borderColor: `${school.primary_color}45`,
                        backgroundColor: `${school.primary_color}12`,
                        color: school.primary_color,
                      }}
                    >
                      {schoolInitial(school)}
                      <div className="absolute bottom-0 left-0 right-0 flex h-[3px]">
                        <div
                          className="flex-1"
                          style={{ backgroundColor: school.primary_color }}
                        />
                        <div
                          className="flex-1"
                          style={{ backgroundColor: school.secondary_color }}
                        />
                      </div>
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] font-medium text-white/68 group-hover:text-white/88">
                        {school.name}
                      </p>
                      {school.short_name &&
                        school.short_name !== school.name && (
                          <p className="mt-1 truncate text-[9px] text-white/22">
                            {school.short_name}
                          </p>
                        )}
                    </div>

                    <div className="flex items-center gap-1.5">
                      <span
                        className="h-3 w-3 rounded-full border border-white/10"
                        style={{ backgroundColor: school.primary_color }}
                      />
                      <span
                        className="h-3 w-3 rounded-full border border-white/10"
                        style={{ backgroundColor: school.secondary_color }}
                      />
                    </div>
                  </button>
                ))
              ) : (
                <div className="px-4 py-8 text-center">
                  <p className="text-[11px] text-white/28">
                    No matching school found.
                  </p>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {selectedSchool && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={transition}
          className="mt-8 max-w-[680px] overflow-hidden rounded-[24px] border border-white/[0.07] bg-white/[0.018]"
        >
          <div className="flex items-center gap-4 p-5">
            <div
              className="flex h-12 w-12 items-center justify-center rounded-[15px] border text-[15px] font-semibold"
              style={{
                color: selectedSchool.primary_color,
                borderColor: `${selectedSchool.primary_color}38`,
                backgroundColor: `${selectedSchool.primary_color}10`,
              }}
            >
              {schoolInitial(selectedSchool)}
            </div>

            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-white/78">
                {selectedSchool.name}
              </p>
              <p className="mt-1 text-[10px] text-white/24">
                Your app will inherit this palette.
              </p>
            </div>

            <div className="flex -space-x-1">
              {(selectedSchool.brand_colors.length > 0
                ? selectedSchool.brand_colors
                : [
                    selectedSchool.primary_color,
                    selectedSchool.secondary_color,
                  ]
              )
                .slice(0, 6)
                .map((color, index) => (
                  <div
                    key={`${color}-${index}`}
                    className="h-6 w-6 rounded-full border-2 border-[#101012]"
                    style={{ backgroundColor: color }}
                  />
                ))}
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}

function SemesterStep({
  semesterName,
  setSemesterName,
  semesterStart,
  setSemesterStart,
  semesterEnd,
  setSemesterEnd,
  graduationYear,
  setGraduationYear,
  accent,
}: {
  semesterName: string;
  setSemesterName: (value: string) => void;
  semesterStart: string;
  setSemesterStart: (value: string) => void;
  semesterEnd: string;
  setSemesterEnd: (value: string) => void;
  graduationYear: string;
  setGraduationYear: (value: string) => void;
  accent: string;
}) {
  const year = new Date().getFullYear();

  return (
    <div>
      <Eyebrow label="Semester" accent={accent} />

      <h1 className="max-w-3xl text-[40px] font-medium leading-[1.02] tracking-[-0.055em] sm:text-[52px]">
        Set the frame for your semester.
      </h1>

      <p className="mt-5 max-w-xl text-[13px] leading-6 text-white/30">
        The term becomes the container for your courses, deadlines, grades, and
        study progress.
      </p>

      <div className="mt-10 grid max-w-[760px] gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Current term">
            <input
              value={semesterName}
              onChange={(event) => setSemesterName(event.target.value)}
              placeholder="Fall 2026"
              className={inputClass}
            />
          </Field>
        </div>

        <Field label="Start date">
          <input
            type="date"
            value={semesterStart}
            onChange={(event) => setSemesterStart(event.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label="End date">
          <input
            type="date"
            value={semesterEnd}
            onChange={(event) => setSemesterEnd(event.target.value)}
            className={inputClass}
          />
        </Field>

        <div className="sm:col-span-2 sm:max-w-[360px]">
          <Field label="Graduation year">
            <select
              value={graduationYear}
              onChange={(event) => setGraduationYear(event.target.value)}
              className={inputClass}
            >
              <option value="">Not set</option>
              {Array.from({ length: 9 }, (_, index) => year + index).map(
                (value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ),
              )}
            </select>
          </Field>
        </div>
      </div>

      <p className="mt-4 max-w-xl text-[9px] leading-5 text-white/17">
        Exact semester dates are optional. They can be edited later.
      </p>
    </div>
  );
}

function CoursesStep({
  courses,
  palette,
  onAdd,
  onUpdate,
  onRemove,
  accent,
}: {
  courses: CourseDraft[];
  palette: string[];
  onAdd: () => void;
  onUpdate: (
    id: string,
    field: keyof Omit<CourseDraft, "id">,
    value: string,
  ) => void;
  onRemove: (id: string) => void;
  accent: string;
}) {
  return (
    <div>
      <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Eyebrow label="Courses" accent={accent} />

          <h1 className="max-w-2xl text-[40px] font-medium leading-[1.02] tracking-[-0.055em] sm:text-[52px]">
            Build your academic workspace.
          </h1>

          <p className="mt-5 max-w-xl text-[13px] leading-6 text-white/30">
            Add the classes you are taking now. Syllabi and materials come
            after setup.
          </p>
        </div>

        <motion.button
          onClick={onAdd}
          whileHover={{ y: -1 }}
          whileTap={{ scale: 0.98 }}
          className="flex w-fit items-center gap-2 rounded-full bg-white px-4 py-2.5 text-[11px] font-medium text-black"
        >
          <Plus size={13} />
          Add course
        </motion.button>
      </div>

      <div className="mt-9 space-y-3">
        <AnimatePresence initial={false}>
          {courses.map((course, index) => (
            <motion.div
              key={course.id}
              layout
              initial={{ opacity: 0, y: 10, scale: 0.995 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.99 }}
              transition={transition}
              className="rounded-[22px] border border-white/[0.065] bg-[#101012] p-4 sm:p-5"
            >
              <div className="grid gap-4 lg:grid-cols-[44px_135px_1fr_110px_36px] lg:items-end">
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-[12px] text-[12px] font-semibold text-black"
                  style={{
                    backgroundColor:
                      course.color || palette[index % palette.length],
                  }}
                >
                  {course.code.trim().charAt(0).toUpperCase() || index + 1}
                </div>

                <Field label="Code">
                  <input
                    value={course.code}
                    onChange={(event) =>
                      onUpdate(course.id, "code", event.target.value)
                    }
                    placeholder="PHYS 211"
                    className={compactInputClass}
                  />
                </Field>

                <Field label="Course name">
                  <input
                    value={course.name}
                    onChange={(event) =>
                      onUpdate(course.id, "name", event.target.value)
                    }
                    placeholder="University Physics"
                    className={compactInputClass}
                  />
                </Field>

                <Field label="Credits">
                  <input
                    type="number"
                    min="0.5"
                    max="30"
                    step="0.5"
                    inputMode="decimal"
                    value={course.credits}
                    onChange={(event) =>
                      onUpdate(course.id, "credits", event.target.value)
                    }
                    placeholder="3"
                    className={compactInputClass}
                  />
                </Field>

                <button
                  onClick={() => onRemove(course.id)}
                  className="flex h-9 w-9 items-center justify-center rounded-full text-white/18 transition hover:bg-red-500/10 hover:text-red-400"
                  aria-label="Remove course"
                >
                  <Trash2 size={13} />
                </button>
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end lg:ml-[60px]">
                <Field label="Professor">
                  <input
                    value={course.professor}
                    onChange={(event) =>
                      onUpdate(course.id, "professor", event.target.value)
                    }
                    placeholder="Optional"
                    className={compactInputClass}
                  />
                </Field>

                <div>
                  <p className="mb-2 text-[8px] font-medium uppercase tracking-[0.12em] text-white/18">
                    Marker
                  </p>
                  <div className="flex gap-2">
                    {palette.slice(0, 6).map((color) => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => onUpdate(course.id, "color", color)}
                        className={`h-7 w-7 rounded-full border transition ${
                          course.color === color
                            ? "scale-105 border-white/55"
                            : "border-white/5 opacity-55 hover:opacity-100"
                        }`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {courses.length === 0 && (
          <button
            onClick={onAdd}
            className="flex min-h-[150px] w-full items-center justify-center rounded-[22px] border border-dashed border-white/[0.08] bg-white/[0.01] text-[11px] text-white/28 transition hover:border-white/[0.14] hover:bg-white/[0.025] hover:text-white/55"
          >
            <Plus size={13} className="mr-2" />
            Add your first course
          </button>
        )}
      </div>
    </div>
  );
}

function GoalsStep({
  targetGpa,
  setTargetGpa,
  studyGoals,
  onToggleGoal,
  selectedSchool,
  semesterName,
  courses,
  totalCredits,
  accent,
}: {
  targetGpa: string;
  setTargetGpa: (value: string) => void;
  studyGoals: string[];
  onToggleGoal: (goal: string) => void;
  selectedSchool: School | null;
  semesterName: string;
  courses: CourseDraft[];
  totalCredits: number;
  accent: string;
}) {
  return (
    <div>
      <Eyebrow label="Your goals" accent={accent} />

      <h1 className="max-w-3xl text-[40px] font-medium leading-[1.02] tracking-[-0.055em] sm:text-[52px]">
        Give the semester a target.
      </h1>

      <p className="mt-5 max-w-xl text-[13px] leading-6 text-white/30">
        This gives the dashboard context for grades and future study
        recommendations. Nothing here is permanent.
      </p>

      <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_330px]">
        <div>
          <Field label="Target GPA">
            <div className="relative max-w-[220px]">
              <Target
                size={15}
                className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20"
              />
              <input
                type="number"
                min="0"
                max="4"
                step="0.01"
                inputMode="decimal"
                value={targetGpa}
                onChange={(event) => setTargetGpa(event.target.value)}
                className={`${inputClass} pl-11`}
              />
            </div>
          </Field>

          <div className="mt-9">
            <p className="mb-3 text-[9px] font-medium uppercase tracking-[0.13em] text-white/22">
              What matters most?
            </p>

            <div className="flex flex-wrap gap-2">
              {goals.map((goal) => {
                const selected = studyGoals.includes(goal);

                return (
                  <motion.button
                    key={goal}
                    onClick={() => onToggleGoal(goal)}
                    whileTap={{ scale: 0.97 }}
                    className="rounded-full border px-3.5 py-2.5 text-[10px] transition"
                    animate={{
                      borderColor: selected
                        ? `${accent}55`
                        : "rgba(255,255,255,0.07)",
                      backgroundColor: selected
                        ? `${accent}10`
                        : "rgba(255,255,255,0.018)",
                      color: selected
                        ? accent
                        : "rgba(255,255,255,0.35)",
                    }}
                  >
                    {goal}
                  </motion.button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="rounded-[24px] border border-white/[0.07] bg-[#101012] p-5">
          <p className="text-[9px] font-medium uppercase tracking-[0.14em] text-white/20">
            Semester preview
          </p>

          <div className="mt-5 flex items-center gap-3">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-[13px] border text-[12px] font-semibold"
              style={{
                borderColor: `${accent}40`,
                backgroundColor: `${accent}10`,
                color: accent,
              }}
            >
              {selectedSchool ? schoolInitial(selectedSchool) : "S"}
            </div>

            <div className="min-w-0">
              <p className="truncate text-[11px] font-medium text-white/70">
                {selectedSchool?.name ?? "School"}
              </p>
              <p className="mt-1 text-[9px] text-white/22">{semesterName}</p>
            </div>
          </div>

          <div className="mt-6">
            <PreviewRow label="Courses" value={String(courses.length)} />
            <PreviewRow
              label="Credits"
              value={formatCredits(totalCredits)}
            />
            <PreviewRow label="Target" value={targetGpa || "--"} last />
          </div>
        </div>
      </div>
    </div>
  );
}

function FinishedStep({
  school,
  semesterName,
  courses,
  totalCredits,
  targetGpa,
  accent,
  onEnter,
}: {
  school: School | null;
  semesterName: string;
  courses: CourseDraft[];
  totalCredits: number;
  targetGpa: string;
  accent: string;
  onEnter: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.985 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      className="text-center"
    >
      <motion.div
        initial={{ scale: 0.7, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{
          delay: 0.1,
          type: "spring",
          stiffness: 260,
          damping: 20,
        }}
        className="mx-auto flex h-16 w-16 items-center justify-center rounded-[20px] border"
        style={{
          borderColor: `${accent}45`,
          backgroundColor: `${accent}10`,
          color: accent,
        }}
      >
        <Check size={24} />
      </motion.div>

      <p
        className="mt-7 text-[9px] font-semibold uppercase tracking-[0.18em]"
        style={{ color: accent }}
      >
        Setup complete
      </p>

      <h1 className="mx-auto mt-4 max-w-2xl text-[46px] font-medium leading-[1] tracking-[-0.06em] sm:text-[60px]">
        Your semester is ready.
      </h1>

      <p className="mx-auto mt-6 max-w-xl text-[13px] leading-6 text-white/30">
        Your workspace now has a school identity, active semester, courses, and
        academic target.
      </p>

      <div className="mx-auto mt-10 grid max-w-[620px] grid-cols-3 gap-4 border-y border-white/[0.06] py-6">
        <FinalStat label="Courses" value={String(courses.length)} />
        <FinalStat label="Credits" value={formatCredits(totalCredits)} />
        <FinalStat label="Target GPA" value={targetGpa} />
      </div>

      <p className="mt-6 text-[10px] text-white/24">
        {school?.name} · {semesterName}
      </p>

      <motion.button
        onClick={onEnter}
        whileHover={{ y: -2 }}
        whileTap={{ scale: 0.98 }}
        className="mt-8 inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-[11px] font-medium text-black"
      >
        Enter your workspace
        <ArrowRight size={13} />
      </motion.button>
    </motion.div>
  );
}

function Eyebrow({
  label,
  accent,
}: {
  label: string;
  accent: string;
}) {
  return (
    <div className="mb-6 flex items-center gap-3">
      <motion.div
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ delay: 0.15, ...transition }}
        className="h-[2px] w-9 origin-left rounded-full"
        style={{ backgroundColor: accent }}
      />
      <p
        className="text-[9px] font-semibold uppercase tracking-[0.18em]"
        style={{ color: accent }}
      >
        {label}
      </p>
    </div>
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
      <span className="mb-2 block text-[9px] font-medium uppercase tracking-[0.12em] text-white/22">
        {label}
      </span>
      {children}
    </label>
  );
}

function PreviewRow({
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
      className={`flex items-center justify-between py-3 ${
        last ? "" : "border-b border-white/[0.05]"
      }`}
    >
      <p className="text-[10px] text-white/25">{label}</p>
      <p className="text-[10px] font-medium text-white/62">{value}</p>
    </div>
  );
}

function FinalStat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <p className="text-[25px] font-medium tracking-[-0.045em] text-white/82">
        {value}
      </p>
      <p className="mt-1 text-[8px] uppercase tracking-[0.12em] text-white/20">
        {label}
      </p>
    </div>
  );
}

function createCourse(color: string): CourseDraft {
  return {
    id: crypto.randomUUID(),
    code: "",
    name: "",
    professor: "",
    credits: "3",
    color,
  };
}

function schoolInitial(school: School) {
  const source = school.short_name || school.name;
  const words = source.trim().split(/\s+/);

  if (words.length >= 2 && words[0].length <= 4) {
    return words
      .slice(0, 2)
      .map((word) => word.charAt(0).toUpperCase())
      .join("");
  }

  return source.charAt(0).toUpperCase();
}

function defaultSemesterName() {
  const now = new Date();
  const month = now.getMonth();
  const year = now.getFullYear();

  if (month <= 4) return `Spring ${year}`;
  if (month <= 6) return `Summer ${year}`;
  return `Fall ${year}`;
}

function normalizeSearch(value: string) {
  const generic = new Set([
    "university",
    "college",
    "the",
    "of",
    "at",
    "campus",
    "main",
  ]);

  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !generic.has(token));
}

function coursePaletteFromSchool(school: School | null) {
  if (!school) return fallbackColors;

  const candidates = [
    ...(school.brand_colors ?? []),
    school.primary_color,
    school.secondary_color,
  ]
    .filter(isHex)
    .map((color) => color.toUpperCase())
    .filter(
      (color) =>
        !["#000000", "#FFFFFF", "#1C1C1C", "#F5F5F5"].includes(color),
    );

  const unique = [...new Set(candidates)];

  if (unique.length >= 6) {
    return unique.slice(0, 6);
  }

  const primary = school.primary_color;
  const secondary = school.secondary_color;

  const generated = [
    ...unique,
    mixHex(primary, "#FFFFFF", 0.22),
    mixHex(secondary, "#FFFFFF", 0.22),
    mixHex(primary, "#000000", 0.18),
    mixHex(secondary, "#000000", 0.15),
    mixHex(primary, secondary, 0.5),
    ...fallbackColors,
  ].filter(isHex);

  return [...new Set(generated.map((color) => color.toUpperCase()))].slice(0, 6);
}

function buildCoursePalette(school: School | null) {
  const palette = coursePaletteFromSchool(school);
  return palette.length > 0 ? palette : fallbackColors;
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
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

const inputClass =
  "w-full rounded-[15px] border border-white/[0.075] bg-white/[0.028] px-4 py-3.5 text-[13px] text-white/78 outline-none transition placeholder:text-white/17 hover:border-white/[0.12] focus:border-white/20 focus:bg-white/[0.045] focus:ring-4 focus:ring-white/[0.02] [color-scheme:dark]";

const compactInputClass =
  "w-full rounded-[12px] border border-white/[0.065] bg-white/[0.018] px-3 py-2.5 text-[11px] text-white/68 outline-none transition placeholder:text-white/16 hover:border-white/[0.11] focus:border-white/18 focus:bg-white/[0.035] [color-scheme:dark]";