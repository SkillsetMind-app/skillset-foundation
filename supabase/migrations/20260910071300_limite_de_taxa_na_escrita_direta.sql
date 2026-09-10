-- Aluno fazia spam na comunidade e no suporte sem limite nenhum.
--
-- P2-9 da auditoria de permissões de 10/09. As cinco tabelas abaixo recebem
-- INSERT direto do navegador pelo PostgREST. A RLS confere autoria e
-- matrícula, mas não quantas vezes: um aluno matriculado (ou qualquer conta
-- logada, no caso dos tickets) gravava milhares de linhas por minuto com um
-- script, e as rotas com limite nem ficam nesse caminho.
--
-- Agora um trigger BEFORE INSERT em cada tabela chama enforce_rate_limit, o
-- mesmo das RPCs, com chave por pessoa e por tabela e janela de uma hora:
--   community_posts      20/h  perguntas, compartilhamentos e avisos
--   community_comments  120/h  respostas; o professor que zera a caixa de
--                              entrada responde perto de uma por minuto
--   lesson_comments     120/h  tabela antiga, sem tela desde 07/09
--   community_reports    20/h
--   support_tickets      10/h
-- A recusa é a exceção RATE_LIMIT de sempre, e a tela traduz. Uma gravação que
-- a RLS recusa desfaz a transação inteira, contagem incluída: só conta o que
-- entrou de fato.
--
-- Sem teto: service_role (rotas do servidor) e escrita confiável do banco
-- (skillset.trusted_write, que só RPCs e manutenção ligam). Sem sessão não há
-- de quem contar, e a RLS já recusa anon.
--
-- Fora: limite por IP e captcha, contra contas novas em série.

create function public.limit_direct_insert_rate()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid text := auth.uid()::text;
begin
  if v_uid is null or public.is_service_role()
     or current_setting('skillset.trusted_write', true) = 'on' then
    return new;
  end if;
  -- ponytail: janela fixa do enforce_rate_limit; quem estoura espera vencer a
  -- hora aberta pela primeira gravação. Janela deslizante, se isso incomodar.
  perform public.enforce_rate_limit('insert_' || tg_table_name || '_' || v_uid, tg_argv[0]::int, 3600000);
  return new;
end;
$$;

revoke all on function public.limit_direct_insert_rate() from public, anon, authenticated;

-- O argumento é o teto por hora daquela tabela.
create trigger community_posts_insert_rate before insert on public.community_posts
  for each row execute function public.limit_direct_insert_rate(20);
create trigger community_comments_insert_rate before insert on public.community_comments
  for each row execute function public.limit_direct_insert_rate(120);
create trigger lesson_comments_insert_rate before insert on public.lesson_comments
  for each row execute function public.limit_direct_insert_rate(120);
create trigger community_reports_insert_rate before insert on public.community_reports
  for each row execute function public.limit_direct_insert_rate(20);
create trigger support_tickets_insert_rate before insert on public.support_tickets
  for each row execute function public.limit_direct_insert_rate(10);
