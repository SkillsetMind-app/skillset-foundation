import { NextResponse } from "next/server";
import { platformAccessLevels, type PlatformInvite } from "@/domain/platform-invites";
import { caughtFailure, databaseFailure, failure, isSameOrigin, readSmallObject, uuidPattern } from "@/lib/operations/http";
import { enforceRateLimit, requireAdminUserId } from "@/lib/payments/server/auth";
import { getAppUrl } from "@/lib/payments/server/app-url";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { finishActivationWaiver } from "@/lib/payments/server/activation-waiver";

export async function GET() {
  try {
    await requireAdminUserId();
    const client = await createSupabaseServerClient();
    const { data, error } = await client.rpc("admin_list_platform_invites");
    return error ? databaseFailure(error) : NextResponse.json({ invites: data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return caughtFailure(error); }
}

export async function POST(request: Request) {
  try {
    if (!isSameOrigin(request)) return failure(403);
    const uid = await requireAdminUserId();
    const body = await readSmallObject(request);
    const allowed: Record<string, string[]> = {
      create: ["action", "email", "accessLevel", "waiveActivation"],
      resend: ["action", "inviteId"], revoke: ["action", "inviteId"],
      waive: ["action", "uid", "waived"],
    };
    const action = typeof body.action === "string" ? body.action : "";
    if (!Object.hasOwn(allowed, action) || Object.keys(body).some((key) => !allowed[action].includes(key))) return failure(400, "Invalid request fields.");
    if (action === "create") {
      if (typeof body.email !== "string" || body.email.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())
        || !platformAccessLevels.some((level) => level === body.accessLevel) || typeof body.waiveActivation !== "boolean"
        || (body.waiveActivation && body.accessLevel !== "teacher")) return failure(400, "Check the email, access level and activation waiver.");
    } else if (action === "waive") {
      if (typeof body.uid !== "string" || !uuidPattern.test(body.uid) || typeof body.waived !== "boolean") return failure(400, "Choose an account and waiver decision.");
    } else if (typeof body.inviteId !== "string" || !uuidPattern.test(body.inviteId)) return failure(400, "Choose an invitation.");

    await enforceRateLimit(`platform_access_${uid}`, 30, 3600000);
    const client = await createSupabaseServerClient();
    if (action === "waive") {
      const { data, error } = await client.rpc("admin_set_activation_waiver", { p_target_uid: body.uid as string, p_waived: body.waived as boolean });
      if (error) return databaseFailure(error);
      if (body.waived) {
        const revision = data && typeof data === "object" && !Array.isArray(data) ? data.revision : null;
        if (typeof revision !== "string" || !uuidPattern.test(revision)) return failure(503);
        await finishActivationWaiver(body.uid as string, revision);
      }
      return NextResponse.json({ ok: true });
    }
    if (action === "revoke") {
      const { error } = await client.rpc("admin_revoke_platform_invite", { p_invite_id: body.inviteId as string });
      return error ? databaseFailure(error) : NextResponse.json({ ok: true });
    }

    const result = action === "create"
      ? await client.rpc("admin_create_platform_invite", { p_email: (body.email as string).trim().toLowerCase(), p_access_level: body.accessLevel as string, p_waive_activation: body.waiveActivation as boolean })
      : await client.rpc("admin_list_platform_invites");
    if (result.error) return databaseFailure(result.error);
    // ponytail: resend is limited to the same latest-200 roster shown by the UI.
    const invite = (action === "create" ? result.data : (result.data as unknown as PlatformInvite[])?.find((entry) => entry.id === body.inviteId)) as unknown as PlatformInvite | undefined;
    if (!invite || invite.revoked_at || invite.accepted_at || !(Date.parse(invite.expires_at) > Date.now())) return failure(409, "This invitation is no longer available.");

    let emailStatus: "sent" | "failed" = "failed";
    try {
      await enforceRateLimit(`platform_invite_email_${invite.id}`, 3, 3600000);
      const destination = `/invitations/${invite.id}`;
      const { error } = await getSupabaseAdminClient().auth.signInWithOtp({
        email: invite.email,
        options: { shouldCreateUser: true, emailRedirectTo: `${getAppUrl()}/auth/confirm?next=${encodeURIComponent(destination)}` },
      });
      if (!error) emailStatus = "sent";
    } catch { /* Keep the pending invitation; do not pretend mail was delivered. */ }
    return NextResponse.json({ invite, emailStatus });
  } catch (error) { return caughtFailure(error); }
}
