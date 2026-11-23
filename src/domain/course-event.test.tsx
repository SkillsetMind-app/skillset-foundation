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

// O ICU de algumas versoes do Node poe um espaco estreito antes de "PM".
const plain = (text: string) => text.replace(/\s+/g, " ");

describe("formatEventDateTime", () => {
  // A mesma sessao (7 PM em Nova York) parecia ter tres horarios porque
  // nenhuma tela dizia de quem era a hora. Fuso e idioma passados aqui: o
  // resultado nao depende do relogio da maquina do CI.
  const sevenPmNewYork = "2026-11-26T00:00:00.000Z";
  const in2026 = Date.UTC(2026, 10, 22, 12);
  const in2027 = Date.UTC(2027, 1, 10, 12);

  it("escreve dia da semana e o fuso de quem le, em ingles e em espanhol", () => {
    expect(plain(formatEventDateTime(sevenPmNewYork, "en", "Date pending", "America/Los_Angeles", in2026))).toBe(
      "Wed, Nov 25, 4:00 PM PT",
    );
    expect(plain(formatEventDateTime(sevenPmNewYork, "en", "Date pending", "America/New_York", in2026))).toBe(
      "Wed, Nov 25, 7:00 PM ET",
    );
    // Espanhol: o nome longo, nunca "GMT-8".
    const spanish = formatEventDateTime(sevenPmNewYork, "es", "Fecha pendiente", "America/Los_Angeles", in2026);
    expect(plain(spanish)).toBe("mié, 25 nov, 16:00 hora del Pacífico");
    expect(spanish).not.toMatch(/GMT/);
  });

  // "Past" e "All" mostravam a sessao do ano passado sem o ano.
  it("o ano entra so quando nao e o ano de agora, no fuso de quem le", () => {
    expect(plain(formatEventDateTime(sevenPmNewYork, "en", "Date pending", "America/Los_Angeles", in2027))).toBe(
      "Wed, Nov 25, 2026, 4:00 PM PT",
    );
    expect(plain(formatEventDateTime(sevenPmNewYork, "es", "Fecha pendiente", "America/Los_Angeles", in2027))).toBe(
      "mié, 25 nov 2026, 16:00 hora del Pacífico",
    );
    // Virada do ano: 31/dez as 11 PM em Los Angeles ja e 2027 em UTC. Conta o
    // ano de quem le.
    expect(plain(formatEventDateTime("2027-01-01T07:00:00.000Z", "en", "Date pending", "America/Los_Angeles", in2026))).toBe(
      "Thu, Dec 31, 11:00 PM PT",
    );
  });

  // Motor sem os nomes genericos: a frase sai com o "short", sem apagar a tela.
  it("sem shortGeneric/longGeneric no motor, cai no nome curto", () => {
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

  // So a cidade do id enganava: quem mora em Dallas lia "Chicago".
  it("o nome do fuso em palavras, com a cidade entre parenteses", () => {
    expect(describeTimeZone("America/Chicago", "en", at)).toBe("Central Time (Chicago)");
    expect(describeTimeZone("America/Chicago", "es", at)).toBe("hora central (Chicago)");
    expect(describeTimeZone("America/New_York", "en", at)).toBe("Eastern Time (New York)");
  });

  // "Etc/GMT+5" e cinco horas ANTES de Greenwich: o id tem o sinal invertido.
  it("Etc/* e zonas sem cidade ficam so com o nome do formatador", () => {
    const etc = describeTimeZone("Etc/GMT+5", "en", at);
    expect(etc).not.toMatch(/Etc|GMT\+5/);
    expect(etc).toMatch(/05/);
    expect(describeTimeZone("UTC", "en", at)).not.toMatch(/\(/);
  });
});

describe("formatEventTimeInZones", () => {
  it("uma hora nos quatro fusos dos EUA, sem dia quando todos caem no mesmo dia", () => {
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

  it("fusos em dias diferentes ganham o dia da semana; data invalida nao gera nada", () => {
    expect(formatEventTimeInZones("2026-11-26T06:00:00.000Z", "en", US_PREVIEW_TIME_ZONES).map(plain)).toEqual([
      "Thu, 1:00 AM ET",
      "Thu, 12:00 AM CT",
      "Wed, 11:00 PM MT",
      "Wed, 10:00 PM PT",
    ]);
    expect(formatEventTimeInZones("not a date", "en", US_PREVIEW_TIME_ZONES)).toEqual([]);
  });
});

describe("link da sessao", () => {
  // Prazo nao e reuniao: so ele aceita ficar sem link.
  it("so o prazo (deadline) pode ficar sem link; link preenchido segue a regra de sempre", () => {
    expect(isEventLinkAcceptable("deadline", "")).toBe(true);
    expect(isEventLinkAcceptable("deadline", "   ")).toBe(true);
    expect(isEventLinkAcceptable("live_class", "")).toBe(false);
    expect(isEventLinkAcceptable("webinar", "")).toBe(false);
    expect(isEventLinkAcceptable("deadline", "javascript:alert(1)")).toBe(false);
    expect(isEventLinkAcceptable("mentorship", "https://zoom.us/j/1")).toBe(true);
  });

  it("completa o https:// do link digitado sem esquema e nao mexe no resto", () => {
    expect(withLinkScheme("zoom.us/j/123")).toBe("https://zoom.us/j/123");
    expect(withLinkScheme("  meet.google.com/abc  ")).toBe("https://meet.google.com/abc");
    expect(withLinkScheme("http://192.168.0.10/room")).toBe("http://192.168.0.10/room");
    expect(withLinkScheme("javascript:alert(1)")).toBe("javascript:alert(1)");
    expect(withLinkScheme("   ")).toBe("");
  });
});

// Tudo em UTC e com `now` explícito: nada depende do fuso nem do relógio da máquina.
const START = "2026-11-25T21:00:00.000Z";
const at = (minutes: number) => Date.parse(START) + minutes * 60_000;

describe("janela ao vivo (uma regra para as quatro telas)", () => {
  it("upcoming até 15 min antes, startingSoon até o início, live por 3 h, depois over", () => {
    expect(getEventLiveState(START, at(-16))).toBe("upcoming");
    expect(getEventLiveState(START, at(-15))).toBe("startingSoon");
    expect(getEventLiveState(START, at(-1))).toBe("startingSoon");
    expect(getEventLiveState(START, at(0))).toBe("live");
    expect(getEventLiveState(START, at(179))).toBe("live");
    expect(getEventLiveState(START, at(180))).toBe("over");
    expect(EVENT_STARTING_SOON_MS).toBe(15 * 60_000);
    expect(EVENT_LIVE_WINDOW_MS).toBe(3 * 3_600_000);
  });

  it("data inválida fica na lista ('Date pending'), não some", () => {
    expect(getEventLiveState("not a date", at(0))).toBe("upcoming");
  });

  it("a cancelada fica à vista por 7 dias depois da hora marcada", () => {
    expect(isCancelledEventShown(START, at(-60))).toBe(true);
    expect(isCancelledEventShown(START, at(7 * 24 * 60 - 1))).toBe(true);
    expect(isCancelledEventShown(START, at(7 * 24 * 60))).toBe(false);
    expect(isCancelledEventShown("not a date", at(0))).toBe(false);
  });

  it("'Updated' só quando a sessão mudou mais de 1 min depois de criada", () => {
    expect(getEventUpdatedAt({ createdAt: START, updatedAt: START })).toBeNull();
    expect(getEventUpdatedAt({ createdAt: START, updatedAt: new Date(at(1)).toISOString() })).toBeNull();
    expect(getEventUpdatedAt({ createdAt: START, updatedAt: "2026-11-26T09:00:00.000Z" })).toBe("2026-11-26T09:00:00.000Z");
    expect(getEventUpdatedAt({ createdAt: undefined, updatedAt: "2026-11-26T09:00:00.000Z" })).toBeNull();
    expect(getEventUpdatedAt({ createdAt: START, updatedAt: null })).toBeNull();
  });
});

describe("adicionar ao calendário", () => {
  const event = {
    id: "ev-42",
    title: "Liderança; ação, \"Q&A\"",
    description: "Linha 1\nLinha 2",
    courseTitle: "Curso, avançado",
    startsAt: START,
  };
  const link = "https://zoom.us/j/123?pwd=a,b";

  it("Google: link TEMPLATE com início e fim em UTC (60 min) e o link de entrar", () => {
    const url = new URL(buildGoogleCalendarUrl(event, link)!);
    expect(`${url.origin}${url.pathname}`).toBe("https://calendar.google.com/calendar/render");
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("text")).toBe(event.title);
    expect(url.searchParams.get("dates")).toBe("20261125T210000Z/20261125T220000Z");
    expect(url.searchParams.get("details")).toBe(`Curso, avançado\n\nLinha 1\nLinha 2\n\n${link}`);
    expect(url.searchParams.get("location")).toBe(link);
    expect(CALENDAR_EVENT_MINUTES).toBe(60);
  });

  it("Google sem link: nem location nem link na descrição; data inválida não gera link", () => {
    const url = new URL(buildGoogleCalendarUrl(event, null)!);
    expect(url.searchParams.has("location")).toBe(false);
    expect(url.searchParams.get("details")).not.toContain("https://");
    expect(buildGoogleCalendarUrl({ ...event, startsAt: "not a date" }, link)).toBeNull();
  });

  it(".ics: CRLF, UTC com Z, UID estável e texto escapado; acentos intactos", () => {
    const ics = buildEventIcs(event, link, Date.parse("2026-11-20T12:00:00.000Z"))!;
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toContain("\n");
    const lines = ics.replace(/\r\n /g, "").split("\r\n");
    expect(lines).toContain("BEGIN:VCALENDAR");
    expect(lines).toContain("UID:course-event-ev-42@skillsetmind.com");
    expect(lines).toContain("DTSTAMP:20261120T120000Z");
    expect(lines).toContain("DTSTART:20261125T210000Z");
    expect(lines).toContain("DTEND:20261125T220000Z");
    expect(lines).toContain("SUMMARY:Liderança\\; ação\\, \"Q&A\"");
    expect(lines).toContain(`DESCRIPTION:Curso\\, avançado\\n\\nLinha 1\\nLinha 2\\n\\n${link.replace(",", "\\,")}`);
    expect(lines).toContain(`URL:${link}`);
    // O mesmo arquivo baixado de novo tem o mesmo UID.
    expect(buildEventIcs(event, link, Date.now())).toContain("UID:course-event-ev-42@skillsetmind.com");
  });

  it(".ics sem link não leva URL; linha longa dobra em até 75 bytes sem partir acento", () => {
    const long = { ...event, title: "Sessão é ótima ".repeat(10) };
    const ics = buildEventIcs(long, null, at(0))!;
    expect(ics).not.toContain("URL:");
    for (const line of ics.split("\r\n")) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
    const summary = ics.replace(/\r\n /g, "").split("\r\n").find((line) => line.startsWith("SUMMARY:"));
    expect(summary).toBe(`SUMMARY:${long.title}`);
    expect(buildEventIcs({ ...event, startsAt: "" }, null, at(0))).toBeNull();
  });

  it("um link com quebra de linha escondida não vira propriedade nova", () => {
    const ics = buildEventIcs(event, "https://zoom.us/j/1\nATTACH:evil", at(0))!;
    expect(ics).not.toMatch(/\r\nATTACH:/);
  });
});
