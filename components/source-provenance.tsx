"use client";

import {
  useEffect,
  useState,
} from "react";
import {
  ChevronRight,
  FileText,
  Headphones,
  Link2,
  Loader2,
  NotebookPen,
} from "lucide-react";
import {
  useRouter,
} from "next/navigation";
import { supabase } from "../lib/supabase";

type ArtifactKind =
  | "study_guide"
  | "study_question"
  | "material_analysis"
  | "lecture_analysis"
  | "note_enhancement"
  | "attention";

type SourceLink = {
  id?: string;
  sourceKind:
    | "lecture"
    | "note"
    | "material"
    | "topic"
    | "calendar";
  sourceId: string | null;
  sourceLabel: string;
  locator: Record<
    string,
    unknown
  >;
  excerpt: string | null;
  href: string | null;
};

export function SourceProvenance({
  artifactKind,
  artifactId,
  compact = false,
}: {
  artifactKind: ArtifactKind;
  artifactId: string;
  compact?: boolean;
}) {
  const router =
    useRouter();

  const [
    links,
    setLinks,
  ] =
    useState<SourceLink[]>(
      [],
    );

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    open,
    setOpen,
  ] =
    useState(!compact);

  useEffect(() => {
    let cancelled =
      false;

    async function load() {
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
          return;
        }

        const response =
          await fetch(
            `/api/intelligence/provenance?kind=${encodeURIComponent(
              artifactKind,
            )}&id=${encodeURIComponent(
              artifactId,
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
            links?: SourceLink[];
          };

        if (
          !cancelled
        ) {
          setLinks(
            payload.links ??
              [],
          );
        }
      } finally {
        if (
          !cancelled
        ) {
          setLoading(
            false,
          );
        }
      }
    }

    void load();

    return () => {
      cancelled =
        true;
    };
  }, [
    artifactId,
    artifactKind,
  ]);

  if (
    !loading &&
    links.length ===
      0
  ) {
    return null;
  }

  return (
    <section className="rounded-[18px] border border-white/[0.05] bg-white/[0.008]">
      <button
        type="button"
        onClick={() =>
          setOpen(
            (current) =>
              !current,
          )
        }
        className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left"
      >
        <div className="flex items-center gap-2.5">
          <Link2
            size={10}
            className="text-white/24"
          />
          <div>
            <p className="text-[8px] font-semibold uppercase tracking-[0.12em] text-white/24">
              Sources
            </p>
            <p className="mt-0.5 text-[8px] text-white/15">
              {loading
                ? "Tracing where this came from"
                : `${links.length} connected source${links.length === 1 ? "" : "s"}`}
            </p>
          </div>
        </div>

        {loading ? (
          <Loader2
            size={9}
            className="animate-spin text-white/16"
          />
        ) : (
          <ChevronRight
            size={9}
            className={`text-white/16 transition ${
              open
                ? "rotate-90"
                : ""
            }`}
          />
        )}
      </button>

      {open &&
        !loading && (
          <div className="border-t border-white/[0.04] p-2">
            {links.map(
              (
                link,
                index,
              ) => {
                const Icon =
                  link.sourceKind ===
                  "lecture"
                    ? Headphones
                    : link.sourceKind ===
                        "note"
                      ? NotebookPen
                      : FileText;

                return (
                  <button
                    key={
                      link.id ??
                      `${link.sourceKind}:${link.sourceId}:${index}`
                    }
                    type="button"
                    disabled={
                      !link.href
                    }
                    onClick={() => {
                      if (
                        link.href
                      ) {
                        router.push(
                          link.href,
                        );
                      }
                    }}
                    className="group flex w-full items-start gap-3 rounded-[13px] px-3 py-3 text-left transition hover:bg-white/[0.02] disabled:cursor-default"
                  >
                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] bg-white/[0.025] text-white/22">
                      <Icon
                        size={9}
                      />
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[9px] font-medium text-white/39">
                        {
                          link.sourceLabel
                        }
                      </p>

                      {link.excerpt && (
                        <p className="mt-1 line-clamp-2 text-[7px] leading-4 text-white/15">
                          {
                            link.excerpt
                          }
                        </p>
                      )}
                    </div>

                    {link.href && (
                      <ChevronRight
                        size={8}
                        className="mt-1 text-white/9 transition group-hover:text-white/28"
                      />
                    )}
                  </button>
                );
              },
            )}
          </div>
        )}
    </section>
  );
}