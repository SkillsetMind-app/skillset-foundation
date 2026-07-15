# Backfill subscription invoices — dry-run report

**Stripe mode:** `live`  
**Supabase host:** `ijtikldtjvsbtwszokvs.supabase.co`  

## Supabase row counts

| Table | Count |
|-------|------|
| `courses` | 0 |
| `orders` | 0 |
| `payments` | 0 |
| `course_subscriptions` | 0 |
| `payout_ledger` | 0 |
| `enrollments` | 0 |
| `subscriptions` | 0 |
| `public_profiles` | 0 |

## Stripe scan

- Paid invoices scanned: **0**
- With subscription: **0**
- `purpose=course_subscription`: **0**
- Incomplete metadata: **0**
- Already in `payout_ledger`: **0**
- **Need backfill: 0**

## Recommendation

No Skillset course subscription invoices found in Stripe (up to scan limit). Backfill apply step is a no-op until real subscription sales exist.

## Safety

- Dry-run only in this script (no writes).
- Apply path: temporary admin script or Stripe event re-send after code deploy.
