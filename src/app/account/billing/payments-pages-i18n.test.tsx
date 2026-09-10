import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import BillingUpgradePage from "@/app/account/billing/upgrade/page";
import BillingReturnPage from "@/app/account/billing/return/page";
import TeachActivatePage from "@/app/teach/activate/page";
import TeachActivateReturnPage from "@/app/teach/activate/return/page";
import { I18nProvider } from "@/components/i18n/i18n-provider";
import { LOCALE_COOKIE } from "@/lib/i18n/config";

const mocks = vi.hoisted(() => ({ locale: "es", guard: vi.fn(), checkout: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => name === LOCALE_COOKIE ? { value: mocks.locale } : undefined }),
}));
vi.mock("@/components/auth/protected-surface", () => ({
  ProtectedSurface: ({ children, permissions }: { children: ReactNode; permissions: string[] }) => {
    mocks.guard(permissions);
    return children;
  },
}));
vi.mock("@/components/platform/platform-shell", () => ({
  PlatformShell: ({ children, title }: { children: ReactNode; title: string }) => <><h1>{title}</h1>{children}</>,
}));
vi.mock("@/components/account/embedded-checkout-panel", () => ({
  EmbeddedCheckoutPanel: (props: unknown) => { mocks.checkout(props); return <div>Checkout fixture</div>; },
}));
vi.mock("@/components/teacher/activation-checkout-panel", () => ({ ActivationCheckoutPanel: () => <div>Activation fixture</div> }));
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

it.each(["en", "es"] as const)("uses real server dictionaries for upgrade parameters and missing-plan recovery in %s", async (locale) => {
  mocks.locale = locale;
  const view = render(await BillingUpgradePage({ searchParams: Promise.resolve({ plan: ["pro", "plus"], cycle: ["yearly", "monthly"] }) }));
  expect(screen.getByRole("heading", { name: locale === "es" ? "Mejora tu plan" : "Upgrade your plan" })).toBeInTheDocument();
  expect(mocks.guard).toHaveBeenCalledWith(["auth.signOut"]);
  expect(mocks.checkout).toHaveBeenCalledWith({ planId: "pro", cycle: "yearly" });
  view.unmount();
  mocks.checkout.mockClear();
  render(await BillingUpgradePage({ searchParams: Promise.resolve({ plan: "free", cycle: "invalid" }) }));
  expect(screen.getByRole("heading", { name: locale === "es" ? "No hay ningún plan seleccionado." : "No plan selected." })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: locale === "es" ? "Ver planes" : "See plans" })).toHaveAttribute("href", "/account/billing?tab=subscriptions");
  expect(mocks.checkout).not.toHaveBeenCalled();
});

it.each(["en", "es"] as const)("does not treat a typed session reference as verified payment in %s", async (locale) => {
  mocks.locale = locale;
  render(await BillingReturnPage({ searchParams: Promise.resolve({ session_id: "arbitrary-not-verified" }) }));
  expect(screen.getByRole("heading", { name: locale === "es" ? "Esperando la confirmación del pago." : "Awaiting checkout confirmation." })).toBeInTheDocument();
  expect(screen.getByText(locale === "es" ? /Esta página no verifica el estado del pago/ : /This page does not verify payment status/)).toBeInTheDocument();
  expect(screen.queryByText(/Checkout complete|Pago completado|arbitrary-not-verified/)).toBeNull();
  expect(screen.getByRole("link", { name: locale === "es" ? "Volver a la facturación" : "Back to billing" })).toHaveAttribute("href", "/account/billing?tab=subscriptions");
  expect(mocks.guard).toHaveBeenCalledWith(["auth.signOut"]);
  expect(mocks.checkout).not.toHaveBeenCalled();
});

it.each(["en", "es"] as const)("handles a return without session reference in %s", async (locale) => {
  mocks.locale = locale;
  render(await BillingReturnPage({}));
  expect(screen.getByRole("heading", { name: locale === "es" ? "No hay referencia de pago." : "No checkout reference." })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: locale === "es" ? "Ir a la facturación" : "Go to billing" })).toHaveAttribute("href", "/account/billing?tab=subscriptions");
});

it.each(["en", "es"] as const)("localizes activation pages with the real provider and preserves creator authorization in %s", (locale) => {
  const view = render(<I18nProvider initialLocale={locale}><TeachActivatePage /></I18nProvider>);
  expect(screen.getByRole("heading", { name: locale === "es" ? "Activa tu tienda" : "Activate your storefront" })).toBeInTheDocument();
  expect(mocks.guard).toHaveBeenCalledWith(["teacherStudio.access"]);
  view.unmount();
  render(<I18nProvider initialLocale={locale}><TeachActivateReturnPage /></I18nProvider>);
  expect(screen.getByRole("heading", { name: locale === "es" ? "Estamos confirmando tu pago." : "We're confirming your payment." })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: locale === "es" ? "Volver al estudio de cursos" : "Back to course studio" })).toHaveAttribute("href", "/teach/builder");
  expect(screen.getByRole("link", { name: locale === "es" ? "Contactar con soporte" : "Contact support" })).toHaveAttribute("href", "/support");
});
