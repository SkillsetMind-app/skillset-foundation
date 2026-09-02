-- Fixtures mínimas para os smoke tests de RLS de supabase/tests/.
--
-- Por que este arquivo existe: os smoke tests foram escritos contra um banco
-- vivo e leem um usuário e um curso REAIS (`select ... limit 1` + `\gset`).
-- Num banco recém-montado essas tabelas estão vazias, o `\gset` aborta e o
-- teste falha por falta de dado — não por regressão de policy. Estas linhas são
-- o mínimo que faz os testes medirem o que prometem.
--
-- Quem aplica: scripts/build-test-db.sh, no fim, depois do baseline e das
-- migrations. Mora aqui e não em supabase/seed.sql de propósito: no caminho
-- padrão da CLI ele seria aplicado antes de existir tabela, e falharia. Isto
-- nunca roda contra produção: só em banco descartável.

-- Um único uuid, usado como auth.users.id, public.users.uid e
-- enrollments.user_id — os testes derivam um do outro e precisam casar.
insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  raw_app_meta_data,
  raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000000',
  '11111111-1111-4111-8111-111111111111',
  'authenticated',
  'authenticated',
  'smoke@ci.local',
  '',
  now(),
  now(),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb
) on conflict (id) do nothing;

-- O trigger on_auth_user_created já cria a linha correspondente em
-- public.users. O `do update` não é redundante: ele fixa `roles` e
-- `current_plan_id` no valor que os testes procuram, em vez de deixar o
-- resultado depender do que handle_new_user() escolher hoje.
--
-- `roles` sem 'admin' e nenhuma linha em custom_domains: é exatamente o perfil
-- que 20260731000100 (gate de criador) e 20260901220000 (cota de domínio)
-- pescam com o `limit 1`.
insert into public.users (
  uid,
  email,
  display_name,
  username,
  roles,
  current_plan_id,
  creator_verification_status
) values (
  '11111111-1111-4111-8111-111111111111',
  'smoke@ci.local',
  'Smoke CI',
  'smoke-ci',
  '["student"]'::jsonb,
  'free',
  'none'
) on conflict (uid) do update set
  roles = excluded.roles,
  current_plan_id = excluded.current_plan_id,
  creator_verification_status = excluded.creator_verification_status;

-- 20260902120000 (segundo fator) matricula este usuário neste curso para provar
-- que a policy some com a matrícula numa sessão fraca.
insert into public.courses (
  id,
  owner_id,
  slug,
  title,
  summary,
  category,
  status,
  currency,
  price_amount_minor
) values (
  'smoke-ci-course',
  '11111111-1111-4111-8111-111111111111',
  'smoke-ci-course',
  'Smoke CI',
  'Curso usado só pelos smoke tests de RLS.',
  'smoke',
  'published',
  'brl',
  0
) on conflict (id) do nothing;
