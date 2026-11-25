import type { PlanId } from "@/data/plans";
import type { Role } from "@/lib/permissions";

export const userGoalOptions = [
  "career_growth",
  "skill_certification",
  "teach_online",
  "build_community",
  "live_mentorship",
  "business_training",
] as const;

export type UserGoal = (typeof userGoalOptions)[number];

export type OnboardingPath = "student" | "teacher" | "both";

export type OnboardingAnswers = {
  /** Declared country (ISO alpha-2 or "other"); it neither verifies nor enables payouts. */
  payoutCountry?: string;
  path?: OnboardingPath;
  /** Teacher-only: what they practice (coach, facilitator, mentor, ...). */
  profession?: string;
  sourceOfDiscovery?: string;
  alreadySold?: "yes" | "no";
  monthlyRevenue?: string;
  primaryGoal?: string[];
  instagramHandle?: string;
  audienceSize?: string;
  /** Name and phone have already been saved on the profile (first step of /welcome). */
  profileConfirmed?: boolean;
};

export type NotificationPreferences = {
  productEmails: boolean;
  courseActivity: boolean;
  billingAlerts: boolean;
  marketingEmails: boolean;
  /** Hourly "you have N new notifications" email (api/cron/notification-digest). */
  emailDigest: boolean;
};

export type LearningPreferences = {
  autoCaptions: boolean;
  dailyDigest: boolean;
};

export type UserPreferences = {
  notifications?: Partial<NotificationPreferences>;
  learning?: Partial<LearningPreferences>;
};

export const defaultNotificationPreferences: NotificationPreferences = {
  productEmails: true,
  courseActivity: true,
  billingAlerts: true,
  marketingEmails: false,
  emailDigest: true,
};

export const defaultLearningPreferences: LearningPreferences = {
  autoCaptions: true,
  dailyDigest: false,
};

// --- Instructor storefront (members-area branding) -------------------------
// A teacher-configurable brand layer embedded on the user row (like
// `preferences`). A safe subset is projected by the `sync_public_profile()`
// trigger into the world-readable `public_profiles` table to power the public
// instructor vitrine — so the URL fields are validated (https + length) on
// write AND re-sanitized on projection, and accentColor is constrained to a hex
// string to block CSS injection. AUGMENT, not replace: this is a VIEW over the
// teacher's existing `owner_id`-keyed courses, never a new table.
export const storefrontThemePresets = [
  "default",
  "warm",
  "cool",
  "mono",
] as const;

export type StorefrontThemePreset = (typeof storefrontThemePresets)[number];

export const maxStorefrontTaglineLength = 200;
export const maxStorefrontUrlLength = 1200;
export const maxStorefrontOrderedCourses = 200;
export const maxStorefrontSectionLabels = 20;
export const maxStorefrontSectionLabelLength = 60;

/**
 * Address of the teacher's public storefront. The path `/instructors/{uid}`
 * was written by hand on every screen that needed it; with three screens
 * pointing there (Home, Marketing and the storefront page itself), one
 * function keeps one of them from changing and leaving the others behind.
 *
 * With @username, the address is `/@username` (the Instagram bio link; the
 * next.config rewrites it to this same page). `/instructors/{uid}` keeps
 * working for people with no @ and for old links.
 */
export function instructorPagePath(uid: string, username?: string | null): string {
  return username && !isReservedHandle(username) ? `/@${username}` : `/instructors/${uid}`;
}

/**
 * @ handles that imitate the platform: `/@support` showing the profile of any
 * teacher would be an invitation to scams. The profile route answers 404 for them, and the link
 * of anyone who already has one of these falls back to the address by uid.
 */
export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  "skillsetmind", "support", "admin", "help", "ops", "api",
  "team", "official", "staff", "security", "billing",
]);

export function isReservedHandle(username: string): boolean {
  return RESERVED_HANDLES.has(username.toLowerCase());
}

/** A teacher-chosen brand accent must be a 6-digit hex so it is safe to drop
 * into a CSS custom property without style/script injection. */
export function isStorefrontHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

/** Same dark ink the members theme already pairs with its green fill. */
const accentDarkInk = "#0a0d12";

function relativeLuminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((start) => {
    const channel = parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Text colour for a teacher's accent used as a FILL (buttons, the current
 * lesson): white or dark ink, whichever has the higher WCAG contrast against
 * it. Forced white on a yellow accent read 1.6:1. Expects a value that already
 * passed `isStorefrontHexColor`.
 */
export function readableTextOnAccent(hex: string): "#ffffff" | typeof accentDarkInk {
  const accent = relativeLuminance(hex) + 0.05;
  const onWhite = 1.05 / accent;
  const onInk = accent / (relativeLuminance(accentDarkInk) + 0.05);
  return onWhite >= onInk ? "#ffffff" : accentDarkInk;
}

export type StorefrontBranding = {
  accentColor?: string | null;
  logoUrl?: string | null;
  heroImageUrl?: string | null;
  themePreset?: StorefrontThemePreset | null;
  /**
   * Read-only, computed by the DB. `public_storefront_projection()` emits it
   * (true, or absent) for plans with `removePlatformBranding`; the storefront
   * editor never writes it and `updateUserStorefront` never persists it. It
   * rides inside the storefront jsonb so the public projection can answer
   * "may this teacher replace our mark?" without publishing what they pay.
   */
  hidePlatformBrand?: boolean | null;
};

export type StorefrontShowcase = {
  tagline?: string | null;
  /** Explicit ordering of this teacher's published courses on the vitrine. */
  orderedCourseIds?: string[];
  featuredCourseId?: string | null;
  sectionLabels?: string[];
};

export type StorefrontConfig = {
  branding?: StorefrontBranding;
  showcase?: StorefrontShowcase;
};

export type UserProfile = {
  uid: string;
  email: string | null;
  displayName: string | null;
  username?: string | null;
  bio?: string | null;
  phoneNumber?: string | null;
  timezone?: string | null;
  goals?: UserGoal[];
  /** Short credibility lines for teachers (e.g. "Professor at University of X"). */
  credentials?: string[] | null;
  photoURL: string | null;
  /** Optional handwritten-signature image printed on certificates the teacher issues. */
  teacherSignatureUrl?: string | null;
  roles: Role[];
  onboardingCompleted: boolean;
  onboardingAnswers?: OnboardingAnswers;
  onboardingPath?: OnboardingPath;
  onboardingCompletedAt?: unknown;
  termsAcceptedAt?: string;
  termsVersion?: string;
  privacyAcceptedAt?: unknown;
  privacyVersion?: string;
  teacherTermsAcceptedAt?: unknown;
  teacherTermsVersion?: string;
  marketingConsent?: boolean;
  stripeConnectedAccountId?: string | null;
  stripeConnectStatus?:
    | "created"
    | "onboarding_required"
    | "ready"
    | "disconnected"
    | null;
  stripeConnectChargesEnabled?: boolean;
  stripeConnectPayoutsEnabled?: boolean;
  stripeConnectUpdatedAt?: unknown;
  /** ISO alpha-2 of the connected account; null until the server records it. */
  stripeConnectCountry?: string | null;
  /**
   * Professional admission review outcome, mirrored from the latest
   * creator_verification_cases decision by the verification RPCs. Server-only
   * writer; absent = treat as "none".
   */
  creatorVerificationStatus?:
    | "none"
    | "pending"
    | "needs_changes"
    | "approved"
    | "rejected";
  /**
   * When the one-time creator activation fee cleared. Written only by the
   * activation webhook; the client reads it to decide whether to show the
   * "activate your account" call to action. Absent = not paid.
   */
  activationFeePaidAt?: string;
  /**
   * Current effective plan, mirrored from the active subscription record.
   * Absent = treat as "free" (default). The subscription webhook is the
   * single writer; never set this from the client.
   */
  currentPlanId?: PlanId;
  /** Stripe Customer ID used for subscription billing (separate from Connect). */
  stripeCustomerId?: string | null;
  /**
   * Notification + learning preferences set from the Settings page. Client-
   * writable on the user's own row (covered by the relaxed self-update policy
   * in RLS — it is not a privilege-bearing field).
   */
  preferences?: UserPreferences;
  /**
   * Instructor storefront branding + showcase ordering, set from the
   * /teach/storefront editor. Client-writable on the user's own row, validated
   * by the storefront guard in RLS (https URLs, hex accent). A safe subset is
   * projected into `public_profiles` by the `sync_public_profile()` trigger.
   */
  storefront?: StorefrontConfig;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string;
};

export type UpsertUserProfileInput = {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
};

export type UserIdentityInput = {
  displayName?: string | null;
  username?: string | null;
  bio?: string | null;
  phoneNumber?: string | null;
  timezone?: string | null;
  goals?: UserGoal[];
  credentials?: string[] | null;
};

export type UpdateOnboardingAnswersInput = {
  uid: string;
  answers: OnboardingAnswers;
  path?: OnboardingPath;
  completed?: boolean;
};

/** Max number of credential lines surfaced on a public teacher profile. */
export const maxCredentialEntries = 6;
/** Max length of a single credential line. */
export const maxCredentialLength = 120;

/**
 * Public, read-only projection of a teacher's profile. Written exclusively by
 * the `sync_public_profile()` Postgres trigger (projected from `public.users`),
 * so it is safe for anonymous reads on the public instructor page. Clients have
 * insert/update/delete revoked on this table.
 */
export type PublicProfile = {
  uid: string;
  displayName: string | null;
  username: string | null;
  photoURL: string | null;
  bio: string | null;
  credentials: string[];
  /**
   * Sanitized, plan-gated slice of the teacher's storefront config. Null when
   * the plan does not include `storefrontTemplates` — the trigger applies that
   * gate, so a downgrade takes the custom vitrine down on the next write.
   * Already validated at projection time (https URLs, hex accent, known theme).
   */
  storefront?: StorefrontConfig | null;
  /**
   * "Verified professional" badge (cosmetic). Null without approval. Only the
   * kind and the date come out of the database: the registration number is never public.
   */
  verification?: ProfessionalVerification | null;
  updatedAt?: unknown;
};

/**
 * What the public knows about the badge: license checked or professional evidence
 * reviewed. Coach, holistic etc. stay in the private case (minimization).
 */
export type ProfessionalVerificationKind = "license" | "evidence";

export type ProfessionalVerification = {
  kind: ProfessionalVerificationKind;
  /** ISO of the review (reviewed_at); null when the case has no review date. */
  verifiedAt: string | null;
};

/**
 * Name the public profile shows: the display name, otherwise the @. Null when
 * there is neither (the caller puts in the translated generic label).
 */
export function publicProfileName(profile: Pick<PublicProfile, "displayName" | "username">): string | null {
  return profile.displayName?.trim() || profile.username || null;
}

// Profile phone: accepts whatever the person types (spaces, parentheses,
// hyphen, +55) and requires between 8 and 15 digits — the E.164 range plus
// short landlines. It does not format: the field keeps what the person wrote.
export function isValidPhoneNumber(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15;
}
