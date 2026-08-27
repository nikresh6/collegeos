"use client";

import {
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { RichNoteEditor } from "./rich-note-editor";
import { useSchoolIdentity } from "./school-identity";

const NOTE_PLACEHOLDER_PREFIX =
  "Add what you noticed";

function setNativeTextareaValue(
  textarea: HTMLTextAreaElement,
  value: string,
) {
  const setter =
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;

  if (setter) {
    setter.call(textarea, value);
  } else {
    textarea.value = value;
  }

  textarea.dispatchEvent(
    new Event("input", {
      bubbles: true,
    }),
  );
}

function notifyTextareaBlur(
  textarea: HTMLTextAreaElement,
) {
  textarea.dispatchEvent(
    new FocusEvent("focusout", {
      bubbles: true,
    }),
  );
}

export function LectureNoteEditorUpgrade() {
  const pathname = usePathname();
  const { identity } = useSchoolIdentity();
  const [
    textarea,
    setTextarea,
  ] = useState<HTMLTextAreaElement | null>(
    null,
  );
  const [
    portalHost,
    setPortalHost,
  ] = useState<HTMLDivElement | null>(
    null,
  );
  const [value, setValue] =
    useState("");
  const lastForwardedValueRef =
    useRef("");
  const lastForwardedAtRef =
    useRef(0);

  const isLectureDetail =
    /^\/lectures\/[^/]+$/.test(
      pathname,
    ) &&
    pathname !==
      "/lectures/recording";

  useEffect(() => {
    if (!isLectureDetail) {
      return;
    }

    let connectedTextarea:
      | HTMLTextAreaElement
      | null = null;
    let connectedHost:
      | HTMLDivElement
      | null = null;

    function disconnect() {
      if (connectedTextarea) {
        connectedTextarea.style.display =
          "";
        delete connectedTextarea.dataset
          .lectureRichEditor;
      }

      connectedHost?.remove();
      connectedTextarea = null;
      connectedHost = null;
      setTextarea(null);
      setPortalHost(null);
    }

    function connect() {
      const nextTextarea =
        Array.from(
          document.querySelectorAll<HTMLTextAreaElement>(
            "textarea",
          ),
        ).find((candidate) =>
          candidate.placeholder.startsWith(
            NOTE_PLACEHOLDER_PREFIX,
          ),
        ) ?? null;

      if (!nextTextarea) {
        return;
      }

      if (
        connectedTextarea === nextTextarea &&
        connectedHost?.isConnected
      ) {
        return;
      }

      disconnect();

      const host =
        document.createElement("div");
      host.className =
        "lecture-note-editor-bridge";

      nextTextarea.insertAdjacentElement(
        "afterend",
        host,
      );
      nextTextarea.style.display =
        "none";
      nextTextarea.dataset.lectureRichEditor =
        "true";

      connectedTextarea =
        nextTextarea;
      connectedHost = host;
      lastForwardedValueRef.current =
        nextTextarea.value;
      setValue(nextTextarea.value);
      setTextarea(nextTextarea);
      setPortalHost(host);
    }

    connect();

    const observer =
      new MutationObserver(connect);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    const syncTimer =
      window.setInterval(() => {
        connect();

        if (
          !connectedTextarea ||
          !connectedTextarea.isConnected
        ) {
          return;
        }

        const next =
          connectedTextarea.value;
        const recentlyForwarded =
          Date.now() -
            lastForwardedAtRef.current <
          800;

        if (
          next !==
            lastForwardedValueRef.current &&
          !recentlyForwarded
        ) {
          lastForwardedValueRef.current =
            next;
          setValue(next);
        }
      }, 300);

    return () => {
      observer.disconnect();
      window.clearInterval(syncTimer);
      disconnect();
    };
  }, [isLectureDetail]);

  if (
    !isLectureDetail ||
    !textarea ||
    !portalHost
  ) {
    return null;
  }

  return (
    <>
      {createPortal(
        <RichNoteEditor
          value={value}
          onChange={(next) => {
            setValue(next);
            lastForwardedValueRef.current =
              next;
            lastForwardedAtRef.current =
              Date.now();
            setNativeTextareaValue(
              textarea,
              next,
            );
          }}
          onBlur={() =>
            notifyTextareaBlur(
              textarea,
            )
          }
          accent={
            identity.highlight ||
            identity.primary
          }
          placeholder="Add what you noticed, what the professor emphasized, questions, examples, or shorthand you want AI to expand later."
          className="lecture-note-rich-editor"
          compact
        />,
        portalHost,
      )}

      <style>{`
        .lecture-note-editor-bridge {
          width: 100%;
        }

        .lecture-note-rich-editor {
          border-radius: 16px;
          background: rgba(0, 0, 0, 0.12);
        }

        .lecture-note-rich-editor .premium-note-toolbar {
          min-height: 40px;
          padding: 5px 8px;
        }

        .lecture-note-rich-editor .premium-note-toolbar button {
          width: 29px;
          height: 29px;
        }

        .lecture-note-rich-editor .premium-note-editor-compact {
          min-height: 280px;
          max-height: 390px;
          overflow-y: auto;
          padding: 16px 18px 30px;
          background-size: 100% 26px;
          color: rgba(255, 255, 255, 0.58);
          font-size: 12px;
          line-height: 26px;
        }

        .lecture-note-rich-editor .premium-note-editor h2 {
          margin-top: 14px;
          font-size: 17px;
          line-height: 24px;
        }

        .lecture-note-rich-editor .premium-note-editor p,
        .lecture-note-rich-editor .premium-note-editor div,
        .lecture-note-rich-editor .premium-note-editor ul,
        .lecture-note-rich-editor .premium-note-editor ol,
        .lecture-note-rich-editor .premium-note-editor blockquote,
        .lecture-note-rich-editor .premium-note-editor pre {
          margin-bottom: 7px;
        }
      `}</style>
    </>
  );
}
