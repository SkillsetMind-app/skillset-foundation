"use client";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export async function fetchCreatorPlanRequired(): Promise<boolean> {
  const { data, error } = await getSupabaseBrowserClient().rpc("creator_plan_required");
  if (error) throw error;
  if (typeof data !== "boolean") throw new Error("Creator plan status unavailable.");
  return data;
}
