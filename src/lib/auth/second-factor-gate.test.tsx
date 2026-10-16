import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthSession } from "@/domain/auth";

const supabaseMocks = vi.hoisted(() => ({
  getSupabaseBrowserClient: vi.fn(),
}));

const profileMocks = vi.hoisted(() => ({
  getUserProfile: vi.fn(),
  upsertUserProfile: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowserClient: supabaseMocks.getSupabaseBrowserClient,
}));

vi.mock("@/lib/data/user-profiles", () => ({
  getUserProfile: profileMocks.getUserProfile,
  upsertUserProfile: profileMocks.upsertUserProfile,
}));

import {
  getCurrentAuthSession,
  getPendingSecondFactor,
  listenToAuthState,
} from "@/lib/auth/supabase-auth";

// POR QUE ESTE ARQUIVO EXISTE (A-17)
//
// `signInWithPassword` grava o cookie de sessao aal1 ANTES de o codigo TOTP
// ser pedido. O listener emitia "authenticated" para qualquer sessao com
// usuario, sem olhar o nivel de garantia (AAL), e todo guard do app so olhava
// `user`. Quem tinha so a senha fechava a tela do codigo e entrava na conta
// inteira. Nao existia um unico teste de MFA no repositorio.
//
// O contrato provado aqui: sessao aal1 de conta com fator verificado vira o
// estado proprio `mfa_required` (user nulo), nunca "authenticated"; depois do
// codigo, a mesma sessao vira "authenticated"; conta sem fator entra direto.

type StateHandler = (event: string, session: unknown) => void;
type Level = "aal1" | "aal2";
type Assurance = { currentLevel: Level; nextLevel: Level };

const supabaseUser = {
  id: "user-1",
  email: "teacher@example.com",
  email_confirmed_at: "2026-01-01T00:00:00Z",
  user_metadata: { name: "Teacher" },
};

function buildClient(initial: Assurance, user: unknown = supabaseUser) {
  let handler: StateHandler | null = null;
  let assurance = initial;

  const client = {
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    auth: {
      getUser: async () => ({ data: { user }, error: null }),
      mfa: {
        getAuthenticatorAssuranceLevel: async () => ({
          data: assurance,
          error: null,
        }),
        listFactors: async () => ({
          data: { totp: [{ id: "factor-1", status: "verified" }] },
          error: null,
        }),
      },
      onAuthStateChange: (callback: StateHandler) => {
        handler = callback;
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
    },
  };

  return {
    client,
    setAssurance: (next: Assurance) => {
      assurance = next;
    },
    fire: (event: string, session: unknown) => handler?.(event, session),
  };
}

// A leitura de perfil e adiada com setTimeout(0) e depois aguarda promessas;
// alternar entre macrotask e microtask drena as duas filas.
async function flush() {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function statuses(seen: AuthSession[]) {
  return seen
    .map((session) => session.status)
    .filter((status) => status !== "loading");
}

const PENDING: Assurance = { currentLevel: "aal1", nextLevel: "aal2" };
const VERIFIED: Assurance = { currentLevel: "aal2", nextLevel: "aal2" };
const NO_FACTOR: Assurance = { currentLevel: "aal1", nextLevel: "aal1" };

describe("listenToAuthState — a senha sozinha nao abre uma conta com TOTP", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    profileMocks.getUserProfile.mockResolvedValue({
      uid: "user-1",
      email: "teacher@example.com",
      displayName: "Teacher",
      photoURL: null,
      roles: ["teacher"],
    });
    profileMocks.upsertUserProfile.mockResolvedValue(undefined);
  });

  it("sessao aal1 de conta com fator: emite mfa_required, nunca authenticated", async () => {
    const harness = buildClient(PENDING);
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(harness.client);

    const seen: AuthSession[] = [];
    listenToAuthState((session) => seen.push(session));

    harness.fire("SIGNED_IN", { user: supabaseUser });
    await flush();

    expect(statuses(seen)).toEqual(["mfa_required"]);
    expect(seen.at(-1)?.user).toBeNull();
    // Nem o perfil e lido: nada da conta chega ao app antes do codigo.
    expect(profileMocks.getUserProfile).not.toHaveBeenCalled();
    expect(harness.client.rpc).not.toHaveBeenCalled();
  });

  it("depois do codigo, a mesma sessao vira authenticated", async () => {
    const harness = buildClient(PENDING);
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(harness.client);

    const seen: AuthSession[] = [];
    listenToAuthState((session) => seen.push(session));

    harness.fire("SIGNED_IN", { user: supabaseUser });
    await flush();

    // mfa.verify troca a sessao por uma aal2 e o Supabase avisa o listener.
    harness.setAssurance(VERIFIED);
    harness.fire("MFA_CHALLENGE_VERIFIED", { user: supabaseUser });
    await flush();

    expect(statuses(seen)).toEqual(["mfa_required", "authenticated"]);
    expect(seen.at(-1)?.user?.displayName).toBe("Teacher");
    expect(harness.client.rpc).toHaveBeenCalledWith("claim_my_course_grants");
  });

  it.each(["INITIAL_SESSION", "TOKEN_REFRESHED", "SIGNED_IN"])("claims before emitting %s, including OTP and Google sessions", async (event) => {
    const harness = buildClient(VERIFIED);
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(harness.client);
    const seen: AuthSession[] = [];
    const claimsAtEmit: number[] = [];
    listenToAuthState((session) => {
      if (session.status === "authenticated") claimsAtEmit.push(harness.client.rpc.mock.calls.length);
      seen.push(session);
    });
    harness.fire(event, { user: supabaseUser });
    await flush();
    expect(statuses(seen)).toEqual(["authenticated"]);
    expect(claimsAtEmit).toEqual([1]);
  });

  it("conta sem fator entra direto: quem nao usa MFA nao muda nada", async () => {
    const harness = buildClient(NO_FACTOR);
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(harness.client);

    const seen: AuthSession[] = [];
    listenToAuthState((session) => seen.push(session));

    harness.fire("SIGNED_IN", { user: supabaseUser });
    await flush();

    expect(statuses(seen)).toEqual(["authenticated"]);
  });
});

describe("getCurrentAuthSession — o refreshUser() do provider passa pelo mesmo portao", () => {
  it("claims confirmed-email grants before returning authentication, and retries after failure", async () => {
    const { client } = buildClient(VERIFIED);
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(client);
    profileMocks.getUserProfile.mockResolvedValue(null);
    client.rpc.mockResolvedValueOnce({ data: null, error: { message: "offline" } });
    expect((await getCurrentAuthSession()).status).toBe("authenticated");
    expect(client.rpc).toHaveBeenCalledWith("claim_my_course_grants");
    expect((await getCurrentAuthSession()).status).toBe("authenticated");
    expect(client.rpc).toHaveBeenCalledTimes(2);
  });

  it("does not claim grants before MFA", async () => {
    const { client } = buildClient(PENDING);
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(client);
    expect((await getCurrentAuthSession()).status).toBe("mfa_required");
    expect(client.rpc).not.toHaveBeenCalled();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    profileMocks.getUserProfile.mockResolvedValue(null);
  });

  it("sessao aal1 de conta com fator e mfa_required, com user nulo", async () => {
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(
      buildClient(PENDING).client,
    );

    await expect(getCurrentAuthSession()).resolves.toEqual({
      status: "mfa_required",
      user: null,
    });
  });

  it("sessao aal2 e authenticated", async () => {
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(
      buildClient(VERIFIED).client,
    );

    const session = await getCurrentAuthSession();

    expect(session.status).toBe("authenticated");
    expect(session.user?.uid).toBe("user-1");
  });

  it("sem usuario e unauthenticated", async () => {
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(
      buildClient(NO_FACTOR, null).client,
    );

    await expect(getCurrentAuthSession()).resolves.toEqual({
      status: "unauthenticated",
      user: null,
    });
  });
});

describe("getPendingSecondFactor — a tela de login retoma o desafio abandonado", () => {
  it("devolve o fator verificado quando a sessao aal1 ainda deve o codigo", async () => {
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(
      buildClient(PENDING).client,
    );

    const pending = await getPendingSecondFactor();

    expect(pending?.factorId).toBe("factor-1");
    expect(pending?.code).toBe("auth/multi-factor-auth-required");
  });

  it("devolve null quando nao ha nada pendente", async () => {
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(
      buildClient(NO_FACTOR).client,
    );

    await expect(getPendingSecondFactor()).resolves.toBeNull();
  });
});

describe("sessao aal1 sem a lista de fatores do Auth: o banco decide", () => {
  // Sem `user.factors`, o Supabase responde nextLevel "aal1" mesmo numa conta
  // com TOTP, e a lista do cliente sai vazia. Quem decide e o banco; o id do
  // fator vem da rota do servidor.
  function hiddenFactors(strong: boolean, allowed = true) {
    const harness = buildClient(NO_FACTOR);
    harness.client.rpc.mockImplementation((name: string) =>
      Promise.resolve({
        data: name === "session_is_strong" ? strong : name === "account_session_allowed" ? allowed : [],
        error: null,
      }),
    );
    harness.client.auth.mfa.listFactors = async () => ({ data: { totp: [] }, error: null });
    return harness;
  }

  function serverFactors(factors: unknown[]) {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ factors }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    profileMocks.getUserProfile.mockResolvedValue(null);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("banco diz fraca e liberada: mfa_required, e o fator vem da rota do servidor", async () => {
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(hiddenFactors(false).client);
    const fetchMock = serverFactors([
      { id: "factor-old", factorType: "totp", status: "unverified" },
      { id: "factor-9", factorType: "totp", status: "verified" },
    ]);

    expect((await getCurrentAuthSession()).status).toBe("mfa_required");
    const pending = await getPendingSecondFactor();

    expect(pending?.factorId).toBe("factor-9");
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/second-factor", expect.objectContaining({ cache: "no-store" }));
  });

  it("o listener tambem segura: nada da conta chega ao app antes do codigo", async () => {
    const harness = hiddenFactors(false);
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(harness.client);
    const seen: AuthSession[] = [];
    listenToAuthState((session) => seen.push(session));

    harness.fire("SIGNED_IN", { user: supabaseUser });
    await flush();

    expect(statuses(seen)).toEqual(["mfa_required"]);
    expect(profileMocks.getUserProfile).not.toHaveBeenCalled();
  });

  it("banco diz forte: entra direto e nem pergunta os fatores", async () => {
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(hiddenFactors(true).client);
    const fetchMock = serverFactors([]);

    expect((await getCurrentAuthSession()).status).toBe("authenticated");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("conta bloqueada (fraca e nao liberada) nao vira pedido de codigo", async () => {
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(hiddenFactors(false, false).client);

    expect((await getCurrentAuthSession()).status).not.toBe("mfa_required");
  });

  it("rota fora do ar: sem fator conhecido nao inventa desafio", async () => {
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(hiddenFactors(false).client);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 503 })));

    await expect(getPendingSecondFactor()).resolves.toBeNull();
  });
});
