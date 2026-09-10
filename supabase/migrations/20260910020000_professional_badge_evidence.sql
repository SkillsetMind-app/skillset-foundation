-- Optional, manually reviewed badges. No activation/publication gate changes.
alter table public.creator_verification_cases
  add column verification_kind text not null default 'legacy'
    check (verification_kind in ('legacy','psychologist','coach','holistic','other')),
  add column document_path text;

create index creator_verification_cases_document_idx
  on public.creator_verification_cases(document_path) where document_path is not null;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('verification-evidence', 'verification-evidence', false, 10485760,
  array['image/png','image/jpeg','image/webp','application/pdf']);

create policy verification_evidence_owner_insert on storage.objects
for insert to authenticated with check (
  bucket_id = 'verification-evidence' and (select public.session_is_strong())
  and public.is_teacher()
  and name ~ ('^' || (select auth.uid())::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|jpeg|webp|pdf)$')
);
create policy verification_evidence_private_read on storage.objects
for select to authenticated using (
  bucket_id = 'verification-evidence' and (select public.session_is_strong())
  and (split_part(name, '/', 1) = (select auth.uid())::text
    or ((public.is_ops() or public.is_admin()) and exists (
      select 1 from public.creator_verification_cases c where c.document_path = objects.name
    )))
);
create policy verification_evidence_owner_delete on storage.objects
for delete to authenticated using (
  bucket_id = 'verification-evidence' and (select public.session_is_strong())
  and split_part(name, '/', 1) = (select auth.uid())::text
  and not exists (select 1 from public.creator_verification_cases c where c.document_path = objects.name)
);
-- No UPDATE policy: submitted evidence cannot be replaced through upsert.

-- The RPC locks the object before referencing it. This trigger checks again
-- after a DELETE acquires that same lock, closing the RLS snapshot race.
create function public.protect_verification_evidence_delete() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.bucket_id = 'verification-evidence' and exists (
    select 1 from public.creator_verification_cases c where c.document_path = old.name
  ) then
    raise exception 'Verification evidence is referenced by a case.' using errcode = '23503';
  end if;
  return old;
end;
$$;
revoke all on function public.protect_verification_evidence_delete() from public, anon, authenticated;
create trigger verification_evidence_referenced_delete
before delete on storage.objects for each row
execute function public.protect_verification_evidence_delete();

create function public.submit_professional_badge(
  p_kind text,
  p_profession text,
  p_registration_id text default null,
  p_registration_region text default null,
  p_evidence_links jsonb default '[]'::jsonb,
  p_document_path text default null,
  p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid text := (select auth.uid())::text;
  v_status text;
  v_open public.creator_verification_cases%rowtype;
  v_links jsonb := coalesce(p_evidence_links, '[]'::jsonb);
  v_link jsonb;
  v_url text;
  v_host text[];
  v_document text := nullif(btrim(p_document_path), '');
  v_registration_id text := btrim(coalesce(p_registration_id, ''));
  v_registration_region text := btrim(coalesce(p_registration_region, ''));
  v_trusted text := current_setting('skillset.trusted_write', true);
begin
  perform public.require_strong_session();
  if v_uid is null or not public.is_teacher() then
    raise exception 'Only authenticated teachers can request a professional badge.' using errcode = '42501';
  end if;
  -- All submission/review paths take the user lock before the case lock.
  select creator_verification_status into v_status from public.users where uid = v_uid for update;
  if not found then raise exception 'Profile not found.'; end if;
  if v_status = 'approved' or exists (
    select 1 from public.creator_verification_cases where creator_id = v_uid and status = 'approved'
  ) then raise exception 'Your professional verification is already approved.'; end if;
  if v_status = 'pending' then raise exception 'Your verification is already in review.'; end if;

  if p_kind is null or p_kind not in ('psychologist','coach','holistic','other') then
    raise exception 'Invalid professional verification kind.';
  end if;
  if char_length(btrim(coalesce(p_profession, ''))) < 2 or char_length(p_profession) > 120 then
    raise exception 'Describe your profession (2-120 characters).';
  end if;
  if (p_kind = 'psychologist' or v_registration_id <> '')
    and (char_length(v_registration_id) < 2 or char_length(p_registration_id) > 80) then
    raise exception 'Add your registration number (2-80 characters).';
  end if;
  if (p_kind = 'psychologist' or v_registration_region <> '')
    and (char_length(v_registration_region) < 2 or char_length(p_registration_region) > 80) then
    raise exception 'Add the issuing country or state (2-80 characters).';
  end if;
  if char_length(p_note) > 2000 then raise exception 'Keep the note under 2000 characters.'; end if;
  if jsonb_typeof(v_links) <> 'array' then raise exception 'Evidence links must be a list of URLs.'; end if;
  if jsonb_array_length(v_links) > 6 then raise exception 'Attach at most 6 evidence links.'; end if;
  for v_link in select * from jsonb_array_elements(v_links) loop
    v_url := v_link #>> '{}';
    -- DNS labels, no userinfo/whitespace/backslashes, optional valid TCP port.
    v_host := regexp_match(v_url,
      '^https://([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,63})(:([0-9]{1,5}))?([/?#][^[:space:]\\]*)?$', 'i');
    if jsonb_typeof(v_link) <> 'string' or char_length(v_url) > 300 or v_host is null
      or char_length(v_host[1]) > 253 or coalesce(v_host[6]::integer, 443) not between 1 and 65535 then
      raise exception 'Evidence links must be valid https URLs (max 300 characters each).';
    end if;
  end loop;
  if v_document is not null then
    if v_document !~ ('^' || v_uid || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|jpeg|webp|pdf)$') then
      raise exception 'Document must use your own evidence upload path.';
    end if;
    perform 1 from storage.objects where bucket_id = 'verification-evidence' and name = v_document for update;
    if not found then raise exception 'Upload the evidence document before submitting.'; end if;
  end if;
  if jsonb_array_length(v_links) = 0 and v_document is null then
    raise exception 'Provide at least one evidence link or uploaded document.';
  end if;

  select * into v_open from public.creator_verification_cases
  where creator_id = v_uid and status in ('pending','needs_changes')
  order by created_at desc limit 1 for update;
  if v_open.status = 'pending' then raise exception 'Your verification is already in review.'; end if;
  if v_open.id is not null then
    update public.creator_verification_cases set
      status = 'pending', verification_kind = p_kind, profession = btrim(p_profession),
      registration_type = '', registration_id = v_registration_id, registration_region = v_registration_region,
      evidence_links = v_links, document_path = v_document, note = nullif(btrim(p_note), ''),
      review_note = null, reviewed_by = null, reviewed_at = null, updated_at = now()
    where id = v_open.id;
  else
    insert into public.creator_verification_cases
      (creator_id, status, verification_kind, profession, registration_type, registration_id,
       registration_region, evidence_links, document_path, note)
    values (v_uid, 'pending', p_kind, btrim(p_profession), '', v_registration_id,
      v_registration_region, v_links, v_document, nullif(btrim(p_note), ''));
  end if;
  perform set_config('skillset.trusted_write', 'on', true);
  update public.users set creator_verification_status = 'pending', updated_at = now() where uid = v_uid;
  perform set_config('skillset.trusted_write', coalesce(v_trusted, ''), true);
  return jsonb_build_object('success', true);
exception when others then
  perform set_config('skillset.trusted_write', coalesce(v_trusted, ''), true);
  raise;
end;
$$;
revoke all on function public.submit_professional_badge(text,text,text,text,jsonb,text,text) from public, anon;
grant execute on function public.submit_professional_badge(text,text,text,text,jsonb,text,text) to authenticated, service_role;

-- Patch the installed definitions, not pre-MFA copies. Fail closed on drift.
-- Legacy resubmission must not inherit a typed badge or a private document.
do $$
declare
  v_signature text;
  v_definition text;
  v_body text;
  v_next text;
  v_old text;
  v_new text;
begin
  foreach v_signature in array array[
    'public.submit_creator_verification(text,text,text,text,jsonb,text)',
    'public.review_creator_verification(uuid,text,text)'
  ] loop
    select pg_get_functiondef(oid), prosrc into v_definition, v_body
      from pg_proc where oid = v_signature::regprocedure;
    if position('public.require_strong_session()' in v_body) = 0 then
      raise exception 'Missing security wrapper on %', v_signature;
    end if;
    v_next := v_body;
    if v_signature like 'public.submit_%' then
      v_old := 'from public.users u where u.uid = v_uid;';
      v_new := 'from public.users u where u.uid = v_uid for update;';
      if position(v_old in v_next) = 0 then raise exception 'Legacy submission lock anchor changed'; end if;
      v_next := replace(v_next, v_old, v_new);
      v_old := 'profession = btrim(p_profession),';
      v_new := 'verification_kind = ''legacy'', document_path = null, profession = btrim(p_profession),';
      if position(v_old in v_next) = 0 then raise exception 'Legacy submission fields anchor changed'; end if;
      v_next := replace(v_next, v_old, v_new);
    else
      v_old := 'select * into v_case from public.creator_verification_cases where id = p_case_id;';
      v_new := 'perform 1 from public.users where uid = (select creator_id from public.creator_verification_cases where id = p_case_id) for update;
  select * into v_case from public.creator_verification_cases where id = p_case_id for update;';
      if position(v_old in v_next) = 0 then raise exception 'Verification review lock anchor changed'; end if;
      v_next := replace(v_next, v_old, v_new);
    end if;
    -- Both existing writers must preserve an enclosing trusted-write scope.
    v_next := replace(v_next, 'v_uid text :=', 'v_trusted text := current_setting(''skillset.trusted_write'', true);' || chr(10) || '  v_uid text :=');
    v_old := 'set_config(''skillset.trusted_write'', ''off'', true)';
    if position(v_old in v_next) = 0 then raise exception 'Trusted-write restoration anchor changed'; end if;
    v_next := replace(v_next, v_old, 'set_config(''skillset.trusted_write'', coalesce(v_trusted, ''''), true)');
    execute replace(v_definition, v_body, v_next);
  end loop;
end;
$$;
