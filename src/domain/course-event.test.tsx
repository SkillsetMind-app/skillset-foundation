import { describe, expect, it } from "vitest";

import {
  formatEventDateTime,
  isValidExternalEventUrl,
} from "@/domain/course-event";

// This is a trust boundary, not a formatting helper. The teacher types the
// meeting link and the student's workspace renders it as an href, so anything
// that gets past here becomes a link someone clicks. The studio checks it on
// write too, but that runs in the browser and can be skipped — the render-side
// call in enrolled-course-workspace is the one that has to hold.
describe("isValidExternalEventUrl", () => {
  it("accepts the two schemes a meeting link can legitimately use", () => {
    expect(isValidExternalEventUrl("https://meet.example.com/abc-def")).toBe(true);
    expect(isValidExternalEventUrl("http://192.168.0.10:8080/room")).toBe(true);
    // The URL parser lowercases the scheme, so shouting still resolves.
    expect(isValidExternalEventUrl("HTTPS://meet.example.com/abc")).toBe(true);
  });

  it("rejects script-bearing schemes", () => {
    expect(isValidExternalEventUrl("javascript:alert(1)")).toBe(false);
    expect(isValidExternalEventUrl("JavaScript:alert(1)")).toBe(false);
    // Tabs and newlines are stripped by the URL parser before the scheme is
    // read, which is exactly why this checks the parsed protocol instead of
    // the raw string — "java\tscript:" would slip past a startsWith filter.
    expect(isValidExternalEventUrl("java\tscript:alert(1)")).toBe(false);
    expect(isValidExternalEventUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isValidExternalEventUrl("vbscript:msgbox(1)")).toBe(false);
  });

  it("rejects anything that is not an absolute URL", () => {
    expect(isValidExternalEventUrl("")).toBe(false);
    expect(isValidExternalEventUrl("   ")).toBe(false);
    expect(isValidExternalEventUrl("meet.example.com/abc")).toBe(false);
    expect(isValidExternalEventUrl("/rooms/abc")).toBe(false);
  });
});

describe("formatEventDateTime", () => {
  it("degrades to a placeholder instead of printing Invalid Date", () => {
    expect(formatEventDateTime("")).toBe("Date pending");
    expect(formatEventDateTime("not a date")).toBe("Date pending");
  });

  it("formats a real timestamp", () => {
    // Locale output is environment-dependent, so assert the contract that
    // matters: a valid date is not the fallback and carries the year.
    const formatted = formatEventDateTime("2026-03-14T15:30:00.000Z");
    expect(formatted).not.toBe("Date pending");
    expect(formatted).toContain("2026");
  });
});
