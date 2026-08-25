"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "../lib/supabase";
import {
  getSchoolIdentity,
  type SchoolIdentity,
} from "../lib/school-identity";

export type SchoolChangePayload = {
  id: string;
  name: string;
  short_name: string | null;
  primary_color: string;
  secondary_color: string;
};

type SchoolIdentityContextValue = {
  identity: SchoolIdentity;
  ready: boolean;
  refreshIdentity: () => Promise<void>;
};

const STORAGE_KEY = "college-assistant-school-identity";
export const SCHOOL_CHANGED_EVENT =
  "college-assistant:school-changed";

const defaultIdentity = getSchoolIdentity(null);

const SchoolIdentityContext =
  createContext<SchoolIdentityContextValue>({
    identity: defaultIdentity,
    ready: false,
    refreshIdentity: async () => {},
  });

export function useSchoolIdentity() {
  return useContext(SchoolIdentityContext);
}

export function announceSchoolChange(
  school: SchoolChangePayload,
) {
  const nextIdentity = getSchoolIdentity(
    school.name,
    school.primary_color,
    school.secondary_color,
  );

  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(nextIdentity),
  );

  window.dispatchEvent(
    new CustomEvent<SchoolChangePayload>(
      SCHOOL_CHANGED_EVENT,
      {
        detail: school,
      },
    ),
  );
}

export function SchoolIdentityProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [identity, setIdentity] =
    useState<SchoolIdentity>(defaultIdentity);
  const [ready, setReady] = useState(false);

  async function refreshIdentity() {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        setReady(true);
        return;
      }

      const { data: profile, error: profileError } =
        await supabase
          .from("profiles")
          .select("school_id")
          .eq("id", session.user.id)
          .maybeSingle();

      if (profileError) throw profileError;

      if (!profile?.school_id) {
        setReady(true);
        return;
      }

      const { data: school, error: schoolError } =
        await supabase
          .from("schools")
          .select(
            "id, name, short_name, primary_color, secondary_color",
          )
          .eq("id", profile.school_id)
          .maybeSingle();

      if (schoolError) throw schoolError;

      if (!school) {
        setReady(true);
        return;
      }

      const nextIdentity = getSchoolIdentity(
        school.name,
        school.primary_color,
        school.secondary_color,
      );

      setIdentity(nextIdentity);
      setReady(true);

      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(nextIdentity),
      );
    } catch (error) {
      console.warn(
        "School identity could not be refreshed:",
        error,
      );
      setReady(true);
    }
  }

  useEffect(() => {
    const cached =
      window.localStorage.getItem(STORAGE_KEY);

    if (cached) {
      try {
        setIdentity(
          JSON.parse(cached) as SchoolIdentity,
        );
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }

    void refreshIdentity();

    function handleSchoolChanged(
      event: Event,
    ) {
      const detail = (
        event as CustomEvent<SchoolChangePayload>
      ).detail;

      if (!detail) {
        void refreshIdentity();
        return;
      }

      const nextIdentity = getSchoolIdentity(
        detail.name,
        detail.primary_color,
        detail.secondary_color,
      );

      setIdentity(nextIdentity);
      setReady(true);

      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(nextIdentity),
      );
    }

    function handleFocus() {
      void refreshIdentity();
    }

    function handleVisibility() {
      if (
        document.visibilityState === "visible"
      ) {
        void refreshIdentity();
      }
    }

    window.addEventListener(
      SCHOOL_CHANGED_EVENT,
      handleSchoolChanged,
    );
    window.addEventListener("focus", handleFocus);
    document.addEventListener(
      "visibilitychange",
      handleVisibility,
    );

    return () => {
      window.removeEventListener(
        SCHOOL_CHANGED_EVENT,
        handleSchoolChanged,
      );
      window.removeEventListener(
        "focus",
        handleFocus,
      );
      document.removeEventListener(
        "visibilitychange",
        handleVisibility,
      );
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;

    root.style.setProperty(
      "--school-primary",
      identity.primary,
    );
    root.style.setProperty(
      "--school-secondary",
      identity.secondary,
    );
    root.style.setProperty(
      "--school-highlight",
      identity.highlight,
    );
  }, [identity]);

  const value = useMemo(
    () => ({
      identity,
      ready,
      refreshIdentity,
    }),
    [identity, ready],
  );

  return (
    <SchoolIdentityContext.Provider
      value={value}
    >
      {children}
    </SchoolIdentityContext.Provider>
  );
}

export function SchoolMark({
  size = 46,
  className = "",
  quiet = false,
}: {
  size?: number;
  className?: string;
  quiet?: boolean;
}) {
  const { identity } = useSchoolIdentity();

  const fontFamily =
    identity.markStyle === "serif" ||
    identity.markStyle === "shield"
      ? 'Georgia, "Times New Roman", serif'
      : '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

  const borderRadius =
    identity.markStyle === "round"
      ? "999px"
      : identity.markStyle === "shield"
        ? "32% 32% 44% 44% / 24% 24% 54% 54%"
        : identity.markStyle === "block"
          ? "12px"
          : "14px";

  return (
    <div
      className={`relative flex shrink-0 items-center justify-center overflow-hidden border ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius,
        borderColor: `${identity.primary}${quiet ? "35" : "70"}`,
        background: `linear-gradient(145deg, ${identity.primary}${quiet ? "09" : "18"}, ${identity.secondary}10)`,
        color: identity.highlight,
        boxShadow: quiet
          ? "none"
          : `0 12px 42px ${identity.primary}18`,
      }}
      title={identity.name}
      aria-label={`${identity.shortName} identity mark`}
    >
      {identity.officialLogoSrc ? (
        <img
          src={identity.officialLogoSrc}
          alt=""
          className="h-[68%] w-[68%] object-contain"
          draggable={false}
        />
      ) : (
        <span
          style={{
            fontFamily,
            fontSize:
              identity.markText.length >= 3
                ? size * 0.25
                : identity.markText.length === 2
                  ? size * 0.31
                  : size * 0.42,
            lineHeight: 1,
            letterSpacing:
              identity.markStyle === "block"
                ? "-0.08em"
                : "-0.04em",
            fontWeight:
              identity.markStyle === "minimal"
                ? 650
                : 700,
          }}
        >
          {identity.markText}
        </span>
      )}

      <div
        className="absolute bottom-0 left-0 h-[2px] w-full"
        style={{
          background: `linear-gradient(90deg, transparent, ${identity.primary}, transparent)`,
        }}
      />
    </div>
  );
}


/*
  These stay exported so existing pages do not break, but for now they are
  intentionally visual-only and do not print landmark names or generic
  landmark drawings. We can reintroduce school-specific art later.
*/
export function SchoolLandmarkBackdrop({
  opacity: _opacity,
  align: _align,
}: {
  opacity?: number;
  align?: "left" | "right" | "center";
} = {}) {
  return null;
}

export function SchoolLandmarkLabel({
  className: _className,
}: {
  className?: string;
} = {}) {
  return null;
}

export function SchoolIdentityStamp({
  compact = false,
  className = "",
}: {
  compact?: boolean;
  className?: string;
}) {
  const { identity } = useSchoolIdentity();

  return (
    <div
      className={`flex items-center ${
        compact ? "gap-2.5" : "gap-3"
      } ${className}`}
    >
      <SchoolMark
        size={compact ? 34 : 42}
        quiet={compact}
      />

      <div className="min-w-0">
        <p
          className={`truncate font-medium text-white/76 ${
            compact
              ? "text-[12px]"
              : "text-[13px]"
          }`}
        >
          {identity.shortName}
        </p>
      </div>
    </div>
  );
}
