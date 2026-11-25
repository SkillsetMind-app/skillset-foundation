import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthSession } from "@/domain/auth";

const supabaseMocks = vi.hoisted(() => ({ getSupabaseBrowserClient: vi.fn() }));
const profileMocks = vi.hoisted(() => ({ getUserProfile: vi.fn(), upsertUserProfile: vi.fn() }));

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowserClient: supabaseMocks.getSupabaseBrowserClient,
}));
vi.mock("@/lib/data/user-profiles", () => ({
  getUserProfile: profileMocks.getUserProfile,
  upsertUserProfile: profileMocks.upsertUserProfile,
}));

import { mapSupabaseUser } from "@/lib/auth/map-user";
import { listenToAuthState } from "@/lib/auth/supabase-auth";

// The server resolves the session for the first HTML and hands it to the
// listener as a seed (server-session.ts). The contract proved here: a seeded
// listener never goes back through "loading", the browser confirming the same
// session is silent, and the browser still has the last word when it disagrees.

type StateHandler = (event: string, session: unknown) => void;

const supabaseUser = {
  id: "user-1",
  email: "teacher@example.com",
  email_confirmed_at: "2026-01-01T00:00:00Z",
  user_metadata: { name: "Teacher" },
};

function profile(displayName: string, uid = "user-1") {
  return { uid, email: "teacher@example.com", displayName, photoURL: null, roles: ["teacher"] };
}

// What the server sends: the same mapper over the same user and profile row.
function seedFor(displayName: string): AuthSession {
  return {
    status: "authenticated",
    user: mapSupabaseUser(supabaseUser as never, profile(displayName) as never),
  };
}

function buildClient() {
  let handler: StateHandler | null = null;
  const client = {
    rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
    auth: {
      mfa: {
        getAuthenticatorAssuranceLevel: vi.fn().mockResolvedValue({
          data: { currentLevel: "aal1", nextLevel: "aal1" },
          error: null,
        }),
      },
      onAuthStateChange: (callback: StateHandler) => {
        handler = callback;
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
    },
  };
  return { client, fire: (event: string, session: unknown) => handler?.(event, session) };
}

// The profile read is deferred with setTimeout(0) and then awaits promises.
async function flush() {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function listen(seed: AuthSession | null) {
  const harness = buildClient();
  supabaseMocks.getSupabaseBrowserClient.mockReturnValue(harness.client);
  const seen: AuthSession[] = [];
  const unsubscribe = listenToAuthState((session) => seen.push(session), seed);
  return { ...harness, seen, unsubscribe };
}

describe("listenToAuthState seeded by the server", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    profileMocks.getUserProfile.mockResolvedValue(profile("Teacher"));
  });

  it("without a seed still starts from loading", () => {
    const { seen, unsubscribe } = listen(null);
    expect(seen).toEqual([{ status: "loading", user: null }]);
    unsubscribe();
  });

  it("emits nothing when the browser confirms the session the server sent", async () => {
    const { seen, fire, client, unsubscribe } = listen(seedFor("Teacher"));
    expect(seen).toEqual([]);

    fire("INITIAL_SESSION", { user: supabaseUser });
    await flush();

    // The browser did its own check (grants claimed, profile read) and agreed.
    expect(client.rpc).toHaveBeenCalledWith("claim_my_course_grants");
    expect(profileMocks.getUserProfile).toHaveBeenCalledWith("user-1");
    expect(seen).toEqual([]);
    unsubscribe();
  });

  it("emits the browser's answer when the profile changed since the server read it", async () => {
    const { seen, fire, unsubscribe } = listen(seedFor("Teacher"));
    profileMocks.getUserProfile.mockResolvedValue(profile("Teacher Renamed"));

    fire("INITIAL_SESSION", { user: supabaseUser });
    await flush();

    expect(seen.map((session) => [session.status, session.user?.displayName])).toEqual([
      ["authenticated", "Teacher Renamed"],
    ]);
    unsubscribe();
  });

  it("closes the page when the browser has no session after all", async () => {
    const { seen, fire, unsubscribe } = listen(seedFor("Teacher"));

    fire("INITIAL_SESSION", null);
    await flush();

    expect(seen).toEqual([{ status: "unauthenticated", user: null }]);
    unsubscribe();
  });

  it("closes the page when the browser finds the second factor is still owed", async () => {
    const { seen, fire, client, unsubscribe } = listen(seedFor("Teacher"));
    client.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({
      data: { currentLevel: "aal1", nextLevel: "aal2" },
      error: null,
    });

    fire("INITIAL_SESSION", { user: supabaseUser });
    await flush();

    expect(seen).toEqual([{ status: "mfa_required", user: null }]);
    unsubscribe();
  });

  it("closes the page when the browser cannot prove the session is strong", async () => {
    const { seen, fire, client, unsubscribe } = listen(seedFor("Teacher"));
    client.auth.mfa.getAuthenticatorAssuranceLevel.mockRejectedValue(new Error("offline"));

    fire("INITIAL_SESSION", { user: supabaseUser });
    await flush();

    expect(seen).toEqual([{ status: "unauthenticated", user: null }]);
    unsubscribe();
  });

  it("closes the page on sign-out", async () => {
    const { seen, fire, unsubscribe } = listen(seedFor("Teacher"));

    fire("SIGNED_OUT", null);
    await flush();

    expect(seen).toEqual([{ status: "unauthenticated", user: null }]);
    unsubscribe();
  });

  // A token refresh whose profile read fails keeps an open session open, but
  // only when THAT event's own second-factor check passed. The seed alone is
  // never the proof.
  it("a refresh that proved the session strong survives a failed profile read", async () => {
    const { seen, fire, unsubscribe } = listen(seedFor("Teacher"));
    profileMocks.getUserProfile.mockRejectedValue(new Error("profile read failed"));

    fire("TOKEN_REFRESHED", { user: supabaseUser });
    await flush();

    expect(seen).toEqual([]);
    unsubscribe();
  });

  it("a refresh that could not prove the session strong closes the seeded page", async () => {
    const { seen, fire, client, unsubscribe } = listen(seedFor("Teacher"));
    client.auth.mfa.getAuthenticatorAssuranceLevel.mockRejectedValue(new Error("offline"));

    fire("TOKEN_REFRESHED", { user: supabaseUser });
    await flush();

    expect(seen).toEqual([{ status: "unauthenticated", user: null }]);
    unsubscribe();
  });

  it("hides the seeded account while another account is being verified", async () => {
    const { seen, fire, unsubscribe } = listen(seedFor("Teacher"));
    profileMocks.getUserProfile.mockResolvedValue(profile("Second", "user-2"));

    fire("SIGNED_IN", { user: { ...supabaseUser, id: "user-2" } });
    await flush();

    expect(seen.map((session) => [session.status, session.user?.uid ?? null])).toEqual([
      ["loading", null],
      ["authenticated", "user-2"],
    ]);
    unsubscribe();
  });
});
