-- Certificado retirado por reembolso integral ou chargeback perdido.
--
-- Por que: o webhook do Stripe retira o certificado de quem teve a compra
-- devolvida (reembolso integral ou chargeback perdido), sem travar a recompra.
-- O issue_skillset_certificate (20260808150000_whitelabel_platform_brand.sql)
-- recusa reemitir so o status 'revoked' ("This certificate was revoked by
-- Skillset operations.") e volta para 'issued' qualquer outra linha existente.
-- Por isso o reembolso grava um status proprio:
--   - 'revoked'        continua sendo decisao da operacao e bloqueia a reemissao;
--   - 'refund_revoked' e gravado pelo webhook; quem compra de novo e conclui
--                      reemite o mesmo certificado pelo issue_skillset_certificate;
--   - o verify_skillset_certificate so atesta 'issued', entao os dois aparecem
--     como invalidos na verificacao publica.
--
-- O check original (baseline remote_schema_2026-07-21.sql) aceita so 'issued'
-- e 'revoked', e recusaria a escrita do webhook. Esta migration so amplia o
-- check: nenhuma linha existente muda, nenhum outro objeto e tocado.
--
-- Re-executavel: drop if exists + add.

alter table public.certificates drop constraint if exists certificates_status_check;
alter table public.certificates add constraint certificates_status_check
  check (status = any (array['issued'::text, 'revoked'::text, 'refund_revoked'::text]));
