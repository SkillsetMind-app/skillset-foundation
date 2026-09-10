import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NotificationsInbox } from "./notifications-inbox";
import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import type { AppNotification } from "@/domain/notification";

const mocks = vi.hoisted(() => ({ rows: [] as AppNotification[], markAll: vi.fn(), markOne: vi.fn(), subscribe: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/auth/auth-provider", () => ({ useAuth: () => ({ status: "authenticated", user: { uid: "u-1" } }) }));
vi.mock("@/lib/data/notifications", () => ({ subscribeToNotifications: mocks.subscribe, markAllNotificationsAsRead: mocks.markAll, markNotificationAsRead: mocks.markOne }));
function Toggle() { const { setLocale } = useTranslation(); return <button onClick={() => setLocale("en")}>English</button>; }
function mount() { return render(<I18nProvider initialLocale="es"><Toggle /><NotificationsInbox /></I18nProvider>); }
beforeEach(() => {
  vi.clearAllMocks(); mocks.rows = [];
  mocks.subscribe.mockImplementation((_uid, next) => { next(mocks.rows); return vi.fn(); });
  mocks.markAll.mockResolvedValue(undefined); mocks.markOne.mockResolvedValue(undefined);
});
afterEach(cleanup);
it("translates empty state and keeps notification preference destination", () => {
  mount();
  expect(screen.getByText("Aún no hay notificaciones")).toBeTruthy();
  expect(screen.getByRole("group", { name: "Filtrar notificaciones" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Preferencias de notificaciones" }).getAttribute("href")).toBe("/account?tab=notifications");
});
it("keeps authored notification text, unread ids and selection across language changes", async () => {
  mocks.rows = [{ id: "n-1", type: "community_reply", title: "Original $& title", body: "Author message", read: false }];
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Sin leer (1)" }));
  expect(screen.getByText("Original $& title")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Marcar todas como leídas" }));
  await waitFor(() => expect(mocks.markAll).toHaveBeenCalledWith("u-1", ["n-1"]));
  fireEvent.click(screen.getByRole("button", { name: "English" }));
  expect(screen.getByRole("button", { name: "Unread (1)" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByText("Author message")).toBeTruthy();
  expect(mocks.subscribe).toHaveBeenCalledTimes(1);
});
