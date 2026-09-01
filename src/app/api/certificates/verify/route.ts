import { NextResponse, type NextRequest } from "next/server";

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

  return NextResponse.json(data, { status: 200, headers: CORS_HEADERS });
}
