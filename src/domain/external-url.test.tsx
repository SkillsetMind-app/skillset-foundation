import { describe, expect, it } from "vitest";

import {
  getSafeExternalUrl,
  getSafeMediaUrl,
  isAllowedMediaHost,
} from "@/domain/external-url";

describe("getSafeExternalUrl", () => {
  it("accepts absolute http(s) URLs and returns them trimmed", () => {
    expect(getSafeExternalUrl("https://zoom.us/j/123")).toBe("https://zoom.us/j/123");
    expect(getSafeExternalUrl("  https://meet.google.com/abc-defg  ")).toBe(
      "https://meet.google.com/abc-defg",
    );
    expect(getSafeExternalUrl("http://example.com/live")).toBe(
      "http://example.com/live",
    );
  });

  it("rejects empty, null, and non-URL values", () => {
    expect(getSafeExternalUrl(null)).toBeNull();
    expect(getSafeExternalUrl(undefined)).toBeNull();
    expect(getSafeExternalUrl("")).toBeNull();
    expect(getSafeExternalUrl("   ")).toBeNull();
    expect(getSafeExternalUrl("not a url")).toBeNull();
    expect(getSafeExternalUrl("zoom.us/j/123")).toBeNull();
  });

  it("rejects dangerous schemes (stored-XSS vectors)", () => {
    expect(getSafeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(getSafeExternalUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(getSafeExternalUrl("vbscript:msgbox(1)")).toBeNull();
    expect(getSafeExternalUrl("file:///etc/passwd")).toBeNull();
  });
});

describe("getSafeMediaUrl", () => {
  it("allows relative same-origin paths and allowlisted https hosts", () => {
    expect(getSafeMediaUrl("/brand/logo-mark.png")).toBe("/brand/logo-mark.png");
    expect(
      getSafeMediaUrl("https://xyz.supabase.co/storage/v1/object/public/covers/a.jpg"),
    ).toContain("supabase.co");
    expect(getSafeMediaUrl("https://cdn.b-cdn.net/cover.webp")).toContain("b-cdn.net");
  });

  it("rejects external trackers, long query abuse, and bad schemes", () => {
    expect(getSafeMediaUrl("https://evil-tracker.example/pixel.gif")).toBeNull();
    expect(getSafeMediaUrl("javascript:alert(1)")).toBeNull();
    const longQuery = `https://xyz.supabase.co/x?${"a".repeat(3000)}`;
    expect(getSafeMediaUrl(longQuery)).toBeNull();
  });

  it("host suffix matching is exact on labels", () => {
    expect(isAllowedMediaHost("cdn.b-cdn.net")).toBe(true);
    expect(isAllowedMediaHost("evil-b-cdn.net.attacker.com")).toBe(false);
    expect(isAllowedMediaHost("notsupabase.co")).toBe(false);
  });
});
