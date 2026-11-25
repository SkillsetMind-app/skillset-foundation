// The cookie notice offers two choices of equal weight and a link to the
// policy. The old "Manage preferences" opened the same policy and did not
// manage anything: it must not come back as a button.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CookieConsent } from "@/components/site/cookie-consent";
import { getStoredCookieConsent } from "@/lib/consent/cookie-consent";

const mocks = vi.hoisted(() => ({ analytics: vi.fn() }));
vi.mock("@/lib/posthog/client", () => ({ applyAnalyticsConsent: mocks.analytics }));

beforeEach(() => {
  window.localStorage.clear();
  mocks.analytics.mockReset();
});
afterEach(cleanup);

describe("cookie notice", () => {
  it("shows only decline and accept, and the policy link in the text", () => {
    render(<CookieConsent />);
    const banner = screen.getByRole("dialog", { name: "Cookie preferences" });

    expect(within(banner).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Reject non-essential",
      "Accept all",
    ]);
    const links = within(banner).getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/legal/privacy");
    expect(within(banner).queryByText(/manage preferences/i)).toBeNull();
  });

  it("declining saves the choice, turns off measurement and closes the notice", () => {
    render(<CookieConsent />);
    fireEvent.click(screen.getByRole("button", { name: "Reject non-essential" }));

    expect(getStoredCookieConsent()).toBe("rejected");
    expect(mocks.analytics).toHaveBeenCalledWith(false);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("accepting saves the choice, turns on measurement and closes the notice", () => {
    render(<CookieConsent />);
    fireEvent.click(screen.getByRole("button", { name: "Accept all" }));

    expect(getStoredCookieConsent()).toBe("accepted");
    expect(mocks.analytics).toHaveBeenCalledWith(true);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
