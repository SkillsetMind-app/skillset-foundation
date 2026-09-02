import { describe, expect, it } from "vitest";

import { notificationHref } from "@/domain/notification";

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

  it("os outros tipos nao mudam, e sem link nao ha destino", () => {
    expect(
      notificationHref({ type: "community_reply", link: "/learn/courses/course-1/community" }),
    ).toBe("/learn/courses/course-1/community");
    expect(notificationHref({ type: "certificate", link: null })).toBeNull();
  });
});
