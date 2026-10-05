import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Home from "@/app/page";
import type { PublicCourseSummary } from "@/lib/data/server/public-course";

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    refreshUser: vi.fn(),
    status: "unauthenticated",
    user: null,
    signOut: vi.fn(),
  }),
}));

// Cursos reais publicados, já sem os internos de teste (é o contrato de
// listPublishedCourses). Começa com um: a home cheia é o caso comum.
const realCourse: PublicCourseSummary = {
  id: "c-1",
  urlSlug: "deep-focus-systems",
  title: "Deep Focus Systems",
  summary: null,
  category: null,
  coverImageUrl: null,
  lessonCount: 3,
  updatedAt: null,
};
const state = vi.hoisted(() => ({ courses: [] as unknown[] }));
vi.mock("@/lib/data/server/public-course", () => ({ listPublishedCourses: async () => state.courses }));

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

beforeEach(() => {
  state.courses = [realCourse];
});
afterEach(cleanup);

const headerLinks = () =>
  within(screen.getByRole("navigation", { name: "Primary navigation" }))
    .getAllByRole("link")
    .map((link) => link.textContent?.trim());

describe("marketing home", () => {
  it("lists the header in the order the sections appear", async () => {
    render(await Home());

    expect(headerLinks()).toEqual([
      "How it works",
      "Courses",
      "The promise",
      "For creators",
      "Pricing",
    ]);
  });

  // Loja vazia: a faixa "Cursos de especialistas verificados" dizia "o
  // marketplace abre em breve" no meio da home. Sem curso real, some a seção
  // inteira — e o item do menu que rolaria até ela.
  it("drops the courses band and its header link while no real course is published", async () => {
    state.courses = [];
    const { container } = render(await Home());

    expect(container.querySelector("#courses")).toBeNull();
    expect(headerLinks()).not.toContain("Courses");
    expect(screen.queryByText(/opens soon/i)).not.toBeInTheDocument();
  });

  // Acessibilidade basica: um landmark <main> por pagina, alvo do "Skip to
  // content" que abre a barra.
  it("tem exatamente um <main id=\"conteudo\">, alvo do pular para o conteudo", async () => {
    const { container } = render(await Home());

    const mains = container.querySelectorAll("main");
    expect(mains).toHaveLength(1);
    expect(mains[0]).toHaveAttribute("id", "conteudo");
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute("href", "#conteudo");
  });
});
