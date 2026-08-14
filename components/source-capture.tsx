"use client";

import {
  Camera,
  FileText,
  Image as ImageIcon,
  Upload,
  X,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
} from "react";

function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function SourceCapturePicker({
  file,
  onFileSelected,
  onClear,
  accentColor,
  accept,
  title = "Add a source",
  description = "Upload a file or take a photo.",
  uploadLabel = "Upload file",
  cameraLabel = "Take photo",
  allowCamera = true,
}: {
  file: File | null;
  onFileSelected: (file: File) => void;
  onClear?: () => void;
  accentColor: string;
  accept: string;
  title?: string;
  description?: string;
  uploadLabel?: string;
  cameraLabel?: string;
  allowCamera?: boolean;
}) {
  const uploadRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] =
    useState<string | null>(null);

  const isImage = Boolean(
    file?.type?.startsWith("image/"),
  );

  useEffect(() => {
    if (!file || !isImage) {
      setPreviewUrl(null);
      return;
    }

    const nextUrl = URL.createObjectURL(file);
    setPreviewUrl(nextUrl);

    return () => {
      URL.revokeObjectURL(nextUrl);
    };
  }, [file, isImage]);

  function selectFile(nextFile: File | null) {
    if (!nextFile) return;
    onFileSelected(nextFile);
  }

  return (
    <div className="rounded-[22px] border border-white/[0.07] bg-white/[0.012] p-4 sm:p-5">
      <input
        ref={uploadRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(event) => {
          selectFile(event.target.files?.[0] ?? null);
          event.target.value = "";
        }}
      />

      {allowCamera && (
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(event) => {
            selectFile(event.target.files?.[0] ?? null);
            event.target.value = "";
          }}
        />
      )}

      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[13px] font-medium text-white/76">
            {title}
          </p>
          <p className="mt-1 text-[11px] leading-5 text-white/38">
            {description}
          </p>
        </div>

        {file && (
          <button
            type="button"
            onClick={onClear}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/[0.06] bg-white/[0.02] text-white/34 transition hover:bg-white/[0.05] hover:text-white/70"
            aria-label="Clear selected file"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {file ? (
        <div className="mt-4 overflow-hidden rounded-[18px] border border-white/[0.06] bg-[#0B0B0D]">
          {isImage && previewUrl ? (
            <div className="relative h-[190px] overflow-hidden border-b border-white/[0.055] bg-black/20 sm:h-[220px]">
              <img
                src={previewUrl}
                alt="Selected source preview"
                className="h-full w-full object-cover"
              />
              <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/60 to-transparent" />
            </div>
          ) : null}

          <div className="flex items-center gap-3 p-4">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px]"
              style={{
                backgroundColor: `${accentColor}12`,
                color: accentColor,
              }}
            >
              {isImage ? (
                <ImageIcon size={16} />
              ) : (
                <FileText size={16} />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-medium text-white/72">
                {file.name}
              </p>
              <p className="mt-1 text-[10px] text-white/34">
                {isImage ? "Photo" : "Document"} ·{" "}
                {formatFileSize(file.size)}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div
          className={`mt-4 grid gap-2 ${
            allowCamera
              ? "sm:grid-cols-2"
              : "grid-cols-1"
          }`}
        >
          <button
            type="button"
            onClick={() => uploadRef.current?.click()}
            className="group flex items-center gap-3 rounded-[17px] border border-white/[0.07] bg-[#0B0B0D] px-4 py-4 text-left transition hover:border-white/[0.12] hover:bg-white/[0.025]"
          >
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px]"
              style={{
                backgroundColor: `${accentColor}12`,
                color: accentColor,
              }}
            >
              <Upload size={16} />
            </div>

            <div>
              <p className="text-[12px] font-medium text-white/68">
                {uploadLabel}
              </p>
              <p className="mt-1 text-[10px] text-white/30">
                Choose from your device
              </p>
            </div>
          </button>

          {allowCamera && (
            <button
              type="button"
              onClick={() => cameraRef.current?.click()}
              className="group flex items-center gap-3 rounded-[17px] border border-white/[0.07] bg-[#0B0B0D] px-4 py-4 text-left transition hover:border-white/[0.12] hover:bg-white/[0.025]"
            >
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px]"
                style={{
                  backgroundColor: `${accentColor}12`,
                  color: accentColor,
                }}
              >
                <Camera size={16} />
              </div>

              <div>
                <p className="text-[12px] font-medium text-white/68">
                  {cameraLabel}
                </p>
                <p className="mt-1 text-[10px] text-white/30">
                  Uses your phone camera
                </p>
              </div>
            </button>
          )}
        </div>
      )}
    </div>
  );
}