/**
 * PROVAS DOS 3 ACHADOS CRÍTICOS — auditoria de 2026-08-30.
 *
 * Estes testes são deliberadamente VERMELHOS. Cada um afirma o comportamento
 * que a plataforma deveria ter; enquanto o bug existir, ele falha. Quando o bug
 * for corrigido, ele passa e vira teste de regressão de verdade — aí mova-o
 * para junto do código que exercita, dentro de `src/`.
 *
 * Rodar:
 *   npx vitest run --config .auditoria-2026-08-30/vitest.provas.config.ts
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { decideHostRoute } from "@/domain/host-routing";

const RAIZ = process.cwd();
const leia = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");

/**
 * Corpo da ÚLTIMA definição de uma função Postgres na cadeia de migrations.
 *
 * `create or replace` faz da migration mais recente a verdade; olhar o arquivo
 * onde a função nasceu daria um vermelho eterno mesmo depois do conserto,
 * porque migration antiga não se edita.
 */
export function definicaoEfetiva(nomeDaFuncao: string): string {
  const pasta = "supabase/migrations";
  const marcador = `function public.${nomeDaFuncao}`;
  const arquivos = readdirSync(join(RAIZ, pasta))
    .filter((f) => f.endsWith(".sql"))
    .sort(); // nomes começam com data, então ordem alfabética = cronológica

  let ultimo: string | null = null;
  for (const arquivo of arquivos) {
    const texto = leia(join(pasta, arquivo));
    const inicio = texto.indexOf(marcador);
    if (inicio === -1) continue;
    const abre = texto.indexOf("$function$", inicio);
    const fecha = texto.indexOf("$function$", abre + 1);
    ultimo = texto.slice(inicio, fecha === -1 ? undefined : fecha);
  }

  expect(ultimo, `nenhuma migration define ${nomeDaFuncao}`).not.toBeNull();
  return ultimo as string;
}

describe("A-01 · domínio de professor não pode servir a tela de login", () => {
  // O cabeçalho de src/domain/host-routing.ts declara esta regra como "a
  // fronteira de segurança desta feature inteira", e explica o ataque: o
  // professor deixa o domínio caducar, outra pessoa registra o nome, e o
  // certificado da plataforma responde por ele. Se a tela de login já tiver
  // sido servida ali, o novo dono herda um coletor de credenciais perfeito.
  //
  // O furo: quando o host NÃO resolve para um professor, a função devolve
  // "pass" — servir a plataforma inteira. E um domínio fica exatamente nesse
  // estado entre ser anexado ao projeto da Vercel (que a rota faz de imediato,
  // sem esperar prova de posse) e ser verificado; e de novo depois de
  // desanexado, se a chamada de remoção falhar.

  const naoEhAPlataforma = {
    hostname: "dominio-de-um-professor.com",
    resolvedUid: null, // ainda não verificado, ou já desanexado
    search: "",
  };

  it("não serve /login num host que não é o da plataforma", () => {
    const decisao = decideHostRoute({ ...naoEhAPlataforma, pathname: "/login" });
    expect(decisao.kind).not.toBe("pass");
  });

  it("não serve /signup num host que não é o da plataforma", () => {
    const decisao = decideHostRoute({ ...naoEhAPlataforma, pathname: "/signup" });
    expect(decisao.kind).not.toBe("pass");
  });

  it("não serve /account num host que não é o da plataforma", () => {
    const decisao = decideHostRoute({ ...naoEhAPlataforma, pathname: "/account" });
    expect(decisao.kind).not.toBe("pass");
  });

  it("continua servindo normalmente o host da própria plataforma", () => {
    // Este passa hoje e tem de continuar passando depois da correção: a função
    // precisa aprender a diferença entre "host desconhecido" e "meu host", não
    // simplesmente parar de devolver pass.
    const decisao = decideHostRoute({
      hostname: "skillsetmind.com",
      pathname: "/login",
      search: "",
      resolvedUid: null,
    });
    expect(decisao.kind).toBe("pass");
  });
});

describe("A-02 · matrícula grátis não pode liberar curso que tem oferta paga", () => {
  // create_free_course_enrollment decide se o curso é grátis olhando SÓ as
  // colunas legadas de `courses` (payment_type e price_amount_minor). Uma oferta
  // paga criada com isDefault=false — o caminho de upsell que product_offers
  // existe para suportar — não atualiza essas colunas. O curso cobra 497 no
  // checkout e é entregue de graça por uma chamada RPC de uma linha.
  // Olha a definição EFETIVA: a última migration (por ordem de nome, que é
  // cronológica aqui) que declara a função. Assertar contra o arquivo histórico
  // daria vermelho para sempre mesmo depois de corrigido — migration antiga não
  // se edita, se substitui.
  const corpo = definicaoEfetiva("create_free_course_enrollment");

  it("consulta product_offers antes de liberar o curso", () => {
    expect(corpo).toMatch(/product_offers/);
  });

  it("não decide o preço apenas pelas colunas legadas de courses", () => {
    const soLegado =
      /payment_type\s*=\s*'free'/.test(corpo) &&
      /price_amount_minor/.test(corpo) &&
      !/product_offers|product_prices/.test(corpo);
    expect(soLegado, "o portão de preço ainda é só payment_type + price_amount_minor").toBe(false);
  });
});

describe("A-03 · os testes de RLS precisam ser executados por alguma automação", () => {
  // Existem 4 arquivos de smoke test de RLS em supabase/tests/. Um deles prova
  // que ninguém consegue setar o próprio activation_fee_paid_at, ou seja, que
  // ninguém vira criador ativado sem pagar. Nenhum comando do repositório os
  // executa: o vitest só coleta src/, e o CI roda lint, tsc, vitest e build.
  // Uma regressão de policy passa por todos os portões verdes.
  const packageJson = leia("package.json");
  const ci = leia(".github/workflows/ci.yml");
  const vitestConfig = leia("vitest.config.ts");

  it("alguma automação do repositório executa os testes de supabase/tests/", () => {
    // Três caminhos aceitáveis; basta UM. O requisito é que exista automação,
    // não que exista um mecanismo específico. (A primeira versão deste teste
    // cobrava os três e deixava dois vermelhos por desenho — teste que não
    // consegue ficar verde não é requisito, é ruído.)
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
