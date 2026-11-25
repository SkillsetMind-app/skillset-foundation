import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  getUser: vi.fn(),
  getSession: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: mocks.createServerClient,
}));

vi.mock("@/lib/supabase/config", () => ({
  assertSupabaseClientConfig: () => ({
    url: "http://localhost",
    anonKey: "anon",
  }),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";

// WHY THIS FILE EXISTS (A-17)
//
// The aal1 session cookie is written before the TOTP code, and each route
// decides "is the user logged in?" with `auth.getUser()` from the client created
// here — eleven routes via requireUserId, six reading getUser() directly. This
// is the only point every one of them goes through, so this is where a session
// that still owes the second factor starts answering as "no user".
//
// Supabase Auth does not send `user.factors` for the aal1 session, so the list
// cannot be used to decide. The database decides (session_is_strong reads
// auth.mfa_factors).

function token(claims: Record<string, unknown>) {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `header.${payload}.signature`;
}

function sessionWith(accessToken: string) {
  return { data: { session: { access_token: accessToken } }, error: null };
}

const enrolled = {
  id: "user-1",
  factors: [{ id: "f-1", factor_type: "totp", status: "verified" }],
};

const withoutFactor = { id: "user-2", factors: [] };

// How GoTrue answers today for the aal1 session: without the `factors` key.
const factorsHidden = { id: "user-3" };

function verdicts({ strong, allowed }: { strong: unknown; allowed: unknown }) {
  mocks.rpc.mockImplementation((name: string) =>
    Promise.resolve({ data: name === "session_is_strong" ? strong : allowed, error: null }),
  );
}

describe("createSupabaseServerClient — an aal1 session for a TOTP account is not a login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    mocks.createServerClient.mockReturnValue({
      auth: { getUser: mocks.getUser, getSession: mocks.getSession },
      rpc: mocks.rpc,
    });
  });

  it("refuses aal1 when the database says the account owes the code", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: enrolled }, error: null });
    verdicts({ strong: false, allowed: true });

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();

    expect(data.user).toBeNull();
    expect(error).toMatchObject({ code: "mfa_required", status: 401 });
  });

  it("GoTrue without the factor list does not open the account: the database decides", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: factorsHidden }, error: null });
    mocks.getSession.mockResolvedValue(sessionWith(token({ aal: "aal1" })));
    verdicts({ strong: false, allowed: true });

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();

    expect(data.user).toBeNull();
    expect(error).toMatchObject({ code: "mfa_required", status: 401 });
    expect(mocks.rpc).toHaveBeenCalledWith("session_is_strong");
  });

  it("lets the same account in after the code (strong session), with a single query", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: enrolled }, error: null });
    verdicts({ strong: true, allowed: true });

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();

    expect(data.user).toEqual(enrolled);
    expect(error).toBeNull();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("session_is_strong");
  });

  it("an account with no factor passes on aal1: someone who does not use MFA changes nothing", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: withoutFactor },
      error: null,
    });
    verdicts({ strong: true, allowed: true });

    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getUser();

    expect(data.user).toEqual(withoutFactor);
    // The database answers from the JWT: the cookie token is not even read here.
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it("a response with no user passes through intact", async () => {
    const refused = { data: { user: null }, error: { message: "invalid JWT" } };
    mocks.getUser.mockResolvedValue(refused);

    const supabase = await createSupabaseServerClient();

    await expect(supabase.auth.getUser()).resolves.toBe(refused);
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([withoutFactor, enrolled])("refuses a session validated by Auth but blocked in the database ($id)", async user => {
    mocks.getUser.mockResolvedValue({ data: { user }, error: null });
    verdicts({ strong: false, allowed: false });
    const client = await createSupabaseServerClient();
    const { data, error } = await client.auth.getUser();
    expect(mocks.rpc).toHaveBeenCalledWith("session_is_strong");
    expect(mocks.rpc).toHaveBeenCalledWith("account_session_allowed");
    expect(data.user).toBeNull();
    expect(error).toMatchObject({ status: 403, code: "account_access_denied" });
  });

  it.each([
    { data: null, error: null },
    { data: "true", error: null },
    { data: true, error: { message: "private provider detail" } },
  ])("fails closed for an unavailable or invalid verdict %#", async verdict => {
    mocks.getUser.mockResolvedValue({ data: { user: withoutFactor }, error: null });
    mocks.rpc.mockResolvedValue(verdict);
    const client = await createSupabaseServerClient();
    expect((await client.auth.getUser()).data.user).toBeNull();
  });

  it("fails closed on a transport error without exposing diagnostics", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: withoutFactor }, error: null });
    mocks.rpc.mockRejectedValue(new Error("private network detail"));
    const client = await createSupabaseServerClient();
    const response = await client.auth.getUser();
    expect(response.data.user).toBeNull();
    expect(response.error?.message).not.toContain("private");
  });

  it("checks exactly the explicit JWT in both queries, not the cookie of another session", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: withoutFactor }, error: null });
    const strongQuery = Object.assign(Promise.resolve({ data: false, error: null }), { setHeader: vi.fn() });
    const allowedQuery = Object.assign(Promise.resolve({ data: true, error: null }), { setHeader: vi.fn() });
    mocks.rpc.mockImplementation((name: string) => (name === "session_is_strong" ? strongQuery : allowedQuery));
    const client = await createSupabaseServerClient();
    const { data, error } = await client.auth.getUser("synthetic-token");
    expect(data.user).toBeNull();
    expect(error).toMatchObject({ code: "mfa_required" });
    expect(strongQuery.setHeader).toHaveBeenCalledWith("Authorization", "Bearer synthetic-token");
    expect(allowedQuery.setHeader).toHaveBeenCalledWith("Authorization", "Bearer synthetic-token");
    expect(mocks.getSession).not.toHaveBeenCalled();
  });
});
