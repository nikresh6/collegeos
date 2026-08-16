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
  Check,
  GraduationCap,
  KeyRound,
  Loader2,
  LogOut,
  Mail,
  Save,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import {
  SchoolPicker,
  type SchoolPickerSchool,
} from "../../components/school-picker";
import {
  announceSchoolChange,
} from "../../components/school-identity";

type School = SchoolPickerSchool & {
  aliases: string[];
  brand_colors: string[];
  sort_priority: number;
};

type ProfileRecord = {
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  school_id: string | null;
  graduation_year: number | null;
  target_gpa: number | null;
  timezone: string | null;
  onboarding_completed: boolean;
};

const fallbackAccent = "#CFAE70";

export default function ProfilePage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [updatingEmail, setUpdatingEmail] = useState(false);
  const [updatingPassword, setUpdatingPassword] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const [userId, setUserId] = useState("");
  const [isAnonymous, setIsAnonymous] = useState(false);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [originalEmail, setOriginalEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const [schools, setSchools] = useState<School[]>([]);
  const [schoolId, setSchoolId] = useState("");
  const [graduationYear, setGraduationYear] = useState("");
  const [targetGpa, setTargetGpa] = useState("3.70");
  const [timezone, setTimezone] = useState("");

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void initialize();
  }, []);

  const selectedSchool = useMemo(
    () => schools.find((school) => school.id === schoolId) ?? null,
    [schools, schoolId],
  );

  const accent = selectedSchool?.primary_color ?? fallbackAccent;
  const secondary = selectedSchool?.secondary_color ?? "#8A713E";

  const initials = useMemo(() => {
    const first = firstName.trim().charAt(0);
    const last = lastName.trim().charAt(0);

    return `${first}${last}`.toUpperCase() || "U";
  }, [firstName, lastName]);

  async function initialize() {
    try {
      setLoading(true);
      setError("");

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) {
        throw userError;
      }

      if (!user) {
        router.replace("/onboarding");
        return;
      }

      setUserId(user.id);
      setIsAnonymous(Boolean(user.is_anonymous));
      setEmail(user.email ?? "");
      setOriginalEmail(user.email ?? "");
      setTimezone(
        Intl.DateTimeFormat().resolvedOptions().timeZone || "",
      );

      const [{ data: profile, error: profileError }, schoolsResult] =
        await Promise.all([
          supabase
            .from("profiles")
            .select(
              "first_name, last_name, preferred_name, school_id, graduation_year, target_gpa, timezone, onboarding_completed",
            )
            .eq("id", user.id)
            .maybeSingle<ProfileRecord>(),
          supabase
            .from("schools")
            .select(
              "id, name, short_name, aliases, primary_color, secondary_color, brand_colors, sort_priority",
            )
            .eq("is_active", true)
            .order("sort_priority", { ascending: true })
            .order("name", { ascending: true }),
        ]);

      if (profileError) {
        throw profileError;
      }

      if (schoolsResult.error) {
        throw schoolsResult.error;
      }

      if (!profile?.onboarding_completed) {
        router.replace("/onboarding");
        return;
      }

      const metadata = user.user_metadata ?? {};

      setFirstName(
        profile.first_name ??
          profile.preferred_name ??
          (typeof metadata.first_name === "string"
            ? metadata.first_name
            : typeof metadata.given_name === "string"
              ? metadata.given_name
              : ""),
      );

      setLastName(
        profile.last_name ??
          (typeof metadata.last_name === "string"
            ? metadata.last_name
            : typeof metadata.family_name === "string"
              ? metadata.family_name
              : ""),
      );

      setSchoolId(profile.school_id ?? "");
      setGraduationYear(
        profile.graduation_year ? String(profile.graduation_year) : "",
      );
      setTargetGpa(String(profile.target_gpa ?? 3.7));
      setTimezone(
        profile.timezone ||
          Intl.DateTimeFormat().resolvedOptions().timeZone ||
          "",
      );

      setSchools(
        (schoolsResult.data ?? []).map((school) => ({
          id: school.id,
          name: school.name,
          short_name: school.short_name,
          aliases: school.aliases ?? [],
          primary_color: school.primary_color,
          secondary_color: school.secondary_color,
          brand_colors: school.brand_colors ?? [],
          sort_priority: Number(
            school.sort_priority ?? 9999,
          ),
        })),
      );
    } catch (initializationError) {
      console.error("Profile initialization error:", initializationError);
      setError(
        initializationError instanceof Error
          ? initializationError.message
          : "Could not load your profile.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function saveProfile() {
    if (!userId || savingProfile) return;

    const cleanFirstName = firstName.trim();
    const cleanLastName = lastName.trim();
    const school = schools.find((item) => item.id === schoolId);

    if (!cleanFirstName || !cleanLastName) {
      setError("First and last name are required.");
      return;
    }

    if (!school) {
      setError("Choose a university.");
      return;
    }

    const gpa = Number(targetGpa);

    if (!Number.isFinite(gpa) || gpa < 0 || gpa > 4) {
      setError("Target GPA must be between 0.00 and 4.00.");
      return;
    }

    try {
      setSavingProfile(true);
      setError("");
      setMessage("");

      const { error: authError } = await supabase.auth.updateUser({
        data: {
          first_name: cleanFirstName,
          last_name: cleanLastName,
          full_name: `${cleanFirstName} ${cleanLastName}`,
          preferred_name: cleanFirstName,
        },
      });

      if (authError) {
        throw authError;
      }

      const parsedGraduationYear = graduationYear
        ? Number(graduationYear)
        : null;

      const { error: profileError } = await supabase
        .from("profiles")
        .update({
          first_name: cleanFirstName,
          last_name: cleanLastName,
          preferred_name: cleanFirstName,
          school_id: school.id,
          university_name: school.name,
          university_short_name: school.short_name || school.name,
          school_primary_color: school.primary_color,
          school_secondary_color: school.secondary_color,
          graduation_year:
            parsedGraduationYear &&
            Number.isFinite(parsedGraduationYear)
              ? parsedGraduationYear
              : null,
          target_gpa: gpa,
          timezone: timezone.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", userId);

      if (profileError) {
        throw profileError;
      }

      announceSchoolChange({
        id: school.id,
        name: school.name,
        short_name: school.short_name,
        primary_color: school.primary_color,
        secondary_color: school.secondary_color,
      });

      router.refresh();
      setMessage("Profile saved.");
    } catch (saveError) {
      console.error("Profile save error:", saveError);
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save your profile.",
      );
    } finally {
      setSavingProfile(false);
    }
  }

  async function updateEmail() {
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanEmail) {
      setError("Enter an email address.");
      return;
    }

    if (cleanEmail === originalEmail && !isAnonymous) {
      setMessage("That is already your account email.");
      return;
    }

    try {
      setUpdatingEmail(true);
      setError("");
      setMessage("");

      const { error: emailError } = await supabase.auth.updateUser({
        email: cleanEmail,
      });

      if (emailError) {
        throw emailError;
      }

      setMessage(
        isAnonymous
          ? "Check your email to verify it. After verification, this temporary account becomes recoverable."
          : "Email change requested. Check your inbox for the confirmation message.",
      );
    } catch (emailError) {
      console.error("Email update error:", emailError);
      setError(
        emailError instanceof Error
          ? emailError.message
          : "Could not update your email.",
      );
    } finally {
      setUpdatingEmail(false);
    }
  }

  async function updatePassword() {
    if (newPassword.length < 6) {
      setError("Use a password with at least 6 characters.");
      return;
    }

    try {
      setUpdatingPassword(true);
      setError("");
      setMessage("");

      const { error: passwordError } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (passwordError) {
        throw passwordError;
      }

      setNewPassword("");
      setMessage("Password updated.");
    } catch (passwordError) {
      console.error("Password update error:", passwordError);
      setError(
        passwordError instanceof Error
          ? passwordError.message
          : "Could not update your password.",
      );
    } finally {
      setUpdatingPassword(false);
    }
  }

  async function logOut() {
    try {
      setLoggingOut(true);
      setError("");

      const { error: signOutError } = await supabase.auth.signOut();

      if (signOutError) {
        throw signOutError;
      }

      router.replace("/onboarding");
      router.refresh();
    } catch (signOutError) {
      console.error("Sign out error:", signOutError);
      setError(
        signOutError instanceof Error
          ? signOutError.message
          : "Could not log out.",
      );
      setLoggingOut(false);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#080809] text-white">
        <div className="flex items-center gap-3 text-[11px] text-white/30">
          <Loader2 size={14} className="animate-spin" />
          Loading profile
        </div>
      </main>
    );
  }

  return (
    <MotionConfig reducedMotion="user">
      <main className="relative min-h-screen overflow-x-hidden bg-[#080809] text-[#F5F5F7]">
        <motion.div
          aria-hidden
          className="pointer-events-none fixed left-[12%] top-[-380px] h-[720px] w-[820px] rounded-full opacity-[0.1] blur-[155px]"
          animate={{ backgroundColor: accent }}
          transition={{ duration: 0.7 }}
        />

        <motion.div
          aria-hidden
          className="pointer-events-none fixed bottom-[-430px] right-[-280px] h-[680px] w-[680px] rounded-full opacity-[0.055] blur-[150px]"
          animate={{ backgroundColor: secondary }}
          transition={{ duration: 0.7 }}
        />

        <div className="relative mx-auto max-w-[1180px] px-4 pb-28 pt-5 sm:px-8 md:pt-8 lg:pb-20">
          <div className="flex items-center justify-between">
            <motion.button
              onClick={() => router.push("/")}
              whileHover={{ x: -2 }}
              whileTap={{ scale: 0.96 }}
              className="flex h-9 items-center gap-2 rounded-full border border-white/[0.07] bg-white/[0.025] px-3 text-[11px] text-white/38 transition hover:bg-white/[0.05] hover:text-white/70"
            >
              <ArrowLeft size={14} />
              Dashboard
            </motion.button>

            <motion.button
              onClick={saveProfile}
              disabled={savingProfile}
              whileHover={!savingProfile ? { y: -1 } : undefined}
              whileTap={!savingProfile ? { scale: 0.98 } : undefined}
              className="flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-[11px] font-medium text-black disabled:opacity-40"
            >
              {savingProfile ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Save size={13} />
              )}
              {savingProfile ? "Saving" : "Save changes"}
            </motion.button>
          </div>

          <motion.header
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              delay: 0.06,
              duration: 0.68,
              ease: [0.22, 1, 0.36, 1],
            }}
            className="mt-10 grid gap-7 border-b border-white/[0.06] pb-8 sm:mt-16 sm:gap-8 sm:pb-10 lg:grid-cols-[1fr_auto] lg:items-end"
          >
            <div>
              <div className="mb-5 flex items-center gap-3">
                <motion.div
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{
                    delay: 0.24,
                    duration: 0.6,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                  className="h-[2px] w-9 origin-left rounded-full"
                  style={{ backgroundColor: accent }}
                />

                <p
                  className="text-[9px] font-semibold uppercase tracking-[0.18em]"
                  style={{ color: accent }}
                >
                  Profile & account
                </p>
              </div>

              <h1 className="text-[40px] font-medium leading-[0.98] tracking-[-0.056em] sm:text-[62px]">
                {firstName || "Your"} profile.
              </h1>

              <p className="mt-5 max-w-xl text-[13px] leading-6 text-white/30">
                Personal information, academic identity, and account security
                live here.
              </p>
            </div>

            <motion.div
              whileHover={{ scale: 1.025, rotate: 1 }}
              className="flex h-[84px] w-[84px] items-center justify-center rounded-[25px] border text-[22px] font-semibold"
              style={{
                borderColor: `${accent}40`,
                backgroundColor: `${accent}10`,
                color: accent,
              }}
            >
              {initials}
            </motion.div>
          </motion.header>

          <AnimatePresence mode="wait">
            {(error || message) && (
              <motion.div
                key={error ? "error" : "message"}
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className={`mt-7 rounded-[17px] border px-4 py-3 ${
                  error
                    ? "border-red-500/15 bg-red-500/[0.04]"
                    : "border-white/[0.06] bg-white/[0.025]"
                }`}
              >
                <p
                  className={`text-[10px] leading-5 ${
                    error ? "text-red-200/60" : "text-white/42"
                  }`}
                >
                  {error || message}
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="mt-10 grid gap-12 lg:grid-cols-[1fr_330px]">
            <div className="space-y-12">
              <ProfileSection
                icon={UserRound}
                eyebrow="Personal"
                title="Personal information"
                description="The name used throughout your workspace."
              >
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="First name">
                    <input
                      value={firstName}
                      onChange={(event) => setFirstName(event.target.value)}
                      className={inputClass}
                      placeholder="First name"
                    />
                  </Field>

                  <Field label="Last name">
                    <input
                      value={lastName}
                      onChange={(event) => setLastName(event.target.value)}
                      className={inputClass}
                      placeholder="Last name"
                    />
                  </Field>
                </div>
              </ProfileSection>

              <ProfileSection
                icon={GraduationCap}
                eyebrow="Academic"
                title="Academic profile"
                description="These settings shape the identity and targets shown across the app."
              >
                <div className="grid gap-5 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <SchoolPicker
                      schools={schools}
                      selectedSchoolId={schoolId}
                      onSelect={(school) => {
                        setSchoolId(school.id);
                        setError("");
                        setMessage("");
                      }}
                      label="University"
                    />
                  </div>

                  <Field label="Graduation year">
                    <input
                      type="number"
                      value={graduationYear}
                      onChange={(event) =>
                        setGraduationYear(event.target.value)
                      }
                      className={inputClass}
                      placeholder="2030"
                    />
                  </Field>

                  <Field label="Target GPA">
                    <input
                      type="number"
                      min="0"
                      max="4"
                      step="0.01"
                      value={targetGpa}
                      onChange={(event) => setTargetGpa(event.target.value)}
                      className={inputClass}
                    />
                  </Field>

                  <div className="sm:col-span-2">
                    <Field label="Timezone">
                      <input
                        value={timezone}
                        onChange={(event) => setTimezone(event.target.value)}
                        className={inputClass}
                        placeholder="America/Chicago"
                      />
                    </Field>
                  </div>
                </div>

                {selectedSchool && (
                  <div className="mt-5 flex items-center justify-between rounded-[18px] border border-white/[0.06] bg-white/[0.018] px-4 py-3">
                    <div>
                      <p className="text-[10px] text-white/25">
                        Workspace palette
                      </p>
                      <p className="mt-1 text-[11px] text-white/55">
                        {selectedSchool.short_name || selectedSchool.name}
                      </p>
                    </div>

                    <div className="flex -space-x-1">
                      {(
                        selectedSchool.brand_colors.length > 0
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
                )}
              </ProfileSection>
            </div>

            <aside className="space-y-7">
              <div className="rounded-[24px] border border-white/[0.07] bg-[#101012] p-5">
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-10 w-10 items-center justify-center rounded-[13px]"
                    style={{ backgroundColor: `${accent}10`, color: accent }}
                  >
                    <ShieldCheck size={17} />
                  </div>

                  <div>
                    <p className="text-[12px] font-medium text-white/72">
                      Account
                    </p>
                    <p className="mt-1 text-[9px] text-white/22">
                      {isAnonymous ? "Temporary account" : "Permanent account"}
                    </p>
                  </div>
                </div>

                {isAnonymous && (
                  <div className="mt-5 rounded-[15px] border border-amber-300/10 bg-amber-300/[0.035] px-3.5 py-3">
                    <p className="text-[9px] leading-5 text-amber-100/45">
                      This browser still has an older anonymous session. Connect
                      and verify an email before logging out if you want to keep
                      this account and its data.
                    </p>
                  </div>
                )}

                <div className="mt-6">
                  <Field label="Email">
                    <div className="relative">
                      <Mail
                        size={14}
                        className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/20"
                      />
                      <input
                        type="email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        className={`${compactInputClass} pl-10`}
                        placeholder="you@school.edu"
                      />
                    </div>
                  </Field>

                  <button
                    onClick={updateEmail}
                    disabled={updatingEmail}
                    className="mt-3 flex items-center gap-2 text-[10px] font-medium text-white/38 transition hover:text-white/70 disabled:opacity-35"
                  >
                    {updatingEmail && (
                      <Loader2 size={11} className="animate-spin" />
                    )}
                    {isAnonymous ? "Connect email" : "Update email"}
                  </button>
                </div>

                <div className="mt-7 border-t border-white/[0.055] pt-6">
                  <Field label="New password">
                    <div className="relative">
                      <KeyRound
                        size={14}
                        className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/20"
                      />
                      <input
                        type="password"
                        value={newPassword}
                        onChange={(event) =>
                          setNewPassword(event.target.value)
                        }
                        className={`${compactInputClass} pl-10`}
                        placeholder="At least 6 characters"
                      />
                    </div>
                  </Field>

                  <button
                    onClick={updatePassword}
                    disabled={updatingPassword}
                    className="mt-3 flex items-center gap-2 text-[10px] font-medium text-white/38 transition hover:text-white/70 disabled:opacity-35"
                  >
                    {updatingPassword && (
                      <Loader2 size={11} className="animate-spin" />
                    )}
                    Change password
                  </button>
                </div>
              </div>

              <div className="rounded-[24px] border border-red-500/10 bg-red-500/[0.025] p-5">
                <p className="text-[9px] font-medium uppercase tracking-[0.14em] text-red-200/35">
                  Session
                </p>

                <p className="mt-3 text-[11px] leading-5 text-white/28">
                  Log out of this browser and return to the account step.
                </p>

                <motion.button
                  onClick={logOut}
                  disabled={loggingOut}
                  whileHover={!loggingOut ? { x: 2 } : undefined}
                  whileTap={!loggingOut ? { scale: 0.98 } : undefined}
                  className="mt-5 flex items-center gap-2 text-[11px] font-medium text-red-300/70 transition hover:text-red-200 disabled:opacity-35"
                >
                  {loggingOut ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <LogOut size={13} />
                  )}
                  {loggingOut ? "Logging out" : "Log out"}
                </motion.button>
              </div>
            </aside>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            className="mt-14 flex items-center justify-between border-t border-white/[0.06] pt-7"
          >
            <div className="flex items-center gap-2 text-[10px] text-white/20">
              <Check size={12} style={{ color: accent }} />
              Changes to your profile affect the workspace immediately.
            </div>

            <button
              onClick={saveProfile}
              disabled={savingProfile}
              className="text-[10px] font-medium text-white/40 transition hover:text-white/70 disabled:opacity-35"
            >
              Save changes
            </button>
          </motion.div>
        </div>
      </main>
    </MotionConfig>
  );
}

function ProfileSection({
  icon: Icon,
  eyebrow,
  title,
  description,
  children,
}: {
  icon: React.ElementType;
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{
        duration: 0.6,
        ease: [0.22, 1, 0.36, 1],
      }}
    >
      <div className="mb-6 flex items-start gap-4">
        <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] bg-white/[0.035] text-white/35">
          <Icon size={15} />
        </div>

        <div>
          <p className="text-[9px] font-medium uppercase tracking-[0.14em] text-white/20">
            {eyebrow}
          </p>

          <h2 className="mt-2 text-[24px] font-medium tracking-[-0.04em]">
            {title}
          </h2>

          <p className="mt-2 max-w-xl text-[11px] leading-5 text-white/26">
            {description}
          </p>
        </div>
      </div>

      <div className="rounded-[24px] border border-white/[0.065] bg-white/[0.016] p-5 sm:p-6">
        {children}
      </div>
    </motion.section>
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
      <span className="mb-2 block text-[8px] font-medium uppercase tracking-[0.12em] text-white/20">
        {label}
      </span>
      {children}
    </label>
  );
}

const inputClass =
  "w-full rounded-[14px] border border-white/[0.07] bg-white/[0.025] px-4 py-3.5 text-[12px] text-white/72 outline-none transition placeholder:text-white/15 hover:border-white/[0.11] focus:border-white/18 focus:bg-white/[0.04] [color-scheme:dark]";

const compactInputClass =
  "w-full rounded-[12px] border border-white/[0.065] bg-white/[0.02] px-3 py-2.5 text-[11px] text-white/68 outline-none transition placeholder:text-white/15 hover:border-white/[0.1] focus:border-white/17 focus:bg-white/[0.035] [color-scheme:dark]";
