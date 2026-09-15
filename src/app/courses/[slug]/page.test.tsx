import { getDictionary, translate } from "@/lib/i18n/dictionaries";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import CourseDetailPage, { generateMetadata } from "@/app/courses/[slug]/page";
import type { CourseRefAccess, PublicCourseSummary } from "@/lib/data/server/public-course";

const mocks = vi.hoisted(() => ({
  getPublicCourseByRef: vi.fn<() => Promise<PublicCourseSummary | null>>(),
  getCourseRefAccess: vi.fn<() => Promise<CourseRefAccess>>(),
  // Como o Next: notFound() interrompe a renderizacao lancando.
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/lib/data/server/public-course", () => ({
  getPublicCourseByRef: mocks.getPublicCourseByRef,
  getCourseRefAccess: mocks.getCourseRefAccess,
}));

vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));

beforeEach(() => {
  vi.clearAllMocks();
});

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
    expect(screen.getByText("12 lecciones")).toBeInTheDocument();

    // A capa que o cartão do marketplace já mostrava.
    expect(screen.getByRole("img", { name: "Deep Focus Systems" })).toHaveAttribute(
      "src",
      expect.stringContaining(encodeURIComponent(COVER)),
    );
    // Curso publicado renderiza sem a consulta extra e sem 404.
    expect(mocks.getCourseRefAccess).not.toHaveBeenCalled();
    expect(mocks.notFound).not.toHaveBeenCalled();
  });

  // Link para curso nao publicado, removido ou slug invalido respondia 200 com
  // pagina vazia: ruim para anuncio e para o buscador.
  it("curso que nao existe para quem pede responde 404 antes de desenhar a pagina", async () => {
    mocks.getPublicCourseByRef.mockResolvedValue(null);
    mocks.getCourseRefAccess.mockResolvedValue("missing");

    await expect(renderPage("nao-existe")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.getCourseRefAccess).toHaveBeenCalledWith("nao-existe");
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });

  it("rascunho visivel para o dono segue com a pagina do cliente, que desenha o proprio cabecalho", async () => {
    mocks.getPublicCourseByRef.mockResolvedValue(null);
    mocks.getCourseRefAccess.mockResolvedValue("visible");

    await renderPage("rascunho");

    expect(mocks.notFound).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(screen.getByText("client header shown")).toBeInTheDocument();
  });

  it("falha de leitura nao vira 404", async () => {
    mocks.getPublicCourseByRef.mockResolvedValue(null);
    mocks.getCourseRefAccess.mockResolvedValue("unknown");

    await renderPage("talvez-exista");

    expect(mocks.notFound).not.toHaveBeenCalled();
    expect(screen.getByText("client header shown")).toBeInTheDocument();
  });

  it("sem resumo, a descrição do <meta> usa o título — e um título com $& aparece literal", async () => {
    // Num replace sem callback, "$&" vira o trecho casado ("{title}"). O título é
    // texto do professor, não nosso.
    mocks.getPublicCourseByRef.mockResolvedValue({ ...published, title: "Deep $& Focus", summary: null });

    const metadata = await generateMetadata({ params: Promise.resolve({ slug: "deep-focus-systems" }) });

    expect(metadata.description).toContain("Deep $& Focus: contenido");
  });
});

vi.mock("@/lib/i18n/server", () => ({ getServerTranslation: async () => ({ locale: "es", t: (key: string) => translate(getDictionary("es"), key) }) }));
