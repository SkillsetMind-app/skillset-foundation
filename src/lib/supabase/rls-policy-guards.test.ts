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
 * A cegueira seguinte foi do próprio regex: ele só casava `create policy`, e
 * política redefinida por `alter policy` ficava invisível. No PR #253,
 * `courses_delete_owner` foi reescrita assim lendo `enrollments` sem status,
 * esta guarda deu verde e só o smoke contra o banco pegou — exatamente o caso
 * em que ela deveria ter falado primeiro.
 *
 * O critério é de texto, não de semântica: prova que o status foi consultado,
 * não que foi consultado no lugar certo. É de propósito — o que ele pega é o
 * esquecimento, que é como as três violações desta série nasceram.
 */
const RAIZ = process.cwd();

/**
 * Exceções documentadas. A lista tem de ser a mesma do smoke contra o banco
 * (supabase/tests/20260901180000_dead_enrollments_lose_the_classroom_smoke.sql);
 * o teste "tem a mesma lista de exceções" prova.
 *
 * - lesson_progress_select_owner: devolve o histórico do PRÓPRIO usuário, que é
 *   dele com matrícula viva ou morta.
 * - courses_delete_owner: única política de DELETE, e nela a pergunta é a
 *   inversa — consulta `enrollments` num NOT EXISTS para RECUSAR, não para
 *   liberar. Matrícula reembolsada, revogada ou expirada continua sendo
 *   registro do aluno, e `enrollments_course_id_fkey` é RESTRICT: filtrar por
 *   status aqui ABRIRIA o buraco, um curso com matrícula morta voltaria a ser
 *   apagável. Ver 20260908120000_excluir_ou_arquivar_curso_do_professor.sql.
 */
const EXCECOES = new Set(["lesson_progress_select_owner", "courses_delete_owner"]);

type Politica = { tabela: string; corpo: string; arquivo: string };

function arquivosSql(pasta: string): string[] {
  return readdirSync(join(RAIZ, pasta))
    .filter((arquivo) => arquivo.endsWith(".sql"))
    .sort() // nomes começam com data, então ordem alfabética = cronológica
    .map((arquivo) => join(pasta, arquivo));
}

/** `create policy` e `alter policy` de UM arquivo SQL, na ordem em que aparecem. */
function definicoesDePolitica(texto: string, arquivo: string): Array<[string, Politica]> {
  const definicoes = texto.matchAll(
    /\b(?:create|alter)\s+policy\s+"?([a-z0-9_]+)"?\s+on\s+"?([a-z0-9_."]+)"?([\s\S]*?);/gi,
  );

  return [...definicoes].map(([, nome, tabela, corpo]) => [
    nome.toLowerCase(),
    { tabela: tabela.replace(/"/g, ""), corpo, arquivo },
  ]);
}

/**
 * Última definição de cada política na cadeia: `create policy` nasce, `alter
 * policy` redefine, e quem manda é a última. Olhar onde a política nasceu
 * daria vermelho eterno depois do conserto, porque migration antiga não se
 * edita, se substitui.
 *
 * O `alter policy` só troca as cláusulas que nomeia, mas aqui o texto do último
 * statement vale como corpo inteiro — a mesma simplificação de `policyEfetiva`
 * em rpc-definition-guards. Basta, porque a cláusula que ele NÃO nomeia já foi
 * julgada quando nasceu.
 */
function politicasEfetivas(): Map<string, Politica> {
  const efetivas = new Map<string, Politica>();
  const arquivos = [...arquivosSql("supabase/schema"), ...arquivosSql("supabase/migrations")];

  for (const arquivo of arquivos) {
    const texto = readFileSync(join(RAIZ, arquivo), "utf8");
    for (const [nome, politica] of definicoesDePolitica(texto, arquivo)) {
      efetivas.set(nome, politica);
    }
  }

  return efetivas;
}

/** Políticas que consultam `enrollments` sem consultar o status junto. */
function politicasSemStatus(efetivas: Map<string, Politica>): string[] {
  return [...efetivas.entries()]
    .filter(([nome, { corpo }]) => {
      if (EXCECOES.has(nome)) return false;
      return /\benrollments\b/i.test(corpo) && !/e\.status/i.test(corpo);
    })
    .map(([nome, { tabela, arquivo }]) => `${tabela}.${nome} (${arquivo})`);
}

describe("políticas RLS que leem enrollments", () => {
  const efetivas = politicasEfetivas();

  it("encontra as políticas do repositório", () => {
    // Sem isto, um regex quebrado deixaria o teste abaixo verde por não ter
    // olhado para nada — o modo de falha mais silencioso que este arquivo tem.
    expect(efetivas.size).toBeGreaterThan(100);
  });

  it("checa o status da matrícula em toda política que a consulta", () => {
    const infratoras = politicasSemStatus(efetivas);

    expect(
      infratoras,
      "Estas políticas liberam acesso porque a linha de matrícula EXISTE, não "
        + "porque ela ainda dá direito. Um aluno reembolsado, revogado ou "
        + "expirado passa por elas. Some `and e.status = any (array['active', "
        + "'completed'])` ao EXISTS, ou justifique a exceção em EXCECOES:\n  "
        + infratoras.join("\n  "),
    ).toEqual([]);
  });

  it("enxerga a política redefinida por alter policy", () => {
    // O furo do PR #253: courses_delete_owner nasceu limpa e foi reescrita por
    // `alter policy` lendo enrollments sem status. O regex só via `create`, a
    // asserção acima ficou verde, e só o smoke contra o banco pegou.
    const fixture = [
      "create policy fixture_owner on public.fixture using (owner_id = auth.uid());",
      "alter policy fixture_owner on public.fixture",
      "  using (exists (select 1 from public.enrollments e where e.course_id = fixture.id));",
    ].join("\n");

    expect(politicasSemStatus(new Map(definicoesDePolitica(fixture, "fixture.sql")))).toEqual([
      "public.fixture.fixture_owner (fixture.sql)",
    ]);
  });

  it("tem a mesma lista de exceções que o smoke contra o banco", () => {
    // As duas guardas provam a mesma regra, então uma exceção que só um lado
    // conhece é um furo do outro. O smoke exclui por `p.polname <> '...'`.
    const smoke = readFileSync(
      join(RAIZ, "supabase/tests/20260901180000_dead_enrollments_lose_the_classroom_smoke.sql"),
      "utf8",
    );
    const noSmoke = [...smoke.matchAll(/p\.polname\s*<>\s*'([a-z0-9_]+)'/g)]
      .map(([, nome]) => nome);

    expect(new Set(noSmoke)).toEqual(EXCECOES);
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
