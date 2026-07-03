import type { Role } from "@/lib/permissions";

export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

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
