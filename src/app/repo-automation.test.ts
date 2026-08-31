import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Guardas sobre a automação do próprio repositório: portões que passam verdes
 * sem inspecionar nada são piores que portões ausentes, porque compram
 * confiança sem entregar cobertura.
 *
 * Vieram da auditoria de 2026-08-30 (A-03, A-18, A-10), onde viviam numa suíte
 * fora de `src/` que nenhuma automação executava — a mesma doença que elas
 * diagnosticam.
 */
const RAIZ = process.cwd();
const leia = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");

describe("os smoke tests de RLS precisam ser executados por alguma automação", () => {
  // O bug (A-03): existem 4 arquivos de smoke test de RLS em supabase/tests/.
  // Um deles prova que ninguém consegue setar o próprio activation_fee_paid_at,
  // ou seja, que ninguém vira criador ativado sem pagar. Nenhum comando do
  // repositório os executava: o vitest coleta só src/, e o CI rodava lint, tsc,
  // vitest e build. Uma regressão de policy passava por todos os portões verdes.
  const packageJson = leia("package.json");
  const ci = leia(".github/workflows/ci.yml");
  const vitestConfig = leia("vitest.config.ts");

  it("alguma automação do repositório executa os testes de supabase/tests/", () => {
    // Três caminhos aceitáveis; basta UM. O requisito é que exista automação,
    // não que exista um mecanismo específico.
    const roda = /supabase\s+test|pgtap|pg_prove|supabase\/tests/;
    const scripts = JSON.parse(packageJson).scripts as Record<string, string>;

    const porScript = Object.values(scripts).some((cmd) => roda.test(cmd));
    const porCi = roda.test(ci);
    const porVitest = /supabase\/tests/.test(vitestConfig);

    expect(
      porScript || porCi || porVitest,
      `nenhum caminho executa os testes de RLS. scripts: ${Object.keys(scripts).join(", ")}`,
    ).toBe(true);
  });

  it("o CI torna a lacuna visível quando os testes de banco não podem rodar", () => {
    // Sem banco de staging configurado eles não rodam — e isso precisa APARECER
    // em cada execução, em vez de o pipeline ficar verde fingindo cobertura.
    const avisa = /::warning/.test(ci) && /RLS|supabase\/tests/.test(ci);

    expect(avisa, "o CI passa calado quando os testes de RLS não rodam").toBe(true);
  });
});

describe("o scan de segredos precisa varrer alguma coisa", () => {
  // O bug (A-18): o TruffleHog recebia `base: <default_branch>` e nenhum `head`.
  // Num push para main, base e head são o mesmo commit: o intervalo é vazio,
  // zero commits são inspecionados, e o job termina verde. O mesmo valia para o
  // cron de domingo, que o arquivo chama de "weekly full history secret scan".
  const wf = leia(".github/workflows/security.yml");

  it("não faz uma varredura de intervalo vazio no push para main e no cron", () => {
    const temBase = /^\s*base:/m.test(wf);
    const temHead = /^\s*head:/m.test(wf);

    // Duas saídas corretas: ou o base some (varredura completa), ou vem
    // acompanhado de um head que o torna um intervalo real.
    expect(
      !temBase || temHead,
      "há `base:` sem `head:` — em push/cron o intervalo é main..main, ou seja, nada",
    ).toBe(true);
  });

  it("a varredura semanal cobre o histórico, como o arquivo promete", () => {
    const prometeHistorico = /full history/i.test(wf);
    expect(
      prometeHistorico,
      "premissa do teste: o arquivo promete varrer o histórico",
    ).toBe(true);

    const baseFixo =
      /base:\s*\$\{\{\s*github\.event\.repository\.default_branch\s*\}\}/.test(wf);
    expect(
      baseFixo,
      "o base fixo no branch padrão anula a varredura de histórico",
    ).toBe(false);
  });
});

describe("HSTS com preload não pode vazar para o domínio do professor", () => {
  // O bug (A-10): o header saía em `source: "/:path*"`, sem condição de host.
  // Como a plataforma serve domínios de terceiros (#105), ela instruía o
  // navegador a forçar HTTPS por 2 anos em TODOS os subdomínios do professor e a
  // submeter o nome dele à lista de preload — um efeito sobre um domínio que não
  // é nosso, que o dono não pediu, e que ele não consegue desfazer rápido.
  const cfg = leia("next.config.ts");

  it("o HSTS abrangente só é enviado no host da própria plataforma", () => {
    const indice = cfg.indexOf("Strict-Transport-Security");
    expect(indice, "next.config.ts não define Strict-Transport-Security").toBeGreaterThan(-1);

    const bloco = cfg.slice(Math.max(0, indice - 900), indice + 300);

    expect(/preload/.test(bloco), "premissa do teste: o header inclui preload").toBe(true);

    // Next permite condicionar header por host com `has: [{ type: "host" }]`.
    const condicionadoPorHost = /has:\s*\[/.test(bloco) && /type:\s*"host"/.test(bloco);

    expect(
      condicionadoPorHost,
      "o header sai sem nenhuma condição de host: o preload vaza para o domínio do professor",
    ).toBe(true);
  });
});
