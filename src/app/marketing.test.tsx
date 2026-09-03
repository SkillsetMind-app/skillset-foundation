import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import Home from "@/app/page";

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    refreshUser: vi.fn(),
    status: "unauthenticated",
    user: null,
    signOut: vi.fn(),
  }),
}));

// O rodapé e as cinco seções de marketing são server components assíncronos:
// resolvem o idioma via next/headers e não renderizam neste teste síncrono de
// jsdom. O conteúdo delas é conferido em site-frame.test.tsx, montando cada
// seção direto com `render(await Secao())`. Aqui sobra o que este arquivo
// sempre olhou de verdade: o cabeçalho, que continua sendo cliente.
vi.mock("@/components/site/site-footer", () => ({ SiteFooter: () => null }));
vi.mock("@/components/site/marketing-hero", () => ({ MarketingHero: () => null }));
vi.mock("@/components/site/how-it-works-strip", () => ({ HowItWorksStrip: () => null }));
vi.mock("@/components/site/capabilities-grid", () => ({ CapabilitiesGrid: () => null }));
vi.mock("@/components/site/promise-preview-band", () => ({ PromisePreviewBand: () => null }));
vi.mock("@/components/site/for-creators-band", () => ({ ForCreatorsBand: () => null }));

afterEach(() => {
  cleanup();
});

describe("marketing home", () => {
  it("lists the header in the order the sections appear", () => {
    render(<Home />);

    const nav = screen.getByRole("navigation", { name: "Primary navigation" });
    expect(
      within(nav)
        .getAllByRole("link")
        .map((link) => link.textContent?.trim()),
    ).toEqual([
      "How it works",
      "Courses",
      "The promise",
      "For creators",
      "Pricing",
    ]);
  });
});
