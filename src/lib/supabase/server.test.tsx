import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  getUser: vi.fn(),
  getSession: vi.fn(),
  rpc: vi.fn(),
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
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    mocks.createServerClient.mockReturnValue({
      auth: { getUser: mocks.getUser, getSession: mocks.getSession },
      rpc: mocks.rpc,
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
    expect(mocks.rpc).toHaveBeenCalledWith("account_session_allowed");
  });

  it("resposta sem usuario passa intacta", async () => {
    const refused = { data: { user: null }, error: { message: "invalid JWT" } };
    mocks.getUser.mockResolvedValue(refused);

    const supabase = await createSupabaseServerClient();

    await expect(supabase.auth.getUser()).resolves.toBe(refused);
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("token que nao decodifica conta como aal1: em duvida, fecha", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: enrolled }, error: null });
    mocks.getSession.mockResolvedValue(sessionWith("not.a.jwt"));

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();

    expect(data.user).toBeNull();
    expect(error).toMatchObject({ code: "mfa_required" });
  });

  it.each([withoutFactor, enrolled])("recusa uma sessao validada pelo Auth mas bloqueada no banco ($id)", async user => {
    mocks.getUser.mockResolvedValue({ data: { user }, error: null });
    mocks.getSession.mockResolvedValue(sessionWith(token({ aal: "aal2" })));
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    const client = await createSupabaseServerClient();
    const { data, error } = await client.auth.getUser();
    expect(mocks.rpc).toHaveBeenCalledWith("account_session_allowed");
    expect(data.user).toBeNull();
    expect(error).toMatchObject({ status: 403, code: "account_access_denied" });
  });

  it.each([
    { data: null, error: null },
    { data: "true", error: null },
    { data: true, error: { message: "private provider detail" } },
  ])("falha fechada para veredicto indisponivel ou invalido %#", async verdict => {
    mocks.getUser.mockResolvedValue({ data: { user: withoutFactor }, error: null });
    mocks.rpc.mockResolvedValue(verdict);
    const client = await createSupabaseServerClient();
    expect((await client.auth.getUser()).data.user).toBeNull();
  });

  it("falha fechada em erro de transporte sem expor diagnostico", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: withoutFactor }, error: null });
    mocks.rpc.mockRejectedValue(new Error("private network detail"));
    const client = await createSupabaseServerClient();
    const response = await client.auth.getUser();
    expect(response.data.user).toBeNull();
    expect(response.error?.message).not.toContain("private");
  });

  it("confere exatamente o JWT explicito, nao o cookie de outra sessao", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: withoutFactor }, error: null });
    const query = Object.assign(Promise.resolve({ data: false, error: null }), { setHeader: vi.fn() });
    mocks.rpc.mockReturnValue(query);
    const client = await createSupabaseServerClient();
    expect((await client.auth.getUser("synthetic-token")).data.user).toBeNull();
    expect(query.setHeader).toHaveBeenCalledWith("Authorization", "Bearer synthetic-token");
    expect(mocks.getSession).not.toHaveBeenCalled();
  });
});
