"use client";

import { isRole, type Role } from "@/lib/permissions";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Reads and writes the platform roster's roles.
 *
 * Both calls go straight to SECURITY DEFINER functions that gate on is_admin()
 * in SQL — the same predicate the refunds route trusts. There is deliberately no
 * API route in front of them: an admin check that lives next to the data cannot
 * be bypassed by reaching the table another way, and a route would only be a
 * second place to keep the rule in sync.
 *
 * The database also refuses to strip your own admin role or to empty the admin
 * set, so a mis-click can never lock everyone out of the console.
 */

export type PlatformUser = {
  uid: string;
  email: string | null;
  displayName: string | null;
  roles: readonly Role[];
  verificationStatus: string | null;
  createdAt: string | null;
};

type RosterRow = {
  uid: string | null;
  email: string | null;
  display_name: string | null;
  roles: unknown;
  creator_verification_status: string | null;
  created_at: string | null;
};

// users.roles is jsonb, so anything could be in there. Drop what the permission
// module doesn't recognise rather than letting a stray string reach a gate.
function toRoles(value: unknown): readonly Role[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is Role => typeof entry === "string" && isRole(entry),
  );
}

export async function listPlatformUsers(
  search?: string,
): Promise<PlatformUser[]> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("admin_list_platform_users", {
    // Omitted rather than null: the SQL default already means 'no filter'.
    p_search: search?.trim() || undefined,
    p_limit: 200,
  });

  if (error) throw error;

  return ((data ?? []) as RosterRow[])
    .filter((row): row is RosterRow & { uid: string } => Boolean(row.uid))
    .map((row) => ({
      uid: row.uid,
      email: row.email,
      displayName: row.display_name,
      roles: toRoles(row.roles),
      verificationStatus: row.creator_verification_status,
      createdAt: row.created_at,
    }));
}

export async function setUserRoles(
  targetUid: string,
  roles: readonly Role[],
): Promise<readonly Role[]> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("admin_set_user_roles", {
    p_target_uid: targetUid,
    p_roles: roles as unknown as never,
  });

  if (error) throw error;

  return toRoles(data);
}
