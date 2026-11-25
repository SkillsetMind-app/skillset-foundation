import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { NotificationBell } from "@/components/platform/notification-bell";
import type { AppNotification } from "@/domain/notification";

// The reply notifications (20261006041500_avisos_de_resposta.sql) arrive with
// an empty title and the ids in params: the bell builds the sentence in the language of whoever reads and
// leads straight to the question, the teacher's inbox, support or the conversation.

const mocks = vi.hoisted(() => ({
  rows: [] as AppNotification[],
  // "rows" delivers at once; "pending" holds the answer; "error" fails.
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

describe("the bell before, during and after the read", () => {
  it("while the list has not arrived it shows the notification shape, never 'caught up'", () => {
    mocks.mode = "pending";
    openBell("en");

    expect(screen.getByRole("status")).toHaveTextContent("Loading your notifications...");
    expect(screen.getByRole("dialog", { name: "Notifications" })).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText("You're all caught up")).toBeNull();

    act(() => mocks.next?.([]));
    expect(screen.getByText("You're all caught up")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("if the read fails it shows the error and 'Try again' re-reads without dropping the channel", () => {
    mocks.mode = "error";
    openBell("en");

    expect(screen.getByRole("alert")).toHaveTextContent("We could not load your notifications.");
    expect(screen.queryByText("You're all caught up")).toBeNull();
    // When hidden the group has no accessible name; the label is checked by the attribute.
    const filters = screen.getByRole("group", { hidden: true });
    expect(filters).toHaveAttribute("aria-label", "Filter notifications");
    expect(filters).not.toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(mocks.reload).toHaveBeenCalledOnce();
    expect(mocks.unsubscribe).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Loading your notifications...");
    // The button left the screen: focus went to the title, it did not fall onto the page.
    expect(screen.getByRole("heading", { name: "Notifications" })).toHaveFocus();

    act(() => mocks.next?.([notice({ id: "s", type: "support_reply", link: "/support" })]));
    expect(hrefOf("Support replied to your request")).toBe("/support");
  });

  it("a re-read that fails with the list on screen keeps the list", () => {
    mocks.rows = [notice({ id: "s", type: "support_reply", link: "/support" })];
    openBell("en");

    act(() => mocks.fail?.(new Error("offline")));
    expect(screen.getByText("Support replied to your request")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  // "Mark all read" used to fail silently: the catch swallowed it and the person thought they
  // had marked them. Now the panel says so, and the notifications stay unread.
  it("a 'Mark all read' that fails says so in the panel and leaves the notifications unread", async () => {
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

    // Closing and opening again starts clean: the old failure does not come back nor is it read out.
    fireEvent.click(screen.getByRole("button", { name: "Close notifications" }));
    fireEvent.click(screen.getByRole("button", { name: "Open notifications, 1 unread" }));
    expect(screen.queryByRole("alert")).toBeNull();

    // Failed again: the notice comes back. The next attempt that succeeds removes it.
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

  it("opens as a dialog, takes focus inside and Esc returns it to the bell", () => {
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

  it("the X closes and returns focus to the bell; the targets are 44px", () => {
    mocks.rows = [notice({ id: "s", type: "support_reply", link: "/support" })];
    openBell("en");

    expect(screen.getByRole("button", { name: "Mark all read" })).toHaveClass("min-h-11");
    // All/Unread are filters (aria-pressed), not tabs; they keep 44px.
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

  it("on a phone the panel attaches to the top bar, with 16px on each side", () => {
    openBell("en");
    const panel = screen.getByRole("dialog", { name: "Notifications" });
    // Below 768px the bell's box stops being the reference (the account and the
    // language sit to its right and the panel started off screen): the panel
    // stays 16px from the bar's right edge and is at most the screen minus 32px.
    expect(panel.parentElement).toHaveClass("relative", "max-md:static");
    expect(panel).toHaveClass("absolute", "right-0", "max-md:right-4", "w-[min(380px,calc(100vw-32px))]");
    expect(panel).toHaveClass("max-h-[calc(100svh-96px)]", "overflow-hidden");
  });
});

describe("the bell with the reply notifications", () => {
  it("builds each sentence in Spanish and leads straight to the place of the reply", () => {
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
    // The English title the database already stored also comes out translated.
    expect(hrefOf("Nuevo mensaje de tu profesor")).toBe("/learn/messages?course=c1");
    expect(screen.queryByText("New message from your teacher")).toBeNull();
  });

  it("in English, and with 'Someone' when there is no name for whoever replied", () => {
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

  it("a name with '$&' appears as it was written", () => {
    mocks.rows = [notice({ id: "q", type: "community_question", actorName: "A$&B", link: "/teach/courses/c1/community" })];
    openBell("en");

    expect(screen.getByText("A$&B asked a question in your course")).toBeTruthy();
  });
});
