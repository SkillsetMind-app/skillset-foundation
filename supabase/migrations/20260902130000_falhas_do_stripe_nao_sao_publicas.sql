-- Uma view não herda a proteção da tabela que ela lê.
--
-- 20260901150000 criou public.stripe_events_needing_attention sobre
-- processed_stripe_events, que é a tabela mais bem trancada do schema: RLS
-- habilitado, FORCE ROW LEVEL SECURITY, zero policies e zero privilégios fora
-- do service role. O comentário daquela migration afirma que a view "fica em
-- SECURITY INVOKER (padrão)". As duas metades da frase estão erradas, e é por
-- isso que esta migration existe:
--
--   1. security_invoker NÃO é o padrão. Uma view nasce com
--      security_invoker = false e executa com os privilégios do dono
--      (postgres, que tem BYPASSRLS), de modo que o RLS da tabela-base nunca
--      chega a ser consultado. A opção precisa ser pedida explicitamente.
--
--   2. `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO anon, authenticated`
--      — padrão do Supabase — vale para views também. A view nasceu com
--      SELECT, INSERT, UPDATE e DELETE concedidos a anon e a authenticated,
--      sem que nada na migration pedisse por isso.
--
-- Somadas, as duas põem no surface do PostgREST uma view que não consulta o
-- RLS. A tabela seguia trancada; o objeto ao lado dela, não. E como a view não
-- tem WITH CHECK OPTION e a única coluna obrigatória da tabela aparece nela
-- (as demais têm default), o alcance não parava na leitura: ia até o
-- livro-razão de idempotência do webhook do Stripe, que é o que impede um
-- evento de pagamento de ser processado duas vezes ou nenhuma.
--
-- Nenhum código consome esta view — `grep -rn stripe_events_needing_attention src/`
-- devolve só um comentário. O consumidor pretendido é operacional, pelo service
-- role, e esse caminho fica intacto: service_role e postgres têm SELECT na
-- tabela-base e BYPASSRLS, então continuam enxergando as linhas normalmente.
--
-- Mesmo padrão de 20260830174059 (sync_public_domain) e de 20260704190640
-- (revoke_anon_execute_on_security_definer_functions): objeto criado sem
-- considerar o grant default, fechado depois.
-- Sinalizado pelo linter do Supabase como security_definer_view.

-- 1. A view passa a respeitar o RLS e os privilégios de quem consulta.
alter view public.stripe_events_needing_attention set (security_invoker = true);

-- 2. E sai do surface de anon/authenticated. As duas linhas resolvem coisas
--    diferentes: a primeira faz a view honrar o RLS da tabela-base, a segunda
--    tira a view do PostgREST para esses papéis. Qualquer uma sozinha deixa
--    metade do problema de pé.
revoke all on public.stripe_events_needing_attention from anon, authenticated;

comment on view public.stripe_events_needing_attention is
  'Eventos do Stripe que não concluíram. Vazia é o estado saudável; qualquer linha aqui significa que alguém pode ter pago sem receber acesso. Restrita ao service role: security_invoker = true e sem privilégios para anon/authenticated.';

-- ponytail: a assercao E o teste - falha alto se um privilegio ou a opcao voltarem.
do $$
declare
  privilegios int;
  invoker text;
begin
  select count(*) into privilegios
  from (values ('anon'), ('authenticated')) as papel(nome)
  cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as p(priv)
  where has_table_privilege(
    papel.nome, 'public.stripe_events_needing_attention', p.priv
  );
  assert privilegios = 0,
    format('view ainda alcancavel por anon/authenticated: %s privilegios', privilegios);

  select coalesce((
    select option_value
    from pg_options_to_table(c.reloptions)
    where option_name = 'security_invoker'
  ), 'false')
  into invoker
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'stripe_events_needing_attention';
  assert invoker = 'true',
    format('view ainda atravessa o RLS da tabela-base: security_invoker = %s', invoker);
end $$;
