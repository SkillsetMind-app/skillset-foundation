import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  getUser: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: mocks.createServerClient,
}));

vi.mock("@/lib/supabase/config", () => ({
  assertSupabaseClientConfig: () => ({
    url: "http://localhost",
    anonKey: "anon",
  }),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";

// POR QUE ESTE ARQUIVO EXISTE (A-17)
//
// O cookie de sessao aal1 e gravado antes do codigo TOTP, e cada rota decide
// "esta logado?" com `auth.getUser()` do cliente criado aqui — onze rotas via
// requireUserId, seis lendo getUser() direto. Nenhuma olhava o nivel de
// garantia: o token aal1 era aceito igual ao aal2. Este e o unico ponto por
// onde todas passam, entao e aqui que uma sessao que ainda deve o segundo
// fator passa a responder como "sem usuario".

function token(claims: Record<string, unknown>) {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `header.${payload}.signature`;
}

function sessionWith(accessToken: string) {
  return { data: { session: { access_token: accessToken } }, error: null };
}

const enrolled = {
  id: "user-1",
  factors: [{ id: "f-1", factor_type: "totp", status: "verified" }],
};

const withoutFactor = { id: "user-2", factors: [] };

describe("createSupabaseServerClient — sessao aal1 de conta com TOTP nao e login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createServerClient.mockReturnValue({
      auth: { getUser: mocks.getUser, getSession: mocks.getSession },
    });
  });

  it("recusa aal1 quando a conta exige aal2", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: enrolled }, error: null });
    mocks.getSession.mockResolvedValue(sessionWith(token({ aal: "aal1" })));

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();

    expect(data.user).toBeNull();
    expect(error).toMatchObject({ code: "mfa_required", status: 401 });
  });

  it("libera a mesma conta depois do codigo (aal2)", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: enrolled }, error: null });
    mocks.getSession.mockResolvedValue(sessionWith(token({ aal: "aal2" })));

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();

    expect(data.user).toEqual(enrolled);
    expect(error).toBeNull();
  });

  it("conta sem fator passa em aal1: quem nao usa MFA nao muda nada", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: withoutFactor },
      error: null,
    });

    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getUser();

    expect(data.user).toEqual(withoutFactor);
    // Sem fator nao ha o que conferir: nem o token e lido.
    expect(mocks.getSession).not.toHaveBeenCalled();
  });

  it("resposta sem usuario passa intacta", async () => {
    const refused = { data: { user: null }, error: { message: "invalid JWT" } };
    mocks.getUser.mockResolvedValue(refused);

    const supabase = await createSupabaseServerClient();

    await expect(supabase.auth.getUser()).resolves.toBe(refused);
    expect(mocks.getSession).not.toHaveBeenCalled();
  });

  it("token que nao decodifica conta como aal1: em duvida, fecha", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: enrolled }, error: null });
    mocks.getSession.mockResolvedValue(sessionWith("not.a.jwt"));

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();

    expect(data.user).toBeNull();
    expect(error).toMatchObject({ code: "mfa_required" });
  });
});
