import type { User } from "@supabase/supabase-js";

import type { SkillsetUser } from "@/domain/auth";
import type { UserProfile } from "@/domain/user-profile";

// No "use client" here on purpose: the server builds the same SkillsetUser for
// the first HTML (server-session.ts) as the browser does after hydration, and
// the two must be byte-identical for the session not to be emitted twice.
export function mapSupabaseUser(
  user: User,
  profile?: UserProfile | null,
): SkillsetUser {
  const metadata = user.user_metadata ?? {};
  const metaName =
    (metadata.name as string | undefined) ||
    (metadata.full_name as string | undefined) ||
    (metadata.display_name as string | undefined);
  const metaPhoto =
    (metadata.avatar_url as string | undefined) ||
    (metadata.picture as string | undefined);

  return {
    uid: user.id,
    email: user.email ?? null,
    emailVerified: Boolean(user.email_confirmed_at),
    // Prefer the DB profile; treat empty strings as "unset" so a blank profile
    // value still falls back to the auth record instead of a missing name.
    displayName: profile?.displayName || metaName || null,
    photoURL: profile?.photoURL || metaPhoto || null,
    roles: profile?.roles ?? ["student"],
  };
}
