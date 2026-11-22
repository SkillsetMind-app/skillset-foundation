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
  it("no estudio a coluna tem no maximo 1280px, centrada, so a partir de 1440px; o construtor fica livre", () => {
    render(
      <I18nProvider initialLocale="en">
        <PlatformShell title="Your sales">Rows</PlatformShell>
      </I18nProvider>,
    );

    expect(frame()).toHaveClass("mx-auto", "w-full", "min-[1440px]:max-w-7xl", "has-[.course-builder-shell]:max-w-none");
    // A secao continua sendo a que rola: a barra fica na borda da janela.
    expect(frame().parentElement).toHaveClass("platform-content");
    expect(frame()).toHaveTextContent("Rows");
  });

  it("fora do estudio (sala do aluno, conta) a largura nao muda", () => {
    mocks.pathname = "/learn/events";
    render(
      <I18nProvider initialLocale="en">
        <PlatformShell title="Events">Rows</PlatformShell>
      </I18nProvider>,
    );

    expect(frame()).not.toHaveClass("min-[1440px]:max-w-7xl");
    expect(frame()).not.toHaveClass("mx-auto");
  });

  it.each([false, true])("um h1 so, em serifa de 30px em qualquer largura (compact=%s), sem o rotulo generico", (compact) => {
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
  });

  it("as acoes da pagina ficam no mesmo cabecalho, a direita do titulo", () => {
    render(
      <PlatformPageHeader
        eyebrow="Products"
        title="Members & communities"
        actions={<button type="button">New product</button>}
      />,
    );

    const header = screen.getByRole("heading", { level: 1 }).closest(".platform-page-heading") as HTMLElement;
    expect(header).toHaveClass("flex", "items-end", "justify-between");
    expect(within(header).getByText("Products")).toHaveClass("uppercase");
    expect(within(header).getByRole("button", { name: "New product" })).toBeInTheDocument();
  });

  it("o cabecalho tem a linha de baixo que separa titulo e acoes do corpo", () => {
    const body = css.match(/\n\.platform-page-heading \{([^}]*)\}/)?.[1] ?? "";
    expect(body).toMatch(/border-bottom:\s*1px solid var\(--color-line\)/);
    expect(body).toMatch(/padding:\s*0\.5rem 0 1\.25rem/);
  });
});
