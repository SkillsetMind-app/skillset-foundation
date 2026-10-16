\set ON_ERROR_STOP on
-- Banco descartavel apenas. Fixtures voltam no ROLLBACK.
--
-- Apagar produto limpa tudo (20261008030000_apagar_produto_limpa_tudo.sql):
--   - rascunho com post e comentario do professor, convite pendente, sessao,
--     desejo e video: apaga, e a fila guarda o video com o recibo (e nao o
--     material, que nao e video);
--   - a linha da fila nasce na mesma transacao: DELETE que falha nao deixa
--     linha; DELETE direto pela tabela tambem deixa linha;
--   - curso com matricula (mesmo reembolsada) ou assinatura: arquiva;
--   - outro professor recebe o mesmo "nao achei" de um id que nao existe;
--   - a fila e so do service role: o cliente nao le nem grava; o dono ve as
--     proprias linhas pela funcao do selo (so as pending), e mais ninguem ve;
--   - a funcao antiga delete_teacher_course_draft nao e mais do cliente;
--   - a lista de arquivos e so do service role, so da pasta certa (com a
--     barra final), so do que nasceu enquanto o curso existia, marca o arquivo
--     que outro curso vivo usa, e recusa id perigoso, id sem pedido, id
--     reaproveitado e limpeza cancelada;
--   - o cliente nunca cria nem renomeia curso para um id que ja passou pela
--     fila (pending, cancelled ou done); quem nem poderia inserir a linha
--     recebe o erro da RLS, sem descobrir se o id esta na fila; a equipe
--     (service role) ainda recria para restaurar;
--   - video so pode sair com a fila pending, o id sem dono e ninguem citando;
--   - o admin apaga pelo mesmo caminho, com post do dono no curso.
begin;
create temp table del_checks (name text, passed boolean);
grant insert, select on del_checks to authenticated, service_role;
create function pg_temp.check_del(p_name text, p_ok boolean) returns void
language sql as $$ insert into del_checks values (p_name, coalesce(p_ok, false)); $$;
create function pg_temp.uid(n int) returns uuid language sql immutable as $$
  select ('61008030-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$$;
create function pg_temp.act_as(p_uid uuid, p_role text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config('request.jwt.claim.role', p_role, true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_uid, 'role', p_role, 'aal', 'aal2')::text, true);
  perform set_config('skillset.trusted_write', 'off', true);
end $$;
-- Linhas que o comando mudou. A RLS recusa DELETE em silencio (0 linhas).
create function pg_temp.affected(p_sql text) returns int language plpgsql as $$
declare n int;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end $$;
-- 'SQLSTATE: mensagem' do erro. Se passar, e desfeito e devolve 'Z0001: no error'.
create function pg_temp.error_of(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  raise exception 'no error' using errcode = 'Z0001';
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;

-- 1 professor dono · 2 outro professor · 3 admin · 4 aluno
select pg_temp.act_as(null, 'service_role');
select set_config('skillset.trusted_write', 'on', true);
insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select pg_temp.uid(n), 'authenticated', 'authenticated', 'del-smoke-' || n || '@example.test',
  now(), '{}', '{}', now(), now()
from generate_series(1, 4) n;
-- Keep the creator plan current so this smoke exercises its original guard.
insert into public.subscriptions(id, user_id, plan_id, status, current_period_end)
select 'smoke-plan-' || pg_temp.uid(n)::text, pg_temp.uid(n)::text, 'basic', 'active', now() + interval '1 day'
from (values (1)) owners(n);
update public.users set display_name = 'Del ' || right(uid, 1)
  where uid in (select pg_temp.uid(n)::text from generate_series(1, 4) n);
update public.users
  set roles = '["student","teacher"]', teacher_terms_accepted_at = now(), teacher_terms_version = 'smoke',
      activation_fee_paid_at = now()
  where uid in (pg_temp.uid(1)::text, pg_temp.uid(2)::text, pg_temp.uid(3)::text);
update public.users set roles = '["student","teacher","admin"]' where uid = pg_temp.uid(3)::text;

insert into public.courses(id, owner_id, slug, title, title_key, summary, category, status, payment_type,
  price_amount_minor, currency, community_enabled, cover_image_url)
values
  ('smoke-del-a', pg_temp.uid(1)::text, 'smoke-del-a-slug', 'Smoke del A', 'smoke-del-a',
   'Curso usado so por este smoke.', 'smoke', 'draft', 'free', 0, 'USD', true, null),
  -- Prefixo vizinho: 'courses/smoke-del-a-b/' comeca com 'courses/smoke-del-a'.
  -- E a capa dele e "emprestada" do A: a limpeza do A nao pode apagar.
  ('smoke-del-a-b', pg_temp.uid(2)::text, 'smoke-del-a-b-slug', 'Smoke del A-B', 'smoke-del-a-b',
   'Curso usado so por este smoke.', 'smoke', 'draft', 'free', 0, 'USD', true,
   'https://example.supabase.co/storage/v1/object/public/public-media/courses/smoke-del-a/landing/hero.webp'),
  ('smoke-del-buyer', pg_temp.uid(1)::text, 'smoke-del-buyer-slug', 'Smoke del buyer', 'smoke-del-buyer',
   'Curso usado so por este smoke.', 'smoke', 'published', 'free', 0, 'USD', true, null),
  ('smoke-del-sub', pg_temp.uid(1)::text, 'smoke-del-sub-slug', 'Smoke del sub', 'smoke-del-sub',
   'Curso usado so por este smoke.', 'smoke', 'published', 'free', 0, 'USD', true, null),
  ('smoke-del-admin', pg_temp.uid(1)::text, 'smoke-del-admin-slug', 'Smoke del admin', 'smoke-del-admin',
   'Curso usado so por este smoke.', 'smoke', 'draft', 'free', 0, 'USD', true, null),
  ('smoke-del-direct', pg_temp.uid(1)::text, 'smoke-del-direct-slug', 'Smoke del direct', 'smoke-del-direct',
   'Curso usado so por este smoke.', 'smoke', 'draft', 'free', 0, 'USD', false, null);

-- So o aluno 4 comprou: matricula reembolsada no 'buyer', assinatura no 'sub'.
insert into public.enrollments(id, user_id, course_id, course_slug, course_title, course_category, course_image, status, source)
values (pg_temp.uid(4)::text || '__smoke-del-buyer', pg_temp.uid(4)::text, 'smoke-del-buyer',
  'smoke-del-buyer', 'Smoke del buyer', 'smoke', '', 'refunded', 'admin');
insert into public.course_subscriptions(id, user_id, course_id, course_slug, status)
values ('smoke-del-sub-1', pg_temp.uid(4)::text, 'smoke-del-sub', 'smoke-del-sub-slug', 'active');

-- O que travava o DELETE: post e comentario do proprio professor, sessao,
-- convite pendente. Mais um desejo (sem FK) e os arquivos.
insert into public.community_posts(id, course_slug, author_id, author_name, author_role, category, title, body)
values
  ('smoke-del-post-a', 'smoke-del-a', pg_temp.uid(1)::text, 'Del 1', 'teacher', 'discussion', null, 'Welcome.'),
  ('smoke-del-post-buyer', 'smoke-del-buyer', pg_temp.uid(1)::text, 'Del 1', 'teacher', 'discussion', null, 'Welcome.'),
  ('smoke-del-post-admin', 'smoke-del-admin', pg_temp.uid(1)::text, 'Del 1', 'teacher', 'discussion', null, 'Welcome.');
insert into public.community_comments(id, post_id, course_slug, author_id, author_name, author_role, body)
values ('smoke-del-comment-a', 'smoke-del-post-a', 'smoke-del-a', pg_temp.uid(1)::text, 'Del 1', 'teacher', 'First reply.');
insert into public.course_events(id, course_id, course_slug, course_title, owner_id, title,
  description, type, status, starts_at, external_url)
values ('smoke-del-event-a', 'smoke-del-a', 'smoke-del-a', 'Smoke del A', pg_temp.uid(1)::text,
  'Smoke del session', '', 'live_class', 'scheduled',
  to_char((now() + interval '7 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'https://example.invalid/live');
insert into public.course_access_grants(course_id, learner_email, granted_by)
values ('smoke-del-a', 'del-smoke-pending@example.test', pg_temp.uid(1)::text);
-- A regra do banco: id = user_id || '__' || course_id (wishlists_id_shape).
insert into public.wishlists(id, user_id, course_id, course_slug)
values (pg_temp.uid(4)::text || '__smoke-del-a', pg_temp.uid(4)::text, 'smoke-del-a', 'smoke-del-a-slug');
insert into public.course_assets(id, course_id, owner_id, kind, file_name, content_type, size,
  storage_path, bunny_video_id)
values
  ('smoke-del-video-a', 'smoke-del-a', pg_temp.uid(1)::text, 'lesson_video', 'intro.mp4', 'video/mp4', 1024,
   'bunny/smoke-del-vid-1/receipt-1', 'smoke-del-vid-1'),
  ('smoke-del-file-a', 'smoke-del-a', pg_temp.uid(1)::text, 'lesson_material', 'workbook.pdf',
   'application/pdf', 1024, 'courses/smoke-del-a/assets/u/1/workbook.pdf', null),
  -- Um video que um curso VIVO usa: nunca sai.
  ('smoke-del-video-shared', 'smoke-del-a-b', pg_temp.uid(2)::text, 'lesson_video', 'shared.mp4', 'video/mp4', 1024,
   'bunny/smoke-del-vid-shared/receipt-2', 'smoke-del-vid-shared');
insert into storage.objects(bucket_id, name, created_at)
values
  ('course-content', 'courses/smoke-del-a/assets/u/1/workbook.pdf', now()),
  ('public-media', 'courses/smoke-del-a/landing/hero.webp', now()),
  ('public-media', 'courses/smoke-del-a-b/landing/other.webp', now()),
  ('course-content', 'elsewhere/smoke-del-a/stray.pdf', now()),
  -- Mais velho que o curso (pasta orfa adotada) e mais novo que o pedido.
  ('course-content', 'courses/smoke-del-a/assets/old/orphan.pdf', now() - interval '2 days'),
  ('public-media', 'courses/smoke-del-a/landing/late.webp', now() + interval '1 hour');
select set_config('skillset.trusted_write', 'off', true);

-- O dono apaga o rascunho pela funcao, como a tela faz.
select pg_temp.act_as(pg_temp.uid(1), 'authenticated');
set local role authenticated;
select pg_temp.check_del('the owner deletes a draft with posts, a session, an invitation and a video',
  public.delete_or_archive_own_course('smoke-del-a')->>'outcome' = 'deleted');
select pg_temp.check_del('the owner sees it as being deleted',
  (select count(*) = 1 and bool_and(course_id = 'smoke-del-a' and title = 'Smoke del A')
     from public.list_my_courses_being_deleted()));
select pg_temp.check_del('the client cannot read the cleanup queue',
  pg_temp.error_of('select count(*) from public.course_deletions') like '42501:%');
select pg_temp.check_del('the client cannot clear a course by hand',
  pg_temp.error_of($q$select public.clear_course_for_delete('smoke-del-a-b')$q$) like '42501:%');
select pg_temp.check_del('the client cannot list files for cleanup',
  pg_temp.error_of($q$select * from public.course_storage_objects_for_cleanup('smoke-del-a')$q$) like '42501:%');
select pg_temp.check_del('the client cannot ask whether a video may go',
  pg_temp.error_of($q$select public.course_cleanup_video_deletable('smoke-del-a', 'smoke-del-vid-1')$q$) like '42501:%');
select pg_temp.check_del('the client cannot search for references',
  pg_temp.error_of($q$select * from public.course_cleanup_references('courses/')$q$) like '42501:%');
select pg_temp.check_del('the client cannot call the old delete_teacher_course_draft',
  pg_temp.error_of($q$select public.delete_teacher_course_draft('smoke-del-admin')$q$) like '42501:%');
reset role;

-- Quem nao e dono nao trava a linha nem descobre se o id existe.
select pg_temp.act_as(pg_temp.uid(2), 'authenticated');
set local role authenticated;
select pg_temp.check_del('another creator sees no deletion of someone else',
  not exists (select 1 from public.list_my_courses_being_deleted()));
select pg_temp.check_del('another creator gets the same "not found" as for a missing id',
  pg_temp.error_of($q$select public.delete_or_archive_own_course('smoke-del-admin')$q$)
    = pg_temp.error_of($q$select public.delete_or_archive_own_course('smoke-del-missing')$q$)
  and pg_temp.error_of($q$select public.delete_or_archive_own_course('smoke-del-admin')$q$)
    like '%Course not found.%');
reset role;

select pg_temp.act_as(pg_temp.uid(4), 'authenticated');
set local role authenticated;
select pg_temp.check_del('the client cannot write to the cleanup queue',
  pg_temp.error_of($q$insert into public.course_deletions(course_id, owner_id) values ('smoke-del-a-b', 'x')$q$) like '42501:%');
reset role;

select pg_temp.act_as(null, 'service_role');
select pg_temp.check_del('the course row is gone',
  not exists (select 1 from public.courses where id = 'smoke-del-a'));
select pg_temp.check_del('a non-owner attempt left the course in place',
  exists (select 1 from public.courses where id = 'smoke-del-admin'));
select pg_temp.check_del('its posts and replies are gone',
  not exists (select 1 from public.community_posts where course_slug = 'smoke-del-a')
  and not exists (select 1 from public.community_comments where id = 'smoke-del-comment-a'));
select pg_temp.check_del('its session, invitation and wishlist are gone',
  not exists (select 1 from public.course_events where course_id = 'smoke-del-a')
  and not exists (select 1 from public.course_access_grants where course_id = 'smoke-del-a')
  and not exists (select 1 from public.wishlists where course_id = 'smoke-del-a'));
select pg_temp.check_del('the queue keeps the video and its receipt, only the video, and when the course was born',
  (select status = 'pending' and attempts = 0 and owner_id = pg_temp.uid(1)::text
      and course_created_at is not null
      and bunny_assets = jsonb_build_array(jsonb_build_object(
        'videoId', 'smoke-del-vid-1', 'receipt', 'bunny/smoke-del-vid-1/receipt-1',
        'ownerId', pg_temp.uid(1)::text))
     from public.course_deletions where course_id = 'smoke-del-a'));

-- A lista de arquivos: so service role, so a pasta exata.
set local role service_role;
select pg_temp.check_del('the cleanup lists exactly the two files under courses/<id>/',
  (select count(*) = 2
      and bool_and(object_name in ('courses/smoke-del-a/assets/u/1/workbook.pdf', 'courses/smoke-del-a/landing/hero.webp'))
     from public.course_storage_objects_for_cleanup('smoke-del-a')));
select pg_temp.check_del('the cleanup never lists a file older than the course nor newer than the delete',
  not exists (select 1 from public.course_storage_objects_for_cleanup('smoke-del-a')
               where object_name in ('courses/smoke-del-a/assets/old/orphan.pdf',
                                     'courses/smoke-del-a/landing/late.webp')));
select pg_temp.check_del('a file another live course still shows is marked in use, the others are not',
  (select bool_and(in_use = (object_name = 'courses/smoke-del-a/landing/hero.webp'))
     from public.course_storage_objects_for_cleanup('smoke-del-a')));
select pg_temp.check_del('the cleanup never lists the neighbour prefix nor another folder',
  not exists (select 1 from public.course_storage_objects_for_cleanup('smoke-del-a')
               where not starts_with(object_name, 'courses/smoke-del-a/')));
select pg_temp.check_del('an id with a slash is refused',
  pg_temp.error_of($q$select * from public.course_storage_objects_for_cleanup('smoke-del-a/../smoke-del-a-b')$q$)
    like '%Unsafe course id.%');
select pg_temp.check_del('an id nobody deleted is refused',
  pg_temp.error_of($q$select * from public.course_storage_objects_for_cleanup('smoke-del-a-b')$q$)
    like '%No deletion was requested for this course.%');
select pg_temp.check_del('a proven video nobody uses may go',
  public.course_cleanup_video_deletable('smoke-del-a', 'smoke-del-vid-1'));
select pg_temp.check_del('a video a live course still uses never goes',
  not public.course_cleanup_video_deletable('smoke-del-a', 'smoke-del-vid-shared'));
reset role;

-- Id escolhido a mao: para o cliente, o id que passou pela fila e reservado.
-- O gatilho e AFTER: o aluno que tenta um id alheio para na RLS (42501) e
-- nao descobre se o id esta na fila.
select pg_temp.act_as(pg_temp.uid(4), 'authenticated');
set local role authenticated;
select pg_temp.check_del('a student probing an id being deleted gets the RLS error, not the queue error',
  pg_temp.error_of(format($q$insert into public.courses(id, owner_id, slug, title, title_key, summary, category, status,
      payment_type, price_amount_minor, currency)
    values (%L, %L, %L, 'Smoke del again', %L, 'Curso usado so por este smoke.', 'smoke', 'draft', 'free', 0, 'USD')$q$,
    'smoke-del-a', pg_temp.uid(1)::text, 'smoke-del-a-probe', 'smoke-del-a-probe')) like '42501:%');
reset role;
-- Curso sem filhos do professor 2, para o caso do renomear (um filho com FK
-- sem ON UPDATE daria 23503 antes deste gatilho).
select pg_temp.act_as(null, 'service_role');
select set_config('skillset.trusted_write', 'on', true);
insert into public.courses(id, owner_id, slug, title, title_key, summary, category, status, payment_type,
  price_amount_minor, currency)
values ('smoke-del-rename', pg_temp.uid(2)::text, 'smoke-del-rename-slug', 'Smoke del rename', 'smoke-del-rename',
  'Curso usado so por este smoke.', 'smoke', 'draft', 'free', 0, 'USD');
select pg_temp.act_as(pg_temp.uid(2), 'authenticated');
set local role authenticated;
select pg_temp.check_del('creating a course with an id still being deleted is refused',
  pg_temp.error_of(format($q$insert into public.courses(id, owner_id, slug, title, title_key, summary, category, status,
      payment_type, price_amount_minor, currency)
    values (%L, %L, %L, 'Smoke del again', %L, 'Curso usado so por este smoke.', 'smoke', 'draft', 'free', 0, 'USD')$q$,
    'smoke-del-a', pg_temp.uid(2)::text, 'smoke-del-a-again', 'smoke-del-a-again')) like '23505:%deleted product%');
select pg_temp.check_del('renaming a course to an id still being deleted is refused',
  pg_temp.error_of($q$update public.courses set id = 'smoke-del-a' where id = 'smoke-del-rename'$q$)
    like '23505:%deleted product%');
reset role;
select pg_temp.act_as(null, 'service_role');
select set_config('skillset.trusted_write', 'on', true);

-- Defesa em profundidade: se o id voltar mesmo assim (aqui, pela equipe, com
-- a fila cancelada e reaberta a mao), a lista e o video recusam.
update public.course_deletions set status = 'cancelled' where course_id = 'smoke-del-a';
insert into public.courses(id, owner_id, slug, title, title_key, summary, category, status, payment_type,
  price_amount_minor, currency)
values ('smoke-del-a', pg_temp.uid(2)::text, 'smoke-del-a-again', 'Smoke del A again', 'smoke-del-a-again',
  'Curso usado so por este smoke.', 'smoke', 'draft', 'free', 0, 'USD');
update public.course_deletions set status = 'pending' where course_id = 'smoke-del-a';
select set_config('skillset.trusted_write', 'off', true);
set local role service_role;
select pg_temp.check_del('an id in use again is refused',
  pg_temp.error_of($q$select * from public.course_storage_objects_for_cleanup('smoke-del-a')$q$)
    like '%Course id is in use again.%');
select pg_temp.check_del('an id in use again keeps its videos',
  not public.course_cleanup_video_deletable('smoke-del-a', 'smoke-del-vid-1'));
reset role;

-- Com comprador, arquiva: matricula reembolsada conta; assinatura tambem.
select pg_temp.act_as(pg_temp.uid(1), 'authenticated');
set local role authenticated;
select pg_temp.check_del('a refunded buyer still means archive',
  public.delete_or_archive_own_course('smoke-del-buyer')->>'outcome' = 'archived');
select pg_temp.check_del('a subscription alone means archive',
  public.delete_or_archive_own_course('smoke-del-sub')->>'outcome' = 'archived');
reset role;
select pg_temp.act_as(null, 'service_role');
select pg_temp.check_del('the archived course stays, inactive, with its post and no queue row',
  (select status = 'inactive' from public.courses where id = 'smoke-del-buyer')
  and exists (select 1 from public.community_posts where id = 'smoke-del-post-buyer')
  and not exists (select 1 from public.course_deletions where course_id in ('smoke-del-buyer', 'smoke-del-sub')));

-- Mesma transacao: um DELETE que falha (a matricula trava a FK) nao deixa linha.
select pg_temp.check_del('a failed delete leaves no queue row',
  pg_temp.error_of($q$delete from public.courses where id = 'smoke-del-buyer'$q$) like '23503:%'
  and not exists (select 1 from public.course_deletions where course_id = 'smoke-del-buyer'));

-- DELETE direto pela tabela (a policy do dono deixa): a linha nasce igual.
select pg_temp.act_as(pg_temp.uid(1), 'authenticated');
set local role authenticated;
select pg_temp.check_del('a direct delete by the owner also queues the cleanup',
  pg_temp.affected($q$delete from public.courses where id = 'smoke-del-direct'$q$) = 1);
reset role;
select pg_temp.act_as(null, 'service_role');
select pg_temp.check_del('the direct delete wrote its queue row',
  exists (select 1 from public.course_deletions where course_id = 'smoke-del-direct' and status = 'pending'));

-- O admin apaga pelo mesmo caminho: o post do dono nao trava mais.
select pg_temp.act_as(pg_temp.uid(3), 'authenticated');
set local role authenticated;
select public.delete_course_as_admin('smoke-del-admin');
reset role;
select pg_temp.act_as(null, 'service_role');
select pg_temp.check_del('the admin deletes a course with the owner''s post, and it is queued',
  not exists (select 1 from public.courses where id = 'smoke-del-admin')
  and not exists (select 1 from public.community_posts where id = 'smoke-del-post-admin')
  and exists (select 1 from public.course_deletions where course_id = 'smoke-del-admin'));

-- "Apaguei o produto errado": a equipe cancela (docs/COMO-TRABALHAR.md). E a
-- 5a falha vira failed. Nenhum dos dois mostra selo para sempre.
update public.course_deletions set status = 'cancelled' where course_id = 'smoke-del-direct';
update public.course_deletions set status = 'failed', attempts = 5 where course_id = 'smoke-del-admin';
select pg_temp.act_as(pg_temp.uid(1), 'authenticated');
set local role authenticated;
select pg_temp.check_del('the chip shows only pending rows, never failed or cancelled',
  (select coalesce(array_agg(course_id order by course_id), '{}') = array['smoke-del-a']
     from public.list_my_courses_being_deleted()));
reset role;
-- O cliente nunca recria um id cancelado nem terminado: quem recriasse viraria
-- dono da pasta e dos arquivos que a equipe guardou.
select pg_temp.act_as(null, 'service_role');
update public.course_deletions set status = 'done' where course_id = 'smoke-del-admin';
select pg_temp.act_as(pg_temp.uid(2), 'authenticated');
set local role authenticated;
select pg_temp.check_del('the client never recreates a cancelled or a done id',
  pg_temp.error_of(format($q$insert into public.courses(id, owner_id, slug, title, title_key, summary, category, status,
      payment_type, price_amount_minor, currency)
    values (%L, %L, %L, 'Smoke del again', %L, 'Curso usado so por este smoke.', 'smoke', 'draft', 'free', 0, 'USD')$q$,
    'smoke-del-direct', pg_temp.uid(2)::text, 'smoke-del-direct-c', 'smoke-del-direct-c')) like '23505:%deleted product%'
  and pg_temp.error_of(format($q$insert into public.courses(id, owner_id, slug, title, title_key, summary, category, status,
      payment_type, price_amount_minor, currency)
    values (%L, %L, %L, 'Smoke del again', %L, 'Curso usado so por este smoke.', 'smoke', 'draft', 'free', 0, 'USD')$q$,
    'smoke-del-admin', pg_temp.uid(2)::text, 'smoke-del-admin-c', 'smoke-del-admin-c')) like '23505:%deleted product%');
reset role;
select pg_temp.act_as(null, 'service_role');
set local role service_role;
select pg_temp.check_del('a cancelled cleanup lists no file and lets no video go',
  pg_temp.error_of($q$select * from public.course_storage_objects_for_cleanup('smoke-del-direct')$q$)
    like '%This deletion is not pending.%'
  and not public.course_cleanup_video_deletable('smoke-del-direct', 'smoke-del-vid-1'));
reset role;
select set_config('skillset.trusted_write', 'on', true);
select pg_temp.check_del('the team (service role) can still create a cancelled id again (recovery)',
  pg_temp.affected(format($q$insert into public.courses(id, owner_id, slug, title, title_key, summary, category,
      status, payment_type, price_amount_minor, currency)
    values ('smoke-del-direct', %L, 'smoke-del-direct-2', 'Smoke del direct 2', 'smoke-del-direct-2',
      'Curso usado so por este smoke.', 'smoke', 'draft', 'free', 0, 'USD')$q$, pg_temp.uid(2)::text)) = 1);
select set_config('skillset.trusted_write', 'off', true);
delete from public.courses where id = 'smoke-del-direct';
select pg_temp.check_del('deleting it again queues a fresh cleanup',
  (select status = 'pending' and attempts = 0 and owner_id = pg_temp.uid(2)::text
      and title = 'Smoke del direct 2' and result = '{}'::jsonb
     from public.course_deletions where course_id = 'smoke-del-direct'));

select pg_temp.check_del('every case ran', (select count(*) = 41 from del_checks));
select name, passed from del_checks order by name;
do $$
declare failures text;
begin
  select string_agg(name, ', ' order by name) into failures from del_checks where not passed;
  if failures is not null then
    raise exception 'COURSE_DELETE_REGRESSION: %', failures;
  end if;
end $$;
rollback;
