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

// Defaults keep every existing caller on English; the classroom passes its
// locale and an already-translated placeholder.
/** A data no fuso de quem ensina, com o fuso escrito ("GMT-3"). Fuso ausente
 *  ou invalido: o de quem le, tambem escrito. Data invalida: null. */
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

export function formatEventDateTime(
  value: string,
  locale = "en",
  fallback = "Date pending",
): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return fallback;
  }

  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
