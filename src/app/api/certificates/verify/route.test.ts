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

  // The bug (A-28): the route sent the visitor's raw IP as p_rate_key. Every
  // other public route goes through the helper that hashes it; this was the
  // only one that slipped past, and it is the most exposed one (CORS "*",
  // embedded in third-party sites, visitors who never set foot on the platform).
  it("never hands the visitor's address to the database, only the hashed key", async () => {
    await verify();

    const [fn, args] = mocks.rpc.mock.calls[0] as [string, RpcArgs];
    expect(fn).toBe("verify_skillset_certificate");
    expect(args.p_code).toBe("SK-ABC-123");
    expect(args.p_rate_key).not.toContain(IP);
    expect(args.p_rate_key).toMatch(/^cert_[0-9a-f]{24}$/);
  });

  it("uses the same key the rest of the public routes give this visitor", async () => {
    await verify();

    const [, args] = mocks.rpc.mock.calls[0] as [string, RpcArgs];
    const expected = rateLimitKeyFromIp(
      new Request("http://localhost/x", { headers: { "x-forwarded-for": FORWARDED } }),
      "cert",
    );
    expect(args.p_rate_key).toBe(expected);
  });

  it("translates RATE_LIMIT into 429 with the usual open CORS", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "RATE_LIMIT" } });

    const response = await verify();

    expect(response.status).toBe(429);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    // A code the rate limit refused is never looked up a second way.
    expect(mocks.lookups).toBe(0);
  });

  // The RPC only vouches for issued certificates. For a certificate revoked by
  // operations ('revoked') or by a full refund/lost chargeback
  // ('refund_revoked'), the route says "revoked" instead of "does not exist".
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
