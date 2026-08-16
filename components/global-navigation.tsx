"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { BookOpen, CalendarDays, FileQuestion, GraduationCap, Home, LibraryBig, Mic2, MoreHorizontal, Sparkles, TrendingUp, X } from "lucide-react";
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
    if (pathname === "/" || pathname.startsWith("/onboarding")) return;
    void supabase.from("student_progress").select("xp").maybeSingle().then(({ data }) => setXp(Number(data?.xp ?? 0)));
  }, [pathname]);

  if (pathname === "/" || pathname.startsWith("/onboarding")) return null;

  const navigate = (href: string) => { setOpen(false); router.push(href); };
  return <>
    <nav aria-label="Primary navigation" className="fixed inset-x-3 bottom-3 z-[70] mx-auto flex max-w-[560px] items-center rounded-[22px] border border-white/[.09] bg-[#0C0C0E]/94 p-1.5 shadow-[0_18px_70px_rgba(0,0,0,.55)] backdrop-blur-2xl" style={{ paddingBottom: "max(6px, env(safe-area-inset-bottom))" }}>
      {primary.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return <button key={href} type="button" onClick={() => navigate(href)} className={`relative flex min-w-0 flex-1 flex-col items-center gap-1 rounded-[16px] px-2 py-2 text-[8px] transition ${active ? "text-white" : "text-white/32 hover:text-white/62"}`}>
          {active && <motion.span layoutId="global-nav-active" className="absolute inset-0 rounded-[16px] bg-white/[.06]" />}
          <Icon size={14} className="relative" style={active ? { color: identity.primary } : undefined} /><span className="relative truncate">{label}</span>
        </button>;
      })}
      <button type="button" onClick={() => setOpen(true)} className={`relative flex min-w-0 flex-1 flex-col items-center gap-1 rounded-[16px] px-2 py-2 text-[8px] transition ${open || secondary.some((item) => pathname.startsWith(item.href)) ? "text-white" : "text-white/32 hover:text-white/62"}`}><MoreHorizontal size={14} /><span>More</span></button>
      <div className="hidden items-center gap-1.5 border-l border-white/[.07] pl-3 pr-2 sm:flex"><GraduationCap size={12} style={{ color: identity.primary }} /><span className="whitespace-nowrap text-[8px] text-white/34">L{Math.floor(xp / 250) + 1}</span></div>
    </nav>

    <AnimatePresence>{open && <motion.div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/65 p-3 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)}>
      <motion.div className="mb-20 w-full max-w-[560px] rounded-[26px] border border-white/[.09] bg-[#111113] p-4 shadow-2xl" initial={{ opacity: 0, y: 25 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 25 }} onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between px-2 pb-3"><div><p className="text-[9px] font-semibold uppercase tracking-[.14em] text-white/27">Your workspace</p><p className="mt-1 text-[10px] text-white/19">Everything follows the same learning loop.</p></div><button onClick={() => setOpen(false)} className="h-8 w-8 rounded-full border border-white/[.07] text-white/35"><X size={12} className="mx-auto" /></button></div>
        <div className="grid gap-2 sm:grid-cols-2">{secondary.map(({ href, label, detail, icon: Icon }) => <button key={href} onClick={() => navigate(href)} className="flex items-center gap-3 rounded-[18px] border border-white/[.06] bg-white/[.012] p-4 text-left transition hover:border-white/[.11] hover:bg-white/[.035]"><span className="flex h-10 w-10 items-center justify-center rounded-[14px]" style={{ color: identity.primary, backgroundColor: `${identity.primary}12` }}><Icon size={15} /></span><span><span className="block text-[11px] font-medium text-white/62">{label}</span><span className="mt-1 block text-[8px] text-white/22">{detail}</span></span></button>)}</div>
      </motion.div>
    </motion.div>}</AnimatePresence>
  </>;
}
