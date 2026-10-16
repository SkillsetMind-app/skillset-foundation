import { NextResponse } from "next/server";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Os fatores de 2FA da PRÓPRIA conta, para a tela pedir o código.
//
// Por que existe: desde 16/10 o Auth do Supabase não devolve `user.factors`
// para a sessão aal1, e a lista do cliente (`mfa.listFactors`) sai vazia. Sem
// o id do fator, o login não pedia o código e a senha sozinha bastava. A API de
// administração ainda devolve os fatores: aqui ela é chamada só para o dono do
// token que o próprio GoTrue conferiu. Sai só id, tipo, estado e datas.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

export async function GET() {
  const supabase = await createSupabaseServerClient();
  // getSession, não getUser: o getUser deste cliente recusa justamente a sessão
  // que ainda deve o código, que é quem precisa desta resposta. O token é
  // conferido logo abaixo pelo GoTrue.
  const token = (await supabase.auth.getSession()).data.session?.access_token;
  if (!token) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401, headers: noStore });
  }

  const admin = getSupabaseAdminClient();
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
