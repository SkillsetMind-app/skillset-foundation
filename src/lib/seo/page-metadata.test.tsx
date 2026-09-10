import { describe, expect, it, vi } from "vitest";

import { LOCALE_COOKIE } from "@/lib/i18n/config";
import { buildPageMetadata, SITE_URL } from "@/lib/seo/page-metadata";
import { privatePageMetadata } from "@/lib/seo/private-page-metadata";

const state = vi.hoisted(() => ({ locale: "en" as "en" | "es" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === LOCALE_COOKIE ? { value: state.locale } : undefined),
  }),
}));

describe("buildPageMetadata — host canônico", () => {
  // Produção serve `www`: o apex responde 301 para cá. Enquanto SITE_URL
  // apontava para o apex, toda página se declarava canônica num endereço que
  // redireciona, e o sitemap inteiro listava URLs redirecionadas — buscador
  // trata redirecionamento como sinal enfraquecido.
  it("usa www, não o apex que redireciona", () => {
    expect(SITE_URL).toBe("https://www.skillsetmind.com");
  });

  it("monta canonical e og:url no host canônico", () => {
    const meta = buildPageMetadata({
      title: "Curso",
      description: "Descrição",
      path: "/courses/abc",
    });

    expect(meta.alternates?.canonical).toBe(
      "https://www.skillsetmind.com/courses/abc",
    );
    expect(meta.openGraph?.url).toBe("https://www.skillsetmind.com/courses/abc");
  });
});

describe("buildPageMetadata — imagem do card", () => {
  // Antes o og:image era SEMPRE o logo da marca: todo curso do catálogo
  // produzia um card de compartilhamento visualmente idêntico.
  it("usa a capa do curso quando ela é uma URL absoluta", () => {
    const capa = "https://cdn.example.com/capa.jpg";
    const meta = buildPageMetadata({
      title: "Curso",
      description: "Descrição",
      path: "/courses/abc",
      image: capa,
    });

    expect(meta.openGraph?.images).toEqual([{ url: capa }]);
    expect(meta.twitter?.images).toEqual([capa]);
  });

  it("resolve caminho local contra o host canônico", () => {
    const meta = buildPageMetadata({
      title: "Curso",
      description: "Descrição",
      path: "/courses/abc",
      image: "/brand/capa.png",
    });

    expect(meta.openGraph?.images).toEqual([
      { url: "https://www.skillsetmind.com/brand/capa.png" },
    ]);
  });

  it("cai no logo da marca quando a página não tem imagem própria", () => {
    const semImagem = buildPageMetadata({
      title: "Sobre",
      description: "Descrição",
      path: "/about",
    });
    const comNull = buildPageMetadata({
      title: "Sobre",
      description: "Descrição",
      path: "/about",
      image: null,
    });

    expect(semImagem.openGraph?.images).toEqual(comNull.openGraph?.images);
    expect(JSON.stringify(semImagem.openGraph?.images)).toContain(SITE_URL);
  });
});

describe("privatePageMetadata — cabeçalho de página logada", () => {
  // As páginas atrás de login (/account, /learn, /teach) não têm título
  // próprio: a aba do navegador cai no título genérico do layout raiz. O
  // helper reusa o MESMO rótulo que a página já mostra via
  // `PlatformShell title={t(chave)}`, no idioma do cookie, com o sufixo da
  // marca — nada de canonical/Open Graph, a página exige login.
  it.each([
    ["en", "Settings | SkillsetMind"],
    ["es", "Configuración | SkillsetMind"],
  ])("traduz o rótulo e acrescenta o sufixo da marca (%s)", async (locale, title) => {
    state.locale = locale as "en" | "es";
    expect(await privatePageMetadata("accountSettings.label")).toEqual({
      title,
      robots: { index: false, follow: false },
    });
  });
});
