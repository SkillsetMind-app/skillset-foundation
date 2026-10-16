-- O bucket privado `course-content` passa a aceitar só tipos que o navegador
-- mostra sem rodar script, ou que ele só baixa.
--
-- Por quê: um SVG subia como material da aula e o "Open file" abria o link
-- assinado numa aba; o <script> do SVG rodava no domínio do storage. O Supabase
-- só troca text/html por text/plain; SVG e XML passavam. O cliente agora grava
-- esses arquivos como application/octet-stream (courseContentMimeTypes em
-- src/domain/course-asset.ts), mas um envio forjado pula o cliente: a trava que
-- dura é a linha do bucket. É o "abuso por conta de dono" que 20260723000100
-- deixou para quando aparecesse.
--
-- A lista é espelho de courseContentMimeTypes (materiais-extensoes.test.ts
-- confere). Todo tipo que o cliente aceita e não está aqui sobe como
-- application/octet-stream, que está: nenhum envio do app é recusado. O
-- Storage entende o curinga da família (video/*, audio/*).
--
-- Só envios NOVOS; arquivos já gravados não mudam. O teto de tamanho e as
-- policies de leitura (matrícula viva + aula liberada) ficam como estão.
-- Idempotente.
update storage.buckets
set
  allowed_mime_types = array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel.sheet.macroenabled.12',
    'application/zip',
    'application/x-zip-compressed',
    'application/epub+zip',
    'application/vnd.xmind.workbook',
    'application/x-freemind',
    'application/octet-stream',
    'text/csv',
    'text/plain',
    'text/markdown',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/avif',
    'audio/*',
    'video/*'
  ]
where id = 'course-content';
