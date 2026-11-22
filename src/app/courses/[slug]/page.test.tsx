import { getDictionary, translate } from "@/lib/i18n/dictionaries";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import CourseDetailPage, { generateMetadata } from "@/app/courses/[slug]/page";
import type { CourseRefAccess, PublicCourseSummary } from "@/lib/data/server/public-course";

const mocks = vi.hoisted(() => ({
  getPublicCourseByRef: vi.fn<() => Promise<PublicCourseSummary | null>>(),
  getCourseRefAccess: vi.fn<() => Promise<CourseRefAccess>>(),
  isMarketplaceOpen: vi.fn(async () => true),
  // Como o Next: notFound() interrompe a renderizacao lancando.
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  // true: o componente cliente "suspende", e o Suspense mostra o fallback.
  suspendClient: false,
  pending: new Promise(() => {}),
}));

vi.mock("@/lib/data/server/public-course", () => ({
  getPublicCourseByRef: mocks.getPublicCourseByRef,
  getCourseRefAccess: mocks.getCourseRefAccess,
  isMarketplaceOpen: mocks.isMarketplaceOpen,
}));

vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));

beforeEach(() => {
  vi.clearAllMocks();
});

// O componente cliente de verdade abre assinatura no Supabase; aqui só
// interessa o contrato: a página avisa quando o cabeçalho já saiu do servidor e
// entrega o cabeçalho (`lead`) para o topo da coluna da esquerda.
vi.mock("@/components/courses/creator-course-detail", () => ({
  CreatorCourseDetail: ({ hideHeader, lead }: { hideHeader?: boolean; lead?: ReactNode }) => {
    if (mocks.suspendClient) throw mocks.pending;
    return (
      <div data-testid="client-detail">
        {lead}
        {hideHeader ? "client header hidden" : "client header shown"}
      </div>
    );
  },
}));

vi.mock("@/components/site/site-nav", () => ({
  SiteNav: () => null,
}));

// Server component assíncrono com teste próprio; aqui só importa que ele está na página.
vi.mock("@/components/site/site-footer", () => ({
  SiteFooter: () => <footer data-testid="site-footer" />,
}));

// O botão de inscrição da amostra lê a sessão; aqui só importa a volta.
vi.mock("@/components/courses/course-enrollment-cta", () => ({
  CourseEnrollmentCta: () => null,
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
  productFormat: "course",
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
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByText("client header hidden")).toBeInTheDocument();
    // O cabeçalho vai para dentro da página do cliente (topo da coluna da
    // esquerda, ao lado do cartão de compra), e não mais sozinho acima dela.
    expect(screen.getByTestId("client-detail")).toContainElement(title);
    expect(screen.getByText("12 lecciones")).toBeInTheDocument();

    // A capa que o cartão do marketplace já mostrava.
    expect(screen.getByRole("img", { name: "Deep Focus Systems" })).toHaveAttribute(
      "src",
      expect.stringContaining(encodeURIComponent(COVER)),
    );
    // Curso publicado renderiza sem a consulta extra e sem 404.
    expect(mocks.getCourseRefAccess).not.toHaveBeenCalled();
    expect(mocks.notFound).not.toHaveBeenCalled();
    // Termos e política de reembolso ao alcance de quem vai pagar.
    expect(screen.getByTestId("site-footer")).toBeInTheDocument();
  });

  // Se a parte do cliente não resolve no servidor, o HTML leva o fallback: ele
  // também traz o cabeçalho, então título, capa e resumo nunca somem do HTML.
  it("enquanto o cliente não chega, o esqueleto já traz o h1, a capa e o resumo", async () => {
    mocks.getPublicCourseByRef.mockResolvedValue(published);
    mocks.suspendClient = true;
    try {
      await renderPage();

      expect(screen.getByRole("status")).toHaveTextContent("Cargando curso...");
      expect(screen.getAllByRole("heading", { level: 1, name: "Deep Focus Systems" })).toHaveLength(1);
      expect(screen.getByText("Build a repeatable focus practice.")).toBeInTheDocument();
      expect(screen.getByRole("img", { name: "Deep Focus Systems" })).toBeInTheDocument();
      expect(screen.queryByTestId("client-detail")).not.toBeInTheDocument();
    } finally {
      mocks.suspendClient = false;
    }
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

// Amostra do catálogo de demonstração: a volta só leva à loja quando ela tem
// curso real; vazia, leva ao início.
describe("volta da página de amostra", () => {
  it.each([
    [true, "Volver a todos los cursos", "/courses"],
    [false, "Ir al inicio", "/"],
  ])("loja com curso real: %s", async (value, name, href) => {
    mocks.isMarketplaceOpen.mockResolvedValue(value);
    render(await CourseDetailPage({ params: Promise.resolve({ slug: "leadership-development" }) }));

    expect(screen.getByRole("link", { name })).toHaveAttribute("href", href);
    expect(screen.getByTestId("site-footer")).toBeInTheDocument();
  });
});

// A amostra tinha linhas de 32px em caixa alta com hífens ("PREVIEW - VIDEO -
// 8 MIN") e tudo aberto: agora o mesmo currículo da página de um curso real.
describe("currículo da página de amostra", () => {
  const es = (key: string) => translate(getDictionary("es"), key);

  it("um módulo por sanfona, o primeiro aberto, aulas e duração na linha do módulo", async () => {
    const { container } = render(await CourseDetailPage({ params: Promise.resolve({ slug: "leadership-development" }) }));

    const modules = Array.from(container.querySelectorAll<HTMLElement>("#curriculum details"));
    expect(modules).toHaveLength(2);
    expect(modules[0]).toHaveAttribute("open");
    expect(modules[1]).not.toHaveAttribute("open");
    const summary = modules[0].querySelector("summary") as HTMLElement;
    expect(within(summary).getByText(`${es("publicCourses.lessonMany").replace("{count}", "2")} · 20 min`)).toBeInTheDocument();

    const meta = within(modules[0]).getByText(`${es("publicCourses.lessonTypes.video")} · 8 min · ${es("publicCourses.previewShort")}`);
    expect(meta).not.toHaveClass("uppercase");
    expect(meta.parentElement).toHaveClass("min-h-11");
  });
});

describe("indexação da página de curso", () => {
  const metadataFor = (slug: string) => generateMetadata({ params: Promise.resolve({ slug }) });

  it("curso real publicado é indexável", async () => {
    mocks.getPublicCourseByRef.mockResolvedValue(published);
    expect((await metadataFor("deep-focus-systems")).robots).toMatchObject({ index: true });
  });

  // Amostra do catálogo de demonstração: ninguém compra, mas a página mostra
  // preço e "Inscrever-se". Fica no ar (decisão do dono), fora do índice.
  it("amostra do catálogo de demonstração não é indexada", async () => {
    expect((await metadataFor("leadership-development")).robots).toMatchObject({ index: false });
  });

  // Curso interno de teste: segue abrindo pelo link direto, como a loja já
  // previa, mas não pode continuar no índice depois de sair do sitemap.
  it("curso interno de teste não é indexado", async () => {
    mocks.getPublicCourseByRef.mockResolvedValue({ ...published, title: "[QA] Curso de teste interno" });
    expect((await metadataFor("qa-curso-de-teste-interno")).robots).toMatchObject({ index: false });
  });
});

vi.mock("@/lib/i18n/server", () => ({ getServerTranslation: async () => ({ locale: "es", t: (key: string) => translate(getDictionary("es"), key) }) }));
