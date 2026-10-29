\set ON_ERROR_STOP on
begin;

create function pg_temp.assert_true(ok boolean, message text) returns void
language plpgsql as $$
begin
  if not coalesce(ok, false) then
    raise exception 'CERTIFICATE_REFUND_REGRESSION: %', message;
  end if;
end;
$$;

-- Controle negativo restrito a esta transacao descartavel.
\if :{?without_certificate_refund_trigger}
alter table public.enrollments disable trigger enrollments_refund_certificate;
\endif

select id::text as uid from auth.users order by id limit 1 \gset
select id as course from public.courses
where not exists (select 1 from public.enrollments e
  where e.user_id = :'uid' and e.course_id = courses.id)
order by id limit 1 \gset
select 'cert-atomic-' || :'uid' as enrollment \gset
select set_config('test.cert_enrollment', :'enrollment', true);
update public.courses set product_format = 'course',
  modules = '[{"id":"atomic-module","lessons":[{"id":"atomic-lesson","title":"Atomic","type":"text"}]}]'
where id = :'course';
insert into public.enrollments
  (id,user_id,course_id,course_slug,course_title,course_category,course_image,status,source,progress_percent)
values (:'enrollment',:'uid',:'course','atomic','Atomic','test','','completed','payment',100);
insert into public.lesson_progress(enrollment_id,lesson_id,user_id)
values (:'enrollment','atomic-lesson',:'uid');

select set_config('request.jwt.claims', jsonb_build_object(
  'sub', :'uid', 'role', 'authenticated', 'aal', 'aal2')::text, true);
select set_config('request.jwt.claim.sub', :'uid', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
select public.issue_skillset_certificate(:'enrollment','Atomic Learner');
reset role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
update public.enrollments set status = 'refunded' where id = :'enrollment';
reset role;
select pg_temp.assert_true((select status = 'refund_revoked' from public.certificates
  where id = :'enrollment'), 'refund left issued certificate');
select pg_temp.assert_true(not (public.verify_skillset_certificate(
  (select verification_code from public.certificates where id = :'enrollment'),
  'atomic-refund-smoke')->>'valid')::boolean, 'refund still publicly valid');

-- Repeticao nao muda certificado nem rebaixa decisao de Ops.
update public.certificates set status = 'revoked' where id = :'enrollment';
update public.enrollments set status = 'refunded' where id = :'enrollment';
select pg_temp.assert_true((select status = 'revoked' from public.certificates
  where id = :'enrollment'), 'refund downgraded ops revocation');

-- Falha de escrita do certificado tem de reverter tambem a matricula.
update public.enrollments set status = 'completed' where id = :'enrollment';
update public.certificates set status = 'issued' where id = :'enrollment';
create function pg_temp.fail_certificate_write() returns trigger language plpgsql as $$
begin
  raise exception 'forced certificate write failure' using errcode = '23514';
end;
$$;
create trigger test_certificate_write_failure before update on public.certificates
for each row execute function pg_temp.fail_certificate_write();
do $$
begin
  begin
    update public.enrollments set status = 'refunded'
    where id = current_setting('test.cert_enrollment');
    raise exception 'CERTIFICATE_REFUND_REGRESSION: certificate failure swallowed';
  exception when check_violation then
    if sqlerrm <> 'forced certificate write failure' then raise; end if;
  end;
end;
$$;
select pg_temp.assert_true((select status = 'completed' from public.enrollments
  where id = :'enrollment'), 'certificate failure committed enrollment');
select pg_temp.assert_true((select status = 'issued' from public.certificates
  where id = :'enrollment'), 'certificate failure changed certificate');
drop trigger test_certificate_write_failure on public.certificates;

-- A mesma atualizacao e segura sem certificado e repara uma linha legada.
update public.enrollments set status = 'refunded' where id = :'enrollment';
update public.certificates set status = 'issued' where id = :'enrollment';
update public.enrollments set status = 'refunded' where id = :'enrollment';
select pg_temp.assert_true((select status = 'refund_revoked' from public.certificates
  where id = :'enrollment'), 'repeat refund did not repair legacy certificate');
delete from public.certificates where id = :'enrollment';
update public.enrollments set status = 'refunded' where id = :'enrollment';
select pg_temp.assert_true(not exists(select 1 from public.certificates
  where id = :'enrollment'), 'refund created certificate');

rollback;
