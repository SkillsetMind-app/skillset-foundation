-- Studio advisor: persistent conversation memory + retrieval corpus.
--
-- WHY: today the advisor is stateless (src/app/api/teach/advisor/route.ts takes
-- the whole transcript from the browser on every call) and it only knows what
-- src/lib/assistant/knowledge.ts hardcodes. Two consequences: a teacher who
-- reloads the page loses the thread, and the corpus cannot grow past what fits
-- in a source file. These tables give the advisor a memory it owns and a
-- knowledge base a sync job can refresh without a deploy.
--
-- NOT yet applied to production — this file is the source of truth, unlike the
-- hand-applied migrations elsewhere in this directory.
--
-- Two deliberate departures from the conventions in this directory, both
-- called out again at the policy that makes them:
--   1. Client INSERT policies exist here. Everywhere else in this repo user
--      writes go through security-definer RPCs, because those writes carry
--      business rules (money, gating, state machines). Chat turns carry none:
--      the only rule is "you own the row", which is exactly what a policy
--      expresses. An RPC here would be ceremony around a plain insert.
--   2. No is_teacher() check in the policies. The route already gates on it,
--      and is_teacher() exists in production but has no versioned definition
--      in this directory — depending on it would make a database rebuilt from
--      migration history fail to apply this file.

create extension if not exists vector with schema extensions;

-- Platform knowledge, identical for every teacher. Chunked because embeddings
-- describe a passage, not a document: one vector over a whole page averages
-- its topics into mush and retrieves nothing well.
create table if not exists public.advisor_documents (
  id bigserial primary key,
  source_id text not null,
  chunk_index integer not null,
  content text not null,
  -- NOT NULL on purpose: a chunk with no embedding is invisible to
  -- match_advisor_documents, which is the only query that reads this table.
  -- The sync job must embed first and upsert the row complete.
  embedding extensions.vector(1536) not null,
  token_count integer,
  updated_at timestamptz not null default now(),
  -- The sync job is a full re-sync, not an append: it upserts on this pair so
  -- re-running it after a source edit replaces chunks instead of duplicating
  -- them, which would make the same passage win every retrieval slot.
  unique (source_id, chunk_index)
);

-- HNSW over cosine distance (<=>), matching the OpenAI text-embedding-3-small
-- vectors the sync job produces — those are normalized, so cosine is the
-- metric that reflects meaning. Built on an empty table on purpose: HNSW is
-- incremental, so there is nothing to backfill later and no window where
-- retrieval silently falls back to a sequential scan.
-- The opclass is schema-qualified because pgvector lives in `extensions`, and
-- the search_path at migration time is not ours to assume.
create index if not exists advisor_documents_embedding_idx
  on public.advisor_documents
  using hnsw (embedding extensions.vector_cosine_ops);

create table if not exists public.advisor_conversations (
  id uuid primary key default gen_random_uuid(),
  -- References auth.users, not public.users: public.users.uid is text and this
  -- column is uuid (it is compared against auth.uid() on every policy check).
  -- The cascade is what stops a deleted account from leaving its chat history
  -- behind in a table nobody audits.
  teacher_id uuid not null references auth.users(id) on delete cascade,
  -- Nullable: the title is derived from the first exchange, so it does not
  -- exist yet when the row is created. Length-capped for the same reason as
  -- advisor_messages.content below: this column takes a client write.
  title text check (length(title) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Drives the conversation sidebar: the teacher's threads, most recent first.
create index if not exists advisor_conversations_teacher_idx
  on public.advisor_conversations (teacher_id, updated_at desc);

create table if not exists public.advisor_messages (
  id bigserial primary key,
  conversation_id uuid not null
    references public.advisor_conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  -- Capped because this table takes client inserts. Everywhere else in this repo
  -- a user write lands in an RPC that validates its input first; departure 1
  -- above drops that layer, and the route's own MAX_CHARS is not a bound on
  -- anything — PostgREST is reachable directly with the publishable key, so a
  -- signed-in teacher can post a row the route never saw. 8000 leaves the route
  -- (4000 today) room to grow while keeping a single message from being a blob.
  content text not null check (length(content) <= 8000),
  created_at timestamptz not null default now()
);

-- Every read of this table is "replay one thread in order", so the index
-- covers both the filter and the sort.
create index if not exists advisor_messages_conversation_idx
  on public.advisor_messages (conversation_id, created_at);

-- The sidebar index above sorts on updated_at, and without this nothing could
-- ever move it: there is no UPDATE policy on advisor_conversations (deliberate,
-- see below), so a client bumping the parent row matches zero rows and PostgREST
-- answers 204 — a silent no-op that would leave every thread sorted by creation
-- date forever. SECURITY DEFINER precisely because the bump has to work on the
-- path that is denied UPDATE; it reads no data and returns nothing, and the
-- conversation it touches was already proven to belong to the caller by the
-- WITH CHECK on advisor_messages.
create or replace function public.advisor_touch_conversation()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  update public.advisor_conversations
  set updated_at = now()
  where id = new.conversation_id;
  return new;
end;
$function$;

-- PostgREST exposes every EXECUTE-able public function at /rest/v1/rpc, trigger
-- functions included — the hole 20260725000100 had to close after the fact.
-- Postgres checks EXECUTE when the trigger is created, not when it fires, so
-- revoking here is invisible to the trigger below.
revoke execute on function public.advisor_touch_conversation()
  from public, anon, authenticated;

drop trigger if exists advisor_messages_touch_conversation on public.advisor_messages;
create trigger advisor_messages_touch_conversation
  after insert on public.advisor_messages
  for each row execute function public.advisor_touch_conversation();

alter table public.advisor_documents enable row level security;
alter table public.advisor_conversations enable row level security;
alter table public.advisor_messages enable row level security;

-- Platform corpus: deny-all through the API, in both directions. RLS on with no
-- policy at all is how this repo spells that (payments, payout_ledger); the sync
-- job holds the service-role key and bypasses RLS, and readers come through
-- match_advisor_documents below, which is SECURITY DEFINER.
-- A blanket `for select to authenticated using (true)` would work too, and would
-- also let any signed-in account page the whole corpus — embeddings included, at
-- 1536 floats a row — out through /rest/v1/advisor_documents. Nothing in the
-- codebase reads this table directly, so that policy would grant reach no caller
-- asked for. The drop is here for environments where an earlier revision of this
-- file already created it.
drop policy if exists advisor_documents_authenticated_read on public.advisor_documents;

-- (select auth.uid()) rather than auth.uid(): the subselect is evaluated once
-- per statement instead of once per row, which is the difference between a
-- sidebar that loads and one that scans.
drop policy if exists advisor_conversations_owner_read on public.advisor_conversations;
create policy advisor_conversations_owner_read on public.advisor_conversations
  for select to authenticated
  using (teacher_id = (select auth.uid()));

-- The WITH CHECK is what stops a teacher from opening a thread stamped with
-- somebody else's id and then reading it back through the policy above.
drop policy if exists advisor_conversations_owner_insert on public.advisor_conversations;
create policy advisor_conversations_owner_insert on public.advisor_conversations
  for insert to authenticated
  with check (teacher_id = (select auth.uid()));

-- No UPDATE or DELETE policy on either table, deliberately: a chat log that the
-- client can rewrite is not a log. Renaming a thread or deleting one is a
-- product decision that has not been made; when it is, it gets a definer RPC
-- like the rest of this repo, not a blanket policy.

-- Ownership of a message is not stored on the message — it is inherited from
-- the conversation, so the check has to walk to the parent. The subquery is
-- itself subject to advisor_conversations' own RLS, so a teacher probing for
-- another teacher's conversation_id finds no row and the check fails closed.
drop policy if exists advisor_messages_owner_read on public.advisor_messages;
create policy advisor_messages_owner_read on public.advisor_messages
  for select to authenticated
  using (
    exists (
      select 1
      from public.advisor_conversations c
      where c.id = advisor_messages.conversation_id
        and c.teacher_id = (select auth.uid())
    )
  );

drop policy if exists advisor_messages_owner_insert on public.advisor_messages;
create policy advisor_messages_owner_insert on public.advisor_messages
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.advisor_conversations c
      where c.id = advisor_messages.conversation_id
        and c.teacher_id = (select auth.uid())
    )
  );

-- Retrieval entry point, and the only read path into advisor_documents: the
-- table is deny-all under RLS, so SECURITY DEFINER is what makes this work at
-- all. It also means the corpus can only be reached one page at a time through
-- a bounded top-k, never enumerated.
-- search_path includes 'extensions' because both the vector type and the <=>
-- operator live there; a definer function with a loose search_path is how
-- privilege escalation gets in, so it is pinned rather than inherited.
create or replace function public.match_advisor_documents(
  query_embedding extensions.vector(1536),
  match_threshold float,
  match_count integer
)
returns table (content text, similarity float)
language sql
stable
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
  select
    d.content,
    -- <=> is cosine DISTANCE (0 = identical). Callers rank and threshold on
    -- similarity, so invert it here rather than in four different places.
    1 - (d.embedding <=> query_embedding) as similarity
  from public.advisor_documents d
  -- A pure top-k always returns k rows, relevant or not: ask "what is the
  -- refund window" of a corpus that never mentions refunds and it still hands
  -- back the five least-unrelated paragraphs, which the prompt then presents to
  -- the model as knowledge. That is a hallucination the retrieval layer
  -- manufactured. The floor lets the query legitimately return NOTHING, which is
  -- what makes "I don't have that information" reachable.
  -- Written as distance rather than similarity so pgvector can use the HNSW
  -- index for the filter instead of re-computing per row.
  where d.embedding <=> query_embedding < 1 - match_threshold
  order by d.embedding <=> query_embedding
  -- Clamped, not trusted: match_count reaches this function from a request
  -- body, and an unbounded value turns one chat turn into a full table sort.
  limit greatest(1, least(coalesce(match_count, 5), 50));
$function$;

revoke all on function public.match_advisor_documents(
  extensions.vector, float, integer
) from public, anon;

grant execute on function public.match_advisor_documents(
  extensions.vector, float, integer
) to authenticated, service_role;
