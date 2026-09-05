// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import { buildContentSecurityPolicy } from "./csp";

function sources(directive: string): string[] {
  const policy = buildContentSecurityPolicy("nonce-fixture");
  const entry = policy.split("; ").find((part) => part.startsWith(`${directive} `));
  expect(entry, directive).toBeDefined();
  return entry!.split(" ").slice(1);
}

afterEach(() => vi.unstubAllEnvs());

describe("CSP development compatibility", () => {
  it("allows Next.js development eval while keeping the nonce trust chain", () => {
    vi.stubEnv("NODE_ENV", "development");
    const scripts = sources("script-src");

    expect(scripts).toContain("'unsafe-eval'");
    expect(scripts).toContain("'nonce-nonce-fixture'");
    expect(scripts).toContain("'strict-dynamic'");
    expect(scripts).not.toContain("'unsafe-inline'");
  });

  it.each(["production", "test", undefined])(
    "keeps eval forbidden when NODE_ENV is %s",
    (environment) => {
      vi.stubEnv("NODE_ENV", environment);
      expect(sources("script-src")).not.toContain("'unsafe-eval'");
    },
  );

  it("changes only the eval permission between production and development", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://storage.example.test");
    vi.stubEnv("NODE_ENV", "production");
    const production = buildContentSecurityPolicy("nonce-fixture");

    vi.stubEnv("NODE_ENV", "development");
    const development = buildContentSecurityPolicy("nonce-fixture");

    expect(development.replace(" 'unsafe-eval'", "")).toBe(production);
  });
});

describe("CSP compatibility with embedded course and payment content", () => {
  // Stripe's Checkout CSP contract applies to EmbeddedCheckoutProvider too:
  // https://docs.stripe.com/security/guide#content-security-policy
  it.each(["connect-src", "frame-src", "script-src"])(
    "allows embedded Stripe Checkout in %s",
    (directive) => {
      expect(sources(directive)).toContain("https://checkout.stripe.com");
    },
  );

  it("allows signed PDF frames only from this deployment's Storage origin", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://storage-one.example.test");
    expect(sources("frame-src")).toContain("https://storage-one.example.test");

    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://storage-two.example.test");
    const frames = sources("frame-src");
    expect(frames).toContain("https://storage-two.example.test");
    expect(frames).not.toContain("https://storage-one.example.test");
    expect(frames).not.toContain("wss://storage-two.example.test");
    expect(frames).not.toContain("https:");
    expect(frames.some((source) => source.includes("*"))).toBe(false);
  });

  it("keeps the nonce trust chain and fails closed for an invalid Storage URL", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "invalid-storage-url");
    const scripts = sources("script-src");
    expect(scripts).toContain("'nonce-nonce-fixture'");
    expect(scripts).toContain("'strict-dynamic'");
    expect(scripts).not.toContain("'unsafe-inline'");
    expect(scripts).not.toContain("'unsafe-eval'");
    expect(sources("object-src")).toEqual(["'none'"]);
    expect(sources("frame-ancestors")).toEqual(["'self'"]);
    expect(sources("frame-src")).not.toContain("invalid-storage-url");
    expect(sources("frame-src")).not.toContain("https:");
  });
});
