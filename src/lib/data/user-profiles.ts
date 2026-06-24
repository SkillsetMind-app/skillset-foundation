"use client";

import {
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Unsubscribe,
} from "firebase/firestore";

import type {
  PublicProfile,
  StorefrontConfig,
  UpsertUserProfileInput,
  UpdateOnboardingAnswersInput,
  UserIdentityInput,
  UserPreferences,
  UserProfile,
} from "@/domain/user-profile";
import { getFirestoreDb } from "@/lib/firebase/client";
import {
  currentPrivacyVersion,
  currentTeacherTermsVersion,
  currentTermsVersion,
} from "@/lib/legal/versions";
import type { Role } from "@/lib/permissions";

const usersCollection = "users";
const publicProfilesCollection = "publicProfiles";

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const snapshot = await getDoc(doc(getFirestoreDb(), usersCollection, uid));

  if (!snapshot.exists()) {
    return null;
  }

  return snapshot.data() as UserProfile;
}

export function subscribeToUserProfile(
  uid: string,
  callback: (profile: UserProfile | null) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    doc(getFirestoreDb(), usersCollection, uid),
    (snapshot) => {
      callback(snapshot.exists() ? (snapshot.data() as UserProfile) : null);
    },
    onError,
  );
}

export async function getPublicProfile(
  uid: string,
): Promise<PublicProfile | null> {
  const snapshot = await getDoc(
    doc(getFirestoreDb(), publicProfilesCollection, uid),
  );

  if (!snapshot.exists()) {
    return null;
  }

  return snapshot.data() as PublicProfile;
}

export function subscribeToPublicProfile(
  uid: string,
  callback: (profile: PublicProfile | null) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    doc(getFirestoreDb(), publicProfilesCollection, uid),
    (snapshot) => {
      callback(snapshot.exists() ? (snapshot.data() as PublicProfile) : null);
    },
    onError,
  );
}

export async function upsertUserProfile(
  input: UpsertUserProfileInput,
): Promise<void> {
  const profileRef = doc(getFirestoreDb(), usersCollection, input.uid);
  const existingProfile = await getDoc(profileRef);

  if (existingProfile.exists()) {
    const data = existingProfile.data();
    const patch: Record<string, unknown> = {
      email: input.email,
      displayName: input.displayName,
      photoURL: input.photoURL,
      updatedAt: serverTimestamp(),
      lastLoginAt: serverTimestamp(),
    };

    if (!Array.isArray(data.roles) || data.roles.length === 0) {
      patch.roles = ["student"];
    }

    if (typeof data.uid !== "string") {
      patch.uid = input.uid;
    }

    if (typeof data.onboardingCompleted !== "boolean") {
      patch.onboardingCompleted = false;
    }

    await updateDoc(profileRef, patch);

    return;
  }

  await setDoc(profileRef, {
    uid: input.uid,
    email: input.email,
    displayName: input.displayName,
    photoURL: input.photoURL,
    roles: ["student"],
    onboardingCompleted: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    lastLoginAt: serverTimestamp(),
  });
}

export async function updateUserRoles(
  uid: string,
  roles: ReadonlyArray<Extract<Role, "student" | "teacher">>,
) {
  const normalizedRoles = Array.from(new Set(roles));
  const includesTeacher = normalizedRoles.includes("teacher");

  await setDoc(
    doc(getFirestoreDb(), usersCollection, uid),
    {
      roles: normalizedRoles,
      ...(includesTeacher
        ? {
            teacherTermsAcceptedAt: serverTimestamp(),
            teacherTermsVersion: currentTeacherTermsVersion,
          }
        : {}),
      onboardingCompleted: true,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export async function updateUserRole(uid: string, role: Extract<Role, "student" | "teacher">) {
  await updateUserRoles(uid, [role]);
}

function buildIdentityPatch(input: UserIdentityInput) {
  const patch: Record<string, unknown> = {};

  if (input.displayName !== undefined) {
    patch.displayName = input.displayName?.trim() || null;
  }

  if (input.username !== undefined) {
    patch.username = input.username?.trim() || null;
  }

  if (input.bio !== undefined) {
    patch.bio = input.bio?.trim() || null;
  }

  if (input.phoneNumber !== undefined) {
    patch.phoneNumber = input.phoneNumber?.trim() || null;
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
  await setDoc(
    doc(getFirestoreDb(), usersCollection, uid),
    {
      ...buildIdentityPatch(input),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export async function updateUserPreferences(
  uid: string,
  preferences: UserPreferences,
): Promise<void> {
  // setDoc merge deep-merges nested maps, so passing only one section
  // (e.g. { notifications }) preserves the other section already on the doc.
  await setDoc(
    doc(getFirestoreDb(), usersCollection, uid),
    {
      preferences,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export async function updateUserStorefront(
  uid: string,
  storefront: StorefrontConfig,
): Promise<void> {
  // setDoc merge deep-merges nested maps, so saving only { branding } preserves
  // any { showcase } already on the doc (and vice-versa). The storefront guard
  // in firestore.rules validates the URL/hex fields before this lands.
  await setDoc(
    doc(getFirestoreDb(), usersCollection, uid),
    {
      storefront,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export async function updateOnboardingAnswers({
  uid,
  answers,
  path,
  completed = false,
}: UpdateOnboardingAnswersInput) {
  await setDoc(
    doc(getFirestoreDb(), usersCollection, uid),
    {
      onboardingAnswers: answers,
      ...(path ? { onboardingPath: path } : {}),
      ...(completed
        ? {
            onboardingCompleted: true,
            onboardingCompletedAt: serverTimestamp(),
          }
        : {}),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
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
  const normalizedRoles = Array.from(new Set(roles));
  const includesTeacher = normalizedRoles.includes("teacher");

  await setDoc(
    doc(getFirestoreDb(), usersCollection, uid),
    {
      ...buildIdentityPatch(identity),
      roles: normalizedRoles,
      ...(includesTeacher && acceptTeacherTerms
        ? {
            teacherTermsAcceptedAt: serverTimestamp(),
            teacherTermsVersion: currentTeacherTermsVersion,
          }
        : {}),
      onboardingCompleted: true,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export async function acceptUserTerms(uid: string, marketingConsent: boolean) {
  await setDoc(
    doc(getFirestoreDb(), usersCollection, uid),
    {
      termsAcceptedAt: serverTimestamp(),
      termsVersion: currentTermsVersion,
      privacyAcceptedAt: serverTimestamp(),
      privacyVersion: currentPrivacyVersion,
      marketingConsent,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}
