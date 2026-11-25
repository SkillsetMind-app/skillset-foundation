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

  // The bug (A-28): a plain sha256 of an IPv4 is a lookup table of 4 billion
  // rows — the "anonymized" bucket was still the address, in disguise.
  it("with a pepper, the bucket is not the plain sha256 of the address", () => {
    vi.stubEnv("RATE_LIMIT_PEPPER", "unit-test-pepper");

    const bucket = rateLimitKeyFromIp(requestFrom(IP), "csp");

    expect(bucket).toMatch(/^csp_[0-9a-f]{24}$/);
    expect(bucket).not.toBe(`csp_${plainSha256}`);
    expect(bucket).not.toContain(IP);
  });

  it("is stable for the same visitor and distinct between visitors", () => {
    vi.stubEnv("RATE_LIMIT_PEPPER", "unit-test-pepper");

    expect(rateLimitKeyFromIp(requestFrom(IP), "csp")).toBe(
      rateLimitKeyFromIp(requestFrom(IP), "csp"),
    );
    expect(rateLimitKeyFromIp(requestFrom("198.51.100.9"), "csp")).not.toBe(
      rateLimitKeyFromIp(requestFrom(IP), "csp"),
    );
  });

  it("a different pepper gives a different bucket — the hash depends on the server secret", () => {
    vi.stubEnv("RATE_LIMIT_PEPPER", "pepper-a");
    const primeiro = rateLimitKeyFromIp(requestFrom(IP), "csp");

    vi.stubEnv("RATE_LIMIT_PEPPER", "pepper-b");
    expect(rateLimitKeyFromIp(requestFrom(IP), "csp")).not.toBe(primeiro);
  });

  // Second half of A-28: the fallback must NOT be the service role. That key
  // exists to bypass RLS; tying a public read to it makes rotating one silently
  // reset the other, and any derived value that leaks becomes material for
  // testing the real key. Without a dedicated pepper the bucket still is not
  // the plain sha256 — and it does not change when the service role changes.
  it("without a dedicated pepper, the bucket is not the plain sha256 and does not depend on the service role", () => {
    vi.stubEnv("RATE_LIMIT_PEPPER", "");

    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-a");
    const comA = rateLimitKeyFromIp(requestFrom(IP), "csp");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-b");
    const comB = rateLimitKeyFromIp(requestFrom(IP), "csp");

    expect(comA).not.toBe(`csp_${plainSha256}`);
    expect(comA).toBe(comB);
  });

  // The bug the pepper fix itself created: rateLimitKeyFromIp was evaluated as
  // an ARGUMENT of allowByKey, so any throw there rose before the try/catch and
  // took down the whole public route (csp-report, pwned-check, offers, video
  // preview) instead of just skipping the limiter.
  it("allowByIp fails OPEN when building the key breaks", async () => {
    const requestQuebrada = {
      headers: {
        get() {
          throw new Error("header store unavailable");
        },
      },
    } as unknown as Request;

    await expect(allowByIp(requestQuebrada, "csp", 60, 60_000)).resolves.toBe(true);
  });

  it("ignores the first, client-controllable x-forwarded-for when x-real-ip exists", () => {
    vi.stubEnv("RATE_LIMIT_PEPPER", "unit-test-pepper");
    const trusted = rateLimitKeyFromIp(requestFrom(IP), "csp");
    const forged = new Request("http://localhost/api/x", {
      headers: { "x-real-ip": IP, "x-forwarded-for": "1.2.3.4, 10.0.0.1" },
    });
    expect(rateLimitKeyFromIp(forged, "csp")).toBe(trusted);
  });
});
