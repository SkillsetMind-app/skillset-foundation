// Builds a standalone review page showing every generated auth email rendered.
// Reads supabase/templates/*.html off disk so the preview can never drift from
// what actually gets pasted into the dashboard.
//
//   node scripts/build-email-preview.mjs [outPath]

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TPL_DIR = join(ROOT, "supabase", "templates");
const outPath = process.argv[2] ?? join(ROOT, "email-preview.html");

const SHEET = [
  { file: "recovery.html", tab: "Reset password", subject: "Reset your SkillsetMind password", variable: "{{ .TokenHash }}", note: "Rebuilt to use token_hash — the fix for the cross-browser reset failure." },
  { file: "confirmation.html", tab: "Confirm sign up", subject: "Welcome to SkillsetMind — confirm your email", variable: "{{ .ConfirmationURL }}", note: "Sent the moment someone signs up." },
  { file: "magic_link.html", tab: "Magic link or OTP", subject: "Your SkillsetMind sign-in link", variable: "{{ .ConfirmationURL }}", note: "Passwordless sign-in link." },
  { file: "invite.html", tab: "Invite user", subject: "You're invited to SkillsetMind", variable: "{{ .ConfirmationURL }}", note: "Sent when an admin invites someone." },
  { file: "email_change.html", tab: "Change email address", subject: "Confirm your new email for SkillsetMind", variable: "{{ .ConfirmationURL }}", note: "Confirms the new address, not the old one." },
  { file: "reauthentication.html", tab: "Reauthentication", subject: "Your SkillsetMind verification code", variable: "{{ .Token }}", note: "A 6-digit code, not a link." },
];

// The logo URL in the templates points at production, where the new artwork
// isn't deployed yet. Inline the local file so the preview shows the real thing
// instead of a broken image.
const LOGO_FILE = join(ROOT, "public", "brand", "logo-lockup-on-navy.png");
const LOGO_DATA_URI =
  "data:image/png;base64," + readFileSync(LOGO_FILE).toString("base64");

// Stand-in values so previews read like a real delivered email.
const SAMPLE = [
  [/https:\/\/www\.skillsetmind\.com\/brand\/logo-lockup-on-navy\.png/g, LOGO_DATA_URI],
  [/\{\{ \.SiteURL \}\}/g, "https://www.skillsetmind.com"],
  [/\{\{ \.TokenHash \}\}/g, "pkce_a41f9c6b2e7d"],
  [/\{\{ \.ConfirmationURL \}\}/g, "https://www.skillsetmind.com/auth/confirm?token_hash=pkce_a41f9c6b2e7d&amp;type=signup"],
  [/\{\{ \.Token \}\}/g, "418302"],
];

const cards = SHEET.map((entry) => {
  const raw = readFileSync(join(TPL_DIR, entry.file), "utf8");
  const rendered = SAMPLE.reduce((html, [re, val]) => html.replace(re, val), raw);
  return { ...entry, html: rendered };
});

// Templates carry no </script>, so a text/template block is a safe carrier and
// spares us escaping the whole document into an srcdoc attribute.
const payload = cards
  .map(
    (c) => `<script type="text/template" data-email="${c.file}">
${c.html}
</script>`,
  )
  .join("\n");

const rows = cards
  .map(
    (c) => `      <article class="card">
        <div class="meta">
          <h2>${c.tab}</h2>
          <dl>
            <dt>File</dt><dd><code>${c.file}</code></dd>
            <dt>Subject</dt><dd>${c.subject}</dd>
            <dt>Variable</dt><dd><code>${c.variable.replace(/</g, "&lt;")}</code></dd>
          </dl>
          <p class="note">${c.note}</p>
        </div>
        <div class="frame">
          <div class="chrome"><span></span><span></span><span></span></div>
          <iframe title="${c.tab} email preview" data-for="${c.file}" loading="lazy"></iframe>
        </div>
      </article>`,
  )
  .join("\n");

const page = `<title>SkillsetMind Auth Emails</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700&family=Source+Sans+3:wght@400;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
  :root {
    --ground: #f4f7fb;
    --panel: #ffffff;
    --navy: #102a43;
    --navy-soft: #315a7d;
    --brass: #c99a46;
    --ink: #17293d;
    --ink-soft: #4a6278;
    --ink-faint: #6b7f96;
    --line: #dbe5f0;
    --frame: #e8eef6;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --ground: #0b1420;
      --panel: #111c2b;
      --navy: #8fb4e4;
      --navy-soft: #b8d2f0;
      --brass: #d9b169;
      --ink: #e8edf5;
      --ink-soft: #a9b7ca;
      --ink-faint: #8493ad;
      --line: #22334a;
      --frame: #16233a;
    }
  }
  :root[data-theme="dark"] {
    --ground: #0b1420;
    --panel: #111c2b;
    --navy: #8fb4e4;
    --navy-soft: #b8d2f0;
    --brass: #d9b169;
    --ink: #e8edf5;
    --ink-soft: #a9b7ca;
    --ink-faint: #8493ad;
    --line: #22334a;
    --frame: #16233a;
  }

  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--ground);
    color: var(--ink);
    font-family: "Source Sans 3", ui-sans-serif, system-ui, sans-serif;
    font-size: 16px;
    line-height: 1.6;
  }
  .wrap { max-width: 1120px; margin: 0 auto; padding: 56px 24px 80px; }

  header { border-bottom: 3px solid var(--brass); padding-bottom: 28px; margin-bottom: 8px; }
  .eyebrow {
    font-family: "IBM Plex Mono", ui-monospace, monospace;
    font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase;
    color: var(--ink-faint); margin: 0 0 12px;
  }
  h1 {
    font-family: Archivo, ui-sans-serif, system-ui, sans-serif;
    font-weight: 700; font-size: clamp(30px, 4.4vw, 46px); line-height: 1.08;
    letter-spacing: -0.02em; margin: 0 0 14px; color: var(--navy);
    text-wrap: balance;
  }
  .lede { margin: 0; max-width: 62ch; color: var(--ink-soft); font-size: 17px; }

  .swatches {
    display: flex; flex-wrap: wrap; gap: 10px;
    margin: 32px 0 44px; padding: 0; list-style: none;
  }
  .swatches li {
    display: flex; align-items: center; gap: 9px;
    border: 1px solid var(--line); border-radius: 999px;
    padding: 6px 14px 6px 7px; background: var(--panel);
    font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: 12px;
    color: var(--ink-soft);
  }
  .chip { width: 18px; height: 18px; border-radius: 50%; border: 1px solid var(--line); flex: none; }
  .swatches li.gone { opacity: 0.55; }
  .swatches li.gone code { text-decoration: line-through; }

  .card {
    display: grid; grid-template-columns: minmax(230px, 300px) 1fr; gap: 32px;
    padding: 32px 0; border-top: 1px solid var(--line); align-items: start;
  }
  .card:first-of-type { border-top: none; }
  .meta h2 {
    font-family: Archivo, ui-sans-serif, system-ui, sans-serif;
    font-size: 21px; font-weight: 600; letter-spacing: -0.01em;
    margin: 0 0 16px; color: var(--navy);
  }
  dl { margin: 0 0 14px; display: grid; grid-template-columns: auto 1fr; gap: 5px 12px; font-size: 14px; }
  dt {
    font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: 11px;
    letter-spacing: 0.09em; text-transform: uppercase; color: var(--ink-faint);
    padding-top: 3px;
  }
  dd { margin: 0; color: var(--ink-soft); }
  code {
    font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: 12.5px;
    background: var(--frame); border-radius: 4px; padding: 1px 5px; color: var(--ink);
  }
  .note { margin: 0; font-size: 14px; color: var(--ink-faint); border-left: 2px solid var(--brass); padding-left: 12px; }

  .frame { border: 1px solid var(--line); border-radius: 12px; overflow: hidden; background: var(--frame); }
  .chrome { display: flex; gap: 6px; padding: 10px 13px; border-bottom: 1px solid var(--line); }
  .chrome span { width: 9px; height: 9px; border-radius: 50%; background: var(--line); }
  iframe { display: block; width: 100%; height: 620px; border: 0; background: #eef4fc; }

  footer {
    margin-top: 48px; padding-top: 26px; border-top: 1px solid var(--line);
    color: var(--ink-faint); font-size: 14px;
  }
  footer strong { color: var(--ink); font-weight: 600; }

  @media (max-width: 760px) {
    .card { grid-template-columns: 1fr; gap: 20px; }
    iframe { height: 540px; }
  }
</style>

<div class="wrap">
  <header>
    <p class="eyebrow">Supabase Auth · 6 templates</p>
    <h1>Every auth email, in brand navy</h1>
    <p class="lede">
      The old set was black on beige with a typed wordmark and an accent that
      wasn't the brand accent. These are rebuilt on the palette in
      <code>globals.css</code>, with the real logo. Rendered below exactly as
      generated — sample values stand in for the Supabase variables.
    </p>
  </header>

  <ul class="swatches">
    <li class="gone"><span class="chip" style="background:#0f0f0f"></span><code>#0f0f0f</code> old header</li>
    <li class="gone"><span class="chip" style="background:#b3914b"></span><code>#b3914b</code> old accent</li>
    <li class="gone"><span class="chip" style="background:#f5f5f3"></span><code>#f5f5f3</code> old ground</li>
    <li><span class="chip" style="background:#102a43"></span><code>#102a43</code> navy</li>
    <li><span class="chip" style="background:#c99a46"></span><code>#c99a46</code> brass</li>
    <li><span class="chip" style="background:#eef4fc"></span><code>#eef4fc</code> ground</li>
  </ul>

${rows}

  <footer>
    <strong>Not live yet.</strong> Only <code>recovery.html</code> is in the
    dashboard. The other five still need pasting into
    Authentication → Emails. Regenerate any of them with
    <code>node scripts/build-email-templates.mjs</code>.
  </footer>
</div>

${payload}

<script>
  for (const tpl of document.querySelectorAll('script[type="text/template"][data-email]')) {
    const frame = document.querySelector('iframe[data-for="' + tpl.dataset.email + '"]');
    if (!frame) continue;
    const doc = frame.contentDocument;
    doc.open();
    doc.write(tpl.textContent);
    doc.close();
  }
</script>
`;

writeFileSync(outPath, page, "utf8");
console.log("wrote " + outPath);
