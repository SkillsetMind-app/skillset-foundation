import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { TeacherConnectOnboarding } from "@/components/teacher/teacher-connect-onboarding";

// Stripe's embedded KYC came out in the BROWSER's language: "Adicionar dados para
// comecar a aceitar dinheiro" in the middle of an English page. Now the INTERFACE
// language goes along at initialization.

// Keeps only the locale, not the whole init object: `appearance` would carry
// dozens of theme variables into the assert's error message.
const mocks = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_test_earnings";
  return { initialized: false, locale: undefined as unknown };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
}));

vi.mock("@/lib/theme/theme-provider", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

vi.mock("@/lib/payments/connect", () => ({
  isConnectNotEnabledError: () => false,
  fetchConnectAccountSessionSecret: () => Promise.resolve("secret_x"),
  startTeacherStripeOnboarding: () => Promise.resolve({ url: "" }),
}));

vi.mock("@stripe/connect-js/pure", () => ({
  loadConnectAndInitialize: (params: Record<string, unknown>) => {
    mocks.initialized = true;
    mocks.locale = params.locale;
    return Promise.resolve({ update: () => {} });
  },
}));

vi.mock("@stripe/react-connect-js", () => ({
  ConnectComponentsProvider: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ConnectAccountOnboarding: () => <div data-testid="stripe-onboarding" />,
}));

afterEach(() => {
  cleanup();
  mocks.initialized = false;
  mocks.locale = undefined;
});

it("passes the INTERFACE language to Stripe's embedded component", async () => {
  render(
    <I18nProvider initialLocale="es">
      <TeacherConnectOnboarding />
    </I18nProvider>,
  );

  await waitFor(() => expect(mocks.initialized).toBe(true));
  expect(mocks.locale).toBe("es");
});
