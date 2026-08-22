import { describe, expect, it } from "vitest";

import {
  dnsInstructionFor,
  isReserved,
  nextActionFor,
  parseCustomDomain,
  resolvableHostnames,
} from "@/domain/custom-domain";

function accepted(input: string): string {
  const result = parseCustomDomain(input);
  if (!result.ok) {
    throw new Error(`expected "${input}" to be accepted, got ${result.reason}`);
  }
  return result.hostname;
}

function rejection(input: string): string {
  const result = parseCustomDomain(input);
  if (result.ok) {
    throw new Error(`expected "${input}" to be rejected, got ${result.hostname}`);
  }
  return result.reason;
}

describe("parseCustomDomain — what a teacher actually types", () => {
  it("takes a plain domain", () => {
    expect(accepted("mysite.com")).toBe("mysite.com");
  });

  it("takes a subdomain", () => {
    expect(accepted("cursos.mysite.com.br")).toBe("cursos.mysite.com.br");
  });

  // The overwhelmingly common input: a paste out of the address bar.
  it("strips a scheme and a trailing slash rather than refusing the paste", () => {
    expect(accepted("https://mysite.com/")).toBe("mysite.com");
    expect(accepted("http://mysite.com")).toBe("mysite.com");
  });

  it("normalises case and surrounding whitespace", () => {
    expect(accepted("  MySite.COM  ")).toBe("mysite.com");
  });

  it("drops the fully-qualified trailing dot", () => {
    expect(accepted("mysite.com.")).toBe("mysite.com");
  });
});

describe("parseCustomDomain — refusals that carry weight", () => {
  it("refuses anything with a path, query, port or credentials", () => {
    expect(rejection("mysite.com/cursos")).toBe("has_scheme_or_path");
    expect(rejection("mysite.com?ref=1")).toBe("has_scheme_or_path");
    expect(rejection("mysite.com:3000")).toBe("has_scheme_or_path");
    expect(rejection("user@mysite.com")).toBe("has_scheme_or_path");
  });

  // The homoglyph case. This "apple.com" carries a Cyrillic а (U+0430) and is
  // visually identical to the real one in most fonts. Accepting it would mean
  // serving a lookalike of a real brand under a valid certificate of ours.
  it("refuses non-ASCII instead of silently punycoding it", () => {
    expect(rejection("аpple.com")).toBe("non_ascii");
    expect(rejection("café.com")).toBe("non_ascii");
  });

  it("accepts the punycode form, which is visible and checkable", () => {
    expect(accepted("xn--caf-dma.com")).toBe("xn--caf-dma.com");
  });

  it("refuses our own hostnames and everything beneath them", () => {
    expect(rejection("skillsetmind.com")).toBe("reserved");
    expect(rejection("anything.skillsetmind.com")).toBe("reserved");
    expect(rejection("my-app.vercel.app")).toBe("reserved");
    expect(rejection("localhost")).toBe("single_label");
  });

  // endsWith() would wrongly match this one, which somebody else may own.
  it("does not treat a domain that merely ends in our name as reserved", () => {
    expect(accepted("notskillsetmind.com")).toBe("notskillsetmind.com");
  });

  it("refuses a bare label with no ending", () => {
    expect(rejection("mysite")).toBe("single_label");
  });

  it("refuses an IP address dressed up as a hostname", () => {
    expect(rejection("192.168.0.1")).toBe("malformed");
  });

  it("refuses labels that start or end with a hyphen", () => {
    expect(rejection("-mysite.com")).toBe("malformed");
    expect(rejection("mysite-.com")).toBe("malformed");
  });

  it("refuses empty labels from a double dot", () => {
    expect(rejection("my..site.com")).toBe("malformed");
  });

  it("refuses underscores, which cannot hold a certificate", () => {
    expect(rejection("my_site.com")).toBe("malformed");
  });

  it("refuses an empty entry", () => {
    expect(rejection("   ")).toBe("empty");
  });

  it("refuses a hostname past the RFC length limit", () => {
    const tooLong = `${"a".repeat(60)}.`.repeat(5) + "com";
    expect(tooLong.length).toBeGreaterThan(253);
    expect(rejection(tooLong)).toBe("too_long");
  });

  it("refuses a label past the RFC length limit", () => {
    expect(rejection(`${"a".repeat(64)}.com`)).toBe("malformed");
  });
});

describe("isReserved", () => {
  it("matches the apex and any subdomain, never a lookalike", () => {
    expect(isReserved("skillsetmind.com")).toBe(true);
    expect(isReserved("deep.nested.skillsetmind.com")).toBe(true);
    expect(isReserved("notskillsetmind.com")).toBe(false);
    expect(isReserved("skillsetmind.com.br")).toBe(false);
  });
});

describe("resolvableHostnames — unproven domains must not serve", () => {
  const domains = [
    { hostname: "live.com", status: "active" as const },
    { hostname: "waiting-dns.com", status: "pending_dns" as const },
    { hostname: "waiting-txt.com", status: "pending_verification" as const },
    { hostname: "broken.com", status: "error" as const },
  ];

  it("resolves only what Vercel has verified", () => {
    expect(resolvableHostnames(domains)).toEqual(["live.com"]);
  });

  // The window this closes: DNS can point at us before ownership is proven.
  // Serving then would park someone else's name on our certificate.
  it("refuses to resolve a domain whose DNS already points here but is unproven", () => {
    expect(resolvableHostnames(domains)).not.toContain("waiting-dns.com");
    expect(resolvableHostnames(domains)).not.toContain("waiting-txt.com");
  });
});

describe("dnsInstructionFor — the backwards record is the top cause of failure", () => {
  it("gives an apex an A record", () => {
    expect(dnsInstructionFor("mysite.com")).toEqual({
      type: "A",
      name: "@",
      value: "216.198.79.1",
    });
  });

  it("gives a subdomain a CNAME named after its first label", () => {
    expect(dnsInstructionFor("cursos.mysite.com")).toEqual({
      type: "CNAME",
      name: "cursos",
      value: "cname.vercel-dns.com",
    });
  });

  // Guards the legacy apex IP from creeping back in: 76.76.21.21 is the old
  // target and resolves to infrastructure we are no longer served from.
  it("does not hand out the legacy apex IP", () => {
    expect(dnsInstructionFor("mysite.com").value).not.toBe("76.76.21.21");
  });
});

describe("nextActionFor — the two pending states are different problems", () => {
  it("tells a pending_dns teacher about DNS, and warns about propagation", () => {
    const message = nextActionFor({ status: "pending_dns" }) ?? "";
    expect(message).toMatch(/DNS/);
    expect(message).toMatch(/48 hours/);
  });

  it("tells a pending_verification teacher about the TXT record", () => {
    expect(nextActionFor({ status: "pending_verification" })).toMatch(/TXT/);
  });

  it("gives an active domain nothing to do", () => {
    expect(nextActionFor({ status: "active" })).toBeNull();
  });
});
