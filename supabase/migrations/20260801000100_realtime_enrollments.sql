-- Put public.enrollments in the realtime publication.
--
-- WHY: the learner surfaces subscribe to postgres_changes on this table
-- (src/lib/data/enrollments.ts:161, :210, :268 — the dashboard list, the
-- admin granted list, and the single-enrollment watcher). A table outside
-- supabase_realtime emits nothing, so those channels subscribe successfully
-- and then stay silent forever: no error, just a dashboard that never
-- notices a purchase until the learner reloads. Under direct charges the
-- enrollment row is written by the Stripe webhook, out of band from the
-- browser that paid, so realtime is the only thing that closes that loop.
--
-- This was already applied by hand to production; this file is the versioned
-- source so a fresh environment built from migration history matches, and so
-- the repo stops claiming the table is unpublished.
do $$ begin
  alter publication supabase_realtime add table public.enrollments;
exception when duplicate_object then null; end $$;
