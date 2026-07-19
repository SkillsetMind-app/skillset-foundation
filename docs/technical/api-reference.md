# API REFERENCE
## Firebase callable functions, webhooks, and system actions

> **Version:** 0.1.0
> **Updated:** 2026-05-25
> **Status:** Living document

---

## Overview

Skillset currently uses Firebase Callable Functions and Stripe webhooks instead of a public REST API.

Client adapters live in `src/lib/data`.
Backend functions live in `functions/src/index.ts`.

---

## Authentication

All callable functions that mutate user, course, payment, or enrollment state require Firebase Authentication unless noted otherwise.

Common errors:

| Error | Meaning |
|-------|---------|
| `unauthenticated` | User must sign in. |
| `permission-denied` | User does not own the resource or lacks required role. |
| `invalid-argument` | Payload failed validation. |
| `failed-precondition` | Required account, course, or payment state is missing. |
| `not-found` | Resource does not exist. |

---

## Course Functions

### `createTeacherCourseDraft`

Creates a teacher-owned draft course.

Request:

```json
{
  "title": "Advanced Product Design",
  "summary": "A practical course for product teams.",
  "category": "Design and creative",
  "categories": ["Design and creative", "Business and management"],
  "paymentType": "one_time"
}
```

Response:

```json
{
  "courseId": "course_document_id"
}
```

Notes:

- Requires authenticated teacher context.
- Normalizes title into `titleKey`.
- Validates categories and payment type.
- Prevents invalid duplicate title keys according to backend logic.

### `updateTeacherCourseBuilder`

Saves the builder state for an editable course.

Request:

```json
{
  "courseId": "course_document_id",
  "title": "Advanced Product Design",
  "summary": "Course description",
  "category": "Design and creative",
  "categories": ["Design and creative"],
  "modules": [],
  "priceAmountMinor": 9900,
  "currency": "USD",
  "paymentType": "one_time",
  "installmentsEnabled": false,
  "installmentsMax": null,
  "platformFeeBps": 1000,
  "dripStrategy": "instant",
  "dripIntervalDays": null,
  "freePreviewLessonId": null
}
```

Response:

```json
{
  "success": true
}
```

### `submitTeacherCourseForReview`

Moves a course into review.

Request:

```json
{
  "courseId": "course_document_id"
}
```

Response:

```json
{
  "success": true
}
```

---

## Enrollment And Checkout Functions

### `createCheckoutSession`

Creates a Stripe Checkout Session for a paid course.

Request:

```json
{
  "courseId": "course_document_id"
}
```

Response:

```json
{
  "url": "https://checkout.stripe.com/..."
}
```

Critical rule:

- The client redirect is not fulfillment. The Stripe webhook must create final order/enrollment records.

### `createFreeCourseEnrollment`

Creates enrollment for a free course.

Request:

```json
{
  "courseId": "course_document_id"
}
```

Response:

```json
{
  "success": true,
  "enrollmentId": "userId__courseId"
}
```

---

## Teacher Stripe Connect Functions

### `createConnectAccountSession`

Creates an embedded Stripe Connect onboarding session.

Request:

```json
{}
```

Response:

```json
{
  "clientSecret": "account_session_client_secret"
}
```

Notes:

- Uses Stripe Connect Express.
- Used for embedded onboarding inside Skillset.
- Skillset does not collect bank, tax, or regulated identity data directly.

### `createTeacherStripeAccountLink`

Creates a hosted Stripe onboarding fallback link.

Request:

```json
{}
```

Response:

```json
{
  "url": "https://connect.stripe.com/..."
}
```

### `refreshTeacherStripeAccount`

Refreshes the teacher Stripe Connect status from Stripe.

Request:

```json
{}
```

Response:

```json
{
  "chargesEnabled": true,
  "payoutsEnabled": true,
  "status": "ready"
}
```

---

## Refund Function

### `requestRefund`

Requests a refund when the order is inside the automatic refund window and policy permits it.

Request:

```json
{
  "orderId": "order_document_id",
  "reason": "Requested within refund window"
}
```

Response:

```json
{
  "success": true
}
```

---

## Billing Functions

### `createBillingCheckoutSession`

Starts Stripe Billing checkout for a creator plan.

Request:

```json
{
  "planId": "starter",
  "billingInterval": "monthly"
}
```

Response:

```json
{
  "url": "https://checkout.stripe.com/..."
}
```

### `createBillingPortalSession`

Creates a Stripe Billing customer portal session.

Request:

```json
{}
```

Response:

```json
{
  "url": "https://billing.stripe.com/..."
}
```

---

## Account Functions

| Function | Purpose |
|----------|---------|
| `requestDataExport` | Creates a data export request. |
| `requestAccountDeletion` | Creates an account deletion request. |

---

## Certificate Functions

| Function | Purpose |
|----------|---------|
| `issueSkillsetCertificate` | Issues a course certificate. |
| `verifySkillsetCertificate` | Verifies a certificate through callable function. |
| `verifySkillsetCertificateHttp` | Public HTTP certificate verification endpoint. |

---

## Webhooks And Scheduled Jobs

| Function | Type | Purpose |
|----------|------|---------|
| `stripeWebhook` | HTTP request | Handles Stripe payment, billing, and account events. |
| `dailyReleaseTransfers` | Scheduled job | Releases eligible teacher transfers after refund window. |
