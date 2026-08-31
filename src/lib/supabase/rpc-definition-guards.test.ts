import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Guardas sobre a definição EFETIVA de funções Postgres que decidem dinheiro e
 * abuso. Vieram da auditoria de 2026-08-30 (achados A-02 e DB-01), onde viviam
 * numa suíte fora de `src/` que nenhuma automação executava — o CI coleta só
 * `src/**\/*.test.{ts,tsx}`, então elas provavam algo que ninguém via.
 *
 * Por que ler SQL em vez de chamar a função: o que estas duas provam é sobre a
 * regra escrita na migration, e os smoke tests que rodam de verdade contra um
 * banco (supabase/tests/) dependem de `STAGING_DATABASE_URL`, que não existe em
 * todo PR. Isto é o portão que roda sempre; não substitui o que roda no banco.
 */
const RAIZ = process.cwd();

/**
 * Corpo da ÚLTIMA definição de uma função na cadeia de migrations.
 *
 * `create or replace` faz da migration mais recente a verdade. Olhar o arquivo
 * onde a função nasceu daria um vermelho eterno mesmo depois do conserto,
 * porque migration antiga não se edita — se substitui.
 */
function definicaoEfetiva(nomeDaFuncao: string): string {
  const pasta = "supabase/migrations";
  const marcador = `function public.${nomeDaFuncao}`;
  const arquivos = readdirSync(join(RAIZ, pasta))
    .filter((arquivo) => arquivo.endsWith(".sql"))
    .sort(); // nomes começam com data, então ordem alfabética = cronológica

  let ultimo: string | null = null;

  for (const arquivo of arquivos) {
    const texto = readFileSync(join(RAIZ, pasta, arquivo), "utf8");
    const inicio = texto.indexOf(marcador);

    if (inicio === -1) continue;

    const abre = texto.indexOf("$function$", inicio);
    const fecha = texto.indexOf("$function$", abre + 1);
    ultimo = texto.slice(inicio, fecha === -1 ? undefined : fecha);
  }

  expect(ultimo, `nenhuma migration define ${nomeDaFuncao}`).not.toBeNull();
  return ultimo as string;
}

describe("create_free_course_enrollment — matrícula grátis e oferta paga", () => {
  // O bug (A-02): a função decidia se o curso era grátis olhando só as colunas
  // legadas de `courses` (payment_type e price_amount_minor). Uma oferta paga
  // criada com isDefault=false — o caminho de upsell que product_offers existe
  // para suportar — não atualiza essas colunas. O curso cobrava 497 no checkout
  // e era entregue de graça por uma chamada RPC de uma linha.
  const corpo = definicaoEfetiva("create_free_course_enrollment");

  it("consulta product_offers antes de liberar o curso", () => {
    expect(corpo).toMatch(/product_offers/);
  });

  it("não decide o preço apenas pelas colunas legadas de courses", () => {
    const soLegado =
      /payment_type\s*=\s*'free'/.test(corpo)
      && /price_amount_minor/.test(corpo)
      && !/product_offers|product_prices/.test(corpo);

    expect(
      soLegado,
      "o portão de preço voltou a ser só payment_type + price_amount_minor: "
        + "uma oferta paga não-default entrega o curso de graça",
    ).toBe(false);
  });
});

describe("verify_skillset_certificate — o balde do limite de tentativas", () => {
  // O bug (DB-01): a chave do limite era coalesce(auth.uid(), p_rate_key,
  // 'anon'). Para quem não está logado, auth.uid() é nulo e a chave passa a ser
  // um parâmetro que o próprio chamador manda — um valor novo a cada requisição
  // dá um balde novo a cada requisição. Pior: cada chave inédita INSERE uma
  // linha permanente em rate_limits, que não tem limpeza. O mecanismo
  // anti-abuso vira o vetor de abuso.
  const corpo = definicaoEfetiva("verify_skillset_certificate");

  it("não usa a chave do chamador crua: o espaço de chaves é limitado", () => {
    const usaCrua =
      /coalesce\(\s*\(?\s*select auth\.uid\(\)[\s\S]{0,120}p_rate_key/i.test(corpo)
      && !/md5\(|hashtext\(|substr\(/i.test(corpo);

    expect(
      usaCrua,
      "a chave cai em p_rate_key quando auth.uid() é nulo, sem limitar o espaço — "
        + "o anônimo escolhe o próprio balde e cada balde novo grava uma linha permanente",
    ).toBe(false);
  });

  it("quem está logado tem balde pela identidade que a plataforma emitiu", () => {
    expect(corpo).toMatch(/auth\.uid\(\)/);
  });
});
