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
// isMarketplaceOpen. Começa fechada: é o estado de hoje. Título e capa do
// cartão "See a real course" vêm de getShowcaseCourseCover (null = leitura
// falhou ou passou do prazo; o prazo em si é testado em public-course.test).
type ShowcaseCover = { title: string; coverImageUrl: string | null };
const state = vi.hoisted(() => ({ open: false, course: null as ShowcaseCover | null }));
const readCourse = vi.hoisted(() =>
  vi.fn<(id: string) => Promise<ShowcaseCover | null>>(async () => state.course),
);
vi.mock("@/lib/data/server/public-course", () => ({
  isMarketplaceOpen: async () => state.open,
  getShowcaseCourseCover: readCourse,
}));
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
// A faixa de fatos também é servidor; o conteúdo dela é conferido em
// home-facts-band.test.tsx. Aqui ela só marca o lugar, para a ordem.
vi.mock("@/components/site/home-facts-band", () => ({ HomeFactsBand: () => <div data-testid="facts-band" /> }));
vi.mock("@/components/site/featured-courses", () => ({ FeaturedCourses: () => <div data-testid="marketplace" /> }));

beforeEach(() => {
  state.open = false;
  state.course = null;
  readCourse.mockClear();
});

const COVER = "https://example.supabase.co/storage/v1/object/public/covers/ei-mastery.jpg";
const showcase: ShowcaseCover = { title: "Emotional Intelligence Mastery", coverImageUrl: COVER };
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
    // Vitrine aberta: o cartão do curso real não existe, a leitura não acontece.
    expect(readCourse).not.toHaveBeenCalled();
  });

  // A capa de verdade do curso dentro do mesmo link, com o título do curso
  // como texto alternativo (não é frase nova do dicionário).
  it("shows the real course cover inside the card link, with the course title as alt", async () => {
    state.course = showcase;
    await renderHome();

    expect(readCourse).toHaveBeenCalledWith("1a280dc6-acce-4f1f-9e95-56df095131ae");
    const card = screen.getByRole("link", { name: /See a real course on SkillsetMind/ });
    expect(card).toHaveAttribute("href", "/courses/1a280dc6-acce-4f1f-9e95-56df095131ae");
    const cover = within(card).getByRole("img", { name: "Emotional Intelligence Mastery" });
    expect(cover).toHaveAttribute("src", expect.stringContaining(encodeURIComponent(COVER)));
    // Abaixo da dobra: carrega preguiçoso, sem prioridade sobre o topo.
    expect(cover).toHaveAttribute("loading", "lazy");
    expect(within(card).getByText("Open the course")).toBeInTheDocument();
  });

  // Sem capa, ou leitura que falhou ou passou do prazo (null): o cartão de
  // texto de antes, sem quadro de imagem vazio.
  it.each([
    ["the course has no cover", { ...showcase, coverImageUrl: null }],
    ["the read fails or times out", null],
  ])("keeps the text-only card when %s", async (_case, course) => {
    state.course = course;
    await renderHome();

    const card = screen.getByRole("link", { name: /See a real course on SkillsetMind/ });
    expect(card).toHaveAttribute("href", "/courses/1a280dc6-acce-4f1f-9e95-56df095131ae");
    expect(within(card).queryByRole("img")).not.toBeInTheDocument();
    expect(card.querySelector(".aspect-\\[16\\/9\\]")).toBeNull();
    for (const text of [
      "A real course",
      "See a real course on SkillsetMind",
      "Open a published course the way a buyer sees it: the sales page, the lessons and the preview lesson.",
      "Open the course",
    ]) {
      expect(within(card).getByText(text)).toBeInTheDocument();
    }
  });

  // A ordem dos blocos dentro do <main> (o topo está simulado e não aparece):
  // a faixa de fatos vem logo depois do topo e antes do "How it works".
  it("keeps the home blocks in order, with the facts band right after the hero", async () => {
    const { container } = await renderHome();

    const blocks = [...container.querySelector("main")!.children].map(
      (block) => block.id || block.getAttribute("data-testid"),
    );
    expect(blocks).toEqual(["facts-band", "how-it-works", "real-course", "capabilities", "promise", "for-creators"]);
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
