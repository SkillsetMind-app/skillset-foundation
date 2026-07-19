# Summary 02-01: Subscription Creation and Order Integrity

## Delivered

- Added a product-format choice for Course, Subscription, and Free course.
- Added monthly/yearly billing interval for subscriptions.
- Mapped format plus interval to the existing stored payment types and recurring checkout.
- Routed paid drafts to Pricing and free drafts to Curriculum.
- Preserved creator ownership, refund, receipt, payout, and lifecycle fields in order mapping.
- Versioned Hotmart research, the parity audit, requirements, roadmap, and phase context.

## Verification

- `npx tsc --noEmit` - passed.
- `npm run lint` - passed.
- `npm test` - 33 files, 173 tests passed.
- `npm run build` - passed; 96 static pages generated.
- Playwright/Chrome visual QA at 1440x1100 and 390x844 - passed without overlap or text overflow.

## Evidence

- `evidence/subscription-creation-desktop.png`
- `evidence/subscription-creation-mobile.png`

## Deferred by design

COM-04 and SUB-01..SUB-04 remain separate money-path plans. They require live-schema recovery, migration review, webhook idempotency, reconciliation, and refund tests beyond this UI/data-mapper slice.
