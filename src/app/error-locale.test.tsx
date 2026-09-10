import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import PageError from "./error";
import GlobalError from "./global-error";
import { I18nProvider } from "@/components/i18n/i18n-provider";
import { LOCALE_COOKIE } from "@/lib/i18n/config";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/posthog/client", () => ({ captureException: vi.fn() }));
afterEach(() => { cleanup(); document.cookie = `${LOCALE_COOKIE}=; path=/; max-age=0`; });
it("translates route recovery without changing retry or home destination", () => {
  const reset = vi.fn();
  render(<I18nProvider initialLocale="es"><PageError error={new Error("private details")} reset={reset} /></I18nProvider>);
  expect(screen.getByRole("heading", { name: "Esta página encontró un error inesperado." })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Intentar de nuevo" }));
  expect(reset).toHaveBeenCalledOnce();
  expect(screen.getByRole("link", { name: "Ir al inicio" }).getAttribute("href")).toBe("/");
  expect(screen.queryByText("private details")).toBeNull();
});
it("renders a deterministic English crash shell on the server, without requiring providers", () => {
  const html = renderToStaticMarkup(<GlobalError error={new Error("private")} reset={vi.fn()} />);
  expect(html).toContain('lang="en"');
  expect(html).toContain("The app hit an unexpected error.");
  expect(html).not.toContain("private");
});
// The client crash-recovery case lives in global-error-locale.test.tsx: it must be
// the only React root in its file (see the note there).
