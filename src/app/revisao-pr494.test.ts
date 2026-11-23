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
    // O "Send me a new link" do link vencido virou .button-solid (44px vem da
    // classe), entao saiu desta lista de botoes sem .button-*.
    // "Wrong email? Change it" virou link de texto, mas segue com 44px de alvo.
    ["components/auth/confirm-email-gate.tsx", "min-h-11 rounded-md px-4 text-sm font-semibold text-[var(--color-primary)]"],
    ["components/auth/signup-form.tsx", '"min-h-11 rounded-md border-[1.5px]'],
    ["components/account/profile-settings-panel.tsx", "min-h-11 shrink-0 rounded-md border"],
    // O "Save page" virou o Button da casa (min-h-11 do tamanho md); o botão
    // feito à mão que sobrou ali é o do modelo da página, também com 44px.
    ["components/teacher/course-landing-editor.tsx", "inline-flex min-h-11 items-center gap-1.5 rounded-sm px-3 py-2"],
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
  // Terceiro item: o que a tag precisa ter, quando não é a classe direta.
  const errorSites: [string, string, string?][] = [
    // Virou InlineAlert de erro (F-07), que pinta o texto em danger-fg.
    ["components/teacher/activation-checkout-panel.tsx", 'className="m-6"', 'tone="error"'],
    // O erro do checkout embutido virou o InlineAlert de erro (F-07), dentro
    // da mesma moldura p-6 (a linha abaixo confere a moldura).
    ["components/account/embedded-checkout-panel.tsx", '<InlineAlert tone="error" title={t("activationCheckout.errorTitle")}', 'tone="error"'],
    ["components/account/embedded-checkout-panel.tsx", '<div className="p-6 text-sm">', 'className="p-6 text-sm"'],
    // Virou LoadErrorAlert (F-11: com "Try again"), que sempre desenha o
    // InlineAlert de erro, conferido na linha seguinte.
    ["components/learn/community-leaderboard.tsx", "<LoadErrorAlert", "<LoadErrorAlert"],
    ["components/ui/load-error-alert.tsx", '<InlineAlert tone="error"', 'tone="error"'],
    ["components/certificates/certificate-verification-panel.tsx", '<h2 className="text-lg font-semibold'],
  ];

  it.each(errorSites)("%s: erro em danger-fg", (file, needle, expected = dangerText) => {
    expect(tagAround(read(file), needle)).toContain(expected);
  });

  it("senhas nao conferem em danger-fg", () => {
    const src = read("components/auth/update-password-form.tsx");
    const i = src.indexOf('t("auth.signup.passwordsDontMatch")');
    expect(src.slice(src.lastIndexOf("<span", i), i)).toContain(dangerText);
  });

  // I-04: apagar e retirar abrem a mesma janela de perigo (ConfirmActionDialog,
  // vermelho cheio); os dois botões do cartão são o variant="danger".
  it("confirmar exclusao do curso usa a janela de perigo, nao button-accent", () => {
    const src = read("components/admin/managed-course-panel.tsx");
    expect(src).not.toContain("button-accent");
    expect(src.match(/variant="danger"/g)?.length).toBe(2);
    expect(src.match(/<ConfirmActionDialog/g)?.length).toBe(2);
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
    // O 404 usa o mesmo olho (F-17): era latao, a pagina de erro era navy.
    const eyebrowClass = (file: string, key: string) => tagAround(read(file), key).match(/className="([^"]*)"/)?.[1];
    expect(eyebrowClass("app/not-found.tsx", "publicPages.notFound.eyebrow")).toBe(
      eyebrowClass("app/error.tsx", "appErrors.eyebrow"),
    );
    expect(eyebrowClass("app/not-found.tsx", "publicPages.notFound.eyebrow")).toContain("--color-primary");
    const row = read("components/account/notification-row.tsx");
    expect(row).toMatch(/live_event: "[^"]*text-\[var\(--color-danger-fg\)\]"/);
  });
});

describe("Plausivel 5: botao-texto com pelo menos 24px de area", () => {
  it.each([
    // O "Email me a reset link" da Seguranca passou a 44px e 14px.
    ["components/account/security-settings-panel.tsx", "min-h-11 text-sm font-bold"],
    // Copiar, Cancelar do 2FA e "Request a refund" viraram botões do sistema
    // (.button-outline: 44px), acima do mínimo de 24px que este teste guarda.
    ["components/account/totp-mfa-section.tsx", "button-outline shrink-0 px-3 py-2 text-xs"],
    // O Cancelar do 2FA foi ao rodapé da casa, no tamanho dos outros (14px).
    ["components/account/totp-mfa-section.tsx", "button-outline min-h-11 px-4 py-2.5 text-sm"],
    ["components/account/billing-tabs.tsx", "button-outline px-3 py-2 text-xs"],
    // O Pin saiu do cabecalho do cartao (PR #505) e mora nas acoes, com 44px.
    ["components/learn/community-item-actions.tsx", "min-h-11 rounded-md px-3 text-xs font-semibold"],
    ["components/auth/signup-form.tsx", "inline-flex min-h-6 items-center"],
  ])("%s tem %s", (file, snippet) => {
    expect(read(file)).toContain(snippet);
  });

  // Subiram de 24px para o piso de 44px: sao botoes de apagar no toque.
  it("os dois Remover do editor de landing tem min-h-11", () => {
    const hits = read("components/teacher/course-landing-editor.tsx").match(/"min-h-11 justify-self-start/g);
    expect(hits).toHaveLength(2);
  });
});

describe("Plausivel 6: rolagem em JS respeita reduzir movimento", () => {
  it.each([
    "components/auth/reset-password-form.tsx",
    "components/learn/course-unlock-modal.tsx",
    "components/learn/enrolled-course-workspace.tsx",
  ])("%s usa scrollBehavior()", (file) => {
    const src = read(file);
    expect(src).toContain("scrollBehavior()");
    expect(src).not.toMatch(/behavior: "smooth"/);
  });

  // A Seguranca deixou de rolar: cada resposta nasce logo abaixo do botao que
  // a pediu, entao nao ha rolagem para respeitar (nem para voltar sem freio).
  it("components/account/security-settings-panel.tsx nao rola a pagina", () => {
    expect(read("components/account/security-settings-panel.tsx")).not.toContain("scrollIntoView");
  });
});
