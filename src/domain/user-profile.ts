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
  path?: OnboardingPath;
  /** Teacher-only: what they practice (coach, facilitator, mentor, ...). */
  profession?: string;
  sourceOfDiscovery?: string;
  alreadySold?: "yes" | "no";
  monthlyRevenue?: string;
  primaryGoal?: string[];
  instagramHandle?: string;
  audienceSize?: string;
};

export type NotificationPreferences = {
  productEmails: boolean;
  courseActivity: boolean;
  billingAlerts: boolean;
  marketingEmails: boolean;
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

/** A teacher-chosen brand accent must be a 6-digit hex so it is safe to drop
 * into a CSS custom property without style/script injection. */
export function isStorefrontHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
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
  updatedAt?: unknown;
};
