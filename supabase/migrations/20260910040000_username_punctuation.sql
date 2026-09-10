-- Keep length, lowercase, initial alphanumeric, nullability and uniqueness.
-- Only the format check changes; public_profiles mirrors this username.
alter table public.users
  drop constraint if exists users_username_format,
  add constraint users_username_format
    check (username is null or username ~ '^[a-z0-9][a-z0-9._-]{2,31}$');
