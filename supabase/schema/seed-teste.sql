-- Fixtures mínimas para os smoke tests de RLS de supabase/tests/.
--
-- Por que este arquivo existe: os smoke tests foram escritos contra um banco
-- vivo e leem um usuário e um curso REAIS (`select ... limit 1` + `\gset`).
-- Num Postgres recém-criado a partir das migrations essas tabelas estão vazias,
-- o `\gset` aborta e o teste falha por falta de dado — não por regressão de
-- policy. Estas linhas são o mínimo que faz os testes medirem o que prometem.
--
-- Quem aplica: scripts/build-test-db.sh, no fim, depois do baseline e das
-- migrations. Mora aqui e nao em supabase/seed.sql de proposito: no caminho
-- padrao da CLI ele seria aplicado por `supabase db start` antes de existir
-- tabela, e falharia. Isto nunca roda contra producao: so em banco descartavel.

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

-- `roles` sem 'admin' e sem nenhuma linha em custom_domains: é exatamente o
-- perfil que 20260731000100 (gate de criador) e 20260901220000 (cota de
-- domínio) procuram com o `limit 1`.
insert into public.users (
  uid,
  email,
  display_name,
  username,
  roles,
  current_plan_id,
  creator_verification_status,
  created_at,
  updated_at
) values (
  '11111111-1111-4111-8111-111111111111',
  'smoke@ci.local',
  'Smoke CI',
  'smoke-ci',
  '["student"]'::jsonb,
  'free',
  'pending',
  now()::text,
  now()::text
) on conflict do nothing;

-- 20260902120000 (segundo fator) matricula este usuário neste curso para provar
-- que a policy some com a matrícula numa sessão fraca.
insert into public.courses (
  id,
  owner_id,
  slug,
  title,
  status,
  currency,
  price_amount_minor,
  created_at,
  updated_at
) values (
  'smoke-ci-course',
  '11111111-1111-4111-8111-111111111111',
  'smoke-ci-course',
  'Smoke CI',
  'published',
  'brl',
  0,
  now()::text,
  now()::text
) on conflict (id) do nothing;
