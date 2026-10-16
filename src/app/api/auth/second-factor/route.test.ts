import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getUser: vi.fn(),
  listFactors: vi.fn(),
  allow: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { getSession: mocks.getSession } }),
}));

vi.mock("@/lib/supabase/rate-limit", () => ({ allowByIp: () => mocks.allow() }));

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdminClient: () => ({
    auth: { getUser: mocks.getUser, admin: { mfa: { listFactors: mocks.listFactors } } },
  }),
}));

import { GET } from "@/app/api/auth/second-factor/route";

const session = (token: string | null) => ({ data: { session: token ? { access_token: token } : null }, error: null });

describe("GET /api/auth/second-factor — os fatores da propria conta", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.allow.mockResolvedValue(true);
    mocks.getSession.mockResolvedValue(session("token-aal1"));
    mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    mocks.listFactors.mockResolvedValue({
      data: {
        factors: [
          { id: "f-1", factor_type: "totp", status: "verified", friendly_name: "Phone", created_at: "2026-09-10T00:00:00Z", updated_at: "2026-09-10T00:00:00Z", secret: "nunca" },
        ],
      },
      error: null,
    });
  });

  it("sem sessao: 401 e nada consultado", async () => {
    mocks.getSession.mockResolvedValue(session(null));
    const response = await GET(new Request("https://www.skillsetmind.com/api/auth/second-factor"));
    expect(response.status).toBe(401);
    expect(mocks.listFactors).not.toHaveBeenCalled();
  });

  it("token que o GoTrue nao confirma: 401", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { message: "invalid JWT" } });
    const response = await GET(new Request("https://www.skillsetmind.com/api/auth/second-factor"));
    expect(response.status).toBe(401);
    expect(mocks.listFactors).not.toHaveBeenCalled();
  });

  it("lista so os fatores do dono do token, sem campo alem do necessario e sem cache", async () => {
    const response = await GET(new Request("https://www.skillsetmind.com/api/auth/second-factor"));
    expect(mocks.getUser).toHaveBeenCalledWith("token-aal1");
    expect(mocks.listFactors).toHaveBeenCalledWith({ userId: "user-1" });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.json();
    expect(body).toEqual({
      factors: [{
        id: "f-1", factorType: "totp", status: "verified", friendlyName: "Phone",
        createdAt: "2026-09-10T00:00:00Z", updatedAt: "2026-09-10T00:00:00Z",
      }],
    });
    expect(JSON.stringify(body)).not.toContain("nunca");
  });

  it("lista indisponivel: 503, sem detalhe do provedor", async () => {
    mocks.listFactors.mockResolvedValue({ data: null, error: { message: "private detail" } });
    const response = await GET(new Request("https://www.skillsetmind.com/api/auth/second-factor"));
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("private");
  });

  it("limite por IP: 429 antes de qualquer consulta", async () => {
    mocks.allow.mockResolvedValue(false);
    const response = await GET(new Request("https://www.skillsetmind.com/api/auth/second-factor"));
    expect(response.status).toBe(429);
    expect(mocks.getSession).not.toHaveBeenCalled();
  });
});
