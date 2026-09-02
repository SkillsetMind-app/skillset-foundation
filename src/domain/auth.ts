import type { Role } from "@/lib/permissions";

export type AuthStatus =
  | "loading"
  | "authenticated"
  | "unauthenticated"
  /**
   * Há sessão (aal1), mas a conta tem segundo fator verificado e o código
   * ainda não foi apresentado. Para o app é o mesmo que deslogado: `user` vem
   * nulo e nenhuma superfície protegida abre. Só a tela do código de 6 dígitos
   * sabe sair deste estado.
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
