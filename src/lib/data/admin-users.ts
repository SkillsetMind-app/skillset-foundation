"use client";

import type { PlanId } from "@/data/plans";
import type { UserProfile } from "@/domain/user-profile";
import type {
  OnboardingAnswers,
  OnboardingPath,
  StorefrontConfig,
  UserPreferences,
} from "@/domain/user-profile";
import type { Role } from "@/lib/permissions";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";

type UserRow = Database["public"]["Tables"]["users"]["Row"];

function rowToUserProfile(row: UserRow): UserProfile {
  return {
    uid: row.uid,
    email: row.email,
    displayName: row.display_name,
    username: row.username,
    bio: row.bio,
    phoneNumber: row.phone_number,
    timezone: row.timezone,
    goals: row.goals as UserProfile["goals"],
    credentials: row.credentials as string[] | null,
    photoURL: row.photo_url,
    teacherSignatureUrl: row.teacher_signature_url,
    roles: (row.roles as unknown as Role[]) ?? [],
    onboardingCompleted: row.onboarding_completed,
    onboardingAnswers: row.onboarding_answers as OnboardingAnswers | undefined,
    onboardingPath: row.onboarding_path as OnboardingPath | undefined,
    onboardingCompletedAt: row.onboarding_completed_at ?? undefined,
    termsAcceptedAt: row.terms_accepted_at ?? undefined,
    termsVersion: row.terms_version ?? undefined,
    privacyAcceptedAt: row.privacy_accepted_at ?? undefined,
    privacyVersion: row.privacy_version ?? undefined,
    teacherTermsAcceptedAt: row.teacher_terms_accepted_at ?? undefined,
    teacherTermsVersion: row.teacher_terms_version ?? undefined,
    marketingConsent: row.marketing_consent ?? undefined,
    stripeConnectedAccountId: row.stripe_connected_account_id,
    stripeConnectStatus: row.stripe_connect_status as UserProfile["stripeConnectStatus"],
    stripeConnectChargesEnabled: row.stripe_connect_charges_enabled ?? undefined,
    stripeConnectPayoutsEnabled: row.stripe_connect_payouts_enabled ?? undefined,
    stripeConnectUpdatedAt: row.stripe_connect_updated_at ?? undefined,
    currentPlanId: row.current_plan_id as PlanId | undefined,
    stripeCustomerId: row.stripe_customer_id,
    preferences: row.preferences as UserPreferences | undefined,
    storefront: row.storefront as StorefrontConfig | undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at,
  };
}

function byDisplayName(left: UserProfile, right: UserProfile): number {
  return (left.displayName ?? left.email ?? left.uid).localeCompare(
    right.displayName ?? right.email ?? right.uid,
  );
}

export function subscribeToAdminUserProfiles(
  callback: (users: UserProfile[]) => void,
  onError: (error: Error) => void,
): () => void {
  const supabase = getSupabaseBrowserClient();

  const load = async () => {
    const { data, error } = await supabase.from("users").select("*");

    if (error) {
      onError(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    callback((data ?? []).map(rowToUserProfile).sort(byDisplayName));
  };

  void load();

  // ponytail: table-wide change fan-in; admin-only list, acceptable fan-in.
  const channel = supabase
    .channel("users:admin:all")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "users" },
      () => {
        void load();
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
