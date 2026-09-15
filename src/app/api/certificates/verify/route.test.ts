import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/certificates/verify/route";
import { rateLimitKeyFromIp } from "@/lib/supabase/rate-limit";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  // Status of the certificate behind the code, if one exists.
  storedStatus: null as string | null,
  lookups: 0,
  filters: [] as Array<[string, unknown]>,
}));

type LookupQuery = {
  select(): LookupQuery;
  eq(column: string, value: unknown): LookupQuery;
  in(column: string, values: unknown[]): LookupQuery;
  limit(): LookupQuery;
  maybeSingle(): Promise<{ data: unknown; error: null }>;
};

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ rpc: mocks.rpc }),
}));

// Answers like the table would: a row comes back only when its status is in
// the list the route asked for.
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdminClient: () => {
    let statuses: unknown[] = [];
    const query: LookupQuery = {
      select: () => query,
      eq: (column, value) => {
        mocks.filters.push([column, value]);
        return query;
      },
      in: (column, values) => {
        mocks.filters.push([column, values]);
        statuses = values;
        return query;
      },
      limit: () => query,
      maybeSingle: async () => {
        mocks.lookups += 1;
        const match = mocks.storedStatus !== null && statuses.includes(mocks.storedStatus);
        return { data: match ? { status: mocks.storedStatus } : null, error: null };
      },
    };
    return { from: () => query };
  },
}));

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
    mocks.storedStatus = null;
    mocks.lookups = 0;
    mocks.filters.length = 0;
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
    // A code the rate limit refused is never looked up a second way.
    expect(mocks.lookups).toBe(0);
  });

  // O RPC so atesta os emitidos. Certificado revogado pela operacao ('revoked')
  // ou por reembolso integral/chargeback perdido ('refund_revoked'): a rota diz
  // "revogado" em vez de "nao existe".
  it.each(["revoked", "refund_revoked"])("says revoked, not not-found, for a %s certificate", async (status) => {
    mocks.storedStatus = status;

    const response = await verify();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ valid: false, revoked: true });
    expect(mocks.filters[0]).toEqual(["verification_code", "SK-ABC-123"]);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("keeps not-found for a code that matches nothing", async () => {
    const response = await verify();

    expect(await response.json()).toEqual({ valid: false });
  });

  it("does not look up a code the RPC already verified", async () => {
    mocks.rpc.mockResolvedValue({ data: { valid: true, certificate: {} }, error: null });

    await verify();

    expect(mocks.lookups).toBe(0);
  });
});
