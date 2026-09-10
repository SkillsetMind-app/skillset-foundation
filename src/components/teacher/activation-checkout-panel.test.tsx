import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import { ActivationCheckoutPanel } from "@/components/teacher/activation-checkout-panel";
import type { Locale } from "@/lib/i18n/config";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";

const mocks = vi.hoisted(() => {
  vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_activation_fixture");
  return { fetch: vi.fn(), checkoutProvider: vi.fn(), refresh: vi.fn() };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock("@stripe/stripe-js", () => ({ loadStripe: vi.fn().mockResolvedValue(null) }));
vi.mock("@stripe/react-stripe-js", () => ({
  EmbeddedCheckoutProvider: (props: { children: ReactNode; options: unknown }) => {
    mocks.checkoutProvider(props.options);
    return props.children;
  },
  EmbeddedCheckout: () => <div>Stripe checkout fixture</div>,
}));
vi.mock("@/lib/posthog/events", () => ({
  track: { checkoutStarted: vi.fn(), checkoutFailed: vi.fn() },
}));

function LocaleSwitch() {
  const { setLocale } = useTranslation();
  return <button onClick={() => setLocale("es")}>ES</button>;
}

function renderPanel(locale: Locale = "en") {
  return render(
    <I18nProvider initialLocale={locale}>
      <LocaleSwitch />
      <ActivationCheckoutPanel />
    </I18nProvider>,
  );
}

function verificationCopy(locale: Locale) {
  const key = "creatorPanel.activationGate.";
  const dictionary = getDictionary(locale);
  const copy = {
    title: translate(dictionary, `${key}verificationTitle`),
    body: translate(dictionary, `${key}verificationBody`),
    action: translate(dictionary, `${key}verificationAction`),
  };
  for (const value of Object.values(copy)) {
    expect(value).not.toContain(key);
  }
  return copy;
}

function rejectCheckout(code?: string, message = "Server-only verification detail") {
  mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ error: message, code }), {
    status: 403,
    headers: { "Content-Type": "application/json" },
  }));
}

describe("ActivationCheckoutPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetch.mockReset();
    vi.stubGlobal("fetch", mocks.fetch);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  afterAll(() => vi.unstubAllEnvs());

  it.each(["en", "es"] as const)("routes verification errors to the real verification UI in %s", async (locale) => {
    rejectCheckout("creator_verification_required");
    const copy = verificationCopy(locale);
    renderPanel(locale);

    expect(await screen.findByRole("link", { name: copy.action })).toHaveAttribute("href", "/teach/verification");
    expect(screen.getByText(copy.title)).toBeInTheDocument();
    expect(screen.getByText(copy.body)).toBeInTheDocument();
    expect(screen.queryByText("Server-only verification detail")).toBeNull();
    expect(screen.queryByRole("link", { name: "Back to studio" })).toBeNull();
    expect(mocks.checkoutProvider).not.toHaveBeenCalled();
    expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith("/api/payments/activation/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
  });

  it("relocalizes a settled verification error without creating another checkout", async () => {
    rejectCheckout("creator_verification_required");
    const en = verificationCopy("en");
    const es = verificationCopy("es");
    expect(es).not.toEqual(en);
    renderPanel();
    await screen.findByRole("link", { name: en.action });

    fireEvent.click(screen.getByRole("button", { name: "ES" }));

    expect(screen.getByRole("link", { name: es.action })).toHaveAttribute("href", "/teach/verification");
    expect(screen.getByText(es.title)).toBeInTheDocument();
    expect(screen.getByText(es.body)).toBeInTheDocument();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, "payments_not_configured"])("does not match verification text without the expected code (%s)", async (code) => {
    rejectCheckout(code, "creator_verification_required");
    renderPanel();

    expect(await screen.findByRole("link", { name: "Back to studio" })).toHaveAttribute("href", "/teach/builder");
    expect(screen.getByText("Checkout could not start.")).toBeInTheDocument();
    expect(screen.getByText("creator_verification_required")).toBeInTheDocument();
    expect(mocks.checkoutProvider).not.toHaveBeenCalled();
  });

  it("does not treat an arbitrary error with a matching code as a payment response", async () => {
    mocks.fetch.mockRejectedValue(Object.assign(new Error("Network failure"), {
      code: "creator_verification_required",
    }));
    renderPanel();

    expect(await screen.findByRole("link", { name: "Back to studio" })).toHaveAttribute("href", "/teach/builder");
    expect(screen.getByText("Network failure")).toBeInTheDocument();
    expect(mocks.checkoutProvider).not.toHaveBeenCalled();
  });

  it("still passes a successful checkout response to Stripe", async () => {
    const clientSecret = "synthetic-checkout-fixture";
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ clientSecret, sessionId: "session-fixture" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    renderPanel();

    expect(await screen.findByText("Stripe checkout fixture")).toBeInTheDocument();
    expect(mocks.checkoutProvider).toHaveBeenCalledWith({ clientSecret });
    expect(screen.queryByRole("link", { name: "Back to studio" })).toBeNull();
  });
});
