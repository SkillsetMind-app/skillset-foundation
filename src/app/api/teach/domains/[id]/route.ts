import { NextResponse } from "next/server";

import {
  refreshDomainStatus,
  removeDomainFromProject,
  vercelDomainsConfig,
} from "@/lib/domains/server/vercel-domains";
import {
  enforceRateLimit,
  paymentErrorResponse,
} from "@/lib/payments/server/auth";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// POST   /api/teach/domains/[id] — "check again": ask Vercel to re-verify.
// DELETE /api/teach/domains/[id] — disconnect.
//
// Neither route trusts the id. Both RPCs behind them filter on owner_uid, so an
// id belonging to somebody else simply matches nothing — and they stay silent
// about which case it was, because telling a caller "that id exists but is not
// yours" is an enumeration oracle.

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  // Vercel allows 50 verifications per hour across the whole team, and this is
  // the button a frustrated teacher presses repeatedly while waiting for DNS.
  // Twenty an hour each keeps one impatient person from exhausting the team's
  // budget for everyone.
  try {
    await enforceRateLimit(`teach_domain_verify_${auth.user.id}`, 20, 60 * 60 * 1000);
  } catch (error) {
    return paymentErrorResponse(error);
  }

  // RLS already restricts this select to the caller's own rows.
  const { data: domain } = await supabase
    .from("custom_domains")
    .select("id, hostname")
    .eq("id", id)
    .maybeSingle();

  if (!domain) {
    return NextResponse.json({ error: "Domain not found." }, { status: 404 });
  }

  const config = vercelDomainsConfig();
  if (!config) {
    return NextResponse.json(
      { error: "Custom domains are not available yet. Support has been notified." },
      { status: 503 },
    );
  }

  const result = await refreshDomainStatus(domain.hostname, config);

  // Gravacao pelo service_role, nao pela sessao do usuario. O status de
  // verificacao e um fato do SERVIDOR — quem o conhece e esta rota, que acabou
  // de falar com a API da Vercel. Enquanto era escrito com o JWT do usuario, a
  // funcao precisava ser EXECUTE para `authenticated`, e entao qualquer criador
  // podia chama-la direto pelo PostgREST passando status='active': dominio
  // "verificado" sem nunca ter passado pela Vercel, e entrando em
  // public_domains, que e o que o proxy le para decidir de quem e a vitrine
  // servida naquele host. O dono vai explicito e continua sendo conferido no
  // banco.
  await getSupabaseAdminClient().rpc("sync_custom_domain_status", {
    p_id: id,
    p_owner_uid: auth.user.id,
    p_status: result.status,
    p_verification_name: result.verificationRecord?.name ?? null,
    p_verification_value: result.verificationRecord?.value ?? null,
    p_error_reason: result.errorReason,
  });

  return NextResponse.json({
    id,
    hostname: domain.hostname,
    status: result.status,
    verificationRecord: result.verificationRecord,
    errorReason: result.errorReason,
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  // Delete FIRST, detach from Vercel second. The row is the thing that makes a
  // domain resolve — dropping it stops traffic immediately via the projection
  // trigger. If the Vercel call then fails, the worst case is a domain left
  // attached upstream serving nothing, which is untidy rather than harmful. The
  // other order would leave a window where the row still routes to a domain we
  // have already given up.
  const { data: hostname, error } = await supabase.rpc(
    "release_own_custom_domain",
    { p_id: id },
  );

  if (error) {
    return NextResponse.json({ error: "Could not remove that domain." }, { status: 400 });
  }

  if (!hostname) {
    // Not theirs, or already gone. Same answer either way, on purpose.
    return NextResponse.json({ error: "Domain not found." }, { status: 404 });
  }

  const config = vercelDomainsConfig();
  if (config) {
    // Best effort. The teacher's intent is already satisfied by the row being
    // gone, so an upstream failure here must not surface as a failed delete and
    // invite them to press it again.
    await removeDomainFromProject(hostname, config);
  }

  return NextResponse.json({ ok: true, hostname });
}
