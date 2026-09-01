import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/certificates/verify/route";
import { rateLimitKeyFromIp } from "@/lib/supabase/rate-limit";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ rpc: mocks.rpc }),
}));

vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdminClient: () => ({}) }));

const IP = "203.0.113.7";
const FORWARDED = `${IP}, 10.0.0.1`;

type RpcArgs = { p_code: string; p_rate_key: string };

function verify(code = "sk-abc-123") {
  return GET(
    new NextRequest(`http://localhost/api/certificates/verify?code=${code}`, {
      headers: { "x-forwarded-for": FORWARDED },
    }),
  );
}

describe("GET /api/certificates/verify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rpc.mockResolvedValue({ data: { valid: false }, error: null });
  });

  // O bug (A-28): a rota mandava o IP cru do visitante como p_rate_key. Todas
  // as outras rotas públicas passam pelo helper que hasheia; esta era a única
  // que escapava — e é a de maior exposição (CORS "*", embutida em sites de
  // terceiros, visitantes que nunca pisaram na plataforma).
  it("nunca entrega o endereço do visitante ao banco, só a chave hasheada", async () => {
    await verify();

    const [fn, args] = mocks.rpc.mock.calls[0] as [string, RpcArgs];
    expect(fn).toBe("verify_skillset_certificate");
    expect(args.p_code).toBe("SK-ABC-123");
    expect(args.p_rate_key).not.toContain(IP);
    expect(args.p_rate_key).toMatch(/^cert_[0-9a-f]{24}$/);
  });

  it("usa a mesma chave que o resto das rotas públicas dá a este visitante", async () => {
    await verify();

    const [, args] = mocks.rpc.mock.calls[0] as [string, RpcArgs];
    const esperada = rateLimitKeyFromIp(
      new Request("http://localhost/x", { headers: { "x-forwarded-for": FORWARDED } }),
      "cert",
    );
    expect(args.p_rate_key).toBe(esperada);
  });

  it("traduz RATE_LIMIT em 429 com o CORS aberto de sempre", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "RATE_LIMIT" } });

    const response = await verify();

    expect(response.status).toBe(429);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});
