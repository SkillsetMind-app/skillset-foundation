import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { NotificationBell } from "@/components/platform/notification-bell";
import type { AppNotification } from "@/domain/notification";

// Os avisos de resposta (20261006041500_avisos_de_resposta.sql) chegam com
// title vazio e os ids em params: o sino monta a frase no idioma de quem le e
// leva direto para a pergunta, a caixa do professor, o suporte ou a conversa.

const mocks = vi.hoisted(() => ({
  rows: [] as AppNotification[],
  // "rows" entrega na hora; "pending" segura a resposta; "error" falha.
  mode: "rows" as "rows" | "pending" | "error",
  next: null as null | ((rows: AppNotification[]) => void),
  fail: null as null | ((error: Error) => void),
  reload: vi.fn(async () => undefined),
  unsubscribe: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ status: "authenticated", user: { uid: "u-1" } }),
}));
vi.mock("@/lib/data/notifications", () => ({
  subscribeToNotifications: (
    _uid: string,
    next: (rows: AppNotification[]) => void,
    fail: (error: Error) => void,
  ) => {
    mocks.next = next;
    mocks.fail = fail;
    if (mocks.mode === "rows") next(mocks.rows);
    if (mocks.mode === "error") fail(new Error("offline"));
    return Object.assign(mocks.unsubscribe, { reload: mocks.reload });
  },
  markNotificationAsRead: vi.fn(async () => undefined),
  markAllNotificationsAsRead: vi.fn(async () => undefined),
}));

function notice(extra: Partial<AppNotification> & Pick<AppNotification, "id" | "type">): AppNotification {
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
  mocks.mode = "rows";
  mocks.reload.mockClear();
  mocks.unsubscribe.mockClear();
});
afterEach(cleanup);

describe("o sino antes, durante e depois da leitura", () => {
  it("enquanto a lista nao chega mostra o formato do aviso, nunca 'caught up'", () => {
    mocks.mode = "pending";
    openBell("en");

    expect(screen.getByRole("status")).toHaveTextContent("Loading your notifications...");
    expect(screen.getByRole("dialog", { name: "Notifications" })).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText("You're all caught up")).toBeNull();

    act(() => mocks.next?.([]));
    expect(screen.getByText("You're all caught up")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("se a leitura falha mostra o erro e 'Try again' rele sem desligar o canal", () => {
    mocks.mode = "error";
    openBell("en");

    expect(screen.getByRole("alert")).toHaveTextContent("We could not load your notifications.");
    expect(screen.queryByText("You're all caught up")).toBeNull();
    // Escondido o grupo fica sem nome acessivel; o rotulo e conferido pelo atributo.
    const filters = screen.getByRole("group", { hidden: true });
    expect(filters).toHaveAttribute("aria-label", "Filter notifications");
    expect(filters).not.toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(mocks.reload).toHaveBeenCalledOnce();
    expect(mocks.unsubscribe).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Loading your notifications...");
    // O botao saiu da tela: o foco foi para o titulo, nao caiu na pagina.
    expect(screen.getByRole("heading", { name: "Notifications" })).toHaveFocus();

    act(() => mocks.next?.([notice({ id: "s", type: "support_reply", link: "/support" })]));
    expect(hrefOf("Support replied to your request")).toBe("/support");
  });

  it("uma releitura que falha com a lista na tela mantem a lista", () => {
    mocks.rows = [notice({ id: "s", type: "support_reply", link: "/support" })];
    openBell("en");

    act(() => mocks.fail?.(new Error("offline")));
    expect(screen.getByText("Support replied to your request")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  // "Mark all read" falhava calado: o catch engolia e a pessoa achava que
  // tinha marcado. Agora o painel diz, e os avisos seguem como nao lidos.
  it("'Mark all read' que falha diz no painel e deixa os avisos nao lidos", async () => {
    const { markAllNotificationsAsRead } = await import("@/lib/data/notifications");
    vi.mocked(markAllNotificationsAsRead).mockRejectedValueOnce(new Error("offline"));
    mocks.rows = [notice({ id: "s", type: "support_reply", link: "/support" })];
    openBell("en");

    expect(screen.queryByRole("alert")).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Mark all read" }));
    });
    expect(markAllNotificationsAsRead).toHaveBeenCalledWith("u-1", ["s"]);
    expect(screen.getByRole("alert")).toHaveTextContent("We could not mark your notifications as read. Try again.");
    expect(screen.getByText("Support replied to your request")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open notifications, 1 unread" })).toBeTruthy();

    // Fechar e abrir de novo comeca limpo: a falha antiga nao volta nem e lida.
    fireEvent.click(screen.getByRole("button", { name: "Close notifications" }));
    fireEvent.click(screen.getByRole("button", { name: "Open notifications, 1 unread" }));
    expect(screen.queryByRole("alert")).toBeNull();

    // Falhou de novo: o aviso volta. A tentativa seguinte que da certo o tira.
    vi.mocked(markAllNotificationsAsRead).mockRejectedValueOnce(new Error("offline"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Mark all read" }));
    });
    expect(screen.getByRole("alert")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Mark all read" }));
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("abre como dialogo, leva o foco para dentro e o Esc devolve ao sino", () => {
    openBell("en");
    const bell = screen.getByRole("button", { name: "Open notifications" });
    expect(bell).toHaveAttribute("aria-haspopup", "dialog");
    expect(bell).toHaveAttribute("aria-expanded", "true");

    const panel = screen.getByRole("dialog", { name: "Notifications" });
    expect(panel).toContainElement(document.activeElement as HTMLElement);
    expect(screen.getByRole("heading", { name: "Notifications" })).toHaveFocus();

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(bell).toHaveFocus();
  });

  it("o X fecha e devolve o foco ao sino; os alvos tem 44px", () => {
    mocks.rows = [notice({ id: "s", type: "support_reply", link: "/support" })];
    openBell("en");

    expect(screen.getByRole("button", { name: "Mark all read" })).toHaveClass("min-h-11");
    // All/Unread sao filtros (aria-pressed), nao abas; continuam com 44px.
    const filters = within(screen.getByRole("group", { name: "Filter notifications" })).getAllByRole("button");
    expect(filters).toHaveLength(2);
    for (const tab of filters) expect(tab).toHaveClass("min-h-11");
    expect(filters[0]).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(filters[1]);
    expect(filters[1]).toHaveAttribute("aria-pressed", "true");
    expect(filters[0]).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("link", { name: "View all" })).toHaveClass("min-h-11");
    const close = screen.getByRole("button", { name: "Close notifications" });
    expect(close).toHaveClass("size-11");

    fireEvent.click(close);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: /Open notifications/ })).toHaveFocus();
  });

  it("no celular o painel se prende a barra do topo, com 16px de cada lado", () => {
    openBell("en");
    const panel = screen.getByRole("dialog", { name: "Notifications" });
    // Abaixo de 768px a caixa do sino deixa de ser a referencia (a conta e o
    // idioma ficam a direita dele e o painel comecava fora da tela): o painel
    // fica a 16px da borda direita da barra e tem no maximo a tela menos 32px.
    expect(panel.parentElement).toHaveClass("relative", "max-md:static");
    expect(panel).toHaveClass("absolute", "right-0", "max-md:right-4", "w-[min(380px,calc(100vw-32px))]");
    expect(panel).toHaveClass("max-h-[calc(100svh-96px)]", "overflow-hidden");
  });
});

describe("o sino com os avisos de resposta", () => {
  it("monta cada frase em espanhol e leva direto ao lugar da resposta", () => {
    mocks.rows = [
      notice({
        id: "q", type: "community_question", actorName: "Ana", body: "¿Cómo exporto la hoja?",
        link: "/teach/courses/c1/community", params: { postId: "p1", courseId: "c1" },
      }),
      notice({
        id: "c", type: "community_comment", actorName: "Bia", body: "Usa el botón exportar.",
        link: "/learn/courses/c1/community/q/p1", params: { postId: "p1", commentId: "k1", category: "question" },
      }),
      notice({
        id: "d", type: "community_comment", actorName: "Dani",
        link: "/learn/courses/c1/community/q/p2", params: { postId: "p2", commentId: "k2", category: "discussion" },
      }),
      notice({
        id: "r", type: "community_reply", actorName: "Caio",
        link: "/learn/courses/c1/community/q/p1", params: { postId: "p1", commentId: "k3", category: "question" },
      }),
      notice({
        id: "s", type: "support_reply", body: "No puedo cambiar mi correo",
        link: "/support", params: { ticketId: "t1" },
      }),
      notice({
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
      notice({
        id: "c", type: "community_comment", actorName: null,
        link: "/learn/courses/c1/community/q/p1", params: { category: "question" },
      }),
      notice({ id: "s", type: "support_reply", link: "/support" }),
    ];
    openBell("en");

    expect(hrefOf("Someone answered your question")).toBe("/learn/courses/c1/community/q/p1");
    expect(hrefOf("Support replied to your request")).toBe("/support");
  });

  it("um nome com '$&' aparece como foi escrito", () => {
    mocks.rows = [notice({ id: "q", type: "community_question", actorName: "A$&B", link: "/teach/courses/c1/community" })];
    openBell("en");

    expect(screen.getByText("A$&B asked a question in your course")).toBeTruthy();
  });
});
