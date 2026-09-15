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

export type CreatorSaleEmail = {
  /** The course owner's account email. */
  email: string;
  courseTitle: string;
  /** Stored amount: value x 100 for every currency (see currencies.ts). */
  amountMinor: number;
  currency: string;
  /** The creator's sales page. */
  salesUrl: string;
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

// One line: a title with line breaks must not break the subject header.
function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

const PARAGRAPH = "font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#102a43;max-width:560px;";
const BUTTON = "display:inline-block;padding:12px 28px;background-color:#102a43;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:bold;";

/** Subject, HTML and plain-text parts. The course title is creator input: escaped in HTML. */
export function buildPurchaseAccessEmail({ email, courseTitle, courseUrl, locale }: PurchaseAccessEmail) {
  const copy = COPY[locale] ?? COPY[DEFAULT_LOCALE];
  const title = oneLine(courseTitle);
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

  const html = `<div style="${PARAGRAPH}">
  <p>${copy.intro}</p>
  <p style="font-size:18px;font-weight:bold;">${safeTitle}</p>
  <p><a href="${safeUrl}" style="${BUTTON}">${copy.open}</a></p>
  <p style="font-size:13px;word-break:break-all;"><a href="${safeUrl}" style="color:#102a43;">${safeUrl}</a></p>
  <p>${escapeHtml(copy.signIn(email))}</p>
  <p>${copy.help} <a href="mailto:${SUPPORT}" style="color:#102a43;font-weight:bold;">${SUPPORT}</a>.</p>
</div>`;

  return { subject: copy.subject(title), html, text };
}

/**
 * The creator's "new sale" email. Carries nothing about the buyer: "a new
 * student", the course, the amount and the sales page.
 *
 * ponytail: English only. The app stores no language for creators; give this
 * a COPY map like the buyer's once it does.
 */
export function buildCreatorSaleEmail({ courseTitle, amountMinor, currency, salesUrl }: CreatorSaleEmail) {
  const title = oneLine(courseTitle);
  // House convention: every stored amount is value x 100, and Intl drops the
  // fraction for zero-decimal currencies (JPY 100000 -> ¥1,000).
  const amount = new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amountMinor / 100);
  const intro = "A new student just bought your course:";
  const open = "See your sales";
  const payout = "Stripe pays this sale out to your own Stripe account.";
  const safeUrl = escapeHtml(salesUrl);

  const text = [intro, title, `Amount: ${amount}`, "", `${open}: ${salesUrl}`, "", payout].join("\n");

  const html = `<div style="${PARAGRAPH}">
  <p>${intro}</p>
  <p style="font-size:18px;font-weight:bold;">${escapeHtml(title)}</p>
  <p>Amount: <strong>${escapeHtml(amount)}</strong></p>
  <p><a href="${safeUrl}" style="${BUTTON}">${open}</a></p>
  <p>${payout}</p>
</div>`;

  return { subject: `New sale: ${title}`, html, text };
}

/**
 * Resend's HTTP API — the provider behind the project's Auth SMTP, sending from
 * the already-verified domain. Plain fetch: no SDK, no dependency. It does not
 * touch Supabase Auth, so it spends none of the project-wide auth email quota.
 *
 * Skips with one warning when RESEND_API_KEY is unset. Throws on a non-2xx or
 * a network error so the caller can log and alert.
 */
async function sendResendEmail({ to, subject, html, text, idempotencyKey }: {
  to: string; subject: string; html: string; text: string; idempotencyKey: string;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("RESEND_API_KEY is not set; email skipped.");
    return;
  }

  const response = await fetch(RESEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      // Resend answers a repeat of the same key without sending again (24 h
      // window), so even a double queue for one email delivers it once.
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({ from: FROM, to: [to], subject, html, text }),
    signal: AbortSignal.timeout(10_000),
  });
  // Status only: the response body is not worth echoing into logs.
  if (!response.ok) throw new Error(`Resend answered ${response.status}.`);
}

export async function sendPurchaseAccessEmail(input: PurchaseAccessEmail): Promise<void> {
  await sendResendEmail({ to: input.email, ...buildPurchaseAccessEmail(input), idempotencyKey: input.idempotencyKey });
}

export async function sendCreatorSaleEmail(input: CreatorSaleEmail): Promise<void> {
  await sendResendEmail({ to: input.email, ...buildCreatorSaleEmail(input), idempotencyKey: input.idempotencyKey });
}
