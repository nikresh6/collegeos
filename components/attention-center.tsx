"use client";

import {
  useCallback,
  useEffect,
  useState,
} from "react";
import {
  Bell,
  ChevronRight,
  Loader2,
  X,
} from "lucide-react";
import {
  usePathname,
  useRouter,
} from "next/navigation";
import { supabase } from "../lib/supabase";
import {
  useSchoolIdentity,
} from "./school-identity";

type AttentionItem = {
  key: string;
  title: string;
  detail: string;
  urgency:
    | "critical"
    | "high"
    | "medium"
    | "low";
  color: string | null;
  action: {
    label: string;
    href: string;
  };
};

export function AttentionCenter() {
  const pathname =
    usePathname();

  const router =
    useRouter();

  const {
    identity,
  } =
    useSchoolIdentity();

  const [
    item,
    setItem,
  ] =
    useState<AttentionItem | null>(
      null,
    );

  const [
    loading,
    setLoading,
  ] = useState(false);

  const refresh =
    useCallback(
      async () => {
        if (
          pathname ===
          "/" ||
          pathname.startsWith(
            "/onboarding",
          )
        ) {
          setItem(null);
          return;
        }

        try {
          setLoading(
            true,
          );

          const {
            data: {
              session,
            },
          } =
            await supabase.auth.getSession();

          if (!session) {
            setItem(
              null,
            );
            return;
          }

          const tz =
            Intl.DateTimeFormat()
              .resolvedOptions()
              .timeZone;

          const response =
            await fetch(
              `/api/intelligence/attention?tz=${encodeURIComponent(
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

          if (
            !response.ok
          ) {
            return;
          }

          const payload =
            (await response.json()) as {
              snapshot?: {
                primary?: AttentionItem | null;
              };
            };

          const primary =
            payload.snapshot
              ?.primary ??
            null;

          setItem(
            primary &&
              (
                primary.urgency ===
                  "critical" ||
                primary.urgency ===
                  "high"
              )
              ? primary
              : null,
          );
        } catch {
          // Attention should never interrupt the page if it cannot refresh.
        } finally {
          setLoading(
            false,
          );
        }
      },
      [pathname],
    );

  useEffect(() => {
    void refresh();

    const timer =
      window.setInterval(
        () => {
          void refresh();
        },
        90_000,
      );

    function focus() {
      void refresh();
    }

    window.addEventListener(
      "focus",
      focus,
    );

    return () => {
      window.clearInterval(
        timer,
      );

      window.removeEventListener(
        "focus",
        focus,
      );
    };
  }, [refresh]);

  async function snooze() {
    if (!item) {
      return;
    }

    const current =
      item;

    setItem(null);

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
                "snooze",
              key:
                current.key,
              hours: 24,
            }),
        },
      );
    } catch {
      // The visible dismissal already happened. A later refresh can recover it.
    }
  }

  if (
    !item ||
    pathname === "/"
  ) {
    return null;
  }

  const color =
    item.color ||
    identity.primary;

  return (
    <div className="fixed bottom-[132px] right-4 z-[185] w-[min(88vw,330px)] overflow-hidden rounded-[18px] border border-white/[0.08] bg-[#111113]/96 shadow-[0_20px_70px_rgba(0,0,0,0.5)] backdrop-blur-2xl md:bottom-5 md:right-5">
      <div className="flex items-start gap-3 p-4">
        <div
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px]"
          style={{
            color,
            backgroundColor:
              `${color}10`,
          }}
        >
          {loading ? (
            <Loader2
              size={11}
              className="animate-spin"
            />
          ) : (
            <Bell
              size={11}
            />
          )}
        </div>

        <button
          type="button"
          onClick={() =>
            router.push(
              item.action
                .href,
            )
          }
          className="min-w-0 flex-1 text-left"
        >
          <p className="text-[9px] font-medium text-white/55">
            {item.title}
          </p>
          <p className="mt-1.5 line-clamp-2 text-[8px] leading-4 text-white/22">
            {item.detail}
          </p>

          <div
            className="mt-2.5 flex items-center gap-1 text-[7px] font-medium"
            style={{
              color,
            }}
          >
            {item.action
              .label}
            <ChevronRight
              size={8}
            />
          </div>
        </button>

        <button
          type="button"
          onClick={() =>
            void snooze()
          }
          aria-label="Remind me tomorrow"
          title="Remind me tomorrow"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white/13 transition hover:bg-white/[0.03] hover:text-white/38"
        >
          <X
            size={9}
          />
        </button>
      </div>
    </div>
  );
}