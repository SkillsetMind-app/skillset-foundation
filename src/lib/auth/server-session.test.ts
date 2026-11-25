// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requestHeaders: {} as Record<string, string>,
  headersError: null as unknown,
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: async () => {
    if (mocks.headersError) throw mocks.headersError;
    return { get: (name: string) => mocks.requestHeaders[name] ?? null };
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createSupabaseServerClient,
}));

import { getServerAccount, getServerAuthSession } from "@/lib/auth/server-session";

// The contract: a session is handed to the first HTML only on a definite
// "signed in". Everything else is null, which leaves the decision to the
// browser exactly as before, so this helper can never open or close a page.

const authUser = {
  id: "user-1",
  email: "teacher@example.com",
  email_confirmed_at: "2026-01-01T00:00:00Z",
  user_metadata: { name: "From Metadata" },
};

const userRow = {
  uid: "user-1",
  email: "teacher@example.com",
  display_name: "Teacher",
  photo_url: null,
  roles: ["teacher"],
  onboarding_completed: true,
};

function buildClient({
  user = authUser as typeof authUser | null,
  row = { data: userRow as typeof userRow | null, error: null as unknown },
  claim = () => Promise.resolve({ data: 0, error: null }) as Promise<unknown>,
  getUser = undefined as undefined | (() => Promise<unknown>),
} = {}) {
  const maybeSingle = vi.fn().mockResolvedValue(row);
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const client = {
    auth: { getUser: vi.fn(getUser ?? (async () => ({ data: { user }, error: null }))) },
    rpc: vi.fn(() => claim()),
    from: vi.fn(() => ({ select })),
  };
  mocks.createSupabaseServerClient.mockResolvedValue(client);
  return { client, eq };
}

describe("getServerAuthSession", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.headersError = null;
    // A full page load (what the browser says) whose session the proxy has
    // just verified (what the proxy forwards).
    mocks.requestHeaders = { "x-skillset-session-checked": "1", "sec-fetch-dest": "document" };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("answers without touching Supabase when the proxy did not verify a session for this request", async () => {
    buildClient();

    // Anonymous visitor, or a request the proxy routed without touching the
    // session (a creator's own domain): a server component must not be the one
    // that refreshes a token, because it cannot save the new one.
    mocks.requestHeaders = { "sec-fetch-dest": "document" };
    await expect(getServerAuthSession()).resolves.toBeNull();

    mocks.requestHeaders = { "x-skillset-session-checked": "true", "sec-fetch-dest": "document" };
    await expect(getServerAuthSession()).resolves.toBeNull();

    expect(mocks.createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("resolves nothing for the layout on an in-app refresh, where the provider would ignore it", async () => {
    buildClient();

    // router.refresh() and in-app navigations are fetches, not documents.
    mocks.requestHeaders = { "x-skillset-session-checked": "1", "sec-fetch-dest": "empty" };
    await expect(getServerAuthSession()).resolves.toBeNull();
    // A browser that does not send the header is treated the same way.
    mocks.requestHeaders = { "x-skillset-session-checked": "1" };
    await expect(getServerAuthSession()).resolves.toBeNull();
    expect(mocks.createSupabaseServerClient).not.toHaveBeenCalled();

    // A page that needs the account itself (/loading) still gets it.
    await expect(getServerAccount()).resolves.toMatchObject({ user: { uid: "user-1" } });
  });

  it("hands over the signed-in user, built like the browser builds it", async () => {
    const { client, eq } = buildClient();

    await expect(getServerAuthSession()).resolves.toEqual({
      status: "authenticated",
      user: {
        uid: "user-1",
        email: "teacher@example.com",
        emailVerified: true,
        displayName: "Teacher",
        photoURL: null,
        roles: ["teacher"],
      },
    });
    // Pending grants are claimed before the page is told "signed in", and the
    // profile read is the caller's own row.
    expect(client.rpc).toHaveBeenCalledWith("claim_my_course_grants");
    expect(client.from).toHaveBeenCalledWith("users");
    expect(eq).toHaveBeenCalledWith("uid", "user-1");
  });

  it("gives a page the profile row along with the user", async () => {
    buildClient();

    await expect(getServerAccount()).resolves.toMatchObject({
      user: { uid: "user-1", roles: ["teacher"] },
      profile: { uid: "user-1", onboardingCompleted: true, roles: ["teacher"] },
    });
  });

  it("stays out of it when the server gate reports no user (second factor owed, blocked, expired)", async () => {
    const { client } = buildClient({ user: null });

    await expect(getServerAuthSession()).resolves.toBeNull();
    expect(client.rpc).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it("stays out of it when the profile row is missing or unreadable", async () => {
    buildClient({ row: { data: null, error: null } });
    await expect(getServerAuthSession()).resolves.toBeNull();

    buildClient({ row: { data: null, error: { message: "permission denied" } } });
    await expect(getServerAuthSession()).resolves.toBeNull();
  });

  it("a failed grant claim does not hold the page back", async () => {
    buildClient({ claim: () => Promise.reject(new Error("claim failed")) });

    await expect(getServerAuthSession()).resolves.toMatchObject({ status: "authenticated" });
  });

  it("stays out of it when anything throws", async () => {
    mocks.createSupabaseServerClient.mockRejectedValue(new Error("Supabase client configuration is missing."));

    await expect(getServerAuthSession()).resolves.toBeNull();
  });

  it("never makes the page wait: past two seconds the browser decides", async () => {
    vi.useFakeTimers();
    // Supabase never answers.
    buildClient({ getUser: () => new Promise(() => {}) });

    const pending = getServerAuthSession();
    await vi.advanceTimersByTimeAsync(1999);
    let settled = false;
    void pending.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBeNull();
  });

  it("lets Next's own signals through instead of swallowing them", async () => {
    // What headers() throws to mark a route dynamic: catching it would break
    // the build's static analysis. Any other error is still ours to absorb.
    const bailout = Object.assign(new Error("Dynamic server usage: headers"), {
      digest: "DYNAMIC_SERVER_USAGE",
    });
    mocks.headersError = bailout;

    await expect(getServerAuthSession()).rejects.toBe(bailout);
  });
});
