import { describe, expect, it } from "vitest";

import {
  describeTimeZone,
  formatEventDateTime,
  formatEventTimeInZones,
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
