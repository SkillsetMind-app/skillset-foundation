// Generates the Supabase Auth email templates into supabase/templates/*.html.
//
// Why a generator: six emails share one shell. Hand-editing six copies is how
// the old set drifted (three different blacks, an accent that wasn't the brand
// accent). Change the shell here, run `node scripts/build-email-templates.mjs`,
// paste the regenerated files into the dashboard.
//
// Palette is lifted verbatim from src/app/globals.css :root — email clients
// can't read CSS variables, so the values are inlined at build time.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "supabase", "templates");

// --- design tokens (mirror of globals.css) ---------------------------------
const C = {
  navy: "#102a43", // --color-primary / --color-ink
  navyDark: "#091d2f", // --color-primary-dark
  // The lockup's own gold, not globals.css --color-accent (#c99a46). The rule
  // sits directly under the logo, and two near-identical golds touching reads
  // as a mistake. Worth reconciling the site token to match the artwork.
  brass: "#d8a226",
  pageBg: "#eef4fc", // --color-surface-soft
  footerBg: "#e3eef9", // --color-surface-strong
  card: "#ffffff",
  line: "#d7e3f0",
  body: "#4a6278", // --color-ink-soft
  muted: "#5a6a81", // --color-ink-muted
  onNavy: "#ffffff",
};

// Palette-inverted lockup (see scripts/build-logo-variants.mjs) so the navy
// wordmark reads on the navy header while "Mind" keeps its gold. 1971x798.
const LOGO = "https://www.skillsetmind.com/brand/logo-lockup-on-navy.png";
const LOGO_W = 200;
const LOGO_H = 81;
const SUPPORT = "support@skillsetmind.com";
const SANS = "'Segoe UI',Helvetica,Arial,sans-serif";
const DISPLAY = "'Montserrat','Segoe UI',Helvetica,Arial,sans-serif";

// Recovery AND signup confirmation build their own link instead of
// {{ .ConfirmationURL }} — see supabase/templates/README.md for the PKCE
// reasoning. The short version: {{ .ConfirmationURL }} hands the app a PKCE
// code that only the browser which requested it can exchange. Sign up on the
// laptop, open the email on the phone (where everyone reads email) -> the
// exchange fails -> "/login?error=auth_callback" -> the account is never
// confirmed. Five real accounts sat in that state between 26/08 and 02/09.
// token_hash + verifyOtp is stateless and works on any device.
const RECOVERY_URL =
  "{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=recovery&amp;next=/reset-password";
const SIGNUP_URL =
  "{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=signup&amp;redirect_to={{ .RedirectTo | urlquery }}";
const MAGIC_LINK_URL = "{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=email&amp;next=/loading%3Fnext%3Droute&amp;redirect_to={{ .RedirectTo | urlquery }}";
// Email change uses the same stateless route with type=email_change. With
// secure email change on, GoTrue sends this template twice — to the current
// and to the new address — and fills {{ .TokenHash }} with the right hash for
// each recipient (email_change_token_current / email_change_token_new), so one
// link shape serves both. {{ .TokenHashNew }} is not a template variable; it
// only exists in the Send Email hook payload. No redirect_to: the app always
// requests the change with a bare /auth/confirm, so a fixed `next` is enough.
const EMAIL_CHANGE_URL =
  "{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=email_change&amp;next=/account%3Ftab%3Dsecurity";
// Invite still goes through {{ .ConfirmationURL }}: it would need its own
// verifyOtp type, and it is not on the path that was failing.
const CONFIRMATION_URL = "{{ .ConfirmationURL }}";

function button(href, label) {
  return `
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
                  <tr>
                    <td align="center" bgcolor="${C.navy}" style="background-color:${C.navy};border-radius:0;">
                      <a href="${href}"
                         style="display:inline-block;padding:15px 38px;font-family:${SANS};font-size:15px;font-weight:bold;color:${C.onNavy};text-decoration:none;border-radius:0;">
                        ${label}
                      </a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 8px;font-family:${SANS};font-size:13px;line-height:1.6;color:${C.muted};">
                  If the button doesn't work, copy and paste this link into your browser:
                </p>
                <p style="margin:0;font-family:${SANS};font-size:12px;line-height:1.6;word-break:break-all;">
                  <a href="${href}" style="color:${C.navy};">${href}</a>
                </p>`;
}

function codeBox(token) {
  return `
                <div style="margin:0;padding:20px 0;background-color:${C.pageBg};border:1px solid ${C.line};border-radius:0;text-align:center;font-family:${DISPLAY};font-size:30px;font-weight:bold;letter-spacing:8px;color:${C.navy};">
                  ${token}
                </div>`;
}

function shell({ slug, dashboardTab, subject, preheader, title, intro, main, outro, footer }) {
  return `<!-- Supabase Auth email template: ${slug}.
     Paste into Dashboard > Authentication > Emails > "${dashboardTab}".
     Subject line: ${subject}
     GENERATED by scripts/build-email-templates.mjs — edit the generator, not this file.
     Brand: SkillsetMind navy ${C.navy} + brass ${C.brass}. Logo is a hosted PNG
     (SVG is blocked by Gmail and Outlook), with alt text for image-blocking clients. -->
<html>
  <body style="margin:0;padding:0;background-color:${C.pageBg};">
    <!-- Preheader: inbox preview text, hidden in the body. -->
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;height:0;width:0;">
      ${preheader}
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${C.pageBg};padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
            <!-- Brand header -->
            <tr>
              <td align="center" bgcolor="${C.navy}" style="background-color:${C.navy};border-radius:0;padding:22px 40px;text-align:center;">
                <img src="${LOGO}" width="${LOGO_W}" height="${LOGO_H}" alt="SkillsetMind"
                     style="display:block;margin:0 auto;width:${LOGO_W}px;height:${LOGO_H}px;border:0;outline:none;text-decoration:none;color:${C.onNavy};font-family:${DISPLAY};font-size:20px;font-weight:bold;letter-spacing:2px;" />
              </td>
            </tr>
            <!-- Brass hairline -->
            <tr>
              <td bgcolor="${C.brass}" style="background-color:${C.brass};height:3px;line-height:3px;font-size:0;">&nbsp;</td>
            </tr>
            <!-- Card body -->
            <tr>
              <td style="background-color:${C.card};padding:40px;border:1px solid ${C.line};border-top:none;">
                <h1 style="margin:0 0 16px;font-family:${DISPLAY};font-size:22px;line-height:1.35;color:${C.navy};">
                  ${title}
                </h1>
                <p style="margin:0 0 24px;font-family:${SANS};font-size:15px;line-height:1.7;color:${C.body};">
                  ${intro}
                </p>${main}${
                  outro
                    ? `
                <p style="margin:16px 0 0;font-family:${SANS};font-size:13px;line-height:1.6;color:${C.muted};">
                  ${outro}
                </p>`
                    : ""
                }
              </td>
            </tr>
            <!-- Footer -->
            <tr>
              <td style="background-color:${C.footerBg};border-radius:0;padding:20px 40px;border:1px solid ${C.line};border-top:none;">
                <p style="margin:0;font-family:${SANS};font-size:12px;line-height:1.7;color:${C.muted};text-align:center;">
                  ${footer ? `${footer}\n                  <br />\n                  ` : ""}Questions? <a href="mailto:${SUPPORT}" style="color:${C.navy};font-weight:bold;">${SUPPORT}</a>
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`;
}

const TEMPLATES = [
  {
    file: "recovery.html",
    slug: "Reset password",
    dashboardTab: "Reset password",
    subject: "Reset your SkillsetMind password",
    preheader: "Choose a new password for your SkillsetMind account.",
    title: "Reset your password",
    intro:
      "We received a request to reset the password for your SkillsetMind account. Click the button below to choose a new one. This link expires soon, so use it right away.",
    main: button(RECOVERY_URL, "Choose a new password"),
    footer:
      "If you didn't ask to reset your password, ignore this email &mdash; your account stays as it is.",
  },
  {
    file: "confirmation.html",
    slug: "Confirm signup",
    dashboardTab: "Confirm sign up",
    subject: "Welcome to SkillsetMind — confirm your email",
    preheader: "Confirm your email to continue to SkillsetMind.",
    title: "Welcome to SkillsetMind",
    intro:
      "Confirm your email address to continue to your account. If you received an invitation, you'll review it next. Your access changes only after you accept the invitation.",
    main: button(SIGNUP_URL, "Confirm email and continue"),
    footer:
      "You're receiving this because this address was used to sign up at SkillsetMind. If it wasn't you, you can safely ignore this email.",
  },
  {
    file: "magic_link.html",
    slug: "Magic link",
    dashboardTab: "Magic link or OTP",
    subject: "Your SkillsetMind sign-in link",
    preheader: "Your one-time sign-in link for SkillsetMind.",
    title: "Your sign-in link.",
    intro:
      "Use this one-time link to sign in to SkillsetMind. If you received an invitation, you'll review it next. Your access changes only after you accept the invitation.",
    main: button(MAGIC_LINK_URL, "Sign in to SkillsetMind"),
    footer: "If you didn't request this link or expect an invitation, you can safely ignore this email.",
  },
  {
    file: "invite.html",
    slug: "Invite user",
    dashboardTab: "Invite user",
    subject: "You're invited to SkillsetMind",
    preheader: "You've been invited to join SkillsetMind.",
    title: "You're invited.",
    intro:
      "You've been invited to join SkillsetMind, where coaches, facilitators, and personal-development experts sell their own courses. Click below to create your account.",
    main: button(CONFIRMATION_URL, "Accept invitation"),
    footer: "If you weren't expecting this invitation, you can safely ignore this email.",
  },
  {
    file: "email_change.html",
    slug: "Change email address",
    dashboardTab: "Change email address",
    subject: "Confirm your email change for SkillsetMind",
    preheader: "Confirm the email address change on your SkillsetMind account.",
    title: "Confirm your email change.",
    // Sent to the current AND the new address when secure email change is on,
    // so the copy names both instead of assuming which inbox this is.
    intro:
      "We received a request to change the email address on your SkillsetMind account from {{ .Email }} to {{ .NewEmail }}. Click below to confirm the change. If you didn't ask for this, don't click the link and contact us.",
    main: button(EMAIL_CHANGE_URL, "Confirm email change"),
    footer:
      "If we also emailed your other address, confirm there too. Your current address stays active until the change is confirmed.",
  },
  {
    file: "reauthentication.html",
    slug: "Reauthentication",
    dashboardTab: "Reauthentication",
    subject: "Your SkillsetMind verification code",
    preheader: "Your SkillsetMind verification code.",
    title: "Confirm it's you.",
    intro:
      "Use this code to confirm the action on your SkillsetMind account. It expires shortly &mdash; don't share it with anyone.",
    main: codeBox("{{ .Token }}"),
    outro:
      "If you didn't try to do this, ignore this email and consider changing your password.",
    footer: "",
  },
];

for (const t of TEMPLATES) {
  writeFileSync(join(OUT_DIR, t.file), shell(t), "utf8");
  console.log(`wrote supabase/templates/${t.file}`);
}
console.log(`\n${TEMPLATES.length} templates generated.`);
