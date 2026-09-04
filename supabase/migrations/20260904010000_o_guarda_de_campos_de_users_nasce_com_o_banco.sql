-- O guarda dos campos server-controlled de `users` existe em produção desde
-- 31/07, mas nunca existiu numa migration.
--
-- 20260731000100_protect_creator_gate_fields.sql cria a FUNÇÃO
-- `users_field_guard()` e diz, no próprio cabeçalho, que é "the versioned source
-- for new environments". Só que o `CREATE TRIGGER` que liga a função à tabela
-- ficou de fora: foi aplicado à mão via psql e só sobreviveu no snapshot
-- `supabase/schema/remote_schema_2026-07-21.sql`, que não é aplicado por
-- ninguém. Os dois irmãos dele (`users_sync_public_profile_aiu` e
-- `users_drop_public_profile_ad`) estão em migrations; este não estava.
--
-- Consequência: a função existe, o comentário promete proteção, e qualquer
-- banco montado a partir das migrations -- o efêmero do CI, um staging, um
-- restore de desastre -- nasce SEM o trigger. Nesse banco a policy de
-- self-update de `users` (larga de propósito, para edição de perfil) deixa o
-- cliente escrever direto pelo PostgREST em:
--
--   roles                            -> vira admin
--   creator_verification_status      -> aprova o próprio cadastro
--   activation_fee_paid_at           -> pula a taxa de ativação
--   stripe_connect_charges_enabled   -> liga cobrança sem Connect
--   stripe_connect_payouts_enabled   -> liga repasse sem Connect
--
-- Produção está coberta (verificado em 04/09: o trigger está lá e habilitado).
-- Esta migration é no-op lá e o gate que faltava em todo o resto.

do $$
begin
  -- CREATE, nunca DROP+CREATE: em produção o trigger já existe e derrubá-lo
  -- para recriar pegaria ACCESS EXCLUSIVE em `users` para não mudar nada.
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'users_field_guard_biu'
      and tgrelid = 'public.users'::regclass
      and not tgisinternal
  ) then
    create trigger users_field_guard_biu
      before insert or update on public.users
      for each row execute function public.users_field_guard();
  end if;
end $$;

-- A asserção É o teste, no mesmo espírito de lesson_playback: se um ambiente
-- futuro voltar a montar `users` sem o guarda, a migration falha alto em vez de
-- entregar um banco que aceita auto-promoção.
do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'users_field_guard_biu'
      and tgrelid = 'public.users'::regclass
      and not tgisinternal
      and tgenabled <> 'D'
  ) then
    raise exception
      'users_field_guard_biu ausente ou desabilitado: sem ele o cliente escreve roles, creator_verification_status, activation_fee_paid_at e as flags do Connect direto pelo PostgREST.';
  end if;
end $$;
