import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";
import type { Locale } from "@/lib/i18n/config";
import { PaymentRequestError } from "@/lib/payments/client-fetch";
import { StripeDashboardButton } from "./stripe-dashboard-button";

const mocks = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("@/lib/payments/connect", () => ({ openTeacherStripeDashboard: mocks.open }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
function Language() {
  const { locale, setLocale } = useTranslation();
  return <button onClick={() => setLocale(locale === "en" ? "es" : "en")}>Language</button>;
}
function copy(locale: Locale, key: string) {
  const value = translate(getDictionary(locale), `stripeDashboard.${key}`);
  expect(value).not.toBe(`stripeDashboard.${key}`);
  return value;
}
function mount(locale: Locale) {
  return render(<I18nProvider initialLocale={locale}><Language /><StripeDashboardButton /></I18nProvider>);
}
beforeEach(() => mocks.open.mockReset().mockResolvedValue(undefined));
afterEach(cleanup);

describe.each(["en", "es"] as const)("Stripe dashboard button (%s)", (locale) => {
  it("only starts on click, announces busy, preserves focus and ignores repeated clicks", async () => {
    let finish!: () => void;
    mocks.open.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    mount(locale);
    expect(mocks.open).not.toHaveBeenCalled();
    const button = screen.getByRole("button", { name: copy(locale, "open") });
    button.focus();
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveTextContent(copy(locale, "opening"));
    expect(button).toHaveFocus();
    fireEvent.click(button);
    expect(mocks.open).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    expect(button).toHaveAttribute("aria-busy", "false");
    expect(button).toHaveTextContent(copy(locale, "open"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each([
    [409, "connect_required", "setup", "setupAction", "/account/payments#stripe-connect"],
    [401, "unauthenticated", "signIn", "signInAction", "/login"],
    [429, undefined, "rateLimit", "support", "/support"],
    [502, "stripe_dashboard_unavailable", "error", "support", "/support"],
    [403, "permission_denied", "error", "support", "/support"],
  ] as const)("offers recovery for HTTP %s without exposing server diagnostics", async (status, code, key, action, href) => {
    mocks.open.mockRejectedValueOnce(new PaymentRequestError("private diagnostic", status, code));
    mount(locale);
    const button = screen.getByRole("button", { name: copy(locale, "open") });
    button.focus();
    fireEvent.click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent(copy(locale, key));
    expect(screen.getByRole("link", { name: copy(locale, action) })).toHaveAttribute("href", href);
    expect(screen.queryByText(/private diagnostic/)).toBeNull();
    expect(document.getElementById(button.getAttribute("aria-describedby")!)).toContainElement(screen.getByRole("alert"));
    expect(button).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Language" }));
    const other = locale === "en" ? "es" : "en";
    expect(screen.getByRole("alert")).toHaveTextContent(copy(other, key));
    fireEvent.click(screen.getByRole("button", { name: copy(other, "open") }));
    await act(async () => {});
    expect(screen.queryByRole("alert")).toBeNull();
    expect(mocks.open).toHaveBeenCalledTimes(2);
  });

  it("shows a localized retry and support path for network or invalid-link failures", async () => {
    mocks.open.mockRejectedValue(new Error("private URL"));
    mount(locale);
    fireEvent.click(screen.getByRole("button", { name: copy(locale, "open") }));
    expect(await screen.findByRole("alert")).toHaveTextContent(copy(locale, "error"));
    expect(screen.queryByText(/private URL/)).toBeNull();
  });
});
