import { describe, expect, it } from "vitest";

import {
  buildEventIcs,
  buildGoogleCalendarUrl,
  CALENDAR_EVENT_MINUTES,
  describeTimeZone,
  EVENT_LIVE_WINDOW_MS,
  EVENT_STARTING_SOON_MS,
  formatEventDateTime,
  formatEventTimeInZones,
  getEventLiveState,
  getEventUpdatedAt,
  isCancelledEventShown,
  isEventLinkAcceptable,
  isValidExternalEventUrl,
  pickClosestEvent,
  US_PREVIEW_TIME_ZONES,
  withLinkScheme,
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

// The ICU of some Node versions puts a narrow space before "PM".
const plain = (text: string) => text.replace(/\s+/g, " ");

describe("formatEventDateTime", () => {
  // The same session (7 PM in New York) seemed to have three times because
  // no screen said whose time it was. Time zone and language are passed in here: the
  // result does not depend on the clock of the CI machine.
  const sevenPmNewYork = "2026-11-26T00:00:00.000Z";
  const in2026 = Date.UTC(2026, 10, 22, 12);
  const in2027 = Date.UTC(2027, 1, 10, 12);

  it("writes the weekday and the time zone of whoever reads, in English and in Spanish", () => {
    expect(plain(formatEventDateTime(sevenPmNewYork, "en", "Date pending", "America/Los_Angeles", in2026))).toBe(
      "Wed, Nov 25, 4:00 PM PT",
    );
    expect(plain(formatEventDateTime(sevenPmNewYork, "en", "Date pending", "America/New_York", in2026))).toBe(
      "Wed, Nov 25, 7:00 PM ET",
    );
    // Spanish: the long name, never "GMT-8".
    const spanish = formatEventDateTime(sevenPmNewYork, "es", "Fecha pendiente", "America/Los_Angeles", in2026);
    expect(plain(spanish)).toBe("mié, 25 nov, 16:00 hora del Pacífico");
    expect(spanish).not.toMatch(/GMT/);
  });

  // "Past" and "All" showed last year's session without the year.
  it("the year is included only when it is not the current year, in the time zone of whoever reads", () => {
    expect(plain(formatEventDateTime(sevenPmNewYork, "en", "Date pending", "America/Los_Angeles", in2027))).toBe(
      "Wed, Nov 25, 2026, 4:00 PM PT",
    );
    expect(plain(formatEventDateTime(sevenPmNewYork, "es", "Fecha pendiente", "America/Los_Angeles", in2027))).toBe(
      "mié, 25 nov 2026, 16:00 hora del Pacífico",
    );
    // Turn of the year: Dec 31 at 11 PM in Los Angeles is already 2027 in UTC. It counts the
    // year of whoever reads.
    expect(plain(formatEventDateTime("2027-01-01T07:00:00.000Z", "en", "Date pending", "America/Los_Angeles", in2026))).toBe(
      "Thu, Dec 31, 11:00 PM PT",
    );
  });

  // Engine without the generic names: the phrase comes out with "short", without blanking the screen.
  it("without shortGeneric/longGeneric in the engine, falls back to the short name", () => {
    const Real = Intl.DateTimeFormat;
    function WithoutGeneric(locale?: string | string[], options?: Intl.DateTimeFormatOptions) {
      if (options?.timeZoneName === "shortGeneric" || options?.timeZoneName === "longGeneric") {
        throw new RangeError("timeZoneName must be short or long");
      }
      return new Real(locale, options);
    }
    Object.defineProperty(Intl, "DateTimeFormat", { configurable: true, writable: true, value: WithoutGeneric });
    try {
      expect(plain(formatEventDateTime(sevenPmNewYork, "en", "Date pending", "America/Los_Angeles", in2026))).toBe(
        "Wed, Nov 25, 4:00 PM PST",
      );
      expect(formatEventTimeInZones(sevenPmNewYork, "en", ["America/New_York"]).map(plain)).toEqual(["7:00 PM EST"]);
      expect(describeTimeZone("America/Chicago", "en", in2026)).toBe("Central Standard Time (Chicago)");
    } finally {
      Object.defineProperty(Intl, "DateTimeFormat", { configurable: true, writable: true, value: Real });
    }
  });

  it("accepts the classroom locale and fallback while keeping existing defaults", () => {
    expect(formatEventDateTime("invalid", "es", "Fecha pendiente")).toBe("Fecha pendiente");
    expect(formatEventDateTime("invalid")).toBe("Date pending");
  });
  it("degrades to a placeholder instead of printing Invalid Date", () => {
    expect(formatEventDateTime("")).toBe("Date pending");
    expect(formatEventDateTime("not a date")).toBe("Date pending");
  });
});

describe("describeTimeZone", () => {
  const at = Date.UTC(2026, 10, 22, 12);

  // Only the city from the id misled: someone living in Dallas read "Chicago".
  it("the time zone name in words, with the city in parentheses", () => {
    expect(describeTimeZone("America/Chicago", "en", at)).toBe("Central Time (Chicago)");
    expect(describeTimeZone("America/Chicago", "es", at)).toBe("hora central (Chicago)");
    expect(describeTimeZone("America/New_York", "en", at)).toBe("Eastern Time (New York)");
  });

  // "Etc/GMT+5" is five hours BEHIND Greenwich: the id has the sign inverted.
  it("Etc/* and zones without a city keep only the formatter's name", () => {
    const etc = describeTimeZone("Etc/GMT+5", "en", at);
    expect(etc).not.toMatch(/Etc|GMT\+5/);
    expect(etc).toMatch(/05/);
    expect(describeTimeZone("UTC", "en", at)).not.toMatch(/\(/);
  });
});

describe("formatEventTimeInZones", () => {
  it("one time in the four US time zones, with no day when all fall on the same day", () => {
    expect(formatEventTimeInZones("2026-11-26T00:00:00.000Z", "en", US_PREVIEW_TIME_ZONES).map(plain)).toEqual([
      "7:00 PM ET",
      "6:00 PM CT",
      "5:00 PM MT",
      "4:00 PM PT",
    ]);
    expect(formatEventTimeInZones("2026-11-26T00:00:00.000Z", "es", ["America/Los_Angeles"]).map(plain)).toEqual([
      "16:00 hora del Pacífico",
    ]);
  });

  it("time zones on different days get the weekday; an invalid date produces nothing", () => {
    expect(formatEventTimeInZones("2026-11-26T06:00:00.000Z", "en", US_PREVIEW_TIME_ZONES).map(plain)).toEqual([
      "Thu, 1:00 AM ET",
      "Thu, 12:00 AM CT",
      "Wed, 11:00 PM MT",
      "Wed, 10:00 PM PT",
    ]);
    expect(formatEventTimeInZones("not a date", "en", US_PREVIEW_TIME_ZONES)).toEqual([]);
  });
});

describe("session link", () => {
  // A deadline is not a meeting: only it may go without a link.
  it("only the deadline can go without a link; a filled-in link follows the usual rule", () => {
    expect(isEventLinkAcceptable("deadline", "")).toBe(true);
    expect(isEventLinkAcceptable("deadline", "   ")).toBe(true);
    expect(isEventLinkAcceptable("live_class", "")).toBe(false);
    expect(isEventLinkAcceptable("webinar", "")).toBe(false);
    expect(isEventLinkAcceptable("deadline", "javascript:alert(1)")).toBe(false);
    expect(isEventLinkAcceptable("mentorship", "https://zoom.us/j/1")).toBe(true);
  });

  it("adds the https:// to a typed link with no scheme and leaves the rest alone", () => {
    expect(withLinkScheme("zoom.us/j/123")).toBe("https://zoom.us/j/123");
    expect(withLinkScheme("  meet.google.com/abc  ")).toBe("https://meet.google.com/abc");
    expect(withLinkScheme("http://192.168.0.10/room")).toBe("http://192.168.0.10/room");
    expect(withLinkScheme("javascript:alert(1)")).toBe("javascript:alert(1)");
    expect(withLinkScheme("   ")).toBe("");
  });
});

// Everything in UTC and with an explicit `now`: nothing depends on the time zone or the machine clock.
const START = "2026-11-25T21:00:00.000Z";
const at = (minutes: number) => Date.parse(START) + minutes * 60_000;

describe("live window (one rule for the four screens)", () => {
  it("upcoming until 15 min before, startingSoon until the start, live for 3 h, then over", () => {
    expect(getEventLiveState(START, at(-16))).toBe("upcoming");
    expect(getEventLiveState(START, at(-15))).toBe("startingSoon");
    expect(getEventLiveState(START, at(-1))).toBe("startingSoon");
    expect(getEventLiveState(START, at(0))).toBe("live");
    expect(getEventLiveState(START, at(179))).toBe("live");
    expect(getEventLiveState(START, at(180))).toBe("over");
    expect(EVENT_STARTING_SOON_MS).toBe(15 * 60_000);
    expect(EVENT_LIVE_WINDOW_MS).toBe(3 * 3_600_000);
  });

  it("an invalid date stays in the list ('Date pending'), it does not disappear", () => {
    expect(getEventLiveState("not a date", at(0))).toBe("upcoming");
    expect(getEventLiveState("not a date", at(0), "deadline")).toBe("upcoming");
  });

  it("a deadline is never 'starting' or 'live': it counts until it is due and then it has passed", () => {
    expect(getEventLiveState(START, at(-10), "deadline")).toBe("upcoming");
    expect(getEventLiveState(START, at(-1), "deadline")).toBe("upcoming");
    expect(getEventLiveState(START, at(0), "deadline")).toBe("over");
    expect(getEventLiveState(START, at(30), "deadline")).toBe("over");
    // The other types follow the usual window.
    expect(getEventLiveState(START, at(30), "webinar")).toBe("live");
  });

  it("between two sessions 90 min apart, the one whose start is closest to now; on a tie, the one that has not started", () => {
    const webinar = { id: "webinar", startsAt: START };
    const office = { id: "office", startsAt: new Date(at(90)).toISOString() };
    // 7:20 with the webinar at 6:00: the 7:30 office hours (10 min), not the webinar (80 min).
    expect(pickClosestEvent([webinar, office], at(80))).toBe(office);
    // 6:10: the webinar that started 10 min ago.
    expect(pickClosestEvent([webinar, office], at(10))).toBe(webinar);
    // Tie (45 min on each side): the one that has not started yet.
    expect(pickClosestEvent([webinar, office], at(45))).toBe(office);
    expect(pickClosestEvent([office, webinar], at(45))).toBe(office);
    expect(pickClosestEvent([{ id: "x", startsAt: "not a date" }], at(0))).toBeNull();
    expect(pickClosestEvent([], at(0))).toBeNull();
  });

  it("a cancelled one stays visible for 7 days after the scheduled time", () => {
    expect(isCancelledEventShown(START, at(-60))).toBe(true);
    expect(isCancelledEventShown(START, at(7 * 24 * 60 - 1))).toBe(true);
    expect(isCancelledEventShown(START, at(7 * 24 * 60))).toBe(false);
    expect(isCancelledEventShown("not a date", at(0))).toBe(false);
  });

  it("'Updated' only when the session changed more than 1 min after it was created", () => {
    expect(getEventUpdatedAt({ createdAt: START, updatedAt: START })).toBeNull();
    expect(getEventUpdatedAt({ createdAt: START, updatedAt: new Date(at(1)).toISOString() })).toBeNull();
    expect(getEventUpdatedAt({ createdAt: START, updatedAt: "2026-11-26T09:00:00.000Z" })).toBe("2026-11-26T09:00:00.000Z");
    expect(getEventUpdatedAt({ createdAt: undefined, updatedAt: "2026-11-26T09:00:00.000Z" })).toBeNull();
    expect(getEventUpdatedAt({ createdAt: START, updatedAt: null })).toBeNull();
  });
});

describe("add to calendar", () => {
  const event = {
    id: "ev-42",
    title: "Leadership; café, \"Q&A\"",
    description: "Line 1\nLine 2",
    courseTitle: "Course, advanced",
    startsAt: START,
  };
  const link = "https://zoom.us/j/123?pwd=a,b";

  it("Google: TEMPLATE link with start and end in UTC (60 min) and the join link", () => {
    const url = new URL(buildGoogleCalendarUrl(event, link)!);
    expect(`${url.origin}${url.pathname}`).toBe("https://calendar.google.com/calendar/render");
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("text")).toBe(event.title);
    expect(url.searchParams.get("dates")).toBe("20261125T210000Z/20261125T220000Z");
    expect(url.searchParams.get("details")).toBe(`Course, advanced\n\nLine 1\nLine 2\n\n${link}`);
    expect(url.searchParams.get("location")).toBe(link);
    expect(CALENDAR_EVENT_MINUTES).toBe(60);
  });

  it("Google without a link: no location and no link in the description; an invalid date produces no link", () => {
    const url = new URL(buildGoogleCalendarUrl(event, null)!);
    expect(url.searchParams.has("location")).toBe(false);
    expect(url.searchParams.get("details")).not.toContain("https://");
    expect(buildGoogleCalendarUrl({ ...event, startsAt: "not a date" }, link)).toBeNull();
  });

  it(".ics: CRLF, UTC with Z, stable UID and escaped text; accents intact", () => {
    const ics = buildEventIcs(event, link, Date.parse("2026-11-20T12:00:00.000Z"))!;
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toContain("\n");
    const lines = ics.replace(/\r\n /g, "").split("\r\n");
    expect(lines).toContain("BEGIN:VCALENDAR");
    expect(lines).toContain("UID:course-event-ev-42@skillsetmind.com");
    expect(lines).toContain("DTSTAMP:20261120T120000Z");
    expect(lines).toContain("DTSTART:20261125T210000Z");
    expect(lines).toContain("DTEND:20261125T220000Z");
    expect(lines).toContain("SUMMARY:Leadership\\; café\\, \"Q&A\"");
    expect(lines).toContain(`DESCRIPTION:Course\\, advanced\\n\\nLine 1\\nLine 2\\n\\n${link.replace(",", "\\,")}`);
    expect(lines).toContain(`URL:${link}`);
    // The same file downloaded again has the same UID.
    expect(buildEventIcs(event, link, Date.now())).toContain("UID:course-event-ev-42@skillsetmind.com");
  });

  it(".ics without a link carries no URL; a long line folds at up to 75 bytes without splitting an accent", () => {
    const long = { ...event, title: "Entrée à éclat ".repeat(10) };
    const ics = buildEventIcs(long, null, at(0))!;
    expect(ics).not.toContain("URL:");
    for (const line of ics.split("\r\n")) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
    const summary = ics.replace(/\r\n /g, "").split("\r\n").find((line) => line.startsWith("SUMMARY:"));
    expect(summary).toBe(`SUMMARY:${long.title}`);
    expect(buildEventIcs({ ...event, startsAt: "" }, null, at(0))).toBeNull();
  });

  it("a link with a hidden line break does not become a new property", () => {
    const ics = buildEventIcs(event, "https://zoom.us/j/1\nATTACH:evil", at(0))!;
    expect(ics).not.toMatch(/\r\nATTACH:/);
  });

  it("a lone CR in the text becomes \\n, does not break the file line", () => {
    const ics = buildEventIcs({ ...event, title: "Part 1\rATTACH:evil" }, null, at(0))!;
    expect(ics.replace(/\r\n/g, "")).not.toContain("\r");
    expect(ics.replace(/\r\n /g, "").split("\r\n")).toContain("SUMMARY:Part 1\\nATTACH:evil");
  });

  // Rescheduled and downloaded again: the same UID with a higher SEQUENCE replaces the
  // calendar entry instead of creating another one.
  it("SEQUENCE grows with each edit and LAST-MODIFIED carries the last change; never edited, 0", () => {
    const lines = (input: typeof event & { createdAt?: unknown; updatedAt?: unknown }) =>
      buildEventIcs(input, null, at(0))!.split("\r\n");
    const created = "2026-11-01T10:00:00.000Z";
    expect(lines({ ...event, createdAt: created, updatedAt: created })).toContain("SEQUENCE:0");
    const once = lines({ ...event, createdAt: created, updatedAt: "2026-11-01T11:00:00.000Z" });
    expect(once).toContain("SEQUENCE:3600");
    expect(once).toContain("LAST-MODIFIED:20261101T110000Z");
    const twice = lines({ ...event, createdAt: created, updatedAt: "2026-11-02T10:00:00.000Z" });
    expect(twice).toContain("SEQUENCE:86400");
    expect(lines(event)).toContain("SEQUENCE:0");
    expect(lines(event).some((line) => line.startsWith("LAST-MODIFIED:"))).toBe(false);
  });
});
