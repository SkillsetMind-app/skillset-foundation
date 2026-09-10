// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  client: vi.fn(), getUser: vi.fn(), rpc: vi.fn(), admin: vi.fn(),
  config: vi.fn(), add: vi.fn(), limit: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.client }));
vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdminClient: mocks.admin }));
vi.mock("@/lib/domains/server/vercel-domains", () => ({
  vercelDomainsConfig: mocks.config,
  addDomainToProject: mocks.add,
}));
vi.mock("@/lib/payments/server/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/payments/server/auth")>()),
  enforceRateLimit: mocks.limit,
}));

import { POST } from "./route";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: "local-qa-teacher" } }, error: null });
  mocks.client.mockResolvedValue({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc });
  mocks.limit.mockResolvedValue(undefined);
  mocks.config.mockReturnValue({
    apiCredential: "LOCAL_QA_NOT_A_CREDENTIAL",
    projectId: "local-qa-project",
    teamId: "local-qa-team",
  });
});

describe("POST /api/teach/domains — o banco recusa quem não tem ativação (P2-5)", () => {
  it("responde 402 com a frase de ativação e não chega na Vercel", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "Pay the one-time activation fee before connecting a custom domain." },
    });
    const response = await POST(new Request("http://localhost/api/teach/domains", {
      method: "POST",
      body: JSON.stringify({ hostname: "draft.example.com" }),
    }));
    expect(response.status).toBe(402);
    expect(await response.json()).toEqual({
      error: "Pay the one-time activation fee before connecting a custom domain.",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("claim_custom_domain", { p_hostname: "draft.example.com" });
    expect(mocks.add).not.toHaveBeenCalled();
    expect(mocks.admin).not.toHaveBeenCalled();
  });
});
