"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
// KaTeX ships the auto-render helper as JavaScript without a package-level
// declaration in some install layouts, so keep the import intentionally loose.
// @ts-ignore
import renderMathInElement from "katex/contrib/auto-render";

const MATH_OPTIONS = {
  delimiters: [
    { left: "\\[", right: "\\]", display: true },
    { left: "$$", right: "$$", display: true },
    { left: "\\(", right: "\\)", display: false },
  ],
  throwOnError: false,
  strict: "ignore",
  ignoredTags: [
    "script",
    "noscript",
    "style",
    "textarea",
    "pre",
    "code",
    "option",
  ],
  ignoredClasses: [
    "katex",
    "katex-display",
    "premium-note-editor",
  ],
} as const;

function renderAcademicMath(root: HTMLElement) {
  try {
    renderMathInElement(root, MATH_OPTIONS);
  } catch (error) {
    console.warn("Could not typeset academic math:", error);
  }
}

export function AcademicMathRenderer() {
  const pathname = usePathname();

  useEffect(() => {
    let animationFrame = 0;
    let observer: MutationObserver | null = null;

    const render = () => {
      animationFrame = 0;

      if (!document.body) return;

      observer?.disconnect();
      renderAcademicMath(document.body);
      observer?.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    };

    const scheduleRender = () => {
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
      }

      animationFrame = window.requestAnimationFrame(render);
    };

    observer = new MutationObserver(scheduleRender);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    scheduleRender();

    return () => {
      observer?.disconnect();
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
      }
    };
  }, [pathname]);

  return null;
}
