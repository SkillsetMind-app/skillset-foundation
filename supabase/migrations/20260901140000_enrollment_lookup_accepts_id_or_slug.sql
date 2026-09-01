-- has_enrollment_for_course_slug só casava por slug, mas a coluna que ela lê
-- recebe as duas coisas dependendo do caminho:
--
--   src/lib/data/enrollments.ts:69   course_slug: snapshot.courseSlug   -- slug
--   src/lib/data/enrollments.ts:115  course_slug: course.id             -- id
--   src/app/api/webhooks/stripe/route.ts:386  course_slug: courseId     -- id
--
-- Ou seja, a compra por Stripe grava o ID e a leitura compara com slug. Toda
-- policy que depende dessa função passa a negar acesso a quem pagou:
-- community_posts (publicar e ler), community_comments, community_post_likes,
-- course_events, course_event_rsvps e courses.
--
-- A policy de community_posts já reconhece a ambiguidade e aceita as duas
-- formas para localizar o curso:
--
--   (c.slug = community_posts.course_slug OR c.id = community_posts.course_slug)
--
-- mas a checagem de matrícula ao lado dela não — então a metade que identifica o
-- curso funciona e a que identifica o direito de acesso falha.
--
-- Alinha a função ao mesmo critério. Ampliar o casamento não afrouxa nada: segue
-- exigindo matrícula ATIVA do PRÓPRIO usuário; muda apenas como o curso é
-- identificado. Corrigir os dados seria a alternativa, mas exigiria saber qual
-- dos dois formatos é o certo em cada linha — e as duas gravações continuam no
-- código. Tolerar aqui é o conserto que não depende de adivinhar.

CREATE OR REPLACE FUNCTION public.has_enrollment_for_course_slug(p_slug text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.enrollments e
    WHERE e.user_id = (SELECT auth.uid())::text
      AND e.status IN ('active', 'completed')
      AND (
        e.course_slug = p_slug
        OR EXISTS (
          SELECT 1 FROM public.courses c
          WHERE (c.id = p_slug OR c.slug = p_slug)
            AND (c.id = e.course_slug OR c.slug = e.course_slug)
        )
      )
  );
$function$;

-- O grant é reaplicado porque CREATE OR REPLACE preserva privilégios, mas uma
-- recriação futura por DROP+CREATE não preservaria — e sem EXECUTE para anon a
-- leitura pública de courses volta a abortar com 42501 (ver
-- 20260901120000_restore_anon_execute_on_rls_predicates.sql).
GRANT EXECUTE ON FUNCTION public.has_enrollment_for_course_slug(text)
  TO anon, authenticated, service_role;
