import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NotificationRow, formatNotificationTime } from "@/components/account/notification-row";
import { I18nProvider } from "@/components/i18n/i18n-provider";
import { formatEventDateTime } from "@/domain/course-event";
import type { AppNotification } from "@/domain/notification";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";

// The I18nProvider calls useRouter() to refresh when the language changes.
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

// The bell and inbox row called the formatter without `t` or
// `locale`: in Spanish the time came out in English.
describe("NotificationRow", () => {
  it("shows the notification time in the person's language", () => {
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

  // The session notice arrived in English and in UTC for people using Spanish. The
  // time zone here is the device's (the same on both sides); the format with a fixed
  // time zone is in notification-href.test.ts.
  it("scheduled session notice: translated title and time in the reader's time zone", () => {
    const notification: AppNotification = {
      id: "n2",
      type: "live_event",
      title: "Live session scheduled: Office hours",
      body: "Mindful leadership — Nov 26, 2026 at 00:00 UTC",
      read: false,
      createdAt: new Date(now - 5 * 60_000).toISOString(),
    };
    render(
      <I18nProvider initialLocale="es">
        <NotificationRow notification={notification} />
      </I18nProvider>,
    );

    expect(screen.getByText("Sesión en vivo programada: Office hours")).toBeInTheDocument();
    const when = formatEventDateTime("2026-11-26T00:00:00.000Z", "es").replace(/\s+/g, " ");
    expect(screen.getByText(`Mindful leadership — ${when}`)).toBeInTheDocument();
    expect(screen.queryByText(/UTC/)).toBeNull();
  });
});
