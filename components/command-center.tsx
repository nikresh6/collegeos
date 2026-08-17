"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  Command,
  FileText,
  GraduationCap,
  Headphones,
  LayoutGrid,
  Loader2,
  Plus,
  Search,
  Sparkles,
  Target,
  X,
} from "lucide-react";
import {
  useRouter,
} from "next/navigation";
import {
  AnimatePresence,
  motion,
} from "framer-motion";
import { supabase } from "../lib/supabase";
import {
  useSchoolIdentity,
} from "./school-identity";

type SearchKind =
  | "course"
  | "note"
  | "lecture"
  | "material"
  | "topic"
  | "assignment"
  | "study_guide"
  | "calendar";

type SearchResult = {
  id: string;
  kind: SearchKind;
  title: string;
  subtitle: string;
  href: string;
  courseId: string | null;
  color: string | null;
  meta?: string | null;
};

type SearchAction = {
  id: string;
  type:
    | "navigate"
    | "create_note"
    | "schedule_study";
  title: string;
  subtitle: string;
  href?: string;
  query?: string;
};

type AnswerSource = {
  key: string;
  kind: SearchKind;
  title: string;
  subtitle: string;
  href: string;
  color: string | null;
};

type CommandAnswer = {
  text: string;
  sources: AnswerSource[];
  mode:
    | "deterministic"
    | "grounded";
  query: string;
};

const EMPTY_SHORTCUTS = [
  "solve a problem step by step",
  "find my latest lecture",
  "when is my next exam?",
  "what should I study tonight?",
  "schedule 45 min study tomorrow",
];

function iconForKind(
  kind: SearchKind,
) {
  if (
    kind === "course"
  ) {
    return GraduationCap;
  }

  if (kind === "note") {
    return FileText;
  }

  if (
    kind === "lecture"
  ) {
    return Headphones;
  }

  if (
    kind ===
    "study_guide"
  ) {
    return BookOpen;
  }

  if (
    kind === "topic"
  ) {
    return Target;
  }

  if (
    kind ===
      "assignment" ||
    kind ===
      "calendar"
  ) {
    return CalendarDays;
  }

  return LayoutGrid;
}

function kindLabel(
  kind: SearchKind,
) {
  if (
    kind ===
    "study_guide"
  ) {
    return "Study guide";
  }

  return (
    kind.charAt(0)
      .toUpperCase() +
    kind
      .slice(1)
      .replaceAll(
        "_",
        " ",
      )
  );
}

export function CommandCenter() {
  const router =
    useRouter();

  const {
    identity,
  } =
    useSchoolIdentity();

  const inputRef =
    useRef<HTMLInputElement | null>(
      null,
    );

  const [
    open,
    setOpen,
  ] = useState(false);

  const [
    query,
    setQuery,
  ] = useState("");

  const [
    results,
    setResults,
  ] =
    useState<SearchResult[]>(
      [],
    );

  const [
    actions,
    setActions,
  ] =
    useState<SearchAction[]>(
      [],
    );

  const [
    loading,
    setLoading,
  ] = useState(false);

  const [
    actionLoading,
    setActionLoading,
  ] =
    useState<string | null>(
      null,
    );

  const [
    askLoading,
    setAskLoading,
  ] = useState(false);

  const [
    answer,
    setAnswer,
  ] =
    useState<CommandAnswer | null>(
      null,
    );

  const [
    error,
    setError,
  ] = useState("");

  const [
    success,
    setSuccess,
  ] = useState("");

  useEffect(() => {
    function handleKeyDown(
      event: KeyboardEvent,
    ) {
      if (
        (
          event.metaKey ||
          event.ctrlKey
        ) &&
        event.key.toLowerCase() ===
          "k"
      ) {
        event.preventDefault();
        setOpen(
          (current) =>
            !current,
        );
      }

      if (
        event.key ===
        "Escape"
      ) {
        setOpen(false);
      }
    }

    function handleOpen() {
      setOpen(true);
    }

    window.addEventListener(
      "keydown",
      handleKeyDown,
    );

    window.addEventListener(
      "college-assistant:open-command-center",
      handleOpen,
    );

    return () => {
      window.removeEventListener(
        "keydown",
        handleKeyDown,
      );

      window.removeEventListener(
        "college-assistant:open-command-center",
        handleOpen,
      );
    };
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    window.setTimeout(
      () => {
        inputRef.current?.focus();
      },
      60,
    );
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const clean =
      query.trim();

    setError("");
    setSuccess("");

    if (
      clean.length === 0
    ) {
      setResults([]);
      setActions([]);
      setAnswer(null);
      setLoading(false);
      return;
    }

    let cancelled =
      false;

    const timer =
      window.setTimeout(
        async () => {
          try {
            setLoading(
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

            if (!session) {
              throw new Error(
                "You must be signed in.",
              );
            }

            const response =
              await fetch(
                `/api/intelligence/search?q=${encodeURIComponent(
                  clean,
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
                results?: SearchResult[];
                actions?: SearchAction[];
              };

            if (
              !response.ok ||
              payload.ok ===
                false
            ) {
              throw new Error(
                payload.error ||
                  "Search failed.",
              );
            }

            if (
              cancelled
            ) {
              return;
            }

            setResults(
              payload.results ??
                [],
            );

            setActions(
              payload.actions ??
                [],
            );
          } catch (
            searchError
          ) {
            if (
              cancelled
            ) {
              return;
            }

            setError(
              searchError instanceof
                Error
                ? searchError.message
                : "Search failed.",
            );
          } finally {
            if (
              !cancelled
            ) {
              setLoading(
                false,
              );
            }
          }
        },
        180,
      );

    return () => {
      cancelled = true;
      window.clearTimeout(
        timer,
      );
    };
  }, [
    open,
    query,
  ]);

  const grouped =
    useMemo(() => {
      const groups =
        new Map<
          SearchKind,
          SearchResult[]
        >();

      for (
        const result of
        results
      ) {
        const existing =
          groups.get(
            result.kind,
          ) ?? [];

        existing.push(
          result,
        );

        groups.set(
          result.kind,
          existing,
        );
      }

      return Array.from(
        groups.entries(),
      );
    }, [results]);

  function navigate(
    href: string,
  ) {
    setOpen(false);
    setQuery("");
    router.push(href);
  }

  async function askQuestion() {
    const clean =
      query.trim();

    if (
      clean.length < 2 ||
      askLoading
    ) {
      return;
    }

    try {
      setAskLoading(true);
      setError("");
      setSuccess("");

      const {
        data: {
          session,
        },
        error:
          sessionError,
      } =
        await supabase.auth.getSession();

      if (sessionError) {
        throw sessionError;
      }

      if (!session) {
        throw new Error(
          "You must be signed in.",
        );
      }

      const timeZone =
        Intl.DateTimeFormat()
          .resolvedOptions()
          .timeZone;

      const response =
        await fetch(
          "/api/intelligence/ask",
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
                question:
                  clean,
                timeZone,
              }),
          },
        );

      const payload =
        (await response.json()) as {
          ok?: boolean;
          error?: string;
          answer?: string;
          sources?: AnswerSource[];
          mode?:
            | "deterministic"
            | "grounded";
        };

      if (
        !response.ok ||
        payload.ok ===
          false
      ) {
        throw new Error(
          payload.error ||
            "Could not answer that question.",
        );
      }

      setAnswer({
        text:
          payload.answer ||
          "I could not form a clean answer from your academic data.",
        sources:
          payload.sources ??
          [],
        mode:
          payload.mode ??
          "grounded",
        query:
          clean,
      });
    } catch (askError) {
      setError(
        askError instanceof
          Error
          ? askError.message
          : "Could not answer that question.",
      );
    } finally {
      setAskLoading(false);
    }
  }

  function handleInputKeyDown(
    event: KeyboardEvent<HTMLInputElement>,
  ) {
    if (
      event.key !==
      "Enter"
    ) {
      return;
    }

    event.preventDefault();

    if (/^(solve|walk me through|help me (solve|with))\b/i.test(query.trim())) {
      const solverPrompt = query
        .trim()
        .replace(/^(solve|walk me through|help me solve|help me with)\s*:?[\s]*/i, "");
      setOpen(false);
      window.setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent("collegeos:open-solver", {
            detail: {
              prompt: solverPrompt,
              originKind: "manual",
            },
          }),
        );
      }, 80);
      return;
    }

    const commandLike =
      /^(create|new|study|open|schedule|plan)\b/i.test(
        query.trim(),
      );

    if (
      commandLike &&
      actions[0]
    ) {
      void executeAction(
        actions[0],
      );
      return;
    }

    void askQuestion();
  }

  async function executeAction(
    action: SearchAction,
  ) {
    if (
      action.type ===
        "navigate" &&
      action.href
    ) {
      navigate(
        action.href,
      );
      return;
    }

    try {
      setActionLoading(
        action.id,
      );
      setError("");
      setSuccess("");

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
        throw new Error(
          "You must be signed in.",
        );
      }

      const response =
        await fetch(
          "/api/intelligence/command",
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
                  action.type,
                query:
                  action.query ??
                  query,
              }),
          },
        );

      const payload =
        (await response.json()) as {
          ok?: boolean;
          error?: string;
          message?: string;
          href?: string;
        };

      if (
        !response.ok ||
        payload.ok ===
          false
      ) {
        throw new Error(
          payload.error ||
            "Could not complete that command.",
        );
      }

      if (
        payload.href
      ) {
        if (
          action.type ===
          "schedule_study"
        ) {
          setSuccess(
            payload.message ||
              "Study block scheduled.",
          );

          window.setTimeout(
            () => {
              navigate(
                payload.href!,
              );
            },
            650,
          );
        } else {
          navigate(
            payload.href,
          );
        }
        return;
      }

      setSuccess(
        payload.message ||
          "Done.",
      );
    } catch (
      actionError
    ) {
      setError(
        actionError instanceof
          Error
          ? actionError.message
          : "Could not complete that command.",
      );
    } finally {
      setActionLoading(
        null,
      );
    }
  }

  return (
    <AnimatePresence>
      {open && (
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
          className="fixed inset-0 z-[320] bg-black/66 px-4 pt-[8vh] backdrop-blur-xl sm:pt-[11vh]"
          onMouseDown={(
            event,
          ) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              setOpen(
                false,
              );
            }
          }}
        >
          <motion.div
            initial={{
              opacity: 0,
              y: -10,
              scale: 0.99,
            }}
            animate={{
              opacity: 1,
              y: 0,
              scale: 1,
            }}
            exit={{
              opacity: 0,
              y: -6,
              scale: 0.99,
            }}
            transition={{
              duration: 0.18,
              ease: [
                0.22,
                1,
                0.36,
                1,
              ],
            }}
            className="mx-auto max-h-[78vh] w-full max-w-[760px] overflow-hidden rounded-[25px] border border-white/[0.09] bg-[#111113]/98 shadow-[0_34px_110px_rgba(0,0,0,0.62)]"
          >
            <div className="flex items-center gap-3 border-b border-white/[0.055] px-5 py-4">
              <Search
                size={16}
                className="shrink-0 text-white/25"
              />

              <input
                ref={
                  inputRef
                }
                value={
                  query
                }
                onChange={(
                  event,
                ) =>
                  setQuery(
                    event
                      .target
                      .value,
                  )
                }
                onKeyDown={
                  handleInputKeyDown
                }
                placeholder="Search, ask a question, or run a command…"
                className="min-w-0 flex-1 bg-transparent text-[15px] text-white/72 outline-none placeholder:text-white/18"
              />

              {loading ||
              askLoading ? (
                <Loader2
                  size={13}
                  className="shrink-0 animate-spin text-white/20"
                />
              ) : (
                <button
                  type="button"
                  onClick={() =>
                    setOpen(
                      false,
                    )
                  }
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/18 transition hover:bg-white/[0.035] hover:text-white/45"
                >
                  <X
                    size={12}
                  />
                </button>
              )}
            </div>

            <div className="max-h-[calc(78vh-68px)] overflow-y-auto p-3">
              {!query.trim() && (
                <div className="px-2 py-4">
                  <div className="flex items-center gap-2">
                    <Command
                      size={11}
                      style={{
                        color:
                          identity.primary,
                      }}
                    />
                    <p className="text-[8px] font-semibold uppercase tracking-[0.15em] text-white/22">
                      Command Center
                    </p>
                  </div>

                  <p className="mt-3 max-w-xl text-[11px] leading-5 text-white/28">
                    Find anything instantly, ask questions about your actual academic data, or use plain language to start an action.
                  </p>

                  <div className="mt-5 grid gap-2 sm:grid-cols-2">
                    {EMPTY_SHORTCUTS.map(
                      (
                        shortcut,
                      ) => (
                        <button
                          key={
                            shortcut
                          }
                          type="button"
                          onClick={() =>
                            setQuery(
                              shortcut,
                            )
                          }
                          className="flex items-center justify-between gap-3 rounded-[15px] border border-white/[0.045] bg-white/[0.008] px-4 py-3 text-left transition hover:border-white/[0.075] hover:bg-white/[0.018]"
                        >
                          <span className="text-[9px] text-white/34">
                            {
                              shortcut
                            }
                          </span>
                          <ArrowRight
                            size={9}
                            className="text-white/13"
                          />
                        </button>
                      ),
                    )}
                  </div>

                  <div className="mt-5 grid grid-cols-3 gap-2">
                    <QuickNav
                      label="Study"
                      icon={
                        Target
                      }
                      onClick={() =>
                        navigate(
                          "/study",
                        )
                      }
                    />
                    <QuickNav
                      label="Calendar"
                      icon={
                        CalendarDays
                      }
                      onClick={() =>
                        navigate(
                          "/calendar",
                        )
                      }
                    />
                    <QuickNav
                      label="Notes"
                      icon={
                        FileText
                      }
                      onClick={() =>
                        navigate(
                          "/notes",
                        )
                      }
                    />
                  </div>
                </div>
              )}

              {actions.length >
                0 && (
                <section className="mb-3">
                  <p className="px-3 py-2 text-[7px] font-semibold uppercase tracking-[0.14em] text-white/18">
                    Actions
                  </p>

                  <div className="space-y-1">
                    {actions.map(
                      (
                        action,
                      ) => {
                        const Icon =
                          action.type ===
                          "create_note"
                            ? Plus
                            : action.type ===
                                "schedule_study"
                              ? CalendarDays
                              : Sparkles;

                        return (
                          <button
                            key={
                              action.id
                            }
                            type="button"
                            disabled={
                              actionLoading !==
                              null
                            }
                            onClick={() =>
                              void executeAction(
                                action,
                              )
                            }
                            className="group flex w-full items-center gap-3 rounded-[16px] border border-white/[0.055] bg-white/[0.012] px-4 py-3.5 text-left transition hover:border-white/[0.09] hover:bg-white/[0.025] disabled:opacity-45"
                          >
                            <div
                              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px]"
                              style={{
                                backgroundColor:
                                  `${identity.primary}0E`,
                                color:
                                  identity.primary,
                              }}
                            >
                              {actionLoading ===
                              action.id ? (
                                <Loader2
                                  size={12}
                                  className="animate-spin"
                                />
                              ) : (
                                <Icon
                                  size={12}
                                />
                              )}
                            </div>

                            <div className="min-w-0 flex-1">
                              <p className="text-[10px] font-medium text-white/52">
                                {
                                  action.title
                                }
                              </p>
                              <p className="mt-1 truncate text-[8px] text-white/20">
                                {
                                  action.subtitle
                                }
                              </p>
                            </div>

                            <ArrowRight
                              size={9}
                              className="text-white/12 transition group-hover:text-white/35"
                            />
                          </button>
                        );
                      },
                    )}
                  </div>
                </section>
              )}

              {query.trim() &&
                !/^(create|new|study|open|schedule|plan)\b/i.test(
                  query.trim(),
                ) &&
                answer?.query !==
                  query.trim() && (
                <button
                  type="button"
                  disabled={
                    askLoading
                  }
                  onClick={() =>
                    void askQuestion()
                  }
                  className="mb-3 flex w-full items-center gap-3 rounded-[16px] border border-white/[0.06] bg-white/[0.012] px-4 py-3.5 text-left transition hover:border-white/[0.095] hover:bg-white/[0.024] disabled:opacity-40"
                >
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px]"
                    style={{
                      backgroundColor:
                        `${identity.primary}0E`,
                      color:
                        identity.primary,
                    }}
                  >
                    {askLoading ? (
                      <Loader2
                        size={12}
                        className="animate-spin"
                      />
                    ) : (
                      <Sparkles
                        size={12}
                      />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-medium text-white/52">
                      Ask Academic OS
                    </p>
                    <p className="mt-1 text-[8px] text-white/20">
                      Answer from your courses, deadlines, notes, lectures, topics, study guides, materials, and calendar
                    </p>
                  </div>

                  <span className="rounded-md border border-white/[0.05] px-1.5 py-1 text-[7px] text-white/15">
                    ↵
                  </span>
                </button>
              )}

              {answer &&
                answer.query ===
                  query.trim() && (
                <section className="mb-3 overflow-hidden rounded-[19px] border border-white/[0.075] bg-white/[0.014]">
                  <div className="p-5">
                    <div className="flex items-center gap-2">
                      <Sparkles
                        size={11}
                        style={{
                          color:
                            identity.primary,
                        }}
                      />
                      <p className="text-[8px] font-semibold uppercase tracking-[0.14em] text-white/22">
                        Academic OS
                      </p>
                      <span className="ml-auto text-[7px] text-white/12">
                        {answer.mode ===
                        "grounded"
                          ? "Grounded answer"
                          : "Workspace answer"}
                      </span>
                    </div>

                    <p className="mt-4 whitespace-pre-wrap text-[11px] leading-6 text-white/48">
                      {answer.text}
                    </p>
                  </div>

                  {answer.sources.length >
                    0 && (
                    <div className="border-t border-white/[0.045] px-3 py-3">
                      <p className="px-2 pb-2 text-[7px] font-semibold uppercase tracking-[0.12em] text-white/14">
                        Used from your workspace
                      </p>

                      <div className="flex flex-wrap gap-2">
                        {answer.sources.map(
                          (source) => {
                            const Icon =
                              iconForKind(
                                source.kind,
                              );

                            return (
                              <button
                                key={`${source.key}:${source.kind}:${source.title}`}
                                type="button"
                                onClick={() =>
                                  navigate(
                                    source.href,
                                  )
                                }
                                className="flex min-w-0 max-w-full items-center gap-2 rounded-full border border-white/[0.05] bg-black/10 px-3 py-2 text-left transition hover:border-white/[0.08] hover:bg-white/[0.02]"
                              >
                                <Icon
                                  size={8}
                                  style={{
                                    color:
                                      source.color ||
                                      "rgba(255,255,255,.28)",
                                  }}
                                />
                                <span className="max-w-[220px] truncate text-[7px] text-white/28">
                                  {source.title}
                                </span>
                              </button>
                            );
                          },
                        )}
                      </div>
                    </div>
                  )}
                </section>
              )}

              {success && (
                <div className="mb-3 flex items-center gap-2 rounded-[14px] border border-emerald-300/10 bg-emerald-300/[0.025] px-4 py-3 text-[9px] text-emerald-100/55">
                  <CheckCircle2
                    size={10}
                  />
                  {success}
                </div>
              )}

              {error && (
                <div className="mb-3 rounded-[14px] border border-red-300/10 bg-red-300/[0.025] px-4 py-3 text-[9px] leading-4 text-red-100/55">
                  {error}
                </div>
              )}

              {query.trim() &&
                !loading &&
                !askLoading &&
                results.length ===
                  0 &&
                actions.length ===
                  0 &&
                !answer &&
                !error && (
                <div className="px-4 py-10 text-center">
                  <p className="text-[10px] text-white/32">
                    No direct search result.
                  </p>
                  <p className="mt-1.5 text-[8px] text-white/15">
                    Press Enter to ask Academic OS using the rest of your academic context.
                  </p>
                </div>
              )}

              {grouped.map(
                ([
                  kind,
                  items,
                ]) => (
                  <section
                    key={
                      kind
                    }
                    className="mb-3"
                  >
                    <p className="px-3 py-2 text-[7px] font-semibold uppercase tracking-[0.14em] text-white/18">
                      {kindLabel(
                        kind,
                      )}
                    </p>

                    <div className="space-y-0.5">
                      {items.map(
                        (
                          item,
                        ) => {
                          const Icon =
                            iconForKind(
                              item.kind,
                            );

                          return (
                            <button
                              key={`${item.kind}:${item.id}`}
                              type="button"
                              onClick={() =>
                                navigate(
                                  item.href,
                                )
                              }
                              className="group flex w-full items-center gap-3 rounded-[14px] px-3 py-3 text-left transition hover:bg-white/[0.025]"
                            >
                              <div
                                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-white/[0.025]"
                                style={{
                                  color:
                                    item.color ||
                                    "rgba(255,255,255,.34)",
                                }}
                              >
                                <Icon
                                  size={11}
                                />
                              </div>

                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[10px] font-medium text-white/46">
                                  {
                                    item.title
                                  }
                                </p>
                                <p className="mt-1 truncate text-[8px] text-white/18">
                                  {
                                    item.subtitle
                                  }
                                </p>
                              </div>

                              <ArrowRight
                                size={9}
                                className="text-white/10 transition group-hover:text-white/28"
                              />
                            </button>
                          );
                        },
                      )}
                    </div>
                  </section>
                ),
              )}

              {query.trim() && (
                <div className="flex items-center justify-between gap-4 border-t border-white/[0.045] px-3 pt-3 text-[7px] text-white/13">
                  <span className="min-w-0 truncate">
                    Search is instant. Enter asks a grounded question.
                  </span>
                  <span className="shrink-0">
                    ↵ ask · esc close
                  </span>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function QuickNav({
  label,
  icon: Icon,
  onClick,
}: {
  label: string;
  icon: typeof FileText;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={
        onClick
      }
      className="flex items-center justify-center gap-2 rounded-[13px] border border-white/[0.04] bg-black/10 px-3 py-2.5 text-[8px] text-white/22 transition hover:border-white/[0.07] hover:text-white/45"
    >
      <Icon
        size={9}
      />
      {label}
    </button>
  );
}
