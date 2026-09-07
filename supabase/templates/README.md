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

## Why recovery.html and confirmation.html do NOT use `{{ .ConfirmationURL }}`

`recovery.html` and, since 2026-09-02, `confirmation.html` deliberately build
their own link with `{{ .TokenHash }}` pointing at `/auth/confirm` (invite and
email change still use `{{ .ConfirmationURL }}`). Magic Link now does too. Reason:

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

## Manual course access — prepared, NOT published

The versioned Magic Link template now uses `TokenHash`, `type=email` and
`next=/loading%3Fnext%3Droute`. The existing confirmation route verifies the token
on any device, then the regular auth flow claims grants after MFA. The learner
finds the course in their learning workspace. A failed claim does not block
sign-in; a later auth event or session refresh retries safely.

GoTrue sends Confirm Signup for new/unconfirmed accounts requested through OTP,
not Magic Link ([official source](https://github.com/supabase/auth/blob/master/internal/api/magic_link.go)).
Both templates carry `RedirectTo` encoded by Go's `urlquery`. The confirmation
route accepts only its own origin and the known `/auth/confirm` or `/loading`
entry paths. It extracts a safe internal `next`, and validates nested `returnTo`
with the existing auth-routing guard. This also preserves a signup's course and
offer on another device. Invalid destinations fall back to `/welcome`; old links
without `redirect_to` still work. New accounts use `type=signup`.

Before deploying the manual-access route, obtain specific approval to apply
`20260906010000_creator_course_access.sql` and publish `magic_link.html` plus
`confirmation.html` in Authentication → Email Templates. Keep the signup subject
unchanged and the Magic Link subject
`Your SkillsetMind sign-in link`. Verify the effective Site URL, allowed redirect
URLs, SMTP and template first; the historical checks below are not current proof.
No configuration, migration or real email was changed/sent by this implementation.

Rollout order: approved migration, approved compatible template, then app deploy.
Rollback: revert the app to stop new sends; retain the additive table and grant
history, existing enrollments and compatible template. Do not drop grant rows or
delete enrollments as a rollback. The new RPCs may be disabled explicitly if
needed; that is a separate production change requiring approval.

Email delivery is separate from access: a failed send leaves the grant recorded.
Resend uses the authorized stored address and allows at most three attempts per
grant per hour, with an additional owner-wide limit. No provider errors or tokens
are shown to the creator. Pending accounts must confirm their Auth email.

## Sender address — historical verification

Custom SMTP is configured. Verified 2026-09-01 by sending a real recovery email:
it arrived from `no-reply@skillsetmind.com`, not the Supabase default sender.

This section previously claimed the sender was still
`Supabase Auth <noreply@mail.app.supabase.io>` and that SMTP was "founder-gated".
That was stale, and it mattered: it also implied the default mailer's ~2
emails/hour cap still applied to reset links, which it does not.

If SMTP ever needs reconfiguring, it lives in Dashboard → Project Settings →
Authentication → SMTP Settings. Keep the provider's API key in the vault, never
in this repo.

## End-to-end verification (2026-09-01)

A real reset was requested and the link followed from a client with **no cookies
and no prior session** — the exact case that used to fail, because the PKCE
`code_verifier` only ever existed in the requesting browser:

```
hop 1: 307 /auth/confirm?token_hash=...
       set-cookie: password_recovery, sb-<ref>-auth-token
       -> /reset-password
hop 2: 200 /reset-password   (reset form rendered, no expiry error)
```

Worth re-running after any change to the recovery flow. The check that matters
is the cold client: opening the link in the *same* browser that requested it
would have passed even while the bug was live.
