/**
 * PROVAS de achados de dinheiro, cabeçalho e CI — auditoria de 2026-08-30.
 * Deliberadamente VERMELHOS. Ver o cabeçalho de criticos.test.ts.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { definicaoEfetiva } from "./criticos.test";

const RAIZ = process.cwd();
const leia = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");

describe("A-17 · a moeda da oferta precisa ser validada", () => {
  // A rota valida amountMinor (inteiro, não-negativo) e paymentType (lista
  // fechada). A moeda passa direto: String(body.currency ?? "USD").toUpperCase().
  // Qualquer sigla de 3 letras entra e vira o código enviado ao Stripe.
  const rota = leia("src/app/api/teach/offers/route.ts");

  it("valida a moeda contra uma lista, como já faz com paymentType", () => {
    // paymentType tem lista fechada logo abaixo — a moeda deveria ter a dela.
    const validaPaymentType = /\["one_time",\s*"subscription_monthly"/.test(rota);
    expect(validaPaymentType, "premissa do teste: paymentType é validado por lista").toBe(true);

    // Procurar a MECÂNICA da validação, não a palavra "currency" — o arquivo a
    // usa 7 vezes sem validar nada. (Minha primeira versão deste teste usava
    // /CURRENCY/i e passava por casar com a própria variável: passou pelo motivo
    // errado, que é pior do que falhar.)
    const validaMoeda =
      /isSupportedStripeCurrency\(/.test(rota) ||       // validador que o repo já tem
      /includes\(\s*currency\s*\)/.test(rota) ||        // LISTA.includes(currency)
      /currency\s*\)\s*\)?\s*(===|!==)/.test(rota) ||   // comparação direta
      /currency:\s*z\.(enum|literal)/.test(rota);       // schema com enum
    expect(validaMoeda, "nenhuma validação de moeda encontrada na rota").toBe(true);
  });
});

describe("A-18 · o scan de segredos precisa varrer alguma coisa", () => {
  // O TruffleHog recebe `base: <default_branch>` e nenhum `head`. Num push para
  // main, base e head são o mesmo commit: o intervalo é vazio, zero commits são
  // inspecionados, e o job termina verde. O mesmo vale para o cron de domingo,
  // que o comentário do arquivo chama de "weekly full history secret scan".
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

  it("a varredura semanal cobre o histórico, como o comentário promete", () => {
    const prometeHistorico = /full history/i.test(wf);
    expect(prometeHistorico, "premissa do teste: o arquivo promete varrer o histórico").toBe(true);
    // Varredura de histórico não pode ser limitada por um base fixo.
    const baseFixo = /base:\s*\$\{\{\s*github\.event\.repository\.default_branch\s*\}\}/.test(wf);
    expect(baseFixo, "o base fixo no branch padrão anula a varredura de histórico").toBe(false);
  });
});

describe("A-10 · HSTS com preload não pode vazar para o domínio do professor", () => {
  // O header vai em `source: "/:path*"`, sem condição de host. Como a plataforma
  // agora serve domínios de terceiros (PR #105), ela instrui o navegador a
  // forçar HTTPS por 2 anos em TODOS os subdomínios do professor e a submeter o
  // nome dele à lista de preload — um efeito sobre um domínio que não é nosso e
  // que o dono não pediu, e que ele não consegue desfazer rápido.
  const cfg = leia("next.config.ts");

  it("o HSTS abrangente só é enviado no host da própria plataforma", () => {
    const blocoHsts = cfg.slice(
      Math.max(0, cfg.indexOf("Strict-Transport-Security") - 900),
      cfg.indexOf("Strict-Transport-Security") + 300,
    );
    const temPreload = /preload/.test(blocoHsts);
    expect(temPreload, "premissa do teste: o header inclui preload").toBe(true);

    // Next permite condicionar header por host com `has: [{ type: "host" }]`.
    const condicionadoPorHost = /has:\s*\[/.test(blocoHsts) && /type:\s*"host"/.test(blocoHsts);
    expect(
      condicionadoPorHost,
      "o header sai em /:path* sem nenhuma condição de host",
    ).toBe(true);
  });
});

describe("DB-01 · o limite de tentativas não pode usar chave escolhida pelo chamador", () => {
  // verify_skillset_certificate monta a chave do limite com
  // coalesce(auth.uid(), p_rate_key, 'anon'). Para quem não está logado,
  // auth.uid() é nulo e a chave passa a ser um parâmetro que o próprio chamador
  // manda: um valor novo a cada requisição dá um balde novo a cada requisição.
  // Pior: cada chave inédita INSERE uma linha permanente em rate_limits, que não
  // tem limpeza. O mecanismo anti-abuso vira o vetor de abuso.
  const corpo = definicaoEfetiva("verify_skillset_certificate");

  it("não usa a chave do chamador crua: o espaço de chaves é limitado", () => {
    const usaCrua =
      /coalesce\(\s*\(?\s*select auth\.uid\(\)[\s\S]{0,120}p_rate_key/i.test(corpo) &&
      !/md5\(|hashtext\(|substr\(/i.test(corpo);
    expect(
      usaCrua,
      "a chave cai em p_rate_key quando auth.uid() é nulo, sem limitar o espaço — " +
        "o anônimo escolhe o próprio balde e cada balde novo grava uma linha permanente",
    ).toBe(false);
  });

  it("quem está logado tem balde pela identidade que a plataforma emitiu", () => {
    expect(corpo).toMatch(/auth\.uid\(\)/);
  });
});
