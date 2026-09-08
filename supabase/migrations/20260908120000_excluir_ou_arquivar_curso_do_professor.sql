-- Excluir ou arquivar o curso, pelo dono, numa acao so.
--
-- O que faltava: o professor so conseguia apagar RASCUNHO, e so pelo menu da
-- lista. `delete_teacher_course_draft` recusa qualquer status fora de
-- draft/needs_changes, entao um curso publicado — com aluno ou sem — so saia do
-- ar se um admin despublicasse pelo /ops. Quem produz o curso nao tinha como
-- tirar o proprio curso da loja.
--
-- A forma vem da Hotmart: existe UMA acao ("Excluir produto") e o servidor
-- decide o destino. Sem comprador, some. Com comprador, o produto sai da loja e
-- quem ja comprou mantem o acesso — e por isso que nao ha "desativar" separado
-- na tela: seria pedir ao professor uma decisao que o dado ja responde.
--
-- Por que arquivar preserva o acesso: `course_assets_select` e a policy de
-- storage `course_content_select` liberam conteudo por matricula VIVA
-- (e.status in active/completed), nunca pelo status do curso. Mudar o curso
-- para 'inactive' tira ele do marketplace (`courses_select_public` so enxerga
-- published/in_review) sem tocar em nenhuma dessas duas portas.

create or replace function public.delete_or_archive_own_course(p_course_id text)
returns jsonb
language plpgsql
security definer
-- pg_temp por ULTIMO: se ele nao aparece na lista o Postgres o procura ANTES de
-- todos os outros, e qualquer usuario poderia criar uma tabela temporaria
-- chamada `courses` para sequestrar esta funcao. Mesmo pin do resto da serie.
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid text := (select auth.uid())::text;
  v_owner text;
  v_key text;
  v_enrollments integer;
  v_orders integer;
begin
  -- Mesma barreira que a 20260906020000 injetou na `delete_teacher_course_draft`
  -- que esta funcao substitui: apagar curso e acao destrutiva e nao passa por
  -- sessao sem o segundo fator.
  perform public.require_strong_session();

  if v_uid is null or not public.is_teacher() then
    raise exception 'Sign in as a creator before deleting a course.';
  end if;

  select owner_id, title_key into v_owner, v_key
  from public.courses where id = p_course_id;
  if v_owner is null then
    raise exception 'Course not found.';
  end if;
  if v_owner <> v_uid then
    raise exception 'Only the course owner can delete it.';
  end if;

  -- Matricula e pedido de QUALQUER status contam. Uma matricula reembolsada e
  -- um checkout pendente continuam sendo registro de alguem, e as duas chaves
  -- estrangeiras para `courses` sao RESTRICT (ao contrario de course_coupons e
  -- course_lesson_content, que cascateiam): sem esta contagem o DELETE abaixo
  -- morreria num 23503 no meio da acao, em vez de virar arquivamento.
  select count(*) into v_enrollments from public.enrollments where course_id = p_course_id;
  select count(*) into v_orders from public.orders where course_id = p_course_id;

  if v_enrollments = 0 and v_orders = 0 then
    -- Mesma limpeza da delete_teacher_course_draft: o conteudo privado das
    -- aulas vive fora de `courses` e o title_key e um unique global que ficaria
    -- queimado para sempre se nao voltasse.
    delete from public.course_lesson_content where course_id = p_course_id;
    if v_key is not null then
      delete from public.course_title_keys where title_key = v_key;
    end if;
    delete from public.courses where id = p_course_id;

    return jsonb_build_object('outcome', 'deleted');
  end if;

  -- `status` e coluna congelada: courses_freeze_privileged_columns() recusa a
  -- troca para quem nao e admin/ops/service. A janela abaixo e local a
  -- transacao, como em publish_teacher_course.
  perform set_config('skillset.trusted_write', 'on', true);

  update public.courses
     set status = 'inactive',
         -- A nota editorial que sobrou de um "needs changes" nao descreve mais
         -- o estado do curso; deixa-la ali faria a tela do professor acusar um
         -- problema que ele nao tem.
         review_note = null,
         updated_at = now()
   where id = p_course_id;

  perform set_config('skillset.trusted_write', 'off', true);

  return jsonb_build_object(
    'outcome', 'archived',
    'enrollments', v_enrollments,
    'orders', v_orders
  );
end;
$function$;

comment on function public.delete_or_archive_own_course(text) is
  'Exclui o proprio curso quando ele nunca teve matricula nem pedido; caso contrario arquiva (status inactive) e devolve as contagens. Nunca apaga curso com comprador.';

revoke execute on function public.delete_or_archive_own_course(text) from public, anon;
grant execute on function public.delete_or_archive_own_course(text) to authenticated, service_role;

-- `delete_teacher_course_draft` continua existindo (compatibilidade com quem
-- chamar o PostgREST direto); o app passa a chamar so a funcao acima.

-- A policy permite DELETE direto pelo dono em draft/needs_changes/inactive.
-- Depois desta migration 'inactive' passa a ser tambem o estado de ARQUIVADO,
-- ou seja, o estado de um curso que TEM aluno. As FKs de enrollments e orders
-- sao RESTRICT e ja barrariam o comando, mas com um 23503 vindo do nada: a
-- regra fica escrita onde quem le RLS a procura, e o cliente PostgREST recebe
-- zero linhas em vez de um erro de chave estrangeira.
--
-- De proposito SEM filtro de e.status, ao contrario das outras politicas que
-- consultam enrollments: elas usam a matricula para LIBERAR acesso, e aí uma
-- linha morta nao pode valer; esta usa para RECUSAR, e matricula reembolsada
-- continua sendo registro do aluno. A excecao esta documentada na guarda, em
-- supabase/tests/20260901180000_dead_enrollments_lose_the_classroom_smoke.sql.
-- `alter policy` e nao drop/create: o portao do segundo fator abaixo veio da
-- 20260902120000 e recriar a policy do zero e a forma classica de perde-lo.
alter policy courses_delete_owner on public.courses
  using (
    owner_id = (select auth.uid())::text
    and status = any (array['draft', 'needs_changes', 'inactive'])
    and (select public.session_is_strong())
    and not exists (select 1 from public.enrollments e where e.course_id = courses.id)
    and not exists (select 1 from public.orders o where o.course_id = courses.id)
  );
