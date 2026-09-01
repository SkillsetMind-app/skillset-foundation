import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Guarda sobre as POLÍTICAS RLS efetivas, irmã de `rpc-definition-guards`.
 *
 * A regra que ela prova já existia em SQL, no fim de
 * 20260809080000_enrollment_status_rls.sql: nenhuma política pode consultar
 * `enrollments` sem consultar o status junto — a linha nunca é apagada, só muda
 * de status, então "existe matrícula" não é a mesma pergunta que "a matrícula
 * ainda dá direito".
 *
 * Ela está aqui em TypeScript por dois motivos. O primeiro é que a versão SQL
 * roda uma vez, no dia em que a migration é aplicada; esta roda em todo PR. O
 * segundo é o que a auditoria de hoje encontrou: aquela guarda lia só
 * `pg_get_expr(p.polqual, ...)`, a cláusula USING. Política de INSERT não tem
 * USING — o predicado dela vive em WITH CHECK —, então a guarda deu verde no
 * mesmo dia em que `lesson_comments_insert` ficou para trás, e no dia seguinte
 * deixou passar `member_stats_select_authenticated`.
 *
 * O critério é de texto, não de semântica: prova que o status foi consultado,
 * não que foi consultado no lugar certo. É de propósito — o que ele pega é o
 * esquecimento, que é como as três violações desta série nasceram.
 */
const RAIZ = process.cwd();

/** Devolve o histórico do PRÓPRIO usuário: é dele com matrícula viva ou morta. */
const EXCECOES = new Set(["lesson_progress_select_owner"]);

type Politica = { tabela: string; corpo: string; arquivo: string };

function arquivosSql(pasta: string): string[] {
  return readdirSync(join(RAIZ, pasta))
    .filter((arquivo) => arquivo.endsWith(".sql"))
    .sort() // nomes começam com data, então ordem alfabética = cronológica
    .map((arquivo) => join(pasta, arquivo));
}

/**
 * Última definição de cada política na cadeia. `create policy` é sempre
 * precedido de `drop policy if exists`, então a migration mais recente é a
 * verdade — olhar onde a política nasceu daria vermelho eterno depois do
 * conserto, porque migration antiga não se edita, se substitui.
 */
function politicasEfetivas(): Map<string, Politica> {
  const efetivas = new Map<string, Politica>();
  const arquivos = [...arquivosSql("supabase/schema"), ...arquivosSql("supabase/migrations")];

  for (const arquivo of arquivos) {
    const texto = readFileSync(join(RAIZ, arquivo), "utf8");
    const definicoes = texto.matchAll(
      /create\s+policy\s+"?([a-z0-9_]+)"?\s+on\s+"?([a-z0-9_."]+)"?([\s\S]*?);/gi,
    );

    for (const [, nome, tabela, corpo] of definicoes) {
      efetivas.set(nome.toLowerCase(), {
        tabela: tabela.replace(/"/g, ""),
        corpo,
        arquivo,
      });
    }
  }

  return efetivas;
}

describe("políticas RLS que leem enrollments", () => {
  const efetivas = politicasEfetivas();

  it("encontra as políticas do repositório", () => {
    // Sem isto, um regex quebrado deixaria o teste abaixo verde por não ter
    // olhado para nada — o modo de falha mais silencioso que este arquivo tem.
    expect(efetivas.size).toBeGreaterThan(100);
  });

  it("checa o status da matrícula em toda política que a consulta", () => {
    const infratoras = [...efetivas.entries()]
      .filter(([nome, { corpo }]) => {
        if (EXCECOES.has(nome)) return false;
        return /\benrollments\b/i.test(corpo) && !/e\.status/i.test(corpo);
      })
      .map(([nome, { tabela, arquivo }]) => `${tabela}.${nome} (${arquivo})`);

    expect(
      infratoras,
      "Estas políticas liberam acesso porque a linha de matrícula EXISTE, não "
        + "porque ela ainda dá direito. Um aluno reembolsado, revogado ou "
        + "expirado passa por elas. Some `and e.status = any (array['active', "
        + "'completed'])` ao EXISTS, ou justifique a exceção em EXCECOES:\n  "
        + infratoras.join("\n  "),
    ).toEqual([]);
  });

  it("mantém a guarda SQL enxergando também o WITH CHECK", () => {
    // A guarda em SQL é a que roda contra o banco de verdade. Enquanto ela lia
    // só `polqual`, era cega para toda política de INSERT — o furo que esta
    // série de correções fechou. Se alguém a reescrever sem `polwithcheck`, o
    // ponto cego volta e este arquivo passa a ser a única defesa.
    const guardas = arquivosSql("supabase/migrations")
      .map((arquivo) => readFileSync(join(RAIZ, arquivo), "utf8"))
      .filter((texto) => texto.includes("polqual"));

    expect(guardas.length).toBeGreaterThan(0);
    expect(guardas.at(-1)).toMatch(/polwithcheck/);
  });
});
