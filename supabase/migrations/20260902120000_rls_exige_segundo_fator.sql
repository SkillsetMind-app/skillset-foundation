-- O segundo fator parava na porta do app, não na porta do banco.
--
-- O PR #146 fechou o A-17 nas telas e nas rotas: o listener do cliente emite
-- `mfa_required` e `createSupabaseServerClient` responde "sem usuário" quando a
-- conta tem fator verificado e o token não é aal2. Ele mesmo listou o que ficou
-- de fora, e é isto: **RLS não exige aal2**. Quem tem TOTP habilitado e uma
-- sessão aal1 no cookie continua lendo e escrevendo pelo PostgREST direto, com
-- a chave anon que é pública por definição, tudo o que as policies liberam para
-- `auth.uid()`. O painel financeiro do professor, o construtor de curso, a lista
-- de matrículas: um `curl` com o access token aal1 e a URL do projeto bastam.
-- O portão do #146 não é atravessado — ele simplesmente não está nesse caminho.
--
-- CAUSA
--
-- Nenhuma policy deste banco olha o AAL. `grep -rin aal supabase/migrations/`
-- devolvia zero linhas antes deste arquivo, e `pg_get_expr` das policies vivas
-- confirmava o mesmo em produção. Toda a decisão era "auth.uid() é você?", e um
-- token aal1 responde essa pergunta tão bem quanto um aal2.
--
-- O CONSERTO
--
-- Uma função só, `public.session_is_strong()`, e ela entra nas policies que
-- expõem dado sensível ou permitem escrita do dono. A regra é decidida pela
-- CONTA, nunca por flag: quem não tem fator verificado responde TRUE e não
-- muda absolutamente nada. Hoje isso é todo mundo — `select count(*) from
-- auth.mfa_factors where status = 'verified'` = 0 em produção no momento em que
-- esta migration foi escrita. O efeito começa no dia em que a primeira pessoa
-- habilita TOTP, que é exatamente quando ela passa a acreditar que a senha
-- sozinha não abre a conta.
--
-- POR QUE anon CONTINUA PODENDO EXECUTAR
--
-- A instrução original era revogar de public E de anon. Medido contra produção,
-- em transação revertida, antes de escrever esta linha:
--
--     revoke all on function public.session_is_strong() from public, anon;
--     set local role anon; select count(*) from <tabela com policy que a cita>;
--     -- ERROR 42501: permission denied for function session_is_strong
--
-- É o mesmo defeito de 20260901120000_restore_anon_execute_on_rls_predicates:
-- o Postgres avalia a expressão de uma policy com os privilégios do papel
-- corrente, e toda policy deste banco é `TO public`, logo é avaliada também
-- para anon. `course_reviews_select` — a resenha que aparece na página pública
-- do curso — faz EXISTS em `enrollments`, cuja policy passa a citar esta função.
-- Sem o grant, o catálogo volta a abortar com 42501 no dia em que existir a
-- primeira resenha. Conceder não concede poder: para anon, `auth.uid()` é nulo,
-- não há fator, a função responde TRUE e o predicado de dono continua filtrando
-- tudo. Revogado de PUBLIC, que é o que importa: ninguém ganha isso por default.
--
-- Nota sobre `revoke ... from public` sozinho: não basta para tirar de anon. O
-- Supabase mantém ALTER DEFAULT PRIVILEGES concedendo EXECUTE a anon,
-- authenticated e service_role em funções novas do schema public, e esse grant
-- é explícito ao papel — sobrevive à revogação de PUBLIC. Medido também: sem o
-- `from anon`, anon executava a função mesmo depois do revoke de public. Ou
-- seja, o grant abaixo é declaração de intenção, não concessão nova.

create or replace function public.session_is_strong()
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $function$
  -- Ordem proposital: o teste barato primeiro. Sessão já forte não paga a
  -- consulta a auth.mfa_factors.
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      or not exists (
        select 1
          from auth.mfa_factors f
         where f.user_id = auth.uid()
           and f.status = 'verified'
      );
$function$;

comment on function public.session_is_strong() is
  'TRUE quando a conta nao tem segundo fator verificado (nada muda para ela) ou quando o token da sessao e aal2. Usada nas policies que expoem dado sensivel ou permitem escrita do dono. Ver A-17 e o PR #146.';

revoke all on function public.session_is_strong() from public;
grant execute on function public.session_is_strong() to authenticated, anon;

-- ---------------------------------------------------------------------------
-- courses — escrita do dono
-- ---------------------------------------------------------------------------

alter policy courses_insert_owner on public.courses
  with check (
    (
      owner_id = (select auth.uid())::text
      and status = 'draft'
      and is_teacher()
      and (
        is_admin()
        or exists (
          select 1 from public.users u
           where u.uid = (select auth.uid())::text
             and u.teacher_terms_accepted_at is not null
             and u.teacher_terms_version is not null
        )
      )
    )
    and (select public.session_is_strong())
  );

alter policy courses_update_owner on public.courses
  using ((owner_id = (select auth.uid())::text) and (select public.session_is_strong()))
  with check ((owner_id = (select auth.uid())::text) and (select public.session_is_strong()));

alter policy courses_delete_owner on public.courses
  using (
    owner_id = (select auth.uid())::text
    and status = any (array['draft', 'needs_changes', 'inactive'])
    and (select public.session_is_strong())
  );

-- ---------------------------------------------------------------------------
-- course_lesson_content — a aula em si
-- ---------------------------------------------------------------------------

alter policy course_lesson_content_insert_owner on public.course_lesson_content
  with check (
    exists (
      select 1 from public.courses c
       where c.id = course_lesson_content.course_id
         and c.owner_id = (select auth.uid())::text
    )
    and (select public.session_is_strong())
  );

alter policy course_lesson_content_update_owner on public.course_lesson_content
  using (
    (
      is_admin()
      or exists (
        select 1 from public.courses c
         where c.id = course_lesson_content.course_id
           and c.owner_id = (select auth.uid())::text
      )
    )
    and (select public.session_is_strong())
  )
  with check (
    (
      is_admin()
      or exists (
        select 1 from public.courses c
         where c.id = course_lesson_content.course_id
           and c.owner_id = (select auth.uid())::text
      )
    )
    and (select public.session_is_strong())
  );

alter policy course_lesson_content_delete on public.course_lesson_content
  using (
    (
      is_admin()
      or exists (
        select 1 from public.courses c
         where c.id = course_lesson_content.course_id
           and c.owner_id = (select auth.uid())::text
      )
    )
    and (select public.session_is_strong())
  );

-- ---------------------------------------------------------------------------
-- course_assets — a mídia da aula. Não existe tabela `lessons` neste banco: a
-- aula é course_lesson_content e o arquivo dela é course_assets. Deixar os
-- assets de fora seria trocar o vídeo da aula com a sessão fraca.
-- ---------------------------------------------------------------------------

alter policy course_assets_insert on public.course_assets
  with check (
    (
      owner_id = (select auth.uid())::text
      and exists (
        select 1 from public.courses c
         where c.id = course_assets.course_id
           and c.owner_id = (select auth.uid())::text
           and c.status = any (array['draft', 'needs_changes', 'published', 'inactive'])
      )
    )
    and (select public.session_is_strong())
  );

alter policy course_assets_update_owner on public.course_assets
  using (
    exists (
      select 1 from public.courses c
       where c.id = course_assets.course_id
         and c.owner_id = (select auth.uid())::text
    )
    and (select public.session_is_strong())
  )
  with check (
    exists (
      select 1 from public.courses c
       where c.id = course_assets.course_id
         and c.owner_id = (select auth.uid())::text
    )
    and (select public.session_is_strong())
  );

alter policy course_assets_delete_owner on public.course_assets
  using (
    exists (
      select 1 from public.courses c
       where c.id = course_assets.course_id
         and c.owner_id = (select auth.uid())::text
    )
    and (select public.session_is_strong())
  );

-- ---------------------------------------------------------------------------
-- users — o perfil e a vitrine do professor moram aqui (não há tabela
-- `storefronts`; a projeção pública é public_profiles, alimentada por trigger).
-- Só o UPDATE entra. `users_select_self` fica de fora de propósito: policies de
-- OUTRAS tabelas fazem EXISTS em users — courses_insert_owner logo acima é uma
-- delas — e a leitura é como o app descobre quem é a pessoa.
-- ---------------------------------------------------------------------------

alter policy users_update_self on public.users
  using ((uid = (select auth.uid())::text) and (select public.session_is_strong()))
  with check ((uid = (select auth.uid())::text) and (select public.session_is_strong()));

-- ---------------------------------------------------------------------------
-- custom_domains — o domínio próprio do professor
-- ---------------------------------------------------------------------------

alter policy custom_domains_select_owner on public.custom_domains
  using ((owner_uid = (select auth.uid())::text) and (select public.session_is_strong()));

-- ---------------------------------------------------------------------------
-- Dinheiro: payout_ledger, orders, payments
-- ---------------------------------------------------------------------------

alter policy payout_ledger_owner_sel on public.payout_ledger
  using (
    ((teacher_id = (select auth.uid())::text) or is_admin())
    and (select public.session_is_strong())
  );

alter policy payout_ledger_teacher_read on public.payout_ledger
  using ((teacher_id = (select auth.uid())::text) and (select public.session_is_strong()));

alter policy orders_owner_sel on public.orders
  using (
    ((user_id = (select auth.uid())::text) or is_admin())
    and (select public.session_is_strong())
  );

alter policy orders_teacher_read on public.orders
  using ((teacher_id = (select auth.uid())::text) and (select public.session_is_strong()));

alter policy payments_owner_sel on public.payments
  using (
    ((user_id = (select auth.uid())::text) or is_admin())
    and (select public.session_is_strong())
  );

-- ---------------------------------------------------------------------------
-- enrollments — a matrícula do aluno. É também a chave da sala de aula: o
-- branch "está matriculado" de course_lesson_content_select, course_assets_select,
-- lesson_comments_select, course_reviews_select e lesson_progress_select_owner
-- passa por um EXISTS aqui, então a sessão fraca perde o conteúdo junto.
-- ---------------------------------------------------------------------------

alter policy enrollments_select_owner on public.enrollments
  using ((user_id = (select auth.uid())::text) and (select public.session_is_strong()));

-- ---------------------------------------------------------------------------
-- lesson_comments — escrita do aluno
-- ---------------------------------------------------------------------------

alter policy lesson_comments_insert on public.lesson_comments
  with check (
    (
      (select auth.uid()) is not null
      and author_id = (select auth.uid())::text
      and exists (
        select 1 from public.enrollments e
         where e.course_id = lesson_comments.course_id
           and e.user_id = (select auth.uid())::text
           and e.status = any (array['active', 'completed'])
      )
    )
    and (select public.session_is_strong())
  );

-- ---------------------------------------------------------------------------
-- Trava: a lista acima é a promessa desta migration. Se alguém reescrever uma
-- dessas policies sem o portão, a próxima migration falha aqui em vez de abrir
-- o buraco em silêncio.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  alvo text[][] := array[
    ['courses', 'courses_insert_owner'],
    ['courses', 'courses_update_owner'],
    ['courses', 'courses_delete_owner'],
    ['course_lesson_content', 'course_lesson_content_insert_owner'],
    ['course_lesson_content', 'course_lesson_content_update_owner'],
    ['course_lesson_content', 'course_lesson_content_delete'],
    ['course_assets', 'course_assets_insert'],
    ['course_assets', 'course_assets_update_owner'],
    ['course_assets', 'course_assets_delete_owner'],
    ['users', 'users_update_self'],
    ['custom_domains', 'custom_domains_select_owner'],
    ['payout_ledger', 'payout_ledger_owner_sel'],
    ['payout_ledger', 'payout_ledger_teacher_read'],
    ['orders', 'orders_owner_sel'],
    ['orders', 'orders_teacher_read'],
    ['payments', 'payments_owner_sel'],
    ['enrollments', 'enrollments_select_owner'],
    ['lesson_comments', 'lesson_comments_insert']
  ];
  i int;
  faltando text := '';
  expressao text;
BEGIN
  FOR i IN 1 .. array_length(alvo, 1) LOOP
    SELECT coalesce(pg_get_expr(p.polqual, p.polrelid), '')
           || ' ' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
      INTO expressao
      FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = alvo[i][1]
       AND p.polname = alvo[i][2];

    IF expressao IS NULL THEN
      faltando := faltando || format('%s.%s (policy inexistente), ', alvo[i][1], alvo[i][2]);
    ELSIF expressao NOT LIKE '%session_is_strong%' THEN
      faltando := faltando || format('%s.%s, ', alvo[i][1], alvo[i][2]);
    END IF;
  END LOOP;

  IF faltando <> '' THEN
    RAISE EXCEPTION
      'Policies sem o portao do segundo fator: %. Um token aal1 de conta com TOTP le/escreve isso pelo PostgREST direto.',
      rtrim(faltando, ', ');
  END IF;
END $$;

-- Segunda trava, o espelho da lição de 20260901120000: se anon perder o EXECUTE,
-- toda leitura anônima de tabela cuja policy `TO public` cita a função aborta
-- com 42501 em vez de filtrar. Falhar aqui é barato; descobrir em produção não.
DO $$
BEGIN
  IF NOT has_function_privilege('anon', 'public.session_is_strong()', 'EXECUTE') THEN
    RAISE EXCEPTION
      'anon nao pode executar session_is_strong(): leitura anonima das tabelas cujas policies TO public a citam vai abortar com 42501.';
  END IF;
END $$;
