import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Aqui o cliente de servidor e o de verdade (com a trava do segundo fator);
// so o Supabase por baixo dele e falso. O route.test.tsx troca o cliente
// inteiro por um falso, entao nao prova a trava.
const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  getUser: vi.fn(),
  getSession: vi.fn(),
  verifyOtp: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: mocks.createServerClient,
}));

vi.mock("@/lib/supabase/config", () => ({
  assertSupabaseClientConfig: () => ({ url: "http://localhost", anonKey: "anon" }),
}));

import { GET } from "@/app/auth/confirm/route";

const ORIGIN = "https://skillsetmind.com";
const COURSE = "/welcome?path=student&returnTo=%2Fcourses%2Ffocus";
const EXPIRED_SIGNUP_LINK = `${ORIGIN}/auth/confirm?token_hash=abc&type=signup&redirect_to=${encodeURIComponent(`${ORIGIN}/auth/confirm?next=${encodeURIComponent(COURSE)}`)}`;

function token(aal: string) {
  return `header.${Buffer.from(JSON.stringify({ aal })).toString("base64url")}.signature`;
}

// Conta confirmada, com app autenticador, numa sessao com ou sem o codigo.
function signedIn(aal: "aal1" | "aal2") {
  mocks.getUser.mockResolvedValue({
    data: {
      user: {
        id: "u-1",
        email_confirmed_at: "2026-10-01T00:00:00Z",
        factors: [{ id: "f-1", factor_type: "totp", status: "verified" }],
      },
    },
    error: null,
  });
  mocks.getSession.mockResolvedValue({ data: { session: { access_token: token(aal) } }, error: null });
}

describe("/auth/confirm 'already confirmed, go inside' keeps the second factor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyOtp.mockResolvedValue({ error: { code: "otp_expired", message: "Token has expired or is invalid" } });
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    mocks.createServerClient.mockReturnValue({
      auth: { getUser: mocks.getUser, getSession: mocks.getSession, verifyOtp: mocks.verifyOtp },
      rpc: mocks.rpc,
    });
  });

  it("does not let a session that still owes the authenticator code in", async () => {
    signedIn("aal1");

    const response = await GET(new NextRequest(EXPIRED_SIGNUP_LINK));

    expect(mocks.getUser).toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      `${ORIGIN}/login?error=confirm_expired&path=student&returnTo=%2Fcourses%2Ffocus`,
    );
  });

  it("lets the same account in once the code was entered (aal2)", async () => {
    signedIn("aal2");

    const response = await GET(new NextRequest(EXPIRED_SIGNUP_LINK));

    expect(response.headers.get("location")).toBe(
      `${ORIGIN}/loading?next=welcome&path=student&returnTo=%2Fcourses%2Ffocus`,
    );
  });
});
