// @vitest-environment node
//
// The proxy is server code and NextResponse.next() rejects a Headers that
// is not the runtime's own class — jsdom supplies a different one, so this
// file runs in node rather than the suite default.

import { IncomingMessage } from "node:http";
import { Socket } from "node:net";

import { NextRequest } from "next/server";
import { NodeNextRequest } from "next/dist/server/base-http/node";
import {
  createRequestStoreForAPI,
  createRequestStoreForRender,
} from "next/dist/server/async-storage/request-store";
import type { CookieMethodsServer } from "@supabase/ssr";
import { afterEach, describe, expect, it, vi } from "vitest";

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

  it.each(["renewed-fixture", ""])("forwards session value %j to the native API cookie store and preserves security headers", async (sessionValue) => {
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
        expect(await options.cookies.getAll!()).toEqual([
          { name: "audit-session", value: "old-fixture" },
          { name: "audit-session.1", value: "old-chunk-fixture" },
          { name: "skillset.locale", value: "es" },
        ]);
        await options.cookies.setAll!([
          {
            name: "audit-session",
            value: sessionValue,
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
      headers: {
        host: "www.skillsetmind.com",
        cookie: "audit-session=old-fixture; audit-session.1=old-chunk-fixture; skillset.locale=es",
      },
    });
    const response = await proxy(request);

    expect(getUser).toHaveBeenCalledOnce();
    expect(request.cookies.get("audit-session")?.value).toBe(sessionValue);
    expect(response.cookies.get("audit-session")).toMatchObject({
      value: sessionValue, path: "/", httpOnly: true, secure: true, sameSite: "lax",
    });
    expect(response.cookies.get("audit-session.1")).toMatchObject({ value: "", maxAge: 0 });
    expect(response.headers.get("x-middleware-set-cookie")).toContain(`audit-session=${sessionValue}`);
    for (const [name, value] of Object.entries(antiCacheHeaders)) {
      expect(response.headers.get(name), name).toBe(value);
    }
    const nonce = response.headers.get("x-middleware-request-x-nonce");
    expect(response.headers.get("content-security-policy")).toContain(`'nonce-${nonce}'`);

    // Compose the request headers exactly as the Next router protocol carries
    // them, then exercise its real stores instead of mocking cookies().
    const forwardedHeaders: Record<string, string> = {};
    for (const name of response.headers.get("x-middleware-override-headers")!.split(",")) {
      forwardedHeaders[name] = response.headers.get(`x-middleware-request-${name}`)!;
    }
    forwardedHeaders["x-middleware-set-cookie"] = response.headers.get("x-middleware-set-cookie")!;
    const implicitTags = { tags: [], expirationsByCacheKind: new Map() };

    // Node RSC already merges middleware Set-Cookie into its cookie store.
    // Keep this input separate: reading that store may update its headers.
    const socket = new Socket();
    try {
      const incoming = new IncomingMessage(socket);
      incoming.method = "GET";
      incoming.url = request.url;
      incoming.headers = { ...forwardedHeaders };
      const renderStore = createRequestStoreForRender(
        new NodeNextRequest(incoming), undefined, request.nextUrl, {}, implicitTags,
        undefined, undefined, false, undefined, null, null,
      );
      expect(renderStore.cookies.get("audit-session")?.value ?? "").toBe(sessionValue);
    } finally {
      socket.destroy();
    }

    // App Route uses a NextRequest, not Node's headers object. Its cookies()
    // reader must receive the renewed/cleared session in this same request.
    const routeRequest = new NextRequest(request.url, { headers: forwardedHeaders });
    const routeStore = createRequestStoreForAPI(routeRequest, routeRequest.nextUrl, implicitTags, undefined, undefined);
    const routeCookies = routeStore.userspaceMutableCookies.getAll();
    expect(routeCookies.find(({ name }) => name === "audit-session")?.value).toBe(sessionValue);
    expect(routeCookies).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "audit-session", value: sessionValue }),
      expect.objectContaining({ name: "audit-session.1", value: "" }),
      expect.objectContaining({ name: "skillset.locale", value: "es" }),
    ]));
    expect(routeRequest.headers.get("x-nonce")).toBe(nonce);
    expect(routeRequest.headers.get("content-security-policy")).toBe(response.headers.get("content-security-policy"));
  });
});
