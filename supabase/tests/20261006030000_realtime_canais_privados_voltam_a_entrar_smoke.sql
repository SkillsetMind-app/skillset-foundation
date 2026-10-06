\set ON_ERROR_STOP on
-- Banco descartável: a partição, as mensagens e o controle de conta voltam no
-- rollback.
begin;

create function pg_temp.assert_true(ok boolean, message text) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'REALTIME_JOIN_REGRESSION: %', message; end if; end $$;
create function pg_temp.uid(n int) returns uuid language sql immutable as $$
  select ('86000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$$;
-- Quem entra no canal: claims de usuário logado e o tópico do canal, como o
-- Realtime monta antes de conferir a leitura.
create function pg_temp.joins(n int, topic text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', pg_temp.uid(n)::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.uid(n),
    'role', 'authenticated', 'aal', 'aal1', 'session_id', pg_temp.uid(n + 100))::text, true);
  perform set_config('realtime.topic', topic, true);
end $$;

-- O Realtime confere a entrada num canal privado gravando uma mensagem de teste
-- por extensão e vendo se a RLS deixa quem entra ler. Aqui é igual, numa
-- partição própria (a tabela é particionada por inserted_at em produção).
do $$
begin
  if (select relkind from pg_class where oid = 'realtime.messages'::regclass) = 'p' then
    execute $q$create table realtime.messages_smoke_join partition of realtime.messages
      for values from ('2000-01-01') to ('2000-01-02')$q$;
  end if;
end $$;

insert into realtime.messages (topic, extension, private, inserted_at, updated_at)
select topic, extension, true, '2000-01-01 12:00', '2000-01-01 12:00'
from (values ('courses:builder:smoke-course#13'), ('community-presence:smoke-course#2')) t(topic)
cross join (values ('broadcast'), ('presence')) e(extension);

-- Conta suspensa (uid 2). Sem linha de controle, a conta está liberada.
insert into public.account_controls (uid, suspended, sessions_revoked_before)
values (pg_temp.uid(2)::text, true, now());

-- 1. Criador logado entra no canal do construtor (o eco do autosave).
select pg_temp.joins(1, 'courses:builder:smoke-course#13');
set local role authenticated;
select pg_temp.assert_true(exists(select 1 from realtime.messages
  where topic = 'courses:builder:smoke-course#13' and extension = 'broadcast'),
  'authenticated user cannot join a Postgres Changes channel');
-- A entrada não vira presença: nenhum tópico de Postgres Changes tem presença.
select pg_temp.assert_true(not exists(select 1 from realtime.messages
  where topic = 'courses:builder:smoke-course#13' and extension = 'presence'),
  'join policy opened presence on a Postgres Changes channel');
reset role;

-- 2. A presença da comunidade continua fechada para quem não é dono, aluno ou
-- admin (#355): nem broadcast nem presença.
select pg_temp.joins(1, 'community-presence:smoke-course#2');
set local role authenticated;
select pg_temp.assert_true(not exists(select 1 from realtime.messages
  where topic = 'community-presence:smoke-course#2'),
  'outsider joined the community presence channel');
reset role;

-- 3. Conta suspensa não entra.
select pg_temp.joins(2, 'courses:builder:smoke-course#13');
set local role authenticated;
select pg_temp.assert_true(not exists(select 1 from realtime.messages
  where topic = 'courses:builder:smoke-course#13'),
  'suspended account joined a Postgres Changes channel');
reset role;

-- 4. Visitante sem login não entra.
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select set_config('request.jwt.claim.sub', '', true);
select set_config('realtime.topic', 'courses:builder:smoke-course#13', true);
set local role anon;
select pg_temp.assert_true(not exists(select 1 from realtime.messages
  where topic = 'courses:builder:smoke-course#13'),
  'anonymous visitor joined a Postgres Changes channel');
reset role;

rollback;
