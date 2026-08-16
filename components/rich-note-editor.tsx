"use client";

import {
  type ClipboardEvent,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Bold,
  Code2,
  Heading2,
  Highlighter,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Quote,
  Redo2,
  RemoveFormatting,
  Underline,
  Undo2,
} from "lucide-react";
import { noteContentIsHtml } from "../lib/note-content";

const TOOLBAR_ACTIONS = [
  { id: "heading", label: "Heading", Icon: Heading2 },
  { id: "bold", label: "Bold", Icon: Bold },
  { id: "italic", label: "Italic", Icon: Italic },
  { id: "underline", label: "Underline", Icon: Underline },
  { id: "highlight", label: "Highlight", Icon: Highlighter },
  { id: "bullet", label: "Bullets", Icon: List },
  { id: "ordered", label: "Numbered list", Icon: ListOrdered },
  { id: "check", label: "Checklist", Icon: ListChecks },
  { id: "quote", label: "Quote", Icon: Quote },
  { id: "code", label: "Code block", Icon: Code2 },
  { id: "link", label: "Link", Icon: Link2 },
  { id: "clear", label: "Clear formatting", Icon: RemoveFormatting },
] as const;

type RichNoteEditorProps = {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  accent: string;
  placeholder?: string;
  className?: string;
  compact?: boolean;
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function legacyTextToHtml(value: string) {
  if (!value.trim()) return "";
  return value
    .split(/\n/)
    .map((line) => {
      const clean = escapeHtml(line);
      if (/^##\s+/.test(line)) return `<h2>${clean.replace(/^##\s+/, "")}</h2>`;
      if (/^>\s+/.test(line)) return `<blockquote>${clean.replace(/^&gt;\s+/, "")}</blockquote>`;
      if (/^- \[ \]\s+/.test(line)) {
        return `<div data-note-check="false"><span data-note-checkbox="true" contenteditable="false">○</span><span>${clean.replace(/^- \[ \]\s+/, "")}</span></div>`;
      }
      if (/^-\s+/.test(line)) return `<ul><li>${clean.replace(/^-\s+/, "")}</li></ul>`;
      return line.trim() ? `<p>${clean}</p>` : "<p><br></p>";
    })
    .join("")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/==([^=]+)==/g, "<mark>$1</mark>");
}

function normalizeInitialValue(value: string) {
  return noteContentIsHtml(value) ? value : legacyTextToHtml(value);
}

function translucentHighlight(color: string) {
  const hex = color.trim().replace(/^#/, "");
  const expanded = hex.length === 3
    ? hex.split("").map((character) => character + character).join("")
    : hex;
  if (!/^[0-9a-f]{6}$/i.test(expanded)) return "rgba(255, 224, 92, .34)";
  const red = Number.parseInt(expanded.slice(0, 2), 16);
  const green = Number.parseInt(expanded.slice(2, 4), 16);
  const blue = Number.parseInt(expanded.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, .34)`;
}

export function RichNoteEditor({
  value,
  onChange,
  onBlur,
  accent,
  placeholder = "Start writing…",
  className = "",
  compact = false,
}: RichNoteEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const lastEmittedRef = useRef(value);
  const savedRangeRef = useRef<Range | null>(null);
  const [active, setActive] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || value === lastEmittedRef.current) return;
    editor.innerHTML = normalizeInitialValue(value);
    lastEmittedRef.current = value;
  }, [value]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.innerHTML = normalizeInitialValue(value);
    lastEmittedRef.current = value;
    // The value is intentionally initialized once; subsequent external note
    // switches are handled by the value effect above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function emit() {
    const editor = editorRef.current;
    if (!editor) return;
    const next = editor.innerHTML === "<br>" ? "" : editor.innerHTML;
    lastEmittedRef.current = next;
    onChange(next);
  }

  function rememberSelection() {
    const selection = window.getSelection();
    if (!selection?.rangeCount || !editorRef.current?.contains(selection.anchorNode)) return;
    savedRangeRef.current = selection.getRangeAt(0).cloneRange();
  }

  function restoreSelection() {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const selection = window.getSelection();
    if (selection && savedRangeRef.current) {
      selection.removeAllRanges();
      selection.addRange(savedRangeRef.current);
    }
  }

  function updateActive() {
    setActive({
      bold: document.queryCommandState("bold"),
      italic: document.queryCommandState("italic"),
      underline: document.queryCommandState("underline"),
      bullet: document.queryCommandState("insertUnorderedList"),
      ordered: document.queryCommandState("insertOrderedList"),
    });
    rememberSelection();
  }

  function run(command: string, argument?: string) {
    restoreSelection();
    document.execCommand(command, false, argument);
    emit();
    updateActive();
  }

  function insertChecklist() {
    restoreSelection();
    document.execCommand(
      "insertHTML",
      false,
      '<div data-note-check="false"><span data-note-checkbox="true" contenteditable="false">○</span><span>Action item</span></div><p><br></p>',
    );
    emit();
  }

  function addLink() {
    restoreSelection();
    const selection = window.getSelection();
    const selectedText = selection?.toString().trim() ?? "";
    const href = window.prompt("Paste a link");
    if (!href) return;
    const safeHref = /^https?:\/\//i.test(href) ? href : `https://${href}`;
    if (selectedText) {
      document.execCommand("createLink", false, safeHref);
    } else {
      document.execCommand(
        "insertHTML",
        false,
        `<a href="${escapeHtml(safeHref)}" target="_blank" rel="noreferrer">${escapeHtml(href)}</a>`,
      );
    }
    emit();
  }

  function handleEditorClick(event: ReactMouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    const checkbox = target.closest<HTMLElement>("[data-note-checkbox]");
    if (!checkbox) return;
    const row = checkbox.closest<HTMLElement>("[data-note-check]");
    if (!row) return;
    const checked = row.dataset.noteCheck === "true";
    row.dataset.noteCheck = String(!checked);
    checkbox.textContent = checked ? "○" : "✓";
    emit();
  }

  function pastePlainText(event: ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    const text = event.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, text);
  }

  function handleToolbarAction(id: (typeof TOOLBAR_ACTIONS)[number]["id"]) {
    if (id === "heading") return run("formatBlock", "h2");
    if (id === "bold") return run("bold");
    if (id === "italic") return run("italic");
    if (id === "underline") return run("underline");
    if (id === "highlight") return run("hiliteColor", translucentHighlight(accent));
    if (id === "bullet") return run("insertUnorderedList");
    if (id === "ordered") return run("insertOrderedList");
    if (id === "check") return insertChecklist();
    if (id === "quote") return run("formatBlock", "blockquote");
    if (id === "code") return run("formatBlock", "pre");
    if (id === "link") return addLink();
    return run("removeFormat");
  }

  return (
    <div className={`premium-note-shell ${className}`} style={{ "--note-accent": accent } as CSSProperties}>
      <div className="premium-note-toolbar" role="toolbar" aria-label="Note formatting">
        {TOOLBAR_ACTIONS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            title={label}
            aria-label={label}
            aria-pressed={active[id] || undefined}
            onMouseDown={(event) => {
              event.preventDefault();
              handleToolbarAction(id);
            }}
            className={active[id] ? "is-active" : ""}
          >
            <Icon size={compact ? 12 : 13} />
          </button>
        ))}
        <span className="premium-note-toolbar-divider" />
        <button type="button" title="Undo" aria-label="Undo" onMouseDown={(event) => { event.preventDefault(); run("undo"); }}><Undo2 size={compact ? 12 : 13} /></button>
        <button type="button" title="Redo" aria-label="Redo" onMouseDown={(event) => { event.preventDefault(); run("redo"); }}><Redo2 size={compact ? 12 : 13} /></button>
      </div>
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        data-placeholder={placeholder}
        className={`premium-note-editor ${compact ? "premium-note-editor-compact" : ""}`}
        onInput={emit}
        onBlur={() => { emit(); onBlur?.(); }}
        onKeyUp={updateActive}
        onMouseUp={updateActive}
        onClick={handleEditorClick}
        onPaste={pastePlainText}
        spellCheck
      />
    </div>
  );
}
