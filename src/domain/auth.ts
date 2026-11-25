import type { Role } from "@/lib/permissions";

export type AuthStatus =
  | "loading"
  | "authenticated"
  | "unauthenticated"
  /**
   * There is a session (aal1), but the account has a verified second factor and the code
   * has not been presented yet. For the app this is the same as signed out: `user` comes
   * null and no protected surface opens. Only the 6-digit code screen
   * knows how to leave this state.
   */
  | "mfa_required";

export type SkillsetUser = {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
  photoURL: string | null;
  roles: Role[];
};

export type AuthSession = {
  status: AuthStatus;
  user: SkillsetUser | null;
};

export type EmailPasswordCredentials = {
  email: string;
  password: string;
};

export type SignupInput = EmailPasswordCredentials & {
  displayName: string;
  /** UI language at signup, kept in the account metadata. */
  locale?: string;
  /** Terms and Privacy ticked in the form: the current versions go with the account. */
  acceptedTerms?: boolean;
};

/**
 * Dictionary key for a user's highest-priority role (render with t()).
 * Shared by SessionCard (sidebar) and AccountMenu (top bar) so the same
 * person never sees two different words for the same role.
 */
export function primaryRoleKey(roles: readonly Role[]): string {
  if (roles.includes("admin")) return "roles.admin";
  if (roles.includes("support")) return "roles.support";
  if (roles.includes("teacher")) return "roles.creator";
  if (roles.includes("student")) return "roles.learner";
  return "roles.member";
}
