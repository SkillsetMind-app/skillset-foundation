import { createHash } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { rateLimitKeyFromIp } from "@/lib/supabase/rate-limit";

// Imported by the module under test for the RPC path only; never called here.
vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdminClient: () => ({}) }));

const IP = "203.0.113.7";

function requestFrom(ip: string) {
  return new Request("http://localhost/api/x", {
    headers: { "x-forwarded-for": `${ip}, 10.0.0.1` },
  });
}

const plainSha256 = createHash("sha256").update(IP).digest("hex").slice(0, 24);

describe("rateLimitKeyFromIp", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // O bug (A-28): um sha256 puro de IPv4 é uma tabela de consulta de 4 bilhões
  // de linhas — o balde "anonimizado" continuava sendo o endereço, disfarçado.
  it("com pepper, o balde não é o sha256 puro do endereço", () => {
    vi.stubEnv("RATE_LIMIT_PEPPER", "unit-test-pepper");

    const bucket = rateLimitKeyFromIp(requestFrom(IP), "csp");

    expect(bucket).toMatch(/^csp_[0-9a-f]{24}$/);
    expect(bucket).not.toBe(`csp_${plainSha256}`);
    expect(bucket).not.toContain(IP);
  });

  it("é estável para o mesmo visitante e distinto entre visitantes", () => {
    vi.stubEnv("RATE_LIMIT_PEPPER", "unit-test-pepper");

    expect(rateLimitKeyFromIp(requestFrom(IP), "csp")).toBe(
      rateLimitKeyFromIp(requestFrom(IP), "csp"),
    );
    expect(rateLimitKeyFromIp(requestFrom("198.51.100.9"), "csp")).not.toBe(
      rateLimitKeyFromIp(requestFrom(IP), "csp"),
    );
  });

  it("outro pepper, outro balde — o hash depende do segredo do servidor", () => {
    vi.stubEnv("RATE_LIMIT_PEPPER", "pepper-a");
    const primeiro = rateLimitKeyFromIp(requestFrom(IP), "csp");

    vi.stubEnv("RATE_LIMIT_PEPPER", "pepper-b");
    expect(rateLimitKeyFromIp(requestFrom(IP), "csp")).not.toBe(primeiro);
  });

  it("sem pepper cai no sha256 puro, para não travar um ambiente sem a variável", () => {
    vi.stubEnv("RATE_LIMIT_PEPPER", "");

    expect(rateLimitKeyFromIp(requestFrom(IP), "csp")).toBe(`csp_${plainSha256}`);
  });
});
