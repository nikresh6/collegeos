"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { BookOpen, BrainCircuit, CalendarDays, FileQuestion, GraduationCap, Home, LibraryBig, Mic2, MoreHorizontal, Sparkles, TrendingUp, X } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useSchoolIdentity } from "./school-identity";

const primary = [
  { href: "/", label: "Home", icon: Home },
  { href: "/calendar", label: "Plan", icon: CalendarDays },
  { href: "/study", label: "Study", icon: Sparkles },
  { href: "/notes", label: "Notebook", icon: LibraryBig },
] as const;

const secondary = [
  { href: "/courses", label: "Courses", detail: "Classes, units, materials", icon: BookOpen },
  { href: "/lectures", label: "Lectures", detail: "Recordings and analysis", icon: Mic2 },
  { href: "/grades", label: "Grades", detail: "Gradebook and projections", icon: TrendingUp },
  { href: "/assessment-lab", label: "Exam Intelligence", detail: "Teach AI how professors test", icon: FileQuestion },
] as const;

export function GlobalNavigation() {
  const pathname = usePathname();
  const router = useRouter();
  const { identity } = useSchoolIdentity();
  const [open, setOpen] = useState(false);
  const [xp, setXp] = useState(0);

  useEffect(() => {
    if (pathname === "/" || pathname.startsWith("/onboarding") || pathname.startsWith("/lectures/recording") || pathname.startsWith("/study/session") || pathname.endsWith("/setup")) return;
    void supabase.from("student_progress").select("xp").maybeSingle().then(({ data }) => setXp(Number(data?.xp ?? 0)));
  }, [pathname]);

  if (pathname.startsWith("/onboarding") || pathname.startsWith("/lectures/recording") || pathname.startsWith("/study/session") || pathname.endsWith("/setup")) return null;

  const navigate = (href: string) => { setOpen(false); router.push(href); };
  const openSolver = () => {
    setOpen(false);
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("collegeos:open-solver"));
    }, 80);
  };
  const secondaryActive = secondary.some((item) => pathname.startsWith(item.href));

  return <>
    <nav aria-label="Primary navigation" className="fixed inset-x-0 bottom-0 z-[70] border-t border-white/[.07] bg-[#0A0A0C]/94 px-2 pt-1.5 shadow-[0_-14px_45px_rgba(0,0,0,.34)] backdrop-blur-2xl lg:hidden" style={{ paddingBottom: "max(6px, env(safe-area-inset-bottom))" }}>
      <div className="mx-auto flex max-w-[520px] items-center">
        {primary.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return <button key={href} type="button" onClick={() => navigate(href)} aria-current={active ? "page" : undefined} className={`relative flex min-h-[50px] min-w-0 flex-1 flex-col items-center justify-center gap-1 text-[8px] font-medium transition ${active ? "text-white/78" : "text-white/28 active:text-white/60"}`}>
            <span className={`relative flex h-7 w-10 items-center justify-center rounded-full transition ${active ? "bg-white/[.07]" : ""}`}>
              {active && <motion.span layoutId="global-nav-mobile-active" className="absolute inset-0 rounded-full ring-1 ring-white/[.04]" />}
              <Icon size={16} className="relative" style={active ? { color: identity.primary } : undefined} />
            </span>
            <span className="max-w-full truncate px-1">{label}</span>
          </button>;
        })}
        <button type="button" onClick={() => setOpen(true)} aria-expanded={open} className={`relative flex min-h-[50px] min-w-0 flex-1 flex-col items-center justify-center gap-1 text-[8px] font-medium transition ${open || secondaryActive ? "text-white/78" : "text-white/28 active:text-white/60"}`}>
          <span className={`flex h-7 w-10 items-center justify-center rounded-full ${open || secondaryActive ? "bg-white/[.07]" : ""}`}><MoreHorizontal size={16} style={open || secondaryActive ? { color: identity.primary } : undefined} /></span>
          <span>More</span>
        </button>
      </div>
    </nav>

    <nav aria-label="Desktop navigation" className={`fixed left-4 top-1/2 z-[70] hidden -translate-y-1/2 flex-col items-center gap-1 rounded-[22px] border border-white/[.08] bg-[#0C0C0E]/92 p-1.5 shadow-[0_22px_70px_rgba(0,0,0,.42)] backdrop-blur-2xl ${pathname === "/" ? "" : "lg:flex"}`}>
      <div className="mb-1 flex h-11 w-11 flex-col items-center justify-center rounded-[16px] border border-white/[.055] bg-white/[.018]" title={`${xp} XP`}>
        <GraduationCap size={14} style={{ color: identity.primary }} />
        <span className="mt-0.5 text-[7px] font-semibold text-white/30">L{Math.floor(xp / 250) + 1}</span>
      </div>
      {primary.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return <button key={href} type="button" onClick={() => navigate(href)} aria-label={label} aria-current={active ? "page" : undefined} title={label} className={`relative flex h-11 w-11 items-center justify-center rounded-[15px] transition ${active ? "bg-white/[.065] text-white" : "text-white/28 hover:bg-white/[.035] hover:text-white/64"}`}>
          {active && <motion.span layoutId="global-nav-desktop-active" className="absolute inset-y-3 -left-[7px] w-[2px] rounded-full" style={{ backgroundColor: identity.primary }} />}
          <Icon size={16} style={active ? { color: identity.primary } : undefined} />
        </button>;
      })}
      <div className="my-1 h-px w-7 bg-white/[.06]" />
      <button type="button" onClick={() => setOpen(true)} aria-label="More workspace tools" aria-expanded={open} title="More" className={`flex h-11 w-11 items-center justify-center rounded-[15px] transition ${open || secondaryActive ? "bg-white/[.065] text-white" : "text-white/28 hover:bg-white/[.035] hover:text-white/64"}`}><MoreHorizontal size={16} style={open || secondaryActive ? { color: identity.primary } : undefined} /></button>
    </nav>

    <AnimatePresence>{open && <motion.div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/68 p-0 backdrop-blur-md sm:p-4 lg:items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)}>
      <motion.div className="max-h-[calc(100svh-18px)] w-full max-w-[560px] overflow-y-auto rounded-t-[28px] border border-white/[.09] bg-[#111113] p-4 pb-[max(16px,env(safe-area-inset-bottom))] shadow-2xl sm:rounded-[28px] sm:p-5" initial={{ opacity: 0, y: 25, scale: .985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 25, scale: .985 }} onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between px-1 pb-4"><div><p className="text-[9px] font-semibold uppercase tracking-[.14em] text-white/32">Your workspace</p><p className="mt-1 text-[10px] text-white/22">The rest of your academic toolkit.</p></div><button onClick={() => setOpen(false)} aria-label="Close workspace menu" className="flex h-9 w-9 items-center justify-center rounded-full border border-white/[.07] text-white/35 transition hover:bg-white/[.035] hover:text-white/65"><X size={13} /></button></div>
        <button type="button" onClick={openSolver} className="mb-2 flex w-full items-center gap-3 rounded-[18px] border border-white/[.09] bg-white/[.035] p-3.5 text-left transition hover:border-white/[.14] hover:bg-white/[.055]"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px]" style={{ color: identity.primary, backgroundColor: `${identity.primary}14` }}><BrainCircuit size={15} /></span><span className="min-w-0 flex-1"><span className="block truncate text-[11px] font-medium text-white/72">Guided Solve</span><span className="mt-1 block text-[8px] leading-4 text-white/28">Work through any problem step by step</span></span><Sparkles size={11} style={{ color: identity.primary }} /></button>
        <div className="grid gap-2 sm:grid-cols-2">{secondary.map(({ href, label, detail, icon: Icon }) => {
          const active = pathname.startsWith(href);
          return <button key={href} onClick={() => navigate(href)} className={`flex min-h-[72px] items-center gap-3 rounded-[18px] border p-3.5 text-left transition ${active ? "border-white/[.11] bg-white/[.045]" : "border-white/[.06] bg-white/[.012] hover:border-white/[.11] hover:bg-white/[.035]"}`}><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px]" style={{ color: identity.primary, backgroundColor: `${identity.primary}12` }}><Icon size={15} /></span><span className="min-w-0"><span className="block truncate text-[11px] font-medium text-white/68">{label}</span><span className="mt-1 block text-[8px] leading-4 text-white/25">{detail}</span></span></button>;
        })}</div>
      </motion.div>
    </motion.div>}</AnimatePresence>
  </>;
}
