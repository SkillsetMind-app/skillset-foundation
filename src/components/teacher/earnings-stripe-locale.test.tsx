import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { TeacherConnectOnboarding } from "@/components/teacher/teacher-connect-onboarding";

// O KYC embutido da Stripe saia no idioma do NAVEGADOR: "Adicionar dados para
// comecar a aceitar dinheiro" no meio de uma pagina em ingles. Agora o idioma
// da INTERFACE vai junto na inicializacao.

// Guarda so o locale, nao o objeto inteiro de init: o `appearance` levaria
// dezenas de variaveis de tema para dentro da mensagem de erro do assert.
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

vi.mock("@stripe/connect-js", () => ({
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

it("passa o idioma da INTERFACE para o componente embutido da Stripe", async () => {
  render(
    <I18nProvider initialLocale="es">
      <TeacherConnectOnboarding />
    </I18nProvider>,
  );

  await waitFor(() => expect(mocks.initialized).toBe(true));
  expect(mocks.locale).toBe("es");
});
