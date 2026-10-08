-- "O upload de imagem não estava disponível, como se o botão não funcionasse"
-- (fundador, 06/10, criando curso passo a passo). Não era o Storage: na sessão
-- dele nenhuma requisição de upload chegou ao Storage. Era o Realtime.
--
-- Desde #355 (12/09) todo canal do navegador nasce privado
-- (src/lib/supabase/client.ts) e o projeto está em "private only". Canal
-- privado só entra se realtime.messages tiver policy de leitura para o tópico,
-- e a única que existe é a da presença da comunidade (20260912020000). Então o
-- Realtime recusa TODA inscrição de Postgres Changes. Log de produção, 06/10:
--   Unauthorized: You do not have permissions to read from this Channel topic:
--   courses:builder:<id>  (e users:, notifications:user:, course_assets:, ...)
--
-- O construtor de curso só fica sabendo que o autosave gravou pelo eco do
-- Realtime. Sem eco, módulo e aula criados na sessão nunca contam como
-- gravados: a capa do módulo fica desabilitada (pointer-events-none) e a aula
-- fica em "Saving lesson…" sem o botão de vídeo, até recarregar a página. As
-- outras inscrições (notificação, pedido pago, matrícula, mídia do curso)
-- estão paradas pelo mesmo motivo.
--
-- Esta policy devolve a entrada nos canais de Postgres Changes:
--   - só a extensão broadcast, que é a leitura que o Realtime confere ao
--     entrar. Ninguém transmite broadcast nesses tópicos (não há policy de
--     INSERT para broadcast nem realtime.send no banco), então entrar não abre
--     dado nenhum: cada mudança continua passando pela RLS da própria tabela,
--     como antes de #355;
--   - nunca a presença da comunidade: community-presence:% continua só com as
--     policies de 20260912020000 (dono, aluno ou admin);
--   - conta suspensa ou sessão revogada não entra (account_session_allowed),
--     igual à presença;
--   - só authenticated. Visitante sem login fica sem live update, como já
--     estava desde 12/09.
-- ponytail: uma policy para todos os tópicos de Postgres Changes, porque quem
-- filtra o dado é a RLS da tabela. Dono por tópico só se algum dia houver
-- broadcast de verdade num desses canais.

drop policy if exists realtime_postgres_changes_join on realtime.messages;
create policy realtime_postgres_changes_join
on realtime.messages
for select
to authenticated
using (
  extension = 'broadcast'
  and (select realtime.topic()) not like 'community-presence:%'
  and (select public.account_session_allowed())
);
