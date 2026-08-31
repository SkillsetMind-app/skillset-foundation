import { describe, expect, it } from "vitest";

import {
  decideHostRoute,
  isPlatformHost,
  normaliseHostHeader,
  PLATFORM_ORIGIN,
} from "@/domain/host-routing";

const TEACHER = "teacher-uid-123";

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

  // Os testes acima usam um host de professor JÁ RESOLVIDO. A janela perigosa é
  // outra: o host não é o da plataforma e `resolvedUid` é nulo — o domínio foi
  // anexado ao projeto da Vercel (o que a rota faz de imediato, sem esperar
  // prova de posse) e ainda não foi verificado; ou já foi desanexado e a chamada
  // de remoção falhou. Nesse estado a função devolvia `pass`, servindo a
  // plataforma inteira, /login incluído, sob um nome que não é nosso.
  //
  // O "unknown host" testado acima é o host da PRÓPRIA plataforma sem uid, que é
  // um caso diferente e tem de continuar passando.
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
    // A função precisa aprender a diferença entre "host desconhecido" e "meu
    // host" — não simplesmente parar de devolver pass.
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

  // Splitting at the first colon would turn "[::1]:3000" into "[" — the bracket
  // has to be closed before the port is looked for.
  it("handles a bracketed IPv6 literal with a port", () => {
    expect(normaliseHostHeader("[::1]:3000")).toBe("::1");
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
