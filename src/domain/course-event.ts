export type CourseEventType =
  | "live_class"
  | "mentorship"
  | "office_hours"
  | "webinar"
  | "deadline";

export type CourseEventStatus = "scheduled" | "completed" | "cancelled";
export type CourseEventRsvpStatus = "attending" | "not_attending";

export type CourseEvent = {
  id: string;
  courseId: string;
  courseSlug: string;
  courseTitle: string;
  ownerId: string;
  title: string;
  description: string;
  type: CourseEventType;
  status: CourseEventStatus;
  startsAt: string;
  externalUrl: string;
  recordingAssetId: string | null;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type CreateCourseEventInput = {
  courseId: string;
  courseSlug: string;
  courseTitle: string;
  ownerId: string;
  title: string;
  description: string;
  type: CourseEventType;
  startsAt: string;
  externalUrl: string;
};

export type CourseEventRsvp = {
  id: string;
  eventId: string;
  courseSlug: string;
  userId: string;
  attendeeName: string;
  attendeeEmail: string | null;
  status: CourseEventRsvpStatus;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export function isValidExternalEventUrl(value: string): boolean {
  try {
    const url = new URL(value);

    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

// A deadline is not a meeting: only it may go without a link. A filled-in link
// goes through the same usual rule, in any type. A session without a link already
// existed (creating the "Live event" product leaves the link for later).
export function isEventLinkAcceptable(type: CourseEventType, value: string): boolean {
  return (type === "deadline" && value.trim() === "") || isValidExternalEventUrl(value);
}

// "zoom.us/j/123" becomes "https://zoom.us/j/123". Whatever already carries a scheme (even a
// "javascript:") stays as it came and the validation above decides.
export function withLinkScheme(value: string): string {
  const trimmed = value.trim();
  return trimmed && !/^[a-z][a-z\d+.-]*:/i.test(trimmed) ? `https://${trimmed}` : trimmed;
}

// The four main US time zones, for the preview in the teacher's form.
export const US_PREVIEW_TIME_ZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
] as const;

// English: the generic abbreviation ("PT"). Spanish: the long name ("hora del
// Pacifico"), because the short abbreviation comes out as "GMT-8", which nobody reads.
function zoneNameStyle(locale: string): "shortGeneric" | "longGeneric" {
  return locale.toLowerCase().startsWith("en") ? "shortGeneric" : "longGeneric";
}

// An engine that does not know the generic names throws RangeError: it falls back to "short"
// instead of blanking the whole screen.
function formatWithZoneName(
  locale: string,
  options: Intl.DateTimeFormatOptions,
  date: Date,
): string {
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZoneName: zoneNameStyle(locale) }).format(date);
  } catch {
    return new Intl.DateTimeFormat(locale, { ...options, timeZoneName: "short" }).format(date);
  }
}

// Defaults keep every existing caller on English; the classroom passes its
// locale and an already-translated placeholder.
/** The date in the time zone of whoever teaches, with the zone written out ("GMT-3"). A missing
 *  or invalid zone: the reader's, also written out. Invalid date: null. */
export function formatEventDateTimeInZone(
  value: string,
  locale: string,
  timeZone: string | null,
): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  };
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone: timeZone ?? undefined }).format(date);
  } catch {
    return new Intl.DateTimeFormat(locale, options).format(date);
  }
}

// The phrase every screen uses: weekday and the time zone of WHOEVER READS, written out
// ("Wed, Nov 25, 4:00 PM PT"). Before it came out as "Nov 25, 2026, 4:00 PM" without saying
// whose time it was, and the same session seemed to have three times. `timeZone` is only
// for tests and for the preview: without it, the device's time zone applies. The year is included only
// when it is not the year of `now` (last year's session in "Past"); `now` is a
// parameter so the test does not depend on the clock.
export function formatEventDateTime(
  value: string,
  locale = "en",
  fallback = "Date pending",
  timeZone?: string,
  now: number = Date.now(),
): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return fallback;
  }

  const yearOf = (instant: Date | number) =>
    new Intl.DateTimeFormat("en", { year: "numeric", timeZone }).format(instant);

  return formatWithZoneName(
    locale,
    {
      weekday: "short",
      year: yearOf(date) === yearOf(now) ? undefined : "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    },
    date,
  );
}

// The time zone in words, with the city in parentheses: "Central Time
// (Chicago)". Only the city from the id misled (someone living in Dallas read "Chicago"),
// and "Etc/GMT+5" has the sign inverted: there only the name the formatter gives is kept.
export function describeTimeZone(timeZone: string, locale: string, at: number): string {
  const parts = (style: "longGeneric" | "long") =>
    new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: style }).formatToParts(at);
  let name = "";
  try {
    try {
      name = parts("longGeneric").find((part) => part.type === "timeZoneName")?.value ?? "";
    } catch {
      name = parts("long").find((part) => part.type === "timeZoneName")?.value ?? "";
    }
  } catch {
    return "";
  }
  const city = timeZone.includes("/") && !timeZone.startsWith("Etc/")
    ? (timeZone.split("/").pop() ?? "").replace(/_/g, " ")
    : "";
  return city && !name.includes(city) ? `${name} (${city})` : name;
}

// One instant in several time zones: ["7:00 PM ET", "6:00 PM CT", ...]. The weekday
// is included only when the zones fall on different days (1 AM ET and 10 PM PT
// of the previous day), otherwise the preview would lie. Invalid date: empty list.
export function formatEventTimeInZones(
  value: string,
  locale: string,
  timeZones: readonly string[],
): string[] {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return [];
  }

  const weekdays = new Set(
    timeZones.map((timeZone) => new Intl.DateTimeFormat(locale, { weekday: "short", timeZone }).format(date)),
  );

  return timeZones.map((timeZone) =>
    formatWithZoneName(
      locale,
      { weekday: weekdays.size > 1 ? "short" : undefined, hour: "numeric", minute: "2-digit", timeZone },
      date,
    ),
  );
}

// The "live" window, a single one for the four learner screens. Before, each one
// guessed: the panel removed the session the minute it started, the classroom kept it
// for 2 h, the agenda and the community for 3 h. There is no duration column: 3 h after the
// start the session counts as over, and 15 min before it is already "starting".
export const EVENT_STARTING_SOON_MS = 15 * 60_000;
export const EVENT_LIVE_WINDOW_MS = 3 * 3_600_000;

export type EventLiveState = "upcoming" | "startingSoon" | "live" | "over";

// An invalid date stays "upcoming": the session remains in the list with "Date pending"
// instead of disappearing. A deadline is not a meeting: never "starting" or "live";
// it counts until the deadline time and then it has passed.
export function getEventLiveState(startsAt: string, now: number, type?: CourseEventType): EventLiveState {
  const start = Date.parse(startsAt);
  if (!Number.isFinite(start)) return "upcoming";
  if (type === "deadline") return now < start ? "upcoming" : "over";
  if (now < start - EVENT_STARTING_SOON_MS) return "upcoming";
  if (now < start) return "startingSoon";
  return now < start + EVENT_LIVE_WINDOW_MS ? "live" : "over";
}

// Among the sessions in the window, the one whose start is closest to now; on a tie, the one that
// has not started yet. The oldest one stayed "live" for 3 h and hid the
// next one: at 7:20 the banner opened the 6:00 webinar room, not the 7:30 one.
export function pickClosestEvent<T extends Pick<CourseEvent, "startsAt">>(events: T[], now: number): T | null {
  let best: T | null = null;
  let bestStart = 0;
  for (const event of events) {
    const start = Date.parse(event.startsAt);
    if (!Number.isFinite(start)) continue;
    const distance = Math.abs(start - now);
    const bestDistance = Math.abs(bestStart - now);
    if (!best || distance < bestDistance || (distance === bestDistance && start > bestStart)) {
      best = event;
      bestStart = start;
    }
  }
  return best;
}

// A cancelled session stays in view, marked, until 7 days after the scheduled time: whoever
// said "I'm going" finds the session and reads "Cancelled" instead of watching it vanish.
const CANCELLED_SHOWN_MS = 7 * 24 * 3_600_000;

export function isCancelledEventShown(startsAt: string, now: number): boolean {
  const start = Date.parse(startsAt);
  return Number.isFinite(start) && now < start + CANCELLED_SHOWN_MS;
}

// The instant of the last change, only when the session changed after it was created:
// creating writes both stamps equal, and a 1 min margin covers the rest.
export function getEventUpdatedAt(event: Pick<CourseEvent, "createdAt" | "updatedAt">): string | null {
  const created = Date.parse(String(event.createdAt ?? ""));
  const updated = Date.parse(String(event.updatedAt ?? ""));
  return Number.isFinite(created) && updated - created > 60_000 ? String(event.updatedAt) : null;
}

// Without an end time, the calendar entry assumes 60 min (the screen says so).
export const CALENDAR_EVENT_MINUTES = 60;

type CalendarEvent = Pick<CourseEvent, "id" | "title" | "description" | "courseTitle" | "startsAt" | "createdAt" | "updatedAt">;

// 2026-11-25T21:00:00.000Z -> 20261125T210000Z (UTC, as Google and .ics require).
function calendarStamp(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function calendarDetails(event: CalendarEvent, joinUrl: string | null) {
  const start = Date.parse(event.startsAt);
  if (!Number.isFinite(start)) return null;
  // The link comes back normalized by the parser: a hidden line break in it
  // does not become a new property in the file.
  let url: string | null = null;
  try {
    url = joinUrl ? new URL(joinUrl).href : null;
  } catch {
    url = null;
  }
  return {
    start: calendarStamp(start),
    end: calendarStamp(start + CALENDAR_EVENT_MINUTES * 60_000),
    url,
    text: [event.courseTitle, (event.description ?? "").trim(), url].filter(Boolean).join("\n\n"),
  };
}

// The "add to Google Calendar" link, built in the browser. `joinUrl` only
// when the learner can see the link (enrolled). Invalid date: null.
export function buildGoogleCalendarUrl(event: CalendarEvent, joinUrl: string | null): string | null {
  const details = calendarDetails(event, joinUrl);
  if (!details) return null;
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: `${details.start}/${details.end}`,
    details: details.text,
  });
  if (details.url) params.set("location", details.url);
  return `https://calendar.google.com/calendar/render?${params}`;
}

// iCalendar text (RFC 5545): backslash, semicolon, comma and line
// break (CRLF, LF or a lone CR) escaped; accents stay as UTF-8.
function icsText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
}

// A line longer than 75 bytes folds (RFC 5545 3.1), without splitting a character.
function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    if (size + bytes > 75) {
      parts.push(current);
      current = " ";
      size = 1;
    }
    current += char;
    size += bytes;
  }
  parts.push(current);
  return parts.join("\r\n");
}

// The .ics file of a session. Stable UID and a SEQUENCE that grows with each
// edit (seconds between creation and the last change; 0 if it never changed): downloaded
// again after rescheduling, the calendar replaces the entry instead of duplicating it.
// `now` is the DTSTAMP stamp. Invalid date: null.
export function buildEventIcs(event: CalendarEvent, joinUrl: string | null, now: number): string | null {
  const details = calendarDetails(event, joinUrl);
  if (!details) return null;
  const created = Date.parse(String(event.createdAt ?? ""));
  const updated = Date.parse(String(event.updatedAt ?? ""));
  const edited = Number.isFinite(created) && Number.isFinite(updated);
  const sequence = edited ? Math.max(0, Math.floor((updated - created) / 1000)) : 0;
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//SkillsetMind//Live sessions//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:course-event-${event.id}@skillsetmind.com`,
    `SEQUENCE:${sequence}`,
    `DTSTAMP:${calendarStamp(now)}`,
    ...(Number.isFinite(updated) ? [`LAST-MODIFIED:${calendarStamp(updated)}`] : []),
    `DTSTART:${details.start}`,
    `DTEND:${details.end}`,
    `SUMMARY:${icsText(event.title)}`,
    `DESCRIPTION:${icsText(details.text)}`,
    ...(details.url ? [`URL:${details.url}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ].map(foldIcsLine).join("\r\n") + "\r\n";
}
