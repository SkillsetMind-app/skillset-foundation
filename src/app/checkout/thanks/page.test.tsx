import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getDictionary, translate } from "@/lib/i18n/dictionaries";
import { encodeGuestCheckoutCookie } from "@/lib/payments/server/guest-checkout";

const state = vi.hoisted(() => ({
  locale: "en" as "en" | "es",
  cookie: undefined as string | undefined,
  fetch: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "sm_guest_checkout" && state.cookie ? { name, value: state.cookie } : undefined),
  }),
}));
vi.mock("@/lib/i18n/server", () => ({
  getServerTranslation: async () => ({ locale: state.locale, t: (key: string) => translate(getDictionary(state.locale), key) }),
}));
vi.mock("@/components/i18n/i18n-provider", () => ({
  useTranslation: () => ({ locale: state.locale, t: (key: string) => translate(getDictionary(state.locale), key) }),
}));
vi.mock("@/components/site/site-nav", () => ({ SiteNav: () => null }));

import Page, { generateMetadata } from "./page";

describe("guest checkout thank-you page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_GUEST_CHECKOUT_ENABLED", "true");
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "site-key");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "turnstile-secret");
    vi.stubEnv("GUEST_CHECKOUT_COOKIE_SECRET", "cookie-secret");
    vi.stubGlobal("fetch", state.fetch);
    state.fetch.mockImplementation(async () => new Response(JSON.stringify({ status: "sent" })));
    state.locale = "en";
    state.cookie = encodeGuestCheckoutCookie({ email: "ana@example.com", courseId: "course-1" });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("is not indexed", async () => {
    const metadata = await generateMetadata();
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.title).toContain("Payment received");
  });

  it("does not exist while guest checkout is off", async () => {
    vi.stubEnv("NEXT_PUBLIC_GUEST_CHECKOUT_ENABLED", "false");

    await expect(Page({})).rejects.toThrow();
    expect(state.fetch).not.toHaveBeenCalled();
  });

  it("sends the access link once and names the masked address", async () => {
    render(await Page({ searchParams: Promise.resolve({ course: "course-1" }) }));

    expect(screen.getByRole("heading", { name: "Payment received" })).toBeInTheDocument();
    expect(await screen.findByText(/We sent your access link to a•••@example\.com/)).toBeInTheDocument();
    expect(screen.queryByText(/ana@example\.com/)).not.toBeInTheDocument();
    expect(state.fetch).toHaveBeenCalledTimes(1);
    expect(state.fetch).toHaveBeenCalledWith("/api/payments/guest-checkout/access-link", { method: "POST" });
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      `/login?returnTo=${encodeURIComponent("/learn/courses/course-1")}`,
    );
  });

  it("resends on request and says when the limit is reached", async () => {
    render(await Page({}));
    await screen.findByText(/We sent your access link/);
    state.fetch.mockImplementation(async () => new Response("{}", { status: 429 }));

    fireEvent.click(screen.getByRole("button", { name: "Send the link again" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Too many requests for a•••@example.com");
    expect(state.fetch).toHaveBeenCalledTimes(2);
  });

  it("without the checkout cookie, sends nothing and points to sign-in", async () => {
    state.cookie = undefined;

    render(await Page({ searchParams: Promise.resolve({ course: "course-1" }) }));

    expect(screen.getByText(translate(getDictionary("en"), "guestCheckout.thanks.noEmail"))).toBeInTheDocument();
    await waitFor(() => expect(state.fetch).not.toHaveBeenCalled());
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      `/login?returnTo=${encodeURIComponent("/learn/courses/course-1")}`,
    );
  });

  it("reads in Spanish", async () => {
    state.locale = "es";

    render(await Page({}));

    expect(screen.getByRole("heading", { name: "Pago recibido" })).toBeInTheDocument();
    expect(await screen.findByText(/Enviamos tu enlace de acceso a a•••@example\.com/)).toBeInTheDocument();
  });
});
