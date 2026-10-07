import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Guardas da revisao do PR #494. Sao leituras do fonte (como o
// button-sizes-cascade faz com o CSS): o jsdom nao mede layout, entao o que
// da para provar sem navegador e que a classe certa esta no lugar certa.

const read = (path: string) => readFileSync(join(process.cwd(), "src", path), "utf8");

// Acha o elemento que contem `needle` e devolve o texto da tag de abertura.
function tagAround(source: string, needle: string): string {
  const at = source.indexOf(needle);
  expect(at, `trecho nao encontrado: ${needle}`).toBeGreaterThan(-1);
  const start = source.lastIndexOf("<", at);
  return source.slice(start, source.indexOf(">", at) + 1);
}

describe("C1: o chip de status quebra de linha em vez de sair do cartao", () => {
  it("a linha do tipo + status do cartao de produto tem flex-wrap", () => {
    const tag = tagAround(
      read("components/teacher/teacher-studio-dashboard.tsx"),
      "flex flex-wrap items-start justify-between gap-2",
    );
    expect(tag).toContain("flex-wrap");
  });
});

describe("C2: botoes sem .button-* mantem o piso de 44px (min-h-11)", () => {
  const sites: [string, string][] = [
    ["components/auth/confirm-email-gate.tsx", "min-h-11 rounded-md bg-[var(--color-primary)]"],
    ["components/auth/confirm-email-gate.tsx", "min-h-11 rounded-md border border-[var(--color-line)] bg-white px-4"],
    ["components/auth/signup-form.tsx", '"min-h-11 rounded-md border-[1.5px]'],
    ["components/account/profile-settings-panel.tsx", "min-h-11 shrink-0 rounded-md border"],
    ["components/teacher/course-landing-editor.tsx", "inline-flex min-h-11 items-center gap-2 rounded-md bg-[var(--color-primary)]"],
    ["components/teacher/course-landing-editor.tsx", "mt-3 min-h-11 justify-self-start"],
    ["components/teacher/landing-image-field.tsx", "inline-flex min-h-11 w-fit items-center gap-2 rounded-md border"],
  ];

  it.each(sites)("%s tem min-h-11 em %s", (file, snippet) => {
    expect(read(file)).toContain(snippet);
  });

  it("os dois botoes do campo de imagem tem min-h-11", () => {
    const hits = read("components/teacher/landing-image-field.tsx").match(/min-h-11 w-fit/g);
    expect(hits).toHaveLength(2);
  });

  it("a regra global font: inherit nao voltou", () => {
    expect(read("app/globals.css")).not.toMatch(/^button,\s*input,\s*textarea,\s*select\s*\{/m);
  });
});

describe("C3: latao fora de erro, aviso e exclusao", () => {
  const dangerText = "text-[var(--color-danger-fg)]";
  const errorSites: [string, string][] = [
    ["components/teacher/activation-checkout-panel.tsx", 'role="alert" className="p-6 text-sm'],
    ["components/account/embedded-checkout-panel.tsx", 'role="alert" className="p-6 text-sm'],
    ["components/learn/community-leaderboard.tsx", 'role="alert" className="mt-3 text-xs font-semibold'],
    ["components/certificates/certificate-verification-panel.tsx", '<h2 className="text-lg font-semibold'],
  ];

  it.each(errorSites)("%s: erro em danger-fg", (file, needle) => {
    expect(tagAround(read(file), needle)).toContain(dangerText);
  });

  it("senhas nao conferem em danger-fg", () => {
    const src = read("components/auth/update-password-form.tsx");
    const i = src.indexOf('t("auth.signup.passwordsDontMatch")');
    expect(src.slice(src.lastIndexOf("<span", i), i)).toContain(dangerText);
  });

  it("confirmar exclusao do curso usa button-danger, nao button-accent", () => {
    const src = read("components/admin/managed-course-panel.tsx");
    expect(src).not.toContain("button-accent");
    expect(src.match(/button-danger/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("remover credencial: hover em danger-fg, sem latao", () => {
    const tag = tagAround(read("components/account/profile-settings-panel.tsx"), "removeCredential(index)");
    const cls = read("components/account/profile-settings-panel.tsx").match(
      /className="min-h-11 shrink-0[^"]*"/,
    )?.[0];
    expect(tag).toBeTruthy();
    expect(cls).toContain("hover:text-[var(--color-danger-fg)]");
    expect(cls).not.toContain("accent");
  });

  it("olho da pagina de erro em navy e chip live_event sem latao", () => {
    expect(tagAround(read("app/error.tsx"), 'appErrors.eyebrow')).not.toContain("accent");
    const row = read("components/account/notification-row.tsx");
    expect(row).toMatch(/live_event: "[^"]*text-\[var\(--color-danger-fg\)\]"/);
  });
});

describe("Plausivel 5: botao-texto com pelo menos 24px de area", () => {
  it.each([
    ["components/account/security-settings-panel.tsx", "min-h-6 text-xs font-bold"],
    ["components/account/totp-mfa-section.tsx", "min-h-6 shrink-0 text-xs"],
    ["components/account/totp-mfa-section.tsx", "min-h-6 text-xs font-semibold"],
    ["components/account/billing-tabs.tsx", "min-h-6 text-xs font-semibold"],
    ["components/learn/community-feed.tsx", "min-h-6 text-xs font-semibold"],
    ["components/auth/signup-form.tsx", "inline-flex min-h-6 items-center"],
  ])("%s tem %s", (file, snippet) => {
    expect(read(file)).toContain(snippet);
  });

  it("os dois Remover do editor de landing tem min-h-6", () => {
    const hits = read("components/teacher/course-landing-editor.tsx").match(/"min-h-6 justify-self-start/g);
    expect(hits).toHaveLength(2);
  });
});

describe("Plausivel 6: rolagem em JS respeita reduzir movimento", () => {
  it.each([
    "components/account/security-settings-panel.tsx",
    "components/auth/reset-password-form.tsx",
    "components/learn/course-unlock-modal.tsx",
    "components/learn/enrolled-course-workspace.tsx",
  ])("%s usa scrollBehavior()", (file) => {
    const src = read(file);
    expect(src).toContain("scrollBehavior()");
    expect(src).not.toMatch(/behavior: "smooth"/);
  });
});
