import { cleanup, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { PlatformPageHeader } from "@/components/platform/platform-page-header";
import { PlatformShell } from "@/components/platform/platform-shell";

// O que a pessoa via: num monitor largo cada tela do professor ia de ponta a
// ponta (o titulo de uma venda na borda esquerda, o valor 1500px depois), e
// telas irmas tinham cinco cabecalhos diferentes (48px em serifa, 36px sem
// serifa, 20px no celular, titulo dentro de cartao). Agora: uma coluna de no
// maximo 1280px no estudio e um cabecalho so.

const mocks = vi.hoisted(() => ({ pathname: "/teach/sales" }));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ user: { uid: "teacher-test", displayName: "Teacher", roles: ["teacher"] } }),
}));
vi.mock("./platform-header", () => ({ PlatformHeader: () => null }));
vi.mock("./status-banner", () => ({ StatusBanner: () => null }));
vi.mock("@/components/teacher/use-teacher-inbox-count", () => ({ useTeacherInboxCount: () => undefined }));

const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8").replace(/\r\n/g, "\n");

function frame() {
  return document.querySelector(".platform-content")!.firstElementChild as HTMLElement;
}

afterEach(() => {
  cleanup();
  mocks.pathname = "/teach/sales";
});

describe("moldura das telas do professor", () => {
  it("no estudio a coluna tem no maximo 1280px, centrada, so a partir de 1440px", () => {
    render(
      <I18nProvider initialLocale="en">
        <PlatformShell title="Your sales">Rows</PlatformShell>
      </I18nProvider>,
    );

    expect(frame()).toHaveClass("mx-auto", "w-full", "min-[1440px]:max-w-7xl");
    // A secao continua sendo a que rola: a barra fica na borda da janela.
    expect(frame().parentElement).toHaveClass("platform-content");
    expect(frame()).toHaveTextContent("Rows");
  });

  // O construtor usa a largura toda, decidido pelo endereco: pela classe do
  // editor carregado, o esqueleto saia em 1280px e a pagina pulava depois.
  it.each([
    ["sem curso (lista, esqueleto, erro)", <p key="list">Loading products</p>],
    ["com o editor carregado", <div key="editor" className="course-builder-shell">Editor</div>],
  ])("/teach/builder %s usa a largura toda desde o primeiro quadro", (_label, children) => {
    mocks.pathname = "/teach/builder";
    render(
      <I18nProvider initialLocale="en">
        <PlatformShell title="My products" hideHeader>{children}</PlatformShell>
      </I18nProvider>,
    );

    expect(frame()).not.toHaveClass("min-[1440px]:max-w-7xl");
    expect(frame()).not.toHaveClass("mx-auto");
  });

  // A conta (Ganhos abre pela barra do professor) e as listas do aluno ganham
  // a mesma coluna: eram as telas que ainda iam de ponta a ponta.
  it.each([
    "/account",
    "/account/payments",
    "/account/billing",
    "/account/notifications",
    "/learn",
    "/learn/events",
    "/learn/messages",
    "/learn/wishlist",
    "/learn/credentials",
    "/learn/community",
  ])("%s ganha a coluna de 1280px, so a partir de 1440px", (pathname) => {
    mocks.pathname = pathname;
    render(
      <I18nProvider initialLocale="en">
        <PlatformShell title="Events">Rows</PlatformShell>
      </I18nProvider>,
    );

    expect(frame()).toHaveClass("mx-auto", "w-full", "min-[1440px]:max-w-7xl");
    expect(frame().parentElement).toHaveClass("platform-content");
  });

  // A sala de aula usa a largura toda por desenho; a area de membros, o
  // suporte e as telas de pagar o plano ficam como estavam.
  it.each([
    "/learn/courses/curso-1",
    "/learn/courses/curso-1/community",
    "/learn/areas/x",
    "/support",
    "/account/billing/upgrade",
    "/account/billing/return",
    "/account/plans",
    "/ops",
  ])("%s segue com a largura de antes", (pathname) => {
    mocks.pathname = pathname;
    render(
      <I18nProvider initialLocale="en">
        <PlatformShell title="Events">Rows</PlatformShell>
      </I18nProvider>,
    );

    expect(frame()).not.toHaveClass("min-[1440px]:max-w-7xl");
    expect(frame()).not.toHaveClass("mx-auto");
  });

  it.each([false, true])("no estudio: um h1 so, em serifa de 30px em qualquer largura (compact=%s), com a linha de baixo", (compact) => {
    render(
      <I18nProvider initialLocale="en">
        <PlatformShell title="Students" description="Everyone who joined." compact={compact}>
          Rows
        </PlatformShell>
      </I18nProvider>,
    );

    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent(/^Students$/);
    expect(headings[0]).toHaveClass("display-title", "text-3xl");
    expect(headings[0].className).not.toMatch(/\b(?:sm|lg):text-|text-xl|text-5xl/);
    expect(screen.getByText("Everyone who joined.")).toHaveClass("mt-2", "max-w-2xl");
    const header = headings[0].closest(".pb-5") as HTMLElement;
    expect(header).toHaveClass("border-b", "border-[var(--color-line)]");
    // A regra da casca antiga nao vale aqui: ela sobrescreveria o respiro.
    expect(header).not.toHaveClass("platform-page-heading");
  });

  // Decisao: este pacote nao muda o cabecalho da sala do aluno, da conta, do
  // suporte nem do painel interno. Ele sai exatamente como antes.
  it.each([
    ["/learn/events", false, ["text-3xl", "sm:text-4xl", "lg:text-5xl"]],
    ["/account", true, ["text-xl", "sm:text-2xl", "lg:text-3xl"]],
    ["/ops/users/u-1", true, ["text-xl", "sm:text-2xl", "lg:text-3xl"]],
  ] as const)("%s (compact=%s) segue com o cabecalho antigo", (pathname, compact, sizes) => {
    mocks.pathname = pathname;
    render(
      <I18nProvider initialLocale="en">
        <PlatformShell eyebrow="Account" title="Settings" description="Your preferences." compact={compact}>
          Rows
        </PlatformShell>
      </I18nProvider>,
    );

    const heading = screen.getByRole("heading", { level: 1, name: "Settings" });
    expect(heading).toHaveClass("display-title", "max-w-4xl", ...sizes);
    const wrapper = heading.parentElement as HTMLElement;
    expect(wrapper).toHaveClass("platform-page-heading");
    expect(wrapper.classList.contains("platform-page-heading--compact")).toBe(compact);
    expect(wrapper).not.toHaveClass("border-b");
    expect(screen.getByText("Account")).toHaveClass("font-semibold", "tracking-[0.22em]");
    expect(screen.getByText("Your preferences.")).toHaveClass("max-w-3xl", "leading-7", compact ? "mt-2" : "mt-3");
    // A regra da folha tambem e a de antes: sem linha de baixo.
    const body = css.match(/\n\.platform-page-heading \{([^}]*)\}/)?.[1] ?? "";
    expect(body).toMatch(/padding:\s*0\.5rem 0 0\.25rem/);
    expect(body).not.toMatch(/border/);
  });

  it("as acoes da pagina ficam no mesmo cabecalho, a direita do titulo", () => {
    render(
      <PlatformPageHeader
        eyebrow="Products"
        title="Members & communities"
        actions={<button type="button">New product</button>}
      />,
    );

    const header = screen.getByRole("heading", { level: 1 }).closest(".pb-5") as HTMLElement;
    expect(header).toHaveClass("flex", "items-end", "justify-between");
    expect(within(header).getByText("Products")).toHaveClass("uppercase");
    expect(within(header).getByRole("button", { name: "New product" })).toBeInTheDocument();
  });

  // O Advisor ancorado no topo fica logo abaixo da camada da barra: o painel do
  // sino e o menu da conta, que moram nela, abrem por cima da conversa.
  it("o Advisor ancorado fica abaixo da camada da barra do topo", () => {
    // So a declaracao (o comentario da barra cita "z-index: 1" no meio do texto).
    const zIndex = (selector: string) => {
      const start = css.indexOf(`\n${selector} {`);
      const body = start === -1 ? "" : css.slice(start, css.indexOf("}", start));
      return Number(body.match(/\n\s*z-index:\s*(\d+);/)?.[1]);
    };
    const bar = zIndex(".platform-topbar");
    const anchored = zIndex(".floating-action--advisor.floating-action--anchored");
    expect(bar).toBe(60);
    expect(anchored).toBeLessThan(bar);
  });
});
