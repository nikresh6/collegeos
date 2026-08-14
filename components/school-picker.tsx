"use client";

import {
  AnimatePresence,
  motion,
} from "framer-motion";
import {
  Check,
  ChevronDown,
  Search,
} from "lucide-react";
import {
  useMemo,
  useState,
} from "react";

export type SchoolPickerSchool = {
  id: string;
  name: string;
  short_name: string | null;
  aliases?: string[];
  primary_color: string;
  secondary_color: string;
  brand_colors?: string[];
  sort_priority?: number;
};

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function searchSchools(
  schools: SchoolPickerSchool[],
  query: string,
) {
  const clean = normalize(query);

  if (!clean) {
    return [...schools]
      .sort(
        (a, b) =>
          (a.sort_priority ?? 9999) -
            (b.sort_priority ?? 9999) ||
          a.name.localeCompare(b.name),
      )
      .slice(0, 12);
  }

  const tokens = clean
    .split(/\s+/)
    .filter((token) => token.length >= 1);

  return schools
    .map((school) => {
      const fields = [
        school.name,
        school.short_name ?? "",
        ...(school.aliases ?? []),
      ].map(normalize);

      const exact =
        fields.some(
          (field) => field === clean,
        );

      const starts =
        fields.some(
          (field) => field.startsWith(clean),
        );

      const everyTokenMatches =
        tokens.every((token) =>
          fields.some(
            (field) =>
              field.includes(token) ||
              token.includes(field),
          ),
        );

      return {
        school,
        matches:
          exact ||
          starts ||
          everyTokenMatches,
        score:
          (exact ? 100000 : 0) +
          (starts ? 10000 : 0) -
          (school.sort_priority ?? 9999),
      };
    })
    .filter((item) => item.matches)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map((item) => item.school);
}

export function SchoolPicker({
  schools,
  selectedSchoolId,
  onSelect,
  label = "University",
}: {
  schools: SchoolPickerSchool[];
  selectedSchoolId: string;
  onSelect: (school: SchoolPickerSchool) => void;
  label?: string;
}) {
  const selectedSchool =
    schools.find(
      (school) =>
        school.id === selectedSchoolId,
    ) ?? null;

  const [query, setQuery] = useState(
    selectedSchool?.name ?? "",
  );
  const [open, setOpen] = useState(false);

  const results = useMemo(
    () => searchSchools(schools, query),
    [schools, query],
  );

  function choose(
    school: SchoolPickerSchool,
  ) {
    onSelect(school);
    setQuery(school.name);
    setOpen(false);
  }

  return (
    <div>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/36">
        {label}
      </p>

      <div className="relative">
        <div
          className={`relative rounded-[18px] border bg-[#101012] transition ${
            open
              ? "border-white/[0.14]"
              : "border-white/[0.075]"
          }`}
        >
          <Search
            size={16}
            className="absolute left-4 top-1/2 -translate-y-1/2 text-white/34"
          />

          <input
            value={query}
            onFocus={() => setOpen(true)}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            placeholder="Search universities"
            className="w-full bg-transparent py-4 pl-11 pr-11 text-[13px] text-white/82 outline-none placeholder:text-white/28"
          />

          <ChevronDown
            size={15}
            className={`absolute right-4 top-1/2 -translate-y-1/2 text-white/30 transition ${
              open ? "rotate-180" : ""
            }`}
          />
        </div>

        <AnimatePresence>
          {open && (
            <motion.div
              initial={{
                opacity: 0,
                y: -6,
                scale: 0.99,
              }}
              animate={{
                opacity: 1,
                y: 0,
                scale: 1,
              }}
              exit={{
                opacity: 0,
                y: -5,
                scale: 0.99,
              }}
              transition={{
                duration: 0.2,
                ease: [0.22, 1, 0.36, 1],
              }}
              className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 max-h-[390px] overflow-y-auto rounded-[22px] border border-white/[0.08] bg-[#121214]/98 p-2 shadow-[0_30px_100px_rgba(0,0,0,0.55)] backdrop-blur-2xl"
            >
              {results.length > 0 ? (
                results.map((school) => {
                  const selected =
                    school.id ===
                    selectedSchoolId;

                  return (
                    <button
                      key={school.id}
                      type="button"
                      onClick={() =>
                        choose(school)
                      }
                      className="group flex w-full items-center gap-3 rounded-[15px] px-3 py-3 text-left transition hover:bg-white/[0.045]"
                    >
                      <div
                        className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[12px] border text-[12px] font-semibold"
                        style={{
                          borderColor: `${school.primary_color}45`,
                          backgroundColor: `${school.primary_color}12`,
                          color:
                            school.primary_color,
                        }}
                      >
                        {(
                          school.short_name ||
                          school.name
                        )
                          .charAt(0)
                          .toUpperCase()}
                      </div>

                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-white/76">
                          {school.name}
                        </p>

                        <div className="mt-1 flex items-center gap-2">
                          <span
                            className="h-1.5 w-1.5 rounded-full"
                            style={{
                              backgroundColor:
                                school.primary_color,
                            }}
                          />
                          <span className="truncate text-[11px] text-white/34">
                            {school.short_name ||
                              "University"}
                          </span>
                        </div>
                      </div>

                      {selected && (
                        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-black">
                          <Check size={12} />
                        </div>
                      )}
                    </button>
                  );
                })
              ) : (
                <div className="px-4 py-8 text-center">
                  <p className="text-[12px] text-white/42">
                    No matching university.
                  </p>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}