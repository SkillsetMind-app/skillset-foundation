import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { LoadError } from "@stripe/connect-js";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";

import { TeacherConnectOnboarding } from "@/components/teacher/teacher-connect-onboarding";
import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import { LOCALE_COOKIE } from "@/lib/i18n/config";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";

const mocks = vi.hoisted(() => {
  vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_connect_i18n");
  return {
    fetch: vi.fn(), initialize: vi.fn(), update: vi.fn(), hosted: vi.fn(),
    onLoadError: null as ((error: LoadError) => void) | null,
    onExit: null as (() => void) | null,
  };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/lib/theme/theme-provider", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
vi.mock("@stripe/connect-js", () => ({ loadConnectAndInitialize: mocks.initialize }));
vi.mock("@/lib/payments/connect", async (original) => ({
  ...await original<object>(), startTeacherStripeOnboarding: mocks.hosted,
}));
vi.mock("@stripe/react-connect-js", () => ({
  ConnectComponentsProvider: ({ children }: { children: ReactNode }) => children,
  ConnectAccountOnboarding: (props: { onLoadError: (error: LoadError) => void; onExit: () => void }) => {
    mocks.onLoadError = props.onLoadError;
    mocks.onExit = props.onExit;
    return <input aria-label="Connect fixture" />;
  },
}));
function Languages() {
  const { setLocale } = useTranslation();
  return <>
    <button onClick={() => setLocale("en")}>EN</button>
    <button onClick={() => setLocale("es")}>ES</button>
  </>;
}
function copy(locale: "en" | "es", key: string) {
  const result = translate(getDictionary(locale), key);
  expect(result).not.toBe(key);
  return result;
}
function mount(props: Parameters<typeof TeacherConnectOnboarding>[0] = {}) {
  return render(<I18nProvider initialLocale="es"><Languages /><TeacherConnectOnboarding {...props} /></I18nProvider>);
}
function reply(status = 200, code?: string) {
  return new Response(JSON.stringify(status === 200
    ? { clientSecret: "synthetic-connect" } : { error: "RAW CONNECT TRANSPORT", code }), { status });
}
let previousLang: string | null;
let previousCookie: string | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.onLoadError = null;
  mocks.onExit = null;
  mocks.fetch.mockReset().mockImplementation(() => Promise.resolve(reply()));
  mocks.initialize.mockReset().mockReturnValue({ update: mocks.update });
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

it("updates Connect locale in place, keeps entered data, and preserves session renewal and completion", async () => {
  const onComplete = vi.fn();
  mount({ onComplete });
  const input = await screen.findByRole("textbox");
  fireEvent.change(input, { target: { value: "unfinished fixture" } });
  const init = mocks.initialize.mock.calls[0][0];
  expect(init.locale).toBe("es");
  expect(screen.getByText(copy("es", "connectOnboarding.footer"))).toBeInTheDocument();
  fireEvent.click(screen.getByText("EN"));
  expect(mocks.update).toHaveBeenLastCalledWith(expect.objectContaining({ locale: "en" }));
  expect(screen.getByRole("textbox")).toBe(input);
  expect(input).toHaveValue("unfinished fixture");
  expect(screen.getByText(copy("en", "connectOnboarding.footer"))).toBeInTheDocument();
  fireEvent.click(screen.getByText("ES"));
  expect(mocks.update).toHaveBeenLastCalledWith(expect.objectContaining({ locale: "es" }));
  expect(mocks.initialize).toHaveBeenCalledTimes(1);
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
  await expect(init.fetchClientSecret()).resolves.toBe("synthetic-connect");
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
  await expect(init.fetchClientSecret()).resolves.toBe("synthetic-connect");
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
  act(() => mocks.onExit?.());
  expect(onComplete).toHaveBeenCalledTimes(1);
});

it("uses the latest locale after a pending preflight without repeating it", async () => {
  let resolve!: (value: Response) => void;
  mocks.fetch.mockReturnValue(new Promise<Response>((done) => { resolve = done; }));
  mount();
  expect(screen.getByText(copy("es", "connectOnboarding.preparing"))).toHaveAttribute("aria-busy", "true");
  fireEvent.click(screen.getByText("EN"));
  expect(screen.getByText(copy("en", "connectOnboarding.preparing"))).toBeInTheDocument();
  await act(async () => resolve(reply()));
  await screen.findByRole("textbox");
  expect(mocks.initialize).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ locale: "en" }));
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
});

it("keeps platform unavailability distinct and retries only on explicit check", async () => {
  mocks.fetch.mockImplementation(() => Promise.resolve(reply(400, "connect_not_enabled")));
  const onAvailabilityChange = vi.fn();
  mount({ onAvailabilityChange });
  await screen.findByRole("heading", { name: copy("es", "connectOnboarding.unavailableTitle") });
  expect(onAvailabilityChange).toHaveBeenLastCalledWith(true);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(mocks.initialize).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("EN"));
  expect(screen.getByRole("heading", { name: copy("en", "connectOnboarding.unavailableTitle") })).toBeInTheDocument();
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Check again" }));
  await screen.findByRole("heading", { name: copy("en", "connectOnboarding.unavailableTitle") });
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
  expect(mocks.hosted).not.toHaveBeenCalled();
});

it.each([
  [401, "unauthenticated", "signIn", "/login"],
  [403, "permission_denied", "permission", "/support"],
  [402, "activation_required", "activation", "/teach/activate"],
  [503, "payments_not_configured", "configuration", "/support"],
] as const)("keeps actionable recovery for HTTP %s/%s without leaking transport", async (status, code, key, href) => {
  mocks.fetch.mockImplementation(() => Promise.resolve(reply(status, code)));
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent(copy("es", `connectOnboarding.error.${key}`));
  expect(screen.getByRole("link", { name: copy("es", `connectOnboarding.recovery.${key}`) })).toHaveAttribute("href", href);
  fireEvent.click(screen.getByText("EN"));
  expect(screen.getByRole("alert")).toHaveTextContent(copy("en", `connectOnboarding.error.${key}`));
  expect(screen.getByText(`Reference: HTTP ${status}`)).toBeInTheDocument();
  expect(screen.queryByText(/RAW CONNECT TRANSPORT/)).toBeNull();
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
  expect(mocks.initialize).not.toHaveBeenCalled();
});

it.each([
  ["authentication_error", "authentication"], ["account_session_create_error", "session"],
  ["api_connection_error", "connection"], ["invalid_request_error", "request"],
  ["rate_limit_error", "rateLimit"], ["render_error", "render"], ["api_error", "embedded"],
] as const)("relocalizes SDK load error %s and never renders its message", async (type, key) => {
  mount();
  await screen.findByRole("textbox");
  act(() => mocks.onLoadError?.({ elementTagName: "account-onboarding", error: { type, message: "RAW SDK DETAIL" } }));
  expect(screen.getByRole("alert")).toHaveTextContent(copy("es", `connectOnboarding.error.${key}`));
  fireEvent.click(screen.getByText("EN"));
  expect(screen.getByRole("alert")).toHaveTextContent(copy("en", `connectOnboarding.error.${key}`));
  expect(screen.queryByText(/RAW SDK DETAIL/)).toBeNull();
  expect(mocks.initialize).toHaveBeenCalledTimes(1);
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
});

it("relocalizes a pending hosted fallback and its failure without opening twice", async () => {
  mount();
  await screen.findByRole("textbox");
  act(() => mocks.onLoadError?.({ elementTagName: "account-onboarding", error: { type: "render_error" } }));
  let reject!: (reason: Error) => void;
  mocks.hosted.mockReturnValue(new Promise<void>((_resolve, fail) => { reject = fail; }));
  fireEvent.click(screen.getByRole("button", { name: copy("es", "connectOnboarding.continueSecure") }));
  expect(screen.getByRole("button", { name: copy("es", "connectOnboarding.opening") })).toBeDisabled();
  fireEvent.click(screen.getByText("EN"));
  expect(screen.getByRole("button", { name: "Opening Stripe..." })).toBeDisabled();
  await act(async () => reject(new Error("RAW HOSTED DETAIL")));
  expect(screen.getByRole("alert")).toHaveTextContent(copy("en", "connectOnboarding.error.hosted"));
  fireEvent.click(screen.getByText("ES"));
  expect(screen.getByRole("alert")).toHaveTextContent(copy("es", "connectOnboarding.error.hosted"));
  expect(screen.queryByText(/RAW HOSTED DETAIL/)).toBeNull();
  expect(mocks.hosted).toHaveBeenCalledTimes(1);
  expect(mocks.initialize).toHaveBeenCalledTimes(1);
});
