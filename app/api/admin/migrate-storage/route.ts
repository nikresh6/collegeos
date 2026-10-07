import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { presignNeonStorageUrl } from "../../../../lib/neon-storage-sign";

export const runtime = "nodejs";
export const maxDuration = 300;

const buckets = new Set(["course-files", "lecture-audio"]);

function safePath(value: string) {
  return value
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const secret = url.searchParams.get("secret") || "";
  const expected = process.env.COLLEGEOS_SERVER_SECRET || "";
  if (!expected || secret !== expected) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized." },
      { status: 401 },
    );
  }

  const bucket = url.searchParams.get("bucket") || "";
  const key = url.searchParams.get("key") || "";
  if (!buckets.has(bucket) || !key || key.includes("../")) {
    return NextResponse.json(
      { ok: false, error: "Invalid object." },
      { status: 400 },
    );
  }

  try {
    const sourceUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
    const sourceKey =
      process.env.SUPABASE_SECRET_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!sourceUrl || !sourceKey) {
      throw new Error("Supabase rollback source is not configured.");
    }

    const sourceResponse = await fetch(
      `${sourceUrl}/storage/v1/object/authenticated/${encodeURIComponent(bucket)}/${safePath(key)}`,
      {
        headers: {
          apikey: sourceKey,
          authorization: `Bearer ${sourceKey}`,
        },
        cache: "no-store",
      },
    );
    if (!sourceResponse.ok) {
      throw new Error(
        `Source download failed with status ${sourceResponse.status}.`,
      );
    }

    const bytes = Buffer.from(await sourceResponse.arrayBuffer());
    const sha256 = createHash("sha256").update(bytes).digest("hex");

    const putUrl = presignNeonStorageUrl({
      method: "PUT",
      bucket,
      key,
      expires: 900,
    });
    const putResponse = await fetch(putUrl, {
      method: "PUT",
      body: bytes,
      headers: {
        "content-type":
          sourceResponse.headers.get("content-type") ||
          "application/octet-stream",
      },
    });
    if (!putResponse.ok) {
      throw new Error(
        `Target upload failed with status ${putResponse.status}.`,
      );
    }

    const headUrl = presignNeonStorageUrl({
      method: "HEAD",
      bucket,
      key,
      expires: 300,
    });
    const headResponse = await fetch(headUrl, {
      method: "HEAD",
      cache: "no-store",
    });
    if (!headResponse.ok) {
      throw new Error(
        `Target verification failed with status ${headResponse.status}.`,
      );
    }
    const targetSize = Number(
      headResponse.headers.get("content-length") || "-1",
    );
    if (targetSize !== bytes.length) {
      throw new Error(
        `Target size mismatch: source ${bytes.length}, target ${targetSize}.`,
      );
    }

    return NextResponse.json({
      ok: true,
      bucket,
      key,
      size: bytes.length,
      sha256,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Migration failed.",
      },
      { status: 500 },
    );
  }
}
