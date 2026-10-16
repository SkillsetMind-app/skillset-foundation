import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { NotificationBell } from "@/components/platform/notification-bell";
import type { AppNotification } from "@/domain/notification";

// Os avisos de resposta (20261006041500_avisos_de_resposta.sql) chegam com
// title vazio e os ids em params: o sino monta a frase no idioma de quem le e
// leva direto para a pergunta, a caixa do professor, o suporte ou a conversa.

const mocks = vi.hoisted(() => ({ rows: [] as AppNotification[] }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ status: "authenticated", user: { uid: "u-1" } }),
}));
vi.mock("@/lib/data/notifications", () => ({
  subscribeToNotifications: (_uid: string, next: (rows: AppNotification[]) => void) => {
    next(mocks.rows);
    return () => {};
  },
  markNotificationAsRead: vi.fn(async () => undefined),
  markAllNotificationsAsRead: vi.fn(async () => undefined),
}));

function aviso(extra: Partial<AppNotification> & Pick<AppNotification, "id" | "type">): AppNotification {
  return { title: "", body: "", read: false, ...extra };
}

function openBell(locale: "en" | "es") {
  render(
    <I18nProvider initialLocale={locale}>
      <NotificationBell />
    </I18nProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /notificaciones|notifications/i }));
}

const hrefOf = (text: string) => screen.getByText(text).closest("a")?.getAttribute("href");

beforeEach(() => {
  mocks.rows = [];
});
afterEach(cleanup);

describe("o sino com os avisos de resposta", () => {
  it("monta cada frase em espanhol e leva direto ao lugar da resposta", () => {
    mocks.rows = [
      aviso({
        id: "q", type: "community_question", actorName: "Ana", body: "¿Cómo exporto la hoja?",
        link: "/teach/courses/c1/community", params: { postId: "p1", courseId: "c1" },
      }),
      aviso({
        id: "c", type: "community_comment", actorName: "Bia", body: "Usa el botón exportar.",
        link: "/learn/courses/c1/community/q/p1", params: { postId: "p1", commentId: "k1", category: "question" },
      }),
      aviso({
        id: "d", type: "community_comment", actorName: "Dani",
        link: "/learn/courses/c1/community/q/p2", params: { postId: "p2", commentId: "k2", category: "discussion" },
      }),
      aviso({
        id: "r", type: "community_reply", actorName: "Caio",
        link: "/learn/courses/c1/community/q/p1", params: { postId: "p1", commentId: "k3", category: "question" },
      }),
      aviso({
        id: "s", type: "support_reply", body: "No puedo cambiar mi correo",
        link: "/support", params: { ticketId: "t1" },
      }),
      aviso({
        id: "m", type: "course_message", title: "New message from your teacher",
        body: "Prof: Hola", link: "/learn/courses/c1/messages",
      }),
    ];
    openBell("es");

    expect(hrefOf("Ana hizo una pregunta en tu curso")).toBe("/teach/courses/c1/community");
    expect(screen.getByText("¿Cómo exporto la hoja?")).toBeTruthy();
    expect(hrefOf("Bia respondió tu pregunta")).toBe("/learn/courses/c1/community/q/p1");
    expect(screen.getByText("Usa el botón exportar.")).toBeTruthy();
    expect(hrefOf("Dani respondió tu publicación")).toBe("/learn/courses/c1/community/q/p2");
    expect(hrefOf("Caio respondió una publicación que comentaste")).toBe("/learn/courses/c1/community/q/p1");
    expect(hrefOf("Soporte respondió tu solicitud")).toBe("/support");
    // O titulo ingles que o banco ja gravava tambem sai traduzido.
    expect(hrefOf("Nuevo mensaje de tu profesor")).toBe("/learn/messages?course=c1");
    expect(screen.queryByText("New message from your teacher")).toBeNull();
  });

  it("em ingles, e com 'Someone' quando nao ha nome de quem respondeu", () => {
    mocks.rows = [
      aviso({
        id: "c", type: "community_comment", actorName: null,
        link: "/learn/courses/c1/community/q/p1", params: { category: "question" },
      }),
      aviso({ id: "s", type: "support_reply", link: "/support" }),
    ];
    openBell("en");

    expect(hrefOf("Someone answered your question")).toBe("/learn/courses/c1/community/q/p1");
    expect(hrefOf("Support replied to your request")).toBe("/support");
  });

  it("um nome com '$&' aparece como foi escrito", () => {
    mocks.rows = [aviso({ id: "q", type: "community_question", actorName: "A$&B", link: "/teach/courses/c1/community" })];
    openBell("en");

    expect(screen.getByText("A$&B asked a question in your course")).toBeTruthy();
  });
});
