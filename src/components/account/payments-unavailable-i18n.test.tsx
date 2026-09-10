import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";

import { EmbeddedCheckoutPanel } from "@/components/account/embedded-checkout-panel";
import { ActivationCheckoutPanel } from "@/components/teacher/activation-checkout-panel";
import { TeacherConnectOnboarding } from "@/components/teacher/teacher-connect-onboarding";
import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import { PaymentRequestError } from "@/lib/payments/client-fetch";
import { LOCALE_COOKIE } from "@/lib/i18n/config";

const mocks = vi.hoisted(() => {
  vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "");
  return { fetch: vi.fn(), hosted: vi.fn(), load: vi.fn() };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@stripe/stripe-js", () => ({ loadStripe: mocks.load }));
vi.mock("@stripe/react-stripe-js", () => ({ EmbeddedCheckout: () => null, EmbeddedCheckoutProvider: () => null }));
vi.mock("@stripe/connect-js", () => ({ loadConnectAndInitialize: mocks.load }));
vi.mock("@stripe/react-connect-js", () => ({ ConnectAccountOnboarding: () => null, ConnectComponentsProvider: () => null }));
vi.mock("@/lib/theme/theme-provider", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
vi.mock("@/lib/payments/connect", async (original) => ({ ...await original<object>(), startTeacherStripeOnboarding: mocks.hosted }));
vi.mock("@/lib/posthog/events", () => ({ track: { checkoutStarted: vi.fn(), checkoutFailed: vi.fn() } }));
function Languages() {
  const { setLocale } = useTranslation();
  return <button onClick={() => setLocale("en")}>EN</button>;
}
let previousLang: string | null;
let previousCookie: string | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.hosted.mockReset();
  vi.stubGlobal("fetch", mocks.fetch);
  previousLang = document.documentElement.getAttribute("lang");
  previousCookie = document.cookie.split("; ").find((value) => value.startsWith(`${LOCALE_COOKIE}=`));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  if (previousLang === null) document.documentElement.removeAttribute("lang");
  else document.documentElement.lang = previousLang;
  document.cookie = previousCookie ? `${previousCookie}; path=/` : `${LOCALE_COOKIE}=; path=/; max-age=0`;
});
afterAll(() => vi.unstubAllEnvs());

it.each(["activation", "billing"])("localizes %s missing-key recovery without requesting a checkout", (kind) => {
  render(<I18nProvider initialLocale="es"><Languages />{kind === "activation"
    ? <ActivationCheckoutPanel /> : <EmbeddedCheckoutPanel planId="pro" cycle="monthly" />}</I18nProvider>);
  expect(screen.getByText("El pago con tarjeta aún no está disponible aquí.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Contactar con soporte" })).toHaveAttribute("href", "/support");
  fireEvent.click(screen.getByText("EN"));
  expect(screen.getByText("Card checkout isn't available here yet.")).toBeInTheDocument();
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(mocks.load).not.toHaveBeenCalled();
});

it("keeps the hosted path available without a publishable key and relocalizes pending/error states", async () => {
  let reject!: (error: Error) => void;
  mocks.hosted.mockReturnValue(new Promise<void>((_resolve, fail) => { reject = fail; }));
  render(<I18nProvider initialLocale="es"><Languages /><TeacherConnectOnboarding /></I18nProvider>);
  expect(screen.getByRole("heading", { name: "Configura las transferencias con Stripe." })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Continuar con Stripe" }));
  expect(screen.getByRole("button", { name: "Abriendo Stripe..." })).toBeDisabled();
  fireEvent.click(screen.getByText("EN"));
  expect(screen.getByRole("button", { name: "Opening Stripe..." })).toBeDisabled();
  await act(async () => reject(new PaymentRequestError("RAW PRIVATE TRANSPORT", 402, "activation_required")));
  expect(screen.getByRole("alert")).toHaveTextContent("Activate your creator account before setting up payouts.");
  expect(screen.getByRole("link", { name: "Activate creator account" })).toHaveAttribute("href", "/teach/activate");
  expect(screen.queryByText(/RAW PRIVATE TRANSPORT/)).toBeNull();
  expect(mocks.hosted).toHaveBeenCalledTimes(1);
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(mocks.load).not.toHaveBeenCalled();
});
