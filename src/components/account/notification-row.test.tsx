import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NotificationRow, formatNotificationTime } from "@/components/account/notification-row";
import { I18nProvider } from "@/components/i18n/i18n-provider";
import type { AppNotification } from "@/domain/notification";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";

// O I18nProvider chama useRouter() para o refresh ao trocar de idioma.
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/navigation")>(),
  useRouter: () => router,
}));

const now = Date.parse("2026-09-06T12:00:00.000Z");
const t = (key: string) => translate(getDictionary("es"), key);
beforeEach(() => { vi.spyOn(Date, "now").mockReturnValue(now); });
afterEach(() => { vi.restoreAllMocks(); });

describe("optional classroom relative-time localization", () => {
  it.each([
    [20_000, "Just now", "Ahora mismo"],
    [5 * 60_000, "5m ago", "Hace 5 min"],
    [2 * 3_600_000, "2h ago", "Hace 2 h"],
    [3 * 86_400_000, "3d ago", "Hace 3 d"],
  ])("preserves the default and localizes the same timestamp at %s ms", (elapsed, english, spanish) => {
    const value = new Date(now - elapsed).toISOString();
    expect(formatNotificationTime(value)).toBe(english);
    expect(formatNotificationTime(value, t, "es")).toBe(spanish);
    expect(formatNotificationTime({ seconds: (now - elapsed) / 1000 }, t, "es")).toBe(spanish);
  });

  it("uses the requested locale for older dates and keeps the default format", () => {
    const date = new Date(now - 8 * 86_400_000);
    expect(formatNotificationTime(date.toISOString(), t, "es")).toBe(date.toLocaleDateString("es"));
    expect(formatNotificationTime(date.toISOString())).toBe(date.toLocaleDateString());
  });

  it("keeps invalid and missing timestamps empty", () => {
    for (const value of [undefined, null, "invalid", {}, { seconds: 0 }]) {
      expect(formatNotificationTime(value, t, "es")).toBe("");
    }
  });
});

// A linha do sino e da caixa de entrada chamava o formatador sem `t` nem
// `locale`: em espanhol a hora saia em ingles.
describe("NotificationRow", () => {
  it("mostra a hora da notificacao no idioma da pessoa", () => {
    const notification: AppNotification = {
      id: "n1",
      type: "enrollment",
      title: "Nueva inscripción",
      body: "",
      read: true,
      createdAt: new Date(now - 5 * 60_000).toISOString(),
    };
    render(
      <I18nProvider initialLocale="es">
        <NotificationRow notification={notification} />
      </I18nProvider>,
    );

    expect(screen.getByText("Hace 5 min")).toBeInTheDocument();
  });
});
