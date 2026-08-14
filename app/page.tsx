"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  useRouter,
} from "next/navigation";
import {
  ArrowRight,
  Bell,
  BookOpen,
  BrainCircuit,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Command,
  FileText,
  GraduationCap,
  Headphones,
  Home,
  LayoutGrid,
  Loader2,
  LogOut,
  Mic2,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Sparkles,
  Target,
  TrendingUp,
  UserRound,
} from "lucide-react";
import {
  AnimatePresence,
  MotionConfig,
  motion,
} from "framer-motion";
import { supabase } from "../lib/supabase";
import {
  SchoolMark,
  useSchoolIdentity,
} from "../components/school-identity";

type AttentionItem = {
  key: string;
  kind: string;
  title: string;
  detail: string;
  score: number;
  urgency:
    | "critical"
    | "high"
    | "medium"
    | "low";
  courseId: string | null;
  courseCode: string | null;
  color: string | null;
  dueAt: string | null;
  preparedness: number | null;
  action: {
    label: string;
    href: string;
  };
  secondaryAction?: {
    label: string;
    href: string;
  } | null;
};

type HomeData = {
  generatedAt: string;
  timeZone: string;
  profile: {
    firstName: string;
    lastName: string;
    preferredName: string;
    onboardingCompleted: boolean;
    currentSemesterId: string | null;
    targetGpa: number;
  };
  courses: Array<{
    id: string;
    code: string;
    name: string;
    color: string;
    professor: string | null;
    credits: number;
  }>;
  attention: {
    primary: AttentionItem | null;
    items: AttentionItem[];
    criticalCount: number;
    highCount: number;
  };
  schedule: Array<{
    id: string;
    kind: "class" | "event";
    courseId: string | null;
    courseCode: string | null;
    color: string | null;
    title: string;
    itemType: string;
    startsAt: string;
    endsAt: string;
    location: string | null;
    source: string;
  }>;
  preparedness: Array<{
    courseId: string;
    courseCode: string;
    courseName: string;
    color: string;
    preparedness: number | null;
    weakest: Array<{
      id: string;
      name: string;
      mastery: number;
    }>;
  }>;
  recent: Array<{
    id: string;
    kind: "note" | "lecture" | "guide";
    title: string;
    courseCode: string | null;
    color: string | null;
    at: string;
    href: string;
  }>;
  learning: {
    summary: string | null;
    profile: {
      confidence: number;
      sample_count: number;
      learned_preferred_period: string | null;
      learned_default_minutes: number | null;
      completion_rate: number | null;
    };
  };
};

const NAV = [
  {
    label: "Home",
    icon: Home,
    href: "/",
  },
  {
    label: "Study",
    icon: BrainCircuit,
    href: "/study",
  },
  {
    label: "Lectures",
    icon: Mic2,
    href: "/lectures",
  },
  {
    label: "Notes",
    icon: FileText,
    href: "/notes",
  },
  {
    label: "Calendar",
    icon: CalendarDays,
    href: "/calendar",
  },
  {
    label: "Grades",
    icon: TrendingUp,
    href: "/grades",
  },
];

function relativeTime(
  value: string,
) {
  const diff =
    Date.now() -
    new Date(value).getTime();

  if (
    !Number.isFinite(diff)
  ) {
    return "";
  }

  const minutes =
    Math.max(
      0,
      Math.round(
        diff / 60000,
      ),
    );

  if (minutes < 2) {
    return "just now";
  }

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours =
    Math.round(
      minutes / 60,
    );

  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days =
    Math.round(
      hours / 24,
    );

  return `${days}d ago`;
}

function timeText(
  value: string,
) {
  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return "";
  }

  return new Intl.DateTimeFormat(
    undefined,
    {
      hour: "numeric",
      minute: "2-digit",
    },
  ).format(date);
}

function greeting(
  firstName: string,
) {
  const hour =
    new Date().getHours();

  let base =
    "Good evening";

  if (hour < 5) {
    base =
      "Good night";
  } else if (
    hour < 12
  ) {
    base =
      "Good morning";
  } else if (
    hour < 17
  ) {
    base =
      "Good afternoon";
  }

  return firstName
    ? `${base}, ${firstName}.`
    : `${base}.`;
}

function urgencyLabel(
  urgency:
    | "critical"
    | "high"
    | "medium"
    | "low",
) {
  if (
    urgency ===
    "critical"
  ) {
    return "Needs attention";
  }

  if (
    urgency === "high"
  ) {
    return "Important";
  }

  if (
    urgency ===
    "medium"
  ) {
    return "Worth doing";
  }

  return "On your radar";
}

function recentIcon(
  kind:
    | "note"
    | "lecture"
    | "guide",
) {
  if (kind === "note") {
    return FileText;
  }

  if (
    kind === "lecture"
  ) {
    return Headphones;
  }

  return BookOpen;
}

export default function HomePage() {
  const router =
    useRouter();

  const {
    identity,
  } =
    useSchoolIdentity();

  const [
    data,
    setData,
  ] =
    useState<HomeData | null>(
      null,
    );

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    refreshing,
    setRefreshing,
  ] =
    useState(false);

  const [
    sidebarCollapsed,
    setSidebarCollapsed,
  ] =
    useState(true);

  const [
    accountMenuOpen,
    setAccountMenuOpen,
  ] =
    useState(false);

  const [
    loggingOut,
    setLoggingOut,
  ] =
    useState(false);

  const [
    accountEmail,
    setAccountEmail,
  ] =
    useState("");

  const [
    error,
    setError,
  ] = useState("");

  const [
    addingCourse,
    setAddingCourse,
  ] =
    useState(false);

  const [
    creatingCourse,
    setCreatingCourse,
  ] =
    useState(false);

  const [
    courseDraft,
    setCourseDraft,
  ] = useState({
    code: "",
    name: "",
    professor: "",
    credits: "3",
  });

  const loadHome =
    useCallback(
      async (
        quiet =
          false,
      ) => {
        try {
          if (quiet) {
            setRefreshing(
              true,
            );
          } else {
            setLoading(
              true,
            );
          }

          setError("");

          const {
            data: {
              session,
            },
            error:
              sessionError,
          } =
            await supabase.auth.getSession();

          if (
            sessionError
          ) {
            throw sessionError;
          }

          if (!session) {
            router.replace(
              "/onboarding",
            );
            return;
          }

          setAccountEmail(
            session.user.email ??
            "",
          );

          const tz =
            Intl.DateTimeFormat()
              .resolvedOptions()
              .timeZone;

          const response =
            await fetch(
              `/api/intelligence/home?tz=${encodeURIComponent(
                tz,
              )}`,
              {
                headers: {
                  Authorization:
                    `Bearer ${session.access_token}`,
                },
                cache:
                  "no-store",
              },
            );

          const payload =
            (await response.json()) as {
              ok?: boolean;
              error?: string;
            } &
              HomeData;

          if (
            !response.ok ||
            payload.ok ===
              false
          ) {
            throw new Error(
              payload.error ||
                "Could not load Home.",
            );
          }

          if (
            payload.profile &&
            payload.profile.onboardingCompleted ===
              false
          ) {
            router.replace(
              "/onboarding",
            );
            return;
          }

          setData(
            payload,
          );
        } catch (
          loadError
        ) {
          console.error(
            "Could not load Home intelligence:",
            loadError,
          );

          setError(
            loadError instanceof
              Error
              ? loadError.message
              : "Could not load Home.",
          );
        } finally {
          setLoading(
            false,
          );
          setRefreshing(
            false,
          );
        }
      },
      [router],
    );

  useEffect(() => {
    const saved =
      window.localStorage.getItem(
        "college-assistant-sidebar-collapsed",
      );

    if (
      saved === "true" ||
      saved === "false"
    ) {
      setSidebarCollapsed(
        saved === "true",
      );
    }
  }, []);

  useEffect(() => {
    void loadHome();

    function refreshOnFocus() {
      void loadHome(
        true,
      );
    }

    function refreshOnVisibility() {
      if (
        document
          .visibilityState ===
        "visible"
      ) {
        void loadHome(
          true,
        );
      }
    }

    window.addEventListener(
      "focus",
      refreshOnFocus,
    );

    document.addEventListener(
      "visibilitychange",
      refreshOnVisibility,
    );

    const interval =
      window.setInterval(
        () => {
          void loadHome(
            true,
          );
        },
        90_000,
      );

    return () => {
      window.removeEventListener(
        "focus",
        refreshOnFocus,
      );

      document.removeEventListener(
        "visibilitychange",
        refreshOnVisibility,
      );

      window.clearInterval(
        interval,
      );
    };
  }, [loadHome]);

  const primary =
    data?.attention
      .primary ??
    null;

  const secondary =
    useMemo(
      () =>
        (
          data?.attention
            .items ?? []
        )
          .filter(
            (item) =>
              item.key !==
              primary?.key,
          )
          .slice(0, 3),
      [
        data,
        primary,
      ],
    );

  const currentAndNext =
    useMemo(() => {
      if (!data) {
        return [];
      }

      const now =
        Date.now();

      const relevant =
        data.schedule.filter(
          (item) =>
            new Date(
              item.endsAt,
            ).getTime() >
            now -
              20 *
                60000,
        );

      return relevant.slice(
        0,
        5,
      );
    }, [data]);

  const openCommand =
    () => {
      window.dispatchEvent(
        new CustomEvent(
          "college-assistant:open-command-center",
        ),
      );
    };

  async function dismissAttention(
    key: string,
    hours?: number,
  ) {
    try {
      const {
        data: {
          session,
        },
      } =
        await supabase.auth.getSession();

      if (!session) {
        return;
      }

      const response =
        await fetch(
          "/api/intelligence/attention",
          {
            method:
              "POST",
            headers: {
              "Content-Type":
                "application/json",
              Authorization:
                `Bearer ${session.access_token}`,
            },
            body:
              JSON.stringify({
                action:
                  hours
                    ? "snooze"
                    : "dismiss",
                key,
                hours,
              }),
          },
        );

      if (!response.ok) {
        return;
      }

      await loadHome(
        true,
      );
    } catch (
      dismissError
    ) {
      console.warn(
        "Could not update attention:",
        dismissError,
      );
    }
  }

  async function createCourse() {
    if (
      creatingCourse
    ) {
      return;
    }

    const code =
      courseDraft.code
        .trim()
        .toUpperCase();

    const name =
      courseDraft.name.trim();

    const credits =
      Number(
        courseDraft.credits,
      );

    if (
      !code ||
      !name ||
      !Number.isFinite(
        credits,
      ) ||
      credits <= 0
    ) {
      setError(
        "Add a course code, name, and valid credit count.",
      );
      return;
    }

    try {
      setCreatingCourse(
        true,
      );

      const {
        data: {
          session,
        },
        error:
          sessionError,
      } =
        await supabase.auth.getSession();

      if (
        sessionError
      ) {
        throw sessionError;
      }

      if (
        !session ||
        !data
      ) {
        throw new Error(
          "You must be signed in.",
        );
      }

      const palette =
        [
          identity.primary,
          identity.secondary,
          identity.highlight,
          "#8BA18E",
          "#B3C9CD",
          "#CFAE70",
        ].filter(Boolean);

      const color =
        palette[
          data.courses
            .length %
            palette.length
        ];

      const {
        data:
          created,
        error:
          createError,
      } =
        await supabase
          .from("courses")
          .insert({
            user_id:
              session.user.id,
            semester_id:
              data.profile
                .currentSemesterId,
            code,
            name,
            professor:
              courseDraft.professor.trim() ||
              null,
            credits,
            color,
          })
          .select(
            "id",
          )
          .single();

      if (
        createError
      ) {
        throw createError;
      }

      setAddingCourse(
        false,
      );

      setCourseDraft({
        code: "",
        name: "",
        professor: "",
        credits: "3",
      });

      await loadHome(
        true,
      );

      router.push(
        `/courses/${created.id}`,
      );
    } catch (
      createError
    ) {
      setError(
        createError instanceof
          Error
          ? createError.message
          : "Could not create this course.",
      );
    } finally {
      setCreatingCourse(
        false,
      );
    }
  }

  function toggleSidebar() {
    const next =
      !sidebarCollapsed;

    setSidebarCollapsed(
      next,
    );

    window.localStorage.setItem(
      "college-assistant-sidebar-collapsed",
      String(next),
    );
  }

  async function signOut() {
    if (loggingOut) {
      return;
    }

    try {
      setLoggingOut(
        true,
      );

      await supabase.auth.signOut();

      router.replace(
        "/onboarding",
      );
    } finally {
      setLoggingOut(
        false,
      );
    }
  }

  const accountName =
    data?.profile
      .preferredName ||
    [
      data?.profile
        .firstName,
      data?.profile
        .lastName,
    ]
      .filter(Boolean)
      .join(" ") ||
    "Your profile";

  const accountInitials =
    accountName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(
        (part) =>
          part[0]
            ?.toUpperCase(),
      )
      .join("") ||
    "U";

  if (
    loading &&
    !data
  ) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#080809] text-white">
        <div className="flex items-center gap-3 text-[11px] text-white/32">
          <Loader2
            size={14}
            className="animate-spin"
          />
          Building your day
        </div>
      </main>
    );
  }

  return (
    <MotionConfig reducedMotion="user">
      <main className="min-h-screen bg-[#080809] text-[#F5F5F7]">
        <div
          aria-hidden
          className="pointer-events-none fixed left-[12%] top-[-330px] h-[700px] w-[850px] rounded-full opacity-[0.09] blur-[150px]"
          style={{
            backgroundColor:
              identity.primary,
          }}
        />

        <DesktopSidebar
          collapsed={
            sidebarCollapsed
          }
          accountMenuOpen={
            accountMenuOpen
          }
          accountName={
            accountName
          }
          accountEmail={
            accountEmail
          }
          accountInitials={
            accountInitials
          }
          loggingOut={
            loggingOut
          }
          onToggle={
            toggleSidebar
          }
          onToggleAccount={() =>
            setAccountMenuOpen(
              (current) =>
                !current,
            )
          }
          onSignOut={() =>
            void signOut()
          }
          onOpenCommand={
            openCommand
          }
        />

        <div
          className={`pb-24 transition-[padding] duration-200 md:pb-10 ${
            sidebarCollapsed
              ? "md:pl-[88px]"
              : "md:pl-[258px]"
          }`}
        >
          <div className="mx-auto max-w-[1320px] px-5 pb-16 pt-6 sm:px-8 md:px-10 md:pt-9">
            <header className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <SchoolMark
                  size={38}
                  quiet
                />
                <div>
                  <p className="text-[8px] font-semibold uppercase tracking-[0.16em] text-white/25">
                    Academic OS
                  </p>
                  <p className="mt-1 text-[10px] text-white/38">
                    {new Intl.DateTimeFormat(
                      undefined,
                      {
                        weekday:
                          "long",
                        month:
                          "long",
                        day:
                          "numeric",
                      },
                    ).format(
                      new Date(),
                    )}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={
                    openCommand
                  }
                  aria-label="Search or ask"
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.065] bg-white/[0.015] text-white/28 transition hover:bg-white/[0.04] hover:text-white/58 sm:hidden"
                >
                  <Search
                    size={12}
                  />
                </button>

                <button
                  type="button"
                  onClick={
                    openCommand
                  }
                  className="hidden items-center gap-3 rounded-full border border-white/[0.07] bg-white/[0.018] px-4 py-2.5 text-[9px] text-white/34 transition hover:border-white/[0.11] hover:bg-white/[0.04] hover:text-white/62 sm:flex"
                >
                  <Search
                    size={11}
                  />
                  Search or ask
                  <span className="rounded-md border border-white/[0.07] bg-black/30 px-1.5 py-0.5 text-[7px] text-white/20">
                    ⌘K
                  </span>
                </button>
              </div>
            </header>

            <section className="mt-12">
              <div className="flex flex-wrap items-end justify-between gap-6">
                <div>
                  <p
                    className="text-[9px] font-semibold uppercase tracking-[0.16em]"
                    style={{
                      color:
                        identity.primary,
                    }}
                  >
                    Today
                  </p>
                  <h1 className="mt-3 max-w-[880px] text-[46px] font-medium leading-[0.97] tracking-[-0.06em] sm:text-[62px]">
                    {greeting(
                      data?.profile
                        .preferredName ||
                        data?.profile
                          .firstName ||
                        "",
                    )}
                  </h1>
                  <p className="mt-4 max-w-2xl text-[13px] leading-6 text-white/35">
                    {primary
                      ? "Here is what deserves your attention, without the noise."
                      : "Nothing urgent is pulling at you right now. Use the space well."}
                  </p>
                </div>

                {refreshing && (
                  <div className="flex items-center gap-2 text-[8px] text-white/18">
                    <Loader2
                      size={9}
                      className="animate-spin"
                    />
                    Refreshing
                  </div>
                )}
              </div>
            </section>

            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{
                    opacity: 0,
                    y: -5,
                  }}
                  animate={{
                    opacity: 1,
                    y: 0,
                  }}
                  exit={{
                    opacity: 0,
                  }}
                  className="mt-6 rounded-[16px] border border-red-400/15 bg-red-400/[0.035] px-4 py-3 text-[9px] leading-5 text-red-200/60"
                >
                  {error}
                </motion.div>
              )}
            </AnimatePresence>

            <section className="mt-8 grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.55fr)]">
              <PrimaryRecommendation
                item={
                  primary
                }
                accent={
                  identity.primary
                }
                onOpen={(
                  href,
                ) =>
                  router.push(
                    href,
                  )
                }
                onSnooze={
                  primary
                    ? () =>
                        void dismissAttention(
                          primary.key,
                          24,
                        )
                    : undefined
                }
              />

              <TodayCard
                items={
                  currentAndNext
                }
                onOpen={() =>
                  router.push(
                    "/calendar",
                  )
                }
              />
            </section>

            <section className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
              <div className="rounded-[24px] border border-white/[0.06] bg-[#101012] p-5 sm:p-6">
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <p className="text-[8px] font-semibold uppercase tracking-[0.14em] text-white/22">
                      Next in line
                    </p>
                    <h2 className="mt-2 text-[23px] font-medium tracking-[-0.035em]">
                      A few things worth knowing.
                    </h2>
                  </div>

                  {(data?.attention
                    .criticalCount ??
                    0) +
                    (data
                      ?.attention
                      .highCount ??
                      0) >
                    0 && (
                    <div className="flex items-center gap-1.5 rounded-full border border-white/[0.05] px-2.5 py-1.5 text-[7px] text-white/24">
                      <Bell
                        size={8}
                      />
                      {(data
                        ?.attention
                        .criticalCount ??
                        0) +
                        (data
                          ?.attention
                          .highCount ??
                          0)}{" "}
                      important
                    </div>
                  )}
                </div>

                <div className="mt-5 space-y-2">
                  {secondary.length >
                  0 ? (
                    secondary.map(
                      (
                        item,
                        index,
                      ) => (
                        <AttentionRow
                          key={
                            item.key
                          }
                          item={
                            item
                          }
                          index={
                            index
                          }
                          onOpen={() =>
                            router.push(
                              item.action
                                .href,
                            )
                          }
                          onDismiss={() =>
                            void dismissAttention(
                              item.key,
                            )
                          }
                        />
                      ),
                    )
                  ) : (
                    <div className="rounded-[17px] border border-white/[0.045] bg-white/[0.008] px-4 py-5">
                      <p className="text-[11px] text-white/38">
                        You are clear beyond the primary recommendation.
                      </p>
                      <p className="mt-1.5 text-[9px] leading-4 text-white/18">
                        Home will surface deadlines, weak topics, missed study, and new course intelligence as they become relevant.
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <PreparednessCard
                rows={
                  data?.preparedness ??
                  []
                }
                onOpen={(
                  courseId,
                  topicId,
                ) =>
                  router.push(
                    topicId
                      ? `/study?course=${courseId}&topics=${topicId}`
                      : `/study?course=${courseId}`,
                  )
                }
              />
            </section>

            <section className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
              <CoursesCard
                courses={
                  data?.courses ??
                  []
                }
                onOpen={(
                  id,
                ) =>
                  router.push(
                    `/courses/${id}`,
                  )
                }
                onAdd={() =>
                  setAddingCourse(
                    true,
                  )
                }
              />

              <RecentCard
                items={
                  data?.recent ??
                  []
                }
                onOpen={(
                  href,
                ) =>
                  router.push(
                    href,
                  )
                }
              />
            </section>

            {data?.learning
              .summary && (
              <section className="mt-5 flex flex-col gap-4 rounded-[22px] border border-white/[0.05] bg-white/[0.009] p-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px]"
                    style={{
                      backgroundColor:
                        `${identity.primary}0F`,
                      color:
                        identity.primary,
                    }}
                  >
                    <BrainCircuit
                      size={13}
                    />
                  </div>
                  <div>
                    <p className="text-[9px] font-medium text-white/44">
                      Planner is learning your rhythm
                    </p>
                    <p className="mt-1 text-[8px] leading-4 text-white/21">
                      {data.learning
                        .summary}
                      .
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    router.push(
                      "/calendar",
                    )
                  }
                  className="flex shrink-0 items-center gap-1.5 text-[8px] font-medium text-white/28 transition hover:text-white/55"
                >
                  Open calendar
                  <ChevronRight
                    size={9}
                  />
                </button>
              </section>
            )}
          </div>
        </div>

        <MobileNav
          onOpenCommand={
            openCommand
          }
        />

        <AnimatePresence>
          {addingCourse && (
            <AddCourseSheet
              draft={
                courseDraft
              }
              onChange={
                setCourseDraft
              }
              creating={
                creatingCourse
              }
              accent={
                identity.primary
              }
              onClose={() =>
                setAddingCourse(
                  false,
                )
              }
              onCreate={() =>
                void createCourse()
              }
            />
          )}
        </AnimatePresence>
      </main>
    </MotionConfig>
  );
}

function DesktopSidebar({
  collapsed,
  accountMenuOpen,
  accountName,
  accountEmail,
  accountInitials,
  loggingOut,
  onToggle,
  onToggleAccount,
  onSignOut,
  onOpenCommand,
}: {
  collapsed: boolean;
  accountMenuOpen: boolean;
  accountName: string;
  accountEmail: string;
  accountInitials: string;
  loggingOut: boolean;
  onToggle: () => void;
  onToggleAccount: () => void;
  onSignOut: () => void;
  onOpenCommand: () => void;
}) {
  const router =
    useRouter();

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-white/[0.055] bg-[#09090A]/94 py-5 backdrop-blur-xl transition-[width] duration-200 md:flex ${
        collapsed
          ? "w-[88px]"
          : "w-[258px]"
      }`}
    >
      <div
        className={`flex items-center px-5 ${
          collapsed
            ? "justify-center"
            : "justify-between"
        }`}
      >
        <button
          type="button"
          onClick={() =>
            router.push("/")
          }
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px] border border-white/[0.065] bg-white/[0.025] text-white/55"
        >
          <SchoolMark
            size={28}
            quiet
          />
        </button>

        {!collapsed && (
          <div className="ml-3 min-w-0 flex-1">
            <p className="truncate text-[9px] font-semibold uppercase tracking-[0.12em] text-white/30">
              Academic OS
            </p>
            <p className="mt-1 text-[7px] text-white/14">
              Your semester, connected.
            </p>
          </div>
        )}

        {!collapsed && (
          <button
            type="button"
            onClick={onToggle}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/15 transition hover:bg-white/[0.025] hover:text-white/40"
            aria-label="Collapse sidebar"
          >
            <PanelLeftClose
              size={12}
            />
          </button>
        )}
      </div>

      {collapsed && (
        <button
          type="button"
          onClick={onToggle}
          className="mx-auto mt-4 flex h-8 w-8 items-center justify-center rounded-full text-white/12 transition hover:bg-white/[0.025] hover:text-white/38"
          aria-label="Expand sidebar"
        >
          <PanelLeftOpen
            size={11}
          />
        </button>
      )}

      <nav
        className={`mt-6 flex flex-1 flex-col gap-1.5 ${
          collapsed
            ? "items-center"
            : "px-3"
        }`}
      >
        {NAV.map(
          (item) => {
            const Icon =
              item.icon;

            const active =
              item.href ===
              "/";

            return (
              <button
                key={
                  item.label
                }
                type="button"
                onClick={() =>
                  router.push(
                    item.href,
                  )
                }
                title={
                  collapsed
                    ? item.label
                    : undefined
                }
                className={`flex h-11 items-center rounded-[13px] border transition ${
                  collapsed
                    ? "w-11 justify-center"
                    : "w-full gap-3 px-3.5"
                } ${
                  active
                    ? "border-white/[0.09] bg-white/[0.045] text-white/68"
                    : "border-transparent text-white/24 hover:border-white/[0.055] hover:bg-white/[0.02] hover:text-white/55"
                }`}
              >
                <Icon
                  size={15}
                  className="shrink-0"
                />

                {!collapsed && (
                  <span className="text-[9px] font-medium">
                    {item.label}
                  </span>
                )}
              </button>
            );
          },
        )}

        <button
          type="button"
          onClick={
            onOpenCommand
          }
          title={
            collapsed
              ? "Command Center"
              : undefined
          }
          className={`mt-2 flex h-11 items-center rounded-[13px] border border-white/[0.045] bg-white/[0.008] text-white/25 transition hover:border-white/[0.075] hover:bg-white/[0.02] hover:text-white/52 ${
            collapsed
              ? "w-11 justify-center"
              : "w-full gap-3 px-3.5"
          }`}
        >
          <Command
            size={14}
            className="shrink-0"
          />

          {!collapsed && (
            <>
              <span className="text-[9px] font-medium">
                Command Center
              </span>
              <span className="ml-auto text-[7px] text-white/12">
                ⌘K
              </span>
            </>
          )}
        </button>
      </nav>

      <div
        className={`relative ${
          collapsed
            ? "px-5"
            : "px-3"
        }`}
      >
        <AnimatePresence>
          {accountMenuOpen && (
            <motion.div
              initial={{
                opacity: 0,
                y: 6,
                scale: 0.98,
              }}
              animate={{
                opacity: 1,
                y: 0,
                scale: 1,
              }}
              exit={{
                opacity: 0,
                y: 4,
              }}
              className={`absolute bottom-[54px] overflow-hidden rounded-[17px] border border-white/[0.08] bg-[#121214] p-2 shadow-[0_18px_60px_rgba(0,0,0,0.55)] ${
                collapsed
                  ? "left-[70px] w-[230px]"
                  : "inset-x-3"
              }`}
            >
              <div className="px-3 py-2">
                <p className="truncate text-[9px] font-medium text-white/50">
                  {accountName}
                </p>
                <p className="mt-1 truncate text-[7px] text-white/17">
                  {accountEmail}
                </p>
              </div>

              <div className="my-1 h-px bg-white/[0.045]" />

              <button
                type="button"
                onClick={onSignOut}
                disabled={
                  loggingOut
                }
                className="flex w-full items-center gap-2 rounded-[11px] px-3 py-2.5 text-[8px] text-white/25 transition hover:bg-white/[0.025] hover:text-white/52 disabled:opacity-40"
              >
                {loggingOut ? (
                  <Loader2
                    size={10}
                    className="animate-spin"
                  />
                ) : (
                  <LogOut
                    size={10}
                  />
                )}
                Sign out
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <button
          type="button"
          onClick={
            onToggleAccount
          }
          title={
            collapsed
              ? accountName
              : undefined
          }
          className={`flex h-11 items-center rounded-[13px] border border-white/[0.045] bg-white/[0.01] transition hover:border-white/[0.07] hover:bg-white/[0.025] ${
            collapsed
              ? "w-11 justify-center"
              : "w-full gap-3 px-2.5"
          }`}
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] bg-white/[0.045] text-[8px] font-semibold text-white/42">
            {accountInitials}
          </span>

          {!collapsed && (
            <div className="min-w-0 flex-1 text-left">
              <p className="truncate text-[8px] font-medium text-white/35">
                {accountName}
              </p>
              <p className="mt-0.5 truncate text-[7px] text-white/12">
                Account
              </p>
            </div>
          )}

          {!collapsed && (
            <UserRound
              size={10}
              className="shrink-0 text-white/12"
            />
          )}
        </button>
      </div>
    </aside>
  );
}

function MobileNav({
  onOpenCommand,
}: {
  onOpenCommand: () => void;
}) {
  const router =
    useRouter();

  return (
    <nav className="fixed inset-x-3 bottom-3 z-50 flex items-center justify-around rounded-[19px] border border-white/[0.085] bg-[#111113]/95 px-2 py-2 shadow-[0_20px_70px_rgba(0,0,0,0.5)] backdrop-blur-2xl md:hidden">
      {NAV.map(
        (item) => {
          const Icon =
            item.icon;

          return (
            <button
              key={
                item.label
              }
              type="button"
              onClick={() =>
                router.push(
                  item.href,
                )
              }
              className={`flex h-10 w-10 items-center justify-center rounded-[12px] ${
                item.href ===
                "/"
                  ? "bg-white/[0.055] text-white/66"
                  : "text-white/27"
              }`}
              aria-label={
                item.label
              }
            >
              <Icon
                size={15}
              />
            </button>
          );
        },
      )}

    </nav>
  );
}

function PrimaryRecommendation({
  item,
  accent,
  onOpen,
  onSnooze,
}: {
  item: AttentionItem | null;
  accent: string;
  onOpen: (href: string) => void;
  onSnooze?: () => void;
}) {
  if (!item) {
    return (
      <div className="relative overflow-hidden rounded-[28px] border border-white/[0.07] bg-[#101012] p-6 sm:p-8">
        <div
          aria-hidden
          className="absolute right-[-80px] top-[-100px] h-[280px] w-[280px] rounded-full opacity-[0.08] blur-[85px]"
          style={{
            backgroundColor:
              accent,
          }}
        />
        <CheckCircle2
          size={18}
          style={{
            color:
              accent,
          }}
        />
        <p className="mt-6 text-[9px] font-semibold uppercase tracking-[0.15em] text-white/22">
          You are clear
        </p>
        <h2 className="mt-2 max-w-2xl text-[31px] font-medium leading-[1.04] tracking-[-0.045em]">
          Nothing urgent is asking for you.
        </h2>
        <p className="mt-4 max-w-xl text-[11px] leading-5 text-white/29">
          Use the breathing room for a weak topic, a recent lecture, or something ahead of schedule.
        </p>
      </div>
    );
  }

  const color =
    item.color ||
    accent;

  return (
    <div className="relative overflow-hidden rounded-[28px] border border-white/[0.075] bg-[#101012] p-6 sm:p-8">
      <div
        aria-hidden
        className="absolute right-[-70px] top-[-120px] h-[330px] w-[330px] rounded-full opacity-[0.12] blur-[100px]"
        style={{
          backgroundColor:
            color,
        }}
      />

      <div className="relative">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Sparkles
              size={12}
              style={{
                color,
              }}
            />
            <p
              className="text-[8px] font-semibold uppercase tracking-[0.16em]"
              style={{
                color,
              }}
            >
              Recommended next
            </p>
          </div>

          <span className="rounded-full border border-white/[0.055] bg-black/10 px-2.5 py-1.5 text-[7px] text-white/24">
            {urgencyLabel(
              item.urgency,
            )}
          </span>
        </div>

        <h2 className="mt-7 max-w-3xl text-[34px] font-medium leading-[1.02] tracking-[-0.05em] sm:text-[42px]">
          {item.title}
        </h2>

        <p className="mt-4 max-w-2xl text-[12px] leading-6 text-white/37">
          {item.detail}
        </p>

        {item.preparedness !==
          null && (
          <div className="mt-5 flex items-center gap-3">
            <div className="h-1.5 w-32 overflow-hidden rounded-full bg-white/[0.055]">
              <div
                className="h-full rounded-full"
                style={{
                  width:
                    `${Math.max(
                      2,
                      Math.min(
                        100,
                        item.preparedness,
                      ),
                    )}%`,
                  backgroundColor:
                    color,
                }}
              />
            </div>
            <p className="text-[8px] tabular-nums text-white/25">
              {Math.round(
                item.preparedness,
              )}
              % preparedness
            </p>
          </div>
        )}

        <div className="mt-7 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() =>
              onOpen(
                item.action
                  .href,
              )
            }
            className="flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-[9px] font-medium text-black transition hover:bg-white/90"
          >
            {item.action
              .label}
            <ArrowRight
              size={10}
            />
          </button>

          {item.secondaryAction && (
            <button
              type="button"
              onClick={() =>
                onOpen(
                  item
                    .secondaryAction!
                    .href,
                )
              }
              className="rounded-full border border-white/[0.06] px-4 py-2.5 text-[9px] text-white/35 transition hover:bg-white/[0.025] hover:text-white/58"
            >
              {
                item
                  .secondaryAction
                  .label
              }
            </button>
          )}

          {onSnooze && (
            <button
              type="button"
              onClick={
                onSnooze
              }
              className="ml-auto text-[8px] text-white/18 transition hover:text-white/42"
            >
              Remind me tomorrow
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function TodayCard({
  items,
  onOpen,
}: {
  items: HomeData["schedule"];
  onOpen: () => void;
}) {
  return (
    <div className="rounded-[28px] border border-white/[0.06] bg-[#101012] p-5 sm:p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[8px] font-semibold uppercase tracking-[0.14em] text-white/22">
            Today
          </p>
          <h2 className="mt-2 text-[22px] font-medium tracking-[-0.035em]">
            What is ahead.
          </h2>
        </div>

        <button
          type="button"
          onClick={
            onOpen
          }
          className="flex h-8 w-8 items-center justify-center rounded-full border border-white/[0.05] text-white/22 transition hover:bg-white/[0.025] hover:text-white/48"
        >
          <CalendarDays
            size={11}
          />
        </button>
      </div>

      <div className="mt-5">
        {items.length >
        0 ? (
          items.map(
            (
              item,
              index,
            ) => (
              <div
                key={
                  item.id
                }
                className={`flex gap-3 py-3 ${
                  index >
                  0
                    ? "border-t border-white/[0.04]"
                    : ""
                }`}
              >
                <div className="w-[50px] shrink-0 pt-0.5 text-[8px] tabular-nums text-white/24">
                  {timeText(
                    item.startsAt,
                  )}
                </div>

                <div
                  className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{
                    backgroundColor:
                      item.color ||
                      "rgba(255,255,255,.24)",
                  }}
                />

                <div className="min-w-0">
                  <p className="truncate text-[10px] font-medium text-white/48">
                    {
                      item.title
                    }
                  </p>
                  <p className="mt-1 truncate text-[8px] text-white/18">
                    {item.courseCode
                      ? `${item.courseCode} · `
                      : ""}
                    {item.location ||
                      item.itemType}
                  </p>
                </div>
              </div>
            ),
          )
        ) : (
          <div className="rounded-[16px] border border-white/[0.045] bg-white/[0.008] px-4 py-5">
            <p className="text-[10px] text-white/34">
              No calendar items remaining today.
            </p>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={
          onOpen
        }
        className="mt-4 flex items-center gap-1.5 text-[8px] font-medium text-white/22 transition hover:text-white/50"
      >
        Full calendar
        <ChevronRight
          size={8}
        />
      </button>
    </div>
  );
}

function AttentionRow({
  item,
  index,
  onOpen,
  onDismiss,
}: {
  item: AttentionItem;
  index: number;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="group flex items-start gap-3 rounded-[17px] border border-white/[0.045] bg-white/[0.008] p-4 transition hover:border-white/[0.075] hover:bg-white/[0.014]">
      <span className="w-5 shrink-0 pt-0.5 text-[8px] font-medium text-white/16">
        {String(
          index + 1,
        ).padStart(
          2,
          "0",
        )}
      </span>

      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={
            onOpen
          }
          className="block w-full text-left"
        >
          <p className="text-[10px] font-medium text-white/48">
            {item.title}
          </p>
          <p className="mt-1.5 line-clamp-2 text-[8px] leading-4 text-white/21">
            {item.detail}
          </p>
        </button>
      </div>

      <button
        type="button"
        onClick={
          onDismiss
        }
        className="opacity-0 text-[7px] text-white/14 transition group-hover:opacity-100 hover:text-white/40"
      >
        Dismiss
      </button>
    </div>
  );
}

function PreparednessCard({
  rows,
  onOpen,
}: {
  rows: HomeData["preparedness"];
  onOpen: (
    courseId: string,
    topicId?: string,
  ) => void;
}) {
  const ranked =
    [...rows].sort(
      (a, b) =>
        (
          a.preparedness ??
          101
        ) -
        (
          b.preparedness ??
          101
        ),
    );

  return (
    <div className="rounded-[24px] border border-white/[0.06] bg-[#101012] p-5 sm:p-6">
      <p className="text-[8px] font-semibold uppercase tracking-[0.14em] text-white/22">
        Preparedness
      </p>
      <h2 className="mt-2 text-[23px] font-medium tracking-[-0.035em]">
        Where you stand.
      </h2>

      <div className="mt-5 space-y-4">
        {ranked.length >
        0 ? (
          ranked.map(
            (row) => (
              <div
                key={
                  row.courseId
                }
              >
                <button
                  type="button"
                  onClick={() =>
                    onOpen(
                      row.courseId,
                    )
                  }
                  className="flex w-full items-center justify-between gap-4 text-left"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{
                        backgroundColor:
                          row.color,
                      }}
                    />
                    <p className="truncate text-[9px] font-medium text-white/42">
                      {
                        row.courseCode
                      }
                    </p>
                  </div>
                  <p className="text-[9px] tabular-nums text-white/31">
                    {row.preparedness ===
                    null
                      ? "No data"
                      : `${row.preparedness}%`}
                  </p>
                </button>

                <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.045]">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width:
                        `${Math.max(
                          1,
                          row.preparedness ??
                            0,
                        )}%`,
                      backgroundColor:
                        row.color,
                      opacity:
                        0.75,
                    }}
                  />
                </div>

                {row.weakest[0] && (
                  <button
                    type="button"
                    onClick={() =>
                      onOpen(
                        row.courseId,
                        row.weakest[0]
                          .id,
                      )
                    }
                    className="mt-2 text-[7px] text-white/17 transition hover:text-white/40"
                  >
                    Weakest:{" "}
                    {
                      row
                        .weakest[0]
                        .name
                    }{" "}
                    ·{" "}
                    {
                      row
                        .weakest[0]
                        .mastery
                    }
                    %
                  </button>
                )}
              </div>
            ),
          )
        ) : (
          <p className="text-[9px] text-white/22">
            Study activity will build your preparedness picture here.
          </p>
        )}
      </div>
    </div>
  );
}

function CoursesCard({
  courses,
  onOpen,
  onAdd,
}: {
  courses: HomeData["courses"];
  onOpen: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <div className="rounded-[24px] border border-white/[0.06] bg-[#101012] p-5 sm:p-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-[8px] font-semibold uppercase tracking-[0.14em] text-white/22">
            Courses
          </p>
          <h2 className="mt-2 text-[23px] font-medium tracking-[-0.035em]">
            Your semester.
          </h2>
        </div>

        <button
          type="button"
          onClick={
            onAdd
          }
          className="flex h-8 w-8 items-center justify-center rounded-full border border-white/[0.055] text-white/22 transition hover:bg-white/[0.03] hover:text-white/48"
        >
          <Plus
            size={11}
          />
        </button>
      </div>

      <div className="mt-5 grid gap-2 sm:grid-cols-2">
        {courses.map(
          (course) => (
            <button
              key={
                course.id
              }
              type="button"
              onClick={() =>
                onOpen(
                  course.id,
                )
              }
              className="group rounded-[17px] border border-white/[0.045] bg-white/[0.007] p-4 text-left transition hover:border-white/[0.08] hover:bg-white/[0.014]"
            >
              <div className="flex items-start justify-between gap-3">
                <span
                  className="text-[9px] font-semibold"
                  style={{
                    color:
                      course.color,
                  }}
                >
                  {
                    course.code
                  }
                </span>
                <ChevronRight
                  size={9}
                  className="text-white/12 transition group-hover:text-white/34"
                />
              </div>
              <p className="mt-2 line-clamp-1 text-[11px] font-medium text-white/44">
                {course.name}
              </p>
              <p className="mt-2 text-[7px] text-white/16">
                {course.professor ||
                  `${course.credits} credits`}
              </p>
            </button>
          ),
        )}
      </div>
    </div>
  );
}

function RecentCard({
  items,
  onOpen,
}: {
  items: HomeData["recent"];
  onOpen: (href: string) => void;
}) {
  return (
    <div className="rounded-[24px] border border-white/[0.06] bg-[#101012] p-5">
      <p className="text-[8px] font-semibold uppercase tracking-[0.14em] text-white/22">
        Recent
      </p>
      <h2 className="mt-2 text-[22px] font-medium tracking-[-0.035em]">
        Pick up where you left off.
      </h2>

      <div className="mt-4">
        {items.length >
        0 ? (
          items.slice(
            0,
            5,
          ).map(
            (
              item,
              index,
            ) => {
              const Icon =
                recentIcon(
                  item.kind,
                );

              return (
                <button
                  key={`${item.kind}:${item.id}`}
                  type="button"
                  onClick={() =>
                    onOpen(
                      item.href,
                    )
                  }
                  className={`flex w-full items-center gap-3 py-3 text-left ${
                    index >
                    0
                      ? "border-t border-white/[0.04]"
                      : ""
                  }`}
                >
                  <div
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-white/[0.025]"
                    style={{
                      color:
                        item.color ||
                        "rgba(255,255,255,.3)",
                    }}
                  >
                    <Icon
                      size={11}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[9px] font-medium text-white/40">
                      {
                        item.title
                      }
                    </p>
                    <p className="mt-1 text-[7px] text-white/15">
                      {item.courseCode
                        ? `${item.courseCode} · `
                        : ""}
                      {relativeTime(
                        item.at,
                      )}
                    </p>
                  </div>
                </button>
              );
            },
          )
        ) : (
          <p className="mt-5 text-[9px] text-white/20">
            Your recent notes, lectures, and study guides will collect here.
          </p>
        )}
      </div>
    </div>
  );
}

function AddCourseSheet({
  draft,
  onChange,
  creating,
  accent,
  onClose,
  onCreate,
}: {
  draft: {
    code: string;
    name: string;
    professor: string;
    credits: string;
  };
  onChange: (
    next: {
      code: string;
      name: string;
      professor: string;
      credits: string;
    },
  ) => void;
  creating: boolean;
  accent: string;
  onClose: () => void;
  onCreate: () => void;
}) {
  return (
    <motion.div
      initial={{
        opacity: 0,
      }}
      animate={{
        opacity: 1,
      }}
      exit={{
        opacity: 0,
      }}
      className="fixed inset-0 z-[260] flex items-end justify-center bg-black/68 backdrop-blur-lg sm:items-center sm:p-6"
      onMouseDown={(
        event,
      ) => {
        if (
          event.target ===
          event.currentTarget
        ) {
          onClose();
        }
      }}
    >
      <motion.div
        initial={{
          y: 20,
          opacity: 0,
        }}
        animate={{
          y: 0,
          opacity: 1,
        }}
        exit={{
          y: 15,
          opacity: 0,
        }}
        className="w-full border-t border-white/[0.08] bg-[#111113] p-6 sm:max-w-[520px] sm:rounded-[24px] sm:border"
      >
        <p
          className="text-[8px] font-semibold uppercase tracking-[0.15em]"
          style={{
            color:
              accent,
          }}
        >
          New course
        </p>
        <h2 className="mt-2 text-[26px] font-medium tracking-[-0.04em]">
          Add it once.
        </h2>
        <p className="mt-2 text-[9px] leading-4 text-white/23">
          Everything else, topics, materials, study, lectures, grades, and calendar intelligence, grows from this course.
        </p>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <input
            value={
              draft.code
            }
            onChange={(
              event,
            ) =>
              onChange({
                ...draft,
                code:
                  event.target
                    .value,
              })
            }
            placeholder="PHYS 211"
            className="rounded-[14px] border border-white/[0.06] bg-black/20 px-4 py-3 text-[10px] text-white/55 outline-none placeholder:text-white/16 focus:border-white/[0.11]"
          />

          <input
            value={
              draft.credits
            }
            onChange={(
              event,
            ) =>
              onChange({
                ...draft,
                credits:
                  event.target
                    .value,
              })
            }
            inputMode="decimal"
            placeholder="3 credits"
            className="rounded-[14px] border border-white/[0.06] bg-black/20 px-4 py-3 text-[10px] text-white/55 outline-none placeholder:text-white/16 focus:border-white/[0.11]"
          />

          <input
            value={
              draft.name
            }
            onChange={(
              event,
            ) =>
              onChange({
                ...draft,
                name:
                  event.target
                    .value,
              })
            }
            placeholder="University Physics"
            className="sm:col-span-2 rounded-[14px] border border-white/[0.06] bg-black/20 px-4 py-3 text-[10px] text-white/55 outline-none placeholder:text-white/16 focus:border-white/[0.11]"
          />

          <input
            value={
              draft.professor
            }
            onChange={(
              event,
            ) =>
              onChange({
                ...draft,
                professor:
                  event.target
                    .value,
              })
            }
            placeholder="Professor, optional"
            className="sm:col-span-2 rounded-[14px] border border-white/[0.06] bg-black/20 px-4 py-3 text-[10px] text-white/55 outline-none placeholder:text-white/16 focus:border-white/[0.11]"
          />
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={
              onClose
            }
            className="rounded-full px-4 py-2.5 text-[9px] text-white/28 transition hover:text-white/50"
          >
            Cancel
          </button>

          <button
            type="button"
            disabled={
              creating
            }
            onClick={
              onCreate
            }
            className="flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-[9px] font-medium text-black disabled:opacity-40"
          >
            {creating ? (
              <Loader2
                size={9}
                className="animate-spin"
              />
            ) : (
              <GraduationCap
                size={9}
              />
            )}
            Create course
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}