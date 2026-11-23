import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CardListSkeleton } from "@/components/shared/page-skeletons";

// Leituras do fonte, como em avisos-professor-conta.test.ts: o jsdom não pinta
// nada, então o que dá para provar é que a peça da casa está no lugar e a feita
// à mão não voltou.
const read = (path: string) => readFileSync(join(process.cwd(), "src", path), "utf8");
const handRedBox = "bg-[rgba(178,34,52,0.06)]";

describe("F-07: as últimas caixas vermelhas à mão viraram o aviso da casa", () => {
  it.each([
    "components/auth/auth-provider.tsx",
    "components/auth/loading-screen.tsx",
    "components/auth/onboarding-choice.tsx",
    "components/auth/onboarding-wizard.tsx",
    "components/auth/reset-password-form.tsx",
    "components/auth/turnstile-widget.tsx",
    "components/certificates/certificate-verification-panel.tsx",
    "components/support/support-ticket-center.tsx",
  ])("%s usa o InlineAlert de erro", (file) => {
    const source = read(file);
    expect(source).not.toContain(handRedBox);
    expect(source).toContain('<InlineAlert tone="error"');
  });

  // A confirmação de apagar não é erro (não vira alerta), mas o fundo é o
  // token: o 6% literal sumia no tema escuro.
  it("a confirmação de apagar da comunidade usa o token de fundo", () => {
    const source = read("components/learn/community-item-actions.tsx");
    expect(source).not.toContain(handRedBox);
    expect(source).toContain("bg-[var(--color-danger-soft)]");
  });
});

describe("F-09: barras de progresso", () => {
  it("os passos do onboarding usam a barra compartilhada", () => {
    expect(read("components/auth/onboarding-choice.tsx")).toContain("<ProgressBar");
  });

  it("as duas barras nativas de envio usam os tokens da barra da casa", () => {
    expect(read("components/teacher/lesson-content-modal.tsx")).toContain('<progress className="upload-progress"');
    expect(read("components/teacher/lesson-upload-provider.tsx")).toContain('<progress className="upload-progress mt-2"');
    const css = read("app/globals.css");
    const rule = (selector: string) => {
      const at = css.indexOf(`${selector} {`);
      expect(at, selector).toBeGreaterThan(-1);
      return css.slice(at, css.indexOf("}", at));
    };
    expect(rule(".upload-progress[value]")).toContain("background: var(--color-line)");
    expect(rule(".upload-progress[value]::-webkit-progress-value")).toContain("background: var(--color-accent-fg)");
    expect(rule(".upload-progress[value]::-moz-progress-bar")).toContain("background: var(--color-accent-fg)");
  });

  it("o CSS morto da barra antiga do currículo saiu", () => {
    expect(read("app/globals.css")).not.toContain("member-curriculum-progress");
  });
});

describe("F-03 / I-3: esperas com forma, e as rotas que respondem na hora", () => {
  it.each([
    "app/learn/areas/[criador]/loading.tsx",
    "app/teach/activate/loading.tsx",
    "app/teach/activate/return/loading.tsx",
  ])("%s existe", (file) => {
    expect(existsSync(join(process.cwd(), "src", file))).toBe(true);
  });

  it("a caixa de mensagens do aluno não espera em branco", () => {
    expect(read("app/learn/messages/page.tsx")).not.toContain("fallback={null}");
  });

  it.each(["tabs", "title", "search"] as const)("a lista de cartões (%s): um aviso, sem título nem botão", (head) => {
    render(<CardListSkeleton label="Loading credentials..." head={head} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading credentials...");
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("F-19: um tom só nos blocos de espera", () => {
  it.each([
    "app/auth/page.tsx",
    "components/learn/learn-dashboard.tsx",
    "components/teacher/teacher-members-area-hub.tsx",
    "components/teacher/teacher-inbox-questions.tsx",
    "components/teacher/teacher-messages-inbox.tsx",
  ])("%s pinta o osso em surface-strong", (file) => {
    const source = read(file);
    expect(source).not.toMatch(/animate-pulse[^"]*bg-\[var\(--color-surface-soft\)\]/);
    expect(source).toMatch(/animate-pulse[^"]*bg-\[var\(--color-surface-strong\)\]/);
  });
});
