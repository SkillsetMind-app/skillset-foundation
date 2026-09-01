-- O professor declarava, sozinho, que o próprio domínio estava verificado.
--
-- `claim_custom_domain` diz, no próprio comentário, qual é a regra:
--
--   "Sempre nasce pending_dns. Nunca active: a Vercel e quem decide se um
--    dominio esta verificado, e ate ela dizer que sim este dominio nao pode
--    aparecer em public_domains."
--
-- E `sync_own_custom_domain` desfazia isso: era EXECUTE para `authenticated` e
-- gravava `status` direto do argumento, `'active'` incluído. Qualquer criador
-- com domínio no plano podia chamá-la pelo PostgREST com o próprio JWT e marcar
-- como verificado um hostname que nunca passou pela Vercel — entrando em
-- `public_domains`, que é a tabela que o proxy lê (com a chave anon) para
-- decidir de quem é a vitrine servida naquele host.
--
-- As duas funções afirmavam coisas contrárias sobre a mesma invariante, e a
-- permissiva vencia.
--
-- O status de verificação é um fato do SERVIDOR: quem o conhece é a rota que
-- acabou de falar com a API da Vercel. Ela só o escrevia com o JWT do usuário
-- porque usava `createSupabaseServerClient()`. A correção separa as duas
-- coisas: a rota autoriza o dono (como já fazia) e grava pelo service_role,
-- passando o dono explicitamente — a checagem de posse continua no banco.
--
-- Sem janela de risco: `custom_domains` está com zero linhas hoje.

create or replace function public.sync_custom_domain_status(
  p_id text,
  p_owner_uid text,
  p_status text,
  p_verification_name text default null,
  p_verification_value text default null,
  p_error_reason text default null
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if p_owner_uid is null or btrim(p_owner_uid) = '' then
    raise exception 'owner uid is required' using errcode = '22023';
  end if;

  if p_status not in ('pending_dns', 'pending_verification', 'active', 'error') then
    raise exception 'unknown status: %', p_status using errcode = 'P0001';
  end if;

  -- O `and owner_uid` continua sendo o que impede escrever no domínio de
  -- outro. O chamador é o service_role, mas ele passa o dono que a rota já
  -- autorizou — a posse segue provada no banco, não só na aplicação.
  update public.custom_domains
     set status             = p_status,
         verification_name  = p_verification_name,
         verification_value = p_verification_value,
         error_reason       = p_error_reason,
         verified_at        = case
                                when p_status = 'active' then coalesce(verified_at, now())
                                else null
                              end
   where id = p_id
     and owner_uid = p_owner_uid;
end;
$function$;

revoke all on function public.sync_custom_domain_status(text, text, text, text, text, text) from public;
revoke all on function public.sync_custom_domain_status(text, text, text, text, text, text) from anon, authenticated;
grant execute on function public.sync_custom_domain_status(text, text, text, text, text, text) to service_role;

comment on function public.sync_custom_domain_status(text, text, text, text, text, text) is
  'Grava o status de verificacao de um dominio a partir da resposta da Vercel. '
  'Service-role apenas: o status e fato do servidor, nunca declaracao do dono.';

-- A versão antiga fica sem EXECUTE para o usuário logado. Não é derrubada para
-- não quebrar uma instância cujo deploy de código ainda não subiu; para o
-- service_role ela continua inofensiva.
revoke execute on function public.sync_own_custom_domain(text, text, text, text, text) from anon, authenticated;

comment on function public.sync_own_custom_domain(text, text, text, text, text) is
  'OBSOLETA: permitia ao proprio dono declarar status=active sem passar pela '
  'Vercel. Sem EXECUTE para authenticated. Use sync_custom_domain_status.';

-- Prova, na própria migration: nenhum papel de usuário final pode mais declarar
-- um domínio verificado.
DO $verify$
BEGIN
  IF has_function_privilege('authenticated',
       'public.sync_own_custom_domain(text,text,text,text,text)', 'EXECUTE')
     OR has_function_privilege('anon',
       'public.sync_own_custom_domain(text,text,text,text,text)', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'sync_own_custom_domain ainda e executavel por usuario final.';
  END IF;

  IF has_function_privilege('authenticated',
       'public.sync_custom_domain_status(text,text,text,text,text,text)', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'sync_custom_domain_status nao pode ser executavel por authenticated.';
  END IF;

  IF NOT has_function_privilege('service_role',
       'public.sync_custom_domain_status(text,text,text,text,text,text)', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'service_role precisa executar sync_custom_domain_status.';
  END IF;
END;
$verify$;
