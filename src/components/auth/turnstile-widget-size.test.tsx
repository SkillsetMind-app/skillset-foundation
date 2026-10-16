import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@/components/i18n/i18n-provider", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const turnstile = { render: vi.fn((_el: HTMLElement, _opts: Record<string, unknown>) => "widget-1"), reset: vi.fn(), remove: vi.fn() };

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "test-public-site-key");
  turnstile.render.mockClear();
  window.turnstile = turnstile;
});

afterEach(() => {
  cleanup();
  delete window.turnstile;
  vi.unstubAllEnvs();
});

it("keeps Turnstile's default size when none is asked for (sign-in forms)", async () => {
  const { TurnstileWidget } = await import("@/components/auth/turnstile-widget");

  render(<TurnstileWidget onToken={vi.fn()} />);

  await vi.waitFor(() => expect(turnstile.render).toHaveBeenCalledTimes(1));
  expect(turnstile.render.mock.calls[0][1]).not.toHaveProperty("size");
});

it("picks the size from the container's width when asked", async () => {
  const { TurnstileWidget } = await import("@/components/auth/turnstile-widget");
  const sizeFor = vi.fn((width: number) => (width < 300 ? "compact" as const : "normal" as const));

  render(<TurnstileWidget onToken={vi.fn()} size={sizeFor} />);

  await vi.waitFor(() => expect(turnstile.render).toHaveBeenCalledTimes(1));
  // jsdom has no layout: the container measures 0px, narrower than the widget.
  expect(sizeFor).toHaveBeenCalledWith(0);
  expect(turnstile.render.mock.calls[0][1]).toMatchObject({ size: "compact" });
});
