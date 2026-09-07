import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { StatusChip } from "@/components/shared/status-chip";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(cleanup);

it.each([
  ["processing", "En proceso", "info"],
  ["rejected", "Rechazado", "danger"],
  ["future_custom_status", "future custom status", "draft"],
])("presents %s without changing its canonical status or losing the future fallback", (status, label, variant) => {
  render(<I18nProvider initialLocale="es"><StatusChip status={status} /></I18nProvider>);
  expect(screen.getByText(label)).toHaveAttribute("data-status", status);
  expect(screen.getByText(label)).toHaveClass(`status-chip--${variant}`);
});
