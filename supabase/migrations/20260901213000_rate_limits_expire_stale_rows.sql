-- A tabela rate_limits crescia sem teto (auditoria 2026-08-30, DB-02).
--
-- enforce_rate_limit faz INSERT ... ON CONFLICT (key) DO NOTHING para toda
-- chave inédita, e nada, nunca, apagava uma linha: a mais antiga em produção
-- era de 01/07 e continuava lá. Metade das chaves vem do lado de fora — o hash
-- do IP de quem bate em /api/csp-report, /api/auth/pwned-check,
-- /api/courses/*/offers, video-token e /api/assistant sem sessão — então cada
-- endereço novo era uma linha permanente. 20260830120100 fechou o caso pior
-- (a chave crua de verify_skillset_certificate virou um de 256 baldes), mas a
-- tabela seguia só crescendo.
--
-- Uma linha sem toque há mais de 2 dias está fora de QUALQUER janela em uso
-- (a maior é de 24h: o teto diário do advisor e do assistant). A próxima
-- chamada com aquela chave a reiniciaria de qualquer jeito — enforce_rate_limit
-- zera o balde quando v_now - window_started_at passa da janela — então apagar
-- não afrouxa nem aperta nenhum limite. Só devolve o disco.
--
-- pg_cron existe em produção (1.6.4, ligado pelo dashboard) e já roda o
-- recálculo de trending. Num banco sem a extensão a função fica criada e o
-- agendamento é pulado com aviso, para esta migration não quebrar a réplica.
-- ponytail: sem índice em updated_at — com a limpeza rodando, a tabela é
-- pequena; criar um se o seq scan horário aparecer em pg_stat_statements.

create or replace function public.purge_stale_rate_limits()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_apagadas integer;
begin
  delete from public.rate_limits
  where updated_at < now() - interval '2 days';

  get diagnostics v_apagadas = row_count;
  return v_apagadas;
end;
$function$;

-- Só o job (e o service_role, para rodar à mão) chama isto.
revoke execute on function public.purge_stale_rate_limits() from public, anon, authenticated;
grant execute on function public.purge_stale_rate_limits() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'purge-stale-rate-limits') then
      perform cron.unschedule('purge-stale-rate-limits');
    end if;
    perform cron.schedule(
      'purge-stale-rate-limits',
      '23 * * * *',
      'select public.purge_stale_rate_limits()'
    );
  else
    raise notice 'pg_cron ausente: agende public.purge_stale_rate_limits() por fora';
  end if;
end $$;

-- A asserção É o teste: a linha velha some, a linha dentro da janela fica.
do $$
declare
  v_marca text := md5(clock_timestamp()::text);
  v_velha text := 'migration_selfcheck_velha_' || v_marca;
  v_nova  text := 'migration_selfcheck_nova_' || v_marca;
begin
  insert into public.rate_limits (key, count, window_started_at, updated_at)
  values
    (v_velha, 1, now() - interval '3 days', now() - interval '3 days'),
    (v_nova,  1, now(), now());

  perform public.purge_stale_rate_limits();

  assert not exists (select 1 from public.rate_limits where key = v_velha),
    'a linha expirada nao foi apagada';
  assert exists (select 1 from public.rate_limits where key = v_nova),
    'uma linha dentro da janela foi apagada';

  delete from public.rate_limits where key = v_nova;
end $$;
