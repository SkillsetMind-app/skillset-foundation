import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthSession } from "@/domain/auth";

const supabaseMocks = vi.hoisted(() => ({
  getSupabaseBrowserClient: vi.fn(),
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

import {
  getCurrentAuthSession,
  getPendingSecondFactor,
  listenToAuthState,
} from "@/lib/auth/supabase-auth";

// WHY THIS FILE EXISTS (A-17)
//
// `signInWithPassword` stores the aal1 session cookie BEFORE the TOTP code
// is requested. The listener emitted "authenticated" for any session with a
// user, without looking at the assurance level (AAL), and every guard in the app only looked at
// `user`. Someone with only the password closed the code screen and got into the whole
// account. There was not a single MFA test in the repository.
//
// The contract proven here: an aal1 session of an account with a verified factor becomes the
// dedicated `mfa_required` state (user null), never "authenticated"; after the
// code, the same session becomes "authenticated"; an account with no factor goes straight in.

type StateHandler = (event: string, session: unknown) => void;
type Level = "aal1" | "aal2";
type Assurance = { currentLevel: Level; nextLevel: Level };

const supabaseUser = {
  id: "user-1",
  email: "teacher@example.com",
  email_confirmed_at: "2026-01-01T00:00:00Z",
  user_metadata: { name: "Teacher" },
};

function buildClient(initial: Assurance, user: unknown = supabaseUser) {
  let handler: StateHandler | null = null;
  let assurance = initial;

  const client = {
    rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
    auth: {
      getUser: async () => ({ data: { user }, error: null }),
      mfa: {
        getAuthenticatorAssuranceLevel: async () => ({
          data: assurance,
          error: null,
        }),
        listFactors: async () => ({
          data: { totp: [{ id: "factor-1", status: "verified" }] },
          error: null,
        }),
      },
      onAuthStateChange: (callback: StateHandler) => {
        handler = callback;
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
    },
  };

  return {
    client,
    setAssurance: (next: Assurance) => {
      assurance = next;
    },
    fire: (event: string, session: unknown) => handler?.(event, session),
  };
}

// The profile read is deferred with setTimeout(0) and then awaits promises;
// alternating between macrotask and microtask drains both queues.
async function flush() {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function statuses(seen: AuthSession[]) {
  return seen
    .map((session) => session.status)
    .filter((status) => status !== "loading");
}

const PENDING: Assurance = { currentLevel: "aal1", nextLevel: "aal2" };
const VERIFIED: Assurance = { currentLevel: "aal2", nextLevel: "aal2" };
const NO_FACTOR: Assurance = { currentLevel: "aal1", nextLevel: "aal1" };

describe("listenToAuthState — the password alone does not open an account with TOTP", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    profileMocks.getUserProfile.mockResolvedValue({
      uid: "user-1",
      email: "teacher@example.com",
      displayName: "Teacher",
      photoURL: null,
      roles: ["teacher"],
    });
    profileMocks.upsertUserProfile.mockResolvedValue(undefined);
  });

  it("aal1 session of an account with a factor: emits mfa_required, never authenticated", async () => {
    const harness = buildClient(PENDING);
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(harness.client);

    const seen: AuthSession[] = [];
    listenToAuthState((session) => seen.push(session));

    harness.fire("SIGNED_IN", { user: supabaseUser });
    await flush();

    expect(statuses(seen)).toEqual(["mfa_required"]);
    expect(seen.at(-1)?.user).toBeNull();
    // Not even the profile is read: nothing from the account reaches the app before the code.
    expect(profileMocks.getUserProfile).not.toHaveBeenCalled();
    expect(harness.client.rpc).not.toHaveBeenCalled();
  });

  it("after the code, the same session becomes authenticated", async () => {
    const harness = buildClient(PENDING);
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(harness.client);

    const seen: AuthSession[] = [];
    listenToAuthState((session) => seen.push(session));

    harness.fire("SIGNED_IN", { user: supabaseUser });
    await flush();

    // mfa.verify swaps the session for an aal2 one and Supabase notifies the listener.
    harness.setAssurance(VERIFIED);
    harness.fire("MFA_CHALLENGE_VERIFIED", { user: supabaseUser });
    await flush();

    expect(statuses(seen)).toEqual(["mfa_required", "authenticated"]);
    expect(seen.at(-1)?.user?.displayName).toBe("Teacher");
    expect(harness.client.rpc).toHaveBeenCalledWith("claim_my_course_grants");
  });

  it.each(["INITIAL_SESSION", "TOKEN_REFRESHED", "SIGNED_IN"])("claims before emitting %s, including OTP and Google sessions", async (event) => {
    const harness = buildClient(VERIFIED);
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(harness.client);
    const seen: AuthSession[] = [];
    const claimsAtEmit: number[] = [];
    listenToAuthState((session) => {
      if (session.status === "authenticated") claimsAtEmit.push(harness.client.rpc.mock.calls.length);
      seen.push(session);
    });
    harness.fire(event, { user: supabaseUser });
    await flush();
    expect(statuses(seen)).toEqual(["authenticated"]);
    expect(claimsAtEmit).toEqual([1]);
  });

  it("an account with no factor goes straight in: anyone not using MFA sees no change", async () => {
    const harness = buildClient(NO_FACTOR);
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(harness.client);

    const seen: AuthSession[] = [];
    listenToAuthState((session) => seen.push(session));

    harness.fire("SIGNED_IN", { user: supabaseUser });
    await flush();

    expect(statuses(seen)).toEqual(["authenticated"]);
  });
});

describe("getCurrentAuthSession — the provider's refreshUser() goes through the same gate", () => {
  it("claims confirmed-email grants before returning authentication, and retries after failure", async () => {
    const { client } = buildClient(VERIFIED);
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(client);
    profileMocks.getUserProfile.mockResolvedValue(null);
    client.rpc.mockResolvedValueOnce({ data: null, error: { message: "offline" } });
    expect((await getCurrentAuthSession()).status).toBe("authenticated");
    expect(client.rpc).toHaveBeenCalledWith("claim_my_course_grants");
    expect((await getCurrentAuthSession()).status).toBe("authenticated");
    expect(client.rpc).toHaveBeenCalledTimes(2);
  });

  it("does not claim grants before MFA", async () => {
    const { client } = buildClient(PENDING);
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(client);
    expect((await getCurrentAuthSession()).status).toBe("mfa_required");
    expect(client.rpc).not.toHaveBeenCalled();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    profileMocks.getUserProfile.mockResolvedValue(null);
  });

  it("aal1 session of an account with a factor is mfa_required, with a null user", async () => {
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(
      buildClient(PENDING).client,
    );

    await expect(getCurrentAuthSession()).resolves.toEqual({
      status: "mfa_required",
      user: null,
    });
  });

  it("aal2 session is authenticated", async () => {
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(
      buildClient(VERIFIED).client,
    );

    const session = await getCurrentAuthSession();

    expect(session.status).toBe("authenticated");
    expect(session.user?.uid).toBe("user-1");
  });

  it("no user is unauthenticated", async () => {
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(
      buildClient(NO_FACTOR, null).client,
    );

    await expect(getCurrentAuthSession()).resolves.toEqual({
      status: "unauthenticated",
      user: null,
    });
  });
});

describe("getPendingSecondFactor — the login screen resumes the abandoned challenge", () => {
  it("returns the verified factor when the aal1 session still owes the code", async () => {
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(
      buildClient(PENDING).client,
    );

    const pending = await getPendingSecondFactor();

    expect(pending?.factorId).toBe("factor-1");
    expect(pending?.code).toBe("auth/multi-factor-auth-required");
  });

  it("returns null when nothing is pending", async () => {
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(
      buildClient(NO_FACTOR).client,
    );

    await expect(getPendingSecondFactor()).resolves.toBeNull();
  });
});

describe("aal1 session without the Auth factor list: the database decides", () => {
  // Without `user.factors`, Supabase answers nextLevel "aal1" even on an account
  // with TOTP, and the client's list comes out empty. The database decides; the factor
  // id comes from the server route.
  function hiddenFactors(strong: boolean, allowed = true) {
    const harness = buildClient(NO_FACTOR);
    harness.client.rpc.mockImplementation((name: string) =>
      Promise.resolve({
        data: name === "session_is_strong" ? strong : name === "account_session_allowed" ? allowed : [],
        error: null,
      }),
    );
    harness.client.auth.mfa.listFactors = async () => ({ data: { totp: [] }, error: null });
    return harness;
  }

  function serverFactors(factors: unknown[]) {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ factors }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    profileMocks.getUserProfile.mockResolvedValue(null);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("database says weak and released: mfa_required, and the factor comes from the server route", async () => {
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(hiddenFactors(false).client);
    const fetchMock = serverFactors([
      { id: "factor-old", factorType: "totp", status: "unverified" },
      { id: "factor-9", factorType: "totp", status: "verified" },
    ]);

    expect((await getCurrentAuthSession()).status).toBe("mfa_required");
    const pending = await getPendingSecondFactor();

    expect(pending?.factorId).toBe("factor-9");
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/second-factor", expect.objectContaining({ cache: "no-store" }));
  });

  it("the listener holds too: nothing from the account reaches the app before the code", async () => {
    const harness = hiddenFactors(false);
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(harness.client);
    const seen: AuthSession[] = [];
    listenToAuthState((session) => seen.push(session));

    harness.fire("SIGNED_IN", { user: supabaseUser });
    await flush();

    expect(statuses(seen)).toEqual(["mfa_required"]);
    expect(profileMocks.getUserProfile).not.toHaveBeenCalled();
  });

  it("database says strong: goes straight in and does not even ask for the factors", async () => {
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(hiddenFactors(true).client);
    const fetchMock = serverFactors([]);

    expect((await getCurrentAuthSession()).status).toBe("authenticated");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a blocked account does not become a code request or an authenticated session in the interface", async () => {
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(hiddenFactors(false, false).client);

    expect((await getCurrentAuthSession()).status).toBe("unauthenticated");
    expect(profileMocks.getUserProfile).not.toHaveBeenCalled();
  });

  it("route down: owes the code and the factor did not come -> network error, never goes on as logged in", async () => {
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(hiddenFactors(false).client);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 503 })));

    await expect(getPendingSecondFactor()).rejects.toThrow(/network/);
  });
});
