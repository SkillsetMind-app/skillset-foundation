import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import CourseDetailPage from "@/app/courses/[slug]/page";
import type { PublicCourseSummary } from "@/lib/data/server/public-course";

const mocks = vi.hoisted(() => ({
  getPublicCourseByRef: vi.fn<() => Promise<PublicCourseSummary | null>>(),
}));

vi.mock("@/lib/data/server/public-course", () => ({
  getPublicCourseByRef: mocks.getPublicCourseByRef,
}));

// O componente cliente de verdade abre assinatura no Supabase; aqui só
// interessa o contrato: a página avisa quando o cabeçalho já saiu do servidor.
vi.mock("@/components/courses/creator-course-detail", () => ({
  CreatorCourseDetail: ({ hideHeader }: { hideHeader?: boolean }) => (
    <div>{hideHeader ? "client header hidden" : "client header shown"}</div>
  ),
}));

vi.mock("@/components/site/site-nav", () => ({
  SiteNav: () => null,
}));

afterEach(cleanup);

const COVER = "https://example.supabase.co/storage/v1/object/public/covers/deep-focus.jpg";

const published: PublicCourseSummary = {
  id: "course-1",
  urlSlug: "deep-focus-systems",
  title: "Deep Focus Systems",
  summary: "Build a repeatable focus practice.",
  category: "Performance",
  coverImageUrl: COVER,
  lessonCount: 12,
  updatedAt: null,
};

// Slug que NÃO existe no catálogo estático: cai no ramo do curso de criador.
async function renderPage(slug = "deep-focus-systems") {
  render(await CourseDetailPage({ params: Promise.resolve({ slug }) }));
}

describe("página do curso de criador", () => {
  it("renderiza título, capa e resumo uma vez, no servidor, e cala o cabeçalho do cliente", async () => {
    mocks.getPublicCourseByRef.mockResolvedValue(published);

    await renderPage();

    // Antes: o servidor punha o título e o cliente desenhava um cartão navy
    // com o MESMO título e resumo logo abaixo.
    const title = screen.getByRole("heading", { level: 1, name: "Deep Focus Systems" });
    expect(title).toHaveClass("page-title");
    expect(title.className).not.toMatch(/text-(4|5|6)xl/);
    expect(screen.getByText("client header hidden")).toBeInTheDocument();

    // A capa que o cartão do marketplace já mostrava.
    expect(screen.getByRole("img", { name: "Deep Focus Systems" })).toHaveAttribute(
      "src",
      expect.stringContaining(encodeURIComponent(COVER)),
    );
  });

  it("sem curso publicado, deixa o cliente desenhar o próprio cabeçalho", async () => {
    mocks.getPublicCourseByRef.mockResolvedValue(null);

    await renderPage("rascunho");

    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(screen.getByText("client header shown")).toBeInTheDocument();
  });
});
