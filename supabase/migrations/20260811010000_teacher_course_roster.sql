-- O professor nao conseguia ver quem comprou o proprio curso.
--
-- `enrollments` so tem duas policies de SELECT (remote_schema_2026-07-21.sql:4764):
-- `enrollments_select_owner` (user_id = auth.uid(), ou seja o ALUNO) e
-- `enrollments_select_admin`. O dono do curso nao esta em nenhuma das duas. E
-- `public.users` e ainda mais fechado: `users_select_self` + `users_select_admin`.
-- Resultado: o hub do produto tem 11 abas e nenhuma lista de alunos, e a aba de
-- vendas nao supre — `src/domain/order.ts` carrega `userId` e nenhum nome ou
-- e-mail.
--
-- Mesma forma que a migracao 20260807120000 ja usou para os assinantes: uma
-- funcao SECURITY DEFINER SEM ARGUMENTOS. Sem parametro nao existe superficie de
-- enumeracao — o professor so consegue perguntar "quem esta nos MEUS cursos",
-- nunca "quem e o usuario X".
--
-- Deliberadamente NAO se cria policy nova em `enrollments`. Alem de ser um
-- diff maior, a migracao 20260809080000 fechou um invariante ali: toda policy
-- que le `enrollments` tem que checar `e.status`. Para o aluno isso esta certo
-- (reembolsado perde o acesso), mas uma lista de alunos que esconde o
-- reembolsado e inutil justamente no caso em que o professor mais precisa dela.
-- A funcao devolve o status como coluna e deixa a decisao na tela.
--
-- E-mail entra na projecao: no modelo de direct charge o comprador e cliente do
-- professor (o Stripe ja manda o e-mail dele no recibo), entao esconder aqui so
-- quebraria o suporte sem proteger nada.

create or replace function public.get_my_course_students()
returns table (
  enrollment_id text,
  course_id text,
  course_title text,
  uid text,
  display_name text,
  email text,
  photo_url text,
  status text,
  source text,
  progress_percent integer,
  enrolled_at timestamptz
)
language sql
stable
security definer
-- pg_temp listado por ULTIMO de proposito: se ele nao aparece na lista, o
-- Postgres procura o schema temporario ANTES de todos os outros, e qualquer
-- usuario poderia criar uma tabela temporaria chamada `users` para sequestrar
-- uma funcao SECURITY DEFINER. Mesmo pin da 20260807120000.
set search_path = public, pg_temp
as $$
  select
    e.id,
    e.course_id,
    e.course_title,
    u.uid,
    u.display_name,
    u.email,
    u.photo_url,
    e.status,
    e.source,
    e.progress_percent,
    e.created_at
  from public.enrollments e
  join public.courses c on c.id = e.course_id
  left join public.users u on u.uid = e.user_id
  where c.owner_id = (select auth.uid())::text
  order by e.created_at desc;
$$;

comment on function public.get_my_course_students() is
  'Lista os alunos matriculados nos cursos do proprio chamador (nome, e-mail, status, progresso). Sem argumento: nao da para consultar usuario arbitrario.';

-- ponytail: sem paginacao — devolve todos os alunos de todos os cursos do
-- professor e a tela filtra por curso. Com o teto do plano Pro em 2.000 alunos
-- isso e uma leitura indexada por owner_id. Adicionar `p_course_id` + LIMIT
-- quando alguem passar disso.

revoke execute on function public.get_my_course_students() from public, anon;
grant execute on function public.get_my_course_students() to authenticated;
