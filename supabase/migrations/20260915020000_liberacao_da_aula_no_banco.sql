-- Fatia 9 do editor: a liberação da aula (drip) vale também no banco.
--
-- Até aqui só o vídeo respeitava o calendário: a rota do vídeo chama
-- getLessonUnlockState (src/domain/drip-policy.ts) antes de assinar a URL do
-- Bunny. O texto (content_text), o link (external_url) e o material da aula
-- passavam só pela matrícula viva, então um aluno ativo lia, direto pelo
-- cliente do Supabase, a aula que o professor programou para daqui a 14 dias.
--
-- public.lesson_is_released espelha a regra do JS e entra SÓ no ramo "está
-- matriculado" das três policies de leitura. Dono, admin e a amostra pública
-- (course_lesson_content_select_free_preview) ficam como estavam. A tabela de
-- casos src/domain/drip-policy-parity-cases.ts roda nos dois lados: no vitest e
-- em supabase/tests/20260915020000_liberacao_da_aula_no_banco_smoke.sql.
--
-- As três policies passam de TO public para TO authenticated. Para anon não
-- muda nada (sem sessão, admin, dono e matrícula já davam falso), e é o que
-- deixa a função sem EXECUTE para anon: o Postgres confere o EXECUTE de toda
-- função citada numa policy ao montar a consulta, então uma policy TO public
-- com uma função que anon não executa abortaria com 42501 a leitura anônima da
-- amostra (o incidente de 20260901120000_restore_anon_execute_on_rls_predicates).
--
-- ponytail: a função lê courses.modules a cada linha. Com o teto de 300 aulas
-- por curso (courses_lesson_count_check), carregar o curso inteiro custa até
-- 300 leituras por PK + a varredura do jsonb de cada uma. Se isso pesar, trocar
-- por uma função que devolve de uma vez o conjunto de aulas liberadas do curso.

create or replace function public.lesson_is_released(p_course_id text, p_lesson_id text, p_uid text)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  -- Com sessão, a pergunta é sempre sobre quem está logado (mesmo padrão de
  -- creator_activation_blocked): ninguém sonda o progresso de outra pessoa.
  -- Sem sessão (service_role), vale p_uid.
  v_uid text := coalesce((select auth.uid())::text, p_uid);
  v_course record;
  v_lesson record;
  v_enrolled_at timestamptz;
  v_interval numeric;
  v_delay numeric;
begin
  -- Mesmo portão de has_enrollment_for_course_slug: conta suspensa, sessão
  -- revogada ou sessão aal1 de conta com segundo fator não abre aula nenhuma.
  -- As policies já têm esse corte (account_access_guard e strong_session_*);
  -- aqui ele vale também para quem chamar a função direto. Sem usuário
  -- (service_role) a resposta é true e o resto da regra decide.
  if not public.session_is_strong() then
    return false;
  end if;

  select c.owner_id, c.modules, c.drip_strategy, c.drip_interval_days, c.free_preview_lesson_id
    into v_course
    from public.courses c
   where c.id = p_course_id;
  -- O curso sumiu: não há do que liberar (a rota responde "locked").
  if not found then
    return false;
  end if;

  -- Chamada direta por quem está logado não vira oráculo: quem não é dono nem
  -- matriculado recebe false tanto para curso que existe quanto para curso que
  -- não existe, então não descobre id de rascunho nem a estratégia do curso.
  -- Nas policies nada muda: elas só chamam a função no ramo da matrícula.
  if (select auth.uid()) is not null
     and v_course.owner_id is distinct from v_uid
     and not exists (
       select 1 from public.enrollments e
        where e.course_id = p_course_id and e.user_id = v_uid
     ) then
    return false;
  end if;

  if p_lesson_id = v_course.free_preview_lesson_id
     or coalesce(v_course.drip_strategy, 'instant') = 'instant' then
    return true;
  end if;

  -- Posição da aula na ordem global do currículo (getLessonPosition). modules
  -- é jsonb: currículo malformado vira lista vazia, nunca erro na leitura.
  select s.module_index, s.global_index, s.previous_id, s.drip_delay
    into v_lesson
    from (
      select l.value ->> 'id' as lesson_id,
             m.ordinality - 1 as module_index,
             row_number() over (order by m.ordinality, l.ordinality) - 1 as global_index,
             lag(l.value ->> 'id') over (order by m.ordinality, l.ordinality) as previous_id,
             l.value -> 'dripDelayDays' as drip_delay
        from jsonb_array_elements(
               case when jsonb_typeof(v_course.modules) = 'array' then v_course.modules else '[]'::jsonb end
             ) with ordinality m
       cross join lateral jsonb_array_elements(
               case when jsonb_typeof(m.value -> 'lessons') = 'array' then m.value -> 'lessons' else '[]'::jsonb end
             ) with ordinality l
    ) s
   where s.lesson_id = p_lesson_id
   order by s.global_index
   limit 1;
  -- Aula que o currículo não lista: nada a programar (igual à rota).
  if not found then
    return true;
  end if;

  if v_course.drip_strategy = 'sequential_progress' then
    -- lesson_progress só nasce quando a aula é concluída (20260903120000), e a
    -- rota lê com o mesmo par (user_id, enrollment_id).
    return v_lesson.global_index = 0 or exists (
      select 1 from public.lesson_progress lp
       where lp.user_id = v_uid
         and lp.enrollment_id = v_uid || '__' || p_course_id
         and lp.lesson_id = v_lesson.previous_id
    );
  end if;

  select e.created_at into v_enrolled_at
    from public.enrollments e
   where e.id = v_uid || '__' || p_course_id;
  v_interval := greatest(1, coalesce(v_course.drip_interval_days, 1));
  v_delay := case v_course.drip_strategy
    when 'time_drip_module' then v_lesson.module_index * v_interval
    -- ponytail: só número JSON conta (o builder grava número); outro tipo vira 0.
    when 'time_drip_custom' then greatest(0, round(
      case when jsonb_typeof(v_lesson.drip_delay) = 'number'
        then (v_lesson.drip_delay #>> '{}')::numeric else 0 end))
    else v_lesson.global_index * v_interval
  end;
  -- Horas, não dias: o JS soma milissegundos, e somar '1 day' num fuso com
  -- horário de verão mudaria a conta. Teto de 100 anos: um prazo absurdo fica
  -- fechado em vez de estourar o intervalo e abortar a leitura do aluno.
  return now() >= coalesce(v_enrolled_at, now()) + least(v_delay, 36500)::float8 * interval '24 hours';
end
$function$;

comment on function public.lesson_is_released(text, text, text) is
  'Espelho de getLessonUnlockState (src/domain/drip-policy.ts) como a rota do video chama. Usada no ramo de matricula das policies de leitura de course_lesson_content, course_assets e storage course-content.';

-- O arquivo do bucket course-content chega à aula pela linha de course_assets
-- (storage_path é o nome exato do objeto). SECURITY DEFINER de propósito: a
-- policy de course_assets agora esconde a linha da aula fechada, então um
-- "not exists" rodando com a RLS do aluno acharia nada e LIBERARIA o arquivo.
-- Arquivo sem linha ou sem aula (material do curso inteiro) segue a regra antiga.
create or replace function public.course_content_object_is_released(p_object_name text, p_uid text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  -- Mesmo portão de sessão de lesson_is_released, no corpo desta também.
  select public.session_is_strong()
     and coalesce(bool_and(public.lesson_is_released(a.course_id, a.lesson_id, p_uid)), true)
    from public.course_assets a
   where a.course_id = (storage.foldername(p_object_name))[2]
     and a.storage_path = p_object_name
     and a.lesson_id is not null;
$function$;

revoke all on function public.lesson_is_released(text, text, text),
  public.course_content_object_is_released(text, text) from public, anon, authenticated;
grant execute on function public.lesson_is_released(text, text, text),
  public.course_content_object_is_released(text, text) to authenticated, service_role;

-- Texto e link da aula. Antes: 20260809080000_enrollment_status_rls.sql.
drop policy if exists course_lesson_content_select on public.course_lesson_content;
create policy course_lesson_content_select on public.course_lesson_content
  as permissive for select to authenticated
  using (
    is_admin()
    or exists (
      select 1 from public.courses c
      where c.id = course_lesson_content.course_id
        and c.owner_id = (select auth.uid())::text
    )
    or (
      exists (
        select 1 from public.enrollments e
        where e.course_id = course_lesson_content.course_id
          and e.user_id = (select auth.uid())::text
          and e.status = any (array['active'::text, 'completed'::text])
      )
      and public.lesson_is_released(course_lesson_content.course_id, course_lesson_content.lesson_id,
        (select auth.uid())::text)
    )
  );

-- Material. Antes: 20260809040000_rls_baseline_snapshot.sql. Linha sem aula
-- (material do curso inteiro) continua pela matrícula só.
drop policy if exists course_assets_select on public.course_assets;
create policy course_assets_select on public.course_assets
  as permissive for select to authenticated
  using (
    is_admin()
    or exists (
      select 1 from public.courses c
      where c.id = course_assets.course_id
        and c.owner_id = (select auth.uid())::text
    )
    or (
      exists (
        select 1 from public.enrollments e
        where e.course_id = course_assets.course_id
          and e.user_id = (select auth.uid())::text
          and e.status = any (array['active'::text, 'completed'::text])
      )
      and (
        course_assets.lesson_id is null
        -- Capa e miniatura moram no bucket público e aparecem no currículo
        -- mesmo com a aula fechada (a lista de publicMediaKinds em
        -- src/lib/data/course-assets.ts).
        or course_assets.kind = any (array['lesson_thumbnail'::text, 'course_cover'::text,
          'members_cover'::text, 'module_cover'::text])
        or public.lesson_is_released(course_assets.course_id, course_assets.lesson_id, (select auth.uid())::text)
      )
    )
  );

-- O arquivo do material. Antes: supabase/schema/remote_schema_2026-07-21.sql
-- (já era TO authenticated).
drop policy if exists course_content_select on storage.objects;
create policy course_content_select on storage.objects
  as permissive for select to authenticated
  using (
    (bucket_id = 'course-content'::text)
    and (
      public.is_admin()
      or exists (
        select 1 from public.courses c
        where c.id = (storage.foldername(objects.name))[2]
          and c.owner_id = (select auth.uid())::text
      )
      or (
        exists (
          select 1 from public.enrollments e
          where e.course_id = (storage.foldername(objects.name))[2]
            and e.user_id = (select auth.uid())::text
            and e.status = any (array['active'::text, 'completed'::text])
        )
        and public.course_content_object_is_released(objects.name, (select auth.uid())::text)
      )
    )
  );
