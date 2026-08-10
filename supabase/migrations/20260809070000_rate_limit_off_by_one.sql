-- enforce_rate_limit counted the first request twice, so every caller got one
-- fewer request than it asked for.
--
-- The old body seeded a brand-new row with count = 1 (already counting request
-- #1), then fell through to the same UPDATE ... count + 1 that every later
-- request runs — counting request #1 a second time. With p_limit = 3 the
-- sequence was:
--
--   call 1: insert 1 -> read 1 -> 1 >= 3? no -> write 2
--   call 2:            read 2 -> 2 >= 3? no -> write 3
--   call 3:            read 3 -> 3 >= 3? YES -> RATE_LIMIT
--
-- Three allowed on paper, two in practice. It bit hardest where the limit is
-- smallest: p_limit = 1 rejected the very first request, which is why the
-- checkout and pwned-check guards had to be given inflated numbers to behave.
--
-- Fix is one character of intent: seed at 0 and let the increment below be the
-- single place a request is ever counted. The window-reset branch still writes
-- 1 and RETURNs immediately, so it stays consistent — that branch counts the
-- current request itself and never reaches the increment.
--
-- Everything else about the function is unchanged, including SECURITY DEFINER,
-- the search_path pin and the anon/authenticated grants.

create or replace function public.enforce_rate_limit(
  p_key text,
  p_limit integer,
  p_window_ms integer
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
DECLARE
  v_now timestamptz := now();
  v_row public.rate_limits%ROWTYPE;
  v_window interval := make_interval(secs => GREATEST(p_window_ms, 1000) / 1000.0);
BEGIN
  IF p_key IS NULL OR length(p_key) < 1 OR p_limit < 1 THEN
    RAISE EXCEPTION 'INVALID_RATE_LIMIT_ARGS';
  END IF;

  -- count = 0: the row exists, but no request has been counted into it yet.
  INSERT INTO public.rate_limits (key, count, window_started_at, updated_at)
  VALUES (p_key, 0, v_now, v_now)
  ON CONFLICT (key) DO NOTHING;

  SELECT * INTO v_row FROM public.rate_limits WHERE key = p_key FOR UPDATE;

  IF v_now - v_row.window_started_at > v_window THEN
    UPDATE public.rate_limits
    SET count = 1, window_started_at = v_now, updated_at = v_now
    WHERE key = p_key;
    RETURN;
  END IF;

  IF v_row.count >= p_limit THEN
    RAISE EXCEPTION 'RATE_LIMIT';
  END IF;

  UPDATE public.rate_limits
  SET count = count + 1, updated_at = v_now
  WHERE key = p_key;
END;
$$;

grant execute on function public.enforce_rate_limit(text, integer, integer)
  to anon, authenticated, service_role;

-- Self-check: a limit of 3 must allow exactly 3 requests, not 2. This is the
-- whole bug in one assertion, so it runs on every replay of this migration.
do $$
declare
  k text := 'migration_selfcheck_' || md5(clock_timestamp()::text);
  allowed int := 0;
begin
  for i in 1..5 loop
    begin
      perform public.enforce_rate_limit(k, 3, 60000);
      allowed := allowed + 1;
    exception when others then
      exit;
    end;
  end loop;

  delete from public.rate_limits where key = k;

  if allowed <> 3 then
    raise exception 'enforce_rate_limit is off by one: limit 3 allowed % requests', allowed;
  end if;
end $$;
