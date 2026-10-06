import { setTimeout as sleep } from "node:timers/promises";

import type { User } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { isCronRequest } from "@/lib/cron/authorized";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/lib/i18n/config";
import { getAppUrl } from "@/lib/payments/server/app-url";
import { sendResendEmail } from "@/lib/payments/server/purchase-access-email";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

// GET /api/cron/confirmation-reminder — ONE "confirm your email" reminder,
// ~24 h after signup, to accounts that still have not confirmed (about a third
// never did, and the first link has expired by then).
//
// Called every hour by .github/workflows/stripe-attention.yml with the same
// "Bearer CRON_SECRET" header as the other crons.
//
// How it sends: the public resend endpoint needs a CAPTCHA token since #444,
// which a server cannot produce. So the service role mints a fresh one-time
// link (generateLink "magiclink": it leaves the first email's link alone, and
// opening it confirms the address and signs the person in, same as the
// confirmation link) and Resend delivers it, the same provider and sender as
// the purchase emails. The link lands on /auth/confirm, like every template.
//
// Never twice: before the email goes out, the account gets
// app_metadata.confirmation_reminder_sent_at (only the service role writes
// app_metadata; no migration). A send that fails after the mark is not retried,
// because the provider may have delivered it anyway, and it stops the run, so
// an outage costs one reminder, not a batch.
// Logs and the response carry counts only: no email, no account id.
//
// One-off catch-up for accounts older than the window: ?max_age_hours=N widens
// it (never below 72). Same mark and cap: call again until "due" is 0.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const HOUR_MS = 60 * 60 * 1000;
const MIN_AGE_HOURS = 24;
const MAX_AGE_HOURS = 72;
const PER_PAGE = 200;
// ponytail: 25 a run, hourly = 600 a day, far above today's signups. With the
// pause below a full run takes ~30 s: inside maxDuration and the 60 s curl.
const CAP = 25;
// Resend's default limit is 2 requests per second.
const SEND_GAP_MS = 600;
const MARK = "confirmation_reminder_sent_at";
const SUPPORT = "support@skillsetmind.com";

type Due = User & { email: string };

function isDue(user: User, oldest: number, newest: number, now: number): user is Due {
  const createdAt = Date.parse(user.created_at);
  return createdAt >= oldest && createdAt <= newest
    && Boolean(user.email) && !user.email_confirmed_at
    && !user.app_metadata?.[MARK]
    // Deleted, banned, or invited by an admin (that flow has its own email).
    && !user.deleted_at && !user.invited_at
    && !(Date.parse(user.banned_until ?? "") > now);
}

export async function GET(request: Request) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  // sendResendEmail skips quietly without the key: checked first, so no
  // account is ever marked for an email that was never going to leave.
  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ ok: false, reason: "email_channel_missing" }, { status: 500 });
  }

  let admin;
  try {
    admin = getSupabaseAdminClient();
  } catch {
    return NextResponse.json({ ok: false, reason: "service_role_missing" }, { status: 500 });
  }

  const now = Date.now();
  const maxAgeHours = Math.max(MAX_AGE_HOURS, Number(new URL(request.url).searchParams.get("max_age_hours")) || 0);
  const oldest = now - maxAgeHours * HOUR_MS;
  const newest = now - MIN_AGE_HOURS * HOUR_MS;

  // GoTrue lists newest first, so paging stops at the first page that reaches
  // past the window.
  const due: Due[] = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PER_PAGE });
    if (error) {
      console.error("Confirmation reminder could not list accounts", error.message);
      return NextResponse.json({ ok: false, reason: "list_failed" }, { status: 500 });
    }
    due.push(...data.users.filter((user) => isDue(user, oldest, newest, now)));
    const last = data.users.at(-1);
    if (data.users.length < PER_PAGE || !last || Date.parse(last.created_at) < oldest) break;
  }
  // Oldest first: whoever the cap holds back is still inside the window next hour.
  due.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));

  let sent = 0;
  let failed = 0;
  for (const user of due.slice(0, CAP)) {
    // Link first: if it fails nothing has changed, and the next run retries.
    const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email: user.email });
    const hash = link?.properties?.hashed_token;
    if (linkError || !hash) {
      failed += 1;
      continue;
    }
    const { error: markError } = await admin.auth.admin.updateUserById(user.id, {
      app_metadata: { [MARK]: new Date(now).toISOString() },
    });
    if (markError) {
      failed += 1;
      continue;
    }

    if (sent > 0) await sleep(SEND_GAP_MS);
    const locale = isLocale(user.user_metadata?.locale) ? user.user_metadata.locale : DEFAULT_LOCALE;
    const url = `${getAppUrl()}/auth/confirm?token_hash=${encodeURIComponent(hash)}&type=email`;
    try {
      await sendResendEmail({ to: user.email, ...buildReminderEmail(locale, url), idempotencyKey: `confirmation-reminder:${user.id}` });
      sent += 1;
    } catch {
      failed += 1;
      break;
    }
  }

  const result = { due: due.length, sent, failed };
  console.info("Confirmation reminder run", result);
  return NextResponse.json({ ok: failed === 0, ...result }, { status: failed ? 500 : 200 });
}

const COPY: Record<Locale, {
  subject: string;
  title: string;
  body: string;
  button: string;
  fallback: string;
  footer: string;
  questions: string;
}> = {
  en: {
    subject: "Confirm your email to finish signing up",
    title: "One step left",
    body: "You signed up for SkillsetMind but have not confirmed your email yet. Confirm it to continue to your account.",
    button: "Confirm my email",
    fallback: "If the button doesn't work, copy and paste this link into your browser:",
    footer: "You're receiving this because this address was used to sign up at SkillsetMind. If it wasn't you, you can safely ignore this email.",
    questions: "Questions?",
  },
  es: {
    subject: "Confirma tu correo para terminar tu registro",
    title: "Te falta un paso",
    body: "Te registraste en SkillsetMind, pero aún no confirmaste tu correo. Confírmalo para entrar a tu cuenta.",
    button: "Confirmar mi correo",
    fallback: "Si el botón no funciona, copia y pega este enlace en tu navegador:",
    footer: "Recibes este correo porque esta dirección se usó para registrarse en SkillsetMind. Si no fuiste tú, puedes ignorarlo.",
    questions: "¿Preguntas?",
  },
};

const SANS = "'Segoe UI',Helvetica,Arial,sans-serif";
const DISPLAY = "'Montserrat','Segoe UI',Helvetica,Arial,sans-serif";

// Same shell as supabase/templates/confirmation.html (navy header with the
// hosted logo, brass rule, white card, square navy button, pale footer).
function buildReminderEmail(locale: Locale, url: string) {
  const copy = COPY[locale];
  const href = url.replaceAll("&", "&amp;");
  const text = [copy.title, "", copy.body, "", `${copy.button}: ${url}`, "", copy.footer, `${copy.questions} ${SUPPORT}`].join("\n");
  const html = `<html>
  <body style="margin:0;padding:0;background-color:#eef4fc;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#eef4fc;padding:32px 0;"><tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
        <tr><td align="center" bgcolor="#102a43" style="background-color:#102a43;padding:22px 40px;text-align:center;">
          <img src="https://www.skillsetmind.com/brand/logo-lockup-on-navy.png" width="200" height="81" alt="SkillsetMind" style="display:block;margin:0 auto;width:200px;height:81px;border:0;color:#ffffff;font-family:${DISPLAY};font-size:20px;font-weight:bold;" />
        </td></tr>
        <tr><td bgcolor="#d8a226" style="background-color:#d8a226;height:3px;line-height:3px;font-size:0;">&nbsp;</td></tr>
        <tr><td style="background-color:#ffffff;padding:40px;border:1px solid #d7e3f0;border-top:none;">
          <h1 style="margin:0 0 16px;font-family:${DISPLAY};font-size:22px;line-height:1.35;color:#102a43;">${copy.title}</h1>
          <p style="margin:0 0 24px;font-family:${SANS};font-size:15px;line-height:1.7;color:#4a6278;">${copy.body}</p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 24px;"><tr>
            <td align="center" bgcolor="#102a43" style="background-color:#102a43;">
              <a href="${href}" style="display:inline-block;padding:15px 38px;font-family:${SANS};font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;">${copy.button}</a>
            </td>
          </tr></table>
          <p style="margin:0 0 8px;font-family:${SANS};font-size:13px;line-height:1.6;color:#5a6a81;">${copy.fallback}</p>
          <p style="margin:0;font-family:${SANS};font-size:12px;line-height:1.6;word-break:break-all;"><a href="${href}" style="color:#102a43;">${href}</a></p>
        </td></tr>
        <tr><td style="background-color:#e3eef9;padding:20px 40px;border:1px solid #d7e3f0;border-top:none;font-family:${SANS};font-size:12px;line-height:1.7;color:#5a6a81;text-align:center;">
          ${copy.footer}<br />${copy.questions} <a href="mailto:${SUPPORT}" style="color:#102a43;font-weight:bold;">${SUPPORT}</a>
        </td></tr>
      </table>
    </td></tr></table>
  </body>
</html>`;
  return { subject: copy.subject, html, text };
}
