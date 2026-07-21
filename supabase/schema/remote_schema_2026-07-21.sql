-- ============================================================================
--  SKILLSETMIND / skillset-foundation -- BASELINE DE ESQUEMA (schema public)
-- ============================================================================
--
--  O QUE E ESTE ARQUIVO
--  --------------------
--  Um snapshot COMPLETO da ESTRUTURA do schema "public" do banco de producao,
--  reconstruido em SQL replayavel. Ele existe porque o repositorio nao
--  conseguia mais reconstruir o banco: havia 21 migrations versionadas contra
--  43 migrations realmente aplicadas no projeto remoto. Este baseline fecha
--  esse buraco.
--
--  DE ONDE VEIO
--  ------------
--  Projeto Supabase ...: ijtikldtjvsbtwszokvs (SkillsetMind / skillset-foundation)
--  PostgreSQL .........: 17.6
--  Extraido em ........: 2026-07-21
--  Metodo .............: introspeccao SOMENTE-LEITURA do catalogo, via MCP
--                        (pg_get_functiondef, pg_get_triggerdef, pg_get_constraintdef,
--                        pg_get_indexdef, pg_get_expr, format_type). Sem pg_dump,
--                        sem senha do banco, sem nenhum DDL executado no remoto.
--  Conteudo ...........: APENAS estrutura. Zero linhas de dados de negocio.
--  Escopo .............: schema "public", MAIS as duas dependencias cross-schema
--                        que o app precisa para funcionar:
--                          - bloco 6, fim: trigger on_auth_user_created em
--                            auth.users -> public.handle_new_user()
--                          - bloco 7B: as 10 policies RLS de storage.objects
--                        O resto de auth/storage/realtime/vault/cron/graphql e
--                        gerido pela plataforma Supabase e NAO entra aqui (ha
--                        ainda uma nota informativa sobre storage.buckets no
--                        bloco 8).
--
--  ============================================================================
--  ####  A V I S O   -   N A O   R O D E   I S T O   E M   P R O D U C A O  ####
--  ============================================================================
--
--    Este arquivo NAO e uma migration. Ele NAO tem "IF NOT EXISTS" na maior
--    parte do DDL, de proposito: ele deve FALHAR ALTO se o alvo ja tiver
--    objetos. Rodar contra o banco de producao existente (ijtikldtjvsbtwszokvs)
--    vai, na melhor das hipoteses, estourar erro no primeiro CREATE TABLE, e na
--    pior recriar funcoes e policies por cima do estado vivo.
--
--    Use SOMENTE contra um banco NOVO E VAZIO:
--      - um projeto Supabase novo,
--      - uma branch de banco,
--      - um `supabase start` local,
--      - um Postgres 17 limpo.
--
--  ============================================================================
--
--  COMO APLICAR (projeto novo)
--  ---------------------------
--    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f remote_schema_2026-07-21.sql
--
--  Local (Supabase CLI):
--    supabase start
--    psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--         -v ON_ERROR_STOP=1 -f remote_schema_2026-07-21.sql
--
--  Pre-requisitos no alvo:
--    - PostgreSQL 17 (o bloco de GRANTs usa o privilegio MAINTAIN, que so existe
--      em PG17+; em PG16 ou anterior, remova o token MAINTAIN das listas).
--    - Os roles do Supabase (anon, authenticated, service_role, postgres) devem
--      existir -- ja existem em qualquer projeto Supabase. Num Postgres puro,
--      crie-os antes, senao o bloco 8 (GRANTs) falha.
--    - O schema "extensions" deve existir (ja existe no Supabase). Num Postgres
--      puro: create schema if not exists extensions;
--    - O schema "auth", com auth.uid() e auth.role(), deve existir ANTES do
--      bloco 4. Isto nao e opcional: 8 funcoes do bloco 4 sao LANGUAGE sql e o
--      Postgres PARSEIA o corpo no CREATE (check_function_bodies = on, default).
--      Sem o schema auth elas estouram "schema auth does not exist" -- a
--      primeira e has_enrollment_for_course_slug, depois is_admin, is_moderator,
--      is_ops, is_service_role, is_support, is_target_author, is_teacher. As ~51
--      funcoes plpgsql passam porque o corpo delas nao e validado no CREATE, o
--      que torna a falha assimetrica e confusa de diagnosticar. Num Postgres
--      puro: criar o schema auth e stubs de auth.uid()/auth.role() antes, ou
--      rodar com "set check_function_bodies = off".
--    - Para os dois blocos cross-schema: o bloco 6 (fim) exige auth.users e o
--      bloco 7B exige storage.objects + storage.foldername(). Ambos existem em
--      qualquer projeto Supabase. Num Postgres puro nao existem -- pule esses
--      dois statements e saiba que (a) signup nao popula public.users e (b) nao
--      havera regra de acesso no storage.
--    - pg_stat_statements NAO e criada por este arquivo (e telemetria, nao
--      estrutura). Ver a nota no bloco 1 se o alvo precisar dela.
--
--  ORDEM DE REPLAY (por que esta ordem)
--  ------------------------------------
--    1. extensions/types/sequences  -> pgcrypto etc. antes de qualquer default
--    2. tables                      -> colunas + NOT NULL + defaults
--    3. constraints                 -> PK -> UNIQUE -> CHECK -> FK
--    4. functions                   -> ANTES de triggers, indices e policies,
--                                      porque todos eles referenciam funcoes
--                                      (server_write_only(), is_admin(), ...)
--    5. indexes                     -> indices nao-constraint (parciais/expressao)
--    6. triggers                    -> dependem das funcoes do bloco 4
--    7. RLS + policies              -> policies chamam funcoes do bloco 4
--    7B. RLS de storage.objects     -> cross-schema; depende de is_admin(),
--                                      public.courses e public.enrollments
--    8. grants / publications / misc-> por ultimo, sobre objetos ja existentes
--
--  IDEMPOTENCIA
--  ------------
--    Idempotente onde o Postgres suporta de graca:
--      - CREATE EXTENSION IF NOT EXISTS (bloco 1)
--      - CREATE OR REPLACE FUNCTION      (bloco 4)
--    O restante (tabelas, constraints, indices, triggers, policies, grants) e
--    de aplicacao unica, intencionalmente. Nao adicione "IF NOT EXISTS" nas
--    tabelas: isso mascara um banco meio-aplicado e faz o replay mentir.
--
--  INVENTARIO (contagens apuradas no catalogo, nao estimadas)
--  ----------------------------------------------------------
--    extensoes replayaveis .......   3   (pgcrypto, unaccent, uuid-ossp;
--                                         pg_stat_statements fica comentada --
--                                         telemetria, ver bloco 1)
--    enums / domains / composites    0
--    sequences ...................   0   (todas as PKs sao text/uuid)
--    tabelas .....................  45   (497 colunas; 0 particionadas, 0 views)
--    constraints .................. 181  (45 PK, 5 UNIQUE, 97 CHECK, 34 FK)
--    funcoes ......................  59   (55 SECURITY DEFINER, 59/59 com
--                                          search_path fixado)
--    indices (nao-constraint) .....  92   (de 142 no total; 50 pertencem a
--                                          constraints do bloco 3)
--    triggers .....................  15   (14 BEFORE, 1 AFTER, todos ROW-level)
--                                    + 1   cross-schema: on_auth_user_created em
--                                          auth.users -> public.handle_new_user()
--    tabelas com RLS ligado .......  45   (100%; 7 com FORCE RLS)
--    policies (public) ............ 124   (5 tabelas ficam deny-all de proposito)
--    policies (storage.objects) ...  10   (bloco 7B; 2 buckets)
--    publications .................   2
--
--  NOTAS DE SEGURANCA HERDADAS DA EXTRACAO
--  ---------------------------------------
--    - 5 tabelas estao com RLS ligado e ZERO policies (deny-all para qualquer
--      role sem BYPASSRLS): course_coupon_reservations, course_title_keys,
--      platform_config, processed_stripe_events, subscriptions. Isso e
--      intencional se o acesso for so por service_role; e um bug latente se o
--      app tentar ler alguma delas com a chave anon/authenticated.
--    - pg_cron e supabase_vault existem no remoto mas sao geridos pela
--      plataforma: nao sao replayados aqui (ver comentarios no bloco 1).
--
--  ARQUIVOS-FONTE
--  --------------
--    Este arquivo e a concatenacao, nesta ordem, de supabase/schema/parts/:
--      01_extensions_types_sequences.sql
--      02_tables.sql
--      03_constraints.sql
--      05_functions.sql
--      04_indexes.sql
--      06_triggers.sql
--      07_rls_policies.sql
--      09_storage_rls.sql
--      08_grants_publications_misc.sql
--    As fatias seguem sendo a fonte de verdade para reextracao/diff.
--
-- ============================================================================

-- search_path de replay: o catalogo guarda varias referencias sem qualificacao
-- de schema (ex.: EXECUTE FUNCTION server_write_only()). Com public+extensions
-- no caminho, tudo resolve igual ao remoto.
SET search_path = public, extensions;



-- ############################################################################
-- ## BLOCO 1 : EXTENSIONS / TYPES / SEQUENCES
-- ## fonte: parts/01_extensions_types_sequences.sql
-- ############################################################################

-- Fatia: extensions
-- Origem: catalogo do projeto ijtikldtjvsbtwszokvs, extraido em 2026-07-21
-- Gerado por introspeccao (sem senha do banco / sem pg_dump)
-- Contagens apuradas:
--   extensoes instaladas ............ 7 (1 built-in plpgsql, 2 plataforma Supabase,
--                                        3 replayaveis + pg_stat_statements comentada)
--   schemas nao-Supabase ............ 0 (alem de public)
--   enums em public ................. 0
--   domains em public ............... 0
--   composites em public ............ 0
--   sequences em public ............. 0
--   statements executaveis .......... 3

-- =====================================================================
-- 1. SCHEMAS
-- =====================================================================
-- Schemas presentes no banco: auth, cron, extensions, graphql, graphql_public,
-- pgbouncer, public, realtime, storage, supabase_migrations, vault.
-- TODOS sao criados/geridos pela plataforma Supabase. Nenhum schema custom
-- da aplicacao existe. "public" ja existe em qualquer banco novo.
-- => Nada a criar aqui.

-- =====================================================================
-- 2. EXTENSOES
-- =====================================================================
-- Inventario completo (pg_extension + pg_namespace):
--
--   extensao             | schema     | versao  | gestao
--   ---------------------+------------+---------+---------------------------
--   plpgsql              | pg_catalog | 1.0     | built-in (ignorada)
--   pg_cron              | pg_catalog | 1.6.4   | SUPABASE (toggle no dashboard)
--   supabase_vault       | vault      | 0.3.1   | SUPABASE (plataforma)
--   pg_stat_statements   | extensions | 1.11    | Supabase (default em projetos novos)
--   pgcrypto             | extensions | 1.3     | replayavel
--   unaccent             | extensions | 1.1     | replayavel
--   uuid-ossp            | extensions | 1.1     | replayavel
--
-- Replay: as 3 abaixo sao seguras de rodar em qualquer projeto Supabase novo.
-- O schema "extensions" ja existe em projetos Supabase; num Postgres puro,
-- criar antes: create schema if not exists extensions;

create extension if not exists "pgcrypto" with schema "extensions";
create extension if not exists "unaccent" with schema "extensions";
create extension if not exists "uuid-ossp" with schema "extensions";

-- pg_stat_statements: TELEMETRIA, nao estrutura -- NAO incluir no replay.
-- Num Postgres puro o CREATE falha com "pg_stat_statements must be loaded via
-- shared_preload_libraries"; o IF NOT EXISTS nao salva (a extensao nao existe,
-- entao o CREATE e tentado de verdade) e, com ON_ERROR_STOP=1, o replay morria
-- aqui -- no primeiro statement executavel do arquivo, antes de qualquer tabela.
-- Em projetos Supabase novos ela ja vem instalada. Para um PG puro que a queira:
-- por shared_preload_libraries = 'pg_stat_statements' no postgresql.conf,
-- reiniciar o servidor, e so entao rodar a linha abaixo.
--   create extension if not exists "pg_stat_statements" with schema "extensions";

-- Geridas pela plataforma Supabase — NAO incluir no baseline replayavel.
-- Ligar pg_cron pelo Dashboard (Database > Extensions) se os jobs de cron
-- forem parte do runtime. supabase_vault vem junto com o projeto.
--   create extension if not exists "pg_cron" with schema "pg_catalog";
--   create extension if not exists "supabase_vault" with schema "vault";

-- Observacao: o schema "graphql" existe mas a extensao pg_graphql NAO consta
-- em pg_extension neste projeto (foi removida ou nunca ativada). Registrado
-- apenas como fato do catalogo; nada a replayar.

-- =====================================================================
-- 3. TIPOS CUSTOMIZADOS (enums / domains / composites) em public
-- =====================================================================
-- Nenhum. Consulta em pg_type com typtype in ('e','d','c') e
-- nspname = 'public' retornou 0 linhas (composites implicitos de tabela
-- foram excluidos). Confirma a expectativa de 0 enums.

-- =====================================================================
-- 4. SEQUENCES standalone em public
-- =====================================================================
-- Nenhuma. pg_class relkind='S' em public retornou 0 linhas — nao ha
-- sequences de nenhum tipo (nem identity/serial, nem standalone).
-- Consequencia: todas as PKs de public sao uuid/text, nao bigserial.

-- Fim da fatia: extensions


-- ############################################################################
-- ## BLOCO 2 : TABLES (45)
-- ## fonte: parts/02_tables.sql
-- ############################################################################

-- Fatia: tables
-- Origem: catalogo do projeto ijtikldtjvsbtwszokvs, extraido em 2026-07-21
-- Gerado por introspeccao (sem senha do banco / sem pg_dump)
-- 45 tabelas em public (todas relkind='r', permanentes) / 45 CREATE TABLE aqui
-- 497 colunas no total; 301 com NOT NULL; 129 com DEFAULT
-- 0 tabelas particionadas, 0 particoes, 0 heranca (pg_inherits vazio para public)
-- 0 colunas IDENTITY, 0 colunas geradas (STORED), 0 colunas com COLLATE explicito
-- 0 COMMENT ON TABLE e 0 COMMENT ON COLUMN (pg_description vazio)
-- Constraints (PK/FK/UNIQUE/CHECK), indices, triggers e RLS ficam em outras fatias.
-- NOT NULL aparece aqui por ser propriedade de coluna.

CREATE TABLE public.account_action_requests (
    id text NOT NULL,
    type text NOT NULL,
    requested_by text NOT NULL,
    email text,
    status text NOT NULL,
    requested_at timestamp with time zone,
    updated_at timestamp with time zone,
    resolved_by text,
    resolved_at timestamp with time zone
);

CREATE TABLE public.audit_log (
    id text NOT NULL,
    action text NOT NULL,
    actor_id text NOT NULL,
    actor_email text,
    target_type text NOT NULL,
    target_id text NOT NULL,
    summary text NOT NULL,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.certificates (
    id text NOT NULL,
    enrollment_id text NOT NULL,
    user_id text NOT NULL,
    course_id text NOT NULL,
    course_slug text NOT NULL,
    course_title text NOT NULL,
    course_category text NOT NULL,
    authority_label text DEFAULT 'Skillset Verified'::text NOT NULL,
    status text DEFAULT 'issued'::text NOT NULL,
    verification_code text NOT NULL,
    student_full_name text,
    teacher_name text,
    teacher_signature_url text,
    sponsor_logo_url text,
    issued_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.checkout_locks (
    lock_key text NOT NULL,
    acquired_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    user_id text,
    course_id text,
    order_id text,
    checkout_url text,
    checkout_session_id text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    claimed_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.community_comments (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    post_id text NOT NULL,
    course_slug text NOT NULL,
    author_id text NOT NULL,
    author_name text NOT NULL,
    author_role text NOT NULL,
    body text NOT NULL,
    parent_id text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone
);

CREATE TABLE public.community_post_likes (
    post_id text NOT NULL,
    liker_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.community_posts (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    course_slug text NOT NULL,
    author_id text NOT NULL,
    author_name text NOT NULL,
    author_role text NOT NULL,
    category text NOT NULL,
    body text NOT NULL,
    pinned boolean DEFAULT false,
    created_at timestamp with time zone,
    updated_at timestamp with time zone
);

CREATE TABLE public.community_reports (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    course_slug text NOT NULL,
    post_id text NOT NULL,
    comment_id text,
    target_type text NOT NULL,
    target_author_id text NOT NULL,
    target_author_name text NOT NULL,
    reporter_id text NOT NULL,
    reporter_name text NOT NULL,
    reporter_email text,
    reason text NOT NULL,
    detail text,
    status text DEFAULT 'open'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.course_assets (
    id text NOT NULL,
    course_id text NOT NULL,
    owner_id text NOT NULL,
    kind text NOT NULL,
    file_name text NOT NULL,
    content_type text NOT NULL,
    size integer NOT NULL,
    storage_path text NOT NULL,
    download_url text,
    is_preview boolean DEFAULT false NOT NULL,
    lesson_id text,
    module_id text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    bunny_video_id text
);

CREATE TABLE public.course_commerce_settings (
    course_id text NOT NULL,
    owner_id text NOT NULL,
    affiliate_enabled boolean DEFAULT false NOT NULL,
    affiliate_commission_pct integer DEFAULT 25 NOT NULL,
    affiliate_approval text DEFAULT 'manual'::text NOT NULL,
    tax_collection boolean DEFAULT false NOT NULL,
    tax_regions jsonb DEFAULT '[]'::jsonb NOT NULL,
    tax_registration_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.course_coproducers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    course_id text NOT NULL,
    owner_id text NOT NULL,
    invitee_email text NOT NULL,
    revenue_share_pct integer NOT NULL,
    status text DEFAULT 'invited'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.course_coupon_reservations (
    order_id text NOT NULL,
    coupon_id uuid NOT NULL,
    user_id text NOT NULL,
    status text DEFAULT 'reserved'::text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.course_coupons (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    course_id text NOT NULL,
    owner_id text NOT NULL,
    code text NOT NULL,
    percent_off integer NOT NULL,
    max_redemptions integer DEFAULT 100 NOT NULL,
    redeemed_count integer DEFAULT 0 NOT NULL,
    expires_at timestamp with time zone,
    active boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.course_event_rsvps (
    event_id text NOT NULL,
    uid text NOT NULL,
    course_slug text NOT NULL,
    user_id text NOT NULL,
    attendee_name text NOT NULL,
    attendee_email text,
    status text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.course_events (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    course_id text NOT NULL,
    course_slug text NOT NULL,
    course_title text NOT NULL,
    owner_id text NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    type text NOT NULL,
    status text NOT NULL,
    starts_at text NOT NULL,
    external_url text NOT NULL,
    recording_asset_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.course_lesson_content (
    lesson_id text NOT NULL,
    course_id text NOT NULL,
    content_text text,
    external_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.course_messages (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    course_id text NOT NULL,
    course_title text DEFAULT ''::text NOT NULL,
    student_id text NOT NULL,
    student_name text DEFAULT ''::text NOT NULL,
    teacher_id text NOT NULL,
    sender_id text NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.course_reviews (
    id text NOT NULL,
    course_id text NOT NULL,
    author_name text NOT NULL,
    rating integer NOT NULL,
    body text,
    status text DEFAULT 'published'::text NOT NULL,
    created_at timestamp with time zone,
    updated_at timestamp with time zone
);

CREATE TABLE public.course_subscriptions (
    id text NOT NULL,
    user_id text NOT NULL,
    course_slug text,
    status text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    course_id text,
    teacher_id text,
    stripe_subscription_id text,
    stripe_customer_id text,
    "interval" text,
    current_period_end timestamp with time zone,
    cancel_at_period_end boolean DEFAULT false NOT NULL,
    past_due boolean DEFAULT false NOT NULL,
    latest_invoice_id text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    offer_id text,
    price_id text,
    price_amount_minor numeric,
    currency text
);

CREATE TABLE public.course_title_keys (
    title_key text NOT NULL
);

CREATE TABLE public.courses (
    id text NOT NULL,
    owner_id text NOT NULL,
    slug text,
    title text NOT NULL,
    title_key text,
    summary text NOT NULL,
    category text NOT NULL,
    categories text[],
    learning_outcomes text[],
    status text DEFAULT 'draft'::text NOT NULL,
    modules jsonb DEFAULT '[]'::jsonb NOT NULL,
    lesson_count integer DEFAULT 0 NOT NULL,
    price_amount_minor integer,
    currency text,
    payment_type text,
    installments_enabled boolean,
    installments_max integer,
    platform_fee_bps integer,
    drip_strategy text,
    drip_interval_days integer,
    free_preview_lesson_id text,
    cover_image_url text,
    review_note text,
    rating_average numeric,
    rating_count integer,
    rating_sum integer,
    review_count integer,
    enrollment_count integer,
    trending_score numeric,
    featured boolean,
    featured_rank integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    members_theme text,
    members_cover_asset_id text,
    members_title text,
    members_subtitle text,
    members_description text,
    stripe_connected_account_id text,
    stripe_subscription_price jsonb,
    community_enabled boolean DEFAULT false NOT NULL
);

CREATE TABLE public.creator_verification_cases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    creator_id text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    profession text NOT NULL,
    registration_type text NOT NULL,
    registration_id text NOT NULL,
    registration_region text NOT NULL,
    evidence_links jsonb DEFAULT '[]'::jsonb NOT NULL,
    note text,
    review_note text,
    reviewed_by text,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.enrollments (
    id text NOT NULL,
    user_id text NOT NULL,
    course_id text NOT NULL,
    course_slug text NOT NULL,
    course_title text NOT NULL,
    course_category text NOT NULL,
    course_image text NOT NULL,
    status text NOT NULL,
    source text NOT NULL,
    subscription_id text,
    progress_percent integer DEFAULT 0 NOT NULL,
    last_lesson_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.leaderboards (
    "window" text NOT NULL,
    entries jsonb NOT NULL,
    updated_at timestamp with time zone
);

CREATE TABLE public.learning_path_items (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    path_id text NOT NULL,
    course_id text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL
);

CREATE TABLE public.learning_paths (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    title text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.lesson_comments (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    course_id text NOT NULL,
    lesson_id text NOT NULL,
    author_id text NOT NULL,
    author_name text NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone,
    updated_at timestamp with time zone
);

CREATE TABLE public.lesson_progress (
    enrollment_id text NOT NULL,
    lesson_id text NOT NULL,
    user_id text NOT NULL,
    completed_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.member_stats (
    uid text NOT NULL,
    display_name text DEFAULT 'Member'::text NOT NULL,
    points integer DEFAULT 0 NOT NULL,
    level integer DEFAULT 1 NOT NULL,
    total_likes_received integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone
);

CREATE TABLE public.notifications (
    notification_id text NOT NULL,
    user_id text NOT NULL,
    type text NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    read boolean DEFAULT false NOT NULL,
    link text,
    actor_name text,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.orders (
    id text NOT NULL,
    user_id text NOT NULL,
    course_id text,
    amount_minor integer NOT NULL,
    currency text NOT NULL,
    status text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    course_slug text,
    course_title text,
    platform_fee_bps integer,
    provider text,
    checkout_session_id text,
    payment_intent_id text,
    teacher_id text,
    teacher_stripe_connected_account_id text,
    payout_model text,
    receipt_url text,
    paid_at timestamp with time zone,
    refunded_amount_minor integer DEFAULT 0 NOT NULL,
    refund_requested_at timestamp with time zone,
    refund_request_id text,
    transfer_reversed_amount_minor integer DEFAULT 0 NOT NULL,
    latest_transfer_reversal_id text,
    latest_transfer_reversal_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    offer_id text,
    price_id text,
    coupon_code text,
    discount_minor numeric DEFAULT 0 NOT NULL
);

CREATE TABLE public.payments (
    id text NOT NULL,
    order_id text NOT NULL,
    user_id text NOT NULL,
    amount_minor integer NOT NULL,
    currency text NOT NULL,
    status text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    course_id text,
    provider text,
    provider_payment_id text,
    receipt_url text,
    refunded_amount_minor integer DEFAULT 0 NOT NULL,
    refunded_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.payout_ledger (
    id text NOT NULL,
    teacher_id text NOT NULL,
    payment_id text,
    amount_minor integer NOT NULL,
    platform_fee_minor integer DEFAULT 0 NOT NULL,
    currency text NOT NULL,
    status text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    teacher_stripe_connected_account_id text,
    course_id text,
    order_id text,
    invoice_id text,
    subscription_id text,
    payment_id_is_payment_intent boolean DEFAULT false NOT NULL,
    kind text,
    gross_amount_minor integer DEFAULT 0 NOT NULL,
    skillset_fee_minor integer DEFAULT 0 NOT NULL,
    stripe_fee_minor integer DEFAULT 0 NOT NULL,
    net_amount_minor integer DEFAULT 0 NOT NULL,
    platform_fee_bps integer,
    release_at timestamp with time zone,
    refunded_amount_minor integer DEFAULT 0 NOT NULL,
    refunded_at timestamp with time zone,
    transfer_id text,
    transfer_amount_minor integer,
    planned_transfer_amount_minor integer,
    transfer_reversed_amount_minor integer DEFAULT 0 NOT NULL,
    latest_transfer_reversal_id text,
    latest_transfer_reversal_at timestamp with time zone,
    refund_reversal_claims jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.platform_config (
    doc_id text NOT NULL,
    payout_release_delay_days integer
);

CREATE TABLE public.platform_settings (
    key text NOT NULL,
    value jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.points_events (
    id text NOT NULL,
    uid text NOT NULL,
    kind text NOT NULL,
    delta integer NOT NULL,
    post_id text NOT NULL,
    liker_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.processed_stripe_events (
    stripe_event_id text NOT NULL,
    processed_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'done'::text NOT NULL,
    claimed_at timestamp with time zone
);

CREATE TABLE public.product_offers (
    id text NOT NULL,
    course_id text NOT NULL,
    name text NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    active boolean DEFAULT true NOT NULL,
    public_code text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.product_prices (
    id text NOT NULL,
    offer_id text NOT NULL,
    amount_minor numeric NOT NULL,
    currency text DEFAULT 'USD'::text NOT NULL,
    payment_type text DEFAULT 'one_time'::text NOT NULL,
    stripe_price_id text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.public_profiles (
    uid text NOT NULL,
    display_name text,
    username text,
    photo_url text,
    bio text,
    credentials jsonb,
    updated_at timestamp with time zone
);

CREATE TABLE public.rate_limits (
    key text NOT NULL,
    count integer NOT NULL,
    window_started_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.subscriptions (
    id text NOT NULL,
    user_id text NOT NULL,
    status text NOT NULL,
    current_period_end timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    plan_id text,
    cycle text,
    stripe_customer_id text,
    stripe_subscription_id text,
    stripe_price_id text,
    current_period_start timestamp with time zone,
    cancel_at_period_end boolean DEFAULT false NOT NULL,
    past_due boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.support_tickets (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    user_id text NOT NULL,
    user_email text,
    user_name text,
    category text NOT NULL,
    subject text NOT NULL,
    message text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    admin_response text,
    responded_by text,
    responded_at timestamp with time zone,
    created_at timestamp with time zone,
    updated_at timestamp with time zone
);

CREATE TABLE public.users (
    uid text NOT NULL,
    email text,
    display_name text,
    username text,
    bio text,
    phone_number text,
    timezone text,
    goals jsonb,
    credentials jsonb,
    photo_url text,
    teacher_signature_url text,
    roles jsonb DEFAULT '["guest"]'::jsonb NOT NULL,
    onboarding_completed boolean DEFAULT false NOT NULL,
    onboarding_answers jsonb,
    onboarding_path text,
    onboarding_completed_at timestamp with time zone,
    terms_accepted_at timestamp with time zone,
    terms_version text,
    privacy_accepted_at timestamp with time zone,
    privacy_version text,
    teacher_terms_accepted_at timestamp with time zone,
    teacher_terms_version text,
    marketing_consent boolean,
    stripe_connected_account_id text,
    stripe_connect_status text,
    stripe_connect_charges_enabled boolean,
    stripe_connect_payouts_enabled boolean,
    stripe_connect_updated_at timestamp with time zone,
    stripe_customer_id text,
    current_plan_id text,
    preferences jsonb,
    storefront jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_login_at timestamp with time zone DEFAULT now() NOT NULL,
    creator_verification_status text DEFAULT 'none'::text NOT NULL
);

CREATE TABLE public.wishlists (
    id text NOT NULL,
    user_id text NOT NULL,
    course_id text NOT NULL,
    course_slug text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

-- COMMENT ON TABLE / COLUMN: nenhum encontrado.
-- pg_description para public (relkind='r') retornou 0 comentarios de tabela e 0 de coluna.


-- ############################################################################
-- ## BLOCO 3 : CONSTRAINTS (PK, UNIQUE, CHECK, FK)
-- ## fonte: parts/03_constraints.sql
-- ############################################################################

-- Fatia: constraints
-- Origem: catalogo do projeto ijtikldtjvsbtwszokvs, extraido em 2026-07-21
-- Gerado por introspeccao (sem senha do banco / sem pg_dump)
-- Total: 181 constraints em public
--   PRIMARY KEY : 45
--   UNIQUE      : 5
--   CHECK       : 97
--   FOREIGN KEY : 34
-- Ordem: PK -> UNIQUE -> CHECK -> FK (FK depende de PK/UNIQUE ja existir no alvo).
-- Nota: NOT NULL nao aparece em pg_constraint nesta versao; ver 02_tables.sql.
-- Nota: alvos de FK foram qualificados com "public." (pg_get_constraintdef omite o schema
--       quando ele esta no search_path).

-- =============================================================
-- 1) PRIMARY KEY (45)
-- =============================================================

alter table only public.account_action_requests add constraint account_action_requests_pkey PRIMARY KEY (id);
alter table only public.audit_log add constraint audit_log_pkey PRIMARY KEY (id);
alter table only public.certificates add constraint certificates_pkey PRIMARY KEY (id);
alter table only public.checkout_locks add constraint checkout_locks_pkey PRIMARY KEY (lock_key);
alter table only public.community_comments add constraint community_comments_pkey PRIMARY KEY (id);
alter table only public.community_post_likes add constraint community_post_likes_pkey PRIMARY KEY (post_id, liker_id);
alter table only public.community_posts add constraint community_posts_pkey PRIMARY KEY (id);
alter table only public.community_reports add constraint community_reports_pkey PRIMARY KEY (id);
alter table only public.course_assets add constraint course_assets_pkey PRIMARY KEY (id);
alter table only public.course_commerce_settings add constraint course_commerce_settings_pkey PRIMARY KEY (course_id);
alter table only public.course_coproducers add constraint course_coproducers_pkey PRIMARY KEY (id);
alter table only public.course_coupon_reservations add constraint course_coupon_reservations_pkey PRIMARY KEY (order_id);
alter table only public.course_coupons add constraint course_coupons_pkey PRIMARY KEY (id);
alter table only public.course_event_rsvps add constraint course_event_rsvps_pkey PRIMARY KEY (event_id, uid);
alter table only public.course_events add constraint course_events_pkey PRIMARY KEY (id);
alter table only public.course_lesson_content add constraint course_lesson_content_pkey PRIMARY KEY (lesson_id);
alter table only public.course_messages add constraint course_messages_pkey PRIMARY KEY (id);
alter table only public.course_reviews add constraint course_reviews_pkey PRIMARY KEY (id);
alter table only public.course_subscriptions add constraint course_subscriptions_pkey PRIMARY KEY (id);
alter table only public.course_title_keys add constraint course_title_keys_pkey PRIMARY KEY (title_key);
alter table only public.courses add constraint courses_pkey PRIMARY KEY (id);
alter table only public.creator_verification_cases add constraint creator_verification_cases_pkey PRIMARY KEY (id);
alter table only public.enrollments add constraint enrollments_pkey PRIMARY KEY (id);
alter table only public.leaderboards add constraint leaderboards_pkey PRIMARY KEY ("window");
alter table only public.learning_path_items add constraint learning_path_items_pkey PRIMARY KEY (id);
alter table only public.learning_paths add constraint learning_paths_pkey PRIMARY KEY (id);
alter table only public.lesson_comments add constraint lesson_comments_pkey PRIMARY KEY (id);
alter table only public.lesson_progress add constraint lesson_progress_pkey PRIMARY KEY (enrollment_id, lesson_id);
alter table only public.member_stats add constraint member_stats_pkey PRIMARY KEY (uid);
alter table only public.notifications add constraint notifications_pkey PRIMARY KEY (notification_id);
alter table only public.orders add constraint orders_pkey PRIMARY KEY (id);
alter table only public.payments add constraint payments_pkey PRIMARY KEY (id);
alter table only public.payout_ledger add constraint payout_ledger_pkey PRIMARY KEY (id);
alter table only public.platform_config add constraint platform_config_pkey PRIMARY KEY (doc_id);
alter table only public.platform_settings add constraint platform_settings_pkey PRIMARY KEY (key);
alter table only public.points_events add constraint points_events_pkey PRIMARY KEY (id);
alter table only public.processed_stripe_events add constraint processed_stripe_events_pkey PRIMARY KEY (stripe_event_id);
alter table only public.product_offers add constraint product_offers_pkey PRIMARY KEY (id);
alter table only public.product_prices add constraint product_prices_pkey PRIMARY KEY (id);
alter table only public.public_profiles add constraint public_profiles_pkey PRIMARY KEY (uid);
alter table only public.rate_limits add constraint rate_limits_pkey PRIMARY KEY (key);
alter table only public.subscriptions add constraint subscriptions_pkey PRIMARY KEY (id);
alter table only public.support_tickets add constraint support_tickets_pkey PRIMARY KEY (id);
alter table only public.users add constraint users_pkey PRIMARY KEY (uid);
alter table only public.wishlists add constraint wishlists_pkey PRIMARY KEY (id);

-- =============================================================
-- 2) UNIQUE (5)
-- =============================================================

alter table only public.certificates add constraint certificates_verification_code_key UNIQUE (verification_code);
alter table only public.course_coupons add constraint course_coupons_course_id_code_key UNIQUE (course_id, code);
alter table only public.courses add constraint courses_slug_key UNIQUE (slug);
alter table only public.learning_path_items add constraint learning_path_items_path_id_course_id_key UNIQUE (path_id, course_id);
alter table only public.users add constraint users_username_key UNIQUE (username);

-- =============================================================
-- 3) CHECK (97)
-- =============================================================

alter table only public.certificates add constraint certificates_status_check CHECK ((status = ANY (ARRAY['issued'::text, 'revoked'::text])));
alter table only public.community_comments add constraint community_comments_author_name_len CHECK (((char_length(author_name) >= 1) AND (char_length(author_name) <= 120)));
alter table only public.community_comments add constraint community_comments_author_role_len CHECK (((char_length(author_role) >= 3) AND (char_length(author_role) <= 40)));
alter table only public.community_comments add constraint community_comments_body_len CHECK (((char_length(body) >= 3) AND (char_length(body) <= 3000)));
alter table only public.community_reports add constraint community_reports_course_slug_len_check CHECK (((char_length(course_slug) >= 3) AND (char_length(course_slug) <= 160)));
alter table only public.community_reports add constraint community_reports_detail_len_check CHECK (((detail IS NULL) OR (char_length(detail) <= 1000)));
alter table only public.community_reports add constraint community_reports_post_id_len_check CHECK (((char_length(post_id) >= 3) AND (char_length(post_id) <= 160)));
alter table only public.community_reports add constraint community_reports_reason_check CHECK ((reason = ANY (ARRAY['spam'::text, 'harassment'::text, 'unsafe_content'::text, 'off_topic'::text, 'other'::text])));
alter table only public.community_reports add constraint community_reports_reporter_name_len_check CHECK (((char_length(reporter_name) >= 1) AND (char_length(reporter_name) <= 120)));
alter table only public.community_reports add constraint community_reports_status_check CHECK ((status = ANY (ARRAY['open'::text, 'reviewed'::text, 'resolved'::text, 'dismissed'::text])));
alter table only public.community_reports add constraint community_reports_target_author_id_len_check CHECK (((char_length(target_author_id) >= 3) AND (char_length(target_author_id) <= 160)));
alter table only public.community_reports add constraint community_reports_target_author_name_len_check CHECK (((char_length(target_author_name) >= 1) AND (char_length(target_author_name) <= 120)));
alter table only public.community_reports add constraint community_reports_target_type_check CHECK ((target_type = ANY (ARRAY['post'::text, 'comment'::text])));
alter table only public.course_assets add constraint course_assets_content_type_check CHECK (((char_length(content_type) >= 3) AND (char_length(content_type) <= 120)));
alter table only public.course_assets add constraint course_assets_download_url_check CHECK (((download_url IS NULL) OR ((char_length(download_url) >= 8) AND (char_length(download_url) <= 1200))));
alter table only public.course_assets add constraint course_assets_file_name_check CHECK (((char_length(file_name) >= 1) AND (char_length(file_name) <= 180)));
alter table only public.course_assets add constraint course_assets_kind_check CHECK ((kind = ANY (ARRAY['course_cover'::text, 'members_cover'::text, 'module_cover'::text, 'lesson_thumbnail'::text, 'lesson_material'::text, 'lesson_video'::text, 'live_recording'::text])));
alter table only public.course_assets add constraint course_assets_size_check CHECK (((size >= 1) AND (size <= 524288000)));
alter table only public.course_commerce_settings add constraint course_commerce_settings_affiliate_approval_check CHECK ((affiliate_approval = ANY (ARRAY['manual'::text, 'automatic'::text])));
alter table only public.course_commerce_settings add constraint course_commerce_settings_affiliate_commission_pct_check CHECK (((affiliate_commission_pct >= 5) AND (affiliate_commission_pct <= 60)));
alter table only public.course_coproducers add constraint course_coproducers_revenue_share_pct_check CHECK (((revenue_share_pct >= 5) AND (revenue_share_pct <= 90)));
alter table only public.course_coproducers add constraint course_coproducers_status_check CHECK ((status = ANY (ARRAY['invited'::text, 'accepted'::text, 'revoked'::text])));
alter table only public.course_coupon_reservations add constraint course_coupon_reservations_status_check CHECK ((status = ANY (ARRAY['reserved'::text, 'redeemed'::text, 'released'::text])));
alter table only public.course_coupons add constraint course_coupons_code_check CHECK ((code ~ '^[A-Z0-9][A-Z0-9-]{2,23}$'::text));
alter table only public.course_coupons add constraint course_coupons_max_redemptions_check CHECK (((max_redemptions >= 1) AND (max_redemptions <= 100000)));
alter table only public.course_coupons add constraint course_coupons_percent_off_check CHECK (((percent_off >= 5) AND (percent_off <= 90)));
alter table only public.course_coupons add constraint course_coupons_redeemed_count_check CHECK ((redeemed_count >= 0));
alter table only public.course_coupons add constraint course_coupons_redeemed_within_cap CHECK ((redeemed_count <= max_redemptions));
alter table only public.course_event_rsvps add constraint course_event_rsvps_attendee_name_check CHECK (((char_length(attendee_name) >= 1) AND (char_length(attendee_name) <= 120)));
alter table only public.course_event_rsvps add constraint course_event_rsvps_status_check CHECK ((status = ANY (ARRAY['attending'::text, 'not_attending'::text])));
alter table only public.course_event_rsvps add constraint course_event_rsvps_uid_is_user CHECK ((uid = user_id));
alter table only public.course_events add constraint course_events_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'completed'::text, 'cancelled'::text])));
alter table only public.course_events add constraint course_events_type_check CHECK ((type = ANY (ARRAY['live_class'::text, 'mentorship'::text, 'office_hours'::text, 'webinar'::text, 'deadline'::text])));
alter table only public.course_lesson_content add constraint course_lesson_content_content_text_len CHECK ((char_length(content_text) <= 20000));
alter table only public.course_lesson_content add constraint course_lesson_content_external_url_len CHECK ((char_length(external_url) <= 2000));
alter table only public.course_reviews add constraint course_reviews_body_check CHECK (((body IS NULL) OR (char_length(body) <= 1200)));
alter table only public.course_reviews add constraint course_reviews_rating_check CHECK (((rating >= 1) AND (rating <= 5)));
alter table only public.course_reviews add constraint course_reviews_status_check CHECK ((status = ANY (ARRAY['published'::text, 'hidden'::text])));
alter table only public.course_title_keys add constraint course_title_keys_title_key_length CHECK (((char_length(title_key) >= 3) AND (char_length(title_key) <= 140)));
alter table only public.courses add constraint courses_drip_interval_days_check CHECK (((drip_interval_days IS NULL) OR ((drip_interval_days >= 1) AND (drip_interval_days <= 365))));
alter table only public.courses add constraint courses_drip_strategy_check CHECK (((drip_strategy IS NULL) OR (drip_strategy = ANY (ARRAY['instant'::text, 'sequential_progress'::text, 'time_drip_lesson'::text, 'time_drip_module'::text, 'time_drip_custom'::text]))));
alter table only public.courses add constraint courses_enrollment_count_check CHECK (((enrollment_count IS NULL) OR ((enrollment_count >= 0) AND (enrollment_count <= 100000000))));
alter table only public.courses add constraint courses_featured_rank_check CHECK (((featured_rank IS NULL) OR ((featured_rank >= 0) AND (featured_rank <= 1000000))));
alter table only public.courses add constraint courses_free_preview_lesson_id_check CHECK (((free_preview_lesson_id IS NULL) OR (char_length(free_preview_lesson_id) <= 160)));
alter table only public.courses add constraint courses_installments_max_check CHECK (((installments_max IS NULL) OR ((installments_max >= 1) AND (installments_max <= 36))));
alter table only public.courses add constraint courses_lesson_count_check CHECK (((lesson_count >= 0) AND (lesson_count <= 300)));
alter table only public.courses add constraint courses_payment_type_check CHECK (((payment_type IS NULL) OR (payment_type = ANY (ARRAY['one_time'::text, 'subscription_monthly'::text, 'subscription_yearly'::text, 'free'::text]))));
alter table only public.courses add constraint courses_platform_fee_bps_check CHECK (((platform_fee_bps IS NULL) OR ((platform_fee_bps >= 0) AND (platform_fee_bps <= 5000))));
alter table only public.courses add constraint courses_price_amount_minor_check CHECK (((price_amount_minor IS NULL) OR ((price_amount_minor >= 0) AND (price_amount_minor <= 100000000))));
alter table only public.courses add constraint courses_rating_average_check CHECK (((rating_average IS NULL) OR ((rating_average >= (0)::numeric) AND (rating_average <= (5)::numeric))));
alter table only public.courses add constraint courses_rating_count_check CHECK (((rating_count IS NULL) OR ((rating_count >= 0) AND (rating_count <= 1000000))));
alter table only public.courses add constraint courses_rating_sum_check CHECK (((rating_sum IS NULL) OR ((rating_sum >= 0) AND (rating_sum <= 5000000))));
alter table only public.courses add constraint courses_review_count_check CHECK (((review_count IS NULL) OR ((review_count >= 0) AND (review_count <= 1000000))));
alter table only public.courses add constraint courses_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'in_review'::text, 'needs_changes'::text, 'published'::text, 'inactive'::text])));
alter table only public.courses add constraint courses_trending_score_check CHECK (((trending_score IS NULL) OR ((trending_score >= (0)::numeric) AND (trending_score <= (100000000)::numeric))));
alter table only public.creator_verification_cases add constraint creator_verification_cases_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'needs_changes'::text, 'approved'::text, 'rejected'::text])));
alter table only public.enrollments add constraint enrollments_progress_percent_check CHECK (((progress_percent >= 0) AND (progress_percent <= 100)));
alter table only public.enrollments add constraint enrollments_source_check CHECK ((source = ANY (ARRAY['manual_demo'::text, 'free_course'::text, 'payment'::text, 'admin'::text, 'subscription'::text])));
alter table only public.enrollments add constraint enrollments_status_check CHECK ((status = ANY (ARRAY['active'::text, 'completed'::text, 'refunded'::text, 'revoked'::text, 'expired'::text])));
alter table only public.leaderboards add constraint leaderboards_window_check CHECK (("window" = ANY (ARRAY['7d'::text, '30d'::text, 'all-time'::text])));
alter table only public.lesson_comments add constraint lesson_comments_author_name_len CHECK (((char_length(author_name) >= 1) AND (char_length(author_name) <= 120)));
alter table only public.lesson_comments add constraint lesson_comments_body_len CHECK (((char_length(body) >= 3) AND (char_length(body) <= 2000)));
alter table only public.lesson_comments add constraint lesson_comments_lesson_id_len CHECK (((char_length(lesson_id) >= 3) AND (char_length(lesson_id) <= 160)));
alter table only public.member_stats add constraint member_stats_level_check CHECK (((level >= 1) AND (level <= 9)));
alter table only public.member_stats add constraint member_stats_points_check CHECK ((points >= 0));
alter table only public.member_stats add constraint member_stats_total_likes_received_check CHECK ((total_likes_received >= 0));
alter table only public.orders add constraint orders_amount_minor_check CHECK ((amount_minor >= 0));
alter table only public.orders add constraint orders_discount_minor_check CHECK ((discount_minor >= (0)::numeric));
alter table only public.payments add constraint payments_amount_minor_check CHECK ((amount_minor >= 0));
alter table only public.payout_ledger add constraint payout_ledger_amount_minor_check CHECK ((amount_minor >= 0));
alter table only public.payout_ledger add constraint payout_ledger_check CHECK (((platform_fee_minor >= 0) AND (platform_fee_minor <= amount_minor)));
alter table only public.points_events add constraint points_events_kind_check CHECK ((kind = ANY (ARRAY['like_received'::text, 'like_removed'::text])));
alter table only public.product_prices add constraint product_prices_amount_minor_check CHECK ((amount_minor >= (0)::numeric));
alter table only public.product_prices add constraint product_prices_payment_type_check CHECK ((payment_type = ANY (ARRAY['one_time'::text, 'subscription_monthly'::text, 'subscription_yearly'::text, 'free'::text])));
alter table only public.support_tickets add constraint support_tickets_category_check CHECK ((category = ANY (ARRAY['account'::text, 'course'::text, 'payment'::text, 'technical'::text, 'other'::text])));
alter table only public.support_tickets add constraint support_tickets_message_len_check CHECK (((char_length(message) >= 12) AND (char_length(message) <= 5000)));
alter table only public.support_tickets add constraint support_tickets_status_check CHECK ((status = ANY (ARRAY['open'::text, 'in_review'::text, 'resolved'::text])));
alter table only public.support_tickets add constraint support_tickets_subject_len_check CHECK (((char_length(subject) >= 4) AND (char_length(subject) <= 140)));
alter table only public.users add constraint users_bio_len CHECK (((bio IS NULL) OR (char_length(bio) <= 280)));
alter table only public.users add constraint users_creator_verification_status_check CHECK ((creator_verification_status = ANY (ARRAY['none'::text, 'pending'::text, 'needs_changes'::text, 'approved'::text, 'rejected'::text])));
alter table only public.users add constraint users_credentials_array CHECK (((credentials IS NULL) OR ((jsonb_typeof(credentials) = 'array'::text) AND (jsonb_array_length(credentials) <= 6))));
alter table only public.users add constraint users_display_name_len CHECK (((display_name IS NULL) OR (char_length(display_name) <= 120)));
alter table only public.users add constraint users_goals_array CHECK (((goals IS NULL) OR ((jsonb_typeof(goals) = 'array'::text) AND (jsonb_array_length(goals) <= 8))));
alter table only public.users add constraint users_onboarding_path_valid CHECK (((onboarding_path IS NULL) OR (onboarding_path = ANY (ARRAY['student'::text, 'teacher'::text, 'both'::text]))));
alter table only public.users add constraint users_phone_format CHECK (((phone_number IS NULL) OR (phone_number ~ '^\+[1-9][0-9]{6,14}$'::text)));
alter table only public.users add constraint users_photo_url_len CHECK (((photo_url IS NULL) OR (char_length(photo_url) <= 1200)));
alter table only public.users add constraint users_privacy_version_len CHECK (((privacy_version IS NULL) OR ((char_length(privacy_version) >= 1) AND (char_length(privacy_version) <= 40))));
alter table only public.users add constraint users_roles_array CHECK ((jsonb_typeof(roles) = 'array'::text));
alter table only public.users add constraint users_stripe_connect_status_valid CHECK (((stripe_connect_status IS NULL) OR (stripe_connect_status = ANY (ARRAY['created'::text, 'onboarding_required'::text, 'ready'::text, 'disconnected'::text]))));
alter table only public.users add constraint users_teacher_signature_url_len CHECK (((teacher_signature_url IS NULL) OR (char_length(teacher_signature_url) <= 1200)));
alter table only public.users add constraint users_teacher_terms_version_len CHECK (((teacher_terms_version IS NULL) OR ((char_length(teacher_terms_version) >= 1) AND (char_length(teacher_terms_version) <= 40))));
alter table only public.users add constraint users_terms_version_len CHECK (((terms_version IS NULL) OR ((char_length(terms_version) >= 1) AND (char_length(terms_version) <= 40))));
alter table only public.users add constraint users_timezone_len CHECK (((timezone IS NULL) OR ((char_length(timezone) >= 3) AND (char_length(timezone) <= 80))));
alter table only public.users add constraint users_username_format CHECK (((username IS NULL) OR (username ~ '^[a-z0-9][a-z0-9-]{2,31}$'::text)));
alter table only public.wishlists add constraint wishlists_course_id_len CHECK (((char_length(course_id) >= 3) AND (char_length(course_id) <= 160)));
alter table only public.wishlists add constraint wishlists_course_slug_len CHECK (((char_length(course_slug) >= 3) AND (char_length(course_slug) <= 160)));
alter table only public.wishlists add constraint wishlists_id_shape CHECK ((id = ((user_id || '__'::text) || course_id)));

-- =============================================================
-- 4) FOREIGN KEY (34)
-- =============================================================

alter table only public.certificates add constraint certificates_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(id);
alter table only public.certificates add constraint certificates_enrollment_id_fkey FOREIGN KEY (enrollment_id) REFERENCES public.enrollments(id);
alter table only public.certificates add constraint certificates_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(uid);
alter table only public.community_comments add constraint community_comments_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.community_comments(id) ON DELETE CASCADE;
alter table only public.community_comments add constraint community_comments_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.community_posts(id) ON DELETE CASCADE;
alter table only public.community_post_likes add constraint community_post_likes_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.community_posts(id) ON DELETE CASCADE;
alter table only public.course_assets add constraint course_assets_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE CASCADE;
alter table only public.course_commerce_settings add constraint course_commerce_settings_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE CASCADE;
alter table only public.course_commerce_settings add constraint course_commerce_settings_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(uid) ON DELETE CASCADE;
alter table only public.course_coproducers add constraint course_coproducers_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE CASCADE;
alter table only public.course_coproducers add constraint course_coproducers_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(uid) ON DELETE CASCADE;
alter table only public.course_coupon_reservations add constraint course_coupon_reservations_coupon_id_fkey FOREIGN KEY (coupon_id) REFERENCES public.course_coupons(id) ON DELETE CASCADE;
alter table only public.course_coupons add constraint course_coupons_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE CASCADE;
alter table only public.course_coupons add constraint course_coupons_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(uid) ON DELETE CASCADE;
alter table only public.course_event_rsvps add constraint course_event_rsvps_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.course_events(id) ON DELETE CASCADE;
alter table only public.course_lesson_content add constraint course_lesson_content_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE CASCADE;
alter table only public.course_reviews add constraint course_reviews_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE CASCADE;
alter table only public.course_subscriptions add constraint course_subscriptions_course_slug_fkey FOREIGN KEY (course_slug) REFERENCES public.courses(slug);
alter table only public.course_subscriptions add constraint course_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(uid);
alter table only public.creator_verification_cases add constraint creator_verification_cases_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.users(uid) ON DELETE CASCADE;
alter table only public.enrollments add constraint enrollments_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(id);
alter table only public.learning_path_items add constraint learning_path_items_path_id_fkey FOREIGN KEY (path_id) REFERENCES public.learning_paths(id) ON DELETE CASCADE;
alter table only public.lesson_comments add constraint lesson_comments_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE CASCADE;
alter table only public.lesson_progress add constraint lesson_progress_enrollment_id_fkey FOREIGN KEY (enrollment_id) REFERENCES public.enrollments(id) ON DELETE CASCADE;
alter table only public.member_stats add constraint member_stats_uid_fkey FOREIGN KEY (uid) REFERENCES public.users(uid) ON DELETE CASCADE;
alter table only public.notifications add constraint notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(uid) ON DELETE CASCADE;
alter table only public.orders add constraint orders_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(id);
alter table only public.orders add constraint orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(uid);
alter table only public.payments add constraint payments_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);
alter table only public.payments add constraint payments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(uid);
alter table only public.payout_ledger add constraint payout_ledger_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.payments(id);
alter table only public.payout_ledger add constraint payout_ledger_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.users(uid);
alter table only public.product_prices add constraint product_prices_offer_id_fkey FOREIGN KEY (offer_id) REFERENCES public.product_offers(id) ON DELETE CASCADE;
alter table only public.subscriptions add constraint subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(uid);


-- ############################################################################
-- ## BLOCO 4 : FUNCTIONS (59) -- antes de triggers/indices/policies
-- ## fonte: parts/05_functions.sql
-- ############################################################################

-- Fatia: functions
-- Origem: catalogo do projeto ijtikldtjvsbtwszokvs, extraido em 2026-07-21
-- Gerado por introspeccao (sem senha do banco / sem pg_dump)
--
-- Total de rotinas em public: 59 (todas prokind='f'; 0 procedures, 0 agregadas, 0 window)
-- SECURITY DEFINER: 55
-- SECURITY INVOKER: 4  (course_title_key, is_service_role,
--                       platform_fee_bps_for_plan, prevent_course_lesson_content_course_move)
-- Com search_path fixado (SET search_path): 59 de 59
--   * 'public', 'pg_temp'                : 52
--   * 'public'                           :  5 (finalize_course_coupon_reservation,
--                                             recompute_course_trending_scores,
--                                             release_course_coupon_reservation,
--                                             reserve_course_coupon,
--                                             set_default_product_offer)
--   * 'public', 'extensions', 'pg_temp'  :  1 (course_title_key)
--   * '' (vazio / totalmente isolado)    :  1 (platform_fee_bps_for_plan)
-- Volatilidade: 49 VOLATILE, 9 STABLE, 1 IMMUTABLE (platform_fee_bps_for_plan)
-- Linguagem: plpgsql / sql conforme cada definicao abaixo
--
-- Nota: quebras de linha normalizadas para LF (o catalogo tem alguns corpos com CRLF).
--       Nenhuma outra alteracao no texto retornado por pg_get_functiondef().

CREATE OR REPLACE FUNCTION public.assert_course_owner(p_course_id text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid text := (select auth.uid())::text;
  v_owner text;
begin
  if v_uid is null then
    raise exception 'Sign in to manage this course.';
  end if;
  select c.owner_id into v_owner from public.courses c where c.id = p_course_id;
  if v_owner is null then
    raise exception 'Course not found.';
  end if;
  if v_owner <> v_uid then
    raise exception 'Only the course owner can manage its commerce settings.';
  end if;
  return v_uid;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.claim_checkout_lock(p_user_id text, p_course_id text, p_order_id text, p_now text, p_session_ttl_ms integer, p_claim_grace_ms integer)
 RETURNS TABLE(action text, checkout_url text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_key text;
  v_ttl interval;
  v_grace interval;
  v_lock public.checkout_locks%ROWTYPE;
  v_inserted integer;
BEGIN
  IF btrim(coalesce(p_user_id, '')) = ''
     OR char_length(p_user_id) > 220
     OR btrim(coalesce(p_course_id, '')) = ''
     OR char_length(p_course_id) > 220
     OR btrim(coalesce(p_order_id, '')) = ''
     OR char_length(p_order_id) > 220 THEN
    RAISE EXCEPTION 'INVALID_CHECKOUT_LOCK_IDENTITY';
  END IF;

  v_key := p_user_id || '__' || p_course_id;
  v_ttl := make_interval(
    secs => least(greatest(coalesce(p_session_ttl_ms, 0), 1000), 86400000) / 1000.0
  );
  v_grace := make_interval(
    secs => least(greatest(coalesce(p_claim_grace_ms, 0), 0), 86400000) / 1000.0
  );

  DELETE FROM public.checkout_locks
  WHERE expires_at < v_now;

  INSERT INTO public.checkout_locks (
    lock_key,
    user_id,
    course_id,
    order_id,
    checkout_url,
    checkout_session_id,
    claimed_at,
    expires_at,
    updated_at
  ) VALUES (
    v_key,
    p_user_id,
    p_course_id,
    p_order_id,
    NULL,
    NULL,
    v_now,
    v_now + v_ttl,
    v_now
  )
  ON CONFLICT (lock_key) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted = 1 THEN
    action := 'claim';
    checkout_url := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT * INTO v_lock
  FROM public.checkout_locks
  WHERE lock_key = v_key
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CHECKOUT_LOCK_NOT_FOUND';
  END IF;

  IF v_lock.checkout_url IS NOT NULL AND v_lock.expires_at > v_now THEN
    action := 'reuse';
    checkout_url := v_lock.checkout_url;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_lock.claimed_at + v_grace > v_now AND v_lock.checkout_url IS NULL THEN
    action := 'wait';
    checkout_url := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  UPDATE public.checkout_locks
  SET order_id = p_order_id,
      checkout_url = NULL,
      checkout_session_id = NULL,
      claimed_at = v_now,
      expires_at = v_now + v_ttl,
      updated_at = v_now
  WHERE lock_key = v_key;

  action := 'claim';
  checkout_url := NULL;
  RETURN NEXT;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.claim_payout_transfer_reversal(p_ledger_id text, p_claim_key text, p_target_amount_minor numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ledger public.payout_ledger%ROWTYPE;
  v_claims jsonb;
  v_existing jsonb;
  v_current numeric;
  v_target numeric;
  v_planned numeric;
  v_state text;
  v_claim jsonb;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF btrim(coalesce(p_ledger_id, '')) = ''
     OR char_length(p_ledger_id) > 220 THEN
    RAISE EXCEPTION 'INVALID_PAYOUT_LEDGER_ID';
  END IF;
  IF btrim(coalesce(p_claim_key, '')) = ''
     OR char_length(p_claim_key) > 240 THEN
    RAISE EXCEPTION 'INVALID_PAYOUT_REVERSAL_CLAIM_KEY';
  END IF;
  IF p_target_amount_minor IS NULL
     OR p_target_amount_minor < 0
     OR trunc(p_target_amount_minor) <> p_target_amount_minor THEN
    RAISE EXCEPTION 'INVALID_PAYOUT_REVERSAL_TARGET';
  END IF;

  SELECT * INTO v_ledger
  FROM public.payout_ledger
  WHERE id = p_ledger_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYOUT_LEDGER_NOT_FOUND';
  END IF;
  IF v_ledger.transfer_amount_minor IS NULL
     OR v_ledger.transfer_amount_minor < 0 THEN
    RAISE EXCEPTION 'PAYOUT_TRANSFER_NOT_RELEASED';
  END IF;

  v_claims := CASE
    WHEN jsonb_typeof(v_ledger.refund_reversal_claims) = 'object'
      THEN v_ledger.refund_reversal_claims
    ELSE '{}'::jsonb
  END;
  v_existing := v_claims -> p_claim_key;

  IF v_existing IS NOT NULL THEN
    IF jsonb_typeof(v_existing) <> 'object'
       OR jsonb_typeof(v_existing->'plannedAmountMinor') <> 'number' THEN
      RAISE EXCEPTION 'CORRUPT_PAYOUT_REVERSAL_CLAIM';
    END IF;

    RETURN v_existing || jsonb_build_object(
      'claimKey', p_claim_key,
      'action', CASE
        WHEN coalesce(v_existing->>'state', '') = 'pending'
             AND (v_existing->>'plannedAmountMinor')::numeric > 0
          THEN 'execute'
        ELSE 'skip'
      END,
      'planned_amount_minor',
        (v_existing->>'plannedAmountMinor')::numeric,
      'redelivery', true,
      'shouldExecute',
        coalesce(v_existing->>'state', '') = 'pending'
        AND (v_existing->>'plannedAmountMinor')::numeric > 0
    );
  END IF;

  v_current := greatest(
    coalesce(v_ledger.transfer_reversed_amount_minor, 0),
    0
  );
  v_target := least(p_target_amount_minor, v_ledger.transfer_amount_minor);
  v_planned := greatest(v_target - v_current, 0);
  v_state := CASE WHEN v_planned > 0 THEN 'pending' ELSE 'done' END;
  v_claim := jsonb_build_object(
    'claimKey', p_claim_key,
    'state', v_state,
    'plannedAmountMinor', v_planned,
    'targetAmountMinor', v_target,
    'claimedAt', v_now
  );

  UPDATE public.payout_ledger
  SET transfer_reversed_amount_minor = v_current + v_planned,
      refund_reversal_claims = jsonb_set(
        v_claims,
        ARRAY[p_claim_key],
        v_claim,
        true
      ),
      updated_at = v_now
  WHERE id = p_ledger_id;

  RETURN v_claim || jsonb_build_object(
    'action', CASE WHEN v_planned > 0 THEN 'execute' ELSE 'skip' END,
    'planned_amount_minor', v_planned,
    'redelivery', false,
    'shouldExecute', v_planned > 0
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.community_comments_update_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF public.is_service_role() OR public.is_admin() THEN
    RETURN NEW;
  END IF;
  IF NEW.author_id   IS DISTINCT FROM OLD.author_id
     OR NEW.course_slug IS DISTINCT FROM OLD.course_slug
     OR NEW.post_id     IS DISTINCT FROM OLD.post_id
     OR NEW.author_name IS DISTINCT FROM OLD.author_name
     OR NEW.author_role IS DISTINCT FROM OLD.author_role
     OR NEW.parent_id   IS DISTINCT FROM OLD.parent_id
     OR NEW.created_at  IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'community_comments: only body may be edited';
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.community_posts_update_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_is_course_teacher boolean;
BEGIN
  IF public.is_service_role() OR public.is_admin() THEN
    RETURN NEW;
  END IF;

  SELECT public.is_teacher() AND EXISTS (
    SELECT 1 FROM public.courses c
    WHERE c.slug = OLD.course_slug
      AND c.owner_id = (SELECT auth.uid())::text
  ) INTO v_is_course_teacher;

  IF v_is_course_teacher THEN
    -- teacher-pin path: only pinned + updated_at mutable.
    IF NEW.course_slug IS DISTINCT FROM OLD.course_slug
       OR NEW.author_id   IS DISTINCT FROM OLD.author_id
       OR NEW.author_name IS DISTINCT FROM OLD.author_name
       OR NEW.author_role IS DISTINCT FROM OLD.author_role
       OR NEW.category    IS DISTINCT FROM OLD.category
       OR NEW.body        IS DISTINCT FROM OLD.body
       OR NEW.created_at  IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'community_posts: course-owning teacher may only change pinned/updated_at';
    END IF;
    RETURN NEW;
  END IF;

  -- author path: only body + updated_at; pinned frozen (no self-pin).
  IF NEW.course_slug IS DISTINCT FROM OLD.course_slug
     OR NEW.author_id   IS DISTINCT FROM OLD.author_id
     OR NEW.author_name IS DISTINCT FROM OLD.author_name
     OR NEW.created_at  IS DISTINCT FROM OLD.created_at
     OR coalesce(NEW.pinned, false) IS DISTINCT FROM coalesce(OLD.pinned, false) THEN
    RAISE EXCEPTION 'community_posts: author may only edit body/updated_at and may not self-pin';
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.community_reports_update_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF public.is_service_role() THEN
    RETURN NEW;
  END IF;
  IF NEW.id                IS DISTINCT FROM OLD.id
     OR NEW.course_slug      IS DISTINCT FROM OLD.course_slug
     OR NEW.post_id          IS DISTINCT FROM OLD.post_id
     OR NEW.comment_id       IS DISTINCT FROM OLD.comment_id
     OR NEW.target_type      IS DISTINCT FROM OLD.target_type
     OR NEW.target_author_id IS DISTINCT FROM OLD.target_author_id
     OR NEW.target_author_name IS DISTINCT FROM OLD.target_author_name
     OR NEW.reporter_id      IS DISTINCT FROM OLD.reporter_id
     OR NEW.reporter_name    IS DISTINCT FROM OLD.reporter_name
     OR NEW.reporter_email   IS DISTINCT FROM OLD.reporter_email
     OR NEW.reason           IS DISTINCT FROM OLD.reason
     OR NEW.detail           IS DISTINCT FROM OLD.detail
     OR NEW.created_at       IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'community_reports: only status and updated_at may change';
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.complete_payout_transfer_reversal(p_ledger_id text, p_claim_key text, p_reversal_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ledger public.payout_ledger%ROWTYPE;
  v_claims jsonb;
  v_claim jsonb;
  v_planned numeric;
  v_reversal_id text := nullif(btrim(coalesce(p_reversal_id, '')), '');
  v_now timestamptz := clock_timestamp();
BEGIN
  IF btrim(coalesce(p_ledger_id, '')) = ''
     OR btrim(coalesce(p_claim_key, '')) = '' THEN
    RAISE EXCEPTION 'INVALID_PAYOUT_REVERSAL_COMPLETION';
  END IF;

  SELECT * INTO v_ledger
  FROM public.payout_ledger
  WHERE id = p_ledger_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYOUT_LEDGER_NOT_FOUND';
  END IF;

  v_claims := CASE
    WHEN jsonb_typeof(v_ledger.refund_reversal_claims) = 'object'
      THEN v_ledger.refund_reversal_claims
    ELSE '{}'::jsonb
  END;
  v_claim := v_claims -> p_claim_key;

  IF v_claim IS NULL
     OR jsonb_typeof(v_claim) <> 'object'
     OR jsonb_typeof(v_claim->'plannedAmountMinor') <> 'number' THEN
    RAISE EXCEPTION 'PAYOUT_REVERSAL_CLAIM_NOT_FOUND';
  END IF;

  v_planned := (v_claim->>'plannedAmountMinor')::numeric;
  IF v_claim->>'state' = 'done' THEN
    IF nullif(v_claim->>'reversalId', '') IS NOT NULL
       AND v_reversal_id IS DISTINCT FROM nullif(v_claim->>'reversalId', '') THEN
      RAISE EXCEPTION 'PAYOUT_REVERSAL_COMPLETION_CONFLICT';
    END IF;
    RETURN v_claim || jsonb_build_object(
      'claimKey', p_claim_key,
      'redelivery', true,
      'shouldExecute', false
    );
  END IF;

  IF v_planned > 0 AND v_reversal_id IS NULL THEN
    RAISE EXCEPTION 'PAYOUT_REVERSAL_ID_REQUIRED';
  END IF;

  v_claim := v_claim || jsonb_build_object(
    'state', 'done',
    'reversalId', v_reversal_id,
    'completedAt', v_now
  );

  UPDATE public.payout_ledger
  SET refund_reversal_claims = jsonb_set(
        v_claims,
        ARRAY[p_claim_key],
        v_claim,
        true
      ),
      latest_transfer_reversal_id = coalesce(
        v_reversal_id,
        latest_transfer_reversal_id
      ),
      latest_transfer_reversal_at = CASE
        WHEN v_reversal_id IS NOT NULL THEN v_now
        ELSE latest_transfer_reversal_at
      END,
      updated_at = v_now
  WHERE id = p_ledger_id;

  RETURN v_claim || jsonb_build_object(
    'claimKey', p_claim_key,
    'redelivery', false,
    'shouldExecute', false
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.course_event_rsvps_update_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF public.is_service_role() OR public.is_admin() THEN
    RETURN NEW;
  END IF;
  IF NEW.event_id    IS DISTINCT FROM OLD.event_id
     OR NEW.course_slug IS DISTINCT FROM OLD.course_slug
     OR NEW.user_id   IS DISTINCT FROM OLD.user_id
     OR NEW.uid       IS DISTINCT FROM OLD.uid
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'course_event_rsvps: only attendee_name, attendee_email, status, updated_at may change';
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.course_events_teacher_update_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF public.is_service_role() OR public.is_admin() THEN
    RETURN NEW;
  END IF;
  IF NEW.owner_id     IS DISTINCT FROM OLD.owner_id
     OR NEW.course_id   IS DISTINCT FROM OLD.course_id
     OR NEW.course_slug IS DISTINCT FROM OLD.course_slug
     OR NEW.course_title IS DISTINCT FROM OLD.course_title
     OR NEW.created_at  IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'course_events: teacher may only modify title, description, type, status, starts_at, external_url, recording_asset_id';
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.course_title_key(p_title text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  select left(
    regexp_replace(
      regexp_replace(
        lower(extensions.unaccent(btrim(coalesce(p_title, '')))),
        '[^a-z0-9]+', '-', 'g'
      ),
      '(^-+|-+$)', '', 'g'
    ),
    140
  );
$function$
;

CREATE OR REPLACE FUNCTION public.courses_freeze_privileged_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF public.is_service_role() OR public.is_admin() OR public.is_ops()
     OR current_setting('skillset.trusted_write', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF NEW.status           IS DISTINCT FROM OLD.status
     OR NEW.featured      IS DISTINCT FROM OLD.featured
     OR NEW.featured_rank IS DISTINCT FROM OLD.featured_rank
     OR NEW.rating_average    IS DISTINCT FROM OLD.rating_average
     OR NEW.rating_count      IS DISTINCT FROM OLD.rating_count
     OR NEW.trending_score    IS DISTINCT FROM OLD.trending_score
     OR NEW.enrollment_count  IS DISTINCT FROM OLD.enrollment_count
     OR NEW.platform_fee_bps  IS DISTINCT FROM OLD.platform_fee_bps THEN
    RAISE EXCEPTION 'courses: status/featured/featured_rank/rating/trending/enrollment/platform_fee_bps are privileged (admin/ops/service only)';
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.create_course_coupon(p_course_id text, p_code text, p_percent_off integer, p_max_redemptions integer, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid text := public.assert_course_owner(p_course_id);
  v_code text := upper(btrim(coalesce(p_code,'')));
  v_count integer;
begin
  -- Serialize coupon writes per course (cap + duplicate checks below).
  perform 1 from public.courses where id = p_course_id for update;

  if v_code !~ '^[A-Z0-9][A-Z0-9-]{2,23}$' then
    raise exception 'Coupon codes use 3-24 letters, numbers, or dashes.';
  end if;
  if p_percent_off is null or p_percent_off < 5 or p_percent_off > 90 then
    raise exception 'Discount must be between 5%% and 90%%.';
  end if;
  if p_max_redemptions is null or p_max_redemptions < 1 or p_max_redemptions > 100000 then
    raise exception 'Redemption limit must be between 1 and 100000.';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'The expiry date must be in the future.';
  end if;
  select count(*) into v_count from public.course_coupons where course_id = p_course_id;
  if v_count >= 50 then
    raise exception 'This course already has 50 coupons — remove one first.';
  end if;
  if exists (
    select 1 from public.course_coupons
    where course_id = p_course_id and code = v_code
  ) then
    raise exception 'That coupon code already exists for this course.';
  end if;

  insert into public.course_coupons
    (course_id, owner_id, code, percent_off, max_redemptions, expires_at)
  values
    (p_course_id, v_uid, v_code, p_percent_off, p_max_redemptions, p_expires_at);

  return jsonb_build_object('success', true, 'code', v_code);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_free_course_enrollment(p_course_id text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid text := (select auth.uid())::text;
  v_course public.courses%rowtype;
  v_enrollment_id text;
  v_existing_status text;
begin
  if v_uid is null then
    raise exception 'unauthenticated: sign in before enrolling';
  end if;

  if p_course_id is null or length(btrim(p_course_id)) = 0 or length(p_course_id) > 160 then
    raise exception 'invalid-argument: a valid courseId is required';
  end if;

  perform public.enforce_rate_limit('free_enroll_' || v_uid, 20, 3600000);

  v_enrollment_id := v_uid || '__' || p_course_id;

  select * into v_course from public.courses where id = p_course_id;
  if not found then
    raise exception 'not-found: course not found';
  end if;

  if v_course.status <> 'published' then
    raise exception 'failed-precondition: this course is not available for enrollment right now';
  end if;

  if not (v_course.payment_type = 'free' or coalesce(v_course.price_amount_minor, 0) = 0) then
    raise exception 'failed-precondition: this course requires checkout before enrollment';
  end if;

  select status into v_existing_status
  from public.enrollments
  where id = v_enrollment_id;
  if v_existing_status in ('active', 'completed') then
    return v_enrollment_id;
  end if;

  insert into public.enrollments (
    id, user_id, course_id, course_slug, course_title, course_category, course_image,
    status, source, progress_percent, last_lesson_id, created_at, updated_at
  ) values (
    v_enrollment_id, v_uid, p_course_id, p_course_id, v_course.title, v_course.category,
    coalesce(v_course.cover_image_url, '/brand/logo-mark.png'),
    'active', 'free_course', 0, null, now(), now()
  )
  on conflict (id) do update set
    status = 'active',
    updated_at = now()
  where public.enrollments.status not in ('active', 'completed');

  return v_enrollment_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_product_offer_atomic(p_course_id text, p_owner_id text, p_offer_id text, p_price_id text, p_name text, p_amount_minor numeric, p_currency text, p_payment_type text, p_is_default boolean, p_public_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_course_owner text;
  v_name text := btrim(coalesce(p_name, ''));
  v_currency text := upper(btrim(coalesce(p_currency, '')));
  v_payment_type text := btrim(coalesce(p_payment_type, ''));
  v_is_default boolean := coalesce(p_is_default, false);
  v_public_code text := nullif(upper(btrim(coalesce(p_public_code, ''))), '');
BEGIN
  IF btrim(coalesce(p_course_id, '')) = ''
     OR btrim(coalesce(p_owner_id, '')) = ''
     OR btrim(coalesce(p_offer_id, '')) = ''
     OR btrim(coalesce(p_price_id, '')) = '' THEN
    RAISE EXCEPTION 'INVALID_PRODUCT_OFFER_IDENTITY';
  END IF;
  IF v_name = '' OR char_length(v_name) > 80 THEN
    RAISE EXCEPTION 'INVALID_PRODUCT_OFFER_NAME';
  END IF;
  IF p_amount_minor IS NULL
     OR p_amount_minor < 0
     OR trunc(p_amount_minor) <> p_amount_minor THEN
    RAISE EXCEPTION 'INVALID_PRODUCT_OFFER_AMOUNT';
  END IF;
  IF v_currency !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'INVALID_PRODUCT_OFFER_CURRENCY';
  END IF;
  IF v_payment_type NOT IN (
    'one_time',
    'subscription_monthly',
    'subscription_yearly',
    'free'
  ) THEN
    RAISE EXCEPTION 'INVALID_PRODUCT_OFFER_PAYMENT_TYPE';
  END IF;
  IF (v_payment_type = 'free' AND p_amount_minor <> 0)
     OR (v_payment_type <> 'free' AND p_amount_minor <= 0) THEN
    RAISE EXCEPTION 'INVALID_PRODUCT_OFFER_PRICE';
  END IF;
  IF v_payment_type = 'free' AND NOT v_is_default THEN
    RAISE EXCEPTION 'FREE_PRODUCT_OFFER_MUST_BE_DEFAULT';
  END IF;
  IF v_public_code IS NOT NULL
     AND (
       char_length(v_public_code) > 24
       OR v_public_code !~ '^[A-Z0-9-]+$'
     ) THEN
    RAISE EXCEPTION 'INVALID_PRODUCT_OFFER_PUBLIC_CODE';
  END IF;

  SELECT owner_id INTO v_course_owner
  FROM public.courses
  WHERE id = p_course_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COURSE_NOT_FOUND';
  END IF;
  IF v_course_owner IS DISTINCT FROM p_owner_id THEN
    RAISE EXCEPTION 'PRODUCT_OFFER_OWNER_MISMATCH';
  END IF;

  INSERT INTO public.product_offers (
    id,
    course_id,
    name,
    is_default,
    active,
    public_code,
    created_at,
    updated_at
  ) VALUES (
    p_offer_id,
    p_course_id,
    v_name,
    false,
    true,
    v_public_code,
    now(),
    now()
  );

  INSERT INTO public.product_prices (
    id,
    offer_id,
    amount_minor,
    currency,
    payment_type,
    stripe_price_id,
    active,
    created_at,
    updated_at
  ) VALUES (
    p_price_id,
    p_offer_id,
    p_amount_minor,
    v_currency,
    v_payment_type,
    NULL,
    true,
    now(),
    now()
  );

  IF v_is_default THEN
    PERFORM public.set_default_product_offer(p_course_id, p_offer_id);
  END IF;

  RETURN jsonb_build_object(
    'offerId', p_offer_id,
    'priceId', p_price_id,
    'name', v_name,
    'amountMinor', p_amount_minor,
    'currency', v_currency,
    'paymentType', v_payment_type,
    'isDefault', v_is_default,
    'publicCode', v_public_code
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.create_teacher_course_draft(p_title text, p_summary text, p_category text, p_categories text[], p_payment_type text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid text := (select auth.uid())::text;
  v_title text := btrim(coalesce(p_title, ''));
  v_summary text := btrim(coalesce(p_summary, ''));
  v_title_key text;
  v_category text;
  v_payment_type text;
  v_price integer;
  v_fee integer;
  v_course_id text := gen_random_uuid()::text;
  v_roles jsonb;
  v_accepted timestamptz;
  v_plan text;
begin
  if v_uid is null then
    raise exception 'Sign in before creating a course.';
  end if;

  select u.roles, u.teacher_terms_accepted_at, u.current_plan_id
    into v_roles, v_accepted, v_plan
  from public.users u
  where u.uid = v_uid;

  if v_roles is null or not (v_roles ? 'teacher') or v_accepted is null then
    raise exception 'Teacher setup must be complete before creating courses.';
  end if;

  perform public.enforce_rate_limit('course_draft_create_' || v_uid, 20, 3600000);

  if char_length(v_title) < 3 or char_length(v_title) > 120 then
    raise exception 'Course title must be between 3 and 120 characters.';
  end if;
  if char_length(v_summary) < 20 or char_length(v_summary) > 1200 then
    raise exception 'Course summary must be between 20 and 1200 characters.';
  end if;

  v_title_key := public.course_title_key(v_title);
  if char_length(v_title_key) < 3 then
    raise exception 'Course title is not specific enough.';
  end if;

  v_category := coalesce(
    nullif(btrim(coalesce(p_categories[1], '')), ''),
    nullif(left(btrim(coalesce(p_category, '')), 80), '')
  );
  if v_category is null then
    raise exception 'Choose at least one marketplace category.';
  end if;

  v_payment_type := nullif(btrim(coalesce(p_payment_type, '')), '');
  if v_payment_type is null or v_payment_type not in (
    'free',
    'one_time',
    'subscription_monthly',
    'subscription_yearly'
  ) then
    raise exception 'Choose a valid payment type before creating a course.';
  end if;
  v_price := case when v_payment_type = 'free' then 0 else null end;
  v_fee := public.platform_fee_bps_for_plan(v_plan);

  if exists (select 1 from public.courses c where c.title_key = v_title_key) then
    raise exception 'A course with this title already exists. Choose a more specific name.';
  end if;

  insert into public.courses (
    id, owner_id, title, title_key, summary, category, categories,
    learning_outcomes, status, modules, lesson_count,
    price_amount_minor, currency, payment_type,
    installments_enabled, installments_max, platform_fee_bps,
    drip_strategy, drip_interval_days, free_preview_lesson_id
  ) values (
    v_course_id, v_uid, v_title, v_title_key, v_summary, v_category,
    coalesce(p_categories, '{}'),
    '{}', 'draft', '[]'::jsonb, 0,
    v_price, 'USD', v_payment_type,
    false, null, v_fee,
    'instant', 1, null
  );

  insert into public.course_title_keys (title_key)
  values (v_title_key)
  on conflict (title_key) do nothing;

  return v_course_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_teacher_course_draft(p_title text, p_summary text, p_category text, p_categories text[], p_payment_type text, p_community_enabled boolean)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.delete_course_as_admin(p_course_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid text := (select auth.uid())::text;
  v_owner text;
  v_title text;
  v_key text;
begin
  if v_uid is null or not public.is_admin() then
    raise exception 'Only an administrator can delete this course.';
  end if;

  select owner_id, title, title_key into v_owner, v_title, v_key
  from public.courses where id = p_course_id;
  if v_owner is null then
    raise exception 'Course not found.';
  end if;

  if exists (select 1 from public.enrollments where course_id = p_course_id) then
    raise exception 'Cannot delete a course that has enrollments.';
  end if;
  if exists (select 1 from public.orders where course_id = p_course_id) then
    raise exception 'Cannot delete a course that has orders.';
  end if;

  delete from public.course_lesson_content where course_id = p_course_id;
  if v_key is not null then
    delete from public.course_title_keys where title_key = v_key;
  end if;
  delete from public.courses where id = p_course_id;

  begin
    perform public.log_audit_event(
      p_action => 'COURSE_DELETED_BY_ADMIN',
      p_actor_email => coalesce(
        (select email from public.users where uid = v_uid),
        v_uid
      ),
      p_actor_id => v_uid,
      p_metadata => jsonb_build_object('title', v_title, 'ownerId', v_owner),
      p_summary => 'Admin deleted course ' || p_course_id,
      p_target_id => p_course_id,
      p_target_type => 'course'
    );
  exception when others then
    null;
  end;

  return jsonb_build_object('success', true);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.delete_course_coupon(p_coupon_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_coupon public.course_coupons%ROWTYPE;
BEGIN
  SELECT * INTO v_coupon
  FROM public.course_coupons
  WHERE id = p_coupon_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Coupon not found.';
  END IF;

  PERFORM public.assert_course_owner(v_coupon.course_id);

  IF v_coupon.redeemed_count > 0 OR EXISTS (
    SELECT 1
    FROM public.course_coupon_reservations
    WHERE coupon_id = p_coupon_id
  ) THEN
    UPDATE public.course_coupons
    SET active = false,
        updated_at = now()
    WHERE id = p_coupon_id;
    RETURN jsonb_build_object('success', true, 'archived', true);
  END IF;

  DELETE FROM public.course_coupons WHERE id = p_coupon_id;
  RETURN jsonb_build_object('success', true, 'archived', false);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.delete_teacher_course_draft(p_course_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid text := (select auth.uid())::text;
  v_owner text;
  v_status text;
  v_key text;
begin
  if v_uid is null then
    raise exception 'Sign in before deleting a course.';
  end if;

  select owner_id, status, title_key into v_owner, v_status, v_key
  from public.courses where id = p_course_id;
  if v_owner is null then
    raise exception 'Course not found.';
  end if;
  if v_owner <> v_uid then
    raise exception 'Only the course owner can delete it.';
  end if;
  if v_status not in ('draft', 'needs_changes') then
    raise exception 'Only a draft or needs-changes course can be deleted.';
  end if;

  delete from public.course_lesson_content where course_id = p_course_id;
  if v_key is not null then
    delete from public.course_title_keys where title_key = v_key;
  end if;
  delete from public.courses where id = p_course_id;

  return jsonb_build_object('success', true);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_rate_limit(p_key text, p_limit integer, p_window_ms integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_now timestamptz := now();
  v_window_started timestamptz;
  v_count integer;
  v_in_window boolean;
begin
  select window_started_at, count
    into v_window_started, v_count
  from public.rate_limits
  where key = p_key
  for update;

  v_in_window := v_window_started is not null
    and (extract(epoch from (v_now - v_window_started)) * 1000) < p_window_ms;

  if v_in_window and v_count >= p_limit then
    raise exception 'RATE_LIMIT: too many attempts, please wait before trying again'
      using errcode = 'P0001';
  end if;

  insert into public.rate_limits (key, count, window_started_at, updated_at)
  values (p_key, 1, v_now, v_now)
  on conflict (key) do update
  set count = case
        when v_in_window then public.rate_limits.count + 1
        else 1
      end,
      window_started_at = case
        when v_in_window then public.rate_limits.window_started_at
        else v_now
      end,
      updated_at = v_now;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.enrollments_owner_update_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF public.is_service_role() OR public.is_admin()
     OR current_setting('skillset.trusted_write', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF NEW.id              IS DISTINCT FROM OLD.id
     OR NEW.user_id      IS DISTINCT FROM OLD.user_id
     OR NEW.course_id    IS DISTINCT FROM OLD.course_id
     OR NEW.course_slug  IS DISTINCT FROM OLD.course_slug
     OR NEW.course_title IS DISTINCT FROM OLD.course_title
     OR NEW.course_category IS DISTINCT FROM OLD.course_category
     OR NEW.course_image IS DISTINCT FROM OLD.course_image
     OR NEW.status       IS DISTINCT FROM OLD.status
     OR NEW.source       IS DISTINCT FROM OLD.source
     OR NEW.subscription_id  IS DISTINCT FROM OLD.subscription_id
     OR NEW.progress_percent IS DISTINCT FROM OLD.progress_percent
     OR NEW.created_at   IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'enrollments: owners may only update last_lesson_id and updated_at';
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.finalize_course_coupon_reservation(p_order_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_reservation public.course_coupon_reservations%ROWTYPE;
BEGIN
  SELECT * INTO v_reservation
  FROM public.course_coupon_reservations
  WHERE order_id = p_order_id
  FOR UPDATE;

  IF NOT FOUND OR v_reservation.status = 'redeemed' THEN
    RETURN;
  END IF;
  IF v_reservation.status <> 'reserved' THEN
    RAISE EXCEPTION 'COUPON_RESERVATION_RELEASED';
  END IF;

  PERFORM 1
  FROM public.course_coupons
  WHERE id = v_reservation.coupon_id
  FOR UPDATE;

  UPDATE public.course_coupons
  SET redeemed_count = redeemed_count + 1,
      updated_at = now()
  WHERE id = v_reservation.coupon_id;

  UPDATE public.course_coupon_reservations
  SET status = 'redeemed',
      updated_at = now()
  WHERE order_id = p_order_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  insert into public.users (uid, email, display_name, photo_url, roles, onboarding_completed)
  values (
    new.id::text,
    new.email,
    coalesce(
      nullif(new.raw_user_meta_data->>'name', ''),
      nullif(new.raw_user_meta_data->>'full_name', ''),
      nullif(new.raw_user_meta_data->>'display_name', '')
    ),
    nullif(new.raw_user_meta_data->>'avatar_url', ''),
    '["student"]'::jsonb,
    false
  )
  on conflict (uid) do nothing;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.has_enrollment_for_course_slug(p_slug text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.enrollments e
    WHERE e.user_id = (SELECT auth.uid())::text
      AND e.course_slug = p_slug
      AND e.status IN ('active', 'completed')
  );
$function$
;

CREATE OR REPLACE FUNCTION public.invite_course_coproducer(p_course_id text, p_email text, p_share_pct integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid text := public.assert_course_owner(p_course_id);
  v_email text := lower(btrim(coalesce(p_email,'')));
  v_used integer;
  v_count integer;
begin
  -- Serialize invites per course so the share cap can't be raced past.
  perform 1 from public.courses where id = p_course_id for update;

  if v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 254 then
    raise exception 'Enter a valid co-producer email address.';
  end if;
  if exists (select 1 from public.users u where u.uid = v_uid and lower(u.email) = v_email) then
    raise exception 'You already own this course — invite a different practitioner.';
  end if;
  if p_share_pct is null or p_share_pct < 5 or p_share_pct > 90 then
    raise exception 'Revenue share must be between 5%% and 90%%.';
  end if;
  select count(*), coalesce(sum(revenue_share_pct), 0)
    into v_count, v_used
  from public.course_coproducers
  where course_id = p_course_id and status in ('invited','accepted');
  if v_count >= 10 then
    raise exception 'This course already has 10 co-producers.';
  end if;
  if v_used + p_share_pct > 90 then
    raise exception 'Keep at least 10%% of revenue with the primary creator (% already allocated).', v_used::text || '%';
  end if;
  if exists (
    select 1 from public.course_coproducers
    where course_id = p_course_id
      and lower(invitee_email) = v_email
      and status in ('invited','accepted')
  ) then
    raise exception 'That practitioner already has a live invitation for this course.';
  end if;

  insert into public.course_coproducers (course_id, owner_id, invitee_email, revenue_share_pct)
  values (p_course_id, v_uid, v_email, p_share_pct);

  return jsonb_build_object('success', true);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1
    from public.users u
    where u.uid = (select auth.uid())::text
      and u.roles ? 'admin'
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_moderator()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.uid = (SELECT auth.uid())::text
      AND (u.roles ? 'moderator' OR u.roles ? 'admin')
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_ops()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.uid = (SELECT auth.uid())::text
      AND (u.roles ? 'ops' OR u.roles ? 'admin')
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_service_role()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT coalesce(
    current_setting('request.jwt.claim.role', true) = 'service_role'
    OR (SELECT auth.role()) = 'service_role',
    false
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_support()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.uid = (SELECT auth.uid())::text
      AND (u.roles ? 'support' OR u.roles ? 'admin')
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_target_author(p_target_type text, p_post_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE p_target_type
    WHEN 'post' THEN EXISTS (
      SELECT 1 FROM public.community_posts p
      WHERE p.id = p_post_id AND p.author_id = (SELECT auth.uid())::text)
    WHEN 'comment' THEN EXISTS (
      SELECT 1 FROM public.community_comments c
      WHERE c.id = p_post_id AND c.author_id = (SELECT auth.uid())::text)
    ELSE false
  END;
$function$
;

CREATE OR REPLACE FUNCTION public.is_teacher()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.uid = (SELECT auth.uid())::text
      AND (u.roles ? 'teacher' OR u.roles ? 'admin')
  );
$function$
;

CREATE OR REPLACE FUNCTION public.issue_skillset_certificate(p_enrollment_id text, p_full_name text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid text := (select auth.uid())::text;
  v_full_name text;
  v_enrollment public.enrollments%rowtype;
  v_cert public.certificates%rowtype;
  v_course public.courses%rowtype;
  v_owner public.users%rowtype;
  v_teacher_name text;
  v_teacher_sig text;
  v_code text;
  v_now timestamptz := now();
begin
  if v_uid is null then
    raise exception 'Sign in before requesting a certificate.' using errcode = 'P0001';
  end if;

  p_enrollment_id := btrim(coalesce(p_enrollment_id, ''));
  if p_enrollment_id = '' or length(p_enrollment_id) > 220 then
    raise exception 'A valid enrollmentId is required.' using errcode = 'P0001';
  end if;

  v_full_name := btrim(regexp_replace(coalesce(p_full_name, ''), '\s+', ' ', 'g'));
  if length(v_full_name) < 2 or length(v_full_name) > 120 then
    raise exception 'Enter the full name (2-120 characters) to print on the certificate.'
      using errcode = 'P0001';
  end if;

  perform public.enforce_rate_limit('certificate_issue_' || v_uid, 20, 3600000);

  select * into v_enrollment
  from public.enrollments
  where id = p_enrollment_id;
  if not found then
    raise exception 'Enrollment not found.' using errcode = 'P0001';
  end if;
  if v_enrollment.user_id <> v_uid then
    raise exception 'You can only request your own certificate.' using errcode = 'P0001';
  end if;
  if v_enrollment.status <> 'completed'
     and coalesce(v_enrollment.progress_percent, 0) < 100 then
    raise exception 'Complete the course before requesting a certificate.'
      using errcode = 'P0001';
  end if;
  if v_enrollment.status in ('refunded', 'revoked', 'expired') then
    raise exception 'This enrollment is not eligible for certificate issuance.'
      using errcode = 'P0001';
  end if;

  select * into v_cert
  from public.certificates
  where id = p_enrollment_id
  for update;
  if found then
    if v_cert.status = 'revoked' then
      raise exception 'This certificate was revoked by Skillset operations.'
        using errcode = 'P0001';
    end if;
    update public.certificates
    set status = 'issued', updated_at = v_now
    where id = p_enrollment_id;
    return p_enrollment_id;
  end if;

  select * into v_course
  from public.courses
  where id = v_enrollment.course_id;
  if found then
    select * into v_owner
    from public.users
    where uid = v_course.owner_id;
    if found then
      v_teacher_name := nullif(btrim(coalesce(v_owner.display_name, '')), '');
      v_teacher_sig := nullif(coalesce(v_owner.teacher_signature_url, ''), '');
    end if;
  end if;

  v_code := 'SK-'
    || upper(left(regexp_replace(p_enrollment_id, '[^a-zA-Z0-9]', '', 'g'), 18))
    || '-'
    || upper(to_hex((extract(epoch from v_now) * 1000)::bigint));

  insert into public.certificates (
    id, enrollment_id, user_id, course_id, course_slug, course_title,
    course_category, authority_label, status, verification_code,
    student_full_name, teacher_name, teacher_signature_url, sponsor_logo_url,
    issued_at, created_at, updated_at
  ) values (
    p_enrollment_id, p_enrollment_id, v_enrollment.user_id, v_enrollment.course_id,
    v_enrollment.course_slug, v_enrollment.course_title, v_enrollment.course_category,
    'Skillset Verified', 'issued', v_code,
    v_full_name, v_teacher_name, v_teacher_sig, null,
    v_now, v_now, v_now
  );

  return p_enrollment_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lesson_comments_update_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF public.is_service_role() OR public.is_admin() THEN
    RETURN NEW;
  END IF;
  IF NEW.course_id   IS DISTINCT FROM OLD.course_id
     OR NEW.lesson_id   IS DISTINCT FROM OLD.lesson_id
     OR NEW.author_id   IS DISTINCT FROM OLD.author_id
     OR NEW.author_name IS DISTINCT FROM OLD.author_name
     OR NEW.created_at  IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'lesson_comments: only body may be edited';
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.log_audit_event(p_action text, p_actor_id text, p_actor_email text, p_target_type text, p_target_id text, p_summary text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  insert into public.audit_log
    (id, action, actor_id, actor_email, target_type, target_id, summary, metadata, created_at)
  values (
    gen_random_uuid()::text,
    p_action,
    p_actor_id,
    nullif(btrim(coalesce(p_actor_email, '')), ''),
    p_target_type,
    p_target_id,
    left(p_summary, 280),
    coalesce(p_metadata, '{}'::jsonb),
    now()
  );
exception when others then
  -- Auditing is best-effort and must not roll back the caller.
  null;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notifications_client_read_only_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF public.is_service_role() THEN
    RETURN NEW;
  END IF;
  IF NEW.notification_id IS DISTINCT FROM OLD.notification_id
     OR NEW.user_id    IS DISTINCT FROM OLD.user_id
     OR NEW.type       IS DISTINCT FROM OLD.type
     OR NEW.title      IS DISTINCT FROM OLD.title
     OR NEW.body       IS DISTINCT FROM OLD.body
     OR NEW.link       IS DISTINCT FROM OLD.link
     OR NEW.actor_name IS DISTINCT FROM OLD.actor_name
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'notifications: clients may only modify the read flag';
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_enrolled_on_course_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_when text;
begin
  if new.status <> 'scheduled' then
    return new;
  end if;

  -- starts_at is stored as ISO text; format defensively.
  begin
    v_when := to_char(new.starts_at::timestamptz, 'FMMon DD, YYYY at HH24:MI "UTC"');
  exception when others then
    v_when := new.starts_at;
  end;

  insert into public.notifications
    (notification_id, user_id, type, title, body, read, link, actor_name, created_at)
  select
    gen_random_uuid()::text,
    e.user_id,
    'live_event',
    'Live session scheduled: ' || new.title,
    new.course_title || ' — ' || v_when,
    false,
    '/learn/courses/' || new.course_id,
    null,
    now()
  from public.enrollments e
  where e.course_id = new.course_id
    and e.status in ('active', 'completed')
    and e.user_id <> new.owner_id;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.platform_fee_bps_for_plan(p_plan text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case p_plan
    when 'free' then 1000
    when 'starter' then 500
    when 'pro' then 300
    when 'plus' then 200
    else 1000
  end;
$function$
;

CREATE OR REPLACE FUNCTION public.prevent_course_lesson_content_course_move()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.course_id IS DISTINCT FROM OLD.course_id THEN
    RAISE EXCEPTION
      'LESSON_ID_OWNERSHIP_CONFLICT: lesson % belongs to course %',
      OLD.lesson_id,
      OLD.course_id
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.publish_teacher_course(p_course_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid text := (select auth.uid())::text;
  v_roles jsonb;
  v_accepted timestamptz;
  v_conn_acct text;
  v_charges boolean;
  v_payouts boolean;
  v_verif text;
  c public.courses%rowtype;
  v_module_count integer;
  v_lesson_count integer;
begin
  if v_uid is null then
    raise exception 'Sign in before publishing a course.';
  end if;

  select u.roles, u.teacher_terms_accepted_at,
         u.stripe_connected_account_id,
         u.stripe_connect_charges_enabled,
         u.stripe_connect_payouts_enabled,
         u.creator_verification_status
    into v_roles, v_accepted, v_conn_acct, v_charges, v_payouts, v_verif
  from public.users u
  where u.uid = v_uid;

  if v_roles is null or not (v_roles ? 'teacher') or v_accepted is null then
    raise exception 'Teacher setup must be complete before publishing courses.';
  end if;

  if coalesce((
       select (ps.value #>> '{}')::boolean
       from public.platform_settings ps
       where ps.key = 'require_creator_verification'
     ), false)
     and coalesce(v_verif, 'none') <> 'approved' then
    raise exception 'Professional verification must be approved before publishing a course.';
  end if;

  select * into c
  from public.courses
  where id = p_course_id
  for update;

  if c.id is null then
    raise exception 'Course not found.';
  end if;
  if c.owner_id <> v_uid then
    raise exception 'Only the course owner can publish it.';
  end if;
  if c.status = 'published' then
    return jsonb_build_object('success', true, 'status', 'published', 'alreadyPublished', true);
  end if;
  if c.status not in ('draft', 'in_review', 'needs_changes', 'inactive') then
    raise exception 'This course cannot be published right now.';
  end if;

  if char_length(btrim(coalesce(c.title, ''))) < 3 or char_length(c.title) > 120 then
    raise exception 'Add a course title before publishing.';
  end if;
  if char_length(btrim(coalesce(c.summary, ''))) < 20 or char_length(c.summary) > 1200 then
    raise exception 'Add a course summary (at least 20 characters) before publishing.';
  end if;
  if char_length(btrim(coalesce(c.category, ''))) < 2 or char_length(c.category) > 80 then
    raise exception 'Choose a course category before publishing.';
  end if;

  v_module_count := jsonb_array_length(coalesce(c.modules, '[]'::jsonb));
  select coalesce(sum(jsonb_array_length(coalesce(m->'lessons', '[]'::jsonb))), 0)
    into v_lesson_count
  from jsonb_array_elements(coalesce(c.modules, '[]'::jsonb)) m;
  if v_module_count < 1 or v_lesson_count < 1 then
    raise exception 'Add at least one module with a lesson before publishing.';
  end if;

  if c.free_preview_lesson_id is not null and not exists (
    select 1
    from jsonb_array_elements(coalesce(c.modules, '[]'::jsonb)) m,
         jsonb_array_elements(coalesce(m->'lessons', '[]'::jsonb)) l
    where l->>'id' = c.free_preview_lesson_id
  ) then
    raise exception 'Free preview lesson must belong to this course.';
  end if;

  if coalesce(c.payment_type, 'one_time') <> 'free' then
    if coalesce(c.payment_type, 'one_time') not in (
      'one_time',
      'subscription_monthly',
      'subscription_yearly'
    ) then
      raise exception 'Choose a valid payment type before publishing.';
    end if;
    if coalesce(c.price_amount_minor, 0) <= 0 then
      raise exception 'Set a price before publishing a paid course.';
    end if;
    if v_conn_acct is null
       or not coalesce(v_charges, false)
       or not coalesce(v_payouts, false) then
      raise exception 'Finish Stripe payout onboarding before publishing a paid course.';
    end if;
  end if;

  perform set_config('skillset.trusted_write', 'on', true);
  update public.courses
    set status = 'published', review_note = null, updated_at = now()
  where id = p_course_id;
  perform set_config('skillset.trusted_write', 'off', true);

  perform public.log_audit_event(
    p_action => 'COURSE_PUBLISHED_BY_CREATOR',
    p_actor_id => v_uid,
    p_actor_email => coalesce(
      (select email from public.users where uid = v_uid),
      v_uid
    ),
    p_target_type => 'course',
    p_target_id => p_course_id,
    p_summary => 'Creator published course ' || p_course_id,
    p_metadata => jsonb_build_object(
      'title', c.title,
      'paymentType', c.payment_type
    )
  );

  return jsonb_build_object('success', true, 'status', 'published');
end;
$function$
;

CREATE OR REPLACE FUNCTION public.recompute_course_trending_scores()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- Single pass: every course gets its 7-day enrollment count (0 if none).
  -- `is distinct from` skips no-op writes so unchanged rows don't churn.
  update public.courses c
  set trending_score = r.cnt
  from (
    select c2.id, count(e.id)::numeric as cnt
    from public.courses c2
    left join public.enrollments e
      on e.course_id = c2.id
     and e.created_at >= now() - interval '7 days'
    group by c2.id
  ) r
  where c.id = r.id
    and c.trending_score is distinct from r.cnt;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.record_lesson_progress(p_enrollment_id text, p_lesson_id text, p_completed boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid text := (select auth.uid())::text;
  v_enrollment_id text;
  v_lesson_id text;
  v_enrollment public.enrollments%rowtype;
  v_course public.courses%rowtype;
  v_valid_ids text[];
  v_total_lessons integer;
  v_completed_count integer;
  v_progress integer;
  v_status text;
  v_now timestamptz := now();
begin
  if v_uid is null then
    raise exception 'Sign in before tracking progress.' using errcode = 'P0001';
  end if;

  v_enrollment_id := btrim(coalesce(p_enrollment_id, ''));
  if v_enrollment_id = '' or length(v_enrollment_id) > 220 then
    raise exception 'A valid enrollmentId is required.' using errcode = 'P0001';
  end if;
  v_lesson_id := btrim(coalesce(p_lesson_id, ''));
  if v_lesson_id = '' or length(v_lesson_id) > 200 then
    raise exception 'A valid lessonId is required.' using errcode = 'P0001';
  end if;

  perform public.enforce_rate_limit('lesson_progress_' || v_uid, 200, 3600000);

  select * into v_enrollment
  from public.enrollments
  where id = v_enrollment_id;
  if not found then
    raise exception 'Enrollment not found.' using errcode = 'P0001';
  end if;
  if v_enrollment.user_id <> v_uid then
    raise exception 'You can only update progress for your own enrollments.'
      using errcode = 'P0001';
  end if;
  if v_enrollment.status in ('refunded', 'revoked', 'expired') then
    raise exception 'This enrollment is no longer active.' using errcode = 'P0001';
  end if;

  select * into v_course
  from public.courses
  where id = v_enrollment.course_id;
  if not found then
    raise exception 'Course not found.' using errcode = 'P0001';
  end if;

  if jsonb_typeof(v_course.modules) = 'array' then
    select coalesce(array_agg(distinct lid), array[]::text[])
      into v_valid_ids
    from (
      select lesson->>'id' as lid
      from jsonb_array_elements(v_course.modules) as m
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(m->'lessons') = 'array'
          then m->'lessons'
          else '[]'::jsonb
        end
      ) as lesson
      where coalesce(lesson->>'id', '') <> ''
    ) s;
  else
    v_valid_ids := array[]::text[];
  end if;

  v_total_lessons := coalesce(array_length(v_valid_ids, 1), 0);

  if not (v_lesson_id = any(v_valid_ids)) then
    raise exception 'That lesson does not belong to this course.'
      using errcode = 'P0001';
  end if;

  if p_completed then
    insert into public.lesson_progress
      (enrollment_id, lesson_id, user_id, completed_at)
    values (v_enrollment_id, v_lesson_id, v_uid, v_now)
    on conflict (enrollment_id, lesson_id) do update set
      completed_at = v_now,
      user_id = v_uid;
  else
    delete from public.lesson_progress
    where enrollment_id = v_enrollment_id and lesson_id = v_lesson_id;
  end if;

  select count(*) into v_completed_count
  from public.lesson_progress
  where enrollment_id = v_enrollment_id and lesson_id = any(v_valid_ids);

  if v_total_lessons > 0 then
    v_progress := least(
      100,
      greatest(0, round((v_completed_count::numeric / v_total_lessons) * 100))
    );
  else
    v_progress := 0;
  end if;
  v_status := case when v_progress >= 100 then 'completed' else 'active' end;

  perform set_config('skillset.trusted_write', 'on', true);
  update public.enrollments set
    progress_percent = v_progress,
    status = v_status,
    updated_at = v_now,
    last_lesson_id = case when p_completed then v_lesson_id else last_lesson_id end
  where id = v_enrollment_id;
  perform set_config('skillset.trusted_write', 'off', true);

  return jsonb_build_object(
    'progressPercent', v_progress,
    'status', v_status,
    'completedLessonCount', v_completed_count,
    'totalLessonCount', v_total_lessons
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.release_course_coupon_reservation(p_order_id text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  UPDATE public.course_coupon_reservations
  SET status = 'released',
      updated_at = now()
  WHERE order_id = p_order_id
    AND status = 'reserved';
$function$
;

CREATE OR REPLACE FUNCTION public.request_account_action(p_type text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid text := (select auth.uid())::text;
  v_email text;
  v_request_id text := gen_random_uuid()::text;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED: sign in before requesting account actions'
      using errcode = 'P0001';
  end if;

  if p_type not in ('data_export', 'account_deletion') then
    raise exception 'INVALID_ARGUMENT: unknown account action type'
      using errcode = 'P0001';
  end if;

  perform public.enforce_rate_limit(
    'account_action_' || p_type || '_' || v_uid,
    4,
    86400000
  );

  select email into v_email
  from auth.users
  where id = (select auth.uid());

  insert into public.account_action_requests
    (id, type, requested_by, email, status, requested_at, updated_at)
  values (v_request_id, p_type, v_uid, v_email, 'pending', now(), now());

  perform public.log_audit_event(
    case when p_type = 'account_deletion'
      then 'account.deletion_requested'
      else 'account.data_export_requested' end,
    v_uid,
    v_email,
    'user',
    v_uid,
    case when p_type = 'account_deletion'
      then 'Account deletion requested'
      else 'Personal data export requested' end,
    jsonb_build_object('requestId', v_request_id, 'type', p_type)
  );

  return v_request_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.reserve_course_coupon(p_coupon_id uuid, p_order_id text, p_user_id text, p_expires_at timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_coupon public.course_coupons%ROWTYPE;
  v_reserved_count integer;
  v_existing public.course_coupon_reservations%ROWTYPE;
BEGIN
  SELECT * INTO v_coupon
  FROM public.course_coupons
  WHERE id = p_coupon_id
  FOR UPDATE;

  IF NOT FOUND OR v_coupon.active = false THEN
    RAISE EXCEPTION 'COUPON_UNAVAILABLE';
  END IF;
  IF v_coupon.expires_at IS NOT NULL AND v_coupon.expires_at <= now() THEN
    RAISE EXCEPTION 'COUPON_EXPIRED';
  END IF;

  SELECT * INTO v_existing
  FROM public.course_coupon_reservations
  WHERE order_id = p_order_id
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.coupon_id = p_coupon_id
       AND v_existing.user_id = p_user_id
       AND v_existing.status IN ('reserved', 'redeemed') THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'COUPON_RESERVATION_CONFLICT';
  END IF;

  SELECT count(*)::integer INTO v_reserved_count
  FROM public.course_coupon_reservations
  WHERE coupon_id = p_coupon_id
    AND status = 'reserved';

  IF v_coupon.redeemed_count + v_reserved_count >= v_coupon.max_redemptions THEN
    RAISE EXCEPTION 'COUPON_LIMIT_REACHED';
  END IF;

  INSERT INTO public.course_coupon_reservations (
    order_id, coupon_id, user_id, status, expires_at
  ) VALUES (
    p_order_id, p_coupon_id, p_user_id, 'reserved', p_expires_at
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.review_creator_verification(p_case_id uuid, p_status text, p_review_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.revoke_course_coproducer(p_coproducer_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_row public.course_coproducers%rowtype;
begin
  select * into v_row from public.course_coproducers where id = p_coproducer_id;
  if v_row.id is null then
    raise exception 'Co-producer invitation not found.';
  end if;
  -- Live ownership check against courses.owner_id (not the row snapshot).
  perform public.assert_course_owner(v_row.course_id);
  if v_row.status = 'revoked' then
    return jsonb_build_object('success', true);
  end if;

  update public.course_coproducers
    set status = 'revoked', updated_at = now()
  where id = p_coproducer_id;

  return jsonb_build_object('success', true);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.send_course_message(p_course_id text, p_student_id text, p_body text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid text := (select auth.uid())::text;
  v_course_id text;
  v_student_id text;
  v_body text;
  v_course public.courses%rowtype;
  v_enrollment public.enrollments%rowtype;
  v_is_teacher boolean;
  v_sender_name text;
  v_student_name text;
  v_recipient text;
  v_message_id text := gen_random_uuid()::text;
  v_now timestamptz := now();
begin
  if v_uid is null then
    raise exception 'Sign in before sending a message.' using errcode = 'P0001';
  end if;

  v_course_id := btrim(coalesce(p_course_id, ''));
  if length(v_course_id) < 3 or length(v_course_id) > 160 then
    raise exception 'A valid course id is required.' using errcode = 'P0001';
  end if;

  v_student_id := btrim(coalesce(p_student_id, ''));
  if length(v_student_id) < 3 or length(v_student_id) > 160 then
    raise exception 'A valid student id is required.' using errcode = 'P0001';
  end if;

  v_body := btrim(coalesce(p_body, ''));
  if length(v_body) < 1 then
    raise exception 'Message cannot be empty.' using errcode = 'P0001';
  end if;
  v_body := left(v_body, 2000);

  select * into v_course
  from public.courses
  where id = v_course_id;
  if not found then
    raise exception 'Course not found.' using errcode = 'P0001';
  end if;

  v_is_teacher := v_course.owner_id = v_uid;
  if not v_is_teacher and v_uid <> v_student_id then
    raise exception 'You can only send messages in your own thread.'
      using errcode = 'P0001';
  end if;
  if v_is_teacher and v_student_id = v_uid then
    raise exception 'You cannot message yourself.' using errcode = 'P0001';
  end if;

  select * into v_enrollment
  from public.enrollments
  where id = v_student_id || '__' || v_course_id;
  if not found then
    raise exception 'Only enrolled students can use course messages.'
      using errcode = 'P0001';
  end if;
  if v_enrollment.user_id <> v_student_id or v_enrollment.course_id <> v_course_id then
    raise exception 'This enrollment does not match the thread.' using errcode = 'P0001';
  end if;
  if v_enrollment.status not in ('active', 'completed') then
    raise exception 'This enrollment cannot send messages.' using errcode = 'P0001';
  end if;

  perform public.enforce_rate_limit('course_msg_' || v_uid, 30, 3600000);

  select nullif(btrim(coalesce(display_name, '')), '') into v_sender_name
  from public.users where uid = v_uid;
  v_sender_name := coalesce(
    v_sender_name,
    case when v_is_teacher then 'Your teacher' else 'Skillset member' end
  );

  select nullif(btrim(coalesce(display_name, '')), '') into v_student_name
  from public.users where uid = v_student_id;
  v_student_name := coalesce(v_student_name, 'Skillset member');

  insert into public.course_messages
    (id, course_id, course_title, student_id, student_name, teacher_id, sender_id, body, created_at)
  values (
    v_message_id, v_course_id, coalesce(v_course.title, ''), v_student_id,
    v_student_name, v_course.owner_id, v_uid, v_body, v_now
  );

  v_recipient := case when v_is_teacher then v_student_id else v_course.owner_id end;
  if v_recipient is not null and v_recipient <> v_uid then
    begin
      insert into public.notifications
        (notification_id, user_id, type, title, body, link, actor_name, read, created_at)
      values (
        gen_random_uuid()::text,
        v_recipient,
        'course_message',
        case when v_is_teacher
          then 'New message from your teacher'
          else 'New student message' end,
        v_sender_name || ': ' || left(v_body, 140),
        case when v_is_teacher
          then case when coalesce(v_course.slug, '') <> ''
            then '/learn/courses/' || v_course.slug
            else '/learn' end
          else '/teach/messages' end,
        v_sender_name,
        false,
        v_now
      );
    exception when others then
      null;
    end;
  end if;

  return jsonb_build_object('success', true, 'messageId', v_message_id);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.server_write_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'table %.% is server-write only', TG_TABLE_SCHEMA, TG_TABLE_NAME
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_course_coupon_active(p_coupon_id uuid, p_active boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_coupon public.course_coupons%rowtype;
  v_uid text;
begin
  select * into v_coupon from public.course_coupons where id = p_coupon_id;
  if v_coupon.id is null then
    raise exception 'Coupon not found.';
  end if;
  -- Live ownership check against courses.owner_id (not the row snapshot).
  v_uid := public.assert_course_owner(v_coupon.course_id);
  if coalesce(p_active, false) then
    if v_coupon.expires_at is not null and v_coupon.expires_at <= now() then
      raise exception 'This coupon has expired — create a new one instead.';
    end if;
    if coalesce((
         select (ps.value #>> '{}')::boolean
         from public.platform_settings ps
         where ps.key = 'require_creator_verification'
       ), false)
       and coalesce((
         select u.creator_verification_status
         from public.users u where u.uid = v_uid
       ), 'none') <> 'approved' then
      raise exception 'Professional verification must be approved before a coupon can be activated.';
    end if;
  end if;

  update public.course_coupons
    set active = coalesce(p_active, false), updated_at = now()
  where id = p_coupon_id;

  return jsonb_build_object('success', true);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_default_product_offer(p_course_id text, p_offer_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_price public.product_prices%ROWTYPE;
BEGIN
  SELECT prices.* INTO v_price
  FROM public.product_prices AS prices
  JOIN public.product_offers AS offers ON offers.id = prices.offer_id
  WHERE offers.id = p_offer_id
    AND offers.course_id = p_course_id
    AND offers.active = true
    AND prices.active = true
  ORDER BY prices.created_at, prices.id
  LIMIT 1
  FOR UPDATE OF offers, prices;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Offer or active price not found.';
  END IF;

  UPDATE public.product_offers
  SET is_default = false,
      updated_at = now()
  WHERE course_id = p_course_id
    AND id <> p_offer_id;

  UPDATE public.product_offers
  SET is_default = true,
      updated_at = now()
  WHERE id = p_offer_id
    AND course_id = p_course_id;

  UPDATE public.courses
  SET price_amount_minor = v_price.amount_minor,
      currency = upper(v_price.currency),
      payment_type = v_price.payment_type,
      updated_at = now()
  WHERE id = p_course_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.submit_course_review(p_course_id text, p_rating integer, p_body text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid text := (select auth.uid())::text;
  v_course_id text;
  v_rating integer;
  v_body text;
  v_course public.courses%rowtype;
  v_enrollment public.enrollments%rowtype;
  v_prev public.course_reviews%rowtype;
  v_has_prev boolean := false;
  v_prev_rating integer := 0;
  v_current_sum integer;
  v_current_count integer;
  v_rating_sum integer;
  v_rating_count integer;
  v_rating_average numeric;
  v_author_name text;
  v_owner_display text;
  v_review_id text;
  v_enrollment_id text;
  v_now timestamptz := now();
begin
  if v_uid is null then
    raise exception 'Sign in before reviewing a course.' using errcode = 'P0001';
  end if;

  v_course_id := btrim(coalesce(p_course_id, ''));
  if length(v_course_id) < 3 or length(v_course_id) > 160 then
    raise exception 'A valid course id is required.' using errcode = 'P0001';
  end if;

  v_rating := round(coalesce(p_rating, 0));
  if v_rating < 1 or v_rating > 5 then
    raise exception 'Rating must be between 1 and 5.' using errcode = 'P0001';
  end if;

  v_body := nullif(btrim(coalesce(p_body, '')), '');
  if v_body is not null then
    v_body := left(v_body, 1200);
    if length(v_body) < 3 then
      raise exception 'Review text must be at least 3 characters when provided.'
        using errcode = 'P0001';
    end if;
  end if;

  perform public.enforce_rate_limit(
    'course_review_' || v_course_id || '_' || v_uid,
    20,
    3600000
  );

  v_review_id := v_course_id || '__' || v_uid;
  v_enrollment_id := v_uid || '__' || v_course_id;

  select * into v_course
  from public.courses
  where id = v_course_id;
  if not found then
    raise exception 'Course not found.' using errcode = 'P0001';
  end if;
  if v_course.status <> 'published' then
    raise exception 'Only published courses can receive reviews.' using errcode = 'P0001';
  end if;

  select * into v_enrollment
  from public.enrollments
  where id = v_enrollment_id;
  if not found then
    raise exception 'Enroll in this course before leaving a review.' using errcode = 'P0001';
  end if;
  if v_enrollment.user_id <> v_uid or v_enrollment.course_id <> v_course_id then
    raise exception 'You can only review courses attached to your account.'
      using errcode = 'P0001';
  end if;
  if v_enrollment.status not in ('active', 'completed') then
    raise exception 'This enrollment cannot leave a review.' using errcode = 'P0001';
  end if;
  if coalesce(v_enrollment.progress_percent, 0) < 50 then
    raise exception 'Complete at least 50%% of the course before leaving a review.'
      using errcode = 'P0001';
  end if;

  select * into v_prev
  from public.course_reviews
  where id = v_review_id;
  v_has_prev := found;
  if v_has_prev then
    v_prev_rating := round(coalesce(v_prev.rating, 0));
  end if;

  v_current_sum := coalesce(
    v_course.rating_sum,
    round(coalesce(v_course.rating_average, 0) * coalesce(v_course.rating_count, 0))
  );
  v_current_count := coalesce(v_course.rating_count, 0);
  if v_has_prev then
    v_rating_sum := v_current_sum - v_prev_rating + v_rating;
    v_rating_count := greatest(1, v_current_count);
  else
    v_rating_sum := v_current_sum + v_rating;
    v_rating_count := v_current_count + 1;
  end if;
  v_rating_average := round((v_rating_sum::numeric / v_rating_count) * 10) / 10;

  select nullif(btrim(coalesce(display_name, '')), '') into v_owner_display
  from public.users where uid = v_uid;
  v_author_name := coalesce(v_owner_display, 'Skillset learner');

  insert into public.course_reviews
    (id, course_id, author_name, rating, body, status, created_at, updated_at)
  values (
    v_review_id, v_course_id, v_author_name, v_rating, v_body, 'published',
    case when v_has_prev then v_prev.created_at else v_now end,
    v_now
  )
  on conflict (id) do update set
    author_name = excluded.author_name,
    rating = excluded.rating,
    body = excluded.body,
    status = 'published',
    updated_at = v_now;

  perform set_config('skillset.trusted_write', 'on', true);
  update public.courses set
    rating_average = v_rating_average,
    rating_count = v_rating_count,
    rating_sum = v_rating_sum,
    review_count = v_rating_count,
    updated_at = v_now
  where id = v_course_id;
  perform set_config('skillset.trusted_write', 'off', true);

  if v_course.owner_id is not null and v_course.owner_id <> v_uid then
    begin
      insert into public.notifications
        (notification_id, user_id, type, title, body, link, actor_name, read, created_at)
      values (
        gen_random_uuid()::text,
        v_course.owner_id,
        'course_review',
        'New ' || v_rating || '-star review',
        v_author_name || ' reviewed '
          || coalesce(nullif(v_course.title, ''), 'your course') || '.',
        case when coalesce(v_course.slug, '') <> ''
          then '/courses/' || v_course.slug
          else '/teach' end,
        v_author_name,
        false,
        v_now
      );
    exception when others then
      null;
    end;
  end if;

  return jsonb_build_object(
    'success', true,
    'reviewId', v_review_id,
    'ratingAverage', v_rating_average,
    'ratingCount', v_rating_count
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.submit_creator_verification(p_profession text, p_registration_type text, p_registration_id text, p_registration_region text, p_evidence_links jsonb DEFAULT '[]'::jsonb, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.submit_teacher_course_for_review(p_course_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  return public.publish_teacher_course(p_course_id);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.support_tickets_update_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF public.is_service_role() THEN
    RETURN NEW;
  END IF;
  IF NEW.user_id    IS DISTINCT FROM OLD.user_id
     OR NEW.user_email IS DISTINCT FROM OLD.user_email
     OR NEW.user_name  IS DISTINCT FROM OLD.user_name
     OR NEW.category   IS DISTINCT FROM OLD.category
     OR NEW.subject    IS DISTINCT FROM OLD.subject
     OR NEW.message    IS DISTINCT FROM OLD.message
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'support_tickets: only status/admin_response/responded_by/responded_at may change';
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_teacher_course_builder(p_course_id text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid text := (select auth.uid())::text;
  v_roles jsonb;
  v_accepted timestamptz;
  v_plan text;
  v_owner text;
  v_status text;
  v_current_key text;
  v_current_title text;
  v_title text := btrim(coalesce(p_payload->>'title', ''));
  v_summary text := btrim(coalesce(p_payload->>'summary', ''));
  v_title_key text;
  v_categories text[];
  v_category text;
  v_outcomes text[];
  v_modules jsonb;
  v_lesson_count integer;
  v_payment_type text;
  v_price integer;
  v_currency text;
  v_inst_enabled boolean;
  v_inst_max integer;
  v_drip_strategy text;
  v_drip_days integer;
  v_free text;
  v_fee integer;
  v_members_theme text;
  v_community boolean := coalesce((p_payload->'communityEnabled') = 'true'::jsonb, false);
begin
  if v_uid is null then
    raise exception 'Sign in before saving a course.';
  end if;

  select u.roles, u.teacher_terms_accepted_at, u.current_plan_id
    into v_roles, v_accepted, v_plan
  from public.users u where u.uid = v_uid;

  if v_roles is null or not (v_roles ? 'teacher') or v_accepted is null then
    raise exception 'Teacher setup must be complete before saving courses.';
  end if;

  select c.owner_id, c.status, c.title_key, c.title
    into v_owner, v_status, v_current_key, v_current_title
  from public.courses c where c.id = p_course_id;

  if v_owner is null then
    raise exception 'Course not found.';
  end if;
  if v_owner <> v_uid then
    raise exception 'Only the course owner can save it.';
  end if;
  if v_status not in ('draft', 'needs_changes', 'published', 'inactive') then
    raise exception 'This course status cannot be edited from the builder.';
  end if;

  v_title_key := public.course_title_key(v_title);
  if char_length(v_title_key) < 3 then
    raise exception 'Course title is not specific enough.';
  end if;

  v_categories := coalesce((
    select array_agg(elem #>> '{}' order by ord)
    from jsonb_array_elements(coalesce(p_payload->'categories', '[]'::jsonb))
         with ordinality as t(elem, ord)
    where jsonb_typeof(elem) = 'string' and btrim(elem #>> '{}') <> ''
  ), '{}');

  v_category := coalesce(
    v_categories[1],
    nullif(left(btrim(coalesce(p_payload->>'category', '')), 80), '')
  );
  if v_category is null
     or char_length(v_category) < 2
     or char_length(v_category) > 80 then
    raise exception 'Choose a valid course category.';
  end if;

  v_outcomes := coalesce((
    select array_agg(x order by ord)
    from (
      select left(btrim(elem #>> '{}'), 120) as x, ord
      from jsonb_array_elements(coalesce(p_payload->'learningOutcomes', '[]'::jsonb))
           with ordinality as t(elem, ord)
      where jsonb_typeof(elem) = 'string' and btrim(elem #>> '{}') <> ''
      order by ord
      limit 8
    ) s
  ), '{}');

  v_modules := coalesce(p_payload->'modules', '[]'::jsonb);
  if jsonb_typeof(v_modules) <> 'array' then
    v_modules := '[]'::jsonb;
  end if;

  select coalesce(sum(jsonb_array_length(coalesce(m->'lessons', '[]'::jsonb))), 0)
    into v_lesson_count
  from jsonb_array_elements(v_modules) m;

  v_payment_type := case
    when p_payload->>'paymentType' in ('free', 'one_time', 'subscription_monthly', 'subscription_yearly')
      then p_payload->>'paymentType'
    else 'one_time'
  end;

  v_price := case
    when v_payment_type = 'free' then 0
    when jsonb_typeof(p_payload->'priceAmountMinor') = 'number'
      then round((p_payload->>'priceAmountMinor')::numeric)::int
    else null
  end;
  if v_price is not null and v_price < 0 then
    raise exception 'Price cannot be negative.';
  end if;

  v_currency := upper(nullif(btrim(coalesce(p_payload->>'currency', '')), ''));
  if v_currency is null or char_length(v_currency) <> 3 then
    v_currency := 'USD';
  end if;

  v_inst_enabled := v_payment_type = 'one_time'
    and (p_payload->'installmentsEnabled') = 'true'::jsonb;
  v_inst_max := case when v_inst_enabled then
    least(36, greatest(1, coalesce(
      case when jsonb_typeof(p_payload->'installmentsMax') = 'number'
        then round((p_payload->>'installmentsMax')::numeric)::int else null end, 12)))
    else null end;

  v_drip_strategy := coalesce(
    nullif(btrim(coalesce(p_payload->>'dripStrategy', '')), ''),
    'instant'
  );
  v_drip_days := greatest(1, coalesce(
    case when jsonb_typeof(p_payload->'dripIntervalDays') = 'number'
      then round((p_payload->>'dripIntervalDays')::numeric)::int else null end,
    1
  ));

  v_free := nullif(btrim(coalesce(p_payload->>'freePreviewLessonId', '')), '');
  if v_free is not null and not exists (
    select 1
    from jsonb_array_elements(v_modules) m,
         jsonb_array_elements(coalesce(m->'lessons', '[]'::jsonb)) l
    where l->>'id' = v_free
  ) then
    raise exception 'Free preview lesson must belong to this course.';
  end if;

  v_members_theme := case when p_payload->>'membersTheme' in ('light', 'dark')
    then p_payload->>'membersTheme' else null end;

  v_fee := public.platform_fee_bps_for_plan(v_plan);

  if v_title_key <> coalesce(v_current_key, public.course_title_key(v_current_title)) then
    if exists (
      select 1 from public.courses c
      where c.title_key = v_title_key and c.id <> p_course_id
    ) then
      raise exception 'A course with this title already exists. Choose a more specific name.';
    end if;
    insert into public.course_title_keys (title_key) values (v_title_key)
    on conflict (title_key) do nothing;
    if v_current_key is not null and v_current_key <> v_title_key
       and not exists (
         select 1 from public.courses c
         where c.title_key = v_current_key and c.id <> p_course_id
       ) then
      delete from public.course_title_keys where title_key = v_current_key;
    end if;
  end if;

  perform set_config('skillset.trusted_write', 'on', true);

  update public.courses set
    title = v_title,
    title_key = v_title_key,
    summary = v_summary,
    category = v_category,
    categories = v_categories,
    learning_outcomes = v_outcomes,
    modules = v_modules,
    lesson_count = v_lesson_count,
    price_amount_minor = v_price,
    currency = v_currency,
    payment_type = v_payment_type,
    installments_enabled = v_inst_enabled,
    installments_max = v_inst_max,
    platform_fee_bps = v_fee,
    drip_strategy = v_drip_strategy,
    drip_interval_days = v_drip_days,
    free_preview_lesson_id = v_free,
    members_theme = v_members_theme,
    members_cover_asset_id = nullif(
      btrim(left(coalesce(p_payload->>'membersCoverAssetId', ''), 160)),
      ''
    ),
    members_title = nullif(
      btrim(left(coalesce(p_payload->>'membersTitle', ''), 80)),
      ''
    ),
    members_subtitle = nullif(
      btrim(left(coalesce(p_payload->>'membersSubtitle', ''), 160)),
      ''
    ),
    members_description = nullif(
      btrim(left(coalesce(p_payload->>'membersDescription', ''), 2000)),
      ''
    ),
    community_enabled = v_community,
    updated_at = now()
  where id = p_course_id;

  perform set_config('skillset.trusted_write', 'off', true);

  insert into public.course_lesson_content
    (lesson_id, course_id, content_text, external_url, created_at, updated_at)
  select
    l->>'id',
    p_course_id,
    nullif(l->>'contentText', ''),
    nullif(l->>'externalUrl', ''),
    now(),
    now()
  from jsonb_array_elements(v_modules) m,
       jsonb_array_elements(coalesce(m->'lessons', '[]'::jsonb)) l
  where coalesce(l->>'id', '') <> ''
  on conflict (lesson_id) do update set
    course_id = excluded.course_id,
    content_text = excluded.content_text,
    external_url = excluded.external_url,
    updated_at = now();

  delete from public.course_lesson_content
  where course_id = p_course_id
    and lesson_id not in (
      select l->>'id'
      from jsonb_array_elements(v_modules) m,
           jsonb_array_elements(coalesce(m->'lessons', '[]'::jsonb)) l
      where coalesce(l->>'id', '') <> ''
    );

  return jsonb_build_object('success', true);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.upsert_course_commerce_settings(p_course_id text, p_affiliate_enabled boolean, p_affiliate_commission_pct integer, p_affiliate_approval text, p_tax_collection boolean, p_tax_regions jsonb, p_tax_registration_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid text := public.assert_course_owner(p_course_id);
  v_region jsonb;
  v_regions jsonb := coalesce(p_tax_regions, '[]'::jsonb);
  v_registration text := nullif(btrim(coalesce(p_tax_registration_id,'')), '');
begin
  if p_affiliate_commission_pct is null
     or p_affiliate_commission_pct < 5 or p_affiliate_commission_pct > 60 then
    raise exception 'Affiliate commission must be between 5%% and 60%%.';
  end if;
  if p_affiliate_approval not in ('manual','automatic') then
    raise exception 'Partner approval must be manual or automatic.';
  end if;
  if jsonb_typeof(v_regions) <> 'array' then
    raise exception 'Tax regions must be a list.';
  end if;
  if jsonb_array_length(v_regions) > 5 then
    raise exception 'Pick at most 5 tax regions.';
  end if;
  for v_region in select * from jsonb_array_elements(v_regions) loop
    if jsonb_typeof(v_region) <> 'string'
       or (v_region #>> '{}') not in
         ('United States','Brazil','European Union','United Kingdom','Other') then
      raise exception 'Unknown tax region.';
    end if;
  end loop;
  if v_registration is not null and char_length(v_registration) > 80 then
    raise exception 'Keep the tax registration under 80 characters.';
  end if;

  if coalesce(p_affiliate_enabled, false)
     and coalesce((
          select (ps.value #>> '{}')::boolean
          from public.platform_settings ps
          where ps.key = 'require_creator_verification'
        ), false)
     and coalesce((
          select u.creator_verification_status
          from public.users u where u.uid = v_uid
        ), 'none') <> 'approved' then
    raise exception 'Professional verification must be approved before the affiliate program can be enabled.';
  end if;

  insert into public.course_commerce_settings
    (course_id, owner_id, affiliate_enabled, affiliate_commission_pct,
     affiliate_approval, tax_collection, tax_regions, tax_registration_id)
  values
    (p_course_id, v_uid, coalesce(p_affiliate_enabled,false), p_affiliate_commission_pct,
     p_affiliate_approval, coalesce(p_tax_collection,false), v_regions, v_registration)
  on conflict (course_id) do update
    set owner_id = excluded.owner_id,
        affiliate_enabled = excluded.affiliate_enabled,
        affiliate_commission_pct = excluded.affiliate_commission_pct,
        affiliate_approval = excluded.affiliate_approval,
        tax_collection = excluded.tax_collection,
        tax_regions = excluded.tax_regions,
        tax_registration_id = excluded.tax_registration_id,
        updated_at = now();

  return jsonb_build_object('success', true);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.users_field_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if public.is_service_role() or public.is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.roles ? 'admin' then
      raise exception 'cannot self-assign admin role';
    end if;
    return new;
  end if;

  -- UPDATE: roles may change only within {student, teacher}, never when the row
  -- already carries an admin grant.
  if new.roles is distinct from old.roles then
    if (old.roles ? 'admin')
       or exists (
         select 1 from jsonb_array_elements_text(new.roles) r
         where r not in ('student', 'teacher')
       ) then
      raise exception 'users: role change not permitted (only student/teacher self-assignment)';
    end if;
  end if;

  -- Stripe/billing/plan columns remain frozen for non-admin, non-service_role.
  if new.stripe_connected_account_id       is distinct from old.stripe_connected_account_id
     or new.stripe_connect_status          is distinct from old.stripe_connect_status
     or new.stripe_connect_charges_enabled is distinct from old.stripe_connect_charges_enabled
     or new.stripe_connect_payouts_enabled is distinct from old.stripe_connect_payouts_enabled
     or new.stripe_connect_updated_at      is distinct from old.stripe_connect_updated_at
     or new.stripe_customer_id             is distinct from old.stripe_customer_id
     or new.current_plan_id                is distinct from old.current_plan_id then
    raise exception 'users: Stripe/billing/plan fields are server-controlled';
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.verify_skillset_certificate(p_code text, p_rate_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_key text;
  v_cert public.certificates%rowtype;
begin
  if v_code = '' or length(v_code) > 80 then
    raise exception 'A valid verification code is required.' using errcode = 'P0001';
  end if;

  v_key := coalesce(
    (select auth.uid())::text,
    nullif(btrim(coalesce(p_rate_key, '')), ''),
    'anon'
  );
  perform public.enforce_rate_limit('cert_verify_' || v_key, 60, 3600000);

  select * into v_cert
  from public.certificates
  where verification_code = v_code and status = 'issued'
  limit 1;

  if not found then
    return jsonb_build_object('valid', false);
  end if;

  return jsonb_build_object(
    'valid', true,
    'certificate', jsonb_build_object(
      'courseTitle', v_cert.course_title,
      'courseCategory', v_cert.course_category,
      'authorityLabel', coalesce(
        nullif(v_cert.authority_label, ''),
        'Skillset Verified'
      ),
      'verificationCode', v_cert.verification_code,
      'issuedAt', to_jsonb(v_cert.issued_at)
    )
  );
end;
$function$
;


-- ############################################################################
-- ## BLOCO 5 : INDEXES (92 nao-constraint)
-- ## fonte: parts/04_indexes.sql
-- ############################################################################

-- Fatia: indexes
-- Origem: catalogo do projeto ijtikldtjvsbtwszokvs, extraido em 2026-07-21
-- Gerado por introspeccao (sem senha do banco / sem pg_dump)
-- pg_indexes em public: 142 indices no total
-- Excluidos por pertencerem a constraint (pg_constraint.conindid, ja no arquivo 03): 50
-- Neste arquivo: 92 indices (inclui parciais, por expressao e UNIQUE nao-constraint)

CREATE INDEX account_action_requests_requested_by_idx ON public.account_action_requests USING btree (requested_by);
CREATE INDEX account_action_requests_status_idx ON public.account_action_requests USING btree (status);
CREATE INDEX account_action_requests_type_idx ON public.account_action_requests USING btree (type);
CREATE INDEX idx_audit_log_action ON public.audit_log USING btree (action);
CREATE INDEX idx_audit_log_actor_id ON public.audit_log USING btree (actor_id);
CREATE INDEX idx_audit_log_created_at ON public.audit_log USING btree (created_at DESC);
CREATE INDEX idx_audit_log_target ON public.audit_log USING btree (target_type, target_id);
CREATE INDEX certificates_course_id_idx ON public.certificates USING btree (course_id);
CREATE INDEX certificates_enrollment_id_idx ON public.certificates USING btree (enrollment_id);
CREATE INDEX certificates_user_id_idx ON public.certificates USING btree (user_id);
CREATE INDEX idx_community_comments_author_id ON public.community_comments USING btree (author_id);
CREATE INDEX idx_community_comments_course_slug ON public.community_comments USING btree (course_slug);
CREATE INDEX idx_community_comments_parent_id ON public.community_comments USING btree (parent_id);
CREATE INDEX idx_community_comments_post_id ON public.community_comments USING btree (post_id);
CREATE INDEX idx_community_post_likes_liker_id ON public.community_post_likes USING btree (liker_id);
CREATE INDEX idx_community_post_likes_post_id ON public.community_post_likes USING btree (post_id);
CREATE INDEX community_posts_author_id_idx ON public.community_posts USING btree (author_id);
CREATE INDEX community_posts_course_slug_idx ON public.community_posts USING btree (course_slug);
CREATE INDEX community_posts_course_slug_pinned_created_idx ON public.community_posts USING btree (course_slug, pinned, created_at DESC);
CREATE INDEX community_reports_course_slug_idx ON public.community_reports USING btree (course_slug);
CREATE INDEX community_reports_post_id_idx ON public.community_reports USING btree (post_id);
CREATE INDEX community_reports_reporter_id_idx ON public.community_reports USING btree (reporter_id);
CREATE INDEX community_reports_status_idx ON public.community_reports USING btree (status);
CREATE INDEX community_reports_target_author_id_idx ON public.community_reports USING btree (target_author_id);
CREATE INDEX idx_course_assets_course_id ON public.course_assets USING btree (course_id);
CREATE INDEX idx_course_assets_course_kind ON public.course_assets USING btree (course_id, kind);
CREATE INDEX idx_course_assets_lesson_id ON public.course_assets USING btree (lesson_id);
CREATE INDEX idx_course_assets_module_id ON public.course_assets USING btree (module_id);
CREATE INDEX idx_course_assets_owner_id ON public.course_assets USING btree (owner_id);
CREATE INDEX course_commerce_settings_owner_idx ON public.course_commerce_settings USING btree (owner_id);
CREATE INDEX course_coproducers_course_idx ON public.course_coproducers USING btree (course_id, created_at);
CREATE UNIQUE INDEX course_coproducers_open_invite_uniq ON public.course_coproducers USING btree (course_id, lower(invitee_email)) WHERE (status = ANY (ARRAY['invited'::text, 'accepted'::text]));
CREATE INDEX course_coproducers_owner_idx ON public.course_coproducers USING btree (owner_id);
CREATE INDEX course_coupon_reservations_active_idx ON public.course_coupon_reservations USING btree (coupon_id, expires_at) WHERE (status = 'reserved'::text);
CREATE INDEX course_coupons_course_created_idx ON public.course_coupons USING btree (course_id, created_at DESC);
CREATE INDEX course_coupons_owner_idx ON public.course_coupons USING btree (owner_id);
CREATE INDEX course_event_rsvps_course_slug_idx ON public.course_event_rsvps USING btree (course_slug);
CREATE INDEX course_event_rsvps_event_id_idx ON public.course_event_rsvps USING btree (event_id);
CREATE INDEX course_event_rsvps_user_id_idx ON public.course_event_rsvps USING btree (user_id);
CREATE INDEX course_events_course_id_idx ON public.course_events USING btree (course_id);
CREATE INDEX course_events_course_slug_idx ON public.course_events USING btree (course_slug);
CREATE INDEX course_events_owner_id_idx ON public.course_events USING btree (owner_id);
CREATE INDEX course_events_slug_status_starts_idx ON public.course_events USING btree (course_slug, status, starts_at);
CREATE INDEX course_lesson_content_course_id_idx ON public.course_lesson_content USING btree (course_id);
CREATE INDEX course_messages_teacher_idx ON public.course_messages USING btree (teacher_id, created_at DESC);
CREATE INDEX course_messages_thread_idx ON public.course_messages USING btree (course_id, student_id, created_at);
CREATE INDEX idx_course_reviews_course_id ON public.course_reviews USING btree (course_id);
CREATE INDEX idx_course_reviews_course_id_status ON public.course_reviews USING btree (course_id, status);
CREATE UNIQUE INDEX course_subscriptions_user_course_blocking_uniq ON public.course_subscriptions USING btree (user_id, course_id) WHERE (status = ANY (ARRAY['active'::text, 'trialing'::text, 'past_due'::text, 'unpaid'::text, 'incomplete'::text, 'paused'::text]));
CREATE INDEX idx_courses_categories_gin ON public.courses USING gin (categories);
CREATE INDEX idx_courses_category ON public.courses USING btree (category);
CREATE INDEX idx_courses_featured_rank ON public.courses USING btree (featured_rank) WHERE featured;
CREATE INDEX idx_courses_owner_id ON public.courses USING btree (owner_id);
CREATE INDEX idx_courses_status ON public.courses USING btree (status);
CREATE INDEX idx_courses_trending_score ON public.courses USING btree (trending_score DESC);
CREATE UNIQUE INDEX uq_courses_title_key ON public.courses USING btree (title_key) WHERE (title_key IS NOT NULL);
CREATE INDEX creator_verification_cases_creator_idx ON public.creator_verification_cases USING btree (creator_id, created_at DESC);
CREATE UNIQUE INDEX creator_verification_cases_open_case_uniq ON public.creator_verification_cases USING btree (creator_id) WHERE (status = ANY (ARRAY['pending'::text, 'needs_changes'::text]));
CREATE INDEX creator_verification_cases_status_idx ON public.creator_verification_cases USING btree (status, created_at);
CREATE INDEX enrollments_course_id_idx ON public.enrollments USING btree (course_id);
CREATE INDEX enrollments_course_slug_idx ON public.enrollments USING btree (course_slug);
CREATE INDEX enrollments_subscription_id_idx ON public.enrollments USING btree (subscription_id) WHERE (subscription_id IS NOT NULL);
CREATE INDEX enrollments_user_id_idx ON public.enrollments USING btree (user_id);
CREATE INDEX learning_path_items_path_idx ON public.learning_path_items USING btree (path_id, "position");
CREATE INDEX lesson_comments_author_id_idx ON public.lesson_comments USING btree (author_id);
CREATE INDEX lesson_comments_course_id_idx ON public.lesson_comments USING btree (course_id);
CREATE INDEX lesson_comments_course_lesson_idx ON public.lesson_comments USING btree (course_id, lesson_id);
CREATE INDEX idx_lesson_progress_enrollment ON public.lesson_progress USING btree (enrollment_id);
CREATE INDEX idx_lesson_progress_user ON public.lesson_progress USING btree (user_id);
CREATE INDEX idx_member_stats_points ON public.member_stats USING btree (points DESC);
CREATE INDEX idx_notifications_user_created ON public.notifications USING btree (user_id, created_at DESC);
CREATE INDEX idx_notifications_user_id ON public.notifications USING btree (user_id);
CREATE INDEX idx_notifications_user_unread ON public.notifications USING btree (user_id) WHERE (read = false);
CREATE INDEX points_events_liker_id_idx ON public.points_events USING btree (liker_id);
CREATE INDEX points_events_post_id_idx ON public.points_events USING btree (post_id);
CREATE INDEX points_events_uid_created_at_idx ON public.points_events USING btree (uid, created_at);
CREATE INDEX product_offers_course_idx ON public.product_offers USING btree (course_id, is_default DESC, created_at DESC);
CREATE UNIQUE INDEX product_offers_one_active_default_uniq ON public.product_offers USING btree (course_id) WHERE ((is_default = true) AND (active = true));
CREATE UNIQUE INDEX product_offers_public_code_uniq ON public.product_offers USING btree (lower(public_code)) WHERE ((public_code IS NOT NULL) AND (public_code <> ''::text));
CREATE INDEX product_prices_offer_idx ON public.product_prices USING btree (offer_id, active DESC);
CREATE INDEX public_profiles_username_idx ON public.public_profiles USING btree (username);
CREATE INDEX idx_support_tickets_category ON public.support_tickets USING btree (category);
CREATE INDEX idx_support_tickets_created_at ON public.support_tickets USING btree (created_at DESC);
CREATE INDEX idx_support_tickets_status ON public.support_tickets USING btree (status);
CREATE INDEX idx_support_tickets_user_id ON public.support_tickets USING btree (user_id);
CREATE INDEX users_current_plan_id_idx ON public.users USING btree (current_plan_id);
CREATE INDEX users_email_idx ON public.users USING btree (email);
CREATE INDEX users_roles_gin_idx ON public.users USING gin (roles);
CREATE INDEX users_stripe_connected_account_id_idx ON public.users USING btree (stripe_connected_account_id);
CREATE INDEX users_stripe_customer_id_idx ON public.users USING btree (stripe_customer_id);
CREATE INDEX wishlists_course_id_idx ON public.wishlists USING btree (course_id);
CREATE INDEX wishlists_user_id_idx ON public.wishlists USING btree (user_id);


-- ############################################################################
-- ## BLOCO 6 : TRIGGERS (15 em public + 1 cross-schema em auth.users)
-- ## fonte: parts/06_triggers.sql
-- ############################################################################

-- Fatia: triggers
-- Origem: catalogo do projeto ijtikldtjvsbtwszokvs, extraido em 2026-07-21
-- Gerado por introspeccao (sem senha do banco / sem pg_dump)
--
-- Contagens apuradas:
--   triggers nao-internos em public ....... 15
--   tabelas com trigger ................... 14 (course_events tem 2)
--   funcoes de trigger distintas .......... 14 (server_write_only e usada por 2 triggers)
--   funcoes de trigger fora do schema public  0  (toda funcao chamada vive em public)
--   triggers FORA de public que chamam public 1  (auth.users -> public.handle_new_user)
--   BEFORE ................................ 14
--   AFTER ................................. 1  (course_event_notify_enrolled)
--   FOR EACH ROW .......................... 15  (nenhum statement-level)
--
-- Mapa tabela -> trigger -> funcao chamada (todas em public):
--   community_comments      -> community_comments_update_guard          -> public.community_comments_update_guard()
--   community_posts         -> community_posts_update_guard             -> public.community_posts_update_guard()
--   community_reports       -> community_reports_update_guard           -> public.community_reports_update_guard()
--   course_event_rsvps      -> course_event_rsvps_update_guard          -> public.course_event_rsvps_update_guard()
--   course_events           -> course_event_notify_enrolled             -> public.notify_enrolled_on_course_event()
--   course_events           -> course_events_teacher_update_guard_trg   -> public.course_events_teacher_update_guard()
--   course_lesson_content   -> prevent_course_lesson_content_course_move-> public.prevent_course_lesson_content_course_move()
--   courses                 -> courses_freeze_privileged_columns_trg    -> public.courses_freeze_privileged_columns()
--   enrollments             -> enrollments_owner_update_guard           -> public.enrollments_owner_update_guard()
--   lesson_comments         -> lesson_comments_update_guard             -> public.lesson_comments_update_guard()
--   notifications           -> trg_notifications_client_read_only       -> public.notifications_client_read_only_guard()
--   payments                -> payments_server_write_only               -> public.server_write_only()
--   payout_ledger           -> payout_ledger_server_write_only          -> public.server_write_only()
--   support_tickets         -> support_tickets_update_guard             -> public.support_tickets_update_guard()
--   users                   -> users_field_guard_biu                    -> public.users_field_guard()
--
-- Verificacao de schema das funcoes: OK na direcao funcao->schema.
-- Toda funcao chamada por trigger foi resolvida via pg_proc.pronamespace e
-- retornou 'public'. Nenhuma aponta para outro schema.
--
-- MAS existe dependencia cross-schema na direcao INVERSA: um trigger FORA de
-- public chama uma funcao de public. Confirmado no catalogo (pg_trigger sobre
-- auth.users -> pg_proc public.handle_new_user):
--   auth.users -> on_auth_user_created -> public.handle_new_user()
-- Ele esta recriado no fim desta fatia. Sem ele, public.handle_new_user fica
-- orfa: signup no Supabase Auth NAO cria a linha em public.users, e a falha e
-- silenciosa (nenhum erro -- so nao acontece).
--
-- Dependencia de replay: este arquivo exige que 05_functions (definicao das
-- funcoes de trigger) e as tabelas ja tenham sido aplicados antes.
--
-- Ordenado por tabela, depois por nome do trigger.

CREATE TRIGGER community_comments_update_guard BEFORE UPDATE ON public.community_comments FOR EACH ROW EXECUTE FUNCTION community_comments_update_guard();

CREATE TRIGGER community_posts_update_guard BEFORE UPDATE ON public.community_posts FOR EACH ROW EXECUTE FUNCTION community_posts_update_guard();

CREATE TRIGGER community_reports_update_guard BEFORE UPDATE ON public.community_reports FOR EACH ROW EXECUTE FUNCTION community_reports_update_guard();

CREATE TRIGGER course_event_rsvps_update_guard BEFORE UPDATE ON public.course_event_rsvps FOR EACH ROW EXECUTE FUNCTION course_event_rsvps_update_guard();

CREATE TRIGGER course_event_notify_enrolled AFTER INSERT ON public.course_events FOR EACH ROW EXECUTE FUNCTION notify_enrolled_on_course_event();

CREATE TRIGGER course_events_teacher_update_guard_trg BEFORE UPDATE ON public.course_events FOR EACH ROW EXECUTE FUNCTION course_events_teacher_update_guard();

CREATE TRIGGER prevent_course_lesson_content_course_move BEFORE UPDATE OF course_id ON public.course_lesson_content FOR EACH ROW EXECUTE FUNCTION prevent_course_lesson_content_course_move();

CREATE TRIGGER courses_freeze_privileged_columns_trg BEFORE UPDATE ON public.courses FOR EACH ROW EXECUTE FUNCTION courses_freeze_privileged_columns();

CREATE TRIGGER enrollments_owner_update_guard BEFORE UPDATE ON public.enrollments FOR EACH ROW EXECUTE FUNCTION enrollments_owner_update_guard();

CREATE TRIGGER lesson_comments_update_guard BEFORE UPDATE ON public.lesson_comments FOR EACH ROW EXECUTE FUNCTION lesson_comments_update_guard();

CREATE TRIGGER trg_notifications_client_read_only BEFORE UPDATE ON public.notifications FOR EACH ROW EXECUTE FUNCTION notifications_client_read_only_guard();

CREATE TRIGGER payments_server_write_only BEFORE INSERT OR DELETE OR UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION server_write_only();

CREATE TRIGGER payout_ledger_server_write_only BEFORE INSERT OR DELETE OR UPDATE ON public.payout_ledger FOR EACH ROW EXECUTE FUNCTION server_write_only();

CREATE TRIGGER support_tickets_update_guard BEFORE UPDATE ON public.support_tickets FOR EACH ROW EXECUTE FUNCTION support_tickets_update_guard();

CREATE TRIGGER users_field_guard_biu BEFORE INSERT OR UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION users_field_guard();


-- ---------------------------------------------------------------------
-- DEPENDENCIA CROSS-SCHEMA (fora de public, mas obrigatoria para o app)
-- ---------------------------------------------------------------------
-- Requer o schema auth (existe em qualquer projeto Supabase; NAO existe num
-- Postgres puro -- nesse alvo, pule este statement e saiba que o fluxo de
-- cadastro nao vai popular public.users).
-- O catalogo remoto traz 'EXECUTE FUNCTION handle_new_user()' sem qualificar;
-- aqui vai qualificado para nao depender do search_path do replay.

drop trigger if exists on_auth_user_created on auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ############################################################################
-- ## BLOCO 7 : ROW LEVEL SECURITY + POLICIES (124)
-- ## fonte: parts/07_rls_policies.sql
-- ############################################################################

-- Fatia: rls
-- Origem: catalogo do projeto ijtikldtjvsbtwszokvs, extraido em 2026-07-21
-- Gerado por introspeccao (sem senha do banco / sem pg_dump)
--
-- Contagens apuradas no catalogo (schema public):
--   tabelas base (relkind='r')............: 45
--   tabelas com RLS ligado................: 45  (100% -- nenhuma tabela de public esta sem RLS)
--   tabelas com FORCE RLS.................: 7
--   policies..............................: 124
--   tabelas com RLS ligado e ZERO policies: 5  (deny-all para roles nao-bypass)
--
-- Deny-all (RLS ON, nenhuma policy) -- material do relatorio de seguranca:
--   1. course_coupon_reservations
--   2. course_title_keys
--   3. platform_config
--   4. processed_stripe_events   (tambem FORCE RLS)
--   5. subscriptions             (tambem FORCE RLS)
-- Observacao: essas tabelas so sao acessiveis via service_role / owner (BYPASSRLS).
-- Se o app espera ler alguma delas com a chave anon/authenticated, isso e um bug latente.
--
-- Tabelas com FORCE RLS (dono da tabela tambem fica sujeito as policies):
--   checkout_locks, course_subscriptions, orders, payments,
--   payout_ledger, processed_stripe_events, subscriptions

-- =====================================================================
-- 1) ENABLE / FORCE ROW LEVEL SECURITY
-- =====================================================================

alter table public.account_action_requests enable row level security;
alter table public.audit_log enable row level security;
alter table public.certificates enable row level security;
alter table public.checkout_locks enable row level security;
alter table public.checkout_locks force row level security;
alter table public.community_comments enable row level security;
alter table public.community_post_likes enable row level security;
alter table public.community_posts enable row level security;
alter table public.community_reports enable row level security;
alter table public.course_assets enable row level security;
alter table public.course_commerce_settings enable row level security;
alter table public.course_coproducers enable row level security;
alter table public.course_coupon_reservations enable row level security;
alter table public.course_coupons enable row level security;
alter table public.course_event_rsvps enable row level security;
alter table public.course_events enable row level security;
alter table public.course_lesson_content enable row level security;
alter table public.course_messages enable row level security;
alter table public.course_reviews enable row level security;
alter table public.course_subscriptions enable row level security;
alter table public.course_subscriptions force row level security;
alter table public.course_title_keys enable row level security;
alter table public.courses enable row level security;
alter table public.creator_verification_cases enable row level security;
alter table public.enrollments enable row level security;
alter table public.leaderboards enable row level security;
alter table public.learning_path_items enable row level security;
alter table public.learning_paths enable row level security;
alter table public.lesson_comments enable row level security;
alter table public.lesson_progress enable row level security;
alter table public.member_stats enable row level security;
alter table public.notifications enable row level security;
alter table public.orders enable row level security;
alter table public.orders force row level security;
alter table public.payments enable row level security;
alter table public.payments force row level security;
alter table public.payout_ledger enable row level security;
alter table public.payout_ledger force row level security;
alter table public.platform_config enable row level security;
alter table public.platform_settings enable row level security;
alter table public.points_events enable row level security;
alter table public.processed_stripe_events enable row level security;
alter table public.processed_stripe_events force row level security;
alter table public.product_offers enable row level security;
alter table public.product_prices enable row level security;
alter table public.public_profiles enable row level security;
alter table public.rate_limits enable row level security;
alter table public.subscriptions enable row level security;
alter table public.subscriptions force row level security;
alter table public.support_tickets enable row level security;
alter table public.users enable row level security;
alter table public.wishlists enable row level security;

-- =====================================================================
-- 2) POLICIES (124) -- ordenadas por tabela, depois por nome da policy
-- =====================================================================

create policy "account_action_requests_delete_admin" on public.account_action_requests as permissive for delete to public
  using (is_admin());

create policy "account_action_requests_select_admin" on public.account_action_requests as permissive for select to public
  using (is_admin());

create policy "account_action_requests_select_self" on public.account_action_requests as permissive for select to public
  using ((requested_by = (( SELECT auth.uid() AS uid))::text));

create policy "account_action_requests_update_admin" on public.account_action_requests as permissive for update to public
  using (is_admin())
  with check (is_admin());

create policy "audit_log_admin_select" on public.audit_log as permissive for select to public
  using (is_admin());

create policy "certificates_select_admin" on public.certificates as permissive for select to authenticated
  using (is_admin());

create policy "certificates_select_owner" on public.certificates as permissive for select to authenticated
  using ((user_id = (( SELECT auth.uid() AS uid))::text));

create policy "checkout_locks_service_access" on public.checkout_locks as permissive for all to service_role
  using (true)
  with check (true);

create policy "community_comments_delete_admin" on public.community_comments as permissive for delete to public
  using (is_admin());

create policy "community_comments_delete_author" on public.community_comments as permissive for delete to public
  using ((author_id = (( SELECT auth.uid() AS uid))::text));

create policy "community_comments_insert_enrolled" on public.community_comments as permissive for insert to public
  with check (((author_id = (( SELECT auth.uid() AS uid))::text) AND has_enrollment_for_course_slug(course_slug) AND (EXISTS ( SELECT 1
   FROM community_posts p
  WHERE ((p.id = community_comments.post_id) AND (p.course_slug = community_comments.course_slug))))));

create policy "community_comments_select_admin" on public.community_comments as permissive for select to public
  using (is_admin());

create policy "community_comments_select_enrolled" on public.community_comments as permissive for select to public
  using (has_enrollment_for_course_slug(course_slug));

create policy "community_comments_update_admin" on public.community_comments as permissive for update to public
  using (is_admin())
  with check (is_admin());

create policy "community_comments_update_author" on public.community_comments as permissive for update to public
  using ((author_id = (( SELECT auth.uid() AS uid))::text))
  with check ((author_id = (( SELECT auth.uid() AS uid))::text));

create policy "community_post_likes_delete_admin" on public.community_post_likes as permissive for delete to public
  using (is_admin());

create policy "community_post_likes_delete_owner" on public.community_post_likes as permissive for delete to public
  using ((liker_id = (( SELECT auth.uid() AS uid))::text));

create policy "community_post_likes_insert_owner" on public.community_post_likes as permissive for insert to public
  with check (((liker_id = (( SELECT auth.uid() AS uid))::text) AND (EXISTS ( SELECT 1
   FROM community_posts p
  WHERE ((p.id = community_post_likes.post_id) AND has_enrollment_for_course_slug(p.course_slug))))));

create policy "community_post_likes_select_admin" on public.community_post_likes as permissive for select to public
  using (is_admin());

create policy "community_post_likes_select_enrolled" on public.community_post_likes as permissive for select to public
  using ((EXISTS ( SELECT 1
   FROM community_posts p
  WHERE ((p.id = community_post_likes.post_id) AND has_enrollment_for_course_slug(p.course_slug)))));

create policy "community_posts_delete_admin" on public.community_posts as permissive for delete to public
  using (is_admin());

create policy "community_posts_delete_author" on public.community_posts as permissive for delete to public
  using ((author_id = (( SELECT auth.uid() AS uid))::text));

create policy "community_posts_insert_enrolled" on public.community_posts as permissive for insert to public
  with check (((author_id = (( SELECT auth.uid() AS uid))::text) AND has_enrollment_for_course_slug(course_slug) AND (COALESCE(pinned, false) = false) AND (EXISTS ( SELECT 1
   FROM courses c
  WHERE (((c.slug = community_posts.course_slug) OR (c.id = community_posts.course_slug)) AND c.community_enabled)))));

create policy "community_posts_select_enrolled" on public.community_posts as permissive for select to public
  using ((is_admin() OR has_enrollment_for_course_slug(course_slug)));

create policy "community_posts_update_admin" on public.community_posts as permissive for update to public
  using (is_admin())
  with check (is_admin());

create policy "community_posts_update_author" on public.community_posts as permissive for update to public
  using ((author_id = (( SELECT auth.uid() AS uid))::text))
  with check ((author_id = (( SELECT auth.uid() AS uid))::text));

create policy "community_posts_update_course_teacher" on public.community_posts as permissive for update to public
  using ((is_teacher() AND (EXISTS ( SELECT 1
   FROM courses c
  WHERE ((c.slug = community_posts.course_slug) AND (c.owner_id = (( SELECT auth.uid() AS uid))::text))))))
  with check ((is_teacher() AND (EXISTS ( SELECT 1
   FROM courses c
  WHERE ((c.slug = community_posts.course_slug) AND (c.owner_id = (( SELECT auth.uid() AS uid))::text))))));

create policy "community_reports_delete_admin" on public.community_reports as permissive for delete to public
  using (is_admin());

create policy "community_reports_insert_reporter" on public.community_reports as permissive for insert to public
  with check (((( SELECT auth.uid() AS uid) IS NOT NULL) AND (reporter_id = (( SELECT auth.uid() AS uid))::text) AND (status = 'open'::text) AND (post_id IS NOT NULL) AND (target_type IS NOT NULL) AND has_enrollment_for_course_slug(course_slug) AND (NOT is_target_author(target_type, post_id))));

create policy "community_reports_select_admin" on public.community_reports as permissive for select to public
  using ((is_admin() OR is_support() OR is_moderator()));

create policy "community_reports_select_reporter" on public.community_reports as permissive for select to public
  using ((reporter_id = (( SELECT auth.uid() AS uid))::text));

create policy "community_reports_update_trust" on public.community_reports as permissive for update to public
  using ((is_support() OR is_moderator() OR is_admin()))
  with check ((is_support() OR is_moderator() OR is_admin()));

create policy "course_assets_delete_admin" on public.course_assets as permissive for delete to public
  using (is_admin());

create policy "course_assets_delete_owner" on public.course_assets as permissive for delete to public
  using ((EXISTS ( SELECT 1
   FROM courses c
  WHERE ((c.id = course_assets.course_id) AND (c.owner_id = (( SELECT auth.uid() AS uid))::text)))));

create policy "course_assets_insert" on public.course_assets as permissive for insert to public
  with check (((owner_id = (( SELECT auth.uid() AS uid))::text) AND (EXISTS ( SELECT 1
   FROM courses c
  WHERE ((c.id = course_assets.course_id) AND (c.owner_id = (( SELECT auth.uid() AS uid))::text) AND (c.status = ANY (ARRAY['draft'::text, 'needs_changes'::text, 'published'::text, 'inactive'::text])))))));

create policy "course_assets_select" on public.course_assets as permissive for select to public
  using ((is_admin() OR (EXISTS ( SELECT 1
   FROM courses c
  WHERE ((c.id = course_assets.course_id) AND (c.owner_id = (( SELECT auth.uid() AS uid))::text)))) OR (EXISTS ( SELECT 1
   FROM enrollments e
  WHERE ((e.course_id = course_assets.course_id) AND (e.user_id = (( SELECT auth.uid() AS uid))::text) AND (e.status = ANY (ARRAY['active'::text, 'completed'::text])))))));

create policy "course_assets_update_admin" on public.course_assets as permissive for update to public
  using (is_admin())
  with check (is_admin());

create policy "course_assets_update_owner" on public.course_assets as permissive for update to public
  using ((EXISTS ( SELECT 1
   FROM courses c
  WHERE ((c.id = course_assets.course_id) AND (c.owner_id = (( SELECT auth.uid() AS uid))::text)))))
  with check ((EXISTS ( SELECT 1
   FROM courses c
  WHERE ((c.id = course_assets.course_id) AND (c.owner_id = (( SELECT auth.uid() AS uid))::text)))));

create policy "course_commerce_settings_owner_read" on public.course_commerce_settings as permissive for select to authenticated
  using (((owner_id = (( SELECT auth.uid() AS uid))::text) OR is_ops() OR is_admin()));

create policy "course_coproducers_owner_read" on public.course_coproducers as permissive for select to authenticated
  using (((owner_id = (( SELECT auth.uid() AS uid))::text) OR is_ops() OR is_admin()));

create policy "course_coupons_owner_read" on public.course_coupons as permissive for select to authenticated
  using (((owner_id = (( SELECT auth.uid() AS uid))::text) OR is_ops() OR is_admin()));

create policy "course_event_rsvps_delete_admin" on public.course_event_rsvps as permissive for delete to public
  using (is_admin());

create policy "course_event_rsvps_delete_owner" on public.course_event_rsvps as permissive for delete to public
  using ((uid = (( SELECT auth.uid() AS uid))::text));

create policy "course_event_rsvps_insert_owner" on public.course_event_rsvps as permissive for insert to public
  with check (((uid = (( SELECT auth.uid() AS uid))::text) AND (EXISTS ( SELECT 1
   FROM course_events ev
  WHERE ((ev.id = course_event_rsvps.event_id) AND (ev.status = 'scheduled'::text)))) AND has_enrollment_for_course_slug(course_slug)));

create policy "course_event_rsvps_select_admin" on public.course_event_rsvps as permissive for select to public
  using (is_admin());

create policy "course_event_rsvps_select_event_owner" on public.course_event_rsvps as permissive for select to public
  using ((EXISTS ( SELECT 1
   FROM course_events ev
  WHERE ((ev.id = course_event_rsvps.event_id) AND (ev.owner_id = (( SELECT auth.uid() AS uid))::text)))));

create policy "course_event_rsvps_select_owner" on public.course_event_rsvps as permissive for select to public
  using ((uid = (( SELECT auth.uid() AS uid))::text));

create policy "course_event_rsvps_update_owner" on public.course_event_rsvps as permissive for update to public
  using (((uid = (( SELECT auth.uid() AS uid))::text) AND (EXISTS ( SELECT 1
   FROM course_events ev
  WHERE ((ev.id = course_event_rsvps.event_id) AND (ev.status = 'scheduled'::text)))) AND has_enrollment_for_course_slug(course_slug)))
  with check (((uid = (( SELECT auth.uid() AS uid))::text) AND (EXISTS ( SELECT 1
   FROM course_events ev
  WHERE ((ev.id = course_event_rsvps.event_id) AND (ev.status = 'scheduled'::text)))) AND has_enrollment_for_course_slug(course_slug)));

create policy "course_events_delete_admin" on public.course_events as permissive for delete to public
  using (is_admin());

create policy "course_events_delete_teacher" on public.course_events as permissive for delete to public
  using ((is_teacher() AND (owner_id = (( SELECT auth.uid() AS uid))::text)));

create policy "course_events_insert_admin" on public.course_events as permissive for insert to public
  with check (is_admin());

create policy "course_events_insert_teacher" on public.course_events as permissive for insert to public
  with check ((is_teacher() AND (owner_id = (( SELECT auth.uid() AS uid))::text) AND (status = 'scheduled'::text) AND (recording_asset_id IS NULL) AND (EXISTS ( SELECT 1
   FROM courses c
  WHERE ((c.id = course_events.course_id) AND (c.owner_id = (( SELECT auth.uid() AS uid))::text))))));

create policy "course_events_select_admin" on public.course_events as permissive for select to public
  using (is_admin());

create policy "course_events_select_enrolled" on public.course_events as permissive for select to public
  using (has_enrollment_for_course_slug(course_slug));

create policy "course_events_select_owner" on public.course_events as permissive for select to public
  using ((owner_id = (( SELECT auth.uid() AS uid))::text));

create policy "course_events_update_admin" on public.course_events as permissive for update to public
  using (is_admin())
  with check (is_admin());

create policy "course_events_update_teacher" on public.course_events as permissive for update to public
  using ((is_teacher() AND (owner_id = (( SELECT auth.uid() AS uid))::text) AND (EXISTS ( SELECT 1
   FROM courses c
  WHERE ((c.id = course_events.course_id) AND (c.owner_id = (( SELECT auth.uid() AS uid))::text))))))
  with check ((is_teacher() AND (owner_id = (( SELECT auth.uid() AS uid))::text) AND (EXISTS ( SELECT 1
   FROM courses c
  WHERE ((c.id = course_events.course_id) AND (c.owner_id = (( SELECT auth.uid() AS uid))::text))))));

create policy "course_lesson_content_delete" on public.course_lesson_content as permissive for delete to public
  using ((is_admin() OR (EXISTS ( SELECT 1
   FROM courses c
  WHERE ((c.id = course_lesson_content.course_id) AND (c.owner_id = (( SELECT auth.uid() AS uid))::text))))));

create policy "course_lesson_content_insert_owner" on public.course_lesson_content as permissive for insert to public
  with check ((EXISTS ( SELECT 1
   FROM courses c
  WHERE ((c.id = course_lesson_content.course_id) AND (c.owner_id = (( SELECT auth.uid() AS uid))::text)))));

create policy "course_lesson_content_select" on public.course_lesson_content as permissive for select to public
  using ((is_admin() OR (EXISTS ( SELECT 1
   FROM courses c
  WHERE ((c.id = course_lesson_content.course_id) AND (c.owner_id = (( SELECT auth.uid() AS uid))::text)))) OR (EXISTS ( SELECT 1
   FROM enrollments e
  WHERE ((e.course_id = course_lesson_content.course_id) AND (e.user_id = (( SELECT auth.uid() AS uid))::text))))));

create policy "course_lesson_content_update_owner" on public.course_lesson_content as permissive for update to public
  using ((is_admin() OR (EXISTS ( SELECT 1
   FROM courses c
  WHERE ((c.id = course_lesson_content.course_id) AND (c.owner_id = (( SELECT auth.uid() AS uid))::text))))))
  with check ((is_admin() OR (EXISTS ( SELECT 1
   FROM courses c
  WHERE ((c.id = course_lesson_content.course_id) AND (c.owner_id = (( SELECT auth.uid() AS uid))::text))))));

create policy "course_messages_select" on public.course_messages as permissive for select to public
  using ((is_admin() OR (student_id = (( SELECT auth.uid() AS uid))::text) OR (teacher_id = (( SELECT auth.uid() AS uid))::text)));

create policy "course_reviews_select" on public.course_reviews as permissive for select to public
  using ((is_admin() OR (EXISTS ( SELECT 1
   FROM courses c
  WHERE ((c.id = course_reviews.course_id) AND (c.status = ANY (ARRAY['published'::text, 'in_review'::text]))))) OR ((( SELECT auth.uid() AS uid) IS NOT NULL) AND ((id = ((course_id || '__'::text) || (( SELECT auth.uid() AS uid))::text)) OR (EXISTS ( SELECT 1
   FROM courses c
  WHERE ((c.id = course_reviews.course_id) AND (c.owner_id = (( SELECT auth.uid() AS uid))::text)))) OR (EXISTS ( SELECT 1
   FROM enrollments e
  WHERE ((e.course_id = course_reviews.course_id) AND (e.user_id = (( SELECT auth.uid() AS uid))::text))))))));

create policy "course_subscriptions_owner_sel" on public.course_subscriptions as permissive for select to public
  using (((user_id = (( SELECT auth.uid() AS uid))::text) OR is_admin()));

create policy "courses_delete_admin" on public.courses as permissive for delete to public
  using (is_admin());

create policy "courses_delete_owner" on public.courses as permissive for delete to public
  using (((owner_id = (( SELECT auth.uid() AS uid))::text) AND (status = ANY (ARRAY['draft'::text, 'needs_changes'::text, 'inactive'::text]))));

create policy "courses_insert_owner" on public.courses as permissive for insert to public
  with check (((owner_id = (( SELECT auth.uid() AS uid))::text) AND (status = 'draft'::text) AND is_teacher() AND (is_admin() OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.uid = (( SELECT auth.uid() AS uid))::text) AND (u.teacher_terms_accepted_at IS NOT NULL) AND (u.teacher_terms_version IS NOT NULL)))))));

create policy "courses_select_admin" on public.courses as permissive for select to public
  using (is_admin());

create policy "courses_select_enrolled" on public.courses as permissive for select to public
  using (has_enrollment_for_course_slug(slug));

create policy "courses_select_owner" on public.courses as permissive for select to public
  using ((owner_id = (( SELECT auth.uid() AS uid))::text));

create policy "courses_select_public" on public.courses as permissive for select to public
  using ((status = ANY (ARRAY['published'::text, 'in_review'::text])));

create policy "courses_update_admin" on public.courses as permissive for update to public
  using (is_admin())
  with check (is_admin());

create policy "courses_update_ops" on public.courses as permissive for update to public
  using (is_ops())
  with check (is_ops());

create policy "courses_update_owner" on public.courses as permissive for update to public
  using ((owner_id = (( SELECT auth.uid() AS uid))::text))
  with check ((owner_id = (( SELECT auth.uid() AS uid))::text));

create policy "creator_verification_cases_owner_read" on public.creator_verification_cases as permissive for select to authenticated
  using (((creator_id = (( SELECT auth.uid() AS uid))::text) OR is_ops() OR is_admin()));

create policy "enrollments_delete_admin" on public.enrollments as permissive for delete to public
  using (is_admin());

create policy "enrollments_insert_admin" on public.enrollments as permissive for insert to public
  with check (is_admin());

create policy "enrollments_select_admin" on public.enrollments as permissive for select to public
  using (is_admin());

create policy "enrollments_select_owner" on public.enrollments as permissive for select to public
  using ((user_id = (( SELECT auth.uid() AS uid))::text));

create policy "enrollments_update_admin" on public.enrollments as permissive for update to public
  using (is_admin())
  with check (is_admin());

create policy "enrollments_update_owner" on public.enrollments as permissive for update to public
  using ((user_id = (( SELECT auth.uid() AS uid))::text))
  with check ((user_id = (( SELECT auth.uid() AS uid))::text));

create policy "leaderboards_select_authenticated" on public.leaderboards as permissive for select to authenticated
  using (true);

create policy "learning_path_items_admin_delete" on public.learning_path_items as permissive for delete to public
  using (is_admin());

create policy "learning_path_items_admin_insert" on public.learning_path_items as permissive for insert to public
  with check (is_admin());

create policy "learning_path_items_admin_update" on public.learning_path_items as permissive for update to public
  using (is_admin());

create policy "learning_path_items_select" on public.learning_path_items as permissive for select to public
  using ((is_admin() OR (EXISTS ( SELECT 1
   FROM learning_paths p
  WHERE ((p.id = learning_path_items.path_id) AND (p.status = 'published'::text))))));

create policy "learning_paths_admin_delete" on public.learning_paths as permissive for delete to public
  using (is_admin());

create policy "learning_paths_admin_insert" on public.learning_paths as permissive for insert to public
  with check (is_admin());

create policy "learning_paths_admin_update" on public.learning_paths as permissive for update to public
  using (is_admin());

create policy "learning_paths_select" on public.learning_paths as permissive for select to public
  using (((status = 'published'::text) OR is_admin()));

create policy "lesson_comments_delete" on public.lesson_comments as permissive for delete to public
  using ((is_admin() OR (author_id = (( SELECT auth.uid() AS uid))::text)));

create policy "lesson_comments_insert" on public.lesson_comments as permissive for insert to public
  with check (((( SELECT auth.uid() AS uid) IS NOT NULL) AND (author_id = (( SELECT auth.uid() AS uid))::text) AND (EXISTS ( SELECT 1
   FROM enrollments e
  WHERE ((e.course_id = lesson_comments.course_id) AND (e.user_id = (( SELECT auth.uid() AS uid))::text))))));

create policy "lesson_comments_select" on public.lesson_comments as permissive for select to public
  using ((is_admin() OR (EXISTS ( SELECT 1
   FROM courses c
  WHERE ((c.id = lesson_comments.course_id) AND (c.owner_id = (( SELECT auth.uid() AS uid))::text)))) OR (EXISTS ( SELECT 1
   FROM enrollments e
  WHERE ((e.course_id = lesson_comments.course_id) AND (e.user_id = (( SELECT auth.uid() AS uid))::text))))));

create policy "lesson_comments_update" on public.lesson_comments as permissive for update to public
  using ((is_admin() OR (author_id = (( SELECT auth.uid() AS uid))::text)))
  with check ((is_admin() OR (author_id = (( SELECT auth.uid() AS uid))::text)));

create policy "lesson_progress_select_admin" on public.lesson_progress as permissive for select to public
  using (is_admin());

create policy "lesson_progress_select_owner" on public.lesson_progress as permissive for select to public
  using ((enrollment_id IN ( SELECT e.id
   FROM enrollments e
  WHERE (e.user_id = (( SELECT auth.uid() AS uid))::text))));

create policy "member_stats_select_authenticated" on public.member_stats as permissive for select to authenticated
  using (true);

create policy "notifications_select_owner" on public.notifications as permissive for select to public
  using (((user_id = (( SELECT auth.uid() AS uid))::text) OR is_admin()));

create policy "notifications_update_owner" on public.notifications as permissive for update to public
  using ((user_id = (( SELECT auth.uid() AS uid))::text))
  with check ((user_id = (( SELECT auth.uid() AS uid))::text));

create policy "orders_owner_sel" on public.orders as permissive for select to public
  using (((user_id = (( SELECT auth.uid() AS uid))::text) OR is_admin()));

create policy "payments_owner_sel" on public.payments as permissive for select to public
  using (((user_id = (( SELECT auth.uid() AS uid))::text) OR is_admin()));

create policy "payout_ledger_owner_sel" on public.payout_ledger as permissive for select to public
  using (((teacher_id = (( SELECT auth.uid() AS uid))::text) OR is_admin()));

create policy "payout_ledger_service_write" on public.payout_ledger as permissive for all to service_role
  using (true)
  with check (true);

create policy "payout_ledger_teacher_read" on public.payout_ledger as permissive for select to authenticated
  using ((teacher_id = (( SELECT auth.uid() AS uid))::text));

create policy "platform_settings_read" on public.platform_settings as permissive for select to authenticated
  using (true);

create policy "points_events_select_admin" on public.points_events as permissive for select to authenticated
  using (is_admin());

create policy "product_offers_public_read" on public.product_offers as permissive for select to anon, authenticated
  using ((active = true));

create policy "product_prices_public_read" on public.product_prices as permissive for select to anon, authenticated
  using ((active = true));

create policy "public_profiles_select_public" on public.public_profiles as permissive for select to anon, authenticated
  using (true);

create policy "rate_limits_service_access" on public.rate_limits as permissive for all to service_role
  using (true)
  with check (true);

create policy "support_tickets_delete_admin" on public.support_tickets as permissive for delete to public
  using (is_admin());

create policy "support_tickets_insert_owner" on public.support_tickets as permissive for insert to public
  with check (((( SELECT auth.uid() AS uid) IS NOT NULL) AND (user_id = (( SELECT auth.uid() AS uid))::text) AND (status = 'open'::text) AND (admin_response IS NULL) AND (responded_by IS NULL) AND (responded_at IS NULL)));

create policy "support_tickets_select_owner" on public.support_tickets as permissive for select to public
  using ((user_id = (( SELECT auth.uid() AS uid))::text));

create policy "support_tickets_select_support" on public.support_tickets as permissive for select to public
  using (is_support());

create policy "support_tickets_update_support" on public.support_tickets as permissive for update to public
  using (is_support())
  with check (is_support());

create policy "users_insert_self" on public.users as permissive for insert to public
  with check ((uid = (( SELECT auth.uid() AS uid))::text));

create policy "users_select_admin" on public.users as permissive for select to public
  using (is_admin());

create policy "users_select_self" on public.users as permissive for select to public
  using ((uid = (( SELECT auth.uid() AS uid))::text));

create policy "users_update_self" on public.users as permissive for update to public
  using ((uid = (( SELECT auth.uid() AS uid))::text))
  with check ((uid = (( SELECT auth.uid() AS uid))::text));

create policy "wishlists_delete_admin" on public.wishlists as permissive for delete to public
  using (is_admin());

create policy "wishlists_delete_owner" on public.wishlists as permissive for delete to public
  using (((( SELECT auth.uid() AS uid))::text = user_id));

create policy "wishlists_insert_owner" on public.wishlists as permissive for insert to public
  with check (((( SELECT auth.uid() AS uid) IS NOT NULL) AND ((( SELECT auth.uid() AS uid))::text = user_id) AND (id = ((user_id || '__'::text) || course_id))));

create policy "wishlists_select_admin" on public.wishlists as permissive for select to public
  using (is_admin());

create policy "wishlists_select_owner" on public.wishlists as permissive for select to public
  using (((( SELECT auth.uid() AS uid))::text = user_id));

-- fim da fatia rls


-- ############################################################################
-- ## BLOCO 7B : RLS DE storage.objects (10 policies, cross-schema)
-- ## fonte: parts/09_storage_rls.sql
-- ############################################################################

-- Fatia: storage rls (cross-schema)
-- Origem: catalogo do projeto ijtikldtjvsbtwszokvs, extraido em 2026-07-21
-- Gerado por introspeccao (pg_policy + pg_get_expr), sem senha do banco / sem pg_dump
--
-- POR QUE ESTA FATIA EXISTE
-- -------------------------
-- O baseline anterior afirmava que "as policies RLS de storage.objects ficam na
-- fatia de RLS". Era falso: a fatia 07 e 100% schema public (45 tabelas, 124
-- policies). As 10 policies autorais de storage.objects nao estavam em lugar
-- nenhum -- um projeto reconstruido ficava com os dois buckets sem NENHUMA regra
-- autoral de acesso (upload e consumo de midia / conteudo de curso quebram).
--
-- Contagens apuradas (pg_policy where schemaname='storage'):
--   policies em storage.objects .......... 10
--   buckets cobertos ..................... 2  (course-content, public-media)
--   policies em storage.buckets .......... 0
--
--   bucket          | policies
--   ----------------+-------------------------------------------------------
--   course-content  | course_content_select, course_content_insert_owner,
--                   | course_content_update_owner, course_content_delete
--   public-media    | public_media_select_owner, public_media_insert_user_self,
--                   | public_media_insert_course_owner, public_media_update_user_self,
--                   | public_media_update_course_owner, public_media_delete
--
-- PRE-REQUISITOS
-- --------------
--  - Schema "storage" com storage.objects e storage.foldername() -- existe em
--    qualquer projeto Supabase; NAO existe num Postgres puro. Nesse alvo, pule
--    esta fatia inteira (e saiba que nao havera regra de storage).
--  - Os buckets 'course-content' e 'public-media' devem existir (bloco 8, secao
--    7 -- STORAGE BUCKETS traz o insert idempotente).
--  - public.is_admin(), public.courses e public.enrollments ja aplicados
--    (blocos 2 e 4).
--  - RLS ja vem habilitado em storage.objects pela plataforma Supabase; por isso
--    nao ha "alter table ... enable row level security" aqui.
--
-- Nota de fidelidade: o catalogo devolve as referencias sem qualificar
-- (courses, enrollments, is_admin). Aqui elas vao qualificadas com "public."
-- para nao depender do search_path do replay -- e exatamente para onde os OIDs
-- do catalogo remoto resolvem.
--
-- Ordenado por bucket, depois por nome da policy.

-- ---------------------------------------------------------------------
-- bucket: course-content (privado)
-- ---------------------------------------------------------------------

create policy course_content_select on storage.objects
  as permissive for select to authenticated
  using (
    (bucket_id = 'course-content'::text)
    AND (
      public.is_admin()
      OR (EXISTS ( SELECT 1
             FROM public.courses c
            WHERE ((c.id = (storage.foldername(objects.name))[2])
              AND (c.owner_id = ((SELECT auth.uid() AS uid))::text))))
      OR (EXISTS ( SELECT 1
             FROM public.enrollments e
            WHERE ((e.course_id = (storage.foldername(objects.name))[2])
              AND (e.user_id = ((SELECT auth.uid() AS uid))::text)
              AND (e.status = ANY (ARRAY['active'::text, 'completed'::text])))))
    )
  );

create policy course_content_insert_owner on storage.objects
  as permissive for insert to authenticated
  with check (
    (bucket_id = 'course-content'::text)
    AND (EXISTS ( SELECT 1
           FROM public.courses c
          WHERE ((c.id = (storage.foldername(objects.name))[2])
            AND (c.owner_id = ((SELECT auth.uid() AS uid))::text))))
  );

create policy course_content_update_owner on storage.objects
  as permissive for update to authenticated
  using (
    (bucket_id = 'course-content'::text)
    AND (EXISTS ( SELECT 1
           FROM public.courses c
          WHERE ((c.id = (storage.foldername(objects.name))[2])
            AND (c.owner_id = ((SELECT auth.uid() AS uid))::text))))
  )
  with check (
    (bucket_id = 'course-content'::text)
    AND (EXISTS ( SELECT 1
           FROM public.courses c
          WHERE ((c.id = (storage.foldername(objects.name))[2])
            AND (c.owner_id = ((SELECT auth.uid() AS uid))::text))))
  );

create policy course_content_delete on storage.objects
  as permissive for delete to authenticated
  using (
    (bucket_id = 'course-content'::text)
    AND (
      public.is_admin()
      OR (EXISTS ( SELECT 1
             FROM public.courses c
            WHERE ((c.id = (storage.foldername(objects.name))[2])
              AND (c.owner_id = ((SELECT auth.uid() AS uid))::text))))
    )
  );

-- ---------------------------------------------------------------------
-- bucket: public-media (publico para leitura via CDN; escrita restrita)
-- ---------------------------------------------------------------------

create policy public_media_select_owner on storage.objects
  as permissive for select to authenticated
  using (
    (bucket_id = 'public-media'::text)
    AND (
      public.is_admin()
      OR (((storage.foldername(name))[1] = 'users'::text)
          AND ((storage.foldername(name))[2] = ((SELECT auth.uid() AS uid))::text))
      OR (((storage.foldername(name))[1] = 'courses'::text)
          AND (EXISTS ( SELECT 1
                 FROM public.courses course_row
                WHERE ((course_row.id = (storage.foldername(objects.name))[2])
                  AND (course_row.owner_id = ((SELECT auth.uid() AS uid))::text)))))
    )
  );

create policy public_media_insert_user_self on storage.objects
  as permissive for insert to authenticated
  with check (
    (bucket_id = 'public-media'::text)
    AND ((storage.foldername(name))[1] = 'users'::text)
    AND ((storage.foldername(name))[2] = ((SELECT auth.uid() AS uid))::text)
  );

create policy public_media_insert_course_owner on storage.objects
  as permissive for insert to authenticated
  with check (
    (bucket_id = 'public-media'::text)
    AND ((storage.foldername(name))[1] = 'courses'::text)
    AND (EXISTS ( SELECT 1
           FROM public.courses c
          WHERE ((c.id = (storage.foldername(objects.name))[2])
            AND (c.owner_id = ((SELECT auth.uid() AS uid))::text))))
  );

create policy public_media_update_user_self on storage.objects
  as permissive for update to authenticated
  using (
    (bucket_id = 'public-media'::text)
    AND ((storage.foldername(name))[1] = 'users'::text)
    AND ((storage.foldername(name))[2] = ((SELECT auth.uid() AS uid))::text)
  )
  with check (
    (bucket_id = 'public-media'::text)
    AND ((storage.foldername(name))[1] = 'users'::text)
    AND ((storage.foldername(name))[2] = ((SELECT auth.uid() AS uid))::text)
  );

create policy public_media_update_course_owner on storage.objects
  as permissive for update to authenticated
  using (
    (bucket_id = 'public-media'::text)
    AND ((storage.foldername(name))[1] = 'courses'::text)
    AND (EXISTS ( SELECT 1
           FROM public.courses c
          WHERE ((c.id = (storage.foldername(objects.name))[2])
            AND (c.owner_id = ((SELECT auth.uid() AS uid))::text))))
  )
  with check (
    (bucket_id = 'public-media'::text)
    AND ((storage.foldername(name))[1] = 'courses'::text)
    AND (EXISTS ( SELECT 1
           FROM public.courses c
          WHERE ((c.id = (storage.foldername(objects.name))[2])
            AND (c.owner_id = ((SELECT auth.uid() AS uid))::text))))
  );

create policy public_media_delete on storage.objects
  as permissive for delete to authenticated
  using (
    (bucket_id = 'public-media'::text)
    AND (
      public.is_admin()
      OR (((storage.foldername(name))[1] = 'users'::text)
          AND ((storage.foldername(name))[2] = ((SELECT auth.uid() AS uid))::text))
      OR (((storage.foldername(name))[1] = 'courses'::text)
          AND (EXISTS ( SELECT 1
                 FROM public.courses c
                WHERE ((c.id = (storage.foldername(objects.name))[2])
                  AND (c.owner_id = ((SELECT auth.uid() AS uid))::text)))))
    )
  );

-- Fim da fatia: storage rls


-- ############################################################################
-- ## BLOCO 8 : GRANTS / PUBLICATIONS / MISC
-- ## fonte: parts/08_grants_publications_misc.sql
-- ############################################################################

-- Fatia: grants
-- Origem: catalogo do projeto ijtikldtjvsbtwszokvs, extraido em 2026-07-21
-- Gerado por introspeccao (sem senha do banco / sem pg_dump)
--
-- Contagens apuradas:
--   schema public: 45 tabelas base, 0 sequences, 0 views, 0 matviews, 59 funcoes
--   column-level grants em public: 0 (nenhum)
--   tabelas com GRANT ALL para anon+authenticated+postgres+service_role: 37
--   tabelas restritas (sem escrita para anon/authenticated): 8
--   funcoes com EXECUTE revogado de PUBLIC: 54 de 59
--   funcoes com EXECUTE para anon: 11 | para authenticated: 34 | postgres/service_role: 59
--   default privileges (pg_default_acl) relevantes a public: 3 (role postgres) + 3 (supabase_admin, nao replicavel)
--   publications: 2 (supabase_realtime = 8 tabelas de public;
--                    supabase_realtime_messages_publication = 7 particoes de realtime.messages_*)
--   storage.buckets: 2 (course-content privado, public-media publico)
--
-- Ordem de replay: rodar DEPOIS das tabelas, funcoes e triggers.
-- Aviso PG17: o privilegio MAINTAIN so existe em PostgreSQL 17+.
--   "GRANT ALL ON TABLE" ja o inclui automaticamente; as listas explicitas abaixo
--   mencionam MAINTAIN e falham em PG16 ou anterior (remover o token nesse caso).


-- ============================================================================
-- 1. SCHEMA USAGE
-- ============================================================================
-- ACL observado em pg_namespace: {pg_database_owner=UC, PUBLIC=U, postgres=U,
--                                 anon=U, authenticated=U, service_role=U}
-- (pg_database_owner=UC e PUBLIC=U sao o default do PG15+, nao precisam replay)

GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;


-- ============================================================================
-- 2. DEFAULT PRIVILEGES (pg_default_acl)
-- ============================================================================
-- Objetos futuros criados pela role postgres no schema public.

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO postgres, anon, authenticated, service_role;

-- Tambem existem no catalogo, mas pertencem a roles internas da Supabase e sao
-- recriados automaticamente pela plataforma. NAO executar:
--   ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
--     GRANT ALL ON TABLES/SEQUENCES TO postgres, anon, authenticated, service_role;
--   ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
--     GRANT EXECUTE ON FUNCTIONS TO postgres, anon, authenticated, service_role;
--   (idem para os schemas storage, graphql, graphql_public, realtime, cron,
--    extensions e auth — fora do escopo deste baseline)


-- ============================================================================
-- 3. TABLE GRANTS -- public (45 tabelas)
-- ============================================================================
-- 3a. Acesso completo para as 4 roles (37 tabelas).
--     A protecao real dessas tabelas vem das policies RLS, nao dos GRANTs.

GRANT ALL ON TABLE public.account_action_requests TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.audit_log TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.certificates TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.community_comments TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.community_post_likes TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.community_posts TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.community_reports TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.course_assets TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.course_commerce_settings TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.course_coproducers TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.course_coupon_reservations TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.course_coupons TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.course_event_rsvps TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.course_events TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.course_lesson_content TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.course_messages TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.course_reviews TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.course_title_keys TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.courses TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.creator_verification_cases TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.enrollments TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.leaderboards TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.learning_path_items TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.learning_paths TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.lesson_comments TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.lesson_progress TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.member_stats TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.notifications TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.platform_config TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.platform_settings TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.points_events TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.product_offers TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.product_prices TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.public_profiles TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.support_tickets TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.users TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.wishlists TO postgres, anon, authenticated, service_role;

-- 3b. Tabelas restritas (8) -- server-write-only / dinheiro / infraestrutura.
--     anon e authenticated NAO tem INSERT/UPDATE/DELETE aqui por design.

-- Sem qualquer grant para anon/authenticated (4 tabelas):
GRANT ALL ON TABLE public.checkout_locks TO postgres, service_role;
GRANT ALL ON TABLE public.processed_stripe_events TO postgres, service_role;
GRANT ALL ON TABLE public.rate_limits TO postgres, service_role;
GRANT ALL ON TABLE public.subscriptions TO postgres, service_role;

-- Leitura (sem escrita) para anon/authenticated (3 tabelas):
GRANT ALL ON TABLE public.course_subscriptions TO postgres, service_role;
GRANT SELECT, REFERENCES, TRIGGER, TRUNCATE, MAINTAIN ON TABLE public.course_subscriptions TO anon, authenticated;

GRANT ALL ON TABLE public.orders TO postgres, service_role;
GRANT SELECT, REFERENCES, TRIGGER, TRUNCATE, MAINTAIN ON TABLE public.orders TO anon, authenticated;

GRANT ALL ON TABLE public.payments TO postgres, service_role;
GRANT SELECT, REFERENCES, TRIGGER, TRUNCATE, MAINTAIN ON TABLE public.payments TO anon, authenticated;

-- Apenas SELECT para authenticated, nada para anon (1 tabela):
GRANT ALL ON TABLE public.payout_ledger TO postgres, service_role;
GRANT SELECT ON TABLE public.payout_ledger TO authenticated;


-- ============================================================================
-- 4. SEQUENCES -- public
-- ============================================================================
-- Nenhuma sequence em public (todas as PKs sao uuid/text). Nada a fazer.


-- ============================================================================
-- 5. FUNCTION GRANTS -- public (59 funcoes)
-- ============================================================================
-- 5a. REVOKE de PUBLIC (54 funcoes). O PostgreSQL concede EXECUTE a PUBLIC por
--     default na criacao; estas tiveram esse default removido.

REVOKE ALL ON FUNCTION public.assert_course_owner(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_checkout_lock(text,text,text,text,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_payout_transfer_reversal(text,text,numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.community_comments_update_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.community_posts_update_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.community_reports_update_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_payout_transfer_reversal(text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.course_event_rsvps_update_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.course_events_teacher_update_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.courses_freeze_privileged_columns() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_course_coupon(text,text,integer,integer,timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_free_course_enrollment(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_product_offer_atomic(text,text,text,text,text,numeric,text,text,boolean,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_teacher_course_draft(text,text,text,text[],text,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_teacher_course_draft(text,text,text,text[],text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_course_as_admin(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_course_coupon(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_teacher_course_draft(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_rate_limit(text,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enrollments_owner_update_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_course_coupon_reservation(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_enrollment_for_course_slug(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.invite_course_coproducer(text,text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_moderator() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_ops() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_service_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_support() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_target_author(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_teacher() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.issue_skillset_certificate(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lesson_comments_update_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.log_audit_event(text,text,text,text,text,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notifications_client_read_only_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.publish_teacher_course(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recompute_course_trending_scores() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_lesson_progress(text,text,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_course_coupon_reservation(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.request_account_action(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reserve_course_coupon(uuid,text,text,timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.review_creator_verification(uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_course_coproducer(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.send_course_message(text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.server_write_only() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_course_coupon_active(uuid,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_default_product_offer(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_course_review(text,integer,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_creator_verification(text,text,text,text,jsonb,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_teacher_course_for_review(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.support_tickets_update_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_teacher_course_builder(text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_course_commerce_settings(text,boolean,integer,text,boolean,jsonb,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.users_field_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verify_skillset_certificate(text,text) FROM PUBLIC;

-- 5b. Funcoes que MANTEM EXECUTE para PUBLIC (5) -- nao revogar:
--   public.course_title_key(text)
--   public.handle_new_user()
--   public.notify_enrolled_on_course_event()
--   public.platform_fee_bps_for_plan(text)
--   public.prevent_course_lesson_content_course_move()

-- 5c. GRANT EXECUTE por funcao (lista de grantees exatamente como no catalogo).

GRANT EXECUTE ON FUNCTION public.assert_course_owner(text) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.claim_checkout_lock(text,text,text,text,integer,integer) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.claim_payout_transfer_reversal(text,text,numeric) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.community_comments_update_guard() TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.community_posts_update_guard() TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.community_reports_update_guard() TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.complete_payout_transfer_reversal(text,text,text) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.course_event_rsvps_update_guard() TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.course_events_teacher_update_guard() TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.course_title_key(text) TO postgres, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.courses_freeze_privileged_columns() TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.create_course_coupon(text,text,integer,integer,timestamp with time zone) TO postgres, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_free_course_enrollment(text) TO postgres, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_product_offer_atomic(text,text,text,text,text,numeric,text,text,boolean,text) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.create_teacher_course_draft(text,text,text,text[],text,boolean) TO postgres, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_teacher_course_draft(text,text,text,text[],text) TO postgres, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_course_as_admin(text) TO postgres, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_course_coupon(uuid) TO postgres, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_teacher_course_draft(text) TO postgres, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.enforce_rate_limit(text,integer,integer) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.enrollments_owner_update_guard() TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.finalize_course_coupon_reservation(text) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.has_enrollment_for_course_slug(text) TO postgres, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.invite_course_coproducer(text,text,integer) TO postgres, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_admin() TO postgres, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_moderator() TO postgres, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_ops() TO postgres, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_service_role() TO postgres, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_support() TO postgres, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_target_author(text,text) TO postgres, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_teacher() TO postgres, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_skillset_certificate(text,text) TO postgres, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lesson_comments_update_guard() TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.log_audit_event(text,text,text,text,text,text,jsonb) TO postgres, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.notifications_client_read_only_guard() TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.notify_enrolled_on_course_event() TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.platform_fee_bps_for_plan(text) TO postgres, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.prevent_course_lesson_content_course_move() TO postgres, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.publish_teacher_course(text) TO postgres, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.recompute_course_trending_scores() TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.record_lesson_progress(text,text,boolean) TO postgres, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_course_coupon_reservation(text) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.request_account_action(text) TO postgres, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reserve_course_coupon(uuid,text,text,timestamp with time zone) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.review_creator_verification(uuid,text,text) TO postgres, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_course_coproducer(uuid) TO postgres, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.send_course_message(text,text,text) TO postgres, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.server_write_only() TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.set_course_coupon_active(uuid,boolean) TO postgres, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_default_product_offer(text,text) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.submit_course_review(text,integer,text) TO postgres, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_creator_verification(text,text,text,text,jsonb,text) TO postgres, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_teacher_course_for_review(text) TO postgres, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.support_tickets_update_guard() TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.update_teacher_course_builder(text,jsonb) TO postgres, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_course_commerce_settings(text,boolean,integer,text,boolean,jsonb,text) TO postgres, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.users_field_guard() TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.verify_skillset_certificate(text,text) TO postgres, anon, authenticated, service_role;


-- ============================================================================
-- 6. PUBLICATIONS (realtime)
-- ============================================================================
-- A publication "supabase_realtime" ja e criada pela plataforma Supabase em todo
-- projeto novo (insert/update/delete/truncate, puballtables = false).
-- Se por algum motivo nao existir no destino:
--   CREATE PUBLICATION supabase_realtime WITH (publish = 'insert, update, delete, truncate');

ALTER PUBLICATION supabase_realtime ADD TABLE public.course_commerce_settings;
ALTER PUBLICATION supabase_realtime ADD TABLE public.course_coproducers;
ALTER PUBLICATION supabase_realtime ADD TABLE public.course_coupons;
ALTER PUBLICATION supabase_realtime ADD TABLE public.course_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.creator_verification_cases;
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE public.public_profiles;
ALTER PUBLICATION supabase_realtime ADD TABLE public.users;

-- A segunda publication, "supabase_realtime_messages_publication", contem apenas
-- as particoes diarias de realtime.messages_YYYY_MM_DD (7 no momento da extracao).
-- E gerida inteiramente pela Supabase. NAO replicar.


-- ============================================================================
-- 7. STORAGE BUCKETS (estrutura, sem objetos)
-- ============================================================================
-- Buckets existentes no projeto de origem. Nao ha DDL para bucket; sao linhas em
-- storage.buckets. Criar preferencialmente pelo Dashboard ou pela Storage API.
-- Guia idempotente (NAO executado por este arquivo -- revisar antes de rodar):
--
--   insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
--   values
--     ('course-content', 'course-content', false, 524288000, null),  -- 500 MB, privado
--     ('public-media',   'public-media',   true,   26214400, null)   -- 25 MB, publico
--   on conflict (id) do update
--     set public = excluded.public,
--         file_size_limit = excluded.file_size_limit,
--         allowed_mime_types = excluded.allowed_mime_types;
--
-- As policies RLS de storage.objects para estes buckets NAO estao no bloco 7
-- (que e 100% schema public). Elas vivem no BLOCO 7B / parts/09_storage_rls.sql:
--   course-content: course_content_select, course_content_insert_owner,
--                   course_content_update_owner, course_content_delete
--   public-media:   public_media_select_owner, public_media_insert_user_self,
--                   public_media_insert_course_owner, public_media_update_user_self,
--                   public_media_update_course_owner, public_media_delete
-- O bloco 7B ja rodou antes deste ponto no arquivo; as policies nao dependem
-- da existencia previa das linhas de storage.buckets (comparam bucket_id como
-- literal), mas os buckets precisam existir para o storage funcionar de fato.


-- ============================================================================
-- 8. VIEWS / MATERIALIZED VIEWS -- public
-- ============================================================================
-- Nenhuma view ou matview no schema public (confirmado: pg_class relkind in ('v','m') = 0).


-- fim de 08_grants_publications_misc.sql


-- ============================================================================
-- 9. CRON JOBS (pg_cron) -- NAO executado por este arquivo
-- ============================================================================
-- Verificado no remoto em 2026-07-21 (select * from cron.job): existe 1 job ativo.
--
--   jobid 1 | recompute-course-trending | schedule "10 3 * * *" | active
--            command: select public.recompute_course_trending_scores();
--
-- Por que fica comentado: cron.schedule() exige a extensao pg_cron, que na
-- Supabase e provisionada pela plataforma no schema "cron" e nao pode ser criada
-- por este replay; agendar duas vezes tambem duplicaria o job.
--
-- ATENCAO -- ESTE E UM MODO DE FALHA SILENCIOSA. Restaurar o schema sem
-- reagendar o job deixa o banco aparentemente saudavel enquanto os scores de
-- "trending" congelam no valor do dia da restauracao. Nada quebra, nada loga.
--
-- Depois de habilitar pg_cron no projeto novo (Dashboard -> Database -> Extensions):
--
--   select cron.schedule(
--     'recompute-course-trending',
--     '10 3 * * *',
--     $$select public.recompute_course_trending_scores();$$
--   );
--
-- Conferir com: select jobid, jobname, schedule, active from cron.job;


-- ============================================================================
-- FIM DO BASELINE -- remote_schema_2026-07-21.sql
-- ============================================================================
