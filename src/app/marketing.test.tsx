import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Home from "@/app/page";
import { RealCoursesProvider } from "@/components/site/real-courses";

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    refreshUser: vi.fn(),
    status: "unauthenticated",
    user: null,
    signOut: vi.fn(),
  }),
}));

// Vitrine aberta (12 cursos reais de 5 professores)? É o contrato de
// isMarketplaceOpen. Começa fechada: é o estado de hoje.
const state = vi.hoisted(() => ({ open: false }));
vi.mock("@/lib/data/server/public-course", () => ({ isMarketplaceOpen: async () => state.open }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

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
vi.mock("@/components/site/featured-courses", () => ({ FeaturedCourses: () => <div data-testid="marketplace" /> }));

beforeEach(() => {
  state.open = false;
});
afterEach(cleanup);

// O layout raiz passa a mesma resposta ao cabeçalho pelo provedor.
async function renderHome() {
  return render(<RealCoursesProvider value={state.open}>{await Home()}</RealCoursesProvider>);
}

const headerLinks = () =>
  within(screen.getByRole("navigation", { name: "Primary navigation" }))
    .getAllByRole("link")
    .map((link) => [link.textContent?.trim(), link.getAttribute("href")]);

describe("marketing home", () => {
  // O menu da home é o mesmo das outras páginas: links, nada de âncora, e Help.
  it("uses the same header as every other page while the marketplace is closed", async () => {
    await renderHome();

    expect(headerLinks()).toEqual([
      ["For creators", "/for-creators"],
      ["Pricing", "/pricing"],
      ["Promise", "/promise"],
      ["Help", "/help"],
    ]);
  });

  // Vitrine fechada: sem a faixa "The marketplace"; no lugar, um cartão que
  // leva a um curso real (o do fundador).
  it("swaps the marketplace band for one real course while fewer than 12 courses from 5 teachers are live", async () => {
    const { container } = await renderHome();

    expect(container.querySelector("#courses")).toBeNull();
    expect(screen.queryByTestId("marketplace")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /See a real course on SkillsetMind/ })).toHaveAttribute(
      "href",
      "/courses/1a280dc6-acce-4f1f-9e95-56df095131ae",
    );
  });

  it("opens the marketplace band and the Courses link by itself once the threshold is met", async () => {
    state.open = true;
    const { container } = await renderHome();

    expect(container.querySelector("#courses")).not.toBeNull();
    expect(screen.getByTestId("marketplace")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /See a real course/ })).not.toBeInTheDocument();
    expect(headerLinks()[0]).toEqual(["Courses", "/courses"]);
  });

  // Acessibilidade basica: um landmark <main> por pagina, alvo do "Skip to
  // content" que abre a barra.
  it("tem exatamente um <main id=\"conteudo\">, alvo do pular para o conteudo", async () => {
    const { container } = await renderHome();

    const mains = container.querySelectorAll("main");
    expect(mains).toHaveLength(1);
    expect(mains[0]).toHaveAttribute("id", "conteudo");
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute("href", "#conteudo");
  });
});
