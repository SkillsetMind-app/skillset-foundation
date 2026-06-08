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
   * Current effective plan, mirrored from the active subscription record.
   * Absent = treat as "free" (default). The subscription webhook is the
   * single writer; never set this from the client.
   */
  currentPlanId?: PlanId;
  /** Stripe Customer ID used for subscription billing (separate from Connect). */
  stripeCustomerId?: string | null;
  /**
   * Notification + learning preferences set from the Settings page. Client-
   * writable on the user's own doc (covered by the relaxed update policy in
   * firestore.rules — it is not a privilege-bearing field).
   */
  preferences?: UserPreferences;
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
 * the `syncPublicTeacherProfile` Cloud Function (projected from `users/{uid}`),
 * so it is safe for anonymous reads on the public instructor page. Clients
 * never write this document.
 */
export type PublicProfile = {
  uid: string;
  displayName: string | null;
  username: string | null;
  photoURL: string | null;
  bio: string | null;
  credentials: string[];
  updatedAt?: unknown;
};
