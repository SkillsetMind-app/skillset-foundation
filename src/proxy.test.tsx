// @vitest-environment node
//
// The proxy is server code and NextResponse.next() rejects a Headers that
// is not the runtime's own class — jsdom supplies a different one, so this
// file runs in node rather than the suite default.

import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  notifyOps: vi.fn(),
  getSupabaseClientConfig: vi.fn(() => null),
}));

vi.mock("@/lib/ops/alert", () => ({ notifyOps: mocks.notifyOps }));

// Returning null short-circuits the session refresh, so an allowed request
// never reaches Supabase in these tests.
vi.mock("@/lib/supabase/config", () => ({
  getSupabaseClientConfig: mocks.getSupabaseClientConfig,
}));

async function run(
  path: string,
  country: string | null,
  allowList?: string,
) {
  vi.resetModules();
  if (allowList === undefined) {
    delete process.env.GEO_ALLOWED_COUNTRIES;
  } else {
    process.env.GEO_ALLOWED_COUNTRIES = allowList;
  }
  const { proxy } = await import("@/proxy");
  const headers = new Headers();
  if (country !== null) {
    headers.set("x-vercel-ip-country", country);
  }
  return proxy(
    new NextRequest(`https://www.skillsetmind.com${path}`, { headers }),
  );
}

afterEach(() => {
  delete process.env.GEO_ALLOWED_COUNTRIES;
  vi.clearAllMocks();
});

describe("country filter in the proxy", () => {
  it("leaves the public site open to everyone", async () => {
    // The proxy matcher covers every route because the session refresh needs
    // it. If the country check ever leaked past the guarded list, the homepage
    // would go dark for most of the world — so this is asserted first, and
    // with a list configured, since without one nothing is filtered at all.
    for (const path of ["/", "/courses", "/pricing", "/instructors"]) {
      const response = await run(path, "RU", "US,BR");
      expect(response.status, path).toBe(200);
      const csp = response.headers.get("content-security-policy") ?? "";
      expect(csp).toContain("script-src 'self' 'nonce-");
      expect(csp).not.toContain("'unsafe-eval'");
      expect(csp).not.toContain("'unsafe-inline' https://connect-js.stripe.com");
    }
    expect(mocks.notifyOps).not.toHaveBeenCalled();
  });

  it("filters nobody by default", async () => {
    // The platform is not limited by country. With no GEO_ALLOWED_COUNTRIES
    // set, every country reaches every door — this is the shipped behaviour,
    // and the most important thing in this file to keep true.
    for (const country of ["US", "BR", "RU", "CN", "PT"]) {
      const response = await run("/auth", country);
      expect(response.status, country).toBe(200);
    }
    expect(mocks.notifyOps).not.toHaveBeenCalled();
  });

  it("allows a country on the list once a list exists", async () => {
    const response = await run("/auth", "US", "US,BR");
    expect(response.status).toBe(200);
    expect(mocks.notifyOps).not.toHaveBeenCalled();
  });

  it("refuses a guarded path from a country off the list, and reports it", async () => {
    const response = await run("/auth", "RU", "US,BR");
    expect(response.status).toBe(403);
    expect(mocks.notifyOps).toHaveBeenCalledTimes(1);
  });

  it("guards the payment and auth APIs too, once a list exists", async () => {
    for (const path of ["/api/payments/checkout", "/api/auth/pwned-check"]) {
      const response = await run(path, "RU", "US,BR");
      expect(response.status, path).toBe(403);
    }
  });

  it("leaves the OAuth and email-confirmation return legs open", async () => {
    // These are return legs of a flow that already passed the check, and a
    // confirmation link opened from an email client on another network still
    // has to complete.
    for (const path of ["/auth/callback", "/auth/confirm"]) {
      const response = await run(path, "RU", "US,BR");
      expect(response.status, path).toBe(200);
    }
  });

  it("allows when the country is unknown", async () => {
    // Fails open on purpose. A filter that blocks whenever the signal is
    // missing takes the platform down the first time the header hiccups.
    const response = await run("/auth", null, "US,BR");
    expect(response.status).toBe(200);
  });

  it("allows everything when the list is emptied", async () => {
    // Emptying the variable is how the filter gets switched off in a hurry. It
    // has to mean "allow all", never "allow none".
    const response = await run("/auth", "RU", "");
    expect(response.status).toBe(200);
  });

  it("reads the list from the environment, tolerating spaces and case", async () => {
    const response = await run("/auth", "PT", " us , pt ");
    expect(response.status).toBe(200);
  });
});
