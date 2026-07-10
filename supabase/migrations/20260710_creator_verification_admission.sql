-- Professional admission (soft gate) — additive only.
-- Applied to prod via Supabase MCP apply_migration on 2026-07-10; this file
-- mirrors it for versioning.
-- Creators submit registration data; ops reviews; users.creator_verification_status
-- mirrors the latest decision so RPCs and the profile subscription read it cheaply.

create table if not exists public.platform_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.platform_settings enable row level security;
drop policy if exists platform_settings_read on public.platform_settings;
create policy platform_settings_read on public.platform_settings
  for select to authenticated using (true);
-- Writes: service_role only (no policies on purpose).
insert into public.platform_settings (key, value)
values ('require_creator_verification', 'false'::jsonb)
on conflict (key) do nothing;

alter table public.users
  add column if not exists creator_verification_status text not null default 'none';
do $$ begin
  alter table public.users
    add constraint users_creator_verification_status_check
    check (creator_verification_status in ('none','pending','needs_changes','approved','rejected'));
exception when duplicate_object then null; end $$;

create table if not exists public.creator_verification_cases (
  id uuid primary key default gen_random_uuid(),
  creator_id text not null references public.users(uid) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending','needs_changes','approved','rejected')),
  profession text not null,
  registration_type text not null,
  registration_id text not null,
  registration_region text not null,
  evidence_links jsonb not null default '[]'::jsonb,
  note text,
  review_note text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists creator_verification_cases_creator_idx
  on public.creator_verification_cases (creator_id, created_at desc);
create index if not exists creator_verification_cases_status_idx
  on public.creator_verification_cases (status, created_at asc);
-- One open application per creator.
create unique index if not exists creator_verification_cases_open_case_uniq
  on public.creator_verification_cases (creator_id)
  where status in ('pending','needs_changes');

alter table public.creator_verification_cases enable row level security;
drop policy if exists creator_verification_cases_owner_read on public.creator_verification_cases;
create policy creator_verification_cases_owner_read on public.creator_verification_cases
  for select to authenticated
  using (creator_id = (select auth.uid())::text or public.is_ops() or public.is_admin());
-- All writes go through the security-definer RPCs below; no write policies.

create or replace function public.submit_creator_verification(
  p_profession text,
  p_registration_type text,
  p_registration_id text,
  p_registration_region text,
  p_evidence_links jsonb default '[]'::jsonb,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid text := (select auth.uid())::text;
  v_status text;
  v_open public.creator_verification_cases%rowtype;
  v_link jsonb;
  v_count integer := 0;
begin
  if v_uid is null then
    raise exception 'Sign in before submitting verification.';
  end if;
  if char_length(btrim(coalesce(p_profession,''))) < 2 or char_length(p_profession) > 120 then
    raise exception 'Describe your profession (2-120 characters).';
  end if;
  if char_length(btrim(coalesce(p_registration_type,''))) < 2 or char_length(p_registration_type) > 60 then
    raise exception 'Name the registry or license type (2-60 characters).';
  end if;
  if char_length(btrim(coalesce(p_registration_id,''))) < 2 or char_length(p_registration_id) > 80 then
    raise exception 'Add your registration number (2-80 characters).';
  end if;
  if char_length(btrim(coalesce(p_registration_region,''))) < 2 or char_length(p_registration_region) > 80 then
    raise exception 'Add the issuing country or state (2-80 characters).';
  end if;
  if p_note is not null and char_length(p_note) > 2000 then
    raise exception 'Keep the note under 2000 characters.';
  end if;
  if jsonb_typeof(coalesce(p_evidence_links, '[]'::jsonb)) <> 'array' then
    raise exception 'Evidence links must be a list of URLs.';
  end if;
  for v_link in select * from jsonb_array_elements(coalesce(p_evidence_links, '[]'::jsonb)) loop
    v_count := v_count + 1;
    if jsonb_typeof(v_link) <> 'string'
       or (v_link #>> '{}') !~* '^https://'
       or char_length(v_link #>> '{}') > 300 then
      raise exception 'Evidence links must be https URLs (max 300 characters each).';
    end if;
  end loop;
  if v_count > 6 then
    raise exception 'Attach at most 6 evidence links.';
  end if;

  select u.creator_verification_status into v_status
  from public.users u where u.uid = v_uid;
  if v_status is null then
    raise exception 'Profile not found.';
  end if;
  if v_status = 'approved' then
    raise exception 'Your professional verification is already approved.';
  end if;

  select * into v_open
  from public.creator_verification_cases
  where creator_id = v_uid and status in ('pending','needs_changes')
  order by created_at desc
  limit 1;

  if v_open.id is not null and v_open.status = 'pending' then
    raise exception 'Your verification is already in review.';
  end if;

  if v_open.id is not null then
    update public.creator_verification_cases
      set status = 'pending',
          profession = btrim(p_profession),
          registration_type = btrim(p_registration_type),
          registration_id = btrim(p_registration_id),
          registration_region = btrim(p_registration_region),
          evidence_links = coalesce(p_evidence_links, '[]'::jsonb),
          note = nullif(btrim(coalesce(p_note,'')), ''),
          review_note = null,
          reviewed_by = null,
          reviewed_at = null,
          updated_at = now()
    where id = v_open.id;
  else
    insert into public.creator_verification_cases
      (creator_id, profession, registration_type, registration_id,
       registration_region, evidence_links, note)
    values
      (v_uid, btrim(p_profession), btrim(p_registration_type), btrim(p_registration_id),
       btrim(p_registration_region), coalesce(p_evidence_links, '[]'::jsonb),
       nullif(btrim(coalesce(p_note,'')), ''));
  end if;

  perform set_config('skillset.trusted_write', 'on', true);
  update public.users
    set creator_verification_status = 'pending', updated_at = now()
  where uid = v_uid;
  perform set_config('skillset.trusted_write', 'off', true);

  return jsonb_build_object('success', true);
end;
$function$;

create or replace function public.review_creator_verification(
  p_case_id uuid,
  p_status text,
  p_review_note text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid text := (select auth.uid())::text;
  v_case public.creator_verification_cases%rowtype;
  v_note text := nullif(btrim(coalesce(p_review_note,'')), '');
begin
  if v_uid is null or not (public.is_ops() or public.is_admin()) then
    raise exception 'Only the operations team can review verification cases.';
  end if;
  if p_status not in ('approved','needs_changes','rejected') then
    raise exception 'Invalid review decision.';
  end if;
  if p_status <> 'approved' and (v_note is null or char_length(v_note) < 12) then
    raise exception 'Add a review note (at least 12 characters) when requesting changes or rejecting.';
  end if;
  if v_note is not null and char_length(v_note) > 2000 then
    raise exception 'Keep the review note under 2000 characters.';
  end if;

  select * into v_case from public.creator_verification_cases where id = p_case_id;
  if v_case.id is null then
    raise exception 'Verification case not found.';
  end if;
  if v_case.status <> 'pending' then
    raise exception 'Only pending cases can be reviewed.';
  end if;

  update public.creator_verification_cases
    set status = p_status,
        review_note = v_note,
        reviewed_by = v_uid,
        reviewed_at = now(),
        updated_at = now()
  where id = p_case_id;

  perform set_config('skillset.trusted_write', 'on', true);
  update public.users
    set creator_verification_status = p_status, updated_at = now()
  where uid = v_case.creator_id;
  perform set_config('skillset.trusted_write', 'off', true);

  return jsonb_build_object('success', true);
end;
$function$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'public.submit_creator_verification(text,text,text,text,jsonb,text)',
    'public.review_creator_verification(uuid,text,text)'
  ] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;
end $$;

do $$ begin
  alter publication supabase_realtime add table public.creator_verification_cases;
exception when duplicate_object then null; end $$;
