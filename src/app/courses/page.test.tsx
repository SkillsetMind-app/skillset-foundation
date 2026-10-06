import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import CoursesPage, { generateMetadata } from "@/app/courses/page";
import { LOCALE_COOKIE } from "@/lib/i18n/config";

const state = vi.hoisted(() => ({ hasCourses: true, locale: "en" }));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === LOCALE_COOKIE ? { value: state.locale } : undefined) }),
}));
// Há curso real publicado (sem os internos de teste)? Contrato de hasRealPublishedCourse.
vi.mock("@/lib/data/server/public-course", () => ({ hasRealPublishedCourse: async () => state.hasCourses }));
// Barra e rodapé têm testes próprios; a loja é cliente e busca no navegador.
vi.mock("@/components/site/site-nav", () => ({ SiteNav: () => null }));
vi.mock("@/components/site/site-footer", () => ({ SiteFooter: () => null }));
vi.mock("@/components/courses/course-marketplace", () => ({ CourseMarketplace: () => <div data-testid="marketplace" /> }));

afterEach(() => {
  cleanup();
  state.hasCourses = true;
  state.locale = "en";
});

describe("/courses", () => {
  it("fica fora do índice enquanto não há curso real, mas os links seguem", async () => {
    state.hasCourses = false;
    expect((await generateMetadata()).robots).toEqual({ index: false, follow: true });
  });

  it("é indexável assim que existe um curso real", async () => {
    expect((await generateMetadata()).robots).toEqual({ index: true, follow: true });
  });

  it("vazia, diz que os cursos estão a caminho e aponta para criadores, sem vitrine", async () => {
    state.hasCourses = false;
    render(await CoursesPage());

    expect(screen.getByRole("heading", { level: 1, name: "The first courses are on the way." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Creator overview" })).toHaveAttribute("href", "/for-creators");
    expect(screen.queryByTestId("marketplace")).not.toBeInTheDocument();
    expect(screen.queryByText("Find the right course.")).not.toBeInTheDocument();
  });

  it("vazia, em espanhol", async () => {
    state.hasCourses = false;
    state.locale = "es";
    render(await CoursesPage());

    expect(screen.getByRole("heading", { level: 1, name: "Los primeros cursos están en camino." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Información para creadores" })).toHaveAttribute("href", "/for-creators");
  });

  it("com curso real, segue a loja de sempre", async () => {
    render(await CoursesPage());

    expect(screen.getByRole("heading", { level: 1, name: "Find the right course." })).toBeInTheDocument();
    expect(screen.getByTestId("marketplace")).toBeInTheDocument();
  });
});
