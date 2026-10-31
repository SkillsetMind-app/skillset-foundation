import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SignupForm } from "@/components/auth/signup-form";
import { I18nProvider } from "@/components/i18n/i18n-provider";
import { PLAN_TRIAL_DAYS } from "@/data/plans";
import { type Locale } from "@/lib/i18n/config";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";

const mocks = vi.hoisted(() => ({
  params: new URLSearchParams("path=teacher"),
  router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
  signup: vi.fn(),
  google: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  useSearchParams: () => mocks.params,
}));
vi.mock("@/lib/auth/supabase-auth", () => ({
  signUpWithEmail: mocks.signup,
  signInWithGoogle: mocks.google,
  getAuthErrorMessage: vi.fn(),
  isAccountExistsError: () => false,
  isMultiFactorRequiredError: () => false,
}));
vi.mock("@/lib/auth/providers", () => ({ isGoogleAuthEnabled: true }));
vi.mock("@/lib/data/user-profiles", () => ({
  acceptUserTerms: vi.fn(),
  updateUserIdentity: vi.fn(),
  getUserProfile: vi.fn(),
}));
vi.mock("@/lib/posthog/events", () => ({ track: { userSignedUp: vi.fn() } }));
vi.mock("@/components/auth/turnstile-widget", () => ({
  TurnstileWidget: () => null,
  isCaptchaEnabled: false,
}));

const expected = {
  en: {
    account: "Creating an account does not start a paid plan.",
    trial: `${PLAN_TRIAL_DAYS} days free on your first plan`,
    card: "card required",
    renewal: "automatic renewal",
    cancellation: "Cancel in Billing before the trial ends",
    fees: "Sales fees apply.",
    link: "Plans and pricing",
  },
  es: {
    account: "Crear una cuenta no inicia un plan de pago.",
    trial: `${PLAN_TRIAL_DAYS} días gratis en tu primer plan`,
    card: "requiere tarjeta",
    renewal: "renovación automática",
    cancellation: "Cancela en Facturación antes de que termine la prueba",
    fees: "Se aplican comisiones por venta.",
    link: "Planes y precios",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.params = new URLSearchParams("path=teacher");
  mocks.fetch.mockRejectedValue(new Error("Rede proibida neste teste"));
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => {
  cleanup();
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(mocks.signup).not.toHaveBeenCalled();
  expect(mocks.google).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

function mount(locale: Locale) {
  const dict = getDictionary(locale);
  render(<I18nProvider initialLocale={locale} initialDictionary={dict}><SignupForm /></I18nProvider>);
  return (key: string) => translate(dict, key);
}

function disclosure(locale: "en" | "es") {
  const copy = expected[locale];
  const link = screen.getByRole("link", { name: copy.link });
  const notice = link.closest("p");
  expect(notice).not.toBeNull();
  for (const key of ["account", "trial", "card", "renewal", "cancellation", "fees"] as const) {
    expect(notice).toHaveTextContent(copy[key]);
  }
  expect(notice).not.toHaveTextContent("{days}");
  expect(link).toHaveAttribute("href", "/pricing");
  expect(link).not.toHaveAttribute("target");
  return notice!;
}

describe.each(["en", "es"] as const)("Disclosures no cadastro %s", (locale) => {
  it("explica a contratacao antes de email ou Google, sem inicia-la", () => {
    const t = mount(locale);
    const notice = disclosure(locale);
    const google = screen.getByRole("button", { name: t("auth.continueWithGoogle") });
    expect(notice.compareDocumentPosition(google) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(google).toBeDisabled();
    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });

  it("mantem as condicoes perto da criacao da conta no segundo passo", () => {
    const t = mount(locale);
    fireEvent.change(screen.getByLabelText(t("auth.signup.fullName")), { target: { value: "Alex Example" } });
    fireEvent.change(screen.getByLabelText(t("auth.email")), { target: { value: "alex@example.test" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: t("auth.signup.continue") }));
    const notice = disclosure(locale);
    const create = screen.getByRole("button", { name: t("auth.signup.createAccount") });
    expect(notice.compareDocumentPosition(create) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "2");
  });

  it("nao atribui plano de professor ao aluno e acompanha a escolha", () => {
    mocks.params = new URLSearchParams("path=student");
    const t = mount(locale);
    expect(screen.queryByRole("link", { name: expected[locale].link })).not.toBeInTheDocument();
    expect(screen.getByText(t("auth.signup.introLearner"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: t("auth.signup.roleTeach") }));
    disclosure(locale);
    fireEvent.click(screen.getByRole("radio", { name: t("auth.signup.roleLearn") }));
    expect(screen.queryByRole("link", { name: expected[locale].link })).not.toBeInTheDocument();
  });
});
