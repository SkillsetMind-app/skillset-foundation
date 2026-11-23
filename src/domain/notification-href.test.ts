import { describe, expect, it } from "vitest";

import { notificationBody, notificationHref, notificationTitle } from "@/domain/notification";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";

// Reanalise item 12: a resposta do professor abre a caixa de mensagens do
// aluno, nao a sala inteira. O servidor grava "/learn/courses/<curso>" no
// link; a regra reescreve no cliente (vale para as notificacoes antigas).

describe("para onde a notificacao leva", () => {
  it("mensagem do professor: da sala inteira para a conversa daquele curso", () => {
    expect(
      notificationHref({ type: "course_message", link: "/learn/courses/course-1" }),
    ).toBe("/learn/messages?course=course-1");
    expect(
      notificationHref({ type: "course_message", link: "/learn/courses/course-1?lesson=l2" }),
    ).toBe("/learn/messages?course=course-1");
  });

  it("mensagem sem curso no link (o servidor gravou /learn) fica como esta", () => {
    expect(notificationHref({ type: "course_message", link: "/learn" })).toBe("/learn");
  });

  it("sessao marcada: da sala inteira para a aba das sessoes ao vivo", () => {
    expect(notificationHref({ type: "live_event", link: "/learn/courses/course-1" })).toBe(
      "/learn/courses/course-1/lives",
    );
    // Link que ja aponta uma aba fica como esta.
    expect(notificationHref({ type: "live_event", link: "/learn/courses/course-1/community" })).toBe(
      "/learn/courses/course-1/community",
    );
  });

  it("os outros tipos nao mudam, e sem link nao ha destino", () => {
    expect(
      notificationHref({ type: "community_reply", link: "/learn/courses/course-1/community" }),
    ).toBe("/learn/courses/course-1/community");
    expect(notificationHref({ type: "certificate", link: null })).toBeNull();
  });
});

// O banco grava o aviso de sessao em ingles e em UTC
// (notify_enrolled_on_course_event): a aluna em Los Angeles lia "Nov 26 at
// 00:00 UTC" para uma sessao que, para ela, era dia 25 as 4 PM.
describe("aviso de sessao marcada no idioma e no fuso de quem le", () => {
  const plain = (text: string) => text.replace(/\s+/g, " ");
  const stored = { type: "live_event" as const, body: "Mindful leadership — Nov 26, 2026 at 00:00 UTC" };

  it("reescreve a data do texto com a frase das outras telas", () => {
    expect(plain(notificationBody(stored, "en", "America/Los_Angeles"))).toBe(
      "Mindful leadership — Wed, Nov 25, 4:00 PM PT",
    );
    expect(plain(notificationBody(stored, "es", "America/Los_Angeles"))).toBe(
      "Mindful leadership — mié, 25 nov, 16:00 hora del Pacífico",
    );
    // Dia com zero na frente (o banco escreve "Nov 05") e produto com travessao.
    expect(plain(notificationBody(
      { type: "live_event", body: "Calm — a course — Mar 05, 2027 at 15:30 UTC" },
      "en",
      "America/New_York",
    ))).toBe("Calm — a course — Fri, Mar 5, 10:30 AM ET");
  });

  it("texto que nao bate com o formato do banco aparece como esta", () => {
    for (const body of ["Mindful leadership — 2026-11-26T00:00:00Z", "Mindful leadership — Foo 26, 2026 at 00:00 UTC", ""]) {
      expect(notificationBody({ type: "live_event", body }, "es", "America/Los_Angeles")).toBe(body);
    }
    // Outro tipo de aviso com o mesmo formato nao e tocado.
    expect(notificationBody({ ...stored, type: "enrollment" }, "es", "America/Los_Angeles")).toBe(stored.body);
  });

  it("traduz o titulo gravado em ingles e mantem o nome da sessao literal", () => {
    const t = (key: string) => translate(getDictionary("es"), key);
    expect(notificationTitle({ type: "live_event", title: "Live session scheduled: Q&A $& live" }, t)).toBe(
      "Sesión en vivo programada: Q&A $& live",
    );
    expect(notificationTitle({ type: "live_event", title: "Something else" }, t)).toBe("Something else");
  });
});
