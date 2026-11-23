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
    // Ganhos: a caixa do topo e a frase vermelha do bloco da conta.
    "components/teacher/teacher-wallet-panel.tsx",
    // Frases vermelhas soltas que viraram o aviso da casa.
    "components/teacher/activation-checkout-panel.tsx",
    "components/teacher/custom-domains-panel.tsx",
    // Os dois chips de falha do salvar do construtor e a capa da área de membros.
    "components/teacher/course-builder-studio.tsx",
    "components/teacher/member-area-settings-panel.tsx",
    // Compra: sem conta, a página de obrigado e o erro do checkout embutido.
    "components/courses/guest-checkout-form.tsx",
    "components/courses/guest-access-link.tsx",
    "components/account/embedded-checkout-panel.tsx",
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

  // A barra do topo da sala, a da capa e a da nota de envio eram feitas à mão
  // (a da nota em 8px navy): agora são a ProgressBar compartilhada.
  it.each([
    "components/learn/enrolled-course-workspace.tsx",
    "components/learn/members-area-hero.tsx",
    "components/teacher/upload-progress-note.tsx",
  ])("%s usa a barra compartilhada", (file) => {
    const source = read(file);
    expect(source).toContain("<ProgressBar");
    expect(source).not.toMatch(/style=\{\{ width: `\$\{/);
  });

  it("o CSS das barras feitas à mão saiu (preenchimento da sala, da capa e do cartão de módulo)", () => {
    const css = read("app/globals.css");
    expect(css).not.toContain(".member-classroom-head__progress > span");
    expect(css).not.toContain(".members-hero__bar > span");
    expect(css).not.toContain("member-module-card__bar");
  });
});

describe("F-03 / I-3: esperas com forma, e as rotas que respondem na hora", () => {
  it("a área de membros responde na hora com o próprio esqueleto", () => {
    expect(existsSync(join(process.cwd(), "src", "app/learn/areas/[criador]/loading.tsx"))).toBe(true);
    expect(read("app/learn/areas/[criador]/loading.tsx")).toContain("<MemberAreaHomeSkeleton");
  });

  // /teach/activate e a volta do Stripe respondem 307 no servidor quando não
  // há o que pagar; um loading.tsx mandaria a moldura antes (200) e o desvio
  // viraria um pulo no navegador, na página para onde o Stripe devolve.
  it.each(["app/teach/activate/loading.tsx", "app/teach/activate/return/loading.tsx"])("%s não existe", (file) => {
    expect(existsSync(join(process.cwd(), "src", file))).toBe(false);
  });

  // Comunidade (duas frases seguidas), favoritos, materiais e ranking esperavam
  // com uma frase solta: agora a forma do que vem, e a frase só para o leitor.
  it.each([
    ["components/learn/community-feed.tsx", "learn.community.loading"],
    ["components/learn/community-feed.tsx", "learn.community.feedLoading"],
    ["components/learn/learner-wishlist.tsx", "learnWave2.wishlistHub.loading"],
    ["components/learn/course-materials-panel.tsx", "learn.classroom.resources.loading"],
    ["components/learn/community-leaderboard.tsx", "learnWave2.leaderboard.loading"],
  ])("%s espera com forma (%s só para o leitor de tela)", (file, key) => {
    const source = read(file);
    const sentence = source.indexOf(`t("${key}")`);
    expect(sentence, key).toBeGreaterThan(-1);
    // A frase mora num sr-only (direto, ou como `label` de um esqueleto da tela).
    expect(source.slice(Math.max(0, sentence - 120), sentence)).toMatch(/sr-only|label=\{$/);
  });

  it("a caixa de mensagens do aluno não espera em branco", () => {
    expect(read("app/learn/messages/page.tsx")).not.toContain("fallback={null}");
  });

  it.each(["tabs", "title"] as const)("a lista de cartões (%s): um aviso, sem título nem botão", (head) => {
    render(<CardListSkeleton label="Loading credentials..." head={head} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading credentials...");
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("I-2: um anel da casa, que para quem pediu menos movimento", () => {
  it("o anel compartilhado tem trilho que aparece no tema escuro e gira só em no-preference", () => {
    const source = read("components/shared/skillset-spinner.tsx");
    // O navy a 12% fixo sumia no fundo escuro, na espera de toda página protegida.
    expect(source).not.toContain("rgba(26,54,93,0.12)");
    expect(source).toContain("border-[var(--color-line)] border-t-[var(--color-accent-fg)] motion-safe:animate-spin");
  });

  it("a volta do pagamento usa o anel da casa, sem cópia à mão", () => {
    const source = read("components/account/billing-return-status.tsx");
    expect(source).toContain('<SpinnerRing size="sm" />');
    expect(source).not.toMatch(/rounded-full border-2[^"]*animate-spin/);
  });

  // Sem `motion-safe:` o anel girava mesmo com "reduzir movimento" ligado.
  it.each(["components/ui/button.tsx", "components/shared/protected-asset-preview.tsx", "components/shared/skillset-spinner.tsx", "components/account/billing-return-status.tsx"])(
    "%s não gira sem motion-safe",
    (file) => {
      expect(read(file)).not.toMatch(/(?<!motion-safe:)\banimate-spin/);
    },
  );
});

describe("F-19: um tom só nos blocos de espera", () => {
  it.each([
    "app/auth/page.tsx",
    "components/learn/learn-dashboard.tsx",
    "components/teacher/teacher-members-area-hub.tsx",
    "components/teacher/teacher-inbox-questions.tsx",
    "components/teacher/teacher-messages-inbox.tsx",
    // Sobras: a busca do catálogo, as mensagens do aluno e o diretório de
    // professores (que pulsava um cartão branco com sombra).
    "app/courses/page.tsx",
    "app/learn/messages/page.tsx",
    "components/learn/student-messages-inbox.tsx",
    "components/instructors/instructors-directory.tsx",
    // O extrato de Ganhos, o bloco da conta e as renovações esperavam com uma frase.
    "components/teacher/teacher-wallet-panel.tsx",
    "components/teacher/creator-subscription-center.tsx",
  ])("%s pinta o osso em surface-strong", (file) => {
    const source = read(file);
    expect(source).not.toMatch(/animate-pulse[^"]*bg-\[var\(--color-surface-soft\)\]/);
    expect(source).not.toMatch(/animate-pulse[^"]*bg-white/);
    expect(source).toMatch(/animate-pulse[^"]*bg-\[var\(--color-surface-strong\)\]/);
  });

  // As linhas da lista de produtos pulsavam em surface-soft (F-19). Ali os
  // blocos usam a constante `block`, por isso a prova é a constante.
  it("components/teacher/builder-skeleton.tsx pinta o osso em surface-strong", () => {
    const source = read("components/teacher/builder-skeleton.tsx");
    expect(source).not.toMatch(/animate-pulse[^"]*bg-\[var\(--color-surface-soft\)\]/);
    expect(source).toContain('const block = "bg-[var(--color-surface-strong)]";');
  });
});

describe("F-03 / T-07: Vitrine, Mídia e Eventos esperam com a forma da tela", () => {
  it.each([
    ["components/teacher/storefront-settings-panel.tsx", 'data-skeleton="storefront"'],
    ["components/teacher/teacher-media-library.tsx", "<CardStackSkeleton"],
    ["components/teacher/teacher-event-studio.tsx", "<CardStackSkeleton"],
  ])("%s não espera com uma frase num cartão", (file, skeleton) => {
    expect(read(file)).toContain(skeleton);
  });
});
