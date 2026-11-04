import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@/components/i18n/i18n-provider", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const api = { render: vi.fn((_el: HTMLElement, _options: Record<string, unknown>) => "widget-1"), reset: vi.fn(), remove: vi.fn() };

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "test-public-site-key");
  vi.clearAllMocks();
  api.reset.mockReset();
  window.turnstile = api;
});
afterEach(() => { cleanup(); delete window.turnstile; vi.unstubAllEnvs(); });

async function mount() {
  const { TurnstileWidget } = await import("./turnstile-widget");
  const onToken = vi.fn();
  const view = render(<TurnstileWidget onToken={onToken} />);
  await waitFor(() => expect(api.render).toHaveBeenCalledTimes(1));
  const options = api.render.mock.calls[0][1];
  return { ...view, onToken, options, TurnstileWidget };
}

it.each(["error-callback", "timeout-callback"])("makes %s visible without removing the live widget", async (name) => {
  const { options, onToken } = await mount();
  const element = api.render.mock.calls[0][0];
  act(() => (options[name] as () => void)());
  expect(screen.getByRole("alert")).toHaveTextContent("authCaptcha.challengeError");
  expect(screen.getByRole("button", { name: "authCaptcha.retry" })).toHaveAttribute("type", "button");
  expect(element.isConnected).toBe(true);
  expect(onToken).toHaveBeenLastCalledWith("");
});

it("retries only the challenge and waits for a real callback before issuing a token", async () => {
  const { options, onToken } = await mount();
  act(() => (options["error-callback"] as () => void)());
  fireEvent.click(screen.getByRole("button", { name: "authCaptcha.retry" }));
  expect(api.reset).toHaveBeenCalledExactlyOnceWith("widget-1");
  expect(api.render).toHaveBeenCalledTimes(1);
  expect(onToken.mock.calls.every(([token]) => token === "")).toBe(true);
  act(() => (options.callback as (token: string) => void)("test-token"));
  expect(onToken).toHaveBeenLastCalledWith("test-token");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("clears the failure when automatic recovery succeeds", async () => {
  const { options, onToken } = await mount();
  act(() => (options["error-callback"] as () => void)());
  expect(screen.getByRole("alert")).toBeInTheDocument();
  act(() => (options.callback as (token: string) => void)("test-token"));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(onToken).toHaveBeenLastCalledWith("test-token");
});

it("keeps a failed retry visible and never grants a token", async () => {
  const { options, onToken } = await mount();
  act(() => (options["error-callback"] as () => void)());
  api.reset.mockImplementationOnce(() => { throw new Error("provider unavailable"); });
  fireEvent.click(screen.getByRole("button", { name: "authCaptcha.retry" }));
  expect(screen.getByRole("alert")).toHaveTextContent("authCaptcha.challengeError");
  expect(onToken.mock.calls.every(([token]) => token === "")).toBe(true);
});

it("keeps external resets and teardown scoped to this widget", async () => {
  const { options, onToken, rerender, unmount, TurnstileWidget } = await mount();
  act(() => (options["error-callback"] as () => void)());
  rerender(<TurnstileWidget onToken={onToken} resetSignal={1} />);
  expect(api.reset).toHaveBeenCalledExactlyOnceWith("widget-1");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  unmount();
  expect(api.remove).toHaveBeenCalledExactlyOnceWith("widget-1");
});
