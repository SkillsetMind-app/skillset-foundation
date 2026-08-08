"use client";

import type {
  PublicProfile,
  StorefrontConfig,
  UpsertUserProfileInput,
  UpdateOnboardingAnswersInput,
  UserIdentityInput,
  UserPreferences,
  UserProfile,
} from "@/domain/user-profile";
import {
  currentPrivacyVersion,
  currentTeacherTermsVersion,
  currentTermsVersion,
} from "@/lib/legal/versions";
import type { Role } from "@/lib/permissions";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  rowToPublicProfile,
  rowToUserProfile,
  type PublicProfileRow,
  type UserRow,
} from "@/lib/supabase/user-mappers";

function nowIso(): string {
  return new Date().toISOString();
}

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("uid", uid)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ? rowToUserProfile(data) : null;
}

export function subscribeToUserProfile(
  uid: string,
  callback: (profile: UserProfile | null) => void,
  onError: (error: Error) => void,
): () => void {
  const supabase = getSupabaseBrowserClient();

  // Fire once with the current value (like Firestore onSnapshot), then keep the
  // caller in sync via Realtime. RLS scopes postgres_changes to the caller's
  // own row, so no cross-user leakage.
  void supabase
    .from("users")
    .select("*")
    .eq("uid", uid)
    .maybeSingle()
    .then(({ data, error }) => {
      if (error) {
        onError(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      callback(data ? rowToUserProfile(data) : null);
    });

  const channel = supabase
    .channel(`users:${uid}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "users", filter: `uid=eq.${uid}` },
      (payload) => {
        if (payload.eventType === "DELETE") {
          callback(null);
          return;
        }
        callback(rowToUserProfile(payload.new as unknown as UserRow));
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}

export async function getPublicProfile(
  uid: string,
): Promise<PublicProfile | null> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("public_profiles")
    .select("*")
    .eq("uid", uid)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ? rowToPublicProfile(data) : null;
}

export async function listPublicProfiles(
  limit = 24,
): Promise<PublicProfile[]> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("public_profiles")
    .select("*")
    .order("updated_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) {
    throw error;
  }

  return (data ?? []).map(rowToPublicProfile);
}

export async function getPublicProfilesByIds(
  userIds: string[],
): Promise<PublicProfile[]> {
  const ids = Array.from(new Set(userIds.filter(Boolean))).slice(0, 500);
  if (ids.length === 0) return [];

  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("public_profiles")
    .select("*")
    .in("uid", ids);

  if (error) throw error;
  return (data ?? []).map(rowToPublicProfile);
}

export type SubscriberProfile = {
  uid: string;
  displayName: string;
  photoUrl: string;
};

/**
 * Names of the learners subscribed to (or who bought from) the calling teacher.
 *
 * Learners are deliberately absent from `public_profiles` -- that projection is
 * world-readable by `anon` and only carries approved teachers. This RPC is
 * `SECURITY DEFINER` and takes no arguments: the caller cannot ask about an
 * arbitrary id, only "who bought from me", so there is no enumeration surface.
 */
export async function getMySubscriberProfiles(): Promise<SubscriberProfile[]> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("get_my_subscriber_profiles");

  if (error) throw error;
  return (data ?? []).map((row) => ({
    uid: row.uid ?? "",
    displayName: row.display_name ?? "",
    photoUrl: row.photo_url ?? "",
  }));
}

export function subscribeToPublicProfile(
  uid: string,
  callback: (profile: PublicProfile | null) => void,
  onError: (error: Error) => void,
): () => void {
  const supabase = getSupabaseBrowserClient();

  void supabase
    .from("public_profiles")
    .select("*")
    .eq("uid", uid)
    .maybeSingle()
    .then(({ data, error }) => {
      if (error) {
        onError(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      callback(data ? rowToPublicProfile(data) : null);
    });

  const channel = supabase
    .channel(`public_profiles:${uid}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "public_profiles",
        filter: `uid=eq.${uid}`,
      },
      (payload) => {
        if (payload.eventType === "DELETE") {
          callback(null);
          return;
        }
        callback(rowToPublicProfile(payload.new as unknown as PublicProfileRow));
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}

export async function upsertUserProfile(
  input: UpsertUserProfileInput,
): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const timestamp = nowIso();

  // Create the row if it's somehow missing (normally the on_auth_user_created
  // trigger provisions it at signup). ignoreDuplicates => INSERT ... ON CONFLICT
  // DO NOTHING, so an existing row's roles/identity are never clobbered.
  const { error: insertError } = await supabase.from("users").upsert(
    {
      uid: input.uid,
      email: input.email,
      display_name: input.displayName,
      photo_url: input.photoURL,
      roles: ["student"],
      onboarding_completed: false,
      created_at: timestamp,
      updated_at: timestamp,
      last_login_at: timestamp,
    },
    { onConflict: "uid", ignoreDuplicates: true },
  );

  if (insertError) {
    throw insertError;
  }

  // Record the login without touching profile-managed identity fields
  // (display_name/photo_url are owned by updateUserIdentity after signup).
  const { error: touchError } = await supabase
    .from("users")
    .update({ last_login_at: timestamp, updated_at: timestamp })
    .eq("uid", input.uid);

  if (touchError) {
    throw touchError;
  }
}

export async function updateUserRoles(
  uid: string,
  roles: ReadonlyArray<Extract<Role, "student" | "teacher">>,
) {
  const supabase = getSupabaseBrowserClient();
  const normalizedRoles = Array.from(new Set(roles));
  const includesTeacher = normalizedRoles.includes("teacher");
  const timestamp = nowIso();

  const { error } = await supabase
    .from("users")
    .update({
      roles: normalizedRoles,
      ...(includesTeacher
        ? {
            teacher_terms_accepted_at: timestamp,
            teacher_terms_version: currentTeacherTermsVersion,
          }
        : {}),
      onboarding_completed: true,
      updated_at: timestamp,
    })
    .eq("uid", uid);

  if (error) {
    throw error;
  }
}

export async function updateUserRole(
  uid: string,
  role: Extract<Role, "student" | "teacher">,
) {
  await updateUserRoles(uid, [role]);
}

function buildIdentityPatch(input: UserIdentityInput): Record<string, unknown> {
  const patch: Record<string, unknown> = {};

  if (input.displayName !== undefined) {
    patch.display_name = input.displayName?.trim() || null;
  }

  if (input.username !== undefined) {
    patch.username = input.username?.trim() || null;
  }

  if (input.bio !== undefined) {
    patch.bio = input.bio?.trim() || null;
  }

  if (input.phoneNumber !== undefined) {
    patch.phone_number = input.phoneNumber?.trim() || null;
  }

  if (input.timezone !== undefined) {
    patch.timezone = input.timezone?.trim() || null;
  }

  if (input.goals !== undefined) {
    patch.goals = input.goals;
  }

  if (input.credentials !== undefined) {
    patch.credentials =
      input.credentials && input.credentials.length > 0
        ? input.credentials
        : null;
  }

  return patch;
}

export async function updateUserIdentity(uid: string, input: UserIdentityInput) {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase
    .from("users")
    .update({ ...buildIdentityPatch(input), updated_at: nowIso() })
    .eq("uid", uid);

  if (error) {
    throw error;
  }
}

export async function updateUserPreferences(
  uid: string,
  preferences: UserPreferences,
): Promise<void> {
  const supabase = getSupabaseBrowserClient();

  // Firestore setDoc merge deep-merged nested maps; Postgres jsonb assignment
  // replaces. Read-merge-write reproduces the deep-merge so passing only one
  // section (e.g. { notifications }) preserves the other.
  // ponytail: tiny read-then-write race, negligible for single-user self-edits.
  const { data, error: readError } = await supabase
    .from("users")
    .select("preferences")
    .eq("uid", uid)
    .maybeSingle();

  if (readError) {
    throw readError;
  }

  const current = (data?.preferences as unknown as UserPreferences | null) ?? {};
  const merged: UserPreferences = {
    notifications: { ...current.notifications, ...preferences.notifications },
    learning: { ...current.learning, ...preferences.learning },
  };

  const { error } = await supabase
    .from("users")
    .update({ preferences: merged, updated_at: nowIso() })
    .eq("uid", uid);

  if (error) {
    throw error;
  }
}

export async function updateUserStorefront(
  uid: string,
  storefront: StorefrontConfig,
): Promise<void> {
  const supabase = getSupabaseBrowserClient();

  // Deep-merge branding/showcase so saving only { branding } preserves any
  // { showcase } already on the row (and vice-versa). Same rationale + caveat
  // as updateUserPreferences.
  const { data, error: readError } = await supabase
    .from("users")
    .select("storefront")
    .eq("uid", uid)
    .maybeSingle();

  if (readError) {
    throw readError;
  }

  const current =
    (data?.storefront as unknown as StorefrontConfig | null) ?? {};
  const merged: StorefrontConfig = {
    branding: { ...current.branding, ...storefront.branding },
    showcase: { ...current.showcase, ...storefront.showcase },
  };

  const { error } = await supabase
    .from("users")
    .update({ storefront: merged, updated_at: nowIso() })
    .eq("uid", uid);

  if (error) {
    throw error;
  }
}

export async function updateOnboardingAnswers({
  uid,
  answers,
  path,
  completed = false,
}: UpdateOnboardingAnswersInput) {
  const supabase = getSupabaseBrowserClient();
  const timestamp = nowIso();

  const { error } = await supabase
    .from("users")
    .update({
      onboarding_answers: answers,
      ...(path ? { onboarding_path: path } : {}),
      ...(completed
        ? { onboarding_completed: true, onboarding_completed_at: timestamp }
        : {}),
      updated_at: timestamp,
    })
    .eq("uid", uid);

  if (error) {
    throw error;
  }
}

export async function completeUserOnboarding({
  uid,
  roles,
  identity,
  acceptTeacherTerms = false,
}: {
  uid: string;
  roles: ReadonlyArray<Extract<Role, "student" | "teacher">>;
  identity: UserIdentityInput;
  acceptTeacherTerms?: boolean;
}) {
  const supabase = getSupabaseBrowserClient();
  const normalizedRoles = Array.from(new Set(roles));
  const includesTeacher = normalizedRoles.includes("teacher");
  const timestamp = nowIso();

  const { error } = await supabase
    .from("users")
    .update({
      ...buildIdentityPatch(identity),
      roles: normalizedRoles,
      ...(includesTeacher && acceptTeacherTerms
        ? {
            teacher_terms_accepted_at: timestamp,
            teacher_terms_version: currentTeacherTermsVersion,
          }
        : {}),
      onboarding_completed: true,
      updated_at: timestamp,
    })
    .eq("uid", uid);

  if (error) {
    throw error;
  }
}

export async function acceptUserTerms(uid: string, marketingConsent: boolean) {
  const supabase = getSupabaseBrowserClient();
  const timestamp = nowIso();

  const { error } = await supabase
    .from("users")
    .update({
      terms_accepted_at: timestamp,
      terms_version: currentTermsVersion,
      privacy_accepted_at: timestamp,
      privacy_version: currentPrivacyVersion,
      marketing_consent: marketingConsent,
      updated_at: timestamp,
    })
    .eq("uid", uid);

  if (error) {
    throw error;
  }
}
