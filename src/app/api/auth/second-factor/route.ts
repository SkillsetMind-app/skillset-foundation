import { NextResponse } from "next/server";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { allowByIp } from "@/lib/supabase/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// The 2FA factors of the caller's OWN account, so the screen can ask for the code.
//
// Why it exists: Supabase Auth does not return `user.factors` for an aal1
// session, and the client list (`mfa.listFactors`) comes back empty; without
// the factor id there is no way to ask for the code. The admin API returns the
// factors: here it is called only for the owner of a token that GoTrue itself
// checked. Only id, type, status and dates are returned.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };
// A login screen reads this once or twice; 60 per minute per IP is plenty.
const RATE_LIMIT_PER_MINUTE = 60;

export async function GET(request: Request) {
  if (!(await allowByIp(request, "second-factor", RATE_LIMIT_PER_MINUTE, 60_000))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: noStore });
  }

  const supabase = await createSupabaseServerClient();
  // getSession, not getUser: this client's getUser rejects exactly the session
  // that still owes the code, which is the one that needs this response. The
  // token is checked just below by GoTrue.
  const token = (await supabase.auth.getSession()).data.session?.access_token;
  if (!token) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401, headers: noStore });
  }

  let admin: ReturnType<typeof getSupabaseAdminClient>;
  try {
    admin = getSupabaseAdminClient();
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 503, headers: noStore });
  }
  const { data: caller, error: callerError } = await admin.auth.getUser(token);
  if (callerError || !caller.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401, headers: noStore });
  }

  const { data, error } = await admin.auth.admin.mfa.listFactors({ userId: caller.user.id });
  if (error || !data) {
    return NextResponse.json({ error: "unavailable" }, { status: 503, headers: noStore });
  }

  return NextResponse.json(
    {
      factors: data.factors.map((factor) => ({
        id: factor.id,
        factorType: factor.factor_type,
        status: factor.status,
        friendlyName: factor.friendly_name ?? null,
        createdAt: factor.created_at ?? null,
        updatedAt: factor.updated_at ?? null,
      })),
    },
    { headers: noStore },
  );
}
