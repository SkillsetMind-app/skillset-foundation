import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";

import { TeacherConnectOnboarding } from "@/components/teacher/teacher-connect-onboarding";
import { I18nProvider } from "@/components/i18n/i18n-provider";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";

const mocks = vi.hoisted(() => {
  vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_payout_country");
  return { fetch: vi.fn(), initialize: vi.fn(), update: vi.fn() };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/lib/theme/theme-provider", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
vi.mock("@stripe/connect-js", () => ({ loadConnectAndInitialize: mocks.initialize }));
vi.mock("@stripe/react-connect-js", () => ({
  ConnectComponentsProvider: ({ children }: { children: ReactNode }) => children,
  ConnectAccountOnboarding: () => <div data-testid="connect-onboarding-fixture" />,
}));

function copy(locale: "en" | "es", key: string) {
  const result = translate(getDictionary(locale), key);
  expect(result).not.toBe(key);
  return result;
}
function ui(locale: "en" | "es", needsCountry?: boolean) {
  return <I18nProvider initialLocale={locale}><TeacherConnectOnboarding needsCountry={needsCountry} /></I18nProvider>;
}
function sentBody(call = 0) {
  return JSON.parse(String(mocks.fetch.mock.calls[call][1].body));
}
function reply(status = 200, code?: string) {
  return new Response(JSON.stringify(status === 200
    ? { clientSecret: "synthetic-connect" } : { error: "RAW", code }), { status });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetch.mockReset().mockImplementation(() => Promise.resolve(reply()));
  mocks.initialize.mockReset().mockReturnValue({ update: mocks.update });
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
afterAll(() => vi.unstubAllEnvs());

// Stripe fixes an account's country at creation, and the Connect routes create
// the account. So nothing may reach them before the creator has chosen.
it("asks for the payout country before any Connect call, then sends the chosen one", async () => {
  render(ui("en", true));
  const select = screen.getByLabelText(copy("en", "connectOnboarding.countryLabel"));
  expect(select).toHaveValue("US");
  expect(screen.getByText(copy("en", "connectOnboarding.countryLater"))).toBeInTheDocument();
  await act(async () => {});
  expect(mocks.fetch).not.toHaveBeenCalled();

  fireEvent.change(select, { target: { value: "GB" } });
  expect(mocks.fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: copy("en", "connectOnboarding.countryContinue") }));

  await screen.findByTestId("connect-onboarding-fixture");
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
  expect(mocks.fetch.mock.calls[0][0]).toBe("/api/payments/connect/account-session");
  expect(sentBody()).toEqual({ country: "GB" });
});

it("defaults to the United States", async () => {
  render(ui("en", true));
  fireEvent.click(screen.getByRole("button", { name: copy("en", "connectOnboarding.countryContinue") }));
  await screen.findByTestId("connect-onboarding-fixture");
  expect(sentBody()).toEqual({ country: "US" });
});

it("labels the countries in the interface language and offers only the supported ones", () => {
  render(ui("es", true));
  const select = screen.getByLabelText(copy("es", "connectOnboarding.countryLabel"));
  expect(within(select).getByRole("option", { name: "Alemania" })).toHaveValue("DE");
  expect(within(select).getByRole("option", { name: "Reino Unido" })).toHaveValue("GB");
  expect(within(select).getAllByRole("option")).toHaveLength(33);
  expect(within(select).queryByRole("option", { name: "Brasil" })).toBeNull();
  expect(within(select).queryByRole("option", { name: "México" })).toBeNull();
  expect(screen.getByText(copy("es", "connectOnboarding.countryLater"))).toBeInTheDocument();
});

// The profile flips to "connected" right after the account is created. That
// must not remount the flow: a remount re-inits Stripe and drops the creator's
// half-filled onboarding.
it("keeps the onboarding mounted when the account appears", async () => {
  const { rerender } = render(ui("en", true));
  fireEvent.click(screen.getByRole("button", { name: copy("en", "connectOnboarding.countryContinue") }));
  const frame = await screen.findByTestId("connect-onboarding-fixture");
  rerender(ui("en", false));
  expect(screen.getByTestId("connect-onboarding-fixture")).toBe(frame);
  expect(mocks.initialize).toHaveBeenCalledTimes(1);
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
});

// Control: an existing account goes straight to onboarding, with no country.
it("skips the picker when the creator already has an account", async () => {
  render(ui("en"));
  await screen.findByTestId("connect-onboarding-fixture");
  expect(screen.queryByLabelText(copy("en", "connectOnboarding.countryLabel"))).toBeNull();
  expect(sentBody()).toEqual({});
});

it("explains an unsupported country instead of a generic failure", async () => {
  mocks.fetch.mockImplementation(() => Promise.resolve(reply(400, "unsupported_country")));
  render(ui("en", true));
  fireEvent.click(screen.getByRole("button", { name: copy("en", "connectOnboarding.countryContinue") }));
  expect(await screen.findByRole("alert")).toHaveTextContent(copy("en", "connectOnboarding.error.country"));
});
