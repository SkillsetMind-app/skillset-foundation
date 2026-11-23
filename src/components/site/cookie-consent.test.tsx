// O aviso de cookies oferece duas escolhas de mesmo peso e um link para a
// politica. O antigo "Manage preferences" abria a mesma politica e nao
// gerenciava nada: nao pode voltar como botao.
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

describe("aviso de cookies", () => {
  it("mostra so recusar e aceitar, e o link da politica no texto", () => {
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

  it("recusar guarda a escolha, desliga a medicao e fecha o aviso", () => {
    render(<CookieConsent />);
    fireEvent.click(screen.getByRole("button", { name: "Reject non-essential" }));

    expect(getStoredCookieConsent()).toBe("rejected");
    expect(mocks.analytics).toHaveBeenCalledWith(false);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("aceitar guarda a escolha, liga a medicao e fecha o aviso", () => {
    render(<CookieConsent />);
    fireEvent.click(screen.getByRole("button", { name: "Accept all" }));

    expect(getStoredCookieConsent()).toBe("accepted");
    expect(mocks.analytics).toHaveBeenCalledWith(true);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
