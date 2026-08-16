"use client";
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, FileImage, ImagePlus, Loader2, Trash2 } from "lucide-react";
import { supabase } from "../lib/supabase";

type Attachment = {
  id: string;
  file_name: string;
  storage_path: string;
  mime_type: string | null;
  caption: string;
  url?: string;
};

export function NotebookTools({ noteId, userId, courseId, accent }: {
  noteId: string;
  userId: string;
  courseId: string;
  accent: string;
}) {
  const uploadRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const loadAttachments = useCallback(async () => {
    const { data, error: loadError } = await supabase
      .from("note_attachments")
      .select("id, file_name, storage_path, mime_type, caption")
      .eq("note_id", noteId)
      .order("created_at");
    if (loadError) {
      setError(loadError.message);
      return;
    }
    const rows = (data ?? []) as Attachment[];
    const withUrls = await Promise.all(rows.map(async (attachment) => {
      const { data: signed } = await supabase.storage.from("course-files").createSignedUrl(attachment.storage_path, 3600);
      return { ...attachment, url: signed?.signedUrl };
    }));
    setAttachments(withUrls);
  }, [noteId]);

  // Attachment rows and their signed URLs are external state for this note.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadAttachments(); }, [loadAttachments]);

  async function upload(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return setError("Notebook pages must be images.");
    if (file.size > 12 * 1024 * 1024) return setError("Keep each notebook photo under 12 MB.");
    try {
      setUploading(true);
      setError("");
      const clean = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-100) || "page.jpg";
      const path = `${userId}/${courseId || "notebook"}/notes/${noteId}/${crypto.randomUUID()}-${clean}`;
      const { error: uploadError } = await supabase.storage.from("course-files").upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;
      const { error: rowError } = await supabase.from("note_attachments").insert({
        user_id: userId,
        note_id: noteId,
        course_id: courseId || null,
        file_name: file.name,
        storage_path: path,
        mime_type: file.type,
        size_bytes: file.size,
      });
      if (rowError) {
        await supabase.storage.from("course-files").remove([path]);
        throw rowError;
      }
      await loadAttachments();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Could not upload this page.");
    } finally {
      setUploading(false);
    }
  }

  async function remove(attachment: Attachment) {
    const { error: storageError } = await supabase.storage.from("course-files").remove([attachment.storage_path]);
    if (storageError) return setError(storageError.message);
    const { error: rowError } = await supabase.from("note_attachments").delete().eq("id", attachment.id).eq("user_id", userId);
    if (rowError) return setError(rowError.message);
    setAttachments((current) => current.filter((item) => item.id !== attachment.id));
  }

  return <div className="mt-4">
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[16px] border bg-white/[.012] px-3 py-2.5" style={{ borderColor: `${accent}18` }}>
      <div>
        <p className="text-[8px] font-medium text-white/40">Paper notebook</p>
        <p className="mt-0.5 text-[7px] text-white/18">Add photos or scan pages into this note.</p>
      </div>
      <div className="flex items-center gap-1.5">
      <input ref={uploadRef} type="file" accept="image/*" className="hidden" onChange={(event) => { void upload(event.target.files?.[0] ?? null); event.target.value = ""; }} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(event) => { void upload(event.target.files?.[0] ?? null); event.target.value = ""; }} />
      <button type="button" disabled={uploading} onClick={() => uploadRef.current?.click()} className="flex h-8 items-center gap-1.5 rounded-[10px] px-2.5 text-[8px] text-white/31 transition hover:bg-white/[.045] hover:text-white/65 disabled:opacity-40">{uploading ? <Loader2 size={11} className="animate-spin" /> : <ImagePlus size={11} />}Add page</button>
      <button type="button" disabled={uploading} onClick={() => cameraRef.current?.click()} className="flex h-8 items-center gap-1.5 rounded-[10px] px-2.5 text-[8px] text-white/31 transition hover:bg-white/[.045] hover:text-white/65 disabled:opacity-40"><Camera size={11} />Scan</button>
      </div>
    </div>

    {error && <p className="mt-2 text-[8px] text-red-200/55">{error}</p>}

    {attachments.length > 0 && <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
      {attachments.map((attachment, index) => <div key={attachment.id} className="group relative overflow-hidden rounded-[16px] border border-white/[.065] bg-black/20">
        {attachment.url ? <a href={attachment.url} target="_blank" rel="noreferrer" className="block"><img src={attachment.url} alt={attachment.caption || attachment.file_name} className="h-32 w-full object-cover transition group-hover:scale-[1.02]" /><span className="absolute bottom-2 left-2 rounded-full bg-black/70 px-2 py-1 text-[7px] text-white/60">Page {index + 1}</span></a> : <div className="flex h-32 items-center justify-center"><FileImage size={16} className="text-white/18" /></div>}
        <button type="button" onClick={() => void remove(attachment)} className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white/35 opacity-0 transition hover:text-red-100 group-hover:opacity-100" aria-label={`Delete ${attachment.file_name}`}><Trash2 size={10} /></button>
      </div>)}
    </div>}
  </div>;
}
