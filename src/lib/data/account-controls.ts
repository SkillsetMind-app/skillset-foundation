"use client";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export type AccountAction = "suspend" | "block" | "restore";
export type AccountControl = { suspended: boolean; blockedEmail: string | null; isSelf: boolean };

function parseControl(value: unknown): AccountControl {
  if (!value || typeof value !== "object" || !("suspended" in value)
    || typeof value.suspended !== "boolean" || !("blocked_email" in value)
    || (value.blocked_email !== null && typeof value.blocked_email !== "string")) {
    throw new Error("Account status unavailable.");
  }
  return { suspended: value.suspended, blockedEmail: value.blocked_email,
    isSelf: "is_self" in value && value.is_self === true };
}

export async function getAccountControl(uid: string): Promise<AccountControl> {
  const { data, error } = await getSupabaseBrowserClient().rpc("admin_get_account_control", { p_target_uid: uid });
  if (error) throw error;
  return parseControl(data);
}

export async function setAccountControl(uid: string, action: AccountAction, reason: string): Promise<AccountControl> {
  const { data, error } = await getSupabaseBrowserClient().rpc("admin_set_account_control", {
    p_target_uid: uid, p_action: action, p_reason: reason.trim(),
  });
  if (error) throw error;
  return parseControl(data);
}
