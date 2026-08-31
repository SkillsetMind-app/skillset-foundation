# Supabase Auth email templates (branded)

Canonical source for the transactional auth emails. The Supabase dashboard is
the runtime; these files are the version-controlled truth — edit here first,
then re-paste.

## How to apply (2 minutes, founder or anyone with dashboard access)

1. Open https://supabase.com/dashboard/project/ijtikldtjvsbtwszokvs/auth/templates
2. **Confirm signup** tab:
   - Subject: `Welcome to SkillsetMind — confirm your email`
   - Body: paste the full contents of `confirmation.html`
3. **Reset password** tab:
   - Subject: `Reset your SkillsetMind password`
   - Body: paste the full contents of `recovery.html`
4. Save. Takes effect immediately for new emails (no deploy needed).

Keep every `{{ . }}` placeholder exactly as written — Supabase substitutes them
at send time.

## Why recovery.html does NOT use `{{ .ConfirmationURL }}`

`confirmation.html` still uses it; `recovery.html` deliberately builds its own
link with `{{ .TokenHash }}` pointing at `/auth/confirm`. Reason:

`{{ .ConfirmationURL }}` routes through Supabase's `/auth/v1/verify`, which
hands the app a PKCE `?code=`. Exchanging that code requires a `code_verifier`
cookie held only by the browser **and origin** that requested the reset. A
recovery email is routinely opened somewhere else — the phone, an in-app
webview, another browser — so the exchange failed while the one-time token had
already been burned. Users saw "link expired" on a link that was never expired.
`{{ .TokenHash }}` + `verifyOtp` is stateless and works anywhere.

Two settings this depends on (Dashboard → Authentication → URL Configuration).
Both were verified correct on 2026-08-31 — **leave them alone**:

- **Site URL** = `https://www.skillsetmind.com`. The `www` host is canonical in
  production: the apex 301-redirects to it. `{{ .SiteURL }}` builds the recovery
  link, so pointing this at the apex would route every reset through a redirect.
- **Redirect URLs** allowlist = `https://www.skillsetmind.com` and
  `https://www.skillsetmind.com/**`. Already covers the recovery landing.

Note the inconsistency this exposes: `src/lib/seo/page-metadata.ts` and
`src/domain/host-routing.ts` declare the apex `https://skillsetmind.com` as the
canonical origin, while production actually serves `www`. Harmless for auth
(auth builds its URLs from `window.location.origin` or `{{ .SiteURL }}`), but the
SEO canonical currently points at a redirecting host. Worth reconciling
separately.

## Sender address (the remaining 10%)

With templates applied, the email CONTENT is fully branded, but the sender
still shows `Supabase Auth <noreply@mail.app.supabase.io>` until custom SMTP
is configured. To send as `SkillsetMind <no-reply@skillset...>`:

1. Create a free Resend account (3k emails/month free) and verify the
   platform's domain (requires adding DNS records).
2. Supabase Dashboard → Project Settings → Authentication → SMTP Settings:
   host `smtp.resend.com`, port 465, user `resend`, password = Resend API key,
   sender name `SkillsetMind`, sender email on the verified domain.
3. Store the Resend API key in the vault as `SKILLSET_RESEND_API_KEY` — never
   in this repo.

Founder-gated: needs domain DNS access + a Resend account. Everything else is
done.
