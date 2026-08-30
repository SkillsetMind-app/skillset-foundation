-- O mecanismo anti-abuso era o vetor de abuso (auditoria 2026-08-30, DB-01/DB-02).
--
-- verify_skillset_certificate monta a chave do limite assim:
--
--     v_key := coalesce((select auth.uid())::text,
--                       nullif(btrim(coalesce(p_rate_key, '')), ''),
--                       'anon');
--
-- Para quem não está logado, auth.uid() é nulo e a chave passa a ser
-- p_rate_key — um parâmetro que o próprio chamador manda. Duas consequências,
-- as duas medidas no banco de produção:
--
--   1. O teto de 60/hora nunca é atingido: basta mandar um valor novo a cada
--      requisição para ganhar um balde novo a cada requisição.
--   2. Pior: enforce_rate_limit faz INSERT ... ON CONFLICT DO NOTHING para toda
--      chave inédita, e public.rate_limits não tem limpeza (a linha mais antiga
--      é de 01/07 e continua lá). Cada requisição com chave nova grava uma linha
--      PERMANENTE. Uma parte não autenticada enche o disco e a conta.
--
-- Por que não basta ignorar p_rate_key: a rota /api/certificates/verify usa o
-- cliente anônimo do Supabase, não o service role, então o banco não consegue
-- distinguir "veio pela nossa rota, com o IP que ela apurou" de "chamada direta
-- ao RPC". Não há sinal confiável para privilegiar um dos dois.
--
-- A correção então não é confiar melhor na chave: é LIMITAR O ESPAÇO DELA.
-- A chave do chamador vira um de 256 baldes por hash. O limite continua
-- valendo (colisão só deixa mais estrito, nunca mais frouxo), e a tabela não
-- pode passar de 256 linhas para esta funcionalidade, aconteça o que acontecer.
-- Quem está logado continua com balde próprio pelo uid, que é identidade que
-- nós emitimos e ele não escolhe.

create or replace function public.verify_skillset_certificate(
  p_code text,
  p_rate_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_uid text := (select auth.uid())::text;
  v_key text;
  v_cert public.certificates%rowtype;
begin
  if v_code = '' or length(v_code) > 80 then
    raise exception 'A valid verification code is required.' using errcode = 'P0001';
  end if;

  if v_uid is not null then
    -- Identidade que a plataforma emitiu: o chamador não a escolhe.
    v_key := 'uid_' || v_uid;
  else
    -- Chave vinda do chamador: nunca usada crua. Vira um de 256 baldes, então
    -- o espaço de chaves — e portanto o número de linhas em rate_limits — é
    -- limitado por construção, sem depender da boa-fé de quem chama.
    v_key := 'anon_' || substr(md5(coalesce(nullif(btrim(p_rate_key), ''), 'anon')), 1, 2);
  end if;

  perform public.enforce_rate_limit('cert_verify_' || v_key, 60, 3600000);

  select * into v_cert
  from public.certificates
  where verification_code = v_code and status = 'issued'
  limit 1;

  if not found then
    return jsonb_build_object('valid', false);
  end if;

  return jsonb_build_object(
    'valid', true,
    'certificate', jsonb_build_object(
      'courseTitle', v_cert.course_title,
      'courseCategory', v_cert.course_category,
      'authorityLabel', coalesce(
        nullif(v_cert.authority_label, ''),
        'Skillset Verified'
      ),
      'verificationCode', v_cert.verification_code,
      'issuedAt', to_jsonb(v_cert.issued_at)
    )
  );
end;
$function$;

-- A asserção É o teste: prova que o espaço de chaves ficou limitado.
do $$
declare
  v_def text;
  v_distintas int;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'verify_skillset_certificate';

  assert v_def like '%md5(%',
    'a chave do limite voltou a ser usada crua, sem virar balde';

  -- 10 mil chaves diferentes de chamador não podem gerar mais de 256 baldes.
  select count(distinct substr(md5(i::text), 1, 2)) into v_distintas
  from generate_series(1, 10000) as g(i);
  assert v_distintas <= 256,
    format('o hash gerou %s baldes distintos, esperado no maximo 256', v_distintas);
end $$;
