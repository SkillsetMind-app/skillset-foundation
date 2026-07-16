-- Bunny Stream: a lesson video/live recording hosted on Bunny stores its guid
-- here instead of a Supabase Storage object. Nullable + additive, so existing
-- Supabase-hosted video rows keep working unchanged.
--
-- DEPLOY GATE #1: apply this BEFORE setting NEXT_PUBLIC_BUNNY_STREAM_LIBRARY_ID
-- in Vercel. Until the env is set, uploads still go to Supabase Storage and this
-- column is simply never written.
alter table if exists public.course_assets
  add column if not exists bunny_video_id text;
