import { NextResponse } from "next/server";
import { presignNeonStorageUrl } from "../../../lib/neon-storage-sign";

export const runtime = "nodejs";

type Action =
  | {
      action: "sign-get" | "sign-put";
      bucket?: unknown;
      path?: unknown;
      expires?: unknown;
    }
  | {
      action: "delete";
      bucket?: unknown;
      paths?: unknown;
    };

const buckets = new Set(["course-files", "lecture-audio"]);

function validBucket(value: unknown): value is string {
  return typeof value === "string" && buckets.has(value);
}

function validPath(value: unknown): value is string {
  const owner =
    process.env.NEXT_PUBLIC_COLLEGEOS_USER_ID ||
    "3b04fb4b-7c2a-4758-8421-abf0fd06abff";
  return (
    typeof value === "string" &&
    value.length > owner.length + 1 &&
    value.startsWith(`${owner}/`) &&
    !value.includes("../")
  );
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Action;
    if (!validBucket(body.bucket)) {
      return NextResponse.json(
        { ok: false, error: "Invalid storage bucket." },
        { status: 400 },
      );
    }

    if (body.action === "sign-get" || body.action === "sign-put") {
      if (!validPath(body.path)) {
        return NextResponse.json(
          { ok: false, error: "Invalid storage path." },
          { status: 400 },
        );
      }
      const requested = Number(body.expires ?? 3600);
      const expires = Number.isFinite(requested)
        ? Math.max(30, Math.min(86400, Math.round(requested)))
        : 3600;
      const signedUrl = presignNeonStorageUrl({
        method: body.action === "sign-get" ? "GET" : "PUT",
        bucket: body.bucket,
        key: body.path,
        expires,
      });
      return NextResponse.json({ ok: true, signedUrl });
    }

    if (body.action === "delete") {
      const paths = Array.isArray(body.paths)
        ? body.paths.filter(validPath)
        : [];
      if (paths.length === 0 || paths.length !== body.paths?.length) {
        return NextResponse.json(
          { ok: false, error: "Invalid delete request." },
          { status: 400 },
        );
      }

      for (const path of paths) {
        const signedUrl = presignNeonStorageUrl({
          method: "DELETE",
          bucket: body.bucket,
          key: path,
          expires: 300,
        });
        const response = await fetch(signedUrl, { method: "DELETE" });
        if (!response.ok && response.status !== 404) {
          throw new Error(
            `Storage delete failed with status ${response.status}.`,
          );
        }
      }

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json(
      { ok: false, error: "Unknown storage action." },
      { status: 400 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Storage request failed.",
      },
      { status: 500 },
    );
  }
}
