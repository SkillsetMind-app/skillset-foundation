import { setTimeout as sleep } from "node:timers/promises";

import { NextResponse } from "next/server";

import { isCronRequest } from "@/lib/cron/authorized";
import { normalizeLocale, type Locale } from "@/lib/i18n/config";
import { getAppUrl } from "@/lib/payments/server/app-url";
import { sendResendEmail } from "@/lib/payments/server/purchase-access-email";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

// GET /api/cron/notification-digest — "You have N new notifications", at most
// once an hour per person, for notifications they have not seen in the bell.
//
// Called every hour by its own job in .github/workflows/stripe-attention.yml,
// with the same "Bearer CRON_SECRET" header as the other crons (Vercel Hobby
// crons run at most once a day).
//
// Who and what: public.claim_notification_digests (migration
// 20261006041500). Unread, never emailed, 10 minutes to 3 days old; nobody
// emailed in the last hour, nobody who turned "Email summary" off in
// /account?tab=notifications, nobody suspended, deleted or unconfirmed. People
// who cannot get email are filtered out before the limit, so they never hold
// up the queue.
//
// Never twice: the claim marks the notifications (emailed_at) in the same
// statement that returns them, skipping rows a concurrent run holds. A send
// that fails after the claim is not retried, because the provider may have
// delivered it anyway, and the notifications are still in the bell. One
// person per claim, and a failure stops the run, so an outage costs one email,
// not a batch.
// Logs and the response carry counts only: no email, no account id.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ponytail: 25 emails a run, hourly = 600 a day. With the pause below a full
// run takes ~15 s plus 25 claims, inside maxDuration and the 60 s curl.
const CAP = 25;
// Resend allows 10 requests/second per team, shared with the other emails.
const SEND_GAP_MS = 600;
// Same window as the claim's "at most one digest an hour": the idempotency key
// makes a repeated call in the same hour send nothing new.
const HOUR_MS = 60 * 60_000;

export async function GET(request: Request) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  // sendResendEmail skips quietly without the key: checked first, so nothing
  // is ever marked as emailed for an email that was never going to leave.
  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ ok: false, reason: "email_channel_missing" }, { status: 500 });
  }

  let admin;
  try {
    admin = getSupabaseAdminClient();
  } catch {
    return NextResponse.json({ ok: false, reason: "service_role_missing" }, { status: 500 });
  }

  const hour = Math.floor(Date.now() / HOUR_MS);
  let sent = 0;
  let failed = 0;
  while (sent < CAP) {
    const { data, error } = await admin.rpc("claim_notification_digests", { p_limit: 1 });
    if (error) {
      console.error("Notification digest could not claim notifications", error.code ?? null);
      failed += 1;
      break;
    }
    const digest = data?.[0];
    if (!digest) break;

    if (sent > 0) await sleep(SEND_GAP_MS);
    try {
      await sendResendEmail({
        to: digest.email,
        ...buildDigestEmail(normalizeLocale(digest.locale), digest.notification_count),
        // Same person, same hour: a repeated call is answered without a second email.
        idempotencyKey: `notification-digest:${digest.user_id}:${hour}`,
      });
      sent += 1;
    } catch (error) {
      // "Resend answered 503." or a network error: no address in either.
      console.error("Notification digest could not send", error instanceof Error ? error.message : "unknown");
      failed += 1;
      break;
    }
  }

  const result = { sent, failed };
  console.info("Notification digest run", result);
  return NextResponse.json({ ok: failed === 0, ...result }, { status: failed ? 500 : 200 });
}

const COPY: Record<Locale, {
  subject: (count: number) => string;
  body: string;
  button: string;
  footer: string;
}> = {
  en: {
    subject: (count) => (count === 1 ? "You have 1 new notification" : `You have ${count} new notifications`),
    body: "They can be answers to your questions, messages, or news from your courses.",
    button: "See my notifications",
    footer: "We send this email at most once an hour, only for notifications you have not seen yet. To stop it, turn off “Email summary” here:",
  },
  es: {
    subject: (count) => (count === 1 ? "Tienes 1 notificación nueva" : `Tienes ${count} notificaciones nuevas`),
    body: "Pueden ser respuestas a tus preguntas, mensajes o novedades de tus cursos.",
    button: "Ver mis notificaciones",
    footer: "Te enviamos este correo como máximo una vez por hora, solo con notificaciones que aún no viste. Para dejar de recibirlo, desactiva “Resumen por correo” aquí:",
  },
};

const PARAGRAPH = "font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#102a43;max-width:560px;";
const BUTTON = "display:inline-block;padding:12px 28px;background-color:#102a43;color:#ffffff;text-decoration:none;border-radius:0;font-weight:bold;";

// Same plain shape as the purchase email. Every string here is ours (no user
// content), and neither URL carries an "&", so nothing needs escaping.
function buildDigestEmail(locale: Locale, count: number) {
  const copy = COPY[locale];
  const inbox = `${getAppUrl()}/account/notifications`;
  const settings = `${getAppUrl()}/account?tab=notifications`;
  const subject = copy.subject(count);
  const text = [subject, "", copy.body, "", `${copy.button}: ${inbox}`, "", `${copy.footer} ${settings}`].join("\n");
  const html = `<div style="${PARAGRAPH}">
  <p style="font-size:18px;font-weight:bold;">${subject}</p>
  <p>${copy.body}</p>
  <p><a href="${inbox}" style="${BUTTON}">${copy.button}</a></p>
  <p style="font-size:13px;color:#5a6a81;">${copy.footer} <a href="${settings}" style="color:#102a43;">${settings}</a></p>
</div>`;
  return { subject, html, text };
}
