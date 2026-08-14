"use client";

import * as tus from "tus-js-client";
import { supabase } from "./supabase";

const LECTURE_BUCKET = "lecture-audio";
const TUS_CHUNK_SIZE = 6 * 1024 * 1024;

function getProjectId() {
  const projectUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (!projectUrl) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL is missing.",
    );
  }

  const hostname = new URL(projectUrl).hostname;
  const projectId = hostname.split(".")[0];

  if (!projectId) {
    throw new Error(
      "Could not determine the Supabase project ID.",
    );
  }

  return projectId;
}

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
    throw new Error(
      "You must be signed in to upload a lecture.",
    );
  }

  const projectId = getProjectId();

  return new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: `https://${projectId}.storage.supabase.co/storage/v1/upload/resumable`,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: {
        authorization: `Bearer ${session.access_token}`,
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: TUS_CHUNK_SIZE,
      metadata: {
        bucketName: LECTURE_BUCKET,
        objectName: storagePath,
        contentType:
          file.type || "application/octet-stream",
        cacheControl: "3600",
      },
      onError(error) {
        reject(error);
      },
      onProgress(bytesUploaded, bytesTotal) {
        const percent =
          bytesTotal > 0
            ? (bytesUploaded / bytesTotal) * 100
            : 0;

        onProgress?.(percent);
      },
      onSuccess() {
        onProgress?.(100);
        resolve();
      },
    });

    void upload
      .findPreviousUploads()
      .then((previousUploads) => {
        if (previousUploads.length > 0) {
          upload.resumeFromPreviousUpload(
            previousUploads[0],
          );
        }

        upload.start();
      })
      .catch(reject);
  });
}