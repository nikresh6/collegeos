import {
  createClient,
} from "@supabase/supabase-js";

export function bearerToken(
  request: Request,
) {
  const authorization =
    request.headers.get(
      "authorization",
    ) ?? "";

  return authorization.startsWith(
    "Bearer ",
  )
    ? authorization.slice(
        "Bearer ".length,
      )
    : "";
}

export function createUserClient(
  accessToken: string,
) {
  const url =
    process.env
      .NEXT_PUBLIC_SUPABASE_URL;

  const key =
    process.env
      .NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Supabase public environment variables are missing.",
    );
  }

  return createClient(
    url,
    key,
    {
      global: {
        headers: {
          Authorization:
            `Bearer ${accessToken}`,
        },
      },
      auth: {
        persistSession:
          false,
        autoRefreshToken:
          false,
      },
    },
  );
}

export async function userContext(
  request: Request,
) {
  const token =
    bearerToken(request);

  if (!token) {
    return null;
  }

  const supabase =
    createUserClient(token);

  const {
    data: { user },
    error,
  } =
    await supabase.auth.getUser();

  if (
    error ||
    !user
  ) {
    return null;
  }

  return {
    supabase,
    user,
  };
}