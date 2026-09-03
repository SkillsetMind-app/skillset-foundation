import { readFileSync } from "node:fs";
import { join } from "node:path";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CapabilitiesGrid } from "@/components/site/capabilities-grid";
import { ForCreatorsBand } from "@/components/site/for-creators-band";
import { HowItWorksStrip } from "@/components/site/how-it-works-strip";
import { MarketingHero } from "@/components/site/marketing-hero";
import { PromisePreviewBand } from "@/components/site/promise-preview-band";
import RefundPolicyPage from "@/app/refund-policy/page";

// Estas seções passaram a ser server components: resolvem o idioma pelo
// cookie. Sem cookie = inglês, que é o texto que os testes abaixo esperam.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    refreshUser: vi.fn(),
    status: "unauthenticated",
    user: null,
    signOut: vi.fn(),
  }),
}));

vi.mock("@/components/site/site-footer", () => ({
  SiteFooter: () => null,
}));

afterEach(cleanup);

function readCss() {
  return readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
}

function readSource(relative: string) {
  return readFileSync(join(process.cwd(), relative), "utf8");
}

/** Bloco de uma regra CSS, do seletor até a chave que fecha. */
function ruleBody(css: string, selector: string) {
  const start = css.indexOf(`${selector} {`);
  expect(start, `regra ${selector} não existe`).toBeGreaterThan(-1);
  const end = css.indexOf("}", start);
  return css.slice(start, end);
}

describe("cabeçalho: uma camada fixa, sem layout animado", () => {
  it("é uma barra fixa de largura total, não uma ilha com margem", () => {
    const header = ruleBody(readCss(), ".site-header");

    expect(header).toMatch(/position:\s*fixed/);
    expect(header).toMatch(/top:\s*0/);
    // A ilha flutuante tinha `margin: 14px 20px 0` e `top: 14px`.
    expect(header).not.toMatch(/margin/);
  });

  it("ao rolar anima só a sombra, e em 150ms", () => {
    const css = readCss();
    const header = ruleBody(css, ".site-header");

    expect(header).toMatch(/transition:\s*box-shadow 150ms/);
    // Nenhuma propriedade de layout na transição: era isso que fazia a página
    // se reposicionar a cada quadro do scroll.
    expect(header).not.toMatch(/transition:[^;]*(margin|padding|top)/);

    const scrolled = ruleBody(css, ".site-header.scrolled");
    expect(scrolled).toMatch(/box-shadow/);
    expect(scrolled).not.toMatch(/(margin|padding|top):/);
  });

  it("o quadro interno não é mais um cartão com sombra", () => {
    const inner = ruleBody(readCss(), ".site-header__inner");

    expect(inner).not.toMatch(/box-shadow/);
    expect(inner).not.toMatch(/border-radius/);
    expect(inner).toMatch(/min-height:\s*var\(--site-header-height\)/);
  });

  it("a faixa que reserva o espaço usa a mesma medida da barra", () => {
    const css = readCss();

    expect(css).toMatch(/--site-header-height:\s*\d+px/);
    expect(ruleBody(css, ".site-header-spacer")).toMatch(
      /height:\s*var\(--site-header-height\)/,
    );
  });

  it("os alvos do cabeçalho têm no mínimo 44px de altura", () => {
    const css = readCss();

    for (const selector of [".site-header__link", ".btn-signin", ".btn-cta-hero"]) {
      expect(ruleBody(css, selector), selector).toMatch(/min-height:\s*44px/);
    }
  });
});

describe("fundo da página", () => {
  it("o gradiente fixo atrás de tudo saiu", () => {
    // .page-shell::before pintava um gradiente `position: fixed` no z-index -2
    // por trás de toda a página; era ele que fazia os cartões "flutuarem".
    expect(readCss()).not.toMatch(/\.page-shell::before\s*\{/);
  });
});

describe("hero", () => {
  it("não se encaixa mais por margem negativa, e a altura é um clamp", async () => {
    const { container } = render(await MarketingHero());
    const section = container.querySelector("section");

    expect(section?.className).not.toMatch(/-mt-/);
    expect(section?.className).toContain("min-h-[clamp(560px,92svh,900px)]");
    expect(section?.className).not.toContain("min-h-[100svh]");
  });
});

describe("rodapé", () => {
  it("é uma faixa com filete no topo, não um cartão com sombra", () => {
    const source = readSource("src/components/site/site-footer.tsx");
    const footerTag = source.slice(
      source.indexOf("<footer"),
      source.indexOf(">", source.indexOf("<footer")),
    );

    expect(footerTag).toContain("border-t");
    expect(source).not.toContain("shadow-[var(--shadow-soft)]");
    expect(source).not.toContain('rounded-[14px] border');
  });
});

describe("documentos longos usam a mesma moldura das outras páginas públicas", () => {
  it("a política de reembolso monta o PublicPage em modo leitura", () => {
    expect(readSource("src/components/site/legal-article.tsx")).toContain(
      "<PublicPage",
    );

    render(<RefundPolicyPage />);

    // Mesmo h1 do resto do site (.page-title), e não o text-6xl fixo do
    // molde antigo.
    const title = screen.getByRole("heading", { level: 1 });
    expect(title).toHaveClass("page-title");
    expect(title.className).not.toMatch(/text-(5|6)xl/);

    // Coluna de leitura ~72ch, em vez do cartão dentro de cartão.
    expect(document.querySelector("main")?.className).toContain("max-w-[72ch]");
  });
});

describe("seções de marketing viraram servidor", () => {
  it.each([
    "src/components/site/marketing-hero.tsx",
    "src/components/site/capabilities-grid.tsx",
    "src/components/site/how-it-works-strip.tsx",
    "src/components/site/promise-preview-band.tsx",
    "src/components/site/for-creators-band.tsx",
  ])("%s não é mais componente de cliente", (path) => {
    const source = readSource(path);

    expect(source).not.toContain('"use client"');
    expect(source).not.toContain("useTranslation");
    expect(source).toContain("getServerTranslation");
  });

  it.each([
    ["hero", MarketingHero, "Your knowledge changes lives."],
    ["how it works", HowItWorksStrip, "Three steps from your method to a published program."],
    ["capabilities", CapabilitiesGrid, "Everything your program needs is already built in."],
    ["promise", PromisePreviewBand, "Six commitments. Written down. Public."],
    ["for creators", ForCreatorsBand, "Reach more people than your practice ever could."],
  ])(
    "%s continua renderizando o texto traduzido",
    async (_name, Section, text) => {
      render(await Section());

      expect(screen.getByText(text, { exact: false })).toBeInTheDocument();
    },
  );

  // Herdado de marketing.test.tsx, que não consegue mais montar a seção pela
  // home (server component assíncrono). A carta continua sendo uma só.
  it("a promessa continua sendo uma carta só, em qualquer tela", async () => {
    render(await PromisePreviewBand());

    expect(screen.getByText("Fee-lock for 24 months")).toBeInTheDocument();
    expect(
      screen.queryByText(/Export every course, student, sale, and post/),
    ).not.toBeInTheDocument();

    const card = screen
      .getByText("Public record · v1.0")
      .closest("div.relative.overflow-hidden");
    expect(card).not.toHaveClass("hidden");
    expect(
      screen.getByRole("link", { name: "Read the full Promise" }),
    ).toHaveAttribute("href", "/promise");
  });
});
