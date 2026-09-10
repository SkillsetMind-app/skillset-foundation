import { NextResponse } from "next/server";
import { caughtFailure, databaseFailure, failure, isSameOrigin, uuidPattern } from "@/lib/operations/http";
import { enforceRateLimit, requireUserId } from "@/lib/payments/server/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { finishActivationWaiver } from "@/lib/payments/server/activation-waiver";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    await requireUserId();
    const { id } = await context.params;
    if (!uuidPattern.test(id)) return failure(400, "Invalid invitation.");
    const client = await createSupabaseServerClient();
    const { data, error } = await client.rpc("get_my_platform_invite", { p_invite_id: id });
    return error ? databaseFailure(error) : NextResponse.json({ invite: data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return caughtFailure(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    if (!isSameOrigin(request)) return failure(403);
    const uid = await requireUserId();
    const { id } = await context.params;
    if (!uuidPattern.test(id)) return failure(400, "Invalid invitation.");
    await enforceRateLimit(`platform_invite_accept_${uid}`, 20, 3600000);
    const client = await createSupabaseServerClient();
    const { data, error } = await client.rpc("accept_platform_invite", { p_invite_id: id });
    if (error) return databaseFailure(error);
    if (!data || typeof data !== "object" || Array.isArray(data)) return failure(503);
    if (data.waive_activation) {
      if (typeof data.waiver_revision !== "string" || !uuidPattern.test(data.waiver_revision)) return failure(503);
      await finishActivationWaiver(uid, data.waiver_revision);
    }
    return NextResponse.json(data);
  } catch (error) { return caughtFailure(error); }
}
