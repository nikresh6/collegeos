import { PostgrestClient } from "@supabase/postgrest-js";

type AuthCallback = (
  event: string,
  session: ReturnType<typeof buildSession>,
) => void | Promise<void>;

type StorageAction =
  | { action: "sign-get"; bucket: string; path: string; expires?: number }
  | { action: "sign-put"; bucket: string; path: string; expires?: number }
  | { action: "delete"; bucket: string; paths: string[] };

const metadata: Record<string, unknown> = {};

function ownerId() {
  return (
    process.env.NEXT_PUBLIC_COLLEGEOS_USER_ID ||
    "3b04fb4b-7c2a-4758-8421-abf0fd06abff"
  );
}

function buildUser() {
  const now = new Date().toISOString();
  return {
    id: ownerId(),
    aud: "authenticated",
    role: "authenticated",
    email: null,
    phone: "",
    app_metadata: {
      provider: "collegeos",
      providers: ["collegeos"],
    },
    user_metadata: { ...metadata },
    identities: [],
    created_at: now,
    updated_at: now,
    is_anonymous: false,
  };
}

function buildSession() {
  return {
    access_token: "collegeos-neon-session",
    token_type: "bearer",
    expires_in: 60 * 60 * 24 * 365,
    expires_at: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365,
    refresh_token: "",
    user: buildUser(),
  };
}

function storageApiUrl() {
  if (typeof window !== "undefined") {
    return "/api/storage";
  }

  const host =
    process.env.VERCEL_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    "localhost:3000";
  const origin = /^https?:\/\//i.test(host)
    ? host
    : host.startsWith("localhost")
      ? `http://${host}`
      : `https://${host}`;

  return `${origin}/api/storage`;
}

async function storageAction(payload: StorageAction) {
  const response = await fetch(storageApiUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  const body = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    signedUrl?: string;
    error?: string;
  };

  if (!response.ok || body.ok !== true) {
    throw new Error(body.error || "Neon storage request failed.");
  }

  return body;
}

class NeonStorageBucket {
  constructor(private readonly bucket: string) {}

  async createSignedUrl(path: string, expiresIn = 3600) {
    try {
      const data = await storageAction({
        action: "sign-get",
        bucket: this.bucket,
        path,
        expires: expiresIn,
      });
      return {
        data: { signedUrl: data.signedUrl as string },
        error: null,
      };
    } catch (error) {
      return { data: null, error: normalizeError(error) };
    }
  }

  async createSignedUploadUrl(path: string) {
    try {
      const data = await storageAction({
        action: "sign-put",
        bucket: this.bucket,
        path,
        expires: 3600,
      });
      return {
        data: {
          signedUrl: data.signedUrl as string,
          path,
          token: "",
        },
        error: null,
      };
    } catch (error) {
      return { data: null, error: normalizeError(error) };
    }
  }

  async upload(
    path: string,
    body: Blob | ArrayBuffer | Uint8Array,
    options?: { contentType?: string; upsert?: boolean },
  ) {
    try {
      const signed = await storageAction({
        action: "sign-put",
        bucket: this.bucket,
        path,
        expires: 3600,
      });
      const response = await fetch(signed.signedUrl as string, {
        method: "PUT",
        headers: options?.contentType
          ? { "content-type": options.contentType }
          : undefined,
        body: body as BodyInit,
      });
      if (!response.ok) {
        throw new Error(
          `Neon upload failed with status ${response.status}.`,
        );
      }
      return { data: { path, fullPath: `${this.bucket}/${path}` }, error: null };
    } catch (error) {
      return { data: null, error: normalizeError(error) };
    }
  }

  async download(path: string) {
    try {
      const signed = await storageAction({
        action: "sign-get",
        bucket: this.bucket,
        path,
        expires: 1800,
      });
      const response = await fetch(signed.signedUrl as string, {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(
          `Neon download failed with status ${response.status}.`,
        );
      }
      return { data: await response.blob(), error: null };
    } catch (error) {
      return { data: null, error: normalizeError(error) };
    }
  }

  async remove(paths: string[]) {
    try {
      await storageAction({
        action: "delete",
        bucket: this.bucket,
        paths,
      });
      return { data: paths.map((name) => ({ name })), error: null };
    } catch (error) {
      return { data: null, error: normalizeError(error) };
    }
  }
}

function normalizeError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}

export function createClient(
  _url?: string,
  _key?: string,
  _options?: unknown,
) {
  const dataApiUrl = process.env.NEXT_PUBLIC_NEON_DATA_API_URL;
  if (!dataApiUrl) {
    throw new Error("NEXT_PUBLIC_NEON_DATA_API_URL is missing.");
  }

  const rest = new PostgrestClient(dataApiUrl);

  const auth = {
    async getSession() {
      return { data: { session: buildSession() }, error: null };
    },
    async getUser() {
      return { data: { user: buildUser() }, error: null };
    },
    async signOut() {
      return { error: null };
    },
    async updateUser(input?: Record<string, unknown>) {
      const data =
        input?.data &&
        typeof input.data === "object" &&
        !Array.isArray(input.data)
          ? (input.data as Record<string, unknown>)
          : null;
      if (data) Object.assign(metadata, data);
      return { data: { user: buildUser() }, error: null };
    },
    async signInWithPassword(_input?: unknown) {
      return {
        data: { user: buildUser(), session: buildSession() },
        error: null,
      };
    },
    async signUp(_input?: unknown) {
      return {
        data: { user: buildUser(), session: buildSession() },
        error: null,
      };
    },
    async signInWithOAuth(_input?: unknown) {
      return {
        data: { provider: "collegeos", url: null },
        error: null,
      };
    },
    onAuthStateChange(callback: AuthCallback) {
      queueMicrotask(() => {
        void callback("SIGNED_IN", buildSession());
      });
      return {
        data: {
          subscription: {
            unsubscribe() {},
          },
        },
      };
    },
  };

  type RealtimePayload = {
    new: Record<string, unknown>;
    old?: Record<string, unknown>;
  };

  const realtimeChannel = () => {
    const channel: {
      on: (
        event: string,
        filter: Record<string, unknown>,
        callback: (payload: RealtimePayload) => void,
      ) => typeof channel;
      subscribe: (callback?: (status: string) => void) => typeof channel;
      unsubscribe: () => Promise<string>;
    } = {
      on: (_event, _filter, _callback) => channel,
      subscribe: (callback) => {
        callback?.("SUBSCRIBED");
        return channel;
      },
      unsubscribe: async () => "ok",
    };
    return channel;
  };

  return {
    from: rest.from.bind(rest),
    rpc: rest.rpc.bind(rest),
    schema: rest.schema.bind(rest),
    auth,
    channel: (_name: string) => realtimeChannel(),
    removeChannel: async (_channel: unknown) => "ok",
    storage: {
      from(bucket: string) {
        return new NeonStorageBucket(bucket);
      },
    },
  };
}

export type SupabaseClient = ReturnType<typeof createClient>;
