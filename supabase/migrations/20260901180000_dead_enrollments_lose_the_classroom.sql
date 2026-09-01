-- A leitura da sala de aula foi fechada em 20260809080000_enrollment_status_rls
-- ("Private classroom discussion between the teacher and the people who paid"):
-- `lesson_comments_select` passou a exigir matrícula em ('active','completed').
-- A ESCRITA ficou como estava. `lesson_comments_insert` pede apenas que EXISTA
-- uma linha em `enrollments`, com qualquer status — e a linha nunca é apagada,
-- só muda de status. Reembolsado, revogado ou expirado, o ex-aluno continua
-- publicando na turma paga; e como a leitura já fechou para ele, ele escreve
-- num lugar que não pode mais ler, para uma plateia da qual não faz mais parte.
--
-- Aquela mesma migration terminava com uma guarda escrita para impedir
-- exatamente este descuido:
--
--   where pg_get_expr(p.polqual, p.polrelid) ilike '%enrollments%'
--     and pg_get_expr(p.polqual, p.polrelid) not ilike '%e.status%'
--
-- `polqual` é a cláusula USING. Política de INSERT não tem USING: o predicado
-- dela vive em `polwithcheck`. A guarda criada para impedir o furo era cega
-- justamente para a metade das políticas onde ele estava — e por isso deu
-- verde no dia em que nasceu, com o furo ao lado.
--
-- Rodando o mesmo critério sobre as duas expressões, aparece um segundo caso:
-- `member_stats_select_authenticated`, criada UM DIA depois da guarda
-- (20260810020000) com o mesmo descuido. As três correções vão juntas porque a
-- guarda corrigida, no fim deste arquivo, não deixa nenhuma delas passar.

-- 1) Escrever na sala de aula exige o mesmo direito que ler.
drop policy if exists lesson_comments_insert on public.lesson_comments;
create policy lesson_comments_insert on public.lesson_comments
  as permissive for insert to public
  with check (
    (select auth.uid()) is not null
    and author_id = (select auth.uid())::text
    and exists (
      select 1 from public.enrollments e
      where e.course_id = lesson_comments.course_id
        and e.user_id = (select auth.uid())::text
        and e.status = any (array['active'::text, 'completed'::text])
    )
  );
-- O dono do curso segue fora deste predicado, exatamente como antes: ele nunca
-- esteve aqui, e a única UI que insere comentário é a do aluno
-- (src/components/learn/enrolled-course-workspace.tsx). Não é o furo desta
-- migration, e nada nela ampliou o que ele já podia fazer.

-- 2) member_stats: quem LÊ precisa estar vivo no curso.
--
-- O furo é de quem lê. Um ex-aluno mantinha a credencial que a policy usa para
-- liberar o roster — uid, nome, pontos, nível e likes de todo mundo com quem
-- ele um dia dividiu um curso —, e enumerar isso é a coisa que a policy de
-- 20260810020000 existe para impedir.
--
-- O lado de QUEM É LIDO (e2) continua sem status, de propósito. Ele não abre
-- nada: a porta é o primeiro EXISTS. Apertá-lo apagaria o badge de quem já saiu
-- em posts antigos que continuam no feed — `fetchMemberStatsForUids` omite em
-- silêncio a linha que não consegue ler (src/lib/data/gamification.ts) —, o que
-- muda a tela sem fechar nada.
drop policy if exists member_stats_select_authenticated on public.member_stats;
create policy member_stats_select_authenticated on public.member_stats
  as permissive for select to authenticated
  using (
    uid = (select auth.uid())::text
    or exists (
      select 1
      from public.courses c
      where
        -- caller participates in the course, as owner or as a paying student
        (
          c.owner_id = (select auth.uid())::text
          or exists (
            select 1 from public.enrollments e
            where e.course_id = c.id
              and e.user_id = (select auth.uid())::text
              and e.status = any (array['active'::text, 'completed'::text])
          )
        )
        -- and so does the member whose stats are being read
        and (
          c.owner_id = member_stats.uid
          or exists (
            select 1 from public.enrollments e2
            where e2.course_id = c.id
              and e2.user_id = member_stats.uid
          )
        )
    )
  );

-- 3) A guarda, agora enxergando a política inteira.
--
-- Mesmo critério da original (`e.status` no texto do predicado) — o que muda é
-- só ONDE ela procura: USING **e** WITH CHECK, concatenados, porque uma
-- política pode ter qualquer um dos dois, ou os dois.
--
-- Continua sendo um teste de texto, não de semântica: ele prova que o status
-- foi consultado, não que foi consultado no lugar certo. É o mesmo contrato
-- frouxo de antes, e é deliberado — o que ele pega é o esquecimento, que é como
-- as três violações desta série nasceram.
--
-- lesson_progress_select_owner segue como a única exceção: devolve o histórico
-- do próprio usuário, que é dele qualquer que seja o status da matrícula.
do $$
declare
  offenders text;
begin
  select string_agg(c.relname || '.' || p.polname, ', ')
    into offenders
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  cross join lateral (
    select coalesce(pg_get_expr(p.polqual, p.polrelid), '')
      || ' '
      || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') as predicado
  ) x
  where x.predicado ilike '%enrollments%'
    and x.predicado not ilike '%e.status%'
    and p.polname <> 'lesson_progress_select_owner';

  if offenders is not null then
    raise exception 'RLS policies read enrollments without checking status: %', offenders;
  end if;
end $$;
