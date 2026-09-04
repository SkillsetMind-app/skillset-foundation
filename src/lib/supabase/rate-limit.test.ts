import { createHash } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { allowByIp, rateLimitKeyFromIp } from "@/lib/supabase/rate-limit";

// Imported by the module under test for the RPC path only; never called here.
vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdminClient: () => ({}) }));

const IP = "203.0.113.7";

function requestFrom(ip: string) {
  return new Request("http://localhost/api/x", {
    headers: {
      "x-real-ip": ip,
      "x-forwarded-for": `spoofed-by-client, ${ip}`,
    },
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

  // Segunda metade do A-28: o fallback NÃO pode ser a service role. Aquela chave
  // existe para ignorar RLS; costurar uma leitura pública nela faz a rotação de
  // uma resetar silenciosamente a outra, e qualquer valor derivado que vaze vira
  // material para testar a chave real. Sem pepper dedicado o balde continua não
  // sendo o sha256 puro — e não se mexe quando a service role muda.
  it("sem pepper dedicado, o balde não é o sha256 puro nem depende da service role", () => {
    vi.stubEnv("RATE_LIMIT_PEPPER", "");

    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-a");
    const comA = rateLimitKeyFromIp(requestFrom(IP), "csp");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-b");
    const comB = rateLimitKeyFromIp(requestFrom(IP), "csp");

    expect(comA).not.toBe(`csp_${plainSha256}`);
    expect(comA).toBe(comB);
  });

  // O bug que o próprio conserto do pepper criou: rateLimitKeyFromIp era
  // avaliada como ARGUMENTO de allowByKey, então qualquer throw ali subia antes
  // do try/catch e derrubava a rota pública inteira (csp-report, pwned-check,
  // ofertas, preview de vídeo) em vez de apenas pular o limitador.
  it("allowByIp falha ABERTO quando a montagem da chave quebra", async () => {
    const requestQuebrada = {
      headers: {
        get() {
          throw new Error("header store indisponível");
        },
      },
    } as unknown as Request;

    await expect(allowByIp(requestQuebrada, "csp", 60, 60_000)).resolves.toBe(true);
  });

  it("ignora o primeiro x-forwarded-for controlável quando x-real-ip existe", () => {
    vi.stubEnv("RATE_LIMIT_PEPPER", "unit-test-pepper");
    const trusted = rateLimitKeyFromIp(requestFrom(IP), "csp");
    const forged = new Request("http://localhost/api/x", {
      headers: { "x-real-ip": IP, "x-forwarded-for": "1.2.3.4, 10.0.0.1" },
    });
    expect(rateLimitKeyFromIp(forged, "csp")).toBe(trusted);
  });
});
