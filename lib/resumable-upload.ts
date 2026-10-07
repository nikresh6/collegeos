"use client";

import { supabase } from "./supabase";

const LECTURE_BUCKET = "lecture-audio";

export async function uploadLectureAudio({
  file,
  storagePath,
  onProgress,
}: {
  file: File;
  storagePath: string;
  onProgress?: (percent: number) => void;
}) {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError) throw sessionError;
  if (!session) {
    throw new Error("You must be signed in to upload a lecture.");
  }

  const { data, error } = await supabase.storage
    .from(LECTURE_BUCKET)
    .createSignedUploadUrl(storagePath);

  if (error || !data?.signedUrl) {
    throw error || new Error("Could not prepare the lecture upload.");
  }

  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", data.signedUrl);
    if (file.type) {
      request.setRequestHeader("Content-Type", file.type);
    }

    request.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total <= 0) return;
      onProgress?.((event.loaded / event.total) * 100);
    };

    request.onerror = () => {
      reject(new Error("The lecture upload could not reach Neon storage."));
    };

    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress?.(100);
        resolve();
        return;
      }
      reject(
        new Error(
          `Neon storage rejected the lecture upload with status ${request.status}.`,
        ),
      );
    };

    request.send(file);
  });
}
