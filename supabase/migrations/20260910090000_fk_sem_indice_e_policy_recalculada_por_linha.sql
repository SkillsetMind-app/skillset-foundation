-- Advisor de performance do Supabase, dois achados sobre a bolsa de acesso de
-- criador (20260906010000_creator_course_access.sql):
--
--   unindexed_foreign_keys (3): course_access_grants.claimed_by,
--   course_access_grants.granted_by e enrollments.creator_grant_id nao tinham
--   indice de cobertura. Toda leitura por essas colunas -- "meus grants
--   concedidos", "o que eu ja resgatei", o join reverso de enrollments para o
--   grant que o originou -- forcava sequential scan. Um FK sem indice tambem
--   custa do lado do pai: apagar ou mudar uma linha referenciada varre a
--   tabela filha inteira para validar a constraint.
--
--   auth_rls_initplan (1): course_access_grants_owner_select chamava
--   auth.uid() direto no USING, duas vezes, reavaliado a cada linha em vez de
--   uma vez por consulta. Mesmo padrao ja usado em courses_select_owner
--   (supabase/schema/remote_schema_2026-07-21.sql) e em toda policy nova desde
--   entao -- esta ficou pra tras porque nasceu na mesma migration da tabela
--   (20260906010000) e nunca foi tocada de novo.
--
-- Plain CREATE INDEX rather than CONCURRENTLY: apply_migration wraps the
-- statement in a transaction, where CONCURRENTLY is not allowed, and both
-- tables are small enough that the exclusive lock is not a concern.

create index if not exists course_access_grants_claimed_by_idx
  on public.course_access_grants (claimed_by);

create index if not exists course_access_grants_granted_by_idx
  on public.course_access_grants (granted_by);

create index if not exists enrollments_creator_grant_id_idx
  on public.enrollments (creator_grant_id);

-- Mesmo nome, mesmo comando (select), mesmos papeis (authenticated), mesma
-- expressao -- so as duas chamadas de auth.uid() viram (select auth.uid()).
-- session_is_strong() fica como estava: nao e auth.<function>() nem
-- current_setting(), o advisor nunca reclamou dela.
drop policy if exists course_access_grants_owner_select on public.course_access_grants;
create policy course_access_grants_owner_select on public.course_access_grants
  for select to authenticated
  using (
    granted_by = (select auth.uid())::text
    and public.session_is_strong()
    and exists (
      select from public.courses c
      where c.id = course_id and c.owner_id = (select auth.uid())::text
    )
  );
