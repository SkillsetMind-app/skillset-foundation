import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import { ActivationCheckoutPanel } from "@/components/teacher/activation-checkout-panel";
import { ActivationReturnLink } from "@/components/teacher/activation-return-link";
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

    expect(await screen.findByRole("link", { name: "Back to studio" })).toHaveAttribute("href", "/teach");
    expect(screen.getByText("Checkout could not start.")).toBeInTheDocument();
    const english = getDictionary("en");
    expect(screen.getByText(translate(english, code ? "activationCheckout.error.notConfigured" : "activationCheckout.error.permission"))).toBeInTheDocument();
    expect(screen.queryByText("creator_verification_required")).toBeNull();
    expect(mocks.checkoutProvider).not.toHaveBeenCalled();
  });

  it("does not treat an arbitrary error with a matching code as a payment response", async () => {
    mocks.fetch.mockRejectedValue(Object.assign(new Error("Network failure"), {
      code: "creator_verification_required",
    }));
    renderPanel();

    expect(await screen.findByRole("link", { name: "Back to studio" })).toHaveAttribute("href", "/teach");
    expect(screen.getByText(translate(getDictionary("en"), "activationCheckout.error.generic"))).toBeInTheDocument();
    expect(screen.queryByText("Network failure")).toBeNull();
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

  // The course rides in the tab, not in Stripe. Stripe reuses an open session
  // for the same creator, so a session first opened from course A must still
  // bring the creator back to course B when B is the one being published.
  describe("way back to the course being published", () => {
    const courseA = "0b5c2f4e-8a1d-4c3b-9e7f-1a2b3c4d5e6f";
    const courseB = "9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a";
    const openSession = () => Promise.resolve(new Response(
      JSON.stringify({ clientSecret: "synthetic-open-session", sessionId: "cs_open" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
    const panelFor = (courseId: string | null) => render(
      <I18nProvider initialLocale="en">
        <ActivationCheckoutPanel courseId={courseId} />
      </I18nProvider>,
    );
    const returnHref = () => {
      const view = render(<ActivationReturnLink>Back to course studio</ActivationReturnLink>);
      const href = screen.getByRole("link", { name: "Back to course studio" }).getAttribute("href");
      view.unmount();
      return href;
    };

    beforeEach(() => sessionStorage.clear());

    it("returns to the latest course even when Stripe reuses the session opened from another", async () => {
      mocks.fetch.mockImplementation(openSession);
      const first = panelFor(courseA);
      await screen.findByText("Stripe checkout fixture");
      first.unmount();
      panelFor(courseB);
      await screen.findByText("Stripe checkout fixture");

      expect(mocks.checkoutProvider).toHaveBeenLastCalledWith({ clientSecret: "synthetic-open-session" });
      expect(returnHref()).toBe(`/teach/builder?courseId=${courseB}&tab=review`);
      // Nothing about the course goes to the checkout route.
      for (const [, init] of mocks.fetch.mock.calls) {
        expect(JSON.parse((init as RequestInit).body as string)).toEqual({});
      }
    });

    it("falls back to the studio when no course, or no valid course id, was remembered", async () => {
      mocks.fetch.mockImplementation(openSession);
      expect(returnHref()).toBe("/teach");
      const view = panelFor("../admin");
      await screen.findByText("Stripe checkout fixture");
      view.unmount();
      expect(returnHref()).toBe("/teach");
      panelFor(null);
      await screen.findByText("Stripe checkout fixture");
      expect(returnHref()).toBe("/teach");
    });

    it("tells a creator whose payment already landed to go back to the course and publish", async () => {
      mocks.fetch.mockResolvedValue(new Response(
        JSON.stringify({ error: "Your storefront is already activated.", code: "already_activated" }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      ));
      panelFor(courseA);

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("Your storefront is already active.");
      expect(alert).toHaveTextContent("Go back to your course and publish it.");
      expect(alert).not.toHaveTextContent("HTTP 409");
      expect(screen.getByRole("link", { name: "Back to course studio" })).toHaveAttribute(
        "href",
        `/teach/builder?courseId=${courseA}&tab=review`,
      );
    });
  });
});
