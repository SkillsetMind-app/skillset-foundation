import { NextResponse } from "next/server";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { allowByIp } from "@/lib/supabase/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Os fatores de 2FA da PRÓPRIA conta, para a tela pedir o código.
//
// Por que existe: o Auth do Supabase não devolve `user.factors` para a sessão
// aal1, e a lista do cliente (`mfa.listFactors`) sai vazia; sem o id do fator
// não há como pedir o código. A API de administração devolve os fatores: aqui
// ela é chamada só para o dono do token que o próprio GoTrue conferiu. Sai só
// id, tipo, estado e datas.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };
// Uma tela de login lê isto uma ou duas vezes; 60 por minuto por IP sobra.
const RATE_LIMIT_PER_MINUTE = 60;

export async function GET(request: Request) {
  if (!(await allowByIp(request, "second-factor", RATE_LIMIT_PER_MINUTE, 60_000))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: noStore });
  }

  const supabase = await createSupabaseServerClient();
  // getSession, não getUser: o getUser deste cliente recusa justamente a sessão
  // que ainda deve o código, que é quem precisa desta resposta. O token é
  // conferido logo abaixo pelo GoTrue.
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
