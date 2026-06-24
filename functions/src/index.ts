import { initializeApp } from "firebase-admin/app";
import {
  getFirestore,
  FieldValue,
  Timestamp,
  type DocumentReference,
  type Query,
} from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
import { captureServerEvent, SERVER_EVENTS } from "./posthog";
import {
  AUDIT_ACTIONS,
  AUDIT_LOG_COLLECTION,
  buildAuditEntry,
  type AuditEventInput,
} from "./audit-log";
import {
  buildCoursePublishedProperties,
  isCoursePublishTransition,
} from "./course-analytics";
import {
  TRENDING_WINDOW_DAYS,
  aggregateTrendingCounts,
  readEnrollmentCourseId,
  resolveTrendingScore,
  trendingWriteNeeded,
} from "./course-trending";
import { setGlobalOptions } from "firebase-functions/v2";
import {
  HttpsError,
  onCall,
  onRequest,
  type CallableRequest,
} from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import {
  onDocumentCreated,
  onDocumentDeleted,
  onDocumentUpdated,
  onDocumentWritten,
} from "firebase-functions/v2/firestore";
import Stripe from "stripe";
import {
  automaticRefundProgressCap,
  automaticRefundWindowDays,
  canonicalPlatformFeeBpsForPlan,
  claimStripeEvent,
  createReleasedRefundTransferReversal,
  DEFAULT_PLATFORM_FEE_BPS,
  decideCheckoutLock,
  decideRefundReversalClaim,
  ledgerRefundStatus,
  markStripeEventDone,
  paidOrderRefundQuerySpec,
  payoutReleaseDelayDays,
  plannedReleaseTransferAmountMinor,
  refundReversalClaimKey,
  type RefundReversalClaimRecord,
  resolveInvoicePaymentIntentId,
  resolvePayoutReleaseDelayDays,
  sanitizeStripeSecret,
  shouldApplyOrderStatusTransition,
  shouldReleaseCheckoutLock,
  shouldReverseReleasedPayout,
  stripeProcessingFeeMinor as canonicalStripeProcessingFeeMinor,
  type TransferReversalStripeClient,
} from "./payment-rules";
import {
  isConnectNotEnabledError,
  isUnusableConnectedAccountError,
  runWithOrphanedAccountSelfHeal,
} from "./stripe-connect-self-heal";

initializeApp();
setGlobalOptions({ region: "us-central1", maxInstances: 10 });

const db = getFirestore();
const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");
const fallbackAppUrl = "https://skillsetusaofficial.web.app";

type SkillsetCurrency = string;

const defaultSkillsetCurrency = "USD";
const supportedStripeCurrencies = new Set([
  "USD",
  "EUR",
  "GBP",
  "CAD",
  "AUD",
  "BRL",
  "MXN",
  "NGN",
  "ZAR",
  "GYD",
  "ARS",
  "BBD",
  "BMD",
  "CLP",
  "COP",
  "CRC",
  "DOP",
  "GHS",
  "GTQ",
  "HKD",
  "INR",
  "JMD",
  "JPY",
  "KES",
  "NZD",
  "PEN",
  "SGD",
  "TTD",
  "UYU",
  "XCD",
]);

type TeacherCourseRecord = {
  ownerId: string;
  title: string;
  titleKey?: string;
  summary?: string;
  category: string;
  categories?: string[];
  learningOutcomes?: string[];
  status: string;
  modules?: unknown;
  lessonCount?: number;
  priceAmountMinor?: number | null;
  paymentType?: string | null;
  currency?: SkillsetCurrency;
  platformFeeBps?: number;
  coverImageUrl?: string | null;
  stripeConnectedAccountId?: string | null;
  ratingAverage?: number;
  ratingCount?: number;
  ratingSum?: number;
  reviewCount?: number;
  // Cached recurring Stripe Price for course-subscription checkout. Stripe
  // Prices are immutable, so any change to the course price/cadence mints a
  // fresh one (see getOrCreateCourseSubscriptionPrice). Lives on the PLATFORM
  // account — the subscription charges the platform Customer and the teacher
  // payout is a held Transfer (separate charges & transfers), exactly like the
  // one-time rail.
  stripeSubscriptionPrice?: {
    priceId: string;
    amountMinor: number;
    currency: string;
    interval: "month" | "year";
  } | null;
};

type UserProfileRecord = {
  uid: string;
  email?: string | null;
  displayName?: string | null;
  username?: string | null;
  bio?: string | null;
  photoURL?: string | null;
  // Optional handwritten-signature image a teacher uploads; snapshotted onto
  // every certificate they issue (see issueSkillsetCertificate).
  teacherSignatureUrl?: string | null;
  // Client-writable free-form list; the public-profile projector sanitizes it,
  // so it is intentionally typed `unknown` (never trusted as string[]).
  credentials?: unknown;
  roles?: string[];
  stripeConnectedAccountId?: string | null;
  stripeConnectStatus?: string;
  stripeConnectChargesEnabled?: boolean;
  stripeConnectPayoutsEnabled?: boolean;
  currentPlanId?: string | null;
};

type EnrollmentRecord = {
  id: string;
  userId: string;
  courseId: string;
  courseSlug: string;
  courseTitle: string;
  courseCategory: string;
  status: string;
  source?: string;
  progressPercent?: number;
};

type PayoutLedgerRecord = {
  id: string;
  teacherId: string;
  teacherStripeConnectedAccountId?: string | null;
  courseId: string;
  orderId: string;
  paymentId: string;
  /** "course_subscription" for subscription-invoice payouts; absent for one-off. */
  kind?: string;
  /** Stripe invoice id backing a subscription payout (doc id for those). */
  invoiceId?: string;
  /** Stripe subscription id for a course-subscription payout. */
  subscriptionId?: string;
  /**
   * True when `paymentId` is the invoice's real PaymentIntent id (`pi_…`) — the
   * join key the subscription refund clawback matches on (charge.payment_intent).
   * False only when PI resolution returned null after a SUCCESSFUL invoice
   * retrieve (a charge-less invoice: $0/fully-discounted/credit-balance), so the
   * `paymentId` falls back to the invoice id (`in_…`), a namespace that can never
   * collide with a real PaymentIntent. Recorded so the "no PaymentIntent ⇒ no
   * refundable charge" invariant is AUDITABLE in data — query
   * `paymentIdIsPaymentIntent == false` to confirm no degraded row ever carried a
   * refundable charge — instead of living only in a code comment (round-3 review).
   */
  paymentIdIsPaymentIntent?: boolean;
  grossAmountMinor: number;
  skillsetFeeMinor: number;
  stripeFeeMinor?: number;
  netAmountMinor: number;
  currency: SkillsetCurrency;
  status: string;
  releaseAt?: unknown;
  releaseAttemptCount?: number;
  /** Set on every release claim; lets the recovery sweep age stuck claims. */
  lastReleaseAttemptAt?: unknown;
  transferId?: string | null;
  transferReversedAmountMinor?: number | null;
  refundedAmountMinor?: number | null;
  /**
   * Amount actually moved to the teacher when the payout was released. Equals
   * netAmountMinor for a full payout, or the reduced
   * plannedTransferAmountMinor when a partial refund landed before release.
   * Recorded so a later refund reverses against what truly left the platform,
   * not the full net (Gap 1).
   */
  transferAmountMinor?: number | null;
  /**
   * Transfer amount computed once when the ledger is claimed for release, so
   * retries of the same release move an identical amount under a stable
   * idempotency key. Set-once; never recomputed mid-flight (Gap 1).
   */
  plannedTransferAmountMinor?: number | null;
  /**
   * Two-phase claims for charge.refunded deliveries, keyed by
   * `${chargeId}_${cumulativeAmountRefunded}`. Serializes concurrent refund
   * deliveries so each plans its reversal against a fresh counter plus other
   * in-flight reservations (see decideRefundReversalClaim in payment-rules).
   */
  refundReversalClaims?: Record<string, RefundReversalClaimRecord> | null;
};

type CourseReviewRecord = {
  id: string;
  courseId: string;
  // No `userId`: it is deliberately not stored on the world-readable review
  // doc (see submitCourseReview). Identity is the deterministic doc id.
  authorName: string;
  rating: number;
  body?: string | null;
  status: string;
  createdAt?: unknown;
};

type AccountActionRequestType = "account_deletion" | "data_export";

type CertificateVerificationResult =
  | {
      valid: false;
    }
  | {
      valid: true;
      certificate: {
        courseTitle: string;
        courseCategory: string;
        authorityLabel: string;
        verificationCode: string;
        issuedAt: string | null;
      };
    };

function sanitizeRateLimitKey(value: string) {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, "_").slice(0, 220);
}

function getPayoutReleaseAt(delayDays: number = payoutReleaseDelayDays) {
  return Timestamp.fromMillis(
    Date.now() + delayDays * 24 * 60 * 60 * 1000,
  );
}

function timestampToMillis(value: unknown): number | null {
  if (value instanceof Timestamp) {
    return value.toMillis();
  }

  if (
    typeof value === "object"
    && value !== null
    && "toMillis" in value
    && typeof (value as { toMillis?: unknown }).toMillis === "function"
  ) {
    return (value as { toMillis: () => number }).toMillis();
  }

  return null;
}

function normalizeCourseTitleKey(title: string): string {
  return title
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 140);
}

function normalizeCourseCategories(categories: unknown): string[] {
  if (!Array.isArray(categories)) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const category of categories) {
    if (typeof category !== "string") {
      continue;
    }

    const value = category.trim();
    const key = value.toLowerCase();

    if (!value || seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push(value.slice(0, 80));

    if (normalized.length >= 5) {
      break;
    }
  }

  return normalized;
}

const maxLearningOutcomes = 8;
const maxLearningOutcomeLength = 120;

// Mirror of normalizeLearningOutcomes in src/domain/teacher-course.ts. Kept as
// a separate copy because functions/ cannot import from the Next app (@/...).
// Same rules: trim, drop empty, cap each length, cap count. Order preserved.
function normalizeLearningOutcomes(outcomes: unknown): string[] {
  if (!Array.isArray(outcomes)) {
    return [];
  }

  const normalized: string[] = [];

  for (const outcome of outcomes) {
    if (typeof outcome !== "string") {
      continue;
    }

    const value = outcome.trim();

    if (!value) {
      continue;
    }

    normalized.push(value.slice(0, maxLearningOutcomeLength));

    if (normalized.length >= maxLearningOutcomes) {
      break;
    }
  }

  return normalized;
}

const builderLessonTypes = new Set([
  "video",
  "text",
  "quiz",
  "assignment",
  "live_recording",
  "download",
  "external_embed",
]);

const builderDripStrategies = new Set([
  "instant",
  "sequential_progress",
  "time_drip_lesson",
  "time_drip_module",
  "time_drip_custom",
]);

const builderPaymentTypes = new Set([
  "one_time",
  "subscription_monthly",
  "subscription_yearly",
  "free",
]);

// B1 dual-write flag (server mirror). Identical-by-convention copy of
// WRITE_LESSON_CONTENT_INLINE in src/lib/data/lesson-content.ts — the functions
// package compiles from its own rootDir (`src`) and cannot import `@/...`, so
// the flag is mirrored here exactly like normalizeLearningOutcomes. While true,
// updateTeacherCourseBuilder writes lesson contentText/externalUrl BOTH inline
// in the course doc AND into the gated lessonContent subcollection. Flip to
// false (Phase 2) to stop the inline write (subcollection-only) WITHOUT another
// code edit, immediately before the --strip backfill closes the leak. Keep this
// in lockstep with the client flag.
const WRITE_LESSON_CONTENT_INLINE = true;

// Maps a course paymentType to a Stripe recurring interval, or null when the
// course is not a subscription. A course is monthly XOR yearly (single
// paymentType field), so it has at most one recurring cadence.
function courseSubscriptionInterval(
  paymentType?: string | null,
): "month" | "year" | null {
  if (paymentType === "subscription_monthly") return "month";
  if (paymentType === "subscription_yearly") return "year";
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanOptionalText(value: unknown, maxLength = 2000): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const nextValue = value.trim();
  return nextValue ? nextValue.slice(0, maxLength) : null;
}

function cleanCourseReviewBody(value: unknown): string | null {
  const body = cleanOptionalText(value, 1200);

  if (!body) {
    return null;
  }

  if (body.length < 3) {
    throw new HttpsError(
      "invalid-argument",
      "Review text must be at least 3 characters when provided.",
    );
  }

  return body;
}

function cleanRequiredText(
  value: unknown,
  label: string,
  minLength: number,
  maxLength: number,
): string {
  if (typeof value !== "string") {
    throw new HttpsError("invalid-argument", `${label} must be text.`);
  }

  const nextValue = value.trim();

  if (nextValue.length < minLength || nextValue.length > maxLength) {
    throw new HttpsError(
      "invalid-argument",
      `${label} must be between ${minLength} and ${maxLength} characters.`,
    );
  }

  return nextValue;
}

function cleanOptionalInteger(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.round(value);
}

function normalizeBuilderModules(input: unknown) {
  if (!Array.isArray(input)) {
    throw new HttpsError("invalid-argument", "Course modules must be a list.");
  }

  if (input.length > 60) {
    throw new HttpsError("invalid-argument", "Courses can have up to 60 modules.");
  }

  let lessonCount = 0;
  const modules = input.map((module, moduleIndex) => {
    if (!isRecord(module)) {
      throw new HttpsError("invalid-argument", `Module ${moduleIndex + 1} is invalid.`);
    }

    const lessonsInput = module.lessons;

    if (!Array.isArray(lessonsInput)) {
      throw new HttpsError(
        "invalid-argument",
        `Module ${moduleIndex + 1} lessons must be a list.`,
      );
    }

    if (lessonsInput.length > 200) {
      throw new HttpsError(
        "invalid-argument",
        `Module ${moduleIndex + 1} can have up to 200 lessons.`,
      );
    }

    const lessons = lessonsInput.map((lesson, lessonIndex) => {
      if (!isRecord(lesson)) {
        throw new HttpsError(
          "invalid-argument",
          `Lesson ${lessonIndex + 1} in module ${moduleIndex + 1} is invalid.`,
        );
      }

      const type = typeof lesson.type === "string" ? lesson.type : "";

      if (!builderLessonTypes.has(type)) {
        throw new HttpsError(
          "invalid-argument",
          `Lesson ${lessonIndex + 1} has an invalid type.`,
        );
      }

      lessonCount += 1;

      if (lessonCount > 500) {
        throw new HttpsError("invalid-argument", "Courses can have up to 500 lessons.");
      }

      return {
        id: cleanRequiredText(lesson.id, "Lesson id", 3, 160),
        title: cleanRequiredText(lesson.title, "Lesson title", 1, 160),
        type,
        description: cleanOptionalText(lesson.description, 1200) ?? "",
        durationMinutes: cleanOptionalInteger(lesson.durationMinutes),
        contentText: cleanOptionalText(lesson.contentText, 20000),
        externalUrl: cleanOptionalText(lesson.externalUrl, 2000),
        dripDelayDays:
          typeof lesson.dripDelayDays === "number"
            ? Math.max(0, Math.round(lesson.dripDelayDays))
            : null,
        thumbnailAssetId: cleanOptionalText(lesson.thumbnailAssetId, 160),
      };
    });

    return {
      id: cleanRequiredText(module.id, "Module id", 3, 160),
      title: cleanRequiredText(module.title, "Module title", 1, 160),
      summary: cleanOptionalText(module.summary, 1200),
      coverAssetId: cleanOptionalText(module.coverAssetId, 160),
      lessons,
    };
  });

  return { lessonCount, modules };
}

/**
 * Walk a stored course's modules and return the set of real lesson ids. Used to
 * validate client-supplied lessonIds and to derive the authoritative progress
 * denominator server-side (clients can never set progressPercent directly).
 */
function extractCourseLessonIds(modules: unknown): Set<string> {
  const ids = new Set<string>();

  if (!Array.isArray(modules)) {
    return ids;
  }

  for (const moduleEntry of modules) {
    if (!isRecord(moduleEntry)) {
      continue;
    }

    const lessons = moduleEntry.lessons;

    if (!Array.isArray(lessons)) {
      continue;
    }

    for (const lesson of lessons) {
      if (
        isRecord(lesson)
        && typeof lesson.id === "string"
        && lesson.id.length > 0
      ) {
        ids.add(lesson.id);
      }
    }
  }

  return ids;
}

function validateCourseReadyForReview(course: TeacherCourseRecord) {
  const title = cleanRequiredText(course.title, "Course title", 3, 120);
  const summary = cleanRequiredText(course.summary, "Course summary", 20, 1200);
  const category = cleanRequiredText(course.category, "Course category", 2, 80);
  const { lessonCount, modules } = normalizeBuilderModules(course.modules);
  const paymentType = course.paymentType || "one_time";
  const allLessonIds = new Set(
    modules.flatMap((module) => module.lessons.map((lesson) => lesson.id)),
  );
  const freePreviewLessonId = cleanOptionalText(
    (course as { freePreviewLessonId?: unknown }).freePreviewLessonId,
    160,
  );

  if (!title || !summary || !category) {
    throw new HttpsError("invalid-argument", "Course details are incomplete.");
  }

  if (modules.length === 0 || lessonCount === 0) {
    throw new HttpsError(
      "failed-precondition",
      "Add at least one module and one lesson before submitting.",
    );
  }

  if (!freePreviewLessonId || !allLessonIds.has(freePreviewLessonId)) {
    throw new HttpsError(
      "failed-precondition",
      "Choose one lesson as the free preview before submitting.",
    );
  }

  if (paymentType === "free") {
    return;
  }

  // Paid models that can be submitted for review. one_time charges once;
  // subscription_monthly / subscription_yearly mint a recurring Stripe Price
  // (see getOrCreateCourseSubscriptionPrice) and use priceAmountMinor as the
  // per-cycle amount — the price check below enforces a positive amount for all
  // three the same way.
  const submittablePaidTypes = [
    "one_time",
    "subscription_monthly",
    "subscription_yearly",
  ];
  if (!submittablePaidTypes.includes(paymentType)) {
    throw new HttpsError(
      "failed-precondition",
      "Choose a valid payment model before submitting.",
    );
  }

  if (
    typeof course.priceAmountMinor !== "number"
    || !Number.isFinite(course.priceAmountMinor)
    || course.priceAmountMinor <= 0
  ) {
    throw new HttpsError(
      "failed-precondition",
      "Set a paid price greater than zero or choose Free before submitting.",
    );
  }
}

// Memoized per secret value: a webhook delivery makes several Stripe calls
// and used to construct a fresh client (new HTTPS agent, no keep-alive) for
// each one. Keyed by the key itself so a secret rotation mid-instance
// transparently builds a new client instead of pinning the stale one.
let cachedStripeClient: { key: string; client: Stripe } | null = null;

function getStripeClient() {
  // sanitizeStripeSecret trims the secret so a stray trailing newline can't
  // poison the `Authorization: Bearer <key>` header (the ERR_INVALID_CHAR that
  // surfaced as an opaque INTERNAL 500 and broke live onboarding, 2026-06-07).
  // See payment-rules.ts for the full rationale; unit-tested there.
  const result = sanitizeStripeSecret(
    stripeSecretKey.value() || process.env.STRIPE_SECRET_KEY,
  );

  if (!result.ok) {
    throw new HttpsError(
      "failed-precondition",
      result.reason === "missing"
        ? "Stripe secret key is not configured."
        : "Stripe secret key is malformed (it contains spaces or line breaks). " +
            "Re-set the STRIPE_SECRET_KEY secret as a single line with no extra characters.",
    );
  }

  if (cachedStripeClient?.key !== result.key) {
    cachedStripeClient = {
      key: result.key,
      client: new Stripe(result.key, {
        apiVersion: "2026-02-25.clover" as Stripe.LatestApiVersion,
      }),
    };
  }

  return cachedStripeClient.client;
}

/**
 * Normalizes any error thrown while talking to Stripe into a client-legible
 * HttpsError. HttpsErrors we threw ourselves (auth / precondition) pass
 * straight through; genuine Stripe.errors.StripeError instances surface their
 * real message so onboarding/payout failures are diagnosable instead of an
 * opaque INTERNAL 500. `action` is a present-participle phrase, e.g.
 * "starting Stripe onboarding".
 */
function toStripeHttpsError(error: unknown, action: string): HttpsError {
  if (error instanceof HttpsError) {
    return error;
  }

  // Platform-config gap: Connect was never enabled on this Stripe account, so
  // accounts.create (and every Connect call) is refused. There is nothing to
  // recreate or retry — only the platform owner enabling Connect in the
  // Dashboard fixes it. Surface a calm, machine-readable precondition so the UI
  // can show "payouts being configured" instead of the raw Stripe URL error and
  // a retry loop. `details.reason` lets the client branch without string-matching.
  if (isConnectNotEnabledError(error)) {
    logger.error(
      `Stripe Connect is not enabled on the platform account (while ${action})`,
      { message: error instanceof Error ? error.message : String(error) },
    );
    return new HttpsError(
      "failed-precondition",
      "Payouts aren't available yet — the platform is still finishing its Stripe " +
        "Connect setup. Please check back soon.",
      { reason: "connect_not_enabled" },
    );
  }

  if (error instanceof Stripe.errors.StripeError) {
    logger.error(`Stripe error while ${action}`, {
      type: error.type,
      code: error.code,
      statusCode: error.statusCode,
      message: error.message,
    });
    // Full detail stays server-side (logged above); clients get a stable,
    // user-safe message plus a machine-readable code — never the raw Stripe
    // message, which can expose platform Connect configuration internals.
    return new HttpsError(
      "failed-precondition",
      `Stripe could not complete ${action}. Please try again.`,
      { reason: "stripe_error", code: error.code ?? null },
    );
  }

  logger.error(`Unexpected error while ${action}`, {
    error: error instanceof Error ? error.message : String(error),
  });
  return new HttpsError(
    "internal",
    `Could not complete ${action}. Please try again.`,
  );
}

function getAppUrl() {
  return (process.env.SKILLSET_APP_URL || fallbackAppUrl).replace(/\/$/, "");
}

/**
 * Mints a fresh Stripe Express connected account and persists it onto the user
 * doc (overwriting any existing stripeConnectedAccountId via merge). Shared by
 * both onboarding callables for BOTH the initial-create and the
 * self-heal-recreate paths, so an orphaned id is replaced in exactly one place.
 *
 * Fund-safe to overwrite: transfers/refunds read a FROZEN
 * `ledger.teacherStripeConnectedAccountId` snapshot captured at payment-capture
 * time, never this live field; and an orphaned id can never have a ledger entry
 * because the checkout chargesEnabled precondition blocks payment before any
 * ledger write. See stripe-connect-self-heal.ts for the orphan rationale.
 */
async function createFreshConnectedAccount(params: {
  userRef: DocumentReference;
  uid: string;
  email: string | undefined;
  stripe: Stripe;
}): Promise<string> {
  const { userRef, uid, email, stripe } = params;

  const account = await stripe.accounts.create({
    type: "express",
    email,
    business_type: "individual",
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
    metadata: { skillsetUserId: uid },
  });

  await userRef.set(
    {
      stripeConnectedAccountId: account.id,
      stripeConnectStatus: "created",
      stripeConnectChargesEnabled: Boolean(account.charges_enabled),
      stripeConnectPayoutsEnabled: Boolean(account.payouts_enabled),
      stripeConnectUpdatedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return account.id;
}

function normalizeSkillsetCurrency(currency?: string | null) {
  const normalizedCurrency = (currency || defaultSkillsetCurrency).toUpperCase();

  return supportedStripeCurrencies.has(normalizedCurrency)
    ? normalizedCurrency
    : defaultSkillsetCurrency;
}

function normalizeCoursePrice(course: TeacherCourseRecord) {
  const amountMinor = course.priceAmountMinor;

  if (typeof amountMinor !== "number" || amountMinor <= 0) {
    throw new HttpsError(
      "failed-precondition",
      "This course does not have a paid checkout price yet.",
    );
  }

  return {
    amountMinor,
    currency: normalizeSkillsetCurrency(course.currency).toLowerCase(),
  };
}

// Returns a recurring Stripe Price id for a course subscription, creating and
// caching one on the course doc on first use. Prices are immutable in Stripe,
// so a change to the course price/cadence mints a fresh Price and re-caches it
// (a stale cache that no longer matches amount/currency/interval is ignored).
// The Price lives on the PLATFORM account: the subscription charges the
// platform Customer and the teacher payout is a held Transfer released by
// dailyReleaseTransfers — identical economics to the one-time rail.
async function getOrCreateCourseSubscriptionPrice(
  stripe: Stripe,
  courseRef: DocumentReference,
  course: TeacherCourseRecord,
  courseId: string,
  amountMinor: number,
  currency: string,
  interval: "month" | "year",
): Promise<string> {
  const cached = course.stripeSubscriptionPrice;
  if (
    cached
    && cached.priceId
    && cached.amountMinor === amountMinor
    && cached.currency === currency
    && cached.interval === interval
  ) {
    return cached.priceId;
  }

  const price = await stripe.prices.create({
    currency,
    unit_amount: amountMinor,
    recurring: { interval },
    product_data: {
      name: course.title,
      metadata: { courseId, ownerId: course.ownerId },
    },
    metadata: {
      courseId,
      ownerId: course.ownerId,
      kind: "course_subscription",
    },
  });

  await courseRef.set(
    {
      stripeSubscriptionPrice: {
        priceId: price.id,
        amountMinor,
        currency,
        interval,
      },
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return price.id;
}

// Canonical spec + unit tests: src/domain/payment-split.ts (kept in sync;
// this is the Firebase Functions package mirror used by the Stripe webhook).
// Stripe processing fee passed through to the teacher so the platform keeps
// its full commission. USD card pricing: 2.9% + $0.30. Non-USD treated as
// international card plus conversion: 5.4% + $0.30. This is an estimate applied
// at ledger time; the exact fee Stripe charges settles on the platform balance.
// NOTE: charge model is "separate_charges_and_transfers", so there is no
// application_fee_amount (that is a destination-charge concept) — the fee is
// reflected by reducing the teacher transfer (netAmountMinor) instead.
async function enforceRateLimit(
  key: string,
  limit: number,
  windowMs: number,
) {
  const now = Date.now();
  const rateLimitRef = db
    .collection("rateLimits")
    .doc(sanitizeRateLimitKey(key));

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(rateLimitRef);
    const data = snapshot.exists ? snapshot.data() || {} : {};
    const windowStartedAt = timestampToMillis(data.windowStartedAt) || 0;
    const count = Number(data.count || 0);
    const inCurrentWindow = windowStartedAt > 0 && now - windowStartedAt < windowMs;

    if (inCurrentWindow && count >= limit) {
      throw new HttpsError(
        "resource-exhausted",
        "Too many attempts. Please wait before trying again.",
      );
    }

    transaction.set(
      rateLimitRef,
      {
        count: inCurrentWindow ? count + 1 : 1,
        windowStartedAt: inCurrentWindow
          ? data.windowStartedAt
          : Timestamp.fromMillis(now),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  });
}

/**
 * Best-effort write of a sensitive-action audit entry. NEVER throws: failing
 * to record the trail must not roll back or break the operation being audited.
 * The Admin SDK bypasses Firestore rules, which deny all client writes here.
 */
async function recordAuditEvent(input: AuditEventInput): Promise<void> {
  try {
    const entry = buildAuditEntry(input);
    await db.collection(AUDIT_LOG_COLLECTION).add({
      ...entry,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (error) {
    logger.error("Failed to record audit event", {
      action: input.action,
      actorId: input.actorId,
      targetId: input.targetId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function createAccountActionRequest(
  request: CallableRequest,
  type: AccountActionRequestType,
) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in before requesting account actions.");
  }

  const uid = request.auth.uid;
  const email =
    typeof request.auth.token.email === "string"
      ? request.auth.token.email
      : null;
  const requestRef = db.collection("accountActionRequests").doc();

  await enforceRateLimit(`account_action_${type}_${uid}`, 4, 24 * 60 * 60 * 1000);
  await requestRef.set({
    id: requestRef.id,
    type,
    requestedBy: uid,
    email,
    status: "pending",
    requestedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  logger.info("Account action request created", {
    requestId: requestRef.id,
    requestedBy: uid,
    type,
  });

  await recordAuditEvent({
    action:
      type === "account_deletion"
        ? AUDIT_ACTIONS.ACCOUNT_DELETION_REQUESTED
        : AUDIT_ACTIONS.ACCOUNT_DATA_EXPORT_REQUESTED,
    actorId: uid,
    actorEmail: email,
    targetType: "user",
    targetId: uid,
    summary:
      type === "account_deletion"
        ? "Account deletion requested"
        : "Personal data export requested",
    metadata: {
      requestId: requestRef.id,
      type,
    },
  });

  return {
    success: true,
    requestId: requestRef.id,
  };
}

export const requestDataExport = onCall(async (request) =>
  createAccountActionRequest(request, "data_export"),
);

export const requestAccountDeletion = onCall(async (request) =>
  createAccountActionRequest(request, "account_deletion"),
);

export const createTeacherCourseDraft = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in before creating a course.");
  }

  const uid = request.auth.uid;
  const input = request.data || {};
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const summary = typeof input.summary === "string" ? input.summary.trim() : "";
  const titleKey = normalizeCourseTitleKey(title);
  const categories = normalizeCourseCategories(input.categories);
  const fallbackCategory =
    typeof input.category === "string" && input.category.trim()
      ? input.category.trim().slice(0, 80)
      : "Other";
  const category = categories[0] ?? fallbackCategory;
  const paymentType = input.paymentType === "free" ? "free" : "one_time";

  if (title.length < 3 || title.length > 120 || titleKey.length < 3) {
    throw new HttpsError(
      "invalid-argument",
      "Course title must be between 3 and 120 characters.",
    );
  }

  if (summary.length < 20 || summary.length > 1200) {
    throw new HttpsError(
      "invalid-argument",
      "Course summary must be between 20 and 1200 characters.",
    );
  }

  const userSnapshot = await db.collection("users").doc(uid).get();
  const profile = userSnapshot.data() as UserProfileRecord | undefined;
  const roles = Array.isArray(profile?.roles) ? profile.roles : [];
  const acceptedTeacherTerms = Boolean(userSnapshot.get("teacherTermsAcceptedAt"));
  const platformFeeBps = canonicalPlatformFeeBpsForPlan(profile?.currentPlanId);

  if (!roles.includes("teacher") || !acceptedTeacherTerms) {
    throw new HttpsError(
      "failed-precondition",
      "Teacher setup must be complete before creating courses.",
    );
  }

  // Each call reserves a platform-global courseTitleKeys doc — throttle so a
  // scripted teacher account cannot mass-squat the title namespace.
  await enforceRateLimit(`course_draft_create_${uid}`, 20, 60 * 60 * 1000);

  const courseRef = db.collection("courses").doc();
  const titleKeyRef = db.collection("courseTitleKeys").doc(titleKey);

  await db.runTransaction(async (transaction) => {
    const titleKeySnapshot = await transaction.get(titleKeyRef);

    if (titleKeySnapshot.exists) {
      throw new HttpsError(
        "already-exists",
        "A course with this title already exists. Choose a more specific name.",
      );
    }

    transaction.set(titleKeyRef, {
      id: titleKey,
      title,
      ownerId: uid,
      courseId: courseRef.id,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    transaction.set(courseRef, {
      ownerId: uid,
      title,
      titleKey,
      summary,
      category,
      categories,
      learningOutcomes: [],
      status: "draft",
      modules: [],
      lessonCount: 0,
      priceAmountMinor: paymentType === "free" ? 0 : null,
      currency: defaultSkillsetCurrency,
      paymentType,
      installmentsEnabled: false,
      installmentsMax: null,
      platformFeeBps,
      dripStrategy: "instant",
      dripIntervalDays: 1,
      freePreviewLessonId: null,
      coverImageUrl: null,
      reviewNote: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  await captureServerEvent(uid, SERVER_EVENTS.COURSE_DRAFT_CREATED, {
    course_id: courseRef.id,
    teacher_id: uid,
  });

  return { courseId: courseRef.id };
});

export const updateTeacherCourseBuilder = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in before saving a course.");
  }

  const uid = request.auth.uid;
  const input = isRecord(request.data) ? request.data : {};
  const courseId = cleanRequiredText(input.courseId, "Course id", 3, 160);
  const title = cleanRequiredText(input.title, "Course title", 3, 120);
  const summary = cleanRequiredText(input.summary, "Course summary", 20, 1200);
  const titleKey = normalizeCourseTitleKey(title);
  const categories = normalizeCourseCategories(input.categories);
  const fallbackCategory =
    typeof input.category === "string" && input.category.trim()
      ? input.category.trim().slice(0, 80)
      : "Other";
  const category = categories[0] ?? fallbackCategory;
  const learningOutcomes = normalizeLearningOutcomes(input.learningOutcomes);
  const { lessonCount, modules } = normalizeBuilderModules(input.modules);
  const paymentType =
    typeof input.paymentType === "string" && builderPaymentTypes.has(input.paymentType)
      ? input.paymentType
      : "one_time";
  const priceAmountMinor =
    paymentType === "free" ? 0 : cleanOptionalInteger(input.priceAmountMinor);
  const currency =
    typeof input.currency === "string"
      && supportedStripeCurrencies.has(input.currency.toUpperCase())
      ? input.currency.toUpperCase()
      : defaultSkillsetCurrency;
  const installmentsEnabled =
    paymentType === "one_time" && input.installmentsEnabled === true;
  const installmentsMax = installmentsEnabled
    ? Math.min(36, Math.max(1, cleanOptionalInteger(input.installmentsMax) ?? 12))
    : null;
  const dripStrategy =
    typeof input.dripStrategy === "string" && builderDripStrategies.has(input.dripStrategy)
      ? input.dripStrategy
      : "instant";
  const dripIntervalDays = Math.max(
    1,
    cleanOptionalInteger(input.dripIntervalDays) ?? 1,
  );
  const freePreviewLessonId = cleanOptionalText(input.freePreviewLessonId, 160);
  const allLessonIds = new Set(
    modules.flatMap((module) => module.lessons.map((lesson) => lesson.id)),
  );

  if (titleKey.length < 3) {
    throw new HttpsError("invalid-argument", "Course title is not specific enough.");
  }

  if (category.length < 2 || category.length > 80) {
    throw new HttpsError("invalid-argument", "Choose a valid course category.");
  }

  if (typeof priceAmountMinor === "number" && priceAmountMinor < 0) {
    throw new HttpsError("invalid-argument", "Price cannot be negative.");
  }

  if (
    freePreviewLessonId
    && !allLessonIds.has(freePreviewLessonId)
  ) {
    throw new HttpsError(
      "invalid-argument",
      "Free preview lesson must belong to this course.",
    );
  }

  const userSnapshot = await db.collection("users").doc(uid).get();
  const profile = userSnapshot.data() as UserProfileRecord | undefined;
  const roles = Array.isArray(profile?.roles) ? profile.roles : [];
  const acceptedTeacherTerms = Boolean(userSnapshot.get("teacherTermsAcceptedAt"));
  const platformFeeBps = canonicalPlatformFeeBpsForPlan(profile?.currentPlanId);

  if (!roles.includes("teacher") || !acceptedTeacherTerms) {
    throw new HttpsError(
      "failed-precondition",
      "Teacher setup must be complete before saving courses.",
    );
  }

  const courseRef = db.collection("courses").doc(courseId);
  const nextTitleKeyRef = db.collection("courseTitleKeys").doc(titleKey);

  // B1 dual-write: the gated subcollection always receives the real lesson
  // content (shape locked to the two keys). The inline copy on the course doc
  // is gated by the flag — when off, the course doc is written with null
  // contentText/externalUrl (subcollection-only) so the world-readable doc no
  // longer carries the paid payload.
  const lessonContentItems = modules.flatMap((module) =>
    module.lessons.map((lesson) => ({
      lessonId: lesson.id,
      contentText: lesson.contentText ?? null,
      externalUrl: lesson.externalUrl ?? null,
    })),
  );
  const courseModules = WRITE_LESSON_CONTENT_INLINE
    ? modules
    : modules.map((module) => ({
        ...module,
        lessons: module.lessons.map((lesson) => ({
          ...lesson,
          contentText: null,
          externalUrl: null,
        })),
      }));

  await db.runTransaction(async (transaction) => {
    const courseSnapshot = await transaction.get(courseRef);

    if (!courseSnapshot.exists) {
      throw new HttpsError("not-found", "Course not found.");
    }

    const course = courseSnapshot.data() as TeacherCourseRecord;

    if (course.ownerId !== uid) {
      throw new HttpsError("permission-denied", "Only the course owner can save it.");
    }

    if (!["draft", "needs_changes", "published", "inactive"].includes(course.status)) {
      throw new HttpsError(
        "failed-precondition",
        "This course status cannot be edited from the builder.",
      );
    }

    const currentTitleKey = course.titleKey || normalizeCourseTitleKey(course.title);

    if (titleKey !== currentTitleKey) {
      const previousTitleKeyRef = currentTitleKey
        ? db.collection("courseTitleKeys").doc(currentTitleKey)
        : null;
      const [nextTitleKeySnapshot, previousTitleKeySnapshot] = await Promise.all([
        transaction.get(nextTitleKeyRef),
        previousTitleKeyRef ? transaction.get(previousTitleKeyRef) : Promise.resolve(null),
      ]);

      if (
        nextTitleKeySnapshot.exists
        && nextTitleKeySnapshot.get("courseId") !== courseId
      ) {
        throw new HttpsError(
          "already-exists",
          "A course with this title already exists. Choose a more specific name.",
        );
      }

      transaction.set(nextTitleKeyRef, {
        id: titleKey,
        title,
        ownerId: uid,
        courseId,
        createdAt: nextTitleKeySnapshot.exists
          ? nextTitleKeySnapshot.get("createdAt") || FieldValue.serverTimestamp()
          : FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      if (previousTitleKeyRef && previousTitleKeySnapshot) {
        if (
          previousTitleKeySnapshot.exists
          && previousTitleKeySnapshot.get("courseId") === courseId
        ) {
          transaction.delete(previousTitleKeyRef);
        }
      }
    } else {
      transaction.set(
        nextTitleKeyRef,
        {
          id: titleKey,
          title,
          ownerId: uid,
          courseId,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }

    transaction.update(courseRef, {
      title,
      titleKey,
      summary,
      category,
      categories,
      learningOutcomes,
      modules: courseModules,
      lessonCount,
      priceAmountMinor,
      currency,
      paymentType,
      installmentsEnabled,
      installmentsMax,
      platformFeeBps,
      dripStrategy,
      dripIntervalDays,
      freePreviewLessonId,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  // B1 dual-write (server, Admin SDK — rules bypassed, same doc shape as the
  // backfill and the client mirror). Done AFTER the course doc commits so the
  // gated subcollection tracks the persisted structure. Upsert content for
  // every current lesson and delete docs for lessons that were removed.
  const lessonContentRef = courseRef.collection("lessonContent");
  const currentLessonIds = new Set(
    lessonContentItems.map((item) => item.lessonId),
  );
  const existingContent = await lessonContentRef.get();
  const contentBatch = db.batch();

  for (const item of lessonContentItems) {
    contentBatch.set(
      lessonContentRef.doc(item.lessonId),
      { contentText: item.contentText, externalUrl: item.externalUrl },
      { merge: false },
    );
  }

  for (const existingDoc of existingContent.docs) {
    if (!currentLessonIds.has(existingDoc.id)) {
      contentBatch.delete(existingDoc.ref);
    }
  }

  await contentBatch.commit();

  return { success: true };
});

export const submitTeacherCourseForReview = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in before submitting a course.");
  }

  const uid = request.auth.uid;
  const input = isRecord(request.data) ? request.data : {};
  const courseId = cleanRequiredText(input.courseId, "Course id", 3, 160);

  const userSnapshot = await db.collection("users").doc(uid).get();
  const profile = userSnapshot.data() as UserProfileRecord | undefined;
  const roles = Array.isArray(profile?.roles) ? profile.roles : [];
  const acceptedTeacherTerms = Boolean(userSnapshot.get("teacherTermsAcceptedAt"));

  if (!roles.includes("teacher") || !acceptedTeacherTerms) {
    throw new HttpsError(
      "failed-precondition",
      "Teacher setup must be complete before submitting courses.",
    );
  }

  const courseRef = db.collection("courses").doc(courseId);

  await db.runTransaction(async (transaction) => {
    const courseSnapshot = await transaction.get(courseRef);

    if (!courseSnapshot.exists) {
      throw new HttpsError("not-found", "Course not found.");
    }

    const course = courseSnapshot.data() as TeacherCourseRecord;

    if (course.ownerId !== uid) {
      throw new HttpsError("permission-denied", "Only the course owner can submit it.");
    }

    if (!["draft", "needs_changes", "inactive"].includes(course.status)) {
      throw new HttpsError(
        "failed-precondition",
        "Only draft, inactive, or needs-changes courses can be submitted for review.",
      );
    }

    validateCourseReadyForReview(course);

    transaction.update(courseRef, {
      status: "in_review",
      reviewNote: null,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  return { success: true };
});

export const deleteTeacherCourseDraft = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in before deleting a course.");
  }

  const uid = request.auth.uid;
  const input = isRecord(request.data) ? request.data : {};
  const courseId = cleanRequiredText(input.courseId, "Course id", 3, 160);

  const courseRef = db.collection("courses").doc(courseId);

  await db.runTransaction(async (transaction) => {
    const courseSnapshot = await transaction.get(courseRef);

    if (!courseSnapshot.exists) {
      throw new HttpsError("not-found", "Course not found.");
    }

    const course = courseSnapshot.data() as TeacherCourseRecord;

    if (course.ownerId !== uid) {
      throw new HttpsError("permission-denied", "Only the course owner can delete it.");
    }

    if (!["draft", "needs_changes"].includes(course.status)) {
      throw new HttpsError(
        "failed-precondition",
        "Only draft or needs-changes courses can be deleted. Submitted, published, or inactive courses are managed by Skillset.",
      );
    }

    // Release the unique-title reservation in the same atomic write. Without
    // this the courseTitleKeys/{titleKey} doc is orphaned and permanently
    // blocks the teacher from reusing the title (createTeacherCourseDraft
    // would throw already-exists).
    if (course.titleKey) {
      transaction.delete(db.collection("courseTitleKeys").doc(course.titleKey));
    }

    transaction.delete(courseRef);
  });

  return { success: true };
});

export const deleteCourseAsAdmin = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in to manage courses.");
  }

  const uid = request.auth.uid;
  const input = isRecord(request.data) ? request.data : {};
  const courseId = cleanRequiredText(input.courseId, "Course id", 3, 160);

  const callerSnapshot = await db.collection("users").doc(uid).get();
  const callerProfile = callerSnapshot.data() as UserProfileRecord | undefined;
  const callerRoles = Array.isArray(callerProfile?.roles) ? callerProfile.roles : [];

  if (!callerRoles.includes("admin")) {
    throw new HttpsError("permission-denied", "Only Skillset admins can delete courses.");
  }

  const courseRef = db.collection("courses").doc(courseId);

  await db.runTransaction(async (transaction) => {
    // Safety guard: never hard-delete a course that carries real learners or
    // sales — orphaning enrollments/orders would corrupt course access and
    // payout records; such a course must be unpublished (status: inactive)
    // instead. Checked INSIDE the delete transaction so an enrollment/order
    // that lands mid-call conflicts the commit instead of being orphaned.
    const [courseSnapshot, enrollmentSnapshot, orderSnapshot] = await Promise.all([
      transaction.get(courseRef),
      transaction.get(
        db.collection("enrollments").where("courseId", "==", courseId).limit(1),
      ),
      transaction.get(
        db.collection("orders").where("courseId", "==", courseId).limit(1),
      ),
    ]);

    if (!courseSnapshot.exists) {
      throw new HttpsError("not-found", "Course not found.");
    }

    if (!enrollmentSnapshot.empty || !orderSnapshot.empty) {
      throw new HttpsError(
        "failed-precondition",
        "This course has enrollments or orders. Unpublish it to remove it from the marketplace; it cannot be permanently deleted.",
      );
    }

    const course = courseSnapshot.data() as TeacherCourseRecord;

    // Release the unique-title reservation atomically, mirroring the teacher
    // draft-delete path. courseTitleKeys cannot be deleted from the client
    // (rules), so this admin-SDK transaction is the only correct path.
    if (course.titleKey) {
      transaction.delete(db.collection("courseTitleKeys").doc(course.titleKey));
    }

    transaction.delete(courseRef);
  });

  // Privileged destructive action — leave an immutable trail of WHO deleted
  // WHAT. Best-effort by design (recordAuditEvent never throws): the delete
  // already committed, so the audit write must not fail the call.
  await recordAuditEvent({
    action: AUDIT_ACTIONS.COURSE_DELETED_BY_ADMIN,
    actorId: uid,
    actorEmail:
      typeof request.auth.token.email === "string"
        ? request.auth.token.email
        : null,
    targetType: "course",
    targetId: courseId,
    summary: "Course permanently deleted by admin",
  });

  return { success: true };
});

/**
 * Analytics-only Firestore trigger: emits the `course_published` funnel event
 * when a course transitions into the published state. See course-analytics.ts
 * for why this is a trigger (publishing is an admin moderation write, not a
 * callable) and why the distinct_id is the teacher. Telemetry never throws
 * (captureServerEvent swallows + no-ops without a key), so this never blocks or
 * retries a course write.
 */
export const onCoursePublished = onDocumentUpdated(
  "courses/{courseId}",
  async (event) => {
    const before = event.data?.before.data() as TeacherCourseRecord | undefined;
    const after = event.data?.after.data() as TeacherCourseRecord | undefined;

    if (!after || !isCoursePublishTransition(before?.status, after.status)) {
      return;
    }

    const properties = buildCoursePublishedProperties(
      event.params.courseId,
      after,
    );

    if (!properties) {
      return;
    }

    await captureServerEvent(
      properties.teacher_id,
      SERVER_EVENTS.COURSE_PUBLISHED,
      { ...properties },
    );
  },
);

type PublicProfileProjection = {
  displayName: string | null;
  username: string | null;
  photoURL: string | null;
  bio: string | null;
  credentials: string[];
};

// Defense-in-depth: photoURL is mirrored into the anonymously-readable
// publicProfiles doc (the public instructor page), so only a well-formed https
// URL within a sane length is allowed to cross into that public surface. A
// legacy or abused users/{uid} doc cannot push a data:/javascript:/oversized
// URL onto a public <img src>. The firestore rule bounds type+size on write;
// this is the second layer that also enforces the scheme on projection.
function sanitizePublicPhotoUrl(value: unknown): string | null {
  return typeof value === "string" &&
    value.length <= 1200 &&
    value.startsWith("https://")
    ? value
    : null;
}

function projectPublicTeacherProfile(
  data: UserProfileRecord | undefined,
): PublicProfileProjection | null {
  if (!data) {
    return null;
  }

  const roles = Array.isArray(data.roles) ? data.roles : [];

  // Only teachers (and admins) get a public profile. A user who is not a
  // teacher returns null, which deletes any stale public doc.
  if (!roles.includes("teacher") && !roles.includes("admin")) {
    return null;
  }

  const credentials = Array.isArray(data.credentials)
    ? data.credentials
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
        .slice(0, 6)
    : [];

  return {
    displayName: data.displayName ?? null,
    username: data.username ?? null,
    photoURL: sanitizePublicPhotoUrl(data.photoURL),
    bio: data.bio ?? null,
    credentials,
  };
}

// Project a teacher's public-safe fields into `publicProfiles/{uid}`, which is
// anonymously readable (see firestore.rules) and powers the public instructor
// page. The `users/{uid}` doc stays private; this Admin-SDK write is the single
// writer of the public mirror, so clients can never forge or edit it. Skips
// no-op writes (e.g. lastLoginAt-only updates) by diffing the projection.
export const syncPublicTeacherProfile = onDocumentWritten(
  "users/{uid}",
  async (event) => {
    const uid = event.params.uid;
    const publicRef = db.collection("publicProfiles").doc(uid);

    const beforeProjection = projectPublicTeacherProfile(
      event.data?.before.data() as UserProfileRecord | undefined,
    );
    const afterProjection = projectPublicTeacherProfile(
      event.data?.after.data() as UserProfileRecord | undefined,
    );

    if (!afterProjection) {
      if (beforeProjection) {
        await publicRef.delete().catch(() => undefined);
      }
      return;
    }

    if (
      beforeProjection &&
      JSON.stringify(beforeProjection) === JSON.stringify(afterProjection)
    ) {
      return;
    }

    await publicRef.set(
      {
        uid,
        ...afterProjection,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  },
);

// ---------------------------------------------------------------------------
// Community gamification — points & levels (server-authoritative).
//
// Points come ONLY from likes RECEIVED on community posts (1 like = 1 point),
// the Skool-standard model. A like is a doc at
// communityPosts/{postId}/likes/{likerId} (client own-write). These two
// triggers are the ONLY writer of memberStats/{uid} (firestore.rules ->
// memberStats write: if false), so points/levels can never be self-awarded.
//
// GAMIFICATION_LEVEL_THRESHOLDS mirrors src/domain/gamification.ts (the
// functions package cannot import from the app). The app module is canonical —
// keep both in sync. Skool ladder: L1 0, L2 5, L3 20, L4 65, L5 155, L6 515,
// L7 2015, L8 8015, L9 33015.
// ---------------------------------------------------------------------------
const GAMIFICATION_LEVEL_THRESHOLDS = [
  0, 5, 20, 65, 155, 515, 2015, 8015, 33015,
];

function gamificationLevelForPoints(points: number): number {
  const safe = Number.isFinite(points) && points > 0 ? Math.floor(points) : 0;
  let level = 1;
  for (
    let index = 0;
    index < GAMIFICATION_LEVEL_THRESHOLDS.length;
    index += 1
  ) {
    if (safe >= GAMIFICATION_LEVEL_THRESHOLDS[index]) {
      level = index + 1;
    }
  }
  return level;
}

/**
 * Apply one like delta (+1 on like, -1 on unlike) to the post author's
 * memberStats. Reads the post for the author, skips self-likes, and derives
 * the level transactionally so points and level never drift. Appends an
 * immutable pointsEvents ledger row (used by the leaderboard window
 * aggregation).
 *
 * Trigger delivery is at-least-once, so a delta can in rare cases double-apply;
 * points are engagement signal (not money) and totals clamp at 0, so this is an
 * accepted MVP tradeoff.
 */
async function applyCommunityLikeDelta(
  postId: string,
  likerId: string,
  delta: 1 | -1,
): Promise<void> {
  if (!postId || !likerId) {
    return;
  }

  const postSnap = await db.collection("communityPosts").doc(postId).get();
  const post = postSnap.data();
  const authorId = typeof post?.authorId === "string" ? post.authorId : "";
  if (!authorId) {
    return;
  }
  // No points for liking your own post.
  if (authorId === likerId) {
    return;
  }
  const authorName =
    typeof post?.authorName === "string" && post.authorName.trim()
      ? post.authorName.trim()
      : "Member";

  const statsRef = db.collection("memberStats").doc(authorId);

  await db.runTransaction(async (transaction) => {
    const statsSnap = await transaction.get(statsRef);
    const prev = statsSnap.data();
    const prevPoints =
      typeof prev?.points === "number" && Number.isFinite(prev.points)
        ? prev.points
        : 0;
    const prevLikes =
      typeof prev?.totalLikesReceived === "number"
        && Number.isFinite(prev.totalLikesReceived)
        ? prev.totalLikesReceived
        : 0;

    const points = Math.max(0, prevPoints + delta);
    const totalLikesReceived = Math.max(0, prevLikes + delta);

    transaction.set(
      statsRef,
      {
        uid: authorId,
        displayName: authorName,
        points,
        level: gamificationLevelForPoints(points),
        totalLikesReceived,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  });

  await db
    .collection("pointsEvents")
    .add({
      uid: authorId,
      kind: delta > 0 ? "like_received" : "like_removed",
      delta,
      postId,
      likerId,
      createdAt: FieldValue.serverTimestamp(),
    })
    .catch((error) => {
      logger.error("pointsEvents append failed", { postId, likerId, error });
    });
}

export const onCommunityLikeCreated = onDocumentCreated(
  "communityPosts/{postId}/likes/{likerId}",
  async (event) => {
    await applyCommunityLikeDelta(event.params.postId, event.params.likerId, 1);
  },
);

export const onCommunityLikeDeleted = onDocumentDeleted(
  "communityPosts/{postId}/likes/{likerId}",
  async (event) => {
    await applyCommunityLikeDelta(
      event.params.postId,
      event.params.likerId,
      -1,
    );
  },
);

// ---------------------------------------------------------------------------
// In-app notifications. Producers below write best-effort docs into
// users/{uid}/notifications (owner-read, server-only write per firestore.rules).
// A failed notification write must NEVER fail the action that triggered it, so
// every call is catch-logged. This is the only delivery channel (no email yet).
// ---------------------------------------------------------------------------
type NotificationKind =
  | "community_comment"
  | "community_reply"
  | "enrollment"
  | "course_review"
  | "certificate";

async function writeNotification(
  userId: string,
  payload: {
    type: NotificationKind;
    title: string;
    body: string;
    link?: string | null;
    actorName?: string | null;
  },
): Promise<void> {
  if (!userId) {
    return;
  }
  try {
    await db
      .collection("users")
      .doc(userId)
      .collection("notifications")
      .add({
        type: payload.type,
        title: payload.title,
        body: payload.body,
        link: payload.link ?? null,
        actorName: payload.actorName ?? null,
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      });
  } catch (error) {
    logger.error("writeNotification failed", {
      userId,
      type: payload.type,
      error,
    });
  }
}

function truncateForNotification(value: string, max = 140): string {
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

// Community engagement notifications: the post author hears about every comment,
// and the parent-comment author hears about direct replies. Self-actions are
// skipped, and a reply on your own post never double-notifies you.
export const onCommunityCommentCreated = onDocumentCreated(
  "communityPosts/{postId}/comments/{commentId}",
  async (event) => {
    const data = event.data?.data();
    if (!data) {
      return;
    }

    const postId = event.params.postId;
    const commenterId = typeof data.authorId === "string" ? data.authorId : "";
    const commenterName =
      typeof data.authorName === "string" && data.authorName.trim()
        ? data.authorName.trim()
        : "A member";
    const parentId = typeof data.parentId === "string" ? data.parentId : null;
    const courseSlug =
      typeof data.courseSlug === "string" ? data.courseSlug : "";
    const snippet = truncateForNotification(
      typeof data.body === "string" ? data.body : "",
    );
    const link = courseSlug
      ? `/learn/community/${courseSlug}`
      : "/learn/community";

    // Best-effort reads: the post author (notified on any comment) and, for
    // replies, the parent comment's author (the direct reply target).
    const postSnap = await db
      .collection("communityPosts")
      .doc(postId)
      .get()
      .catch(() => null);
    const postAuthorId =
      postSnap && postSnap.exists
        ? (postSnap.get("authorId") as string | undefined)
        : undefined;

    let parentAuthorId: string | undefined;
    if (parentId) {
      const parentSnap = await db
        .collection("communityPosts")
        .doc(postId)
        .collection("comments")
        .doc(parentId)
        .get()
        .catch(() => null);
      parentAuthorId =
        parentSnap && parentSnap.exists
          ? (parentSnap.get("authorId") as string | undefined)
          : undefined;
    }

    const tasks: Array<Promise<void>> = [];
    const notified = new Set<string>();

    if (parentAuthorId && parentAuthorId !== commenterId) {
      notified.add(parentAuthorId);
      tasks.push(
        writeNotification(parentAuthorId, {
          type: "community_reply",
          title: `${commenterName} replied to you`,
          body: snippet,
          link,
          actorName: commenterName,
        }),
      );
    }

    if (
      postAuthorId
      && postAuthorId !== commenterId
      && !notified.has(postAuthorId)
    ) {
      tasks.push(
        writeNotification(postAuthorId, {
          type: "community_comment",
          title: `${commenterName} commented on your post`,
          body: snippet,
          link,
          actorName: commenterName,
        }),
      );
    }

    await Promise.all(tasks);
  },
);

// ---------------------------------------------------------------------------
// Leaderboard rebuild (scheduled). Precomputes the top members per window into
// leaderboards/{window} (signed-in read, server-only write) so the client reads
// one small doc instead of aggregating the ledger live.
//  - all-time: ordered by the memberStats all-time points.
//  - 7d / 30d: sum of pointsEvents.delta inside the window; the badge level is
//    still the member's CURRENT all-time level (joined from memberStats).
// ---------------------------------------------------------------------------
const LEADERBOARD_TOP_N = 20;

// No `uid`: the leaderboard doc is read by every signed-in member, so storing
// each ranked member's raw Auth UID leaked a displayName -> uid map for the
// global top list. The client keys rows by `rank` and self-identifies the
// viewer by their own displayName + level (see src/domain/gamification.ts).
type LeaderboardEntryRecord = {
  displayName: string;
  points: number;
  level: number;
  rank: number;
};

async function buildAllTimeLeaderboard(): Promise<LeaderboardEntryRecord[]> {
  const snap = await db
    .collection("memberStats")
    .where("points", ">", 0)
    .orderBy("points", "desc")
    .limit(LEADERBOARD_TOP_N)
    .get();

  return snap.docs.map((docSnap, index) => {
    const data = docSnap.data();
    const points = typeof data.points === "number" ? data.points : 0;
    return {
      displayName:
        typeof data.displayName === "string" && data.displayName.trim()
          ? data.displayName.trim()
          : "Member",
      points,
      level: gamificationLevelForPoints(points),
      rank: index + 1,
    };
  });
}

async function buildWindowLeaderboard(
  sinceMillis: number,
): Promise<LeaderboardEntryRecord[]> {
  const cutoff = Timestamp.fromMillis(sinceMillis);
  const snap = await db
    .collection("pointsEvents")
    .where("createdAt", ">=", cutoff)
    .get();

  const totals = new Map<string, number>();
  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    const uid = typeof data.uid === "string" ? data.uid : "";
    const delta = typeof data.delta === "number" ? data.delta : 0;
    if (!uid) {
      continue;
    }
    totals.set(uid, (totals.get(uid) ?? 0) + delta);
  }

  const ranked = [...totals.entries()]
    .filter(([, points]) => points > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, LEADERBOARD_TOP_N);

  const entries: LeaderboardEntryRecord[] = [];
  for (let index = 0; index < ranked.length; index += 1) {
    const [uid, windowPoints] = ranked[index];
    const statsSnap = await db.collection("memberStats").doc(uid).get();
    const stats = statsSnap.data();
    const allTimePoints =
      typeof stats?.points === "number" ? stats.points : 0;
    entries.push({
      displayName:
        typeof stats?.displayName === "string" && stats.displayName.trim()
          ? stats.displayName.trim()
          : "Member",
      points: windowPoints,
      level: gamificationLevelForPoints(allTimePoints),
      rank: index + 1,
    });
  }
  return entries;
}

export const rebuildLeaderboards = onSchedule(
  {
    schedule: "every 6 hours",
    timeZone: "Etc/UTC",
  },
  async () => {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    const [allTime, last30, last7] = await Promise.all([
      buildAllTimeLeaderboard(),
      buildWindowLeaderboard(now - 30 * dayMs),
      buildWindowLeaderboard(now - 7 * dayMs),
    ]);

    const windows: Array<[string, LeaderboardEntryRecord[]]> = [
      ["all-time", allTime],
      ["30d", last30],
      ["7d", last7],
    ];

    await Promise.all(
      windows.map(([window, entries]) =>
        db.collection("leaderboards").doc(window).set({
          window,
          entries,
          updatedAt: FieldValue.serverTimestamp(),
        }),
      ),
    );

    logger.info("leaderboards rebuilt", {
      allTime: allTime.length,
      last30: last30.length,
      last7: last7.length,
    });
  },
);

// ---------------------------------------------------------------------------
// Course trending signal (C5-cont Phase 2). Two server-only fields on the
// course doc feed the marketplace "Trending now" sort:
//  - enrollmentCount: lifetime denormalized counter, bumped by the trigger on
//    every NEW enrollment (re-activations are updates, not creates, so they do
//    not double-count). Best-effort (at-least-once), never gates the money path.
//  - trendingScore: enrollments in the last TRENDING_WINDOW_DAYS, recomputed
//    from source by the schedule. The recount is the source of truth, so a
//    missed/duplicated trigger can never corrupt the ranking (see
//    course-trending.ts). Both are written by the Admin SDK (rules-bypass);
//    teachers cannot touch them (absent from their courseChangedOnly lists).
// ---------------------------------------------------------------------------
async function incrementCourseEnrollmentCount(courseId: string): Promise<void> {
  if (!courseId) {
    return;
  }
  await db
    .collection("courses")
    .doc(courseId)
    .set({ enrollmentCount: FieldValue.increment(1) }, { merge: true })
    .catch((error) => {
      // A social-proof counter bump must NEVER surface to the enrollment write.
      logger.error("enrollmentCount increment failed", { courseId, error });
    });
}

export const onEnrollmentCreated = onDocumentCreated(
  "enrollments/{enrollmentId}",
  async (event) => {
    const enrollment = event.data?.data();
    const courseId = readEnrollmentCourseId(enrollment);
    if (!courseId) {
      return;
    }
    await incrementCourseEnrollmentCount(courseId);

    // Welcome the enrolled learner (best-effort, never blocks the enrollment).
    // Covers admin / manual / free / subscription grants where the learner was
    // not mid-checkout and would otherwise get no in-app signal.
    const userId =
      typeof enrollment?.userId === "string" ? enrollment.userId : "";
    if (userId) {
      const courseTitle =
        typeof enrollment?.courseTitle === "string"
        && enrollment.courseTitle.trim()
          ? enrollment.courseTitle.trim()
          : "your new course";
      const courseSlug =
        typeof enrollment?.courseSlug === "string"
          ? enrollment.courseSlug
          : "";
      await writeNotification(userId, {
        type: "enrollment",
        title: "You're enrolled",
        body: `You now have access to ${courseTitle}. Jump in any time.`,
        link: courseSlug ? `/learn/courses/${courseSlug}` : "/learn",
      });
    }
  },
);

// Courses worth scoring: anything that can appear (or return) to the catalog.
// Drafts / needs_changes never list, so they are skipped.
const TRENDING_COURSE_STATUSES = ["published", "in_review", "inactive"];

export const rebuildTrending = onSchedule(
  {
    schedule: "every 6 hours",
    timeZone: "Etc/UTC",
  },
  async () => {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const cutoff = Timestamp.fromMillis(now - TRENDING_WINDOW_DAYS * dayMs);

    const recentSnap = await db
      .collection("enrollments")
      .where("createdAt", ">=", cutoff)
      .get();

    const counts = aggregateTrendingCounts(
      recentSnap.docs.map((docSnap) => docSnap.get("courseId")),
    );

    // Iterate every listable course (not only ones with recent activity) so a
    // course that fell out of the window is reset to 0.
    const coursesSnap = await db
      .collection("courses")
      .where("status", "in", TRENDING_COURSE_STATUSES)
      .get();

    let writes = 0;
    await Promise.all(
      coursesSnap.docs.map(async (courseDoc) => {
        const nextScore = resolveTrendingScore(counts, courseDoc.id);
        if (!trendingWriteNeeded(courseDoc.get("trendingScore"), nextScore)) {
          return;
        }
        writes += 1;
        await courseDoc.ref.set({ trendingScore: nextScore }, { merge: true });
      }),
    );

    logger.info("trending rebuilt", {
      recentEnrollments: recentSnap.size,
      courses: coursesSnap.size,
      writes,
    });
  },
);

export const createCheckoutSession = onCall(
  { secrets: [stripeSecretKey] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in before checkout.");
    }

    const courseId = String(request.data?.courseId || "").trim();
    const userId = request.auth.uid;

    if (!courseId || courseId.length > 160) {
      throw new HttpsError("invalid-argument", "A valid courseId is required.");
    }

    await enforceRateLimit(`checkout_${userId}`, 10, 60 * 60 * 1000);

    const courseRef = db.collection("courses").doc(courseId);
    const courseSnapshot = await courseRef.get();

    if (!courseSnapshot.exists) {
      throw new HttpsError("not-found", "Course not found.");
    }

    const course = courseSnapshot.data() as TeacherCourseRecord;

    // Sell-on-submit: a course that left draft (in_review) is pre-validated and
    // sells immediately; approval is non-blocking. A reviewer who finds a
    // problem flips it to inactive/needs_changes, which blocks purchase again.
    if (course.status !== "published" && course.status !== "in_review") {
      throw new HttpsError(
        "failed-precondition",
        "This course is not available for purchase right now.",
      );
    }

    // A teacher buying their own course would pay themselves (minus the
    // platform fee) and pollute their own enrollment/progress analytics.
    if (course.ownerId === userId) {
      throw new HttpsError(
        "failed-precondition",
        "You can't purchase your own course.",
      );
    }

    const { amountMinor, currency } = normalizeCoursePrice(course);
    const enrollmentRef = db.collection("enrollments").doc(`${userId}__${courseId}`);
    const enrollmentSnapshot = await enrollmentRef.get();

    if (
      enrollmentSnapshot.exists
      && ["active", "completed"].includes(String(enrollmentSnapshot.data()?.status))
    ) {
      throw new HttpsError(
        "already-exists",
        "This course is already attached to your learning workspace.",
      );
    }

    const userEmail = request.auth.token.email
      ? String(request.auth.token.email)
      : undefined;
    const orderRef = db.collection("orders").doc();
    const appUrl = getAppUrl();
    const stripe = getStripeClient();
    const ownerSnapshot = await db.collection("users").doc(course.ownerId).get();
    const owner = ownerSnapshot.exists
      ? (ownerSnapshot.data() as UserProfileRecord)
      : null;
    const platformFeeBps = canonicalPlatformFeeBpsForPlan(owner?.currentPlanId);
    const connectedAccountId =
      course.stripeConnectedAccountId || owner?.stripeConnectedAccountId || null;

    if (!connectedAccountId) {
      throw new HttpsError(
        "failed-precondition",
        "This teacher has not connected Stripe payouts yet.",
      );
    }

    if (
      owner
      && (
        owner.stripeConnectedAccountId === connectedAccountId
        && (!owner.stripeConnectChargesEnabled || !owner.stripeConnectPayoutsEnabled)
      )
    ) {
      throw new HttpsError(
        "failed-precondition",
        "This teacher must finish Stripe onboarding before paid checkout opens.",
      );
    }

    // --- Course subscription checkout (recurring) ---------------------------
    // When the course is a monthly/yearly subscription, open a `subscription`
    // Checkout against a persistent platform Customer instead of the one-time
    // `payment` flow below. Charges land on the platform balance (separate
    // charges & transfers); the webhook's invoice.paid handler holds each paid
    // invoice in payoutLedger and grants/refreshes the enrollment — nothing
    // here grants access. The one-time checkout lock / orders doc are
    // payment-mode concepts and are intentionally skipped (the enrollment-active
    // guard above already blocks a duplicate subscribe).
    const subscriptionInterval = courseSubscriptionInterval(course.paymentType);
    if (subscriptionInterval) {
      const customerId = await getOrCreateBillingStripeCustomer(
        userId,
        userEmail ?? null,
      );
      const subscriptionPriceId = await getOrCreateCourseSubscriptionPrice(
        stripe,
        courseRef,
        course,
        courseId,
        amountMinor,
        currency,
        subscriptionInterval,
      );

      const subscriptionSession = await stripe.checkout.sessions.create(
        {
          mode: "subscription",
          customer: customerId,
          line_items: [{ price: subscriptionPriceId, quantity: 1 }],
          // Carry the full fulfilment context on the SUBSCRIPTION (not just the
          // session) so every future invoice.paid / lifecycle event can resolve
          // the course, buyer, teacher, connected account and fee without a DB
          // lookup. platformFeeBps is snapshotted at subscribe time.
          subscription_data: {
            metadata: {
              purpose: "course_subscription",
              courseId,
              courseSlug: courseId,
              userId,
              teacherId: course.ownerId,
              connectedAccountId,
              platformFeeBps: String(platformFeeBps),
              currency: currency.toUpperCase(),
            },
          },
          metadata: {
            purpose: "course_subscription",
            courseId,
            courseSlug: courseId,
            userId,
            teacherId: course.ownerId,
          },
          success_url: `${appUrl}/learn/courses/${encodeURIComponent(courseId)}?checkout=success`,
          cancel_url: `${appUrl}/courses/${encodeURIComponent(courseId)}?checkout=cancelled`,
        },
        {
          // Windowed idempotency: a double-click in the same minute reuses the
          // same session instead of opening two subscription checkouts.
          idempotencyKey: `course_sub_checkout_${userId}_${courseId}_${Math.floor(
            Date.now() / 60000,
          )}`,
        },
      );

      if (!subscriptionSession.url) {
        throw new HttpsError("internal", "Stripe did not return a Checkout URL.");
      }

      return { url: subscriptionSession.url };
    }

    // --- B3: in-flight checkout lock (atomic claim/takeover) ----------------
    // Claim a per-buyer+course lock so a double-click / second tab can't open
    // two concurrent charges for the same course. The whole claim -> decide ->
    // re-claim runs INSIDE a transaction: Firestore's optimistic concurrency
    // serialises racing requests, so exactly ONE winner proceeds and every loser
    // re-reads the winner's fresh claim and resolves to reuse/wait. (A plain
    // .set(merge) gave no mutual exclusion on the takeover path — two stale-lock
    // deciders could both proceed and double-charge.) Placed after all
    // validation so a rejected request never holds a lock. Released by the
    // webhook on completion/expiry; a url-less claim self-heals after the short
    // grace window if its request died.
    //
    // The Stripe session below is bounded to checkoutSessionExpiresInSec, and
    // the lock's sessionTtlMs sits a few minutes past it, so a takeover never
    // races a still-payable session (the windowing premise is honest, not the
    // old "assume 30 min" with no expires_at where the real session lived ~24h).
    const checkoutSessionExpiresInSec = 31 * 60;
    const checkoutLockRef = db
      .collection("checkoutLocks")
      .doc(`${userId}__${courseId}`);
    const checkoutLockWindows = {
      sessionTtlMs: (checkoutSessionExpiresInSec + 4 * 60) * 1000, // 35 min
      claimGraceMs: 2 * 60 * 1000, // one Stripe call + cold start headroom
    };
    const lockOutcome = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(checkoutLockRef);
      const claim = () =>
        transaction.set(checkoutLockRef, {
          userId,
          courseId,
          orderId: orderRef.id,
          checkoutUrl: null,
          claimedAt: FieldValue.serverTimestamp(),
        });
      if (!snapshot.exists) {
        claim();
        return { action: "proceed" as const };
      }
      const lockData = snapshot.data() ?? {};
      const claimedAt = lockData.claimedAt as
        | { toMillis?: () => number }
        | undefined;
      const decision = decideCheckoutLock(
        {
          claimedAtMs:
            typeof claimedAt?.toMillis === "function"
              ? claimedAt.toMillis()
              : null,
          checkoutUrl:
            typeof lockData.checkoutUrl === "string"
              ? lockData.checkoutUrl
              : null,
        },
        Date.now(),
        checkoutLockWindows,
      );
      if (decision === "reuse") {
        return { action: "reuse" as const, url: String(lockData.checkoutUrl) };
      }
      if (decision === "wait") {
        return { action: "wait" as const };
      }
      // "takeover": the prior claim is stale (session aged out / attempt died).
      // Re-claim inside the txn so a concurrent takeover decider loses the commit
      // race, retries, and resolves against this fresh claim (reuse/wait).
      claim();
      return { action: "proceed" as const };
    });

    if (lockOutcome.action === "reuse") {
      // A sibling request already has a live session — hand back the SAME url.
      return { url: lockOutcome.url };
    }
    if (lockOutcome.action === "wait") {
      throw new HttpsError(
        "already-exists",
        "A checkout for this course is already starting. Please try again in a moment.",
      );
    }

    await orderRef.set({
      id: orderRef.id,
      userId,
      teacherId: course.ownerId,
      teacherStripeConnectedAccountId: connectedAccountId,
      courseId,
      courseSlug: courseId,
      courseTitle: course.title,
      amountMinor,
      currency: currency.toUpperCase(),
      platformFeeBps,
      payoutModel: "separate_charges_and_transfers",
      status: "pending",
      provider: "stripe",
      checkoutSessionId: null,
      paymentIntentId: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: "payment",
      customer_email: userEmail,
      client_reference_id: userId,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency,
            unit_amount: amountMinor,
            product_data: {
              name: course.title,
              description: course.summary?.slice(0, 900),
              images: course.coverImageUrl ? [course.coverImageUrl] : undefined,
              metadata: {
                courseId,
                ownerId: course.ownerId,
              },
            },
          },
        },
      ],
      metadata: {
        orderId: orderRef.id,
        courseId,
        courseSlug: courseId,
        userId,
      },
      payment_intent_data: {
        metadata: {
          orderId: orderRef.id,
          courseId,
          courseSlug: courseId,
          userId,
        },
      },
      // Bound the session (see checkoutSessionExpiresInSec) so the B3 lock window
      // is honest and an expiry fires checkout.session.expired -> order cancel +
      // lock release. 31 min clears Stripe's 30-min minimum after request latency.
      expires_at: Math.floor(Date.now() / 1000) + checkoutSessionExpiresInSec,
      success_url: `${appUrl}/learn/courses/${encodeURIComponent(courseId)}?checkout=success`,
      cancel_url: `${appUrl}/courses/${encodeURIComponent(courseId)}?checkout=cancelled`,
    };

    const session = await stripe.checkout.sessions.create(sessionParams, {
      idempotencyKey: `checkout_${orderRef.id}`,
    });

    await orderRef.update({
      checkoutSessionId: session.id,
      updatedAt: FieldValue.serverTimestamp(),
    });

    if (!session.url) {
      throw new HttpsError("internal", "Stripe did not return a Checkout URL.");
    }

    // Publish the live session on the lock so a concurrent sibling request
    // reuses THIS url instead of opening a second charge. [B3]
    await checkoutLockRef.set(
      {
        checkoutUrl: session.url,
        orderId: orderRef.id,
        checkoutSessionId: session.id,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return { url: session.url };
  },
);

export const createFreeCourseEnrollment = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in before enrolling.");
  }

  const courseId = String(request.data?.courseId || "").trim();
  const userId = request.auth.uid;

  if (!courseId || courseId.length > 160) {
    throw new HttpsError("invalid-argument", "A valid courseId is required.");
  }

  await enforceRateLimit(`free_enroll_${userId}`, 20, 60 * 60 * 1000);

  const courseRef = db.collection("courses").doc(courseId);
  const enrollmentRef = db.collection("enrollments").doc(`${userId}__${courseId}`);

  await db.runTransaction(async (transaction) => {
    const [courseSnapshot, enrollmentSnapshot] = await Promise.all([
      transaction.get(courseRef),
      transaction.get(enrollmentRef),
    ]);

    if (!courseSnapshot.exists) {
      throw new HttpsError("not-found", "Course not found.");
    }

    const course = courseSnapshot.data() as TeacherCourseRecord;

    // Sell-on-submit: in_review courses are purchasable/enrollable; only
    // draft / needs_changes / inactive block enrollment.
    if (course.status !== "published" && course.status !== "in_review") {
      throw new HttpsError(
        "failed-precondition",
        "This course is not available for enrollment right now.",
      );
    }

    const isFreeCourse =
      course.paymentType === "free" ||
      (typeof course.priceAmountMinor === "number" && course.priceAmountMinor === 0);

    if (!isFreeCourse) {
      throw new HttpsError(
        "failed-precondition",
        "This course requires checkout before enrollment.",
      );
    }

    if (
      enrollmentSnapshot.exists &&
      ["active", "completed"].includes(String(enrollmentSnapshot.data()?.status))
    ) {
      return;
    }

    transaction.set(enrollmentRef, {
      id: enrollmentRef.id,
      userId,
      courseId,
      courseSlug: courseId,
      courseTitle: course.title,
      courseCategory: course.category,
      courseImage: course.coverImageUrl || "/brand/logo-mark.png",
      status: "active",
      source: "free_course",
      progressPercent: 0,
      lastLessonId: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  return {
    enrollmentId: enrollmentRef.id,
  };
});

export const submitCourseReview = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in before reviewing a course.");
  }

  const userId = request.auth.uid;
  const input = isRecord(request.data) ? request.data : {};
  const courseId = cleanRequiredText(input.courseId, "Course id", 3, 160);
  const rating =
    typeof input.rating === "number" && Number.isFinite(input.rating)
      ? Math.round(input.rating)
      : 0;
  const body = cleanCourseReviewBody(input.body);

  if (rating < 1 || rating > 5) {
    throw new HttpsError("invalid-argument", "Rating must be between 1 and 5.");
  }

  await enforceRateLimit(`course_review_${courseId}_${userId}`, 20, 60 * 60 * 1000);

  const reviewId = `${courseId}__${userId}`;
  const courseRef = db.collection("courses").doc(courseId);
  const enrollmentRef = db.collection("enrollments").doc(`${userId}__${courseId}`);
  const reviewRef = db.collection("courseReviews").doc(reviewId);
  const userRef = db.collection("users").doc(userId);

  let nextRatingAverage = 0;
  let nextRatingCount = 0;
  // Captured inside the txn so a teacher notification can fire AFTER commit —
  // never inside the rating transaction (best-effort, must not roll back money).
  let reviewTeacherId = "";
  let reviewCourseTitle = "";
  let reviewCourseSlug = "";
  let reviewAuthorName = "Skillset learner";

  await db.runTransaction(async (transaction) => {
    const [
      courseSnapshot,
      enrollmentSnapshot,
      reviewSnapshot,
      userSnapshot,
    ] = await Promise.all([
      transaction.get(courseRef),
      transaction.get(enrollmentRef),
      transaction.get(reviewRef),
      transaction.get(userRef),
    ]);

    if (!courseSnapshot.exists) {
      throw new HttpsError("not-found", "Course not found.");
    }

    const course = courseSnapshot.data() as TeacherCourseRecord;

    if (course.status !== "published") {
      throw new HttpsError(
        "failed-precondition",
        "Only published courses can receive reviews.",
      );
    }

    if (!enrollmentSnapshot.exists) {
      throw new HttpsError(
        "failed-precondition",
        "Enroll in this course before leaving a review.",
      );
    }

    const enrollment = enrollmentSnapshot.data() as EnrollmentRecord;

    if (enrollment.userId !== userId || enrollment.courseId !== courseId) {
      throw new HttpsError(
        "permission-denied",
        "You can only review courses attached to your account.",
      );
    }

    if (!["active", "completed"].includes(enrollment.status)) {
      throw new HttpsError(
        "failed-precondition",
        "This enrollment cannot leave a review.",
      );
    }

    if ((enrollment.progressPercent ?? 0) < 50) {
      throw new HttpsError(
        "failed-precondition",
        "Complete at least 50% of the course before leaving a review.",
      );
    }

    const previousReview = reviewSnapshot.exists
      ? (reviewSnapshot.data() as CourseReviewRecord)
      : null;
    const previousRating =
      previousReview && Number.isFinite(previousReview.rating)
        ? Math.round(previousReview.rating)
        : 0;
    const currentRatingSum =
      typeof course.ratingSum === "number"
        ? course.ratingSum
        : Math.round((course.ratingAverage ?? 0) * (course.ratingCount ?? 0));
    const currentRatingCount =
      typeof course.ratingCount === "number" ? course.ratingCount : 0;
    const ratingSum = previousReview
      ? currentRatingSum - previousRating + rating
      : currentRatingSum + rating;
    const ratingCount = previousReview
      ? Math.max(1, currentRatingCount)
      : currentRatingCount + 1;
    const ratingAverage = Math.round((ratingSum / ratingCount) * 10) / 10;
    const user = userSnapshot.data() as UserProfileRecord | undefined;
    const authorName =
      user?.displayName?.trim()
      || request.auth?.token.name?.toString().trim()
      || "Skillset learner";

    const courseRecord = course as {
      ownerId?: unknown;
      title?: unknown;
      slug?: unknown;
    };
    reviewTeacherId =
      typeof courseRecord.ownerId === "string" ? courseRecord.ownerId : "";
    reviewCourseTitle =
      typeof courseRecord.title === "string" ? courseRecord.title : "";
    reviewCourseSlug =
      typeof courseRecord.slug === "string" ? courseRecord.slug : "";
    reviewAuthorName = authorName;

    transaction.set(
      reviewRef,
      {
        id: reviewId,
        courseId,
        // The reviewer's raw Auth UID is intentionally NOT stored here.
        // courseReviews are world-readable on the published-course read
        // path, so a stored `userId` leaked the UIDs of confirmed paying
        // customers (harvestable + cross-referenceable against other
        // UID-keyed reads to deanonymize buyers). Ownership is derived from
        // the deterministic doc id `${courseId}__${userId}` on both the
        // client (getCourseReviewId) and in firestore.rules. The explicit
        // delete() purges the stale field from any pre-existing review the
        // moment it is re-submitted (merge write); a one-time backfill
        // (functions/scripts/backfill-purge-review-userid.mjs) clears the
        // rest.
        userId: FieldValue.delete(),
        authorName,
        rating,
        body,
        status: "published",
        createdAt: previousReview?.createdAt ?? FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    transaction.update(courseRef, {
      ratingAverage,
      ratingCount,
      ratingSum,
      reviewCount: ratingCount,
      updatedAt: FieldValue.serverTimestamp(),
    });

    nextRatingAverage = ratingAverage;
    nextRatingCount = ratingCount;
  });

  // Tell the course owner about the new review (best-effort, post-commit). A
  // teacher reviewing their own course notifies no one.
  if (reviewTeacherId && reviewTeacherId !== userId) {
    await writeNotification(reviewTeacherId, {
      type: "course_review",
      title: `New ${rating}-star review`,
      body: `${reviewAuthorName} reviewed ${reviewCourseTitle || "your course"}.`,
      link: reviewCourseSlug ? `/courses/${reviewCourseSlug}` : "/teach",
      actorName: reviewAuthorName,
    });
  }

  return {
    success: true,
    reviewId,
    ratingAverage: nextRatingAverage,
    ratingCount: nextRatingCount,
  };
});

export const createTeacherStripeAccountLink = onCall(
  { secrets: [stripeSecretKey] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in before connecting Stripe.");
    }

    const userId = request.auth.uid;

    await enforceRateLimit(
      `stripe_onboarding_${userId}`,
      10,
      60 * 60 * 1000,
    );

    const userRef = db.collection("users").doc(userId);
    const userSnapshot = await userRef.get();

    if (!userSnapshot.exists) {
      throw new HttpsError("failed-precondition", "User profile not found.");
    }

    const user = userSnapshot.data() as UserProfileRecord;

    if (!Array.isArray(user.roles) || !user.roles.includes("teacher")) {
      throw new HttpsError(
        "permission-denied",
        "Only teacher accounts can connect a payout account.",
      );
    }

    try {
      const stripe = getStripeClient();
      const email = user.email || request.auth.token.email?.toString();
      let accountId = user.stripeConnectedAccountId || null;

      if (!accountId) {
        accountId = await createFreshConnectedAccount({
          userRef,
          uid: userId,
          email,
          stripe,
        });
      }

      const appUrl = getAppUrl();
      // If the stored account is orphaned (created under a different Stripe
      // key/mode), accountLinks.create throws "...not connected to your
      // platform or does not exist". Self-heal mints a fresh account and
      // retries the link once instead of dead-ending onboarding.
      const accountLink = await runWithOrphanedAccountSelfHeal({
        accountId,
        runOp: (acct) =>
          stripe.accountLinks.create({
            account: acct,
            refresh_url: `${appUrl}/account/payments?stripe=refresh#stripe-connect`,
            return_url: `${appUrl}/account/payments?stripe=return`,
            type: "account_onboarding",
          }),
        recreateAccount: () =>
          createFreshConnectedAccount({ userRef, uid: userId, email, stripe }),
        onRecreate: (staleAccountId) =>
          logger.warn("Stripe connected account orphaned; recreating once", {
            userId,
            staleAccountId,
          }),
      });

      return { url: accountLink.url };
    } catch (error) {
      throw toStripeHttpsError(error, "starting Stripe onboarding");
    }
  },
);

export const refreshTeacherStripeAccount = onCall(
  { secrets: [stripeSecretKey] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in before refreshing Stripe.");
    }

    const userId = request.auth.uid;
    const userRef = db.collection("users").doc(userId);
    const userSnapshot = await userRef.get();

    if (!userSnapshot.exists) {
      throw new HttpsError("failed-precondition", "User profile not found.");
    }

    const user = userSnapshot.data() as UserProfileRecord;
    const accountId = user.stripeConnectedAccountId;

    if (!accountId) {
      return {
        connected: false,
        chargesEnabled: false,
        payoutsEnabled: false,
      };
    }

    try {
      const account = await getStripeClient().accounts.retrieve(accountId);
      const status =
        account.charges_enabled && account.payouts_enabled
          ? "ready"
          : "onboarding_required";

      await userRef.set(
        {
          stripeConnectStatus: status,
          stripeConnectChargesEnabled: Boolean(account.charges_enabled),
          stripeConnectPayoutsEnabled: Boolean(account.payouts_enabled),
          stripeConnectUpdatedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      if (status === "ready" && user.stripeConnectStatus !== "ready") {
        await captureServerEvent(userId, SERVER_EVENTS.TEACHER_KYC_APPROVED, {
          teacher_id: userId,
        });
      }

      return {
        connected: true,
        chargesEnabled: Boolean(account.charges_enabled),
        payoutsEnabled: Boolean(account.payouts_enabled),
        status,
      };
    } catch (error) {
      // Platform-wide Connect gap (Connect never enabled on the Stripe
      // Dashboard): Stripe refuses to even LOOK at connected accounts, so the
      // truthful state is "payouts unavailable" — not an error, and not a
      // verdict on the stored id. Checked FIRST because a platform gap must
      // never clear a possibly-valid id (the unusable-account branch below
      // judges the id only once Connect actually works). Two safety effects:
      //   1. Force the readiness flags false so a stale `chargesEnabled: true`
      //      can't hold paid checkout open (the readiness gate in
      //      createCourseCheckout) while transfers are impossible.
      //   2. Return payoutsUnavailable so the UI shows the calm
      //      "being configured" state instead of an alarming failure.
      if (isConnectNotEnabledError(error)) {
        await userRef.set(
          {
            stripeConnectChargesEnabled: false,
            stripeConnectPayoutsEnabled: false,
            stripeConnectUpdatedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        return {
          connected: false,
          chargesEnabled: false,
          payoutsEnabled: false,
          status: "onboarding_required" as const,
          payoutsUnavailable: true,
        };
      }
      // The stored account is unusable on this platform/key (created under a
      // different key/mode, deleted, or access revoked). accounts.retrieve
      // signals this as either a 400 account_invalid OR a 403
      // StripePermissionError ("...does not have access to account ... or that
      // account does not exist; access may have been revoked"); the broader
      // CLEAR-ONLY predicate catches both. Don't surface a confusing error or
      // silently mint an account the user didn't ask to refresh — clear the
      // stale id so the next explicit onboarding call recreates cleanly under
      // its own rate-limit gate, and report not-connected. Safe to broaden here
      // because this path mints nothing and is fully recoverable by re-onboarding.
      if (isUnusableConnectedAccountError(error)) {
        logger.warn(
          "Stripe connected account unusable on refresh; clearing stale id",
          { userId, staleAccountId: accountId },
        );
        await userRef.set(
          {
            stripeConnectedAccountId: FieldValue.delete(),
            stripeConnectStatus: "disconnected",
            stripeConnectChargesEnabled: false,
            stripeConnectPayoutsEnabled: false,
            stripeConnectUpdatedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        return {
          connected: false,
          chargesEnabled: false,
          payoutsEnabled: false,
          status: "disconnected" as const,
        };
      }
      throw toStripeHttpsError(error, "refreshing Stripe account status");
    }
  },
);

export const requestRefund = onCall(
  { secrets: [stripeSecretKey] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in before requesting a refund.");
    }

    const userId = request.auth.uid;
    const enrollmentId = String(request.data?.enrollmentId || "").trim();

    if (!enrollmentId || enrollmentId.length > 220) {
      throw new HttpsError("invalid-argument", "A valid enrollmentId is required.");
    }

    await enforceRateLimit(`refund_${userId}`, 5, 60 * 60 * 1000);

    const enrollmentRef = db.collection("enrollments").doc(enrollmentId);
    const enrollmentSnapshot = await enrollmentRef.get();

    if (!enrollmentSnapshot.exists) {
      throw new HttpsError("not-found", "Enrollment not found.");
    }

    const enrollment = enrollmentSnapshot.data() as EnrollmentRecord;

    if (enrollment.userId !== userId) {
      throw new HttpsError(
        "permission-denied",
        "You can only request refunds for your own enrollments.",
      );
    }

    if (enrollment.source !== "payment") {
      throw new HttpsError(
        "failed-precondition",
        "Only paid enrollments can request a refund.",
      );
    }

    if (!["active", "completed"].includes(enrollment.status)) {
      throw new HttpsError(
        "failed-precondition",
        "This enrollment is not eligible for a refund.",
      );
    }

    if ((enrollment.progressPercent ?? 0) >= automaticRefundProgressCap) {
      throw new HttpsError(
        "failed-precondition",
        "Automatic refunds are unavailable after substantial course progress.",
      );
    }

    const certificateSnapshot = await db
      .collection("certificates")
      .doc(enrollmentId)
      .get();

    if (
      certificateSnapshot.exists
      && certificateSnapshot.data()?.status === "issued"
    ) {
      throw new HttpsError(
        "failed-precondition",
        "This enrollment already has an issued certificate.",
      );
    }

    const refundOrderQuery = paidOrderRefundQuerySpec(userId, enrollment.courseId);
    let paidOrderQuery: Query = db.collection("orders");

    for (const [field, operator, value] of refundOrderQuery.filters) {
      paidOrderQuery = paidOrderQuery.where(field, operator, value);
    }

    const ordersSnapshot = await paidOrderQuery
      .limit(refundOrderQuery.limit)
      .get();

    const orderDocument = ordersSnapshot.docs[0];

    if (!orderDocument) {
      throw new HttpsError("not-found", "Paid order not found.");
    }

    const order = orderDocument.data();
    const paidAtMillis =
      timestampToMillis(order.paidAt)
      || timestampToMillis(order.createdAt)
      || 0;
    const refundDeadline =
      paidAtMillis + automaticRefundWindowDays * 24 * 60 * 60 * 1000;

    if (!paidAtMillis || Date.now() > refundDeadline) {
      throw new HttpsError(
        "failed-precondition",
        "The automatic refund window has ended.",
      );
    }

    const paymentIntentId = String(order.paymentIntentId || "");

    if (!paymentIntentId) {
      throw new HttpsError("failed-precondition", "Payment intent not found.");
    }

    const stripe = getStripeClient();
    const refund = await stripe.refunds.create(
      {
        payment_intent: paymentIntentId,
        metadata: {
          orderId: orderDocument.id,
          enrollmentId,
          userId,
          courseId: enrollment.courseId,
          source: "student_request",
        },
      },
      {
        idempotencyKey: `refund_${orderDocument.id}`,
      },
    );

    await orderDocument.ref.set(
      {
        refundRequestedAt: FieldValue.serverTimestamp(),
        refundRequestId: refund.id,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    await captureServerEvent(userId, SERVER_EVENTS.REFUND_REQUESTED, {
      order_id: orderDocument.id,
      course_id: enrollment.courseId,
      reason: "student_request",
      progress_pct: enrollment.progressPercent ?? 0,
    });

    await recordAuditEvent({
      action: AUDIT_ACTIONS.REFUND_REQUESTED,
      actorId: userId,
      actorEmail:
        typeof request.auth.token.email === "string"
          ? request.auth.token.email
          : null,
      targetType: "order",
      targetId: orderDocument.id,
      summary: `Refund requested for course ${enrollment.courseId}`,
      metadata: {
        refundId: refund.id,
        enrollmentId,
        courseId: enrollment.courseId,
        progressPercent: enrollment.progressPercent ?? 0,
        source: "student_request",
      },
    });

    return {
      refundId: refund.id,
      status: refund.status,
    };
  },
);

// Abandoned Checkout sessions leave a "pending" order behind (created before
// the Stripe redirect). Sweep clearly-abandoned ones to "cancelled" so they
// never linger in a buyer's purchase history as forever-pending.
export const expireStalePendingOrders = onSchedule(
  {
    schedule: "every day 04:00",
    timeZone: "Etc/UTC",
  },
  async () => {
    const now = Date.now();
    const staleThresholdMs = 48 * 60 * 60 * 1000;
    const pendingSnapshot = await db
      .collection("orders")
      .where("status", "==", "pending")
      .limit(300)
      .get();

    let cancelledCount = 0;
    let skippedCount = 0;

    for (const orderDocument of pendingSnapshot.docs) {
      const createdAtMillis = timestampToMillis(
        (orderDocument.data() as { createdAt?: unknown }).createdAt,
      );

      // Keep recent pending orders: the buyer may still be completing Checkout.
      // The session's own expiry (checkout.session.expired -> markOrderStatus) is
      // the primary cancel path; this 48h sweep is a backstop for missed events.
      if (createdAtMillis !== null && now - createdAtMillis < staleThresholdMs) {
        skippedCount += 1;
        continue;
      }

      // Route through markOrderStatus so the sweep also releases any in-flight
      // checkout lock still owned by this order and inherits the out-of-order
      // guard (an order that raced to paid since the query is left untouched).
      await markOrderStatus(orderDocument.id, "cancelled");
      cancelledCount += 1;
    }

    logger.info("Swept stale pending orders", {
      cancelledCount,
      skippedCount,
      scanned: pendingSnapshot.size,
    });
  },
);

export const dailyReleaseTransfers = onSchedule(
  {
    schedule: "every day 03:00",
    timeZone: "Etc/UTC",
    secrets: [stripeSecretKey],
  },
  async () => {
    const now = Date.now();
    const stripe = getStripeClient();

    // Recovery sweep: a ledger stuck at "releasing" means a previous run died
    // between claiming the doc and persisting the transfer outcome (crash, OOM,
    // timeout). Money may or may not have moved — but the Stripe transfer is
    // idempotent under `transfer_${ledgerId}`, so resetting the doc to
    // in_release lets the normal path retry safely: Stripe replays the answer
    // it already gave or creates the transfer exactly once. Single-field
    // equality query (no composite index needed); staleness filtered in memory.
    const stuckSnapshot = await db
      .collection("payoutLedger")
      .where("status", "==", "releasing")
      .limit(50)
      .get();
    const staleBeforeMillis = now - 6 * 60 * 60 * 1000;
    let recoveredCount = 0;

    for (const stuckDocument of stuckSnapshot.docs) {
      const stuck = stuckDocument.data() as PayoutLedgerRecord;
      const lastAttemptMillis = timestampToMillis(stuck.lastReleaseAttemptAt);

      // Only reclaim genuinely stale claims — a "releasing" doc touched inside
      // the window may belong to an in-flight run.
      if (lastAttemptMillis && lastAttemptMillis > staleBeforeMillis) {
        continue;
      }

      // logger.error on purpose: a stuck claim means a prior run crashed
      // mid-payout. The retry below is safe, but the crash deserves a look.
      logger.error("Recovering payout ledger stuck in releasing", {
        ledgerId: stuckDocument.id,
        teacherId: stuck.teacherId,
        plannedTransferAmountMinor: stuck.plannedTransferAmountMinor ?? null,
        releaseAttemptCount: stuck.releaseAttemptCount ?? 0,
        lastReleaseAttemptAt: lastAttemptMillis,
      });

      await stuckDocument.ref.set(
        {
          status: "in_release",
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      recoveredCount += 1;
    }

    const ledgerSnapshot = await db
      .collection("payoutLedger")
      .where("status", "==", "in_release")
      .limit(50)
      .get();

    let releasedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    for (const ledgerDocument of ledgerSnapshot.docs) {
      const ledger = ledgerDocument.data() as PayoutLedgerRecord;
      const releaseAtMillis = timestampToMillis(ledger.releaseAt);

      if (!releaseAtMillis || releaseAtMillis > now) {
        skippedCount += 1;
        continue;
      }

      const claimedLedger = await claimLedgerForRelease(ledgerDocument.ref, now);

      if (!claimedLedger) {
        skippedCount += 1;
        continue;
      }

      const attemptCount = Number(claimedLedger.releaseAttemptCount ?? 0) + 1;
      if (attemptCount >= 5) {
        // Still money-safe (idempotency key), but five failed attempts means
        // something structural is wrong (Connect account closed, currency
        // mismatch, ...) and a human needs to look at this teacher's payout.
        logger.error("Payout ledger has repeatedly failed to release", {
          ledgerId: ledgerDocument.id,
          teacherId: claimedLedger.teacherId,
          releaseAttemptCount: attemptCount,
          plannedTransferAmountMinor:
            claimedLedger.plannedTransferAmountMinor ?? null,
        });
      }

      try {
        await releaseLedgerTransfer(stripe, ledgerDocument.id, claimedLedger);
        releasedCount += 1;
      } catch (error) {
        failedCount += 1;
        logger.error("Payout ledger release failed", {
          ledgerId: ledgerDocument.id,
          error,
        });

        await ledgerDocument.ref.set(
          {
            status: "in_release",
            lastReleaseError:
              error instanceof Error ? error.message.slice(0, 500) : "Unknown error",
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }
    }

    // Failures escalate the whole summary to error so log-based alerting can
    // key off severity alone — a payout that silently fails for days is the
    // single worst trust failure a marketplace can have.
    const summary = {
      releasedCount,
      skippedCount,
      failedCount,
      recoveredCount,
    };
    if (failedCount > 0) {
      logger.error("Daily release transfers finished with failures", summary);
    } else {
      logger.info("Daily release transfers finished", summary);
    }
  },
);

async function claimLedgerForRelease(
  ledgerRef: DocumentReference,
  now: number,
): Promise<PayoutLedgerRecord | null> {
  return db.runTransaction(async (transaction) => {
    const ledgerSnapshot = await transaction.get(ledgerRef);

    if (!ledgerSnapshot.exists) {
      return null;
    }

    const ledger = ledgerSnapshot.data() as PayoutLedgerRecord;
    const releaseAtMillis = timestampToMillis(ledger.releaseAt);

    if (
      ledger.status !== "in_release"
      || !releaseAtMillis
      || releaseAtMillis > now
    ) {
      return null;
    }

    // Freeze the transfer amount once, at claim time. A partial refund that
    // landed before release leaves the ledger in_release with a recorded
    // refundedAmountMinor (see handleChargeRefunded), so the teacher is owed
    // only the proportional un-refunded net. Computing this once and persisting
    // it means every release retry moves the SAME amount under the stable
    // `transfer_${ledgerId}` idempotency key — recomputing mid-flight could
    // reuse that key with a different amount (a Stripe error) or double-pay.
    const plannedTransferAmountMinor =
      typeof ledger.plannedTransferAmountMinor === "number"
        ? ledger.plannedTransferAmountMinor
        : plannedReleaseTransferAmountMinor({
            netAmountMinor: Number(ledger.netAmountMinor || 0),
            grossAmountMinor: Number(ledger.grossAmountMinor || 0),
            refundedAmountMinor: Number(ledger.refundedAmountMinor || 0),
          });

    transaction.set(
      ledgerRef,
      {
        status: "releasing",
        plannedTransferAmountMinor,
        releaseAttemptCount: FieldValue.increment(1),
        lastReleaseAttemptAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return { ...ledger, plannedTransferAmountMinor };
  });
}

async function releaseLedgerTransfer(
  stripe: Stripe,
  ledgerId: string,
  ledger: PayoutLedgerRecord,
) {
  const ledgerRef = db.collection("payoutLedger").doc(ledgerId);
  const destination = ledger.teacherStripeConnectedAccountId;
  // Pay the frozen planned amount (full net, or the reduced share when a partial
  // refund landed before release). Fall back to net for ledgers written before
  // plannedTransferAmountMinor existed. (Gap 1)
  const amount = Number(
    ledger.plannedTransferAmountMinor ?? ledger.netAmountMinor ?? 0,
  );
  const currency = normalizeSkillsetCurrency(ledger.currency).toLowerCase();

  if (!destination) {
    throw new Error("Teacher connected account is missing.");
  }

  if (amount <= 0) {
    // Fully refunded before release: nothing to transfer. Record a zero
    // transferAmountMinor so a later refund's reversal math sees that no money
    // left the platform.
    await ledgerRef.set(
      {
        status: "released",
        transferId: null,
        transferAmountMinor: 0,
        releasedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return;
  }

  const transfer = await stripe.transfers.create(
    {
      amount,
      currency,
      destination,
      description: `Skillset course payout ${ledger.orderId}`,
      metadata: {
        ledgerId,
        orderId: ledger.orderId,
        courseId: ledger.courseId,
        teacherId: ledger.teacherId,
        paymentId: ledger.paymentId,
      },
    },
    {
      idempotencyKey: `transfer_${ledgerId}`,
    },
  );

  // RACE GUARD: between transfers.create and persisting the result, a refund
  // webhook (handleChargeRefunded) may have flipped this ledger to refunded.
  // That handler could NOT reverse the transfer because transferId was not
  // persisted yet. Re-read transactionally: if still releasing, mark released;
  // if a refund raced in, record the transferId but keep the refunded status
  // and reverse the transfer we just created (Stripe call lives OUTSIDE the txn).
  const raceDecision = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ledgerRef);
    const current = snapshot.exists
      ? (snapshot.data() as PayoutLedgerRecord)
      : null;
    const refundedMidRelease =
      current?.status === "refunded"
      || current?.status === "partially_refunded";

    if (refundedMidRelease) {
      transaction.set(
        ledgerRef,
        {
          transferId: transfer.id,
          transferAmountMinor: amount,
          transferReleasedDuringRefund: true,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      return {
        released: false as const,
        refundedAmountMinor: Number(current?.refundedAmountMinor || 0),
        alreadyReversedAmountMinor: Number(
          current?.transferReversedAmountMinor || 0,
        ),
      };
    }

    transaction.set(
      ledgerRef,
      {
        status: "released",
        transferId: transfer.id,
        transferAmountMinor: amount,
        releasedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return { released: true as const };
  });

  if (!raceDecision.released) {
    // Buyer was refunded while we transferred funds to the teacher. Reverse the
    // transfer so the platform does not pay out money it no longer holds.
    const reversal = await createReleasedRefundTransferReversal({
      stripe: stripe as unknown as TransferReversalStripeClient,
      ledgerId,
      transferId: transfer.id,
      grossAmountMinor: Number(ledger.grossAmountMinor || 0),
      refundedAmountMinor: raceDecision.refundedAmountMinor || amount,
      releasedTransferAmountMinor: amount,
      // Full net, so the reversal math can distinguish a reduced transfer
      // (partial refund before release) from a full-net one. (Gap 1)
      netAmountMinor: Number(ledger.netAmountMinor || 0),
      alreadyReversedAmountMinor: raceDecision.alreadyReversedAmountMinor,
      idempotencyKey: `transfer_reversal_${ledgerId}_release_race`,
      metadata: {
        ledgerId,
        orderId: ledger.orderId,
        reason: "release_refund_race",
      },
    });

    if (reversal.reversalAmountMinor > 0) {
      await ledgerRef.set(
        {
          transferReversedAmountMinor: FieldValue.increment(
            reversal.reversalAmountMinor,
          ),
          latestTransferReversalId: reversal.reversalId,
          latestTransferReversalAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }

    logger.warn("Payout transfer reversed due to refund race", {
      ledgerId,
      transferId: transfer.id,
      reversalAmountMinor: reversal.reversalAmountMinor,
    });
    return;
  }

  // Structured money log: every payout that actually moved funds leaves one
  // queryable line with the Stripe transfer id, so support can answer "where
  // is my payout?" from logs alone.
  logger.info("Payout transfer released", {
    ledgerId,
    orderId: ledger.orderId,
    teacherId: ledger.teacherId,
    transferId: transfer.id,
    amountMinor: amount,
    currency,
  });

  await captureServerEvent(ledger.teacherId, SERVER_EVENTS.PAYOUT_RELEASED, {
    ledger_id: ledgerId,
    teacher_id: ledger.teacherId,
    amount_minor: amount,
    currency: normalizeSkillsetCurrency(ledger.currency),
  });
}

export const issueSkillsetCertificate = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in before requesting a certificate.");
  }

  const userId = request.auth.uid;
  const enrollmentId = String(request.data?.enrollmentId || "").trim();

  if (!enrollmentId || enrollmentId.length > 220) {
    throw new HttpsError("invalid-argument", "A valid enrollmentId is required.");
  }

  // The learner types the name once; it is written to the certificate (an
  // admin-SDK-only collection) and is therefore permanently locked — the
  // client can never edit an issued credential.
  const fullName = String(request.data?.fullName ?? "")
    .replace(/\s+/g, " ")
    .trim();

  if (fullName.length < 2 || fullName.length > 120) {
    throw new HttpsError(
      "invalid-argument",
      "Enter the full name (2-120 characters) to print on the certificate.",
    );
  }

  // Re-issue is idempotent, so a handful of calls covers any legitimate
  // learner; keying on userId also caps rapid enrollmentId probing.
  await enforceRateLimit(`certificate_issue_${userId}`, 20, 60 * 60 * 1000);

  const enrollmentRef = db.collection("enrollments").doc(enrollmentId);
  const certificateRef = db.collection("certificates").doc(enrollmentId);

  await db.runTransaction(async (transaction) => {
    const [enrollmentSnapshot, certificateSnapshot] = await Promise.all([
      transaction.get(enrollmentRef),
      transaction.get(certificateRef),
    ]);

    if (!enrollmentSnapshot.exists) {
      throw new HttpsError("not-found", "Enrollment not found.");
    }

    const enrollment = enrollmentSnapshot.data() as EnrollmentRecord;

    if (enrollment.userId !== userId) {
      throw new HttpsError(
        "permission-denied",
        "You can only request your own certificate.",
      );
    }

    if (
      enrollment.status !== "completed"
      && (enrollment.progressPercent ?? 0) < 100
    ) {
      throw new HttpsError(
        "failed-precondition",
        "Complete the course before requesting a certificate.",
      );
    }

    if (["refunded", "revoked", "expired"].includes(enrollment.status)) {
      throw new HttpsError(
        "failed-precondition",
        "This enrollment is not eligible for certificate issuance.",
      );
    }

    if (certificateSnapshot.exists) {
      const certificate = certificateSnapshot.data() || {};

      if (certificate.status === "revoked") {
        throw new HttpsError(
          "failed-precondition",
          "This certificate was revoked by Skillset operations.",
        );
      }

      transaction.set(
        certificateRef,
        {
          status: "issued",
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      return;
    }

    // Snapshot the teacher's identity at issuance time so the credential is a
    // permanent record — a later display-name or signature change must not
    // rewrite an already-issued certificate. These reads stay before the write
    // to satisfy the transaction read-before-write contract (the re-issue
    // branch above returns before reaching here, so no write has happened yet).
    let teacherName: string | null = null;
    let teacherSignatureUrl: string | null = null;
    const courseSnapshot = await transaction.get(
      db.collection("courses").doc(enrollment.courseId),
    );

    if (courseSnapshot.exists) {
      const course = courseSnapshot.data() as TeacherCourseRecord;
      const ownerSnapshot = await transaction.get(
        db.collection("users").doc(course.ownerId),
      );

      if (ownerSnapshot.exists) {
        const owner = ownerSnapshot.data() as UserProfileRecord;
        teacherName = owner.displayName?.trim() || null;
        teacherSignatureUrl =
          typeof owner.teacherSignatureUrl === "string" && owner.teacherSignatureUrl
            ? owner.teacherSignatureUrl
            : null;
      }
    }

    const verificationCode = `SK-${enrollmentId
      .replace(/[^a-zA-Z0-9]/g, "")
      .slice(0, 18)
      .toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;

    transaction.set(certificateRef, {
      id: certificateRef.id,
      enrollmentId,
      userId: enrollment.userId,
      courseId: enrollment.courseId,
      courseSlug: enrollment.courseSlug,
      courseTitle: enrollment.courseTitle,
      courseCategory: enrollment.courseCategory,
      authorityLabel: "Skillset Verified",
      status: "issued",
      verificationCode,
      studentFullName: fullName,
      teacherName,
      teacherSignatureUrl,
      // Optional partner/sponsor mark, rendered on the certificate when present.
      // Left null until Skillset provides a co-brand asset.
      sponsorLogoUrl: null,
      issuedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  return {
    certificateId: certificateRef.id,
  };
});

/**
 * Server-authoritative lesson progress. The client can no longer write
 * `progressPercent`/`status` on an enrollment, nor the `progress` subcollection
 * (both are admin-only in firestore.rules). All completion flows through here:
 * we validate the lesson belongs to the course, write the marker via the Admin
 * SDK, recompute the percentage from real markers, and persist it atomically.
 * This closes the spoof that let a user forge 100% (free certificate) or forge
 * low progress after consuming a course (gaming the refund progress cap).
 */
export const recordLessonProgress = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in before tracking progress.");
  }

  const userId = request.auth.uid;
  const enrollmentId = String(request.data?.enrollmentId || "").trim();
  const lessonId = String(request.data?.lessonId || "").trim();
  const completed = request.data?.completed === true;

  if (!enrollmentId || enrollmentId.length > 220) {
    throw new HttpsError("invalid-argument", "A valid enrollmentId is required.");
  }

  if (!lessonId || lessonId.length > 200) {
    throw new HttpsError("invalid-argument", "A valid lessonId is required.");
  }

  // Generous cap (200/hr) — far above any real learner pace, but stops a
  // runaway client loop from spamming Firestore progress writes.
  await enforceRateLimit(`lesson_progress_${userId}`, 200, 60 * 60 * 1000);

  const enrollmentRef = db.collection("enrollments").doc(enrollmentId);
  const enrollmentSnapshot = await enrollmentRef.get();

  if (!enrollmentSnapshot.exists) {
    throw new HttpsError("not-found", "Enrollment not found.");
  }

  const enrollment = enrollmentSnapshot.data() as EnrollmentRecord;

  if (enrollment.userId !== userId) {
    throw new HttpsError(
      "permission-denied",
      "You can only update progress for your own enrollments.",
    );
  }

  if (["refunded", "revoked", "expired"].includes(enrollment.status)) {
    throw new HttpsError(
      "failed-precondition",
      "This enrollment is no longer active.",
    );
  }

  const courseSnapshot = await db
    .collection("courses")
    .doc(enrollment.courseId)
    .get();

  if (!courseSnapshot.exists) {
    throw new HttpsError("not-found", "Course not found.");
  }

  const course = courseSnapshot.data() as TeacherCourseRecord;
  const validLessonIds = extractCourseLessonIds(course.modules);
  const totalLessons = validLessonIds.size;

  if (!validLessonIds.has(lessonId)) {
    throw new HttpsError(
      "invalid-argument",
      "That lesson does not belong to this course.",
    );
  }

  const progressCollectionRef = enrollmentRef.collection("progress");
  const progressRef = progressCollectionRef.doc(lessonId);

  const result = await db.runTransaction(async (transaction) => {
    const freshEnrollmentSnapshot = await transaction.get(enrollmentRef);

    if (!freshEnrollmentSnapshot.exists) {
      throw new HttpsError("not-found", "Enrollment not found.");
    }

    const freshEnrollment = freshEnrollmentSnapshot.data() as EnrollmentRecord;

    if (freshEnrollment.userId !== userId) {
      throw new HttpsError(
        "permission-denied",
        "You can only update progress for your own enrollments.",
      );
    }

    if (["refunded", "revoked", "expired"].includes(freshEnrollment.status)) {
      throw new HttpsError(
        "failed-precondition",
        "This enrollment is no longer active.",
      );
    }

    const progressSnapshot = await transaction.get(progressCollectionRef);
    const completedSet = new Set<string>();

    for (const document of progressSnapshot.docs) {
      if (validLessonIds.has(document.id)) {
        completedSet.add(document.id);
      }
    }

    if (completed) {
      completedSet.add(lessonId);
    } else {
      completedSet.delete(lessonId);
    }

    const completedCount = completedSet.size;
    const progressPercent =
      totalLessons > 0
        ? Math.min(
            100,
            Math.max(0, Math.round((completedCount / totalLessons) * 100)),
          )
        : 0;
    const status = progressPercent >= 100 ? "completed" : "active";

    if (completed) {
      transaction.set(
        progressRef,
        {
          lessonId,
          userId,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    } else {
      transaction.delete(progressRef);
    }

    transaction.update(enrollmentRef, {
      progressPercent,
      status,
      updatedAt: FieldValue.serverTimestamp(),
      ...(completed ? { lastLessonId: lessonId } : {}),
    });

    return { progressPercent, status, completedCount };
  });

  return {
    progressPercent: result.progressPercent,
    status: result.status,
    completedLessonCount: result.completedCount,
    totalLessonCount: totalLessons,
  };
});

/**
 * Admin-initiated refund. Mirrors the buyer-facing requestRefund money path but
 * gated on an admin role and able to refund partially. The state transition
 * (order/payment/ledger/enrollment -> refunded, transfer reversal) flows through
 * the existing charge.refunded webhook, so this only kicks off the Stripe refund
 * and records the REQUEST in the audit trail.
 */
export const issueAdminRefund = onCall(
  { secrets: [stripeSecretKey] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in as an administrator.");
    }

    const callerId = request.auth.uid;
    const callerSnapshot = await db.collection("users").doc(callerId).get();
    const callerProfile = callerSnapshot.data() as UserProfileRecord | undefined;
    const callerRoles = Array.isArray(callerProfile?.roles)
      ? callerProfile.roles
      : [];

    if (!callerRoles.includes("admin")) {
      throw new HttpsError(
        "permission-denied",
        "Administrator access is required.",
      );
    }

    const orderId = String(request.data?.orderId || "").trim();

    if (!orderId || orderId.length > 220) {
      throw new HttpsError("invalid-argument", "A valid orderId is required.");
    }

    const rawAmount = request.data?.amountMinor;
    let amountMinor: number | null = null;

    if (rawAmount !== undefined && rawAmount !== null) {
      const parsed = Number(rawAmount);

      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new HttpsError(
          "invalid-argument",
          "amountMinor must be a positive integer in minor units.",
        );
      }

      amountMinor = parsed;
    }

    await enforceRateLimit(`admin_refund_${callerId}`, 30, 60 * 60 * 1000);

    const orderRef = db.collection("orders").doc(orderId);
    const orderSnapshot = await orderRef.get();

    if (!orderSnapshot.exists) {
      throw new HttpsError("not-found", "Order not found.");
    }

    const order = orderSnapshot.data() || {};

    if (order.status !== "paid" && order.status !== "partially_refunded") {
      throw new HttpsError(
        "failed-precondition",
        "Only paid orders can be refunded.",
      );
    }

    const paymentIntentId = String(order.paymentIntentId || "");

    if (!paymentIntentId) {
      throw new HttpsError(
        "failed-precondition",
        "Payment intent not found for this order.",
      );
    }

    const orderAmountMinor = Number(order.amountMinor || 0);
    // For a partially_refunded order, cap against what is STILL refundable
    // (total − already refunded), not the original total — otherwise repeated
    // partial refunds could cumulatively exceed the original charge.
    const alreadyRefundedMinor = Number(order.refundedAmountMinor || 0);
    const remainingRefundableMinor = orderAmountMinor - alreadyRefundedMinor;

    if (
      amountMinor !== null
      && orderAmountMinor > 0
      && amountMinor > remainingRefundableMinor
    ) {
      throw new HttpsError(
        "invalid-argument",
        "Refund amount exceeds the remaining refundable balance.",
      );
    }

    const stripe = getStripeClient();
    const refund = await stripe.refunds.create(
      {
        payment_intent: paymentIntentId,
        ...(amountMinor !== null ? { amount: amountMinor } : {}),
        metadata: {
          orderId,
          courseId: typeof order.courseId === "string" ? order.courseId : "",
          userId: typeof order.userId === "string" ? order.userId : "",
          source: "admin_request",
          adminId: callerId,
        },
      },
      {
        idempotencyKey:
          amountMinor !== null
            ? `admin_refund_${orderId}_${amountMinor}`
            : `admin_refund_${orderId}_full`,
      },
    );

    await orderRef.set(
      {
        refundRequestedAt: FieldValue.serverTimestamp(),
        refundRequestId: refund.id,
        refundRequestedBy: callerId,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    await recordAuditEvent({
      action: AUDIT_ACTIONS.REFUND_REQUESTED,
      actorId: callerId,
      actorEmail:
        typeof request.auth.token.email === "string"
          ? request.auth.token.email
          : null,
      targetType: "order",
      targetId: orderId,
      summary: `Admin refund requested for order ${orderId}`,
      metadata: {
        refundId: refund.id,
        courseId: typeof order.courseId === "string" ? order.courseId : null,
        userId: typeof order.userId === "string" ? order.userId : null,
        amountMinor: amountMinor ?? orderAmountMinor,
        partial:
          amountMinor !== null
          && orderAmountMinor > 0
          && amountMinor < orderAmountMinor,
        source: "admin_request",
      },
    });

    return {
      refundId: refund.id,
      status: refund.status,
    };
  },
);

export const verifySkillsetCertificate = onCall(async (request) => {
  const verificationCode = String(request.data?.verificationCode || "")
    .trim()
    .toUpperCase();

  if (!verificationCode || verificationCode.length > 80) {
    throw new HttpsError("invalid-argument", "A valid verification code is required.");
  }

  // Public-facing lookup: throttle per caller (uid when signed in, IP
  // otherwise) so the indexed Firestore query cannot be hammered freely.
  const verifierKey =
    request.auth?.uid ?? request.rawRequest?.ip ?? "anon";
  await enforceRateLimit(`cert_verify_call_${verifierKey}`, 60, 60 * 60 * 1000);

  return verifyCertificateCode(verificationCode);
});

export const verifySkillsetCertificateHttp = onRequest(
  async (request, response) => {
    response.set("Access-Control-Allow-Origin", "*");
    response.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    response.set("Access-Control-Allow-Headers", "Content-Type");
    response.set("Cache-Control", "no-store");

    if (request.method === "OPTIONS") {
      response.status(204).send("");
      return;
    }

    if (request.method !== "GET") {
      response.status(405).json({ error: "Method not allowed." });
      return;
    }

    const verificationCode = String(request.query.code || "")
      .trim()
      .toUpperCase();

    if (!verificationCode || verificationCode.length > 80) {
      response.status(400).json({ error: "A valid verification code is required." });
      return;
    }

    // Unauthenticated + CORS "*" by design (embeddable verification) — rate
    // limit per client IP so it cannot drive unbounded Firestore queries.
    const clientIp =
      request.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() ||
      request.ip ||
      "unknown";

    try {
      await enforceRateLimit(`cert_verify_http_${clientIp}`, 60, 60 * 60 * 1000);
    } catch (error) {
      if (error instanceof HttpsError && error.code === "resource-exhausted") {
        response.status(429).json({ error: "Too many attempts. Please wait before trying again." });
        return;
      }
      logger.error("Certificate verification rate limit check failed", error);
      response.status(500).json({ error: "Certificate verification failed." });
      return;
    }

    try {
      response.status(200).json(await verifyCertificateCode(verificationCode));
    } catch (error) {
      logger.error("Public certificate verification failed", error);
      response.status(500).json({ error: "Certificate verification failed." });
    }
  },
);

async function verifyCertificateCode(
  verificationCode: string,
): Promise<CertificateVerificationResult> {
  const certificatesSnapshot = await db
    .collection("certificates")
    .where("verificationCode", "==", verificationCode)
    .where("status", "==", "issued")
    .limit(1)
    .get();

  if (certificatesSnapshot.empty) {
    return {
      valid: false,
    };
  }

  const certificate = certificatesSnapshot.docs[0].data();

  return {
    valid: true,
    certificate: {
      courseTitle: certificate.courseTitle,
      courseCategory: certificate.courseCategory,
      authorityLabel: certificate.authorityLabel || "Skillset Verified",
      verificationCode: certificate.verificationCode,
      issuedAt: certificate.issuedAt?.toDate?.().toISOString?.() ?? null,
    },
  };
}

// Every event type the webhook below actually handles. Anything else is
// acknowledged immediately after signature verification WITHOUT touching
// Firestore — the two-phase idempotency claim costs 2 writes + 1 read per
// event, and a broadly-subscribed endpoint receives far more event types
// than it handles. Keep this list in sync with the `event.type` checks below.
const HANDLED_STRIPE_EVENT_TYPES = new Set<string>([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "payment_intent.payment_failed",
  "charge.refunded",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed",
  "invoice.paid",
]);

export const stripeWebhook = onRequest(
  { secrets: [stripeSecretKey, stripeWebhookSecret] },
  async (request, response) => {
    const webhookSecret =
      stripeWebhookSecret.value() || process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
      response.status(500).send("Stripe webhook secret is not configured.");
      return;
    }

    const signature = request.header("stripe-signature");

    if (!signature) {
      response.status(400).send("Missing Stripe signature.");
      return;
    }

    let event: Stripe.Event;

    try {
      event = getStripeClient().webhooks.constructEvent(
        request.rawBody,
        signature,
        webhookSecret,
      );
    } catch (error) {
      logger.warn("Stripe webhook signature verification failed", error);
      response.status(400).send("Invalid Stripe webhook signature.");
      return;
    }

    // Early type filter: unhandled event types are acknowledged without the
    // Firestore idempotency round-trip — there is nothing to deduplicate when
    // there is no handler. Runs AFTER signature verification so unauthenticated
    // requests still get rejected.
    if (!HANDLED_STRIPE_EVENT_TYPES.has(event.type)) {
      response.json({ received: true, ignored: true });
      return;
    }

    try {
      // Idempotency (two-phase): claim the event as "processing", then promote
      // it to "done" only AFTER every handler below succeeds. Stripe retries on
      // any non-2xx, so a failed attempt leaves a "processing" marker that the
      // retry reprocesses — a single-phase claim-before-commit marker would
      // short-circuit the retry as a duplicate and silently lose the event.
      // See claimStripeEvent / markStripeEventDone in payment-rules.ts.
      const eventMarkerRef = db
        .collection("processedStripeEvents")
        .doc(event.id);
      const claim = await claimStripeEvent(eventMarkerRef, () =>
        FieldValue.serverTimestamp(),
      );
      if (claim === "duplicate") {
        response.json({ received: true, duplicate: true });
        return;
      }

      if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        if (session.mode === "subscription") {
          // Subscription Checkout: subscription.created will deliver
          // shortly with full state, so we just log and let that handler
          // own the persistence. Avoids race conditions.
          logger.info("Subscription Checkout completed", {
            sessionId: session.id,
            subscriptionId: session.subscription,
          });
        } else {
          await handleCheckoutCompleted(session);
        }
      }

      if (event.type === "checkout.session.async_payment_succeeded") {
        // Delayed payment methods (bank debits, vouchers) complete the Checkout
        // Session as payment_status="unpaid" first — handleCheckoutCompleted
        // defers those — and only later, when the funds clear, does Stripe fire
        // async_payment_succeeded with payment_status="paid". This is the actual
        // fulfilment trigger for those methods; without it the buyer pays and
        // never receives the course. (Gap 3)
        const session = event.data.object;
        if (session.mode === "subscription") {
          logger.info("Subscription async payment succeeded", {
            sessionId: session.id,
            subscriptionId: session.subscription,
          });
        } else {
          await handleCheckoutCompleted(session);
        }
      }

      if (event.type === "checkout.session.async_payment_failed") {
        // The delayed payment never cleared. Mark the order failed so it does
        // not sit pending forever and the in-flight checkout lock is released
        // (markOrderStatus owns the ownership-checked lock cleanup). (Gap 3)
        await markOrderStatus(event.data.object.metadata?.orderId, "failed");
      }

      if (event.type === "checkout.session.expired") {
        await markOrderStatus(event.data.object.metadata?.orderId, "cancelled");
      }

      if (event.type === "payment_intent.payment_failed") {
        await markOrderStatus(event.data.object.metadata?.orderId, "failed");
      }

      if (event.type === "charge.refunded") {
        await handleChargeRefunded(event.data.object);
        // PostHog: refund_requested is emitted at request time inside the
        // requestRefund callable (it carries course_id + progress_pct). This
        // webhook only fulfils the refund, so no separate event is emitted.
      }

      if (
        event.type === "customer.subscription.created" ||
        event.type === "customer.subscription.updated"
      ) {
        const subscriptionObject = event.data.object;
        // Course subscriptions drive enrollment access (grant/grace/revoke);
        // plan subscriptions drive currentPlanId + commission. Route by
        // metadata.purpose: the course handler returns true when it owns it.
        const handledAsCourse =
          await handleCourseSubscriptionLifecycle(subscriptionObject);
        if (!handledAsCourse) {
          await syncSubscriptionFromStripe(subscriptionObject);
        }
        // PostHog: checkout_completed (course sales) is emitted in
        // handleCheckoutCompleted, which owns order_id + platform_fee_bps.
        // Plan-subscription billing has no taxonomy event yet (future:
        // plan_upgraded) — intentionally not emitted here.
      }

      if (event.type === "customer.subscription.deleted") {
        const subscriptionObject = event.data.object;
        const handledAsCourse =
          await handleCourseSubscriptionLifecycle(subscriptionObject);
        if (!handledAsCourse) {
          await syncSubscriptionFromStripe(subscriptionObject);
        }
      }

      if (event.type === "invoice.payment_failed") {
        await handleInvoicePaymentFailed(event.data.object);
      }

      if (event.type === "invoice.paid") {
        // Course-subscription fulfilment. Plan invoices are filtered inside the
        // handler (it no-ops unless the subscription is purpose=course_subscription).
        await handleCourseSubscriptionInvoicePaid(event.data.object);
      }

      // Promote the idempotency marker to "done" ONLY after every handler ran
      // without throwing; a throw skips this and leaves the marker at
      // "processing", so the Stripe retry reprocesses the event instead of
      // mistaking it for an already-handled duplicate.
      await markStripeEventDone(eventMarkerRef, () =>
        FieldValue.serverTimestamp(),
      );
      response.json({ received: true });
    } catch (error) {
      logger.error("Stripe webhook handling failed", error);
      response.status(500).send("Webhook handling failed.");
    }
  },
);

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  if (session.payment_status !== "paid") {
    return;
  }

  const orderId = session.metadata?.orderId;
  const courseId = session.metadata?.courseId;
  const userId = session.metadata?.userId;

  if (!orderId || !courseId || !userId) {
    throw new Error("Missing required Checkout metadata.");
  }

  const orderRef = db.collection("orders").doc(orderId);
  const courseRef = db.collection("courses").doc(courseId);
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id || session.id;
  const paymentRef = db.collection("payments").doc(paymentIntentId);
  const enrollmentRef = db.collection("enrollments").doc(`${userId}__${courseId}`);
  const ledgerRef = db.collection("payoutLedger").doc(orderId);

  // Best-effort capture of the Stripe hosted receipt for this one-off
  // purchase so the buyer's Billing -> Purchases tab can link straight to it.
  // The receipt URL lives on the Charge, so we expand the PaymentIntent's
  // latest charge. One-off course checkout uses `customer_email` (not a
  // persistent Stripe Customer), so these charges never surface in the
  // Customer Portal — the charge receipt_url is the only buyer-facing receipt.
  // Isolated in its own try/catch: a failure here must never block the
  // enrollment / payment / ledger writes below.
  let receiptUrl: string | null = null;
  const receiptIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id || null;
  if (receiptIntentId) {
    try {
      const intent = await getStripeClient().paymentIntents.retrieve(
        receiptIntentId,
        { expand: ["latest_charge"] },
      );
      const latestCharge = intent.latest_charge;
      if (latestCharge && typeof latestCharge !== "string") {
        receiptUrl = latestCharge.receipt_url ?? null;
      }
    } catch (error) {
      logger.warn("Could not resolve Stripe receipt URL for order", {
        orderId,
        paymentIntentId: receiptIntentId,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  const checkoutAnalytics: {
    value:
      | {
          teacherId: string;
          grossMinor: number;
          platformFeeBps: number;
          platformFeeMinor: number;
          currency: string;
        }
      | null;
  } = { value: null };

  // Payout clearance window is platform-configurable (7/10/15/30 days, default 30).
  // Read outside the transaction (Firestore requires reads before writes) and fall
  // back to the default so a config miss can never block the money path.
  let payoutDelayDays: number = payoutReleaseDelayDays;
  try {
    const paymentsConfigSnapshot = await db
      .collection("platformConfig")
      .doc("payments")
      .get();
    payoutDelayDays = resolvePayoutReleaseDelayDays(
      paymentsConfigSnapshot.data()?.payoutReleaseDelayDays,
    );
  } catch (error) {
    logger.warn("Could not read payout delay config; using default", {
      orderId,
      defaultDays: payoutReleaseDelayDays,
      error: error instanceof Error ? error.message : "unknown",
    });
  }

  await db.runTransaction(async (transaction) => {
    const [orderSnapshot, courseSnapshot, enrollmentSnapshot, ledgerSnapshot] =
      await Promise.all([
        transaction.get(orderRef),
        transaction.get(courseRef),
        transaction.get(enrollmentRef),
        transaction.get(ledgerRef),
      ]);

    if (!orderSnapshot.exists) {
      throw new Error(`Order ${orderId} not found.`);
    }

    if (!courseSnapshot.exists) {
      throw new Error(`Course ${courseId} not found.`);
    }

    // Re-arm guard (Gap 3): the payout ledger is created exactly once per order,
    // here, and this transaction is atomic — so a ledger already existing means
    // this order was already fully fulfilled (payment + order + enrollment all
    // committed with it). A second completion event for the same order — a
    // redelivered checkout.session.completed, OR an async_payment_succeeded that
    // arrives after a refund, OR any replay the idempotency marker did not catch
    // — must NOT re-run fulfilment: doing so would flip order back to `paid`,
    // reset the ledger to `in_release` with a FRESH releaseAt, and re-schedule a
    // payout for money that may have been refunded. Skip idempotently.
    if (ledgerSnapshot.exists) {
      logger.info("Checkout fulfilment skipped; order already fulfilled", {
        orderId,
        ledgerStatus: String(
          (ledgerSnapshot.data() as PayoutLedgerRecord).status || "",
        ),
      });
      return;
    }

    const order = orderSnapshot.data() || {};
    const course = courseSnapshot.data() as TeacherCourseRecord;
    const grossAmountMinor = Number(order.amountMinor || 0);
    // Falls back to 800 bps (8%, Free plan) ONLY when the field is genuinely
    // absent (order pre-dates the subscription system). Uses ?? not || so an
    // explicit 0 (Plus plan, zero commission) survives — `0 || 800` would
    // silently overcharge every Plus-tier sale the full 8%.
    const platformFeeBps = Number(order.platformFeeBps ?? DEFAULT_PLATFORM_FEE_BPS);
    const skillsetFeeMinor = Math.floor((grossAmountMinor * platformFeeBps) / 10000);
    const stripeFeeMinor = canonicalStripeProcessingFeeMinor(
      grossAmountMinor,
      order.currency,
    );
    const netAmountMinor = Math.max(
      0,
      grossAmountMinor - skillsetFeeMinor - stripeFeeMinor,
    );

    checkoutAnalytics.value = {
      teacherId: course.ownerId,
      grossMinor: grossAmountMinor,
      platformFeeBps,
      platformFeeMinor: skillsetFeeMinor,
      currency: String(order.currency || defaultSkillsetCurrency),
    };

    transaction.set(
      paymentRef,
      {
        id: paymentRef.id,
        orderId,
        userId,
        courseId,
        amountMinor: order.amountMinor,
        currency: order.currency,
        provider: "stripe",
        providerPaymentId: paymentIntentId,
        status: "succeeded",
        ...(receiptUrl ? { receiptUrl } : {}),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    transaction.update(orderRef, {
      status: "paid",
      checkoutSessionId: session.id,
      paymentIntentId,
      ...(receiptUrl ? { receiptUrl } : {}),
      paidAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    transaction.set(
      ledgerRef,
      {
        id: ledgerRef.id,
        teacherId: course.ownerId,
        teacherStripeConnectedAccountId:
          order.teacherStripeConnectedAccountId || course.stripeConnectedAccountId || null,
        courseId,
        orderId,
        paymentId: paymentIntentId,
        grossAmountMinor,
        skillsetFeeMinor,
        stripeFeeMinor,
        netAmountMinor,
        currency: order.currency,
        platformFeeBps,
        status: "in_release",
        releaseAt: getPayoutReleaseAt(payoutDelayDays),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    if (!enrollmentSnapshot.exists) {
      transaction.set(enrollmentRef, {
        id: enrollmentRef.id,
        userId,
        courseId,
        courseSlug: courseId,
        courseTitle: course.title,
        courseCategory: course.category,
        courseImage: course.coverImageUrl || "/brand/logo-mark.png",
        status: "active",
        source: "payment",
        progressPercent: 0,
        lastLessonId: null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  });

  if (checkoutAnalytics.value) {
    await captureServerEvent(userId, SERVER_EVENTS.CHECKOUT_COMPLETED, {
      order_id: orderId,
      course_id: courseId,
      teacher_id: checkoutAnalytics.value.teacherId,
      gross_minor: checkoutAnalytics.value.grossMinor,
      platform_fee_bps: checkoutAnalytics.value.platformFeeBps,
      platform_fee_minor: checkoutAnalytics.value.platformFeeMinor,
      currency: checkoutAnalytics.value.currency,
    });
  }

  // Release the in-flight checkout lock now that the purchase is settled, so a
  // future legitimate re-purchase (e.g. after a refund) is never blocked — but
  // only if the lock still belongs to THIS order, mirroring markOrderStatus so
  // the release policy is uniform and a sibling attempt's lock is never dropped
  // (safe today via the enrollment gate; this keeps it safe if that weakens). [B3]
  const settledLockRef = db
    .collection("checkoutLocks")
    .doc(`${userId}__${courseId}`);
  await db.runTransaction(async (transaction) => {
    const lockSnapshot = await transaction.get(settledLockRef);
    if (
      lockSnapshot.exists &&
      shouldReleaseCheckoutLock(lockSnapshot.data()?.orderId, orderId)
    ) {
      transaction.delete(settledLockRef);
    }
  });
}

// Resolve the subscription id from a Stripe Invoice across API versions. The
// pinned API (2026-02-25.clover, post-Basil) removed the top-level
// invoice.subscription field and moved it to
// invoice.parent.subscription_details.subscription. Read the current location
// first, then fall back to the legacy top-level field so fulfilment still works
// if an older-versioned event ever reaches us. Returning null here silently
// dropped EVERY course-subscription invoice (no enrollment grant, no payout
// ledger) once the account defaulted to a Basil-or-later API version.
function resolveInvoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const fromParent = invoice.parent?.subscription_details?.subscription;
  if (typeof fromParent === "string" && fromParent) {
    return fromParent;
  }
  if (fromParent && typeof fromParent === "object" && typeof fromParent.id === "string") {
    return fromParent.id;
  }

  const legacyField = (invoice as { subscription?: string | { id: string } | null })
    .subscription;
  if (typeof legacyField === "string" && legacyField) {
    return legacyField;
  }
  if (legacyField && typeof legacyField === "object" && typeof legacyField.id === "string") {
    return legacyField.id;
  }

  return null;
}

// Course-subscription fulfilment: each PAID recurring invoice is held in the
// payoutLedger (released to the teacher by dailyReleaseTransfers after the
// refund window — the SAME rail as one-time) and grants/refreshes the buyer's
// enrollment. Plan-subscription invoices (purpose != course_subscription) are
// ignored here; the platform plan is fulfilled via customer.subscription.* in
// syncSubscriptionFromStripe.
async function handleCourseSubscriptionInvoicePaid(invoice: Stripe.Invoice) {
  const subscriptionId = resolveInvoiceSubscriptionId(invoice);

  if (!subscriptionId) {
    // A non-subscription invoice (one-off / manual) — not our concern.
    return;
  }

  const stripe = getStripeClient();
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const meta = subscription.metadata ?? {};

  if (meta.purpose !== "course_subscription") {
    // Platform-plan invoice — entitlement is driven by customer.subscription.*.
    return;
  }

  const courseId = typeof meta.courseId === "string" ? meta.courseId : null;
  const userId = typeof meta.userId === "string" ? meta.userId : null;
  const teacherId = typeof meta.teacherId === "string" ? meta.teacherId : null;

  if (!courseId || !userId || !teacherId) {
    logger.error("course_subscription invoice missing required metadata", {
      invoiceId: invoice.id,
      subscriptionId,
    });
    throw new Error("course_subscription invoice is missing required metadata.");
  }

  const courseRef = db.collection("courses").doc(courseId);
  const [courseSnapshot, ownerSnapshot] = await Promise.all([
    courseRef.get(),
    db.collection("users").doc(teacherId).get(),
  ]);

  if (!courseSnapshot.exists) {
    throw new Error(`Course ${courseId} not found for subscription invoice.`);
  }

  const course = courseSnapshot.data() as TeacherCourseRecord;
  const owner = ownerSnapshot.exists
    ? (ownerSnapshot.data() as UserProfileRecord)
    : null;

  // Recompute the platform fee from the teacher's CURRENT plan at each invoice
  // so a teacher who upgrades (e.g. to Plus = 0%) gets the new rate on future
  // renewals. Falls back to the subscribe-time snapshot, then 8%.
  const platformFeeBps = owner
    ? canonicalPlatformFeeBpsForPlan(owner.currentPlanId)
    : Number(meta.platformFeeBps ?? DEFAULT_PLATFORM_FEE_BPS) || DEFAULT_PLATFORM_FEE_BPS;
  const connectedAccountId =
    (typeof meta.connectedAccountId === "string" && meta.connectedAccountId) ||
    course.stripeConnectedAccountId ||
    owner?.stripeConnectedAccountId ||
    null;

  // Mirror the one-time path: the payout clearance window is platform-config'd
  // (7/10/15/30, default 30), read outside the transaction with a safe default.
  let payoutDelayDays: number = payoutReleaseDelayDays;
  try {
    const paymentsConfigSnapshot = await db
      .collection("platformConfig")
      .doc("payments")
      .get();
    payoutDelayDays = resolvePayoutReleaseDelayDays(
      paymentsConfigSnapshot.data()?.payoutReleaseDelayDays,
    );
  } catch (error) {
    logger.warn("Could not read payout delay config; using default", {
      invoiceId: invoice.id,
      defaultDays: payoutReleaseDelayDays,
      error: error instanceof Error ? error.message : "unknown",
    });
  }

  const grossAmountMinor = Number(invoice.amount_paid || 0);
  const currencyUpper = String(
    invoice.currency || defaultSkillsetCurrency,
  ).toUpperCase();
  const skillsetFeeMinor = Math.floor((grossAmountMinor * platformFeeBps) / 10000);
  const stripeFeeMinor =
    grossAmountMinor > 0
      ? canonicalStripeProcessingFeeMinor(grossAmountMinor, currencyUpper)
      : 0;
  const netAmountMinor = Math.max(
    0,
    grossAmountMinor - skillsetFeeMinor - stripeFeeMinor,
  );

  // Resolve the REAL PaymentIntent so the payout ledger's paymentId is the join
  // key the refund path searches by (charge.payment_intent). Basil/Clover
  // (the pinned 2026-02-25.clover API) dropped the top-level
  // invoice.payment_intent, so read the inline payments list first. If the
  // webhook payload did not inline it, retrieve once with expansion. Falling
  // back to invoice.id (the prior behavior) stored a NON-PaymentIntent key the
  // subscription refund clawback can never match — stranding the teacher payout
  // clawback on every dashboard-refunded subscription invoice (Gap 2, caught by
  // adversarial review). Last-resort invoice.id is logged so a degraded key is
  // never silent.
  let resolvedPaymentIntentId = resolveInvoicePaymentIntentId(invoice);
  if (!resolvedPaymentIntentId) {
    // invoice.payments is an expandable sub-resource that Stripe does NOT
    // serialize into webhook event payloads, so on a normal invoice.paid the
    // inline read above returns null and THIS retrieve is the de-facto PRIMARY
    // PaymentIntent-resolution path. A transient retrieve failure must therefore
    // THROW (not be swallowed) WHEN a ledger keyed on this PaymentIntent is about
    // to be written: a swallowed failure would fall through to invoice.id, the
    // handler would return 2xx, the two-phase idempotency marker would promote to
    // "done", Stripe would never redeliver, and the subscription refund clawback
    // (which joins on charge.payment_intent) could never match — a permanent
    // teacher-payout money leak (round-2 adversarial review). Throwing instead
    // leaves the marker "processing" so Stripe redelivers and the ledger is
    // written with the correct join key on retry. Mirrors the safe sibling
    // stripe.subscriptions.retrieve above, which is likewise unwrapped.
    // When NO ledger will be written (gross 0 / no connected account) a degraded
    // key strands no clawback, so a blip there must not block the enrollment and
    // subscription side effects — log and proceed in that case only.
    const ledgerWillBeWritten = grossAmountMinor > 0 && Boolean(connectedAccountId);
    try {
      const expandedInvoice = await getStripeClient().invoices.retrieve(
        invoice.id,
        { expand: ["payments"] },
      );
      resolvedPaymentIntentId = resolveInvoicePaymentIntentId(expandedInvoice);
    } catch (error) {
      if (ledgerWillBeWritten) {
        logger.error(
          "Could not resolve invoice PaymentIntent for a payout-bearing invoice; " +
            "throwing to force Stripe redelivery instead of writing a degraded " +
            "ledger join key the subscription refund clawback can never match",
          {
            invoiceId: invoice.id,
            error: error instanceof Error ? error.message : "unknown",
          },
        );
        throw error;
      }
      logger.warn("Could not expand invoice payments to resolve PaymentIntent", {
        invoiceId: invoice.id,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }
  if (!resolvedPaymentIntentId) {
    // Retrieve SUCCEEDED but the invoice genuinely exposes no PaymentIntent
    // ($0/fully-discounted or paid out of credit balance — neither produces a
    // refundable charge, so the clawback has nothing to join to anyway). Safe to
    // proceed with the invoice id; logged so a degraded key is never silent.
    logger.warn(
      "Invoice PaymentIntent unresolved; payout ledger paymentId degraded to " +
        "invoice id (no refundable charge expected for this invoice)",
      { invoiceId: invoice.id },
    );
  }
  const paymentId = resolvedPaymentIntentId ?? invoice.id;

  const item = subscription.items.data[0];
  const periodEndIso = secondsToIso(
    (item as { current_period_end?: number })?.current_period_end ??
      (subscription as { current_period_end?: number }).current_period_end,
  );
  const stripeCustomerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer?.id ?? null;

  const enrollmentRef = db.collection("enrollments").doc(`${userId}__${courseId}`);
  // One held ledger entry per invoice (doc id = invoice id) — naturally
  // idempotent against event retries.
  const ledgerRef = db.collection("payoutLedger").doc(invoice.id);
  const subRef = db.collection("courseSubscriptions").doc(subscriptionId);

  await db.runTransaction(async (transaction) => {
    const [ledgerSnapshot, enrollmentSnapshot, subSnapshot] = await Promise.all([
      transaction.get(ledgerRef),
      transaction.get(enrollmentRef),
      transaction.get(subRef),
    ]);

    // Hold this invoice's net for the teacher. Skip if it already exists (retry
    // after a partial failure — the cron may already be acting on it) or the
    // invoice was fully discounted (gross 0) or the teacher account is missing.
    if (!ledgerSnapshot.exists && grossAmountMinor > 0 && connectedAccountId) {
      transaction.set(
        ledgerRef,
        {
          id: ledgerRef.id,
          teacherId,
          teacherStripeConnectedAccountId: connectedAccountId,
          courseId,
          orderId: invoice.id,
          invoiceId: invoice.id,
          subscriptionId,
          paymentId,
          // Audit flag: is paymentId a real PaymentIntent (clawback-joinable) or
          // the charge-less invoice-id fallback? Makes the "no PI ⇒ no refundable
          // charge" invariant queryable rather than assumed (round-3 review).
          paymentIdIsPaymentIntent: Boolean(resolvedPaymentIntentId),
          kind: "course_subscription",
          grossAmountMinor,
          skillsetFeeMinor,
          stripeFeeMinor,
          netAmountMinor,
          currency: currencyUpper,
          platformFeeBps,
          status: "in_release",
          releaseAt: getPayoutReleaseAt(payoutDelayDays),
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }

    // Grant on first paid invoice; re-activate on renewal after a lapse. Never
    // downgrade an already active/completed enrollment.
    const enrollmentStatus = String(enrollmentSnapshot.data()?.status ?? "");
    if (!enrollmentSnapshot.exists) {
      transaction.set(enrollmentRef, {
        id: enrollmentRef.id,
        userId,
        courseId,
        courseSlug: courseId,
        courseTitle: course.title,
        courseCategory: course.category,
        courseImage: course.coverImageUrl || "/brand/logo-mark.png",
        status: "active",
        source: "subscription",
        subscriptionId,
        progressPercent: 0,
        lastLessonId: null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else if (!["active", "completed"].includes(enrollmentStatus)) {
      transaction.update(enrollmentRef, {
        status: "active",
        source: "subscription",
        subscriptionId,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    // Mirror the subscription for the learner's cancel UI + lifecycle handler.
    transaction.set(
      subRef,
      {
        id: subscriptionId,
        userId,
        courseId,
        teacherId,
        stripeSubscriptionId: subscriptionId,
        stripeCustomerId,
        status: subscription.status,
        interval: courseSubscriptionInterval(course.paymentType),
        currentPeriodEnd: periodEndIso,
        cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
        latestInvoiceId: invoice.id,
        ...(subSnapshot.exists
          ? {}
          : { createdAt: FieldValue.serverTimestamp() }),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  });

  logger.info("Course subscription invoice fulfilled", {
    invoiceId: invoice.id,
    subscriptionId,
    courseId,
    userId,
    netAmountMinor,
  });
}

// Course-subscription lifecycle: keeps the enrollment + mirror in sync with the
// Stripe subscription status. Grace on past_due (Stripe is retrying — access
// stays); revoke on canceled/unpaid/incomplete_expired/paused; restore on a
// recovery back to active/trialing. Returns true when the subscription is a
// course subscription (so the caller skips the plan handler), false otherwise.
async function handleCourseSubscriptionLifecycle(
  subscription: Stripe.Subscription,
): Promise<boolean> {
  const meta = subscription.metadata ?? {};
  if (meta.purpose !== "course_subscription") {
    return false;
  }

  const courseId = typeof meta.courseId === "string" ? meta.courseId : null;
  const userId = typeof meta.userId === "string" ? meta.userId : null;
  const teacherId = typeof meta.teacherId === "string" ? meta.teacherId : null;

  if (!courseId || !userId) {
    logger.error("course_subscription lifecycle missing metadata", {
      subscriptionId: subscription.id,
    });
    return true; // it IS ours; swallow so the plan handler isn't called
  }

  const status = subscription.status;
  const entitled = status === "active" || status === "trialing";
  const revoke =
    status === "canceled" ||
    status === "unpaid" ||
    status === "incomplete_expired" ||
    status === "paused";
  // past_due = grace (keep current access); incomplete = not yet paid (no
  // access was granted to lose) — both leave the enrollment untouched.

  const item = subscription.items.data[0];
  const interval = item?.price?.recurring?.interval ?? null;
  const periodEndIso = secondsToIso(
    (item as { current_period_end?: number })?.current_period_end ??
      (subscription as { current_period_end?: number }).current_period_end,
  );
  const stripeCustomerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer?.id ?? null;

  const enrollmentRef = db.collection("enrollments").doc(`${userId}__${courseId}`);
  const subRef = db.collection("courseSubscriptions").doc(subscription.id);

  await db.runTransaction(async (transaction) => {
    const [enrollmentSnapshot, subSnapshot] = await Promise.all([
      transaction.get(enrollmentRef),
      transaction.get(subRef),
    ]);

    transaction.set(
      subRef,
      {
        id: subscription.id,
        userId,
        courseId,
        ...(teacherId ? { teacherId } : {}),
        stripeSubscriptionId: subscription.id,
        stripeCustomerId,
        status,
        interval,
        currentPeriodEnd: periodEndIso,
        cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
        pastDue: status === "past_due" || status === "unpaid",
        ...(subSnapshot.exists
          ? {}
          : { createdAt: FieldValue.serverTimestamp() }),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    if (!enrollmentSnapshot.exists) {
      // No enrollment yet — invoice.paid creates it on first payment (it has
      // the course title/category). The lifecycle handler never creates.
      return;
    }

    const enrollmentStatus = String(enrollmentSnapshot.data()?.status ?? "");

    if (revoke && enrollmentStatus === "active") {
      transaction.update(enrollmentRef, {
        status: "revoked",
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else if (entitled && enrollmentStatus === "revoked") {
      // Recovered (past_due -> active, or re-subscribe) — restore access.
      transaction.update(enrollmentRef, {
        status: "active",
        source: "subscription",
        subscriptionId: subscription.id,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    // past_due / incomplete: leave the enrollment as-is (grace).
  });

  logger.info("Course subscription lifecycle synced", {
    subscriptionId: subscription.id,
    status,
    courseId,
    userId,
  });

  return true;
}

type RefundReversalOutcome = {
  reversalId: string | null;
  reversalAmountMinor: number;
};

/**
 * Claws back a released teacher transfer for a refunded charge with two-phase,
 * LEDGER-level idempotency (see the claim section in payment-rules.ts).
 *
 * Why the event-level webhook claim is not enough: charge.refunded carries the
 * CUMULATIVE amount_refunded, and two DISTINCT refund events (two partial
 * refunds issued seconds apart) are different Stripe event ids — both pass the
 * event claim. If both read transferReversedAmountMinor before either commits,
 * both plan against the same stale baseline and the teacher is over-reversed.
 *
 * Phase 1 (transaction): re-read the ledger FRESH, sum the other "pending"
 * claims as reserved, decide the incremental amount via
 * decideRefundReversalClaim, and reserve it under
 * refundReversalClaims[{chargeId}_{cumulativeAmount}] BEFORE any Stripe call.
 *
 * Stripe call: reverses EXACTLY the planned amount (fixedReversalAmountMinor)
 * under the historical idempotency key format
 * transfer_reversal_{ledgerId}_{chargeId}_{amount_refunded} — a crash between
 * phases replays (not repeats) the reversal on webhook redelivery, because the
 * pending claim re-executes the same amount under the same key.
 *
 * Phase 2 (transaction): promote the claim to "done" and fold the executed
 * amount into transferReversedAmountMinor exactly once (skipped if a
 * concurrent retry already promoted it). One-off orders also mirror the
 * reversal fields onto the order doc via mirrorRef (kept for data-contract
 * continuity with the pre-claim implementation).
 */
async function reverseReleasedTransferForRefund(input: {
  ledgerRef: DocumentReference;
  /** Value used in the Stripe idempotency key: orderId for one-off purchases,
   * ledger.id (invoice id) for subscription payouts. MUST NOT change format —
   * historical reversals were issued under these keys. */
  ledgerId: string;
  charge: Stripe.Charge;
  /** One-off path: order.amountMinor backs gross for pre-ledger records. */
  fallbackGrossAmountMinor?: number;
  metadata: Record<string, string>;
  /** One-off path: order doc that mirrors the reversal fields. */
  mirrorRef?: DocumentReference | null;
}): Promise<RefundReversalOutcome> {
  const { ledgerRef, ledgerId, charge, metadata } = input;
  const refundedAmountMinor = Math.max(0, Number(charge.amount_refunded || 0));
  const claimKey = refundReversalClaimKey(charge.id, refundedAmountMinor);

  // Phase 1 — decide + reserve against the transactionally-fresh ledger.
  const decision = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ledgerRef);

    if (!snapshot.exists) {
      return {
        action: "skip" as const,
        plannedAmountMinor: 0,
        transferId: null as string | null,
      };
    }

    const ledger = snapshot.data() as PayoutLedgerRecord;
    const transferId = ledger.transferId || null;
    const claims = ledger.refundReversalClaims ?? {};
    const existingClaim = claims[claimKey] ?? null;
    let otherPendingReservedMinor = 0;

    for (const [key, claim] of Object.entries(claims)) {
      if (key !== claimKey && claim?.state === "pending") {
        otherPendingReservedMinor += Math.max(
          0,
          Number(claim.plannedAmountMinor || 0),
        );
      }
    }

    // What truly left the platform (reduced when a partial refund preceded
    // release), falling back to net for ledgers released before tracking.
    const releasedTransferAmountMinor = Number(
      ledger.transferAmountMinor ?? ledger.netAmountMinor ?? 0,
    );
    const claimDecision = decideRefundReversalClaim({
      existingClaim,
      otherPendingReservedMinor,
      shouldReverse: shouldReverseReleasedPayout({
        status: ledger.status,
        transferId,
        releasedTransferAmountMinor,
      }),
      grossAmountMinor: Number(
        ledger.grossAmountMinor || input.fallbackGrossAmountMinor || 0,
      ),
      refundedAmountMinor,
      releasedTransferAmountMinor,
      netAmountMinor: Number(ledger.netAmountMinor || 0),
      alreadyReversedAmountMinor: Number(ledger.transferReversedAmountMinor || 0),
    });

    if (
      claimDecision.action === "execute" &&
      claimDecision.plannedAmountMinor > 0 &&
      transferId &&
      existingClaim?.state !== "pending"
    ) {
      // Reserve before the Stripe call. Nested-map merge writes only this key.
      transaction.set(
        ledgerRef,
        {
          refundReversalClaims: {
            [claimKey]: {
              state: "pending",
              plannedAmountMinor: claimDecision.plannedAmountMinor,
            },
          },
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }

    return { ...claimDecision, transferId };
  });

  if (
    decision.action !== "execute" ||
    decision.plannedAmountMinor <= 0 ||
    !decision.transferId
  ) {
    return { reversalId: null, reversalAmountMinor: 0 };
  }

  // If this throws, the claim stays "pending", the webhook fails and Stripe
  // redelivers; Phase 1 then re-executes the SAME amount under the SAME key.
  const reversalResult = await createReleasedRefundTransferReversal({
    stripe: getStripeClient() as unknown as TransferReversalStripeClient,
    ledgerId,
    transferId: decision.transferId,
    grossAmountMinor: 0,
    refundedAmountMinor,
    releasedTransferAmountMinor: 0,
    fixedReversalAmountMinor: decision.plannedAmountMinor,
    idempotencyKey:
      `transfer_reversal_${ledgerId}_${charge.id}_${charge.amount_refunded}`,
    metadata,
  });

  if (reversalResult.reversalAmountMinor <= 0) {
    return reversalResult;
  }

  // Phase 2 — promote the claim and fold the executed amount in exactly once.
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ledgerRef);
    const ledger = snapshot.exists
      ? (snapshot.data() as PayoutLedgerRecord)
      : null;
    const claim = ledger?.refundReversalClaims?.[claimKey];

    if (claim?.state === "done") {
      // A concurrent retry already accounted for this delivery.
      return;
    }

    const reversalWriteFields = {
      transferReversedAmountMinor:
        FieldValue.increment(reversalResult.reversalAmountMinor),
      latestTransferReversalId: reversalResult.reversalId,
      latestTransferReversalAt: FieldValue.serverTimestamp(),
    };

    transaction.set(
      ledgerRef,
      {
        ...reversalWriteFields,
        refundReversalClaims: {
          [claimKey]: {
            state: "done",
            plannedAmountMinor: reversalResult.reversalAmountMinor,
          },
        },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    if (input.mirrorRef) {
      transaction.set(
        input.mirrorRef,
        {
          ...reversalWriteFields,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }
  });

  return reversalResult;
}

/**
 * Refund path for course-SUBSCRIPTION charges (no payments/{PI} doc exists).
 *
 * Locates the held/released subscription payout by its PaymentIntent and claws
 * back the teacher's released transfer, writing ONLY the payout ledger. It does
 * NOT touch the enrollment: a dashboard refund of a single subscription invoice
 * does not cancel the subscription, so access stays governed by the
 * subscription lifecycle (customer.subscription.updated/deleted). Returns true
 * when a matching subscription payout was found and handled, false otherwise so
 * the caller can log the original "payment not found". (Gap 2)
 */
async function handleSubscriptionChargeRefunded(
  charge: Stripe.Charge,
  paymentIntentId: string,
): Promise<boolean> {
  // A single equality filter on paymentId needs only the default single-field
  // index (no composite index to deploy); narrow to course subscriptions in
  // code. One-off purchases never reach here (they have a payments/{PI} doc), so
  // the kind filter is belt-and-suspenders against acting on a one-off ledger.
  const ledgerQuery = await db
    .collection("payoutLedger")
    .where("paymentId", "==", paymentIntentId)
    .limit(5)
    .get();
  const ledgerDoc = ledgerQuery.docs.find(
    (doc) =>
      (doc.data() as PayoutLedgerRecord).kind === "course_subscription",
  );

  if (!ledgerDoc) {
    return false;
  }

  const ledgerRef = ledgerDoc.ref;
  const ledger = ledgerDoc.data() as PayoutLedgerRecord;
  // Two-phase claim: decides the incremental amount against the FRESH ledger,
  // reserves it, executes the Stripe reversal, and folds the result into
  // transferReversedAmountMinor exactly once. Replaces the old stale-read flow
  // that could over-reverse on concurrent partial-refund deliveries.
  const reversalResult = await reverseReleasedTransferForRefund({
    ledgerRef,
    ledgerId: ledger.id,
    charge,
    metadata: {
      invoiceId: String(ledger.invoiceId ?? ledger.id),
      paymentId: paymentIntentId,
      chargeId: charge.id,
      kind: "course_subscription",
    },
  });
  const isFullRefund = charge.refunded === true;

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ledgerRef);
    const currentStatus = snapshot.exists
      ? String((snapshot.data() as PayoutLedgerRecord).status || "")
      : "";
    transaction.set(
      ledgerRef,
      {
        status: ledgerRefundStatus(isFullRefund, currentStatus),
        refundedAmountMinor: charge.amount_refunded,
        refundedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  });

  await recordAuditEvent({
    action: AUDIT_ACTIONS.REFUND_ISSUED,
    actorId: "system:stripe-webhook",
    actorEmail: null,
    targetType: "payoutLedger",
    targetId: ledger.id,
    summary: `Subscription refund ${isFullRefund ? "completed" : "partially completed"} for invoice ${ledger.invoiceId ?? ledger.id}`,
    metadata: {
      paymentId: paymentIntentId,
      chargeId: charge.id,
      subscriptionId:
        typeof ledger.subscriptionId === "string" ? ledger.subscriptionId : null,
      courseId: typeof ledger.courseId === "string" ? ledger.courseId : null,
      refundedAmountMinor: charge.amount_refunded,
      fullRefund: isFullRefund,
      transferReversalAmountMinor: reversalResult.reversalAmountMinor,
      kind: "course_subscription",
    },
  });

  logger.info("Subscription charge refund handled", {
    ledgerId: ledger.id,
    paymentId: paymentIntentId,
    reversalAmountMinor: reversalResult.reversalAmountMinor,
  });

  return true;
}

async function handleChargeRefunded(charge: Stripe.Charge) {
  const paymentIntentId =
    typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : charge.payment_intent?.id;

  if (!paymentIntentId) {
    logger.warn("Refunded charge has no payment intent", { chargeId: charge.id });
    return;
  }

  const paymentRef = db.collection("payments").doc(paymentIntentId);
  const paymentSnapshot = await paymentRef.get();

  if (!paymentSnapshot.exists) {
    // One-off purchases write a payments/{PI} doc; course subscriptions do not.
    // A subscription invoice charge refunded straight from the Stripe Dashboard
    // therefore lands here with no payment doc. Fall back to the subscription
    // payout ledger (keyed by invoice id, paymentId == PI) so the teacher's
    // released transfer is still clawed back — otherwise the platform refunds
    // the student but never recovers the teacher payout. (Gap 2)
    const handledAsSubscription = await handleSubscriptionChargeRefunded(
      charge,
      paymentIntentId,
    );
    if (!handledAsSubscription) {
      logger.warn("Refunded payment was not found", { paymentIntentId });
    }
    return;
  }

  const payment = paymentSnapshot.data() || {};
  const orderId = String(payment.orderId || "");

  if (!orderId) {
    throw new Error(`Payment ${paymentIntentId} is missing orderId.`);
  }

  const orderRef = db.collection("orders").doc(orderId);
  const ledgerRef = db.collection("payoutLedger").doc(orderId);
  const orderSnapshot = await orderRef.get();

  if (!orderSnapshot.exists) {
    throw new Error(`Order ${orderId} not found for refunded payment.`);
  }

  const order = orderSnapshot.data() || {};
  // Two-phase claim: decides the incremental amount against the FRESH ledger,
  // reserves it, executes the Stripe reversal, and folds the result into
  // transferReversedAmountMinor (mirrored onto the order doc) exactly once.
  // Replaces the old stale-read flow that could over-reverse on concurrent
  // partial-refund deliveries (the helper re-reads the ledger transactionally).
  const reversalResult = await reverseReleasedTransferForRefund({
    ledgerRef,
    ledgerId: orderId,
    charge,
    fallbackGrossAmountMinor: Number(order.amountMinor || 0),
    metadata: {
      orderId,
      paymentId: paymentIntentId,
      chargeId: charge.id,
    },
    mirrorRef: orderRef,
  });

  await db.runTransaction(async (transaction) => {
    const currentOrderSnapshot = await transaction.get(orderRef);

    if (!currentOrderSnapshot.exists) {
      throw new Error(`Order ${orderId} not found for refunded payment.`);
    }

    const currentOrder = currentOrderSnapshot.data() || {};
    const isFullRefund = charge.refunded === true;
    const refundedStatus = isFullRefund ? "refunded" : "partially_refunded";
    // Re-read the ledger transactionally to decide its status atomically. A
    // partial refund that arrives while the payout is still queued (in_release,
    // not yet claimed by the release cron) must keep the ledger in_release so
    // the cron still releases the REDUCED transfer (the frozen
    // plannedTransferAmountMinor reads this refundedAmountMinor) instead of
    // stranding the teacher's payout forever. Basing this on the FRESH status
    // (not the stale pre-transaction snapshot) is what prevents a refund that
    // races with the cron from flipping an already-`released` ledger back to
    // `in_release` — which would re-release and double-pay. Full refunds, and
    // refunds after the payout already left (`releasing`/`released`), stay on
    // the terminal refunded/partially_refunded path exactly as before. (Gap 1)
    const currentLedgerSnapshot = await transaction.get(ledgerRef);
    const currentLedgerStatus = currentLedgerSnapshot.exists
      ? String((currentLedgerSnapshot.data() as PayoutLedgerRecord).status || "")
      : "";
    const nextLedgerStatus = ledgerRefundStatus(isFullRefund, currentLedgerStatus);
    const enrollmentRef =
      isFullRefund && currentOrder.userId && currentOrder.courseId
        ? db
            .collection("enrollments")
            .doc(`${currentOrder.userId}__${currentOrder.courseId}`)
        : null;
    const enrollmentSnapshot = enrollmentRef
      ? await transaction.get(enrollmentRef)
      : null;

    transaction.update(paymentRef, {
      status: refundedStatus,
      refundedAmountMinor: charge.amount_refunded,
      refundedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    transaction.update(orderRef, {
      status: refundedStatus,
      refundedAmountMinor: charge.amount_refunded,
      updatedAt: FieldValue.serverTimestamp(),
    });

    transaction.set(
      ledgerRef,
      {
        status: nextLedgerStatus,
        refundedAmountMinor: charge.amount_refunded,
        refundedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    if (enrollmentRef && enrollmentSnapshot?.exists) {
      transaction.update(enrollmentRef, {
        status: "refunded",
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  });

  // Authoritative audit point: the money actually moved back to the buyer.
  // requestRefund/issueAdminRefund only log the REQUEST; Stripe confirming the
  // refund via this webhook is what we record as REFUND_ISSUED.
  await recordAuditEvent({
    action: AUDIT_ACTIONS.REFUND_ISSUED,
    actorId: "system:stripe-webhook",
    actorEmail: null,
    targetType: "order",
    targetId: orderId,
    summary: `Refund ${charge.refunded ? "completed" : "partially completed"} for order ${orderId}`,
    metadata: {
      paymentId: paymentIntentId,
      chargeId: charge.id,
      courseId: typeof order.courseId === "string" ? order.courseId : null,
      userId: typeof order.userId === "string" ? order.userId : null,
      refundedAmountMinor: charge.amount_refunded,
      fullRefund: charge.refunded === true,
      transferReversalAmountMinor: reversalResult.reversalAmountMinor,
    },
  });
}

async function markOrderStatus(
  orderId: string | null | undefined,
  status: "failed" | "cancelled",
) {
  if (!orderId) {
    return;
  }

  const orderRef = db.collection("orders").doc(orderId);

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(orderRef);

    if (!snapshot.exists) {
      // No order doc yet (pathological — orders are created before checkout).
      // Preserve the prior set-merge so the terminal status still lands.
      transaction.set(
        orderRef,
        { status, updatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      );
      return;
    }

    const order = snapshot.data() || {};
    const currentStatus = String(order.status || "");

    // The checkout is now terminal (expired/failed): release the in-flight
    // checkout lock so a fresh attempt isn't blocked — but ONLY if the lock
    // still belongs to THIS order. The lock is keyed by buyer+course, yet a
    // buyer accrues many attempts over time sharing one lock doc; a late event
    // for an OLD attempt must not drop a LIVE re-purchase's lock (which would
    // re-open the double-charge window). Read it in-txn (a transaction requires
    // all reads before any write) and delete only on an orderId match. [B3]
    const lockUserId = typeof order.userId === "string" ? order.userId : null;
    const lockCourseId =
      typeof order.courseId === "string" ? order.courseId : null;
    const checkoutLockRef =
      lockUserId && lockCourseId
        ? db.collection("checkoutLocks").doc(`${lockUserId}__${lockCourseId}`)
        : null;
    const lockSnapshot = checkoutLockRef
      ? await transaction.get(checkoutLockRef)
      : null;
    const releaseLock =
      Boolean(lockSnapshot?.exists) &&
      shouldReleaseCheckoutLock(lockSnapshot?.data()?.orderId, orderId);

    if (checkoutLockRef && releaseLock) {
      transaction.delete(checkoutLockRef);
    }

    if (!shouldApplyOrderStatusTransition(currentStatus)) {
      // Stripe does not guarantee event ordering: a late expired/failed event
      // for an earlier attempt can arrive AFTER checkout.session.completed
      // marked the order paid. Overwriting it would revoke a real purchase. [B2]
      logger.info("Ignoring out-of-order order status transition", {
        orderId,
        attempted: status,
        current: currentStatus,
      });
      return;
    }

    transaction.update(orderRef, {
      status,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}

/* ---------------------------------------------------------------------- *
 *  Subscription billing (Plans: Free / Starter / Pro / Plus)
 *
 *  Canonical plan + price-id catalog: src/data/plans.ts (frontend).
 *  This file mirrors the Price-ID → Plan map used by the webhook so the
 *  function runtime can resolve a subscription back to a Skillset plan
 *  without importing the Next package.
 *
 *  When the user populates real Stripe Price IDs in src/data/plans.ts,
 *  update PLAN_PRICE_MAP below to match (same string values). Mismatch
 *  is caught at runtime and logged — no silent fallback to a wrong plan.
 * ---------------------------------------------------------------------- */

type SubscriptionPlanId = "starter" | "pro" | "plus";
type SubscriptionBillingCycle = "monthly" | "yearly";

const STRIPE_PRICE_PLACEHOLDER_PREFIX = "price_PLACEHOLDER_";

const PLAN_PRICE_MAP: Record<
  SubscriptionPlanId,
  Record<SubscriptionBillingCycle, string>
> = {
  starter: {
    monthly: "price_1TZFTmPvg1vJW0IjLAYWqZok",
    yearly: "price_1TZFTnPvg1vJW0IjjaQXBpDW",
  },
  pro: {
    monthly: "price_1TZFTnPvg1vJW0IjHYe4yW9V",
    yearly: "price_1TZFToPvg1vJW0IjDHGPIzH0",
  },
  plus: {
    monthly: "price_1TZFToPvg1vJW0Ijf35SQQzt",
    yearly: "price_1TZFTpPvg1vJW0IjgE9PQ5To",
  },
};

function isPlaceholderPriceId(id: string): boolean {
  return id.startsWith(STRIPE_PRICE_PLACEHOLDER_PREFIX);
}

function resolvePriceId(
  planId: SubscriptionPlanId,
  cycle: SubscriptionBillingCycle,
): string {
  const id = PLAN_PRICE_MAP[planId]?.[cycle];
  if (!id) {
    throw new HttpsError(
      "failed-precondition",
      `No Stripe Price configured for plan ${planId} (${cycle}).`,
    );
  }
  if (isPlaceholderPriceId(id)) {
    throw new HttpsError(
      "failed-precondition",
      `Stripe Price ID for ${planId} (${cycle}) is still a placeholder. ` +
        `Create the Price in the Stripe Dashboard and update ` +
        `PLAN_PRICE_MAP in functions/src/index.ts + plans.ts.`,
    );
  }
  return id;
}

function planByPriceId(priceId: string): SubscriptionPlanId | null {
  for (const planId of Object.keys(PLAN_PRICE_MAP) as SubscriptionPlanId[]) {
    const cycles = PLAN_PRICE_MAP[planId];
    if (cycles.monthly === priceId || cycles.yearly === priceId) {
      return planId;
    }
  }
  return null;
}

function cycleByPriceId(
  priceId: string,
): SubscriptionBillingCycle | null {
  for (const planId of Object.keys(PLAN_PRICE_MAP) as SubscriptionPlanId[]) {
    const cycles = PLAN_PRICE_MAP[planId];
    if (cycles.monthly === priceId) return "monthly";
    if (cycles.yearly === priceId) return "yearly";
  }
  return null;
}

/**
 * Returns the user's Stripe Customer ID, creating one on first use and
 * persisting it in the user profile so future sessions reuse it. Without
 * a stable customer record, every checkout would create a duplicate
 * customer in Stripe.
 */
async function getOrCreateBillingStripeCustomer(
  uid: string,
  emailFromAuth?: string | null,
): Promise<string> {
  const userRef = db.collection("users").doc(uid);
  const snapshot = await userRef.get();
  const profile = (snapshot.data() ?? {}) as UserProfileRecord & {
    stripeCustomerId?: string | null;
  };

  if (profile.stripeCustomerId) {
    return profile.stripeCustomerId;
  }

  const customer = await getStripeClient().customers.create({
    email: profile.email ?? emailFromAuth ?? undefined,
    name: profile.displayName ?? undefined,
    metadata: { uid },
  });

  await userRef.set(
    {
      stripeCustomerId: customer.id,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return customer.id;
}

export const createBillingCheckoutSession = onCall(
  { secrets: [stripeSecretKey] },
  async (request: CallableRequest<{
    planId?: string;
    cycle?: string;
  }>) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in before upgrading.");
    }

    const uid = request.auth.uid;
    await enforceRateLimit(`billing_checkout_${uid}`, 10, 60 * 60 * 1000);

    const rawPlanId = request.data.planId;
    const rawCycle = request.data.cycle;

    if (rawPlanId !== "starter" && rawPlanId !== "pro" && rawPlanId !== "plus") {
      throw new HttpsError(
        "invalid-argument",
        "planId must be one of: starter, pro, plus.",
      );
    }
    if (rawCycle !== "monthly" && rawCycle !== "yearly") {
      throw new HttpsError(
        "invalid-argument",
        "cycle must be 'monthly' or 'yearly'.",
      );
    }

    const planId = rawPlanId as SubscriptionPlanId;
    const cycle = rawCycle as SubscriptionBillingCycle;
    const priceId = resolvePriceId(planId, cycle);

    const customerId = await getOrCreateBillingStripeCustomer(
      uid,
      request.auth.token.email ?? null,
    );

    const appUrl = getAppUrl();

    const session = await getStripeClient().checkout.sessions.create(
      {
        mode: "subscription",
        ui_mode: "embedded",
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        subscription_data: {
          metadata: {
            uid,
            planId,
            cycle,
          },
        },
        metadata: {
          uid,
          planId,
          cycle,
          purpose: "skillset_plan_subscription",
        },
        return_url: `${appUrl}/account/billing/return?session_id={CHECKOUT_SESSION_ID}`,
      },
      {
        // Idempotency on (uid, plan, cycle) so a double-click doesn't
        // create two parallel sessions in the same minute. Window changes
        // when the user picks a different plan or cycle.
        idempotencyKey: `billing_checkout_${uid}_${planId}_${cycle}_${Math.floor(
          Date.now() / 60000,
        )}`,
      },
    );

    if (!session.client_secret) {
      throw new HttpsError(
        "internal",
        "Stripe did not return a client_secret for the embedded session.",
      );
    }

    return {
      clientSecret: session.client_secret,
      sessionId: session.id,
    };
  },
);

export const createBillingPortalSession = onCall(
  { secrets: [stripeSecretKey] },
  async (request: CallableRequest<Record<string, never>>) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in before opening billing.");
    }

    const uid = request.auth.uid;
    await enforceRateLimit(`billing_portal_${uid}`, 20, 60 * 60 * 1000);

    const userSnapshot = await db.collection("users").doc(uid).get();
    const profile = (userSnapshot.data() ?? {}) as UserProfileRecord & {
      stripeCustomerId?: string | null;
    };

    if (!profile.stripeCustomerId) {
      throw new HttpsError(
        "failed-precondition",
        "No active subscription found for this account.",
      );
    }

    const appUrl = getAppUrl();
    const portal = await getStripeClient().billingPortal.sessions.create({
      customer: profile.stripeCustomerId,
      return_url: `${appUrl}/account/billing?tab=subscriptions`,
    });

    return { url: portal.url };
  },
);

// Learner-facing course-subscription management. Cancels at period end (the
// learner keeps access through the period they already paid for — the market
// norm) or resumes a pending cancellation. The subscriptionId is read from the
// buyer's own enrollment doc (deterministic id, no query/index), then verified
// against the Stripe subscription metadata before any mutation.
export const cancelCourseSubscription = onCall(
  { secrets: [stripeSecretKey] },
  async (
    request: CallableRequest<{ courseId?: string; resume?: boolean }>,
  ) => {
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "Sign in to manage your subscription.",
      );
    }

    const uid = request.auth.uid;
    const courseId = String(request.data?.courseId || "").trim();
    if (!courseId || courseId.length > 160) {
      throw new HttpsError("invalid-argument", "A valid courseId is required.");
    }
    const resume = request.data?.resume === true;

    await enforceRateLimit(`course_sub_cancel_${uid}`, 20, 60 * 60 * 1000);

    const enrollmentSnapshot = await db
      .collection("enrollments")
      .doc(`${uid}__${courseId}`)
      .get();
    const subscriptionId = enrollmentSnapshot.data()?.subscriptionId;

    if (typeof subscriptionId !== "string" || !subscriptionId) {
      throw new HttpsError(
        "failed-precondition",
        "No course subscription is attached to your enrollment.",
      );
    }

    const stripe = getStripeClient();
    // Defensive ownership check: the subscription must be a course subscription
    // owned by this user, regardless of what the enrollment doc claims.
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    if (
      subscription.metadata?.purpose !== "course_subscription" ||
      subscription.metadata?.userId !== uid
    ) {
      throw new HttpsError(
        "permission-denied",
        "This subscription is not yours to manage.",
      );
    }

    const updated = await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: !resume,
    });

    // Reflect immediately; customer.subscription.updated re-syncs the mirror.
    await db.collection("courseSubscriptions").doc(subscriptionId).set(
      {
        cancelAtPeriodEnd: !resume,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    const item = updated.items.data[0];
    const currentPeriodEnd = secondsToIso(
      (item as { current_period_end?: number })?.current_period_end ??
        (updated as { current_period_end?: number }).current_period_end,
    );

    return {
      cancelAtPeriodEnd: !resume,
      currentPeriodEnd,
      status: updated.status,
    };
  },
);

/**
 * Mirrors the active Stripe subscription state into Firestore.
 * Source of truth lives at Stripe; this is a cache so the rest of the
 * app (commission resolution, billing UI) doesn't need to re-query
 * Stripe on every render.
 */
async function syncSubscriptionFromStripe(
  subscription: Stripe.Subscription,
): Promise<void> {
  const uid =
    (subscription.metadata?.uid as string | undefined) ??
    (await uidFromCustomer(subscription.customer));

  if (!uid) {
    logger.warn(
      "syncSubscriptionFromStripe: could not resolve uid for subscription",
      { subscriptionId: subscription.id },
    );
    return;
  }

  const item = subscription.items.data[0];
  const priceId = item?.price?.id ?? null;
  const planId = priceId ? planByPriceId(priceId) : null;
  const cycle = priceId ? cycleByPriceId(priceId) : null;

  if (!planId || !cycle || !priceId) {
    logger.warn(
      "syncSubscriptionFromStripe: unrecognized Stripe price",
      { subscriptionId: subscription.id, priceId },
    );
    return;
  }

  const subRef = db.collection("subscriptions").doc(subscription.id);

  const periodStart = secondsToIso(
    (item as { current_period_start?: number })?.current_period_start ??
      (subscription as { current_period_start?: number }).current_period_start,
  );
  const periodEnd = secondsToIso(
    (item as { current_period_end?: number })?.current_period_end ??
      (subscription as { current_period_end?: number }).current_period_end,
  );

  await subRef.set(
    {
      userId: uid,
      planId,
      cycle,
      stripeCustomerId:
        typeof subscription.customer === "string"
          ? subscription.customer
          : subscription.customer.id,
      stripeSubscriptionId: subscription.id,
      stripePriceId: priceId,
      status: subscription.status,
      // Self-healing dunning flag: true while Stripe reports the subscription
      // past_due/unpaid, cleared automatically once it recovers to active.
      pastDue:
        subscription.status === "past_due" || subscription.status === "unpaid",
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  // Reflect on the user profile so commission resolution is O(1) without
  // joining subscriptions. The user is on the plan when entitled
  // (active/trialing); otherwise revert to Free.
  const entitled =
    subscription.status === "active" || subscription.status === "trialing";

  await db.collection("users").doc(uid).set(
    {
      currentPlanId: entitled ? planId : "free",
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

/**
 * Mark a subscription past-due the moment an invoice fails, before Stripe's
 * smart retries flip the subscription status. Gives the billing panel an
 * immediate dunning signal; syncSubscriptionFromStripe clears it on recovery.
 */
async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  const subscriptionId = resolveInvoiceSubscriptionId(invoice);

  if (!subscriptionId) {
    logger.warn("invoice.payment_failed without a subscription", {
      invoiceId: invoice.id,
    });
    return;
  }

  // Course subscriptions track dunning on courseSubscriptions (not the plan
  // `subscriptions` mirror) and keep access during retries — the actual revoke
  // is driven by customer.subscription.updated -> canceled/unpaid (grace).
  try {
    const subscription = await getStripeClient().subscriptions.retrieve(
      subscriptionId,
    );
    if (subscription.metadata?.purpose === "course_subscription") {
      await db.collection("courseSubscriptions").doc(subscriptionId).set(
        {
          pastDue: true,
          lastInvoicePaymentFailedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      logger.warn("Course subscription invoice payment_failed (grace)", {
        invoiceId: invoice.id,
        subscriptionId,
      });
      return;
    }
  } catch (error) {
    logger.warn("Could not classify invoice.payment_failed subscription", {
      invoiceId: invoice.id,
      subscriptionId,
      error: error instanceof Error ? error.message : "unknown",
    });
    // fall through to plan-subscription handling
  }

  await db.collection("subscriptions").doc(subscriptionId).set(
    {
      pastDue: true,
      lastInvoicePaymentFailedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  logger.warn("Subscription invoice payment_failed", {
    invoiceId: invoice.id,
    subscriptionId,
    customerId: invoice.customer,
  });
}

async function uidFromCustomer(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer,
): Promise<string | null> {
  const customerId =
    typeof customer === "string" ? customer : customer.id;
  if (!customerId) return null;

  const found = await db
    .collection("users")
    .where("stripeCustomerId", "==", customerId)
    .limit(1)
    .get();

  return found.empty ? null : (found.docs[0].id);
}

function secondsToIso(seconds: number | null | undefined): string | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return null;
  return new Date(seconds * 1000).toISOString();
}

/* ---------------------------------------------------------------------- *
 *  Stripe Connect Embedded Components — creator onboarding stays in-app
 *
 *  Replaces createTeacherStripeAccountLink for the onboarding flow:
 *  instead of returning a Stripe-hosted URL to redirect to, this
 *  returns a Connect Account Session client_secret. The frontend mounts
 *  <ConnectAccountOnboarding> with that secret and the entire KYC /
 *  bank / identity flow renders inside Skillset — no redirect.
 *
 *  The old createTeacherStripeAccountLink stays exported as a fallback
 *  for any code path still using it (e.g. existing scripts), but new
 *  UI must call this one.
 * ---------------------------------------------------------------------- */

export const createConnectAccountSession = onCall(
  { secrets: [stripeSecretKey] },
  async (request: CallableRequest<Record<string, never>>) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in before connecting Stripe.");
    }

    const userId = request.auth.uid;
    await enforceRateLimit(
      `connect_session_${userId}`,
      30,
      60 * 60 * 1000,
    );

    const userRef = db.collection("users").doc(userId);
    const userSnapshot = await userRef.get();

    if (!userSnapshot.exists) {
      throw new HttpsError("failed-precondition", "User profile not found.");
    }

    const user = userSnapshot.data() as UserProfileRecord;
    if (!Array.isArray(user.roles) || !user.roles.includes("teacher")) {
      throw new HttpsError(
        "permission-denied",
        "Only teacher accounts can connect a payout account.",
      );
    }

    try {
      const stripe = getStripeClient();
      const email = user.email || request.auth.token.email?.toString();
      let accountId = user.stripeConnectedAccountId || null;

      if (!accountId) {
        accountId = await createFreshConnectedAccount({
          userRef,
          uid: userId,
          email,
          stripe,
        });

        await captureServerEvent(userId, SERVER_EVENTS.TEACHER_KYC_SUBMITTED, {
          teacher_id: userId,
        });
      }

      // Account Session client_secret powers the in-app embedded UI. If the
      // stored account is orphaned, self-heal mints a fresh one and retries the
      // session once; effectiveAccountId captures whichever id finally worked
      // so the response carries the correct (possibly new) account id.
      let effectiveAccountId = accountId;
      const accountSession = await runWithOrphanedAccountSelfHeal({
        accountId,
        runOp: (acct) => {
          effectiveAccountId = acct;
          return stripe.accountSessions.create({
            account: acct,
            components: {
              account_onboarding: { enabled: true },
            },
          });
        },
        recreateAccount: () =>
          createFreshConnectedAccount({ userRef, uid: userId, email, stripe }),
        onRecreate: (staleAccountId) =>
          logger.warn("Stripe connected account orphaned; recreating once", {
            userId,
            staleAccountId,
          }),
      });

      return {
        clientSecret: accountSession.client_secret,
        accountId: effectiveAccountId,
      };
    } catch (error) {
      throw toStripeHttpsError(error, "opening the Stripe onboarding session");
    }
  },
);

