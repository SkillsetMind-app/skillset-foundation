-- O banco como ficaria sem as travas que só viviam no snapshot de 21/07.
-- Derruba as 13 que ficam em tabelas public. on_auth_user_created fica: só o
-- dono de auth.users (o Supabase Auth) derruba trigger nela.
-- Sem IF EXISTS de propósito: se uma já faltar, é erro de setup, não prova.
drop trigger community_comments_update_guard on public.community_comments;
drop trigger community_posts_update_guard on public.community_posts;
drop trigger community_reports_update_guard on public.community_reports;
drop trigger course_event_rsvps_update_guard on public.course_event_rsvps;
drop trigger course_event_notify_enrolled on public.course_events;
drop trigger course_events_teacher_update_guard_trg on public.course_events;
drop trigger courses_freeze_privileged_columns_trg on public.courses;
drop trigger enrollments_owner_update_guard on public.enrollments;
drop trigger lesson_comments_update_guard on public.lesson_comments;
drop trigger trg_notifications_client_read_only on public.notifications;
drop trigger payments_server_write_only on public.payments;
drop trigger payout_ledger_server_write_only on public.payout_ledger;
drop trigger support_tickets_update_guard on public.support_tickets;
