"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  useParams,
  useRouter,
} from "next/navigation";
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Download,
  Loader2,
  Play,
  Sparkles,
  Target,
} from "lucide-react";
import {
  MotionConfig,
  motion,
} from "framer-motion";
import { supabase } from "../../../../lib/supabase";
import {
  SourceProvenance,
} from "../../../../components/source-provenance";
import {
  useSchoolIdentity,
} from "../../../../components/school-identity";

type GuideContent = {
  title: string;
  overview: string;
  sections: Array<{
    topicId: string;
    heading: string;
    summary: string;
    keyPoints: string[];
    mustRemember: string[];
    connections: string[];
    commonConfusions: string[];
    sourceFileIds: string[];
  }>;
  quickRecall: Array<{
    topicId: string;
    question: string;
    answer: string;
  }>;
  studyPlan: string[];
};

type GuideRecord = {
  id: string;
  course_id: string;
  strategy:
    | "manual"
    | "adaptive";
  selected_topic_ids: string[];
  depth_percent: number;
  title: string;
  content: GuideContent;
  source_refs: Array<{
    fileId: string;
    fileName: string;
    materialType: string;
    topicIds: string[];
  }>;
  created_at: string;
};

type Course = {
  id: string;
  code: string;
  name: string;
  color: string;
};

type Topic = {
  id: string;
  name: string;
};

export default function StudyGuidePage() {
  const params =
    useParams();

  const router =
    useRouter();

  const {
    identity,
  } =
    useSchoolIdentity();

  const guideId =
    String(
      params.id ?? "",
    );

  const [
    guide,
    setGuide,
  ] =
    useState<GuideRecord | null>(
      null,
    );

  const [
    course,
    setCourse,
  ] =
    useState<Course | null>(
      null,
    );

  const [
    topics,
    setTopics,
  ] =
    useState<Topic[]>(
      [],
    );

  const [
    lectureByFileId,
    setLectureByFileId,
  ] =
    useState<
      Record<string, string>
    >({});

  const [
    loading,
    setLoading,
  ] =
    useState(true);

  const [
    error,
    setError,
  ] = useState("");

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
          error:
            authError,
        } =
          await supabase.auth.getSession();

        if (
          authError
        ) {
          throw authError;
        }

        if (!session) {
          router.replace(
            "/onboarding",
          );
          return;
        }

        const {
          data:
            guideData,
          error:
            guideError,
        } =
          await supabase
            .from(
              "study_guides",
            )
            .select(
              "id, course_id, strategy, selected_topic_ids, depth_percent, title, content, source_refs, created_at",
            )
            .eq(
              "id",
              guideId,
            )
            .single();

        if (
          guideError
        ) {
          throw guideError;
        }

        const sourceRefs =
          Array.isArray(
            guideData.source_refs,
          )
            ? guideData.source_refs
            : [];

        const sourceFileIds =
          Array.from(
            new Set(
              sourceRefs
                .map(
                  (source) =>
                    source &&
                    typeof source ===
                      "object" &&
                    !Array.isArray(
                      source,
                    ) &&
                    typeof (
                      source as Record<
                        string,
                        unknown
                      >
                    ).fileId ===
                      "string"
                      ? (
                          source as Record<
                            string,
                            string
                          >
                        ).fileId
                      : "",
                )
                .filter(Boolean),
            ),
          );

        const [
          {
            data:
              courseData,
            error:
              courseError,
          },
          {
            data:
              topicData,
            error:
              topicError,
          },
          {
            data:
              lectureData,
            error:
              lectureError,
          },
        ] =
          await Promise.all([
            supabase
              .from(
                "courses",
              )
              .select(
                "id, code, name, color",
              )
              .eq(
                "id",
                guideData.course_id,
              )
              .single(),

            supabase
              .from(
                "course_topics",
              )
              .select(
                "id, name",
              )
              .eq(
                "course_id",
                guideData.course_id,
              ),

            sourceFileIds.length > 0
              ? supabase
                  .from(
                    "lectures",
                  )
                  .select(
                    "id, course_file_id",
                  )
                  .in(
                    "course_file_id",
                    sourceFileIds,
                  )
              : Promise.resolve({
                  data: [],
                  error: null,
                }),
          ]);

        if (
          courseError
        ) {
          throw courseError;
        }

        if (
          topicError
        ) {
          throw topicError;
        }

        if (
          lectureError
        ) {
          throw lectureError;
        }

        if (
          cancelled
        ) {
          return;
        }

        setGuide({
          id:
            guideData.id,
          course_id:
            guideData.course_id,
          strategy:
            guideData.strategy,
          selected_topic_ids:
            Array.isArray(
              guideData.selected_topic_ids,
            )
              ? guideData.selected_topic_ids
              : [],
          depth_percent:
            Number(
              guideData.depth_percent ??
                60,
            ),
          title:
            guideData.title,
          content:
            (
              guideData.content ??
              {}
            ) as GuideContent,
          source_refs:
            sourceRefs as GuideRecord["source_refs"],
          created_at:
            guideData.created_at,
        });

        setCourse(
          courseData as Course,
        );

        setTopics(
          (
            topicData ??
            []
          ) as Topic[],
        );

        setLectureByFileId(
          Object.fromEntries(
            (
              lectureData ??
              []
            )
              .filter(
                (lecture) =>
                  Boolean(
                    lecture.course_file_id,
                  ),
              )
              .map(
                (lecture) => [
                  lecture.course_file_id,
                  lecture.id,
                ],
              ),
          ),
        );
      } catch (
        loadError
      ) {
        if (
          cancelled
        ) {
          return;
        }

        setError(
          loadError instanceof
            Error
            ? loadError.message
            : "Could not load this study guide.",
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
    }

    void load();

    return () => {
      cancelled =
        true;
    };
  }, [
    guideId,
    router,
  ]);

  const topicMap =
    useMemo(
      () =>
        new Map(
          topics.map(
            (topic) => [
              topic.id,
              topic.name,
            ],
          ),
        ),
      [topics],
    );

  const sourceMap =
    useMemo(
      () =>
        new Map(
          (
            guide
              ?.source_refs ??
            []
          ).map(
            (source) => [
              source.fileId,
              source,
            ],
          ),
        ),
      [guide],
    );

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#080809] text-white">
        <div className="flex items-center gap-2 text-[11px] text-white/32">
          <Loader2
            size={13}
            className="animate-spin"
          />
          Opening study guide
        </div>
      </main>
    );
  }

  if (
    !guide ||
    !course
  ) {
    return (
      <main className="min-h-screen bg-[#080809] px-6 py-12 text-white">
        <button
          type="button"
          onClick={() =>
            router.push(
              "/study",
            )
          }
          className="text-[10px] text-white/30"
        >
          ← Study
        </button>
        <p className="mt-8 text-[12px] text-white/44">
          {error ||
            "This study guide could not be found."}
        </p>
      </main>
    );
  }

  const content =
    guide.content;

  const accent =
    course.color ||
    identity.primary;

  return (
    <MotionConfig reducedMotion="user">
      <main
        id="study-guide-root"
        className="relative min-h-screen overflow-x-hidden bg-[#080809] text-[#F5F5F7]"
      >
        <div
          aria-hidden
          className="pointer-events-none fixed left-[16%] top-[-320px] h-[660px] w-[800px] rounded-full opacity-[0.09] blur-[145px]"
          style={{
            backgroundColor:
              accent,
          }}
        />

        <div className="relative mx-auto max-w-[1080px] px-5 pb-24 pt-6 sm:px-8 md:px-10 md:pt-10">
          <div className="study-print-hide flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() =>
                router.push(
                  "/study",
                )
              }
              className="flex items-center gap-2 rounded-full border border-white/[0.07] bg-white/[0.02] px-3.5 py-2.5 text-[10px] font-medium text-white/42 transition hover:bg-white/[0.04] hover:text-white/68"
            >
              <ArrowLeft
                size={12}
              />
              Study
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  window.print()
                }
                className="flex items-center gap-2 rounded-full border border-white/[0.06] bg-white/[0.012] px-3.5 py-2.5 text-[9px] text-white/34 transition hover:bg-white/[0.035] hover:text-white/60"
              >
                <Download
                  size={10}
                />
                Save as PDF
              </button>

              <button
                type="button"
                onClick={() =>
                  router.push(
                    `/study?course=${course.id}&topics=${guide.selected_topic_ids.join(
                      ",",
                    )}`,
                  )
                }
                className="flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-[9px] font-medium text-black"
              >
                <Play
                  size={10}
                />
                Quiz me
              </button>
            </div>
          </div>

          <header className="mt-12 border-b border-white/[0.06] pb-9">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="rounded-full px-2.5 py-1 text-[8px] font-semibold uppercase tracking-[0.1em]"
                style={{
                  backgroundColor:
                    `${accent}12`,
                  color:
                    accent,
                }}
              >
                {course.code}
              </span>

              <span className="rounded-full border border-white/[0.05] px-2.5 py-1 text-[8px] text-white/22">
                {
                  guide.depth_percent
                }
                % depth
              </span>

              <span className="rounded-full border border-white/[0.05] px-2.5 py-1 text-[8px] capitalize text-white/22">
                {
                  guide.strategy
                }
              </span>
            </div>

            <h1 className="mt-6 max-w-4xl text-[44px] font-medium leading-[0.98] tracking-[-0.058em] sm:text-[58px]">
              {content.title ||
                guide.title}
            </h1>

            <p className="mt-5 max-w-3xl text-[13px] leading-7 text-white/38">
              {
                content.overview
              }
            </p>
          </header>

          {content.studyPlan
            ?.length >
            0 && (
            <section className="mt-8 rounded-[23px] border border-white/[0.06] bg-[#101012] p-5 sm:p-6">
              <div className="flex items-center gap-3">
                <div
                  className="flex h-9 w-9 items-center justify-center rounded-[12px]"
                  style={{
                    backgroundColor:
                      `${accent}10`,
                    color:
                      accent,
                  }}
                >
                  <Target
                    size={14}
                  />
                </div>
                <div>
                  <p className="text-[8px] font-semibold uppercase tracking-[0.13em] text-white/22">
                    Study order
                  </p>
                  <p className="mt-1 text-[11px] text-white/44">
                    The shortest path through this guide.
                  </p>
                </div>
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {content.studyPlan.map(
                  (
                    step,
                    index,
                  ) => (
                    <div
                      key={`${step}-${index}`}
                      className="flex gap-3 rounded-[15px] border border-white/[0.045] bg-white/[0.007] px-4 py-3.5"
                    >
                      <span
                        className="text-[8px] font-semibold"
                        style={{
                          color:
                            accent,
                        }}
                      >
                        {String(
                          index +
                            1,
                        ).padStart(
                          2,
                          "0",
                        )}
                      </span>
                      <p className="text-[10px] leading-5 text-white/35">
                        {step}
                      </p>
                    </div>
                  ),
                )}
              </div>
            </section>
          )}

          <section className="mt-10">
            <p className="text-[8px] font-semibold uppercase tracking-[0.14em] text-white/22">
              Guide
            </p>

            <h2 className="mt-2 text-[28px] font-medium tracking-[-0.045em]">
              What you need to know.
            </h2>

            <div className="mt-5 space-y-4">
              {content.sections?.map(
                (
                  section,
                  index,
                ) => (
                  <article
                    key={`${section.topicId}-${index}`}
                    className="overflow-hidden rounded-[24px] border border-white/[0.06] bg-[#101012]"
                  >
                    <div className="border-b border-white/[0.045] px-5 py-5 sm:px-6">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p
                            className="text-[8px] font-semibold"
                            style={{
                              color:
                                accent,
                            }}
                          >
                            {topicMap.get(
                              section.topicId,
                            ) ??
                              "Course topic"}
                          </p>

                          <h3 className="mt-2 text-[21px] font-medium tracking-[-0.035em] text-white/72">
                            {
                              section.heading
                            }
                          </h3>
                        </div>

                        <span className="text-[8px] text-white/14">
                          {String(
                            index +
                              1,
                          ).padStart(
                            2,
                            "0",
                          )}
                        </span>
                      </div>

                      <p className="mt-4 max-w-3xl text-[12px] leading-6 text-white/38">
                        {
                          section.summary
                        }
                      </p>
                    </div>

                    <div className="grid gap-6 p-5 sm:p-6 md:grid-cols-2">
                      <GuideList
                        label="Key points"
                        items={
                          section.keyPoints
                        }
                        color={
                          accent
                        }
                      />

                      <GuideList
                        label="Must remember"
                        items={
                          section.mustRemember
                        }
                        color={
                          accent
                        }
                        emphasized
                      />

                      <GuideList
                        label="Connections"
                        items={
                          section.connections
                        }
                        color={
                          accent
                        }
                      />

                      <GuideList
                        label="Common confusions"
                        items={
                          section.commonConfusions
                        }
                        color={
                          accent
                        }
                      />
                    </div>

                    {section.sourceFileIds?.length > 0 && (
                      <div className="study-print-hide flex flex-wrap items-center gap-2 border-t border-white/[0.045] px-5 py-4 sm:px-6">
                        <span className="text-[7px] font-semibold uppercase tracking-[0.12em] text-white/16">
                          Sources
                        </span>

                        {section.sourceFileIds
                          .map(
                            (fileId) =>
                              sourceMap.get(
                                fileId,
                              ),
                          )
                          .filter(Boolean)
                          .slice(0, 5)
                          .map(
                            (source) => {
                              const lectureId =
                                lectureByFileId[
                                  source!.fileId
                                ];

                              const href =
                                lectureId
                                  ? `/lectures/${lectureId}`
                                  : `/courses/${course.id}?material=${source!.fileId}`;

                              return (
                                <button
                                  key={
                                    source!.fileId
                                  }
                                  type="button"
                                  onClick={() =>
                                    router.push(
                                      href,
                                    )
                                  }
                                  className="rounded-full border border-white/[0.05] bg-white/[0.007] px-2.5 py-1 text-[7px] text-white/24 transition hover:border-white/[0.08] hover:text-white/48"
                                >
                                  {
                                    source!.fileName
                                  }
                                </button>
                              );
                            },
                          )}
                      </div>
                    )}
                  </article>
                ),
              )}
            </div>
          </section>

          <section className="study-print-hide mt-6">
            <SourceProvenance
              artifactKind="study_guide"
              artifactId={
                guide.id
              }
            />
          </section>

          {content.quickRecall
            ?.length >
            0 && (
            <section className="mt-11">
              <div className="flex items-center gap-3">
                <div
                  className="flex h-9 w-9 items-center justify-center rounded-[12px]"
                  style={{
                    backgroundColor:
                      `${accent}10`,
                    color:
                      accent,
                  }}
                >
                  <Sparkles
                    size={14}
                  />
                </div>
                <div>
                  <p className="text-[8px] font-semibold uppercase tracking-[0.13em] text-white/22">
                    Quick recall
                  </p>
                  <h2 className="mt-1 text-[23px] font-medium tracking-[-0.04em]">
                    Test the guide without leaving it.
                  </h2>
                </div>
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-2">
                {content.quickRecall.map(
                  (
                    item,
                    index,
                  ) => (
                    <RecallCard
                      key={`${item.question}-${index}`}
                      item={
                        item
                      }
                      topicName={
                        topicMap.get(
                          item.topicId,
                        ) ??
                        "Course topic"
                      }
                      color={
                        accent
                      }
                    />
                  ),
                )}
              </div>
            </section>
          )}

          <section className="study-print-hide mt-11 flex flex-col gap-5 rounded-[22px] border border-white/[0.055] bg-white/[0.008] p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[8px] font-semibold uppercase tracking-[0.12em] text-white/22">
                Next move
              </p>
              <p className="mt-2 max-w-xl text-[12px] leading-6 text-white/39">
                Turn these exact topics into a mixed quiz and let the result feed back into preparedness.
              </p>
            </div>

            <button
              type="button"
              onClick={() =>
                router.push(
                  `/study?course=${course.id}&topics=${guide.selected_topic_ids.join(
                    ",",
                  )}`,
                )
              }
              className="flex shrink-0 items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-[10px] font-medium text-black"
            >
              <CheckCircle2
                size={11}
              />
              Build quiz
              <ChevronRight
                size={9}
              />
            </button>
          </section>
        </div>

        <style jsx global>{`
          @media print {
            html, body {
              background: white !important;
              color: #171717 !important;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }

            .study-print-hide {
              display: none !important;
            }

            #study-guide-root {
              background: white !important;
              color: #111 !important;
            }

            #study-guide-root * {
              color: #111 !important;
              opacity: 1 !important;
              filter: none !important;
              box-shadow: none !important;
              text-shadow: none !important;
            }

            #study-guide-root > [aria-hidden="true"] {
              display: none !important;
            }

            #study-guide-root article,
            #study-guide-root section {
              background: white !important;
              border-color: #dedede !important;
            }

            #study-guide-root h1 { font-size: 34px !important; line-height: 1.08 !important; }
            #study-guide-root h2 { font-size: 23px !important; }
            #study-guide-root h3 { font-size: 18px !important; }
            #study-guide-root p, #study-guide-root li { font-size: 11px !important; line-height: 1.6 !important; }
            #study-guide-root a { color: #174ea6 !important; text-decoration: underline !important; }

            @page {
              margin: 0.55in;
            }
          }
        `}</style>
      </main>
    </MotionConfig>
  );
}

function GuideList({
  label,
  items,
  color,
  emphasized = false,
}: {
  label: string;
  items: string[];
  color: string;
  emphasized?: boolean;
}) {
  if (
    !items ||
    items.length === 0
  ) {
    return null;
  }

  return (
    <div>
      <p className="text-[8px] font-semibold uppercase tracking-[0.12em] text-white/20">
        {label}
      </p>

      <ul className="mt-3 space-y-2.5">
        {items.map(
          (item) => (
            <li
              key={
                item
              }
              className={`flex gap-3 text-[10px] leading-5 ${
                emphasized
                  ? "text-white/52"
                  : "text-white/34"
              }`}
            >
              <span
                className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full"
                style={{
                  backgroundColor:
                    color,
                }}
              />
              {item}
            </li>
          ),
        )}
      </ul>
    </div>
  );
}

function RecallCard({
  item,
  topicName,
  color,
}: {
  item: {
    question: string;
    answer: string;
  };
  topicName: string;
  color: string;
}) {
  const [
    revealed,
    setRevealed,
  ] = useState(false);

  return (
    <button
      type="button"
      onClick={() =>
        setRevealed(
          (current) =>
            !current,
        )
      }
      className="rounded-[19px] border border-white/[0.055] bg-[#101012] p-5 text-left transition hover:border-white/[0.09]"
    >
      <p
        className="text-[8px] font-semibold"
        style={{
          color,
        }}
      >
        {topicName}
      </p>

      <p className="mt-2 text-[12px] leading-6 text-white/52">
        {
          item.question
        }
      </p>

      {revealed ? (
        <motion.div
          initial={{
            opacity: 0,
            y: 3,
          }}
          animate={{
            opacity: 1,
            y: 0,
          }}
          className="mt-4 border-t border-white/[0.045] pt-4"
        >
          <p className="text-[10px] leading-5 text-white/36">
            {
              item.answer
            }
          </p>
        </motion.div>
      ) : (
        <p className="mt-4 text-[8px] text-white/17">
          Tap to reveal
        </p>
      )}
    </button>
  );
}
