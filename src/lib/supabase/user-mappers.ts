import type { PlanId } from "@/data/plans";
import type {
  OnboardingAnswers,
  OnboardingPath,
  PublicProfile,
  StorefrontConfig,
  UserGoal,
  UserPreferences,
  UserProfile,
} from "@/domain/user-profile";
import type { Role } from "@/lib/permissions";
import type { Database } from "@/lib/supabase/database.types";

// The snake_case (DB) <-> camelCase (domain) boundary for the users +
// public_profiles tables. Every read of these tables goes through here so the
// rest of the app keeps speaking the existing UserProfile/PublicProfile shapes.
export type UserRow = Database["public"]["Tables"]["users"]["Row"];
export type PublicProfileRow =
  Database["public"]["Tables"]["public_profiles"]["Row"];

export function rowToUserProfile(row: UserRow): UserProfile {
  return {
    uid: row.uid,
    email: row.email,
    displayName: row.display_name,
    username: row.username,
    bio: row.bio,
    phoneNumber: row.phone_number,
    timezone: row.timezone,
    goals: (row.goals as unknown as UserGoal[] | null) ?? undefined,
    credentials: (row.credentials as unknown as string[] | null) ?? null,
    photoURL: row.photo_url,
    teacherSignatureUrl: row.teacher_signature_url,
    roles: (row.roles as unknown as Role[]) ?? ["student"],
    onboardingCompleted: row.onboarding_completed,
    onboardingAnswers:
      (row.onboarding_answers as unknown as OnboardingAnswers | null) ??
      undefined,
    onboardingPath: (row.onboarding_path as OnboardingPath | null) ?? undefined,
    onboardingCompletedAt: row.onboarding_completed_at ?? undefined,
    termsAcceptedAt: row.terms_accepted_at ?? undefined,
    termsVersion: row.terms_version ?? undefined,
    privacyAcceptedAt: row.privacy_accepted_at ?? undefined,
    privacyVersion: row.privacy_version ?? undefined,
    teacherTermsAcceptedAt: row.teacher_terms_accepted_at ?? undefined,
    teacherTermsVersion: row.teacher_terms_version ?? undefined,
    marketingConsent: row.marketing_consent ?? undefined,
    stripeConnectedAccountId: row.stripe_connected_account_id,
    stripeConnectStatus:
      (row.stripe_connect_status as UserProfile["stripeConnectStatus"]) ?? null,
    stripeConnectChargesEnabled: row.stripe_connect_charges_enabled ?? undefined,
    stripeConnectPayoutsEnabled: row.stripe_connect_payouts_enabled ?? undefined,
    stripeConnectUpdatedAt: row.stripe_connect_updated_at ?? undefined,
    creatorVerificationStatus:
      (row.creator_verification_status as UserProfile["creatorVerificationStatus"]) ??
      undefined,
    activationFeePaidAt: row.activation_fee_paid_at ?? undefined,
    stripeCustomerId: row.stripe_customer_id,
    currentPlanId: (row.current_plan_id as PlanId | null) ?? undefined,
    preferences:
      (row.preferences as unknown as UserPreferences | null) ?? undefined,
    storefront:
      (row.storefront as unknown as StorefrontConfig | null) ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at,
  };
}

export function rowToPublicProfile(row: PublicProfileRow): PublicProfile {
  return {
    uid: row.uid,
    displayName: row.display_name,
    username: row.username,
    photoURL: row.photo_url,
    bio: row.bio,
    credentials: (row.credentials as unknown as string[] | null) ?? [],
    storefront: (row.storefront as unknown as StorefrontConfig | null) ?? null,
    updatedAt: row.updated_at ?? undefined,
  };
}
