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
// requireUserId, seis lendo getUser() direto. Este e o unico ponto por onde
// todas passam, entao e aqui que uma sessao que ainda deve o segundo fator
// passa a responder como "sem usuario".
//
// O Auth do Supabase nao manda `user.factors` para a sessao aal1, entao a lista
// nao serve para decidir. Quem decide e o banco (session_is_strong le
// auth.mfa_factors).

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

// Como o GoTrue responde hoje para a sessao aal1: sem a chave `factors`.
const factorsHidden = { id: "user-3" };

function verdicts({ strong, allowed }: { strong: unknown; allowed: unknown }) {
  mocks.rpc.mockImplementation((name: string) =>
    Promise.resolve({ data: name === "session_is_strong" ? strong : allowed, error: null }),
  );
}

describe("createSupabaseServerClient — sessao aal1 de conta com TOTP nao e login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    mocks.createServerClient.mockReturnValue({
      auth: { getUser: mocks.getUser, getSession: mocks.getSession },
      rpc: mocks.rpc,
    });
  });

  it("recusa aal1 quando o banco diz que a conta deve o codigo", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: enrolled }, error: null });
    verdicts({ strong: false, allowed: true });

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();

    expect(data.user).toBeNull();
    expect(error).toMatchObject({ code: "mfa_required", status: 401 });
  });

  it("GoTrue sem a lista de fatores nao abre a conta: o banco decide", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: factorsHidden }, error: null });
    mocks.getSession.mockResolvedValue(sessionWith(token({ aal: "aal1" })));
    verdicts({ strong: false, allowed: true });

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();

    expect(data.user).toBeNull();
    expect(error).toMatchObject({ code: "mfa_required", status: 401 });
    expect(mocks.rpc).toHaveBeenCalledWith("session_is_strong");
  });

  it("libera a mesma conta depois do codigo (sessao forte), com uma consulta so", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: enrolled }, error: null });
    verdicts({ strong: true, allowed: true });

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();

    expect(data.user).toEqual(enrolled);
    expect(error).toBeNull();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("session_is_strong");
  });

  it("conta sem fator passa em aal1: quem nao usa MFA nao muda nada", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: withoutFactor },
      error: null,
    });
    verdicts({ strong: true, allowed: true });

    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getUser();

    expect(data.user).toEqual(withoutFactor);
    // O banco responde pelo JWT: o token do cookie nem e lido aqui.
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it("resposta sem usuario passa intacta", async () => {
    const refused = { data: { user: null }, error: { message: "invalid JWT" } };
    mocks.getUser.mockResolvedValue(refused);

    const supabase = await createSupabaseServerClient();

    await expect(supabase.auth.getUser()).resolves.toBe(refused);
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([withoutFactor, enrolled])("recusa uma sessao validada pelo Auth mas bloqueada no banco ($id)", async user => {
    mocks.getUser.mockResolvedValue({ data: { user }, error: null });
    verdicts({ strong: false, allowed: false });
    const client = await createSupabaseServerClient();
    const { data, error } = await client.auth.getUser();
    expect(mocks.rpc).toHaveBeenCalledWith("session_is_strong");
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

  it("confere exatamente o JWT explicito nas duas consultas, nao o cookie de outra sessao", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: withoutFactor }, error: null });
    const strongQuery = Object.assign(Promise.resolve({ data: false, error: null }), { setHeader: vi.fn() });
    const allowedQuery = Object.assign(Promise.resolve({ data: true, error: null }), { setHeader: vi.fn() });
    mocks.rpc.mockImplementation((name: string) => (name === "session_is_strong" ? strongQuery : allowedQuery));
    const client = await createSupabaseServerClient();
    const { data, error } = await client.auth.getUser("synthetic-token");
    expect(data.user).toBeNull();
    expect(error).toMatchObject({ code: "mfa_required" });
    expect(strongQuery.setHeader).toHaveBeenCalledWith("Authorization", "Bearer synthetic-token");
    expect(allowedQuery.setHeader).toHaveBeenCalledWith("Authorization", "Bearer synthetic-token");
    expect(mocks.getSession).not.toHaveBeenCalled();
  });
});
