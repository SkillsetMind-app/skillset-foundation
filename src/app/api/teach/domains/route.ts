import { NextResponse } from "next/server";

import {
  domainRejectionMessage,
  parseCustomDomain,
} from "@/domain/custom-domain";
import {
  addDomainToProject,
  vercelDomainsConfig,
} from "@/lib/domains/server/vercel-domains";
import {
  enforceRateLimit,
  paymentErrorResponse,
} from "@/lib/payments/server/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// GET  /api/teach/domains — the teacher's domains plus their plan quota.
// POST /api/teach/domains — claim a new one.
//
// The quota is checked by `claim_custom_domain()` in SQL, not here. This route
// validates the hostname, calls Vercel, and records what Vercel answered; if it
// tried to count domains itself, two requests arriving together would both see
// "one used, one allowed" and both insert.

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createSupabaseServerClient();

  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const [{ data: domains }, { data: quota }] = await Promise.all([
    supabase
      .from("custom_domains")
      .select("id, hostname, status, verification_name, verification_value, error_reason, created_at, verified_at")
      .order("created_at", { ascending: true }),
    supabase.rpc("get_my_custom_domain_quota").single(),
  ]);

  return NextResponse.json({
    domains: domains ?? [],
    quota: quota ?? { used: 0, limit: 0 },
    // Lets the panel explain itself instead of showing an add button that
    // always fails, when the platform side is not configured yet.
    configured: vercelDomainsConfig() !== null,
  });
}

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();

  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  // Vercel allows 100 domain additions per hour for the whole team. One teacher
  // must not be able to spend that budget for everybody, so the per-user
  // ceiling sits well below it. Ten an hour is far more than anyone connecting
  // their own site will ever need.
  try {
    await enforceRateLimit(`teach_domain_add_${auth.user.id}`, 10, 60 * 60 * 1000);
  } catch (error) {
    return paymentErrorResponse(error);
  }

  let body: { hostname?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = parseCustomDomain(
    typeof body.hostname === "string" ? body.hostname : "",
  );
  if (!parsed.ok) {
    return NextResponse.json(
      { error: domainRejectionMessage[parsed.reason] },
      { status: 400 },
    );
  }

  const config = vercelDomainsConfig();
  if (!config) {
    // Loud and legible, the same shape the activation-fee route uses. Never
    // record a row we cannot follow through on.
    return NextResponse.json(
      { error: "Custom domains are not available yet. Support has been notified." },
      { status: 503 },
    );
  }

  // Claim FIRST, call Vercel second. The database owns the quota and the
  // uniqueness of the hostname, so letting it refuse before we spend an upstream
  // call is both cheaper and the only ordering that cannot double-spend a slot.
  const { data: claimedId, error: claimError } = await supabase.rpc(
    "claim_custom_domain",
    { p_hostname: parsed.hostname },
  );

  if (claimError) {
    const message = claimError.message ?? "";
    if (/quota reached/i.test(message)) {
      return NextResponse.json(
        { error: "You have used every domain your plan includes. Upgrade to add another." },
        { status: 403 },
      );
    }
    if (/not included on this plan/i.test(message)) {
      return NextResponse.json(
        { error: "Custom domains are not included on your plan." },
        { status: 403 },
      );
    }
    if (/duplicate|unique/i.test(message)) {
      return NextResponse.json(
        { error: "That domain is already connected." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "Could not add that domain." }, { status: 400 });
  }

  const result = await addDomainToProject(parsed.hostname, config);

  // Record whatever Vercel said, including a failure. Leaving the row at its
  // default `pending_dns` after an upstream refusal would show the teacher DNS
  // instructions for a domain that was never accepted.
  await supabase.rpc("sync_own_custom_domain", {
    p_id: claimedId,
    p_status: result.status,
    p_verification_name: result.verificationRecord?.name ?? null,
    p_verification_value: result.verificationRecord?.value ?? null,
    p_error_reason: result.errorReason,
  });

  return NextResponse.json(
    {
      id: claimedId,
      hostname: parsed.hostname,
      status: result.status,
      verificationRecord: result.verificationRecord,
      errorReason: result.errorReason,
    },
    { status: result.status === "error" ? 502 : 201 },
  );
}
