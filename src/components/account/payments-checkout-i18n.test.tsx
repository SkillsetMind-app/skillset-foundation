import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EmbeddedCheckoutPanel } from "@/components/account/embedded-checkout-panel";
import { UpgradeModal } from "@/components/account/upgrade-modal";
import { ActivationCheckoutPanel } from "@/components/teacher/activation-checkout-panel";
import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import { activationFeeUsd, plans } from "@/data/plans";
import { formatUsdWhole } from "@/data/platform";
import { LOCALE_COOKIE, type Locale } from "@/lib/i18n/config";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";

const mocks = vi.hoisted(() => {
  vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_payments_i18n");
  return { fetch: vi.fn(), provider: vi.fn(), failed: vi.fn(), refresh: vi.fn() };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@stripe/stripe-js", () => ({
  loadStripe: (_key: string, options: { locale: string }) => Promise.resolve(options),
}));
vi.mock("@stripe/react-stripe-js", () => ({
  EmbeddedCheckoutProvider: (props: { children: ReactNode; options: unknown; stripe: unknown }) => {
    mocks.provider(props);
    return props.children;
  },
  EmbeddedCheckout: () => <div data-testid="embedded-checkout-fixture" />,
}));
vi.mock("@/lib/posthog/events", () => ({
  track: { checkoutStarted: vi.fn(), checkoutFailed: mocks.failed },
}));

function Languages() {
  const { setLocale } = useTranslation();
  return <>
    <button onClick={() => setLocale("en")}>EN</button>
    <button onClick={() => setLocale("es")}>ES</button>
  </>;
}
function mount(ui: ReactNode, locale: Locale = "es") {
  return render(<I18nProvider initialLocale={locale}><Languages />{ui}</I18nProvider>);
}
function copy(locale: Locale, key: string) {
  const result = translate(getDictionary(locale), key);
  expect(result).not.toBe(key); // Requires the coordinator's real dictionary merge.
  return result;
}
function response(status = 200, code?: string) {
  return new Response(JSON.stringify(status === 200
    ? { clientSecret: "synthetic-checkout", sessionId: "synthetic-session" }
    : { error: "RAW TRANSPORT DETAIL", code }), { status });
}
let previousLang: string | null;
let previousCookie: string | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetch.mockReset().mockResolvedValue(response());
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

describe("payment checkout localization with real dictionaries", () => {
  it.each(["activation", "billing"])("keeps %s request, loader, options and entered data on locale changes", async (kind) => {
    let resolve!: (value: Response) => void;
    mocks.fetch.mockReturnValue(new Promise<Response>((done) => { resolve = done; }));
    mount(kind === "activation" ? <ActivationCheckoutPanel /> : <EmbeddedCheckoutPanel planId="pro" cycle="yearly" />);
    expect(screen.getByText(copy("es", "activationCheckout.preparing"))).toHaveAttribute("aria-busy", "true");
    fireEvent.click(screen.getByText("EN"));
    expect(screen.getByText(copy("en", "activationCheckout.preparing"))).toBeInTheDocument();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    await act(async () => resolve(response()));
    // Same DOM node after the locale change = Stripe's iframe was not remounted.
    const frame = await screen.findByTestId("embedded-checkout-fixture");
    const initial = mocks.provider.mock.calls.at(-1)![0];
    expect(initial.options).toEqual({ clientSecret: "synthetic-checkout" });
    await expect(initial.stripe).resolves.toEqual({ locale: "es" });
    fireEvent.click(screen.getByText("ES"));
    const latest = mocks.provider.mock.calls.at(-1)![0];
    expect(latest.options).toBe(initial.options);
    expect(latest.stripe).toBe(initial.stripe);
    expect(screen.getByTestId("embedded-checkout-fixture")).toBe(frame);
    expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith(`/api/payments/${kind}/checkout`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: kind === "activation" ? "{}" : JSON.stringify({ planId: "pro", cycle: "yearly" }),
    });
  });

  it("keeps the activation amount, Free commission and processing estimates", async () => {
    mount(<ActivationCheckoutPanel />);
    await screen.findByTestId("embedded-checkout-fixture");
    expect(screen.getByRole("heading", { name: "Tu tienda de SkillsetMind" })).toBeInTheDocument();
    expect(screen.getByText(formatUsdWhole(activationFeeUsd, "es").replace(/\s/g, " "))).toBeInTheDocument();
    expect(screen.getByText(`${plans.find((plan) => plan.id === "free")!.commissionPercent}%`)).toBeInTheDocument();
    expect(screen.getByText(copy("es", "activationCheckout.noSubscription"))).toBeInTheDocument();
    expect(screen.getByText(/2\.9% \+ \$0\.30 USD \/ 5\.4% \+ \$0\.30/)).toBeInTheDocument();
  });

  it.each(plans.filter((plan) => plan.id !== "free").flatMap((plan) =>
    (["monthly", "yearly"] as const).map((cycle) => ({ plan, cycle }))
  ))("keeps $plan.name/$cycle amount, commission, name and localized tagline", async ({ plan, cycle }) => {
    mount(<EmbeddedCheckoutPanel planId={plan.id as "starter" | "pro" | "plus"} cycle={cycle} />);
    await screen.findByTestId("embedded-checkout-fixture");
    expect(screen.getByRole("heading", { name: `SkillsetMind ${plan.name}` })).toBeInTheDocument();
    expect(screen.getByText(copy("es", `publicPages.plans.${plan.id}.tagline`))).toBeInTheDocument();
    const total = cycle === "yearly" ? plan.yearlyUsd : plan.monthlyUsd;
    expect(screen.getByText(copy("es", cycle === "yearly" ? "billingCheckout.billedYearly" : "billingCheckout.billedMonthly")
      .replace("{amount}", () => formatUsdWhole(total, "es")).replace(/\s/g, " "))).toBeInTheDocument();
    expect(screen.getByText(`${plan.commissionPercent}%`)).toBeInTheDocument();
    expect(screen.getByText(/2\.9% \+ \$0\.30 USD \/ 5\.4% \+ \$0\.30/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("EN"));
    expect(screen.getByText(plan.tagline)).toBeInTheDocument();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    [401, "unauthenticated", "signIn"], [403, "permission_denied", "permission"],
    [503, "payments_not_configured", "notConfigured"], [429, undefined, "rateLimit"],
    [409, undefined, "conflict"], [500, "unrecognized", "generic"],
  ] as const)("relocalizes checkout error %s/%s without raw details or another POST", async (status, code, key) => {
    mocks.fetch.mockResolvedValue(response(status, code));
    mount(<EmbeddedCheckoutPanel planId="starter" cycle="monthly" />);
    expect(await screen.findByRole("alert")).toHaveTextContent(copy("es", `billingCheckout.error.${key}`));
    expect(screen.getByRole("alert")).toHaveTextContent(`HTTP ${status}`);
    expect(screen.queryByText(/RAW TRANSPORT DETAIL/)).toBeNull();
    fireEvent.click(screen.getByText("EN"));
    expect(screen.getByRole("alert")).toHaveTextContent(copy("en", `billingCheckout.error.${key}`));
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    // Analytics keeps the pre-translation reason, exactly as before this change.
    expect(mocks.failed).toHaveBeenCalledWith({ course_id: "plan:starter:monthly", reason: "RAW TRANSPORT DETAIL" });
  });

  it.each([
    ["creator_verification_required", "creatorPanel.activationGate.verificationBody", "/teach/verification"],
    ["activation_not_required", "activationCheckout.error.notRequired", "/teach/builder"],
    ["payments_not_configured", "activationCheckout.error.notConfigured", "/teach/builder"],
  ])("preserves activation recovery for %s", async (code, key, href) => {
    mocks.fetch.mockResolvedValue(response(403, code));
    mount(<ActivationCheckoutPanel />);
    expect(await screen.findByRole("alert")).toHaveTextContent(copy("es", key));
    expect(screen.getByRole("alert").querySelector("a")).toHaveAttribute("href", href);
    fireEvent.click(screen.getByText("EN"));
    expect(screen.getByRole("alert")).toHaveTextContent(copy("en", key));
    expect(screen.queryByText(/RAW TRANSPORT DETAIL/)).toBeNull();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("localizes a network failure and does not infer verification from an arbitrary error code", async () => {
    mocks.fetch.mockRejectedValue(Object.assign(new Error("creator_verification_required"), { code: "creator_verification_required" }));
    mount(<ActivationCheckoutPanel />);
    expect(await screen.findByRole("alert")).toHaveTextContent(copy("es", "activationCheckout.error.generic"));
    expect(screen.getByRole("link", { name: "Volver al estudio" })).toHaveAttribute("href", "/teach/builder");
    fireEvent.click(screen.getByText("EN"));
    expect(screen.getByRole("alert")).toHaveTextContent(copy("en", "activationCheckout.error.generic"));
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("localizes modal and close labels without replacing checkout, and preserves Escape/scroll recovery", async () => {
    const onClose = vi.fn();
    const overflow = document.body.style.overflow;
    const view = mount(<UpgradeModal open planId="plus" cycle="monthly" onClose={onClose} />);
    await screen.findByTestId("embedded-checkout-fixture");
    const initial = mocks.provider.mock.calls.at(-1)![0];
    expect(screen.getByRole("dialog", { name: "Confirma la mejora de tu plan" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Cerrar" })).toHaveLength(2);
    fireEvent.click(screen.getByText("EN"));
    expect(screen.getByRole("dialog", { name: "Confirm your upgrade" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Close upgrade" })).toHaveLength(2);
    expect(mocks.provider.mock.calls.at(-1)![0].options).toBe(initial.options);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(document.body.style.overflow).toBe(overflow);
  });
});
