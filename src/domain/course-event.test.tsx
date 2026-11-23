import { describe, expect, it } from "vitest";

import {
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

  it("escreve dia da semana e o fuso de quem le, em ingles e em espanhol", () => {
    expect(plain(formatEventDateTime(sevenPmNewYork, "en", "Date pending", "America/Los_Angeles"))).toBe(
      "Wed, Nov 25, 4:00 PM PT",
    );
    expect(plain(formatEventDateTime(sevenPmNewYork, "en", "Date pending", "America/New_York"))).toBe(
      "Wed, Nov 25, 7:00 PM ET",
    );
    // Espanhol: o nome longo, nunca "GMT-8".
    const spanish = formatEventDateTime(sevenPmNewYork, "es", "Fecha pendiente", "America/Los_Angeles");
    expect(plain(spanish)).toBe("mié, 25 nov, 16:00 hora del Pacífico");
    expect(spanish).not.toMatch(/GMT/);
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
