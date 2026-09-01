-- O app assina 20 tabelas por realtime. Só 4 estavam publicadas.
--
-- Medido em produção antes de escrever:
--
--   publicação supabase_realtime continha
--     course_commerce_settings, course_coupons, course_messages,
--     creator_verification_cases, enrollments, notifications,
--     public_profiles, users
--
--   o app assina (grep por `table: "..."` em src/)
--     courses, wishlists, support_tickets, payout_ledger, orders,
--     course_lesson_content, lesson_comments, community_post_likes,
--     leaderboards, course_subscriptions, course_events, course_event_rsvps,
--     community_posts, community_comments, community_reports, audit_log,
--     users, public_profiles, notifications, enrollments
--
-- Coincidem 4. As outras 16 abrem um canal que nunca recebe evento.
--
-- O SINTOMA CARO
--
-- `subscribeToTeacherCourse` (src/lib/data/teacher-courses.ts) faz um load()
-- inicial e depois delega TODA atualização ao canal. No course-builder-studio,
-- de 3299 linhas, esse callback é o único lugar que chama setCourse. Como
-- courses não estava publicada, o builder abre com o curso (o load funciona) e
-- nunca mais reflete mudança nenhuma: o criador adiciona uma aula, lê "abrindo
-- o estúdio assim que salvar", e a linha fica em "Saving lesson…" para sempre.
-- Não há erro, não há timeout — o evento simplesmente nunca chega. É a causa
-- da queixa "a parte de postar vídeo está quebrada".
--
-- O mesmo silêncio atinge comunidade (posts, comentários, curtidas não
-- aparecem sem recarregar), pedidos, extrato de repasse, wishlist, tickets,
-- eventos e progresso de aula.
--
-- POR QUE PUBLICAR É SEGURO
--
-- O Realtime do Supabase aplica RLS às mensagens de postgres_changes usando o
-- token de quem assina — não é um broadcast aberto. Verificado antes de
-- publicar: as 16 tabelas têm rowsecurity = true e pelo menos uma policy de
-- SELECT; orders, payout_ledger e course_subscriptions têm inclusive
-- FORCE ROW LEVEL SECURITY. Nenhuma tabela sem RLS entra aqui, e a lista é
-- deliberadamente só o que o código já assina.

DO $$
DECLARE
  t text;
  alvo text[] := ARRAY[
    'courses', 'wishlists', 'support_tickets', 'payout_ledger', 'orders',
    'course_lesson_content', 'lesson_comments', 'community_post_likes',
    'leaderboards', 'course_subscriptions', 'course_events',
    'course_event_rsvps', 'community_posts', 'community_comments',
    'community_reports', 'audit_log'
  ];
BEGIN
  FOREACH t IN ARRAY alvo LOOP
    -- Recusa publicar tabela sem RLS: seria vazamento por realtime.
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = t AND c.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'Recusando publicar %.% no realtime: RLS desligado.', 'public', t;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

-- Trava de regressão: falha se alguma das tabelas alvo ficou de fora.
DO $$
DECLARE faltando text;
BEGIN
  SELECT string_agg(t, ', ') INTO faltando
  FROM unnest(ARRAY[
    'courses','wishlists','support_tickets','payout_ledger','orders',
    'course_lesson_content','lesson_comments','community_post_likes',
    'leaderboards','course_subscriptions','course_events','course_event_rsvps',
    'community_posts','community_comments','community_reports','audit_log'
  ]) AS t
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
  );

  IF faltando IS NOT NULL THEN
    RAISE EXCEPTION 'Tabelas assinadas pelo app que seguem fora do realtime: %', faltando;
  END IF;
END $$;
