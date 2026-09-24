# Stripe AUOPS Webhook

Environment: test
Stripe account email: (e-mail operacional)
Firebase project: skillsetusaofficial
Webhook URL: (endpoint antigo do Firebase, desativado)
Webhook endpoint ID: we_…
Enabled events:
- checkout.session.completed
- checkout.session.expired
- payment_intent.payment_failed
- charge.refunded

Secrets are stored in Firebase Secret Manager:
- STRIPE_SECRET_KEY
- STRIPE_WEBHOOK_SECRET

Do not commit or paste secret values into source files.
