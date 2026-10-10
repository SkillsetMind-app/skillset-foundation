-- O arquivo da aula ganha nome e ordem.
--
-- Antes: a lista de materiais saía na ordem alfabética do nome do arquivo
-- (src/lib/data/course-assets.ts), e o aluno lia "apostila-final-v3.pdf". O
-- professor não tinha como dar um nome legível nem escolher a ordem.
--
-- 1. course_assets.title: o nome que o aluno vê. Nulo = vale o file_name.
-- 2. course_assets.position: a ordem dentro da aula, a partir de 0. Nula = vai
--    para o fim da lista.
-- 3. Backfill das linhas que já existem: título = nome do arquivo; posição =
--    a ordem alfabética de hoje dentro de cada aula, para nada mudar de lugar
--    na tela de quem já comprou.
--
-- Só acrescenta. Nenhuma policy, função ou gatilho muda: quem lê e quem altera
-- continua decidido por course_assets_select, course_assets_update_owner e
-- pelas policies do bucket course-content (matrícula viva + aula liberada,
-- 20260915020000).
--
-- As duas colunas ficam anuláveis e sem default de propósito: o envio de
-- arquivo que já está no ar não manda título nem posição, e "not null"
-- recusaria todo envio até o código novo subir. A tela trata o nulo.
--
-- Idempotente: colunas com "if not exists", restrições trocadas por drop/add
-- com o mesmo nome, e o backfill só toca o que ainda está nulo. Rodar duas
-- vezes deixa o banco igual.

alter table public.course_assets add column if not exists title text;
alter table public.course_assets add column if not exists position integer;

comment on column public.course_assets.title is
  'Nome do arquivo que o aluno ve. Nulo: a tela mostra file_name. O download continua com file_name.';
comment on column public.course_assets.position is
  'Ordem do arquivo na aula, a partir de 0. Nula: vai para o fim (a tela ordena por posicao e depois pelo nome).';

-- Backfill do título. btrim e nullif: um nome só de espaços não vira título
-- vazio (a restrição abaixo recusa); fica nulo e a tela mostra o file_name.
update public.course_assets
   set title = nullif(btrim(file_name), '')
 where title is null;

-- Backfill da posição: a ordem que o aluno vê hoje (nome do arquivo, sem
-- diferenciar maiúscula), contada dentro de cada aula. Material sem aula (do
-- curso inteiro) forma o grupo dele, por curso.
with ordem as (
  select a.id,
         row_number() over (
           partition by a.course_id, a.lesson_id
           order by lower(a.file_name), a.file_name, a.id
         ) - 1 as pos
    from public.course_assets a
)
update public.course_assets a
   set position = o.pos
  from ordem o
 where a.id = o.id
   and a.position is null;

-- Limites. O professor grava título e posição direto pelo cliente (a policy de
-- update do dono), então o banco segura o tamanho.
alter table public.course_assets drop constraint if exists course_assets_title_check;
alter table public.course_assets add constraint course_assets_title_check
  check (title is null or (btrim(title) <> '' and char_length(title) <= 180));

alter table public.course_assets drop constraint if exists course_assets_position_check;
alter table public.course_assets add constraint course_assets_position_check
  check (position is null or position between 0 and 10000);
