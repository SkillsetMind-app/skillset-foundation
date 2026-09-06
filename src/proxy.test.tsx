// @vitest-environment node
//
// The proxy is server code and NextResponse.next() rejects a Headers that
// is not the runtime's own class — jsdom supplies a different one, so this
// file runs in node rather than the suite default.

import { NextRequest } from "next/server";
import {
  getRedirectUrl,
  unstable_doesMiddlewareMatch,
  unstable_getResponseFromNextConfig,
} from "next/experimental/testing/server";
import type { CookieMethodsServer } from "@supabase/ssr";
import { afterEach, describe, expect, it, vi } from "vitest";

import nextConfig from "../next.config";

const mocks = vi.hoisted(() => ({
  notifyOps: vi.fn(),
  getSupabaseClientConfig: vi.fn<() => { url: string; anonKey: string } | null>(() => null),
  resolveHostToUid: vi.fn(),
  createServerClient: vi.fn(),
}));

vi.mock("@/lib/ops/alert", () => ({ notifyOps: mocks.notifyOps }));
vi.mock("@/lib/domains/resolve-host", () => ({ resolveHostToUid: mocks.resolveHostToUid }));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createServerClient }));

// Country-filter tests skip session refresh; session tests supply a local stub.
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
  vi.resetAllMocks();
});

describe("navigation-only platform entry aliases", () => {
  it.each([
    ["app.skillsetmind.com", "GET", "/", "/teach"],
    ["consumer.skillsetmind.com", "GET", "/", "/learn"],
    ["pay.skillsetmind.com", "HEAD", "/courses/fixture/checkout?offer=launch", "/courses/fixture/checkout?offer=launch"],
    ["APP.SKILLSETMIND.COM.:443", "HEAD", "/", "/teach"],
    ["CONSUMER.SKILLSETMIND.COM.:443", "GET", "/", "/learn"],
    ["PAY.SKILLSETMIND.COM.:443", "GET", "/", "/courses"],
  ])("redirects %s %s without looking up a teacher or refreshing a session", async (host, method, path, destination) => {
    vi.resetModules();
    const { proxy } = await import("@/proxy");
    const response = await proxy(new NextRequest(`https://${host}${path}`, { method, headers: { host } }));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`https://skillsetmind.com${destination}`);
    expect(response.headers.get("content-security-policy")).toContain("script-src 'self' 'nonce-");
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(mocks.resolveHostToUid).not.toHaveBeenCalled();
    expect(mocks.getSupabaseClientConfig).not.toHaveBeenCalled();
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });

  it.each([
    "app.skillsetmind.com", "consumer.skillsetmind.com", "pay.skillsetmind.com",
    "APP.SKILLSETMIND.COM.:443", "CONSUMER.SKILLSETMIND.COM.:443", "PAY.SKILLSETMIND.COM.:443",
  ])(
    "refuses writes and OPTIONS on %s without consuming or forwarding their bodies",
    async (host) => {
      vi.resetModules();
      const { config, proxy } = await import("@/proxy");
      for (const path of ["/auth", "/api/payments/checkout", "/api/teach/domains/fixture.png", "/favicon.ico", "/lp", "/lp/fixture"]) {
        const url = `https://${host}${path}`;
        // The config tester selects redirects independently of HTTP method.
        // It must let this request reach the proxy before we assert its 405.
        const configured = await unstable_getResponseFromNextConfig({ url, headers: { host }, nextConfig });
        expect(getRedirectUrl(configured), path).toBeNull();
        expect(unstable_doesMiddlewareMatch({ config, nextConfig, url, headers: { host } }), path).toBe(true);
        for (const method of ["POST", "OPTIONS"]) {
          const request = new NextRequest(url, { method, headers: { host }, body: "fixture-only" });
          const response = await proxy(request);
          expect(response.status, `${method} ${path}`).toBe(405);
          expect(response.headers.get("allow")).toBe("GET, HEAD");
          expect(response.headers.has("location")).toBe(false);
          expect(response.headers.has("set-cookie")).toBe(false);
          expect(response.headers.get("content-security-policy")).toContain("script-src 'self' 'nonce-");
          expect(await response.text()).toBe("");
          expect(request.bodyUsed).toBe(false);
        }
      }
      expect(mocks.resolveHostToUid).not.toHaveBeenCalled();
      expect(mocks.getSupabaseClientConfig).not.toHaveBeenCalled();
      expect(mocks.createServerClient).not.toHaveBeenCalled();
    },
  );
});

describe("Next routing configuration for platform entry aliases", () => {
  const excludedPaths = [
    "/api/teach/domains/fixture.png",
    "/courses/fixture.jpg",
    "/_next/static/fixture.js",
    "/_next/image?url=%2Ffixture.png&w=64&q=90",
    "/favicon.ico",
  ];

  it.each(["app", "consumer", "pay"])("matches every path on %s, including a DNS root dot, case and port", async (entry) => {
    const { config } = await import("@/proxy");
    for (const host of [`${entry}.skillsetmind.com`, `${entry.toUpperCase()}.SKILLSETMIND.COM.:443`]) {
      for (const path of ["/", ...excludedPaths, "/lp", "/lp/fixture"]) {
        expect(unstable_doesMiddlewareMatch({ config, nextConfig, url: `https://${host}${path}`, headers: { host } }), `${host}${path}`).toBe(true);
      }
    }
  });

  it.each([
    "skillsetmind.com", "www.skillsetmind.com", "lp.skillsetmind.com",
    "skillset-foundation-qa.vercel.app", "localhost:3000", "[::1]:3000",
    "teacher.example.test", "myapp.skillsetmind.com", "app.skillsetmind.com.evil.test",
  ])("preserves the existing matcher exclusions on %s", async (host) => {
    const { config } = await import("@/proxy");
    for (const path of excludedPaths) {
      expect(unstable_doesMiddlewareMatch({ config, nextConfig, url: `https://${host}${path}`, headers: { host } }), path).toBe(false);
    }
    expect(unstable_doesMiddlewareMatch({ config, nextConfig, url: `https://${host}/auth`, headers: { host } })).toBe(true);
  });

  it.each(["app", "consumer", "pay"])("lets /lp reach the proxy on %s instead of the earlier landing redirect", async (entry) => {
    const { config, proxy } = await import("@/proxy");
    for (const host of [`${entry}.skillsetmind.com`, `${entry.toUpperCase()}.SKILLSETMIND.COM.:443`]) {
      for (const path of ["/lp", "/lp/fixture"]) {
        const url = `https://${host}${path}?offer=fixture`;
        const configured = await unstable_getResponseFromNextConfig({ url, headers: { host }, nextConfig });
        expect(getRedirectUrl(configured), url).toBeNull();
        expect(unstable_doesMiddlewareMatch({ config, nextConfig, url, headers: { host } })).toBe(true);
        for (const method of ["GET", "HEAD"]) {
          const response = await proxy(new NextRequest(url, { method, headers: { host } }));
          expect(response.status).toBe(307);
          expect(response.headers.get("location")).toBe(`https://skillsetmind.com${path}?offer=fixture`);
        }
      }
    }
    expect(mocks.resolveHostToUid).not.toHaveBeenCalled();
    expect(mocks.getSupabaseClientConfig).not.toHaveBeenCalled();
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });

  it.each(["app", "consumer", "pay"])("keeps native trailing-slash normalization on %s before refusing the preserved POST", async (entry) => {
    const { config, proxy } = await import("@/proxy");
    for (const host of [`${entry}.skillsetmind.com`, `${entry.toUpperCase()}.SKILLSETMIND.COM.:443`]) {
      for (const path of ["/auth/", "/lp/", "/lp/fixture/", "/api/teach/domains/fixture.png/"]) {
        const url = `https://${host}${path}?from=fixture`;
        const request = new NextRequest(url, { method: "POST", headers: { host }, body: "fixture-only" });
        const normalized = await unstable_getResponseFromNextConfig({ url, headers: { host }, nextConfig });
        expect(normalized.status).toBe(308);
        const destination = new URL(getRedirectUrl(normalized)!);
        expect(destination.origin).toBe(new URL(url).origin);
        expect(destination.pathname).toBe(path.slice(0, -1));
        expect(destination.search).toBe("?from=fixture");

        // The config tester uses GET internally. Simulate the follow-up that
        // a 308 requires: same origin, with the original method and body.
        const followedRequest = new NextRequest(destination, {
          method: request.method,
          headers: request.headers,
          body: request.body,
        });
        expect(followedRequest.method).toBe("POST");
        const canonical = await unstable_getResponseFromNextConfig({ url: destination.href, headers: { host }, nextConfig });
        expect(getRedirectUrl(canonical)).toBeNull();
        expect(unstable_doesMiddlewareMatch({ config, nextConfig, url: destination.href, headers: { host } })).toBe(true);
        const response = await proxy(followedRequest);
        expect(response.status).toBe(405);
        expect(response.headers.get("allow")).toBe("GET, HEAD");
        expect(response.headers.has("location")).toBe(false);
        expect(response.headers.has("set-cookie")).toBe(false);
        expect(await response.text()).toBe("");
        expect(request.bodyUsed).toBe(false);
        expect(followedRequest.bodyUsed).toBe(false);
      }
    }
    expect(mocks.resolveHostToUid).not.toHaveBeenCalled();
    expect(mocks.getSupabaseClientConfig).not.toHaveBeenCalled();
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });

  it.each([
    "skillsetmind.com", "www.skillsetmind.com", "lp.skillsetmind.com", "teacher.example.test",
    "skillset-foundation-qa.vercel.app", "localhost:3000", "myapp.skillsetmind.com", "app.skillsetmind.com.evil.test",
  ])("keeps the existing /lp redirect on %s", async (host) => {
    for (const path of ["/lp", "/lp/fixture"]) {
      const response = await unstable_getResponseFromNextConfig({ url: `https://${host}${path}?from=fixture`, headers: { host }, nextConfig });
      expect(response.status).toBe(307);
      const destination = new URL(getRedirectUrl(response)!);
      expect(destination.origin).toBe("https://lp.skillsetmind.com");
      expect(destination.pathname).toBe(path === "/lp" ? "/" : "/fixture");
      expect(destination.searchParams.get("from")).toBe("fixture");
    }
  });
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

describe("security headers across proxy response paths", () => {
  it("forwards a fresh nonce and CSP through a custom-domain rewrite despite forged input", async () => {
    vi.resetModules();
    mocks.resolveHostToUid.mockResolvedValue("teacher-fixture");
    const { proxy } = await import("@/proxy");
    const nonces = new Set<string>();

    for (let requestNumber = 0; requestNumber < 2; requestNumber += 1) {
      const response = await proxy(new NextRequest("https://teacher.example.test/?from=audit", {
        headers: {
          host: "teacher.example.test",
          "x-nonce": "forged-nonce",
          "content-security-policy": "script-src 'nonce-forged-nonce' 'unsafe-inline'",
        },
      }));

      expect(response.headers.get("x-middleware-rewrite"))
        .toBe("https://teacher.example.test/instructors/teacher-fixture?from=audit");
      const nonce = response.headers.get("x-middleware-request-x-nonce");
      expect(typeof nonce).toBe("string");
      expect(nonce).toMatch(/^[a-f0-9]{32}$/);
      expect(nonce).not.toBe("forged-nonce");
      const csp = response.headers.get("content-security-policy");
      expect(csp).toContain(`'nonce-${nonce}'`);
      expect(csp).not.toContain("'nonce-forged-nonce'");
      expect(response.headers.get("x-middleware-request-content-security-policy")).toBe(csp);
      expect(response.headers.get("x-middleware-override-headers")?.split(","))
        .toEqual(expect.arrayContaining(["x-nonce", "content-security-policy"]));
      nonces.add(nonce!);
    }

    expect(nonces.size).toBe(2);
    expect(mocks.resolveHostToUid).toHaveBeenCalledWith("teacher.example.test");
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });

  it("preserves refreshed cookies and forwards the SDK anti-cache headers", async () => {
    vi.resetModules();
    mocks.getSupabaseClientConfig.mockReturnValue({
      url: "https://project.example.test",
      anonKey: "public-test-fixture",
    });
    const antiCacheHeaders = {
      "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
      Expires: "0",
      Pragma: "no-cache",
    };
    const getUser = vi.fn();
    mocks.createServerClient.mockImplementation((_url: string, _key: string, options: { cookies: CookieMethodsServer }) => {
      getUser.mockImplementation(async () => {
        expect(await options.cookies.getAll!()).toEqual([{ name: "audit-session", value: "old-fixture" }]);
        await options.cookies.setAll!([
          {
            name: "audit-session",
            value: "renewed-fixture",
            options: { path: "/", httpOnly: true, secure: true, sameSite: "lax" },
          },
          { name: "audit-session.1", value: "", options: { path: "/", maxAge: 0 } },
        ], antiCacheHeaders);
        return { data: { user: null }, error: null };
      });
      return { auth: { getUser } };
    });
    const { proxy } = await import("@/proxy");
    const request = new NextRequest("https://www.skillsetmind.com/api/auth/pwned-check?prefix=ABCDE", {
      headers: { host: "www.skillsetmind.com", cookie: "audit-session=old-fixture" },
    });
    const response = await proxy(request);

    expect(getUser).toHaveBeenCalledOnce();
    expect(request.cookies.get("audit-session")?.value).toBe("renewed-fixture");
    expect(response.cookies.get("audit-session")).toMatchObject({
      value: "renewed-fixture", path: "/", httpOnly: true, secure: true, sameSite: "lax",
    });
    expect(response.cookies.get("audit-session.1")).toMatchObject({ value: "", maxAge: 0 });
    // This is how Next makes middleware cookies visible to cookies() in RSC/API.
    expect(response.headers.get("x-middleware-set-cookie")).toContain("audit-session=renewed-fixture");
    for (const [name, value] of Object.entries(antiCacheHeaders)) {
      expect(response.headers.get(name), name).toBe(value);
    }
    const nonce = response.headers.get("x-middleware-request-x-nonce");
    expect(response.headers.get("content-security-policy")).toContain(`'nonce-${nonce}'`);
  });
});
