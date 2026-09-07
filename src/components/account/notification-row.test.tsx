import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { formatNotificationTime } from "@/components/account/notification-row";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";

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
