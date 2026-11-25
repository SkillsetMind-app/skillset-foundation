import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthSession } from "@/domain/auth";

const supabaseMocks = vi.hoisted(() => ({
  getSupabaseBrowserClient: vi.fn(),
  fetch: vi.fn(),
}));

const profileMocks = vi.hoisted(() => ({
  getUserProfile: vi.fn(),
  upsertUserProfile: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowserClient: supabaseMocks.getSupabaseBrowserClient,
}));

vi.mock("@/lib/data/user-profiles", () => ({
  getUserProfile: profileMocks.getUserProfile,
  upsertUserProfile: profileMocks.upsertUserProfile,
}));

import { listenToAuthState } from "@/lib/auth/supabase-auth";

// WHY THIS FILE EXISTS
//
// `onAuthStateChange` fires on events that change nothing for the app:
// `TOKEN_REFRESHED` (about every hour) and `SIGNED_IN` when the tab regains focus.
// Before the fix, each firing produced a NEW `user` OBJECT with the same
// content — and 41 effects in this app declare `[user]` as a dependency.
//
// Five of those effects seed EDITABLE fields from the server. In
// `storefront-settings-panel.tsx` the effect with dependency `[user]` runs
// `setTagline(showcase?.tagline ?? "")`: the teacher was writing the tagline, the
// session was renewed in the middle, the effect ran again and what they typed was
// replaced by the last saved value — without a word on the screen.
//
// The contract proven here: emit only when the CONTENT changes.

type StateHandler = (event: string, session: unknown) => void;

function buildClient() {
  let handler: StateHandler | null = null;
  let unsubscribed = false;

  const client = {
    rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: supabaseUser }, error: null }),
      mfa: {
        // Account without a second factor: Supabase answers aal1/aal1 and the listener
        // goes on to the profile. The gate itself is proven in
        // second-factor-gate.test.tsx.
        getAuthenticatorAssuranceLevel: vi.fn().mockResolvedValue({
          data: { currentLevel: "aal1", nextLevel: "aal1" },
          error: null,
        }),
      },
      onAuthStateChange: (callback: StateHandler) => {
        handler = callback;
        return {
          data: {
            subscription: {
              unsubscribe: () => {
                unsubscribed = true;
              },
            },
          },
        };
      },
    },
  };

  return {
    client,
    fire: (event: string, session: unknown) => handler?.(event, session),
    wasUnsubscribed: () => unsubscribed,
  };
}

const supabaseUser = {
  id: "user-1",
  email: "teacher@example.com",
  email_confirmed_at: "2026-01-01T00:00:00Z",
  user_metadata: { name: "Teacher" },
};

function profile(displayName: string) {
  return {
    uid: "user-1",
    email: "teacher@example.com",
    displayName,
    photoURL: null,
    roles: ["teacher"],
  };
}

// The profile read is deferred with `window.setTimeout(..., 0)` on purpose (the
// Supabase holds its own lock while it notifies subscribers), and then
// awaits promises. Alternating between macrotask and microtask drains both queues.
async function flush() {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("listenToAuthState — renewing the session must not erase what the person typed", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    supabaseMocks.fetch.mockRejectedValue(new Error("Network forbidden"));
    vi.stubGlobal("fetch", supabaseMocks.fetch);
    profileMocks.upsertUserProfile.mockResolvedValue(undefined);
  });

  afterEach(() => {
    expect(supabaseMocks.fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it.each(["profile", "repair-write", "repair-read", "assurance"])(
    "contains a rejected %s read and emits only a closed session",
    async (stage) => {
      const harness = buildClient();
      supabaseMocks.getSupabaseBrowserClient.mockReturnValue(harness.client);
      profileMocks.getUserProfile.mockResolvedValue(profile("Teacher"));
      if (stage === "assurance") {
        harness.client.auth.mfa.getAuthenticatorAssuranceLevel.mockRejectedValue(new Error("private assurance failure"));
      } else if (stage === "profile") {
        profileMocks.getUserProfile.mockRejectedValue(new Error("private profile failure"));
      } else {
        profileMocks.getUserProfile.mockResolvedValueOnce(null);
        if (stage === "repair-write") profileMocks.upsertUserProfile.mockRejectedValue(new Error("private repair failure"));
        else profileMocks.getUserProfile.mockRejectedValueOnce(new Error("private reread failure"));
      }
      const seen: AuthSession[] = [];
      const unsubscribe = listenToAuthState((session) => seen.push(session));
      harness.fire("INITIAL_SESSION", { user: supabaseUser });
      await flush();
      expect(seen).toEqual([
        { status: "loading", user: null },
        { status: "unauthenticated", user: null },
      ]);
      expect(JSON.stringify(seen)).not.toContain("private");
      unsubscribe();
    },
  );

  it.each(["TOKEN_REFRESHED", "SIGNED_IN"])("preserves an earlier authenticated user after a same-user %s profile failure", async (event) => {
    const harness = buildClient();
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(harness.client);
    profileMocks.getUserProfile.mockResolvedValue(profile("Teacher"));
    const seen: AuthSession[] = [];
    const unsubscribe = listenToAuthState((session) => seen.push(session));
    harness.fire("SIGNED_IN", { user: supabaseUser });
    await flush();
    profileMocks.getUserProfile.mockRejectedValueOnce(new Error("private outage"));
    harness.fire(event, { user: supabaseUser });
    await flush();
    expect(seen.at(-1)?.status).toBe("authenticated");
    harness.fire("SIGNED_IN", { user: supabaseUser });
    await flush();
    expect(seen.map((session) => session.status)).toEqual([
      "loading", "authenticated",
    ]);
    unsubscribe();
  });

  it.each(["unsubscribe", "logout", "mfa", "newer-user"])("a rejected refresh emits nothing after %s", async (next) => {
    const harness = buildClient();
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(harness.client);
    profileMocks.getUserProfile.mockResolvedValue(profile("Teacher"));
    const seen: AuthSession[] = [];
    const unsubscribe = listenToAuthState((session) => seen.push(session));
    // No prior session on unsubscribe: the catch would have a reason to emit if
    // it forgot the activity guard, even after the screen was unmounted.
    if (next !== "unsubscribe") {
      harness.fire("SIGNED_IN", { user: supabaseUser });
      await flush();
    }
    let rejectProfile!: (reason: Error) => void;
    profileMocks.getUserProfile.mockImplementationOnce(() => new Promise((_, reject) => { rejectProfile = reject; }));
    const refresh = unsubscribe.refreshUser();
    void refresh.catch(() => {});
    await flush();
    if (next === "unsubscribe") unsubscribe();
    else if (next === "logout") harness.fire("SIGNED_OUT", null);
    else if (next === "mfa") {
      harness.client.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({
        data: { currentLevel: "aal1", nextLevel: "aal2" }, error: null,
      });
      harness.fire("SIGNED_IN", { user: supabaseUser });
    } else {
      profileMocks.getUserProfile.mockResolvedValue({ ...profile("Second"), uid: "user-2" });
      harness.fire("SIGNED_IN", { user: { ...supabaseUser, id: "user-2" } });
    }
    await flush();
    const before = [...seen];
    rejectProfile(new Error("private superseded failure"));
    await expect(refresh).rejects.toThrow("private superseded failure");
    await flush();
    expect(seen).toEqual(before);
    if (next !== "unsubscribe") unsubscribe();
  });

  it.each(["signout", "newer-user"])("ignores an older rejection after %s", async (next) => {
    const harness = buildClient();
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(harness.client);
    let rejectOld!: (error: Error) => void;
    profileMocks.getUserProfile.mockImplementationOnce(() => new Promise((_, reject) => { rejectOld = reject; }));
    const seen: AuthSession[] = [];
    const unsubscribe = listenToAuthState((session) => seen.push(session));
    harness.fire("SIGNED_IN", { user: supabaseUser });
    await flush();
    if (next === "signout") harness.fire("SIGNED_OUT", null);
    else {
      profileMocks.getUserProfile.mockResolvedValue({ ...profile("Second"), uid: "user-2" });
      harness.fire("SIGNED_IN", { user: { ...supabaseUser, id: "user-2" } });
    }
    await flush();
    const before = [...seen];
    rejectOld(new Error("private stale failure"));
    await flush();
    expect(seen).toEqual(before);
    expect(seen.at(-1)?.user?.uid ?? null).toBe(next === "signout" ? null : "user-2");
    unsubscribe();
  });

  it("does not read a queued profile after unsubscribe", async () => {
    const harness = buildClient();
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(harness.client);
    profileMocks.getUserProfile.mockResolvedValue(profile("Teacher"));
    const seen: AuthSession[] = [];
    const unsubscribe = listenToAuthState((session) => seen.push(session));
    harness.fire("SIGNED_IN", { user: supabaseUser });
    unsubscribe();
    await flush();
    expect(profileMocks.getUserProfile).not.toHaveBeenCalled();
    expect(seen).toEqual([{ status: "loading", user: null }]);
  });

  it.each(["resolve", "reject"])("does not emit when an in-flight profile settles after unsubscribe: %s", async (result) => {
    const harness = buildClient();
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(harness.client);
    let resolveProfile!: (value: unknown) => void;
    let rejectProfile!: (error: Error) => void;
    profileMocks.getUserProfile.mockImplementation(() => new Promise((resolve, reject) => {
      resolveProfile = resolve;
      rejectProfile = reject;
    }));
    const seen: AuthSession[] = [];
    const unsubscribe = listenToAuthState((session) => seen.push(session));
    harness.fire("SIGNED_IN", { user: supabaseUser });
    await flush();
    unsubscribe();
    if (result === "resolve") resolveProfile(profile("Teacher"));
    else rejectProfile(new Error("private late failure"));
    await flush();
    expect(seen).toEqual([{ status: "loading", user: null }]);
    expect(harness.wasUnsubscribed()).toBe(true);
  });

  it("does not re-emit when the session content is identical", async () => {
    const harness = buildClient();
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(harness.client);
    profileMocks.getUserProfile.mockResolvedValue(profile("Teacher"));

    const seen: AuthSession[] = [];
    listenToAuthState((session) => seen.push(session));

    harness.fire("SIGNED_IN", { user: supabaseUser });
    await flush();
    harness.fire("TOKEN_REFRESHED", { user: supabaseUser });
    await flush();
    harness.fire("SIGNED_IN", { user: supabaseUser });
    await flush();

    const emitidas = seen.filter(
      (session) => session.status === "authenticated",
    );

    expect(emitidas).toHaveLength(1);
    expect(emitidas[0]?.user?.displayName).toBe("Teacher");
  });

  it("emits again when the content really changes", async () => {
    const harness = buildClient();
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(harness.client);
    profileMocks.getUserProfile
      .mockResolvedValueOnce(profile("Teacher"))
      .mockResolvedValueOnce(profile("Teacher Renamed"));

    const seen: AuthSession[] = [];
    listenToAuthState((session) => seen.push(session));

    harness.fire("SIGNED_IN", { user: supabaseUser });
    await flush();
    harness.fire("USER_UPDATED", { user: supabaseUser });
    await flush();

    const names = seen
      .filter((session) => session.status === "authenticated")
      .map((session) => session.user?.displayName);

    expect(names).toEqual(["Teacher", "Teacher Renamed"]);
  });

  it("does not repeat the sign-out: two SIGNED_OUT in a row emit only once", async () => {
    const harness = buildClient();
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(harness.client);

    const seen: AuthSession[] = [];
    listenToAuthState((session) => seen.push(session));

    harness.fire("SIGNED_OUT", null);
    harness.fire("SIGNED_OUT", null);
    await flush();

    expect(
      seen.filter((session) => session.status === "unauthenticated"),
    ).toHaveLength(1);
  });

  it("emits the same person again after a logout in between", async () => {
    const harness = buildClient();
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(harness.client);
    profileMocks.getUserProfile.mockResolvedValue(profile("Teacher"));

    const seen: AuthSession[] = [];
    listenToAuthState((session) => seen.push(session));

    harness.fire("SIGNED_IN", { user: supabaseUser });
    await flush();
    harness.fire("SIGNED_OUT", null);
    await flush();
    harness.fire("SIGNED_IN", { user: supabaseUser });
    await flush();

    expect(
      seen
        .map((session) => session.status)
        .filter((status) => status !== "loading"),
    ).toEqual(["authenticated", "unauthenticated", "authenticated"]);
  });

  it("still returns the subscription cancellation", () => {
    const harness = buildClient();
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(harness.client);

    const unsubscribe = listenToAuthState(() => {});
    unsubscribe();

    expect(harness.wasUnsubscribed()).toBe(true);
  });
});
