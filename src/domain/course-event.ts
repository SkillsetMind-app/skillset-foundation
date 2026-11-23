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

// A janela "ao vivo", uma so para as quatro telas do aluno. Antes cada uma
// chutava: o painel tirava a sessao no minuto em que comecava, a sala mantinha
// 2 h, a agenda e a comunidade 3 h. Nao existe coluna de duracao: 3 h depois do
// inicio a sessao conta como acabada, e 15 min antes ela ja esta "comecando".
export const EVENT_STARTING_SOON_MS = 15 * 60_000;
export const EVENT_LIVE_WINDOW_MS = 3 * 3_600_000;

export type EventLiveState = "upcoming" | "startingSoon" | "live" | "over";

// Data invalida fica "upcoming": a sessao continua na lista com "Date pending"
// em vez de sumir.
export function getEventLiveState(startsAt: string, now: number): EventLiveState {
  const start = Date.parse(startsAt);
  if (!Number.isFinite(start) || now < start - EVENT_STARTING_SOON_MS) return "upcoming";
  if (now < start) return "startingSoon";
  return now < start + EVENT_LIVE_WINDOW_MS ? "live" : "over";
}

// Cancelada continua a vista, marcada, ate 7 dias depois da hora marcada: quem
// disse "vou" acha a sessao e le "Cancelled" em vez de ve-la sumir.
const CANCELLED_SHOWN_MS = 7 * 24 * 3_600_000;

export function isCancelledEventShown(startsAt: string, now: number): boolean {
  const start = Date.parse(startsAt);
  return Number.isFinite(start) && now < start + CANCELLED_SHOWN_MS;
}

// O instante da ultima mudanca, so quando a sessao mudou depois de criada:
// criar grava os dois carimbos iguais, e 1 min de folga cobre o resto.
export function getEventUpdatedAt(event: Pick<CourseEvent, "createdAt" | "updatedAt">): string | null {
  const created = Date.parse(String(event.createdAt ?? ""));
  const updated = Date.parse(String(event.updatedAt ?? ""));
  return Number.isFinite(created) && updated - created > 60_000 ? String(event.updatedAt) : null;
}

// Sem hora de fim, a entrada do calendario assume 60 min (a tela diz isso).
export const CALENDAR_EVENT_MINUTES = 60;

type CalendarEvent = Pick<CourseEvent, "id" | "title" | "description" | "courseTitle" | "startsAt">;

// 2026-11-25T21:00:00.000Z -> 20261125T210000Z (UTC, como o Google e o .ics pedem).
function calendarStamp(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function calendarDetails(event: CalendarEvent, joinUrl: string | null) {
  const start = Date.parse(event.startsAt);
  if (!Number.isFinite(start)) return null;
  // O link volta normalizado pelo parser: uma quebra de linha escondida nele
  // nao vira propriedade nova no arquivo.
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

// O link "adicionar ao Google Calendar", montado no navegador. `joinUrl` so
// quando o aluno pode ver o link (matriculado). Data invalida: null.
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

// Texto do iCalendar (RFC 5545): barra, ponto e virgula, virgula e quebra de
// linha escapados; acentos seguem como UTF-8.
function icsText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

// Linha com mais de 75 bytes dobra (RFC 5545 3.1), sem partir um caractere.
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

// O arquivo .ics de uma sessao. UID estavel (o mesmo arquivo baixado duas
// vezes atualiza a mesma entrada); `now` e o carimbo DTSTAMP. Data invalida: null.
export function buildEventIcs(event: CalendarEvent, joinUrl: string | null, now: number): string | null {
  const details = calendarDetails(event, joinUrl);
  if (!details) return null;
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//SkillsetMind//Live sessions//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:course-event-${event.id}@skillsetmind.com`,
    `DTSTAMP:${calendarStamp(now)}`,
    `DTSTART:${details.start}`,
    `DTEND:${details.end}`,
    `SUMMARY:${icsText(event.title)}`,
    `DESCRIPTION:${icsText(details.text)}`,
    ...(details.url ? [`URL:${details.url}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ].map(foldIcsLine).join("\r\n") + "\r\n";
}
