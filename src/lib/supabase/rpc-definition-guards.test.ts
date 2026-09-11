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

describe("delete_or_archive_own_course — apagar não pode virar apagar de quem pagou", () => {
  // A função é a única entrada do professor para tirar o curso do ar, e o
  // destino é decidido AQUI, não na tela: sem matrícula e sem pedido o curso
  // some; com qualquer um dos dois ele vai para 'inactive' e quem comprou
  // continua entrando. Se a ramificação de arquivar cair, a tela continua
  // dizendo "seus alunos mantêm o acesso" enquanto o curso é destruído.
  const corpo = definicaoEfetiva("delete_or_archive_own_course");

  it("conta matrículas e pedidos antes de escolher o destino", () => {
    expect(corpo).toMatch(/from\s+public\.enrollments\s+where\s+course_id/i);
    expect(corpo).toMatch(/from\s+public\.orders\s+where\s+course_id/i);
  });

  it("tem as duas ramificações: apagar só quando não há comprador", () => {
    expect(corpo).toMatch(/v_enrollments\s*=\s*0\s+and\s+v_orders\s*=\s*0/i);
    expect(corpo).toMatch(/delete\s+from\s+public\.courses/i);
    expect(corpo).toMatch(/'outcome'\s*,\s*'deleted'/i);
  });

  it("arquiva em vez de apagar quando há comprador", () => {
    expect(corpo).toMatch(/update\s+public\.courses[\s\S]*status\s*=\s*'inactive'/i);
    expect(corpo).toMatch(/'outcome'\s*,\s*'archived'/i);

    // O DELETE só pode existir dentro do galho sem comprador: se aparecer
    // depois do UPDATE de arquivar, o curso com aluno também some.
    const posicaoUpdate = corpo.search(/update\s+public\.courses/i);
    const posicaoDelete = corpo.search(/delete\s+from\s+public\.courses/i);
    expect(
      posicaoDelete < posicaoUpdate,
      "o delete de courses saiu do galho 'sem comprador'",
    ).toBe(true);
  });

  it("só o dono, com sessão forte, e sem search_path sequestrável", () => {
    expect(corpo).toMatch(/security\s+definer/i);
    expect(corpo).toMatch(/set\s+search_path\s+to\s+'public',\s*'pg_temp'/i);
    expect(corpo).toMatch(/require_strong_session\(\)/i);
    expect(corpo).toMatch(/v_owner\s*<>\s*v_uid/i);
  });
});

describe("courses_delete_owner — a tabela não pode ser a porta dos fundos", () => {
  // 'inactive' passou a ser também o estado de ARQUIVADO, ou seja, o estado de
  // um curso que TEM aluno. Sem a condição abaixo, um cliente PostgREST
  // autenticado apaga pela tabela o que a RPC se recusa a apagar.
  const corpo = policyEfetiva("courses_delete_owner");

  it("recusa DELETE de curso com matrícula ou pedido", () => {
    expect(corpo).toMatch(/not\s+exists\s*\([\s\S]*public\.enrollments/i);
    expect(corpo).toMatch(/not\s+exists\s*\([\s\S]*public\.orders/i);
  });

  it("continua exigindo o segundo fator", () => {
    // Recriar a policy do zero é a forma clássica de perder o portão que a
    // 20260902120000 instalou.
    expect(corpo).toMatch(/session_is_strong\(\)/);
  });
});

describe("arquivar preserva o acesso de quem comprou", () => {
  // É esta a promessa do modal: "everyone who bought it keeps full access".
  // Ela só se sustenta porque as duas portas do conteúdo olham a MATRÍCULA,
  // nunca o status do curso. No dia em que alguém acrescentar `c.status =
  // 'published'` a uma delas, arquivar passa a cortar o acesso de quem pagou.
  it.each(["course_assets_select", "course_content_select"])(
    "%s não olha o status do curso",
    (nome) => {
      const corpo = policyEfetiva(nome);

      expect(corpo).toMatch(/enrollments/i);
      expect(
        /c\.status|courses\.status/i.test(corpo),
        `${nome} passou a filtrar pelo status do curso: arquivar deixa de ser `
          + "reversível e derruba o aluno que já pagou",
      ).toBe(false);
    },
  );
});

/**
 * Texto de todas as migrations, em ordem, para asserções que não são sobre UMA
 * função — aqui, se o job de limpeza está de fato agendado.
 */
function textoDasMigrations(): string {
  const pasta = "supabase/migrations";
  return readdirSync(join(RAIZ, pasta))
    .filter((arquivo) => arquivo.endsWith(".sql"))
    .sort()
    .map((arquivo) => readFileSync(join(RAIZ, pasta, arquivo), "utf8"))
    .join("\n");
}

describe("purge_stale_rate_limits — a tabela rate_limits tem teto", () => {
  // O bug (DB-02): enforce_rate_limit insere uma linha para toda chave inédita
  // e nada apagava — a mais antiga em produção era de 01/07. Metade das chaves
  // vem de fora (hash do IP de visitante anônimo), então cada endereço novo era
  // uma linha para sempre: o anti-abuso como primitivo de enchimento de disco.
  const corpo = definicaoEfetiva("purge_stale_rate_limits");

  it("apaga só o que está fora de qualquer janela em uso", () => {
    expect(corpo).toMatch(/delete from public\.rate_limits/i);
    // 2 dias > 24h, a maior janela (teto diário do advisor e do assistant).
    // Encurtar isto apagaria baldes ainda em contagem e afrouxaria um limite.
    expect(corpo).toMatch(/updated_at\s*<\s*now\(\)\s*-\s*interval\s*'2 days'/i);
  });

  it("está agendada no pg_cron em vez de depender de alguém lembrar", () => {
    expect(textoDasMigrations()).toMatch(
      /cron\.schedule\(\s*'purge-stale-rate-limits'[\s\S]{0,120}purge_stale_rate_limits\(\)/,
    );
  });
});

describe("claim_custom_domain — a cota de domínios é atômica", () => {
  // O bug (A-27): a função contava os domínios do dono e inseria sem travar
  // nada no meio. Em READ COMMITTED, duas chamadas simultâneas liam o mesmo
  // count, as duas passavam pela cota e as duas inseriam — um professor em
  // starter (cota 1) ficava com N domínios pelo preço de 1, cada um anexado ao
  // projeto Vercel da plataforma. A rota diz ter delegado a cota ao SQL
  // justamente para não ter essa corrida; ela só tinha sido movida de lugar.
  const corpo = definicaoEfetiva("claim_custom_domain");
  const travaODono = /from\s+public\.users\s+where\s+uid\s*=\s*v_uid\s+for\s+update/i;

  it("trava a linha do dono em users antes de contar os domínios dele", () => {
    expect(
      corpo,
      "o SELECT do plano voltou a ser sem `for update`: duas reivindicações "
        + "simultâneas do mesmo professor passam as duas pela cota",
    ).toMatch(travaODono);

    // A ordem é parte da regra: um lock depois da contagem não serializa nada.
    expect(corpo.search(travaODono)).toBeLessThan(corpo.search(/count\(\*\)/));
  });

  it("a cota continua sendo conferida e aplicada aqui, não na rota", () => {
    expect(corpo).toMatch(/v_used\s*>=\s*v_limit/);
    expect(corpo).toMatch(/insert into public\.custom_domains/i);
  });
});

/**
 * Última definição de uma POLICY na cadeia de migrations.
 *
 * Mesma lógica de `definicaoEfetiva`, para o outro tipo de objeto: `create
 * policy` nasce, `alter policy` redefine, e quem manda é a última. Uma
 * expressão de policy não contém ponto e vírgula, então o statement vai do
 * `policy <nome> on` até o próximo `;`.
 */
function policyEfetiva(nomeDaPolicy: string): string {
  const pasta = "supabase/migrations";
  const marcador = new RegExp(String.raw`\bpolicy\s+${nomeDaPolicy}\s+on\b`, "i");
  const arquivos = readdirSync(join(RAIZ, pasta))
    .filter((arquivo) => arquivo.endsWith(".sql"))
    .sort();

  let ultimo: string | null = null;

  for (const arquivo of arquivos) {
    const texto = readFileSync(join(RAIZ, pasta, arquivo), "utf8");
    let posicao = texto.search(marcador);

    while (posicao !== -1) {
      const fim = texto.indexOf(";", posicao);
      ultimo = texto.slice(posicao, fim === -1 ? undefined : fim);

      const resto = texto.slice(posicao + 1);
      const proxima = resto.search(marcador);
      posicao = proxima === -1 ? -1 : posicao + 1 + proxima;
    }
  }

  expect(ultimo, `nenhuma migration define a policy ${nomeDaPolicy}`).not.toBeNull();
  return ultimo as string;
}

describe("session_is_strong — RLS passa a exigir o segundo fator", () => {
  // O buraco (A-17, sobra assumida pelo PR #146): o portão do segundo fator
  // vivia só na tela e em createSupabaseServerClient. Um token aal1 de conta
  // com TOTP continuava lendo e escrevendo pelo PostgREST direto — com a chave
  // anon, que é pública — tudo o que as policies liberam para auth.uid().
  // Nenhuma policy deste banco olhava o AAL: `grep -rin aal supabase/migrations`
  // devolvia zero linhas.
  const corpo = definicaoEfetiva("session_is_strong");

  it("decide pela conta: quem não tem fator verificado não muda nada", () => {
    expect(corpo).toMatch(/auth\.mfa_factors/i);
    expect(corpo).toMatch(/status\s*=\s*'verified'/i);
    expect(
      corpo,
      "a função precisa liberar quem NÃO tem fator (not exists), senão ela "
        + "fecha a plataforma para todo mundo que não usa segundo fator",
    ).toMatch(/not\s+exists/i);
  });

  it("a sessão forte é aal2 lido do token, não uma flag do app", () => {
    expect(corpo).toMatch(/auth\.jwt\(\)\s*->>\s*'aal'/i);
    expect(corpo).toMatch(/'aal2'/);
  });

  it("é security definer com search_path fixo", () => {
    // Sem definer ela não lê auth.mfa_factors; com search_path aberto, um
    // schema no caminho do chamador sequestra o que ela consulta.
    expect(corpo).toMatch(/security\s+definer/i);
    expect(corpo).toMatch(/set\s+search_path\s*=/i);
  });

  it("anon continua podendo executar, senão a leitura pública aborta com 42501", () => {
    // O Postgres avalia a expressão de uma policy com os privilégios do papel
    // corrente, e toda policy deste banco é `TO public` — logo é avaliada
    // também para anon. Foi o incidente de
    // 20260901120000_restore_anon_execute_on_rls_predicates. Para anon a função
    // responde TRUE e o predicado de dono segue filtrando: conceder não concede
    // poder, revogar fecha o catálogo.
    expect(textoDasMigrations()).toMatch(
      /grant\s+execute\s+on\s+function\s+public\.session_is_strong\(\)\s+to\s+[^;]*\banon\b/i,
    );
  });
});

describe("as policies que o segundo fator passa a proteger", () => {
  // A lista é o contrato. Se alguém reescrever uma destas sem o portão, o
  // vermelho aparece aqui — e não no dia em que a conta com TOTP for esvaziada
  // por um token aal1.
  const protegidas = [
    "courses_insert_owner",
    "courses_update_owner",
    "courses_delete_owner",
    "course_lesson_content_insert_owner",
    "course_lesson_content_update_owner",
    "course_lesson_content_delete",
    "course_assets_insert",
    "course_assets_update_owner",
    "course_assets_delete_owner",
    "users_update_self",
    "custom_domains_select_owner",
    "payout_ledger_owner_sel",
    "payout_ledger_teacher_read",
    "orders_owner_sel",
    "orders_teacher_read",
    "payments_owner_sel",
    "enrollments_select_owner",
    "lesson_comments_insert",
  ];

  it.each(protegidas)("%s exige a sessão forte", (nome) => {
    expect(
      policyEfetiva(nome),
      `${nome} voltou a decidir só por auth.uid(): um token aal1 de conta com `
        + "TOTP passa por ela pelo PostgREST direto",
    ).toMatch(/session_is_strong\(\)/);
  });

  it("a leitura pública do catálogo fica de fora do portão", () => {
    // Gate em policy de leitura pública mata o funil de aquisição inteiro.
    for (const publica of ["courses_select_public", "course_landings_select_public"]) {
      expect(policyEfetiva(publica)).not.toMatch(/session_is_strong/);
    }
  });
});

describe("sala de controle do Ops — ler a pessoa exige admin com 2FA e não escreve nada", () => {
  // A lista e o dossiê mostram dado pessoal e financeiro de qualquer conta. O
  // portão é o do controle de conta do #326: admin ativo E aal2. Trocar por
  // require_strong_session deixaria admin sem fator cadastrado ler tudo.
  for (const nome of ["admin_search_users", "admin_get_user_dossier"]) {
    const corpo = definicaoEfetiva(nome);

    it(`${nome}: security definer com search_path fixo`, () => {
      expect(corpo).toMatch(/security\s+definer/i);
      expect(corpo).toMatch(/set\s+search_path\s+to\s+'public',\s*'pg_temp'/i);
    });

    it(`${nome}: recusa quem não é admin ou não tem aal2`, () => {
      expect(corpo).toMatch(/public\.is_admin\(\)/i);
      expect(corpo).toMatch(/'aal2'/);
      expect(corpo).toMatch(/OPS_ADMIN_MFA_REQUIRED/);
    });

    it(`${nome}: só lê`, () => {
      expect(corpo).not.toMatch(/\binsert\s+into\b|\bupdate\s+public\.|\bdelete\s+from\b/i);
    });
  }

  it("o dossiê mostra contagem e data de conversa privada, nunca o texto", () => {
    // advisor_messages.content e course_messages.body são conversa privada;
    // course_lesson_content é o curso pago. O operador vê quanto e quando.
    const corpo = definicaoEfetiva("admin_get_user_dossier");
    expect(corpo).not.toMatch(/\.content\b/);
    expect(corpo).not.toMatch(/\bm\.body\b/);
    expect(corpo).not.toMatch(/course_lesson_content/);
  });
});
