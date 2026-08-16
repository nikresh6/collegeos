"use client";

import { noteContentIsHtml } from "./note-content";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeNoteHtml(value: string) {
  if (!noteContentIsHtml(value)) {
    return value
      .split(/\n/)
      .map((line) => `<p>${escapeHtml(line) || "<br>"}</p>`)
      .join("");
  }

  const parser = new DOMParser();
  const document = parser.parseFromString(`<main>${value}</main>`, "text/html");
  document.querySelectorAll("script, style, iframe, object, embed, form").forEach((element) => element.remove());
  document.querySelectorAll("*").forEach((element) => {
    Array.from(element.attributes).forEach((attribute) => {
      if (/^on/i.test(attribute.name)) element.removeAttribute(attribute.name);
      if (attribute.name === "href" && /^javascript:/i.test(attribute.value)) element.removeAttribute(attribute.name);
    });
  });
  return document.querySelector("main")?.innerHTML ?? "";
}

export function printNote({
  title,
  content,
  course,
  updatedAt,
  accent,
}: {
  title: string;
  content: string;
  course?: string;
  updatedAt?: string;
  accent: string;
}) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  Object.assign(frame.style, {
    position: "fixed",
    right: "0",
    bottom: "0",
    width: "0",
    height: "0",
    border: "0",
    opacity: "0",
  });
  document.body.appendChild(frame);
  const printDocument = frame.contentDocument;
  const printWindow = frame.contentWindow;
  if (!printDocument || !printWindow) {
    frame.remove();
    return;
  }

  const date = updatedAt
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(updatedAt))
    : "";
  printDocument.open();
  printDocument.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title || "Notebook")}</title><style>
    @page { size: auto; margin: .65in; }
    * { box-sizing: border-box; }
    html, body { margin: 0; background: #fff; color: #171717; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; }
    header { border-bottom: 2px solid ${escapeHtml(accent)}; padding-bottom: 22px; margin-bottom: 28px; }
    .eyebrow { color: #666; font-size: 10px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
    h1 { margin: 9px 0 0; color: #111; font-size: 30px; line-height: 1.08; letter-spacing: -.035em; }
    .meta { margin-top: 10px; color: #777; font-size: 10px; }
    article { color: #202020; font-size: 12px; line-height: 1.72; }
    article, article * { color: #202020 !important; opacity: 1 !important; filter: none !important; text-shadow: none !important; }
    article h1, article h2, article h3 { margin: 24px 0 9px; color: #111; break-after: avoid-page; }
    article h2 { font-size: 20px; }
    article p, article div, article ul, article ol, article blockquote, article pre { margin: 0 0 10px; }
    article li, article p { orphans: 3; widows: 3; }
    article blockquote { border-left: 3px solid ${escapeHtml(accent)}; margin-left: 0; padding-left: 14px; color: #555; }
    article pre { white-space: pre-wrap; border: 1px solid #ddd; border-radius: 8px; background: #f6f6f6; padding: 10px 12px; font-family: ui-monospace, monospace; }
    article mark, article [style*="background-color"] { background: #fff0a8 !important; color: #171717 !important; }
    article a { color: #174ea6; }
    [data-note-check] { display: flex; gap: 8px; }
    [data-note-checkbox] { color: #333; }
    [data-note-check="true"] > span:last-child { color: #777; text-decoration: line-through; }
  </style></head><body><header><div class="eyebrow">${escapeHtml(course || "CollegeOS Notebook")}</div><h1>${escapeHtml(title || "Untitled note")}</h1>${date ? `<div class="meta">Updated ${escapeHtml(date)}</div>` : ""}</header><article>${safeNoteHtml(content)}</article></body></html>`);
  printDocument.close();

  const cleanup = () => window.setTimeout(() => frame.remove(), 250);
  printWindow.addEventListener("afterprint", cleanup, { once: true });
  window.setTimeout(() => {
    printWindow.focus();
    printWindow.print();
    window.setTimeout(cleanup, 2000);
  }, 180);
}
