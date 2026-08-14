import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bearerToken(request: Request) {
  const authorization =
    request.headers.get("authorization") ?? "";

  return authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
}

function createUserClient(accessToken: string) {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env
      .NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Supabase public environment variables are missing.",
    );
  }

  return createClient(url, key, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export async function DELETE(
  request: Request,
  context: {
    params: Promise<{
      id: string;
    }>;
  },
) {
  const accessToken =
    bearerToken(request);

  if (!accessToken) {
    return NextResponse.json(
      {
        ok: false,
        error: "You are not signed in.",
      },
      { status: 401 },
    );
  }

  try {
    const { id } =
      await context.params;

    const materialId =
      id?.trim();

    if (!materialId) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Material id is required.",
        },
        { status: 400 },
      );
    }

    const supabase =
      createUserClient(
        accessToken,
      );

    const {
      data: { user },
      error: userError,
    } =
      await supabase.auth.getUser();

    if (userError) {
      throw userError;
    }

    if (!user) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "You are not signed in.",
        },
        { status: 401 },
      );
    }

    const {
      data: material,
      error: materialError,
    } = await supabase
      .from("course_files")
      .select(
        "id, course_id, file_name, storage_path, material_type, processing_status",
      )
      .eq("id", materialId)
      .maybeSingle();

    if (materialError) {
      throw materialError;
    }

    if (!material) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "This material no longer exists.",
        },
        { status: 404 },
      );
    }

    if (
      material.material_type ===
      "lecture_recording"
    ) {
      const {
        data: lecture,
        error: lectureError,
      } = await supabase
        .from("lectures")
        .select(
          "id, status, analysis_stage",
        )
        .eq(
          "course_file_id",
          material.id,
        )
        .maybeSingle();

      if (lectureError) {
        throw lectureError;
      }

      if (
        lecture &&
        (lecture.status ===
          "transcribing" ||
          lecture.status ===
            "analyzing")
      ) {
        return NextResponse.json(
          {
            ok: false,
            code:
              "MATERIAL_BUSY",
            error:
              "This lecture is still processing. Cancel its analysis first, then delete it.",
          },
          { status: 409 },
        );
      }
    }

    const bucket =
      material.material_type ===
      "lecture_recording"
        ? "lecture-audio"
        : "course-files";

    let storageWarning = "";

    if (material.storage_path) {
      const {
        error: storageError,
      } = await supabase.storage
        .from(bucket)
        .remove([
          material.storage_path,
        ]);

      if (storageError) {
        console.warn(
          "Material storage cleanup failed:",
          storageError,
        );

        storageWarning =
          "The database record was removed, but the stored file could not be cleaned up automatically.";
      }
    }

    const {
      error: deleteError,
    } = await supabase
      .from("course_files")
      .delete()
      .eq("id", material.id)
      .eq(
        "course_id",
        material.course_id,
      );

    if (deleteError) {
      throw deleteError;
    }

    return NextResponse.json({
      ok: true,
      materialId:
        material.id,
      courseId:
        material.course_id,
      warning:
        storageWarning || null,
    });
  } catch (error) {
    console.error(
      "Could not delete material:",
      error,
    );

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not delete this material.",
      },
      { status: 500 },
    );
  }
}