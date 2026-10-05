import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseFirstTouch } from "@/lib/attribution/first-touch";

const ORIGIN = "https://www.skillsetmind.com";

describe("parseFirstTouch", () => {
  it("keeps the five utm_* fields and nothing else from the URL", () => {
    expect(
      parseFirstTouch(
        "?utm_source=instagram&utm_medium=paid&utm_campaign=launch&utm_term=coach&utm_content=reel-2&gclid=abc&email=a%40b.c",
        "",
        ORIGIN,
      ),
    ).toEqual({
      utm_source: "instagram",
      utm_medium: "paid",
      utm_campaign: "launch",
      utm_term: "coach",
      utm_content: "reel-2",
    });
  });

  it("drops empty values and trims and caps long ones", () => {
    const touch = parseFirstTouch(`?utm_source=%20%20&utm_campaign=${"x".repeat(500)}`, "", ORIGIN);
    expect(touch.utm_source).toBeUndefined();
    expect(touch.utm_campaign).toHaveLength(100);
  });

  it("keeps only the origin of an external referrer — its path and query can carry personal data", () => {
    expect(parseFirstTouch("", "https://l.instagram.com/?u=https%3A%2F%2Fx&e=person%40mail.com", ORIGIN)).toEqual({
      referrer: "https://l.instagram.com",
    });
  });

  it("ignores our own site, app referrers and garbage as a referrer", () => {
    expect(parseFirstTouch("", `${ORIGIN}/pricing`, ORIGIN)).toEqual({});
    expect(parseFirstTouch("", "android-app://com.google.android.gm/", ORIGIN)).toEqual({});
    expect(parseFirstTouch("", "not a url", ORIGIN)).toEqual({});
    expect(parseFirstTouch("", "", ORIGIN)).toEqual({});
  });
});

describe("captureFirstTouch / getFirstTouch", () => {
  beforeEach(() => {
    vi.resetModules();
    window.sessionStorage.clear();
    window.localStorage.clear();
    window.history.replaceState(null, "", "/?utm_source=newsletter");
  });

  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("first touch wins: a later landing does not overwrite it", async () => {
    const { captureFirstTouch, getFirstTouch } = await import("@/lib/attribution/first-touch");
    captureFirstTouch();
    window.history.replaceState(null, "", "/?utm_source=google");
    captureFirstTouch();
    expect(getFirstTouch()).toEqual({ utm_source: "newsletter" });
  });

  it("without cookie consent it stays in memory only — nothing is written to the browser", async () => {
    const { captureFirstTouch, getFirstTouch } = await import("@/lib/attribution/first-touch");
    captureFirstTouch();
    expect(getFirstTouch()).toEqual({ utm_source: "newsletter" });
    expect(window.sessionStorage.length).toBe(0);
  });

  it("after 'accept all' it survives a full reload of the tab", async () => {
    window.localStorage.setItem("skillset.cookie-consent.v1", "accepted");
    const first = await import("@/lib/attribution/first-touch");
    first.captureFirstTouch();

    vi.resetModules();
    window.history.replaceState(null, "", "/auth?mode=signup");
    const reloaded = await import("@/lib/attribution/first-touch");
    reloaded.captureFirstTouch();
    expect(reloaded.getFirstTouch()).toEqual({ utm_source: "newsletter" });
  });
});
