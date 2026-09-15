import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/config";

export type PurchaseAccessEmail = {
  /** The buyer's account email: the recipient, and the address they sign in with. */
  email: string;
  courseTitle: string;
  /** Plain classroom link. No token, no magic link: it never expires. */
  courseUrl: string;
  locale: Locale;
  /** The sale's payout_ledger id (order id or invoice id). */
  idempotencyKey: string;
};

const RESEND_URL = "https://api.resend.com/emails";
const FROM = "SkillsetMind <no-reply@skillsetmind.com>";
const SUPPORT = "support@skillsetmind.com";

const COPY: Record<Locale, {
  subject: (title: string) => string;
  intro: string;
  open: string;
  signIn: (email: string) => string;
  help: string;
}> = {
  en: {
    subject: (title) => `Your course is ready: ${title}`,
    intro: "Thanks for your purchase. Your course is ready:",
    open: "Open your course",
    signIn: (email) => `Sign in with ${email}, the email on your SkillsetMind account.`,
    help: "Questions? Write to",
  },
  es: {
    subject: (title) => `Tu curso está listo: ${title}`,
    intro: "Gracias por tu compra. Tu curso ya está disponible:",
    open: "Abrir tu curso",
    signIn: (email) => `Inicia sesión con ${email}, el correo de tu cuenta de SkillsetMind.`,
    help: "¿Preguntas? Escríbenos a",
  },
};

const HTML_ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ENTITIES[char]);
}

/** Subject, HTML and plain-text parts. The course title is creator input: escaped in HTML. */
export function buildPurchaseAccessEmail({ email, courseTitle, courseUrl, locale }: PurchaseAccessEmail) {
  const copy = COPY[locale] ?? COPY[DEFAULT_LOCALE];
  // One line: a title with line breaks must not break the subject header.
  const title = courseTitle.replace(/\s+/g, " ").trim();
  const safeTitle = escapeHtml(title);
  const safeUrl = escapeHtml(courseUrl);

  const text = [
    copy.intro,
    title,
    "",
    `${copy.open}: ${courseUrl}`,
    "",
    copy.signIn(email),
    "",
    `${copy.help} ${SUPPORT}.`,
  ].join("\n");

  const html = `<div style="font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#102a43;max-width:560px;">
  <p>${copy.intro}</p>
  <p style="font-size:18px;font-weight:bold;">${safeTitle}</p>
  <p><a href="${safeUrl}" style="display:inline-block;padding:12px 28px;background-color:#102a43;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:bold;">${copy.open}</a></p>
  <p style="font-size:13px;word-break:break-all;"><a href="${safeUrl}" style="color:#102a43;">${safeUrl}</a></p>
  <p>${escapeHtml(copy.signIn(email))}</p>
  <p>${copy.help} <a href="mailto:${SUPPORT}" style="color:#102a43;font-weight:bold;">${SUPPORT}</a>.</p>
</div>`;

  return { subject: copy.subject(title), html, text };
}

/**
 * Sends the buyer's purchase email through Resend's HTTP API — the provider
 * behind the project's Auth SMTP, sending from the already-verified domain.
 * Plain fetch: no SDK, no dependency.
 *
 * Its own budget: this does not touch Supabase Auth, so it spends none of the
 * project-wide auth email quota and invalidates no pending reset or invite.
 *
 * Skips with one warning when RESEND_API_KEY is unset. Throws on a non-2xx or
 * a network error so the caller can log and alert.
 */
export async function sendPurchaseAccessEmail(input: PurchaseAccessEmail): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("RESEND_API_KEY is not set; purchase access email skipped.");
    return;
  }

  const { subject, html, text } = buildPurchaseAccessEmail(input);
  const response = await fetch(RESEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      // Resend answers a repeat of the same key without sending again (24 h
      // window), so even a double queue for one sale delivers one email.
      "Idempotency-Key": input.idempotencyKey,
    },
    body: JSON.stringify({ from: FROM, to: [input.email], subject, html, text }),
    signal: AbortSignal.timeout(10_000),
  });
  // Status only: the response body is not worth echoing into logs.
  if (!response.ok) throw new Error(`Resend answered ${response.status}.`);
}
