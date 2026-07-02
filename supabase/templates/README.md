# Supabase Auth email templates (branded)

Canonical source for the transactional auth emails. The Supabase dashboard is
the runtime; these files are the version-controlled truth — edit here first,
then re-paste.

## How to apply (2 minutes, founder or anyone with dashboard access)

1. Open https://supabase.com/dashboard/project/ijtikldtjvsbtwszokvs/auth/templates
2. **Confirm signup** tab:
   - Subject: `Welcome to Skillset — confirm your email`
   - Body: paste the full contents of `confirmation.html`
3. **Reset password** tab:
   - Subject: `Reset your Skillset password`
   - Body: paste the full contents of `recovery.html`
4. Save. Takes effect immediately for new emails (no deploy needed).

Keep the `{{ .ConfirmationURL }}` placeholders exactly as written — Supabase
substitutes them at send time.

## Sender address (the remaining 10%)

With templates applied, the email CONTENT is fully branded, but the sender
still shows `Supabase Auth <noreply@mail.app.supabase.io>` until custom SMTP
is configured. To send as `Skillset <no-reply@skillset...>`:

1. Create a free Resend account (3k emails/month free) and verify the
   platform's domain (requires adding DNS records).
2. Supabase Dashboard → Project Settings → Authentication → SMTP Settings:
   host `smtp.resend.com`, port 465, user `resend`, password = Resend API key,
   sender name `Skillset`, sender email on the verified domain.
3. Store the Resend API key in the vault as `SKILLSET_RESEND_API_KEY` — never
   in this repo.

Founder-gated: needs domain DNS access + a Resend account. Everything else is
done.
