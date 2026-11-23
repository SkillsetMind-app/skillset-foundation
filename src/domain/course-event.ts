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

// Prazo (deadline) nao e reuniao: so ele pode ficar sem link. Link preenchido
// passa pela mesma regra de sempre, em qualquer tipo. Sessao sem link ja
// existia (a criacao do produto "Live event" deixa o link para depois).
export function isEventLinkAcceptable(type: CourseEventType, value: string): boolean {
  return (type === "deadline" && value.trim() === "") || isValidExternalEventUrl(value);
}

// "zoom.us/j/123" vira "https://zoom.us/j/123". O que ja traz esquema (ate um
// "javascript:") fica como veio e a validacao acima decide.
export function withLinkScheme(value: string): string {
  const trimmed = value.trim();
  return trimmed && !/^[a-z][a-z\d+.-]*:/i.test(trimmed) ? `https://${trimmed}` : trimmed;
}

// Os quatro fusos principais dos EUA, para a previa do formulario do professor.
export const US_PREVIEW_TIME_ZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
] as const;

// Ingles: a sigla generica ("PT"). Espanhol: o nome longo ("hora del
// Pacifico"), porque a sigla curta sai "GMT-8", que ninguem le.
function zoneNameStyle(locale: string): "shortGeneric" | "longGeneric" {
  return locale.toLowerCase().startsWith("en") ? "shortGeneric" : "longGeneric";
}

// Motor que nao conhece os nomes genericos lanca RangeError: cai no "short"
// em vez de apagar a tela inteira.
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

// A frase que toda tela usa: dia da semana e o fuso de QUEM LE escrito
// ("Wed, Nov 25, 4:00 PM PT"). Antes saia "Nov 25, 2026, 4:00 PM" sem dizer de
// quem era a hora, e a mesma sessao parecia ter tres horarios. `timeZone` so
// para teste e para a previa: sem ele vale o fuso do aparelho. O ano entra so
// quando nao e o ano de `now` (sessao do ano passado em "Past"); `now` e
// parametro para o teste nao depender do relogio.
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

// O fuso em palavras, com a cidade entre parenteses: "Central Time
// (Chicago)". So a cidade do id enganava (quem mora em Dallas lia "Chicago"),
// e "Etc/GMT+5" tem o sinal invertido: ai fica so o nome que o formatador da.
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

// Um instante em varios fusos: ["7:00 PM ET", "6:00 PM CT", ...]. O dia da
// semana so entra quando os fusos caem em dias diferentes (1 AM ET e 10 PM PT
// do dia anterior), senao a previa mentiria. Data invalida: lista vazia.
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
