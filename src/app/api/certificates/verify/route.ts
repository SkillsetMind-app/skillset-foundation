import { NextResponse, type NextRequest } from "next/server";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { rateLimitKeyFromIp } from "@/lib/supabase/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Public, embeddable certificate verification (replaces the Firebase
// verifySkillsetCertificateHttp function). CORS "*" by design so external sites
// (LinkedIn, recruiters) can confirm a credential. The verify_skillset_certificate
// RPC is SECURITY DEFINER and rate-limits per visitor via p_rate_key — the same
// hashed-IP key every other public route uses, never the address itself: this is
// the most exposed endpoint of the set, and the visitors are third parties who
// only ever saw an embedded widget.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store",
};

// The RPC only vouches for issued certificates, so one revoked after a refund
// or a lost chargeback reads as "not found". Whoever holds the code may be
// looking at a printed copy: tell them it was revoked. Exact code only, one
// boolean out, and it runs only after the RPC's rate limit has counted the
// request.
// ponytail: a second read on the service role; move it into the RPC's answer
// when that function is next migrated.
async function isRevokedCode(code: string): Promise<boolean> {
  try {
    const { data } = await getSupabaseAdminClient()
      .from("certificates")
      .select("status")
      .eq("verification_code", code)
      // 'revoked' by ops, 'refund_revoked' by a full refund or lost chargeback.
      .in("status", ["revoked", "refund_revoked"])
      .limit(1)
      .maybeSingle();
    return Boolean(data);
  } catch {
    // Best effort: the visitor still gets the RPC's "not found".
    return false;
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(request: NextRequest) {
  const code = (request.nextUrl.searchParams.get("code") ?? "")
    .trim()
    .toUpperCase();

  if (!code || code.length > 80) {
    return NextResponse.json(
      { error: "A valid verification code is required." },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const bucket = rateLimitKeyFromIp(request, "cert");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("verify_skillset_certificate", {
    p_code: code,
    p_rate_key: bucket,
  });

  if (error) {
    if (error.message?.includes("RATE_LIMIT")) {
      return NextResponse.json(
        { error: "Too many attempts. Please wait before trying again." },
        { status: 429, headers: CORS_HEADERS },
      );
    }

    return NextResponse.json(
      { error: "Certificate verification failed." },
      { status: 500, headers: CORS_HEADERS },
    );
  }

  const invalid = (data as { valid?: unknown } | null)?.valid === false;
  if (invalid && (await isRevokedCode(code))) {
    return NextResponse.json({ valid: false, revoked: true }, { status: 200, headers: CORS_HEADERS });
  }

  return NextResponse.json(data, { status: 200, headers: CORS_HEADERS });
}
