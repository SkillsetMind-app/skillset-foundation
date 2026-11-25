import { describe, expect, it } from "vitest";

import {
  decideHostRoute,
  entryUrl,
  isPlatformHost,
  isProductionHost,
  normaliseHostHeader,
  PLATFORM_ORIGIN,
} from "@/domain/host-routing";

const TEACHER = "teacher-uid-123";

describe("platform entry aliases", () => {
  it.each([
    ["app.skillsetmind.com", "/teach"],
    ["consumer.skillsetmind.com", "/learn"],
    ["pay.skillsetmind.com", "/courses"],
    ["sso.skillsetmind.com", "/login"],
  ])("routes the root of %s to its existing area", (hostname, path) => {
    expect(decideHostRoute({ hostname, pathname: "/", search: "?from=entry", resolvedUid: null }))
      .toEqual({ kind: "redirect", status: 307, url: `${PLATFORM_ORIGIN}${path}?from=entry` });
  });

  it("preserves checkout, offer and encoded return data on the fixed destination", () => {
    const path = "/courses/course-fixture/checkout";
    const search = "?offer=launch&priceId=price-fixture&returnTo=%2Flearn%3Fq%3Da%2526b";
    expect(decideHostRoute({ hostname: "pay.skillsetmind.com", pathname: path, search, resolvedUid: "ignored-fixture" }))
      .toEqual({ kind: "redirect", status: 307, url: `${PLATFORM_ORIGIN}${path}${search}` });
  });

  it("does not use a destination supplied in the query as the redirect origin", () => {
    const decision = decideHostRoute({ hostname: "app.skillsetmind.com", pathname: "/auth", search: "?next=https://external.example.test/", resolvedUid: null });
    expect(decision).toEqual({ kind: "redirect", status: 307, url: `${PLATFORM_ORIGIN}/auth?next=https://external.example.test/` });
  });

  it.each(["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "TRACE", "CONNECT"])(
    "refuses %s before infrastructure paths can pass through",
    (method) => {
      for (const hostname of ["app.skillsetmind.com", "consumer.skillsetmind.com", "pay.skillsetmind.com", "sso.skillsetmind.com"]) {
        expect(decideHostRoute({ hostname, method, pathname: "/api/teach/domains/fixture.png", search: "", resolvedUid: null }))
          .toEqual({ kind: "method-not-allowed" });
      }
    },
  );

  it.each(["www.skillsetmind.com", "lp.skillsetmind.com", "myapp.skillsetmind.com", "skillset-foundation-qa.vercel.app", "localhost"])(
    "leaves the existing platform host %s unchanged",
    (hostname) => expect(decideHostRoute({ hostname, pathname: "/auth", search: "", resolvedUid: null })).toEqual({ kind: "pass" }),
  );
});

// The public links and the proxy read the SAME table: the host that entryUrl publishes
// has to be exactly the host that decideHostRoute sends to the right area. If the
// two ends ever diverge, a copied link starts to point to a host
// that the proxy does not know, and this block is what flags it.
describe("entryUrl — public links on the short hosts", () => {
  const PRODUCTION = ["skillsetmind.com", "www.skillsetmind.com"];

  it.each([
    ["app", "https://app.skillsetmind.com", "/teach"],
    ["consumer", "https://consumer.skillsetmind.com", "/learn"],
    ["pay", "https://pay.skillsetmind.com", "/courses"],
  ] as const)("publishes %s on its own host, preserving path and query, and the proxy opens it", (kind, origin, area) => {
    for (const hostname of PRODUCTION) {
      expect(entryUrl(kind, "/courses/course-fixture/checkout", "?offer=launch&priceId=price-fixture", hostname))
        .toBe(`${origin}/courses/course-fixture/checkout?offer=launch&priceId=price-fixture`);
    }
    // Closes the circle with the proxy table: the root of the published host opens the area.
    expect(decideHostRoute({ hostname: new URL(origin).hostname, pathname: "/", search: "", resolvedUid: null }))
      .toEqual({ kind: "redirect", status: 307, url: `${PLATFORM_ORIGIN}${area}` });
  });

  it("keeps an already-built route with its query intact as the path", () => {
    expect(entryUrl("consumer", "/auth?mode=signin&path=student", "", "www.skillsetmind.com"))
      .toBe("https://consumer.skillsetmind.com/auth?mode=signin&path=student");
  });

  it("uses the bare short host for an empty path in production, and the area it opens elsewhere", () => {
    expect(entryUrl("pay", "", "", "www.skillsetmind.com")).toBe("https://pay.skillsetmind.com");
    expect(entryUrl("pay", "/", "?utm=x", "www.skillsetmind.com")).toBe("https://pay.skillsetmind.com/?utm=x");
    expect(entryUrl("pay", "", "", "localhost")).toBe("/courses");
    expect(entryUrl("app", "/", "?utm=x", "localhost")).toBe("/teach?utm=x");
  });

  // A Vercel preview, localhost and the server itself (which does not yet know
  // which host it is on) can never emit a short host: it only resolves in
  // production, and an absolute link would take whoever is testing out of the test environment.
  it.each([
    "skillset-foundation-git-feat-links-skillsetmind.vercel.app",
    "skillset-foundation-qa.vercel.app",
    "localhost",
    "127.0.0.1",
    "::1",
    "lp.skillsetmind.com",
    "staging.skillsetmind.com",
    "mysite.com",
    null,
    undefined,
  ])("stays relative on %s, which is not production", (hostname) => {
    for (const kind of ["app", "consumer", "pay"] as const) {
      const url = entryUrl(kind, "/courses/course-fixture/checkout", "?offer=launch", hostname);
      expect(url).toBe("/courses/course-fixture/checkout?offer=launch");
      expect(url).not.toContain("skillsetmind.com");
    }
  });

  it("defaults to relative when no hostname is given, so a forgotten argument never invents a host", () => {
    expect(entryUrl("pay", "/courses/x")).toBe("/courses/x");
  });
});

describe("isProductionHost — narrower than isPlatformHost on purpose", () => {
  it.each(["skillsetmind.com", "www.skillsetmind.com"])("accepts %s", (hostname) => {
    expect(isProductionHost(hostname)).toBe(true);
    expect(isPlatformHost(hostname)).toBe(true);
  });

  it.each(["skillset-foundation-qa.vercel.app", "localhost", "127.0.0.1", "lp.skillsetmind.com", "notskillsetmind.com"])(
    "rejects %s even though the platform may serve it",
    (hostname) => expect(isProductionHost(hostname)).toBe(false),
  );

  it("rejects a missing hostname", () => {
    expect(isProductionHost(null)).toBe(false);
    expect(isProductionHost(undefined)).toBe(false);
  });
});

function onCustomDomain(pathname: string, search = "") {
  return decideHostRoute({
    hostname: "mysite.com",
    pathname,
    search,
    resolvedUid: TEACHER,
  });
}

describe("decideHostRoute — a custom domain serves the storefront", () => {
  it("rewrites the root to the teacher's public page", () => {
    expect(onCustomDomain("/")).toEqual({
      kind: "rewrite",
      path: `/instructors/${TEACHER}`,
    });
  });

  it("carries the query string through the rewrite", () => {
    expect(onCustomDomain("/", "?utm_source=instagram")).toEqual({
      kind: "rewrite",
      path: `/instructors/${TEACHER}?utm_source=instagram`,
    });
  });

  it("lets a course sales page through untouched", () => {
    expect(onCustomDomain("/courses/my-course")).toEqual({ kind: "pass" });
  });

  it("leaves an unknown host completely alone", () => {
    expect(
      decideHostRoute({
        hostname: "skillsetmind.com",
        pathname: "/",
        search: "",
        resolvedUid: null,
      }),
    ).toEqual({ kind: "pass" });
  });
});

describe("decideHostRoute — auth never renders on a domain we do not control", () => {
  // The attack this closes: a teacher lets their domain lapse, someone else
  // registers it, and it still resolves to us with a valid certificate. If we
  // had ever served the login form there, that person now owns a perfect
  // credential harvester pointed at users trained to trust the page.
  it.each(["/login", "/signup", "/auth", "/reset-password", "/forgot-password"])(
    "redirects %s back to the platform",
    (path) => {
      expect(onCustomDomain(path)).toEqual({
        kind: "redirect",
        url: `${PLATFORM_ORIGIN}${path}`,
      });
    },
  );

  it.each(["/account", "/teach", "/teach/storefront", "/ops", "/learn"])(
    "redirects the authenticated surface %s back to the platform",
    (path) => {
      expect(onCustomDomain(path)).toEqual({
        kind: "redirect",
        url: `${PLATFORM_ORIGIN}${path}`,
      });
    },
  );

  // The tests above use a teacher host that is ALREADY RESOLVED. The dangerous window is
  // another: the host is not the platform's and `resolvedUid` is null: the domain was
  // attached to the Vercel project (which the route does immediately, without waiting for
  // proof of ownership) and has not been verified yet; or it was already detached and the removal
  // call failed. In that state the function returned `pass`, serving the
  // whole platform, /login included, under a name that is not ours.
  //
  // The "unknown host" tested above is the platform's OWN host without a uid, which is
  // a different case and must keep passing.
  it.each(["/login", "/signup", "/account"])(
    "does not serve %s on a host that is neither the platform nor a resolved teacher",
    (pathname) => {
      const decision = decideHostRoute({
        hostname: "dominio-de-um-professor.com",
        pathname,
        search: "",
        resolvedUid: null,
      });

      expect(decision.kind).not.toBe("pass");
    },
  );

  it("still serves the platform's own host when no teacher resolves", () => {
    // The function needs to learn the difference between "unknown host" and "my
    // host", not simply stop returning pass.
    expect(
      decideHostRoute({
        hostname: "skillsetmind.com",
        pathname: "/login",
        search: "",
        resolvedUid: null,
      }).kind,
    ).toBe("pass");
  });

  // The default matters more than any single path above: a route added later by
  // someone who has never read this file is protected without them doing
  // anything.
  it("redirects a path nobody has thought of yet, rather than serving it", () => {
    expect(onCustomDomain("/some-route-invented-in-2027")).toEqual({
      kind: "redirect",
      url: `${PLATFORM_ORIGIN}/some-route-invented-in-2027`,
    });
  });

  it("keeps the query string when redirecting, so a login return-to survives", () => {
    expect(onCustomDomain("/login", "?next=/account")).toEqual({
      kind: "redirect",
      url: `${PLATFORM_ORIGIN}/login?next=/account`,
    });
  });
});

describe("decideHostRoute — infrastructure paths are never touched", () => {
  it.each([
    "/_next/static/chunk.js",
    "/api/payments/checkout",
    "/favicon.ico",
    "/robots.txt",
    "/sitemap.xml",
  ])("passes %s through", (path) => {
    expect(onCustomDomain(path)).toEqual({ kind: "pass" });
  });
});

describe("normaliseHostHeader", () => {
  it("lowercases and strips the port", () => {
    expect(normaliseHostHeader("Example.COM:3000")).toBe("example.com");
  });

  it("handles a plain hostname", () => {
    expect(normaliseHostHeader("example.com")).toBe("example.com");
  });

  it.each([
    ["App.SkillsetMind.Com.:443", "app.skillsetmind.com"],
    ["CONSUMER.SKILLSETMIND.COM.", "consumer.skillsetmind.com"],
    ["pay.skillsetmind.com.:3000", "pay.skillsetmind.com"],
    ["Teacher.Example.Test.:443", "teacher.example.test"],
    ["localhost.:3000", "localhost"],
    ["app.skillsetmind.com.evil.test.", "app.skillsetmind.com.evil.test"],
    ["app.skillsetmind.com..", "app.skillsetmind.com."],
  ])("normalizes one DNS root dot in %s before host classification", (header, hostname) => {
    expect(normaliseHostHeader(header)).toBe(hostname);
  });

  // Splitting at the first colon would turn "[::1]:3000" into "[" — the bracket
  // has to be closed before the port is looked for.
  it("handles a bracketed IPv6 literal with a port", () => {
    expect(normaliseHostHeader("[::1]:3000")).toBe("::1");
  });

  it.each([
    ["[::1]", "::1"],
    ["[2001:DB8::1]:443", "2001:db8::1"],
  ])("preserves the bracketed IPv6 address in %s", (header, hostname) => {
    expect(normaliseHostHeader(header)).toBe(hostname);
  });

  it("returns null for a missing or empty header", () => {
    expect(normaliseHostHeader(null)).toBeNull();
    expect(normaliseHostHeader("   ")).toBeNull();
  });
});

describe("isPlatformHost — checked before any lookup", () => {
  it.each([
    "skillsetmind.com",
    "www.skillsetmind.com",
    "skillset-foundation-abc.vercel.app",
    "localhost",
    "127.0.0.1",
  ])("recognises %s as ours", (host) => {
    expect(isPlatformHost(host)).toBe(true);
  });

  it("does not mistake a lookalike for ours", () => {
    expect(isPlatformHost("notskillsetmind.com")).toBe(false);
    expect(isPlatformHost("mysite.com")).toBe(false);
  });
});
