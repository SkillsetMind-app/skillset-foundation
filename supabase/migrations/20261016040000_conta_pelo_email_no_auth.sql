-- A compra sem login acha a conta pelo e-mail em auth.users, a fonte que o
-- login usa. public.users.email e editavel pelo dono e nao serve para isso.
-- So o servidor (service_role) chama; o navegador nunca.
--
-- O GoTrue grava o e-mail em minusculas, e o indice parcial unico
-- (email where is_sso_user = false) atende esta busca.

create or replace function public.find_auth_user_id_by_email(p_email text)
returns uuid
language sql
stable
security definer set search_path = ''
as $$
  select u.id
  from auth.users u
  where u.email = lower(btrim(p_email))
    and u.is_sso_user = false
    and u.deleted_at is null
  limit 1;
$$;

revoke all on function public.find_auth_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.find_auth_user_id_by_email(text) to service_role;
