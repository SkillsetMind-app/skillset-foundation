-- Community products reuse the proven recurring-course model while enabling
-- the members-area community at creation time. The five-argument RPC remains
-- available for older clients; this overload is the current web contract.
create or replace function public.create_teacher_course_draft(
  p_title text,
  p_summary text,
  p_category text,
  p_categories text[],
  p_payment_type text,
  p_community_enabled boolean
)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_course_id text;
  v_uid text := (select auth.uid())::text;
begin
  v_course_id := public.create_teacher_course_draft(
    p_title,
    p_summary,
    p_category,
    p_categories,
    p_payment_type
  );

  if coalesce(p_community_enabled, false) then
    perform set_config('skillset.trusted_write', 'on', true);

    update public.courses
    set community_enabled = true,
        updated_at = now()
    where id = v_course_id
      and owner_id = v_uid;

    if not found then
      raise exception 'The community draft could not be initialized.';
    end if;

    perform set_config('skillset.trusted_write', 'off', true);
  end if;

  return v_course_id;
end;
$function$;

revoke all on function public.create_teacher_course_draft(
  text, text, text, text[], text, boolean
) from public, anon;

grant execute on function public.create_teacher_course_draft(
  text, text, text, text[], text, boolean
) to authenticated, service_role;
