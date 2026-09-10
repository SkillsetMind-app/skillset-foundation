-- O advisor de seguranca do Supabase (function_search_path_mutable) aponta tres
-- funcoes que nasceram sem `set search_path` em 20260820000000_custom_domains e
-- 20260820010000_course_landing_pages. Com o search_path aberto, a resolucao
-- de nomes dentro delas depende de quem chama.
--
-- Nenhuma e SECURITY DEFINER e os corpos nao citam objeto nenhum (so CASE,
-- COALESCE, `<>` e literais), entao nao ha sequestro demonstravel hoje: o pino
-- vale para o dia em que alguem editar um destes corpos, e deixa o advisor
-- limpo. Mesma escolha da 20260718000100 para platform_fee_bps_for_plan: corpo
-- sem objetos => search_path = '' (pg_catalog continua implicito, entao CASE,
-- COALESCE e o operador de texto seguem resolvendo).
--
-- ALTER, e nao create or replace: o corpo nao muda, e um create or replace sem
-- o SET foi exatamente o que apagou o pino da platform_fee_bps_for_plan.

alter function public.custom_domain_limit_for_plan(text) set search_path = '';
alter function public.landing_block_limit_for_plan(text) set search_path = '';
alter function public.landing_template_allowed(text, text) set search_path = '';
