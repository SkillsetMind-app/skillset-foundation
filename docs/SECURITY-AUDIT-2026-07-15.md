# Security audit — SkillsetMind (2026-07-15)

Sources: YuriRDev common vulns, Tea-app case study, Elber secrets case, vibecoder pentest video, checklist from prior session.

## Tooling decision

| Tool | Decision | Why |
|------|----------|-----|
| **TruffleHog** | **Installed** (scoop 3.95.9) + CI | Free, verifies live keys, matches Elber/Tea secret leaks |
| **Semgrep** | **Installed** (1.169) + CI | Free SAST for TS/Next; no paid seat |
| **Snyk** | **Skip** (use `npm audit`) | Account/paid; audit covers high+ deps |
| **GitGuardian** | **Skip** | Overlap with TruffleHog for solo/small team |

## Already strong (no change required)

| Control | Evidence |
|---------|----------|
| Stripe webhook signature | `constructEvent` + missing sig → 400 |
| Service role server-only | `admin.ts` reads non-public env |
| Checkout rate limit | `enforce_rate_limit` RPC |
| Checkout lock (double-click) | `claim_checkout_lock` |
| Price from DB not body | `normalizeCoursePrice(course)` |
| Teacher cannot buy own course | checkout guard |
| Payout hold ~30d | `payoutReleaseDelayDays` + cron |
| Self-affiliate rejected | `resolveAffiliateAttribution` |
| XSS schemes on external links | `getSafeExternalUrl` |
| `.env*` gitignored | `.gitignore` |

## Gaps found → actions this session

| Gap | Severity | Action |
|-----|----------|--------|
| Affiliate commission not clawed on refund | **High** (money glitch) | `clawbackAffiliateCommissionLedger` on `charge.refunded` |
| Any external cover/media URL | **Medium** (tracker/IP) | `getSafeMediaUrl` allowlist helper + tests |
| No secrets/SAST gate in CI | **High** process | `.github/workflows/security.yml` |
| product_offers tables missing on live | **Medium** ops | Migration SQL ready; DB password not in vault for `ijtikld` |
| Affiliate settlement on paid webhook | **High** (was pending) | Implemented in prior slice (uncommitted → commit now) |

## Residual (next sessions)

1. Apply `20260715_product_offers_prices_only.sql` in Supabase SQL Editor (no DB password for live ref in vault).
2. Wire `getSafeMediaUrl` into remaining image write paths beyond course_cover (helper + cover path done).
3. Red-team race test: 10 parallel checkouts same user/course (integration).
4. RLS audit dump of all public tables (needs SQL editor / linked supabase CLI).
5. Optional: longer hold specifically for `kind=affiliate_commission` beyond teacher hold if refund window expands.

## Local TruffleHog finding (2026-07-15)

- Verified **Apify** API key found only under **`.next/dev/cache/`** (build artifact), not in source.
- `.next` is gitignored — not committed. Still: **rotate Apify key** in vault/provider if it was ever used on this machine with dev server, and clear local `.next` cache.
- CI TruffleHog scans git only (`actions/checkout`), not local `.next`.

## Commands for local re-scan

```bash
trufflehog filesystem . --only-verified
semgrep scan --config p/typescript --config p/security-audit --config p/secrets src/
npm audit --omit=dev --audit-level=high
npx vitest run src/domain/affiliate-attribution.test.tsx src/domain/external-url.test.tsx
```
