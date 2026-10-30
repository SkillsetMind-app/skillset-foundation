import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthSession } from "@/domain/auth";

const supabaseMocks = vi.hoisted(() => ({
  getSupabaseBrowserClient: vi.fn(),
  fetch: vi.fn(),
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

import { listenToAuthState } from "@/lib/auth/supabase-auth";

// POR QUE ESTE ARQUIVO EXISTE
//
// `onAuthStateChange` dispara em eventos que nao mudam nada para o app:
// `TOKEN_REFRESHED` (a cada ~1h) e `SIGNED_IN` quando a aba recupera o foco.
// Antes do conserto, cada disparo produzia um OBJETO `user` NOVO com o mesmo
// conteudo — e 41 efeitos deste app declaram `[user]` como dependencia.
//
// Cinco desses efeitos semeiam campos EDITAVEIS a partir do servidor. Em
// `storefront-settings-panel.tsx` o efeito com dependencia `[user]` roda
// `setTagline(showcase?.tagline ?? "")`: o professor escrevia a tagline, a
// sessao era renovada no meio, o efeito rodava de novo e o que ele digitou era
// substituido pelo ultimo valor salvo — sem uma palavra na tela.
//
// O contrato provado aqui: emitir apenas quando o CONTEUDO muda.

type StateHandler = (event: string, session: unknown) => void;

function buildClient() {
  let handler: StateHandler | null = null;
  let unsubscribed = false;

  const client = {
    rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: supabaseUser }, error: null }),
      mfa: {
        // Conta sem segundo fator: o Supabase responde aal1/aal1 e o listener
        // segue para o perfil. O portão em si é provado em
        // second-factor-gate.test.tsx.
        getAuthenticatorAssuranceLevel: vi.fn().mockResolvedValue({
          data: { currentLevel: "aal1", nextLevel: "aal1" },
          error: null,
        }),
      },
      onAuthStateChange: (callback: StateHandler) => {
        handler = callback;
        return {
          data: {
            subscription: {
              unsubscribe: () => {
                unsubscribed = true;
              },
            },
          },
        };
      },
    },
  };

  return {
    client,
    fire: (event: string, session: unknown) => handler?.(event, session),
    wasUnsubscribed: () => unsubscribed,
  };
}

const supabaseUser = {
  id: "user-1",
  email: "teacher@example.com",
  email_confirmed_at: "2026-01-01T00:00:00Z",
  user_metadata: { name: "Teacher" },
};

function profile(displayName: string) {
  return {
    uid: "user-1",
    email: "teacher@example.com",
    displayName,
    photoURL: null,
    roles: ["teacher"],
  };
}

// A leitura de perfil e adiada com `window.setTimeout(..., 0)` de proposito (o
// Supabase segura o proprio lock enquanto notifica os inscritos), e depois
// aguarda promessas. Alternar entre macrotask e microtask drena as duas filas.
async function flush() {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("listenToAuthState — renovar a sessao nao pode apagar o que a pessoa digitou", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    supabaseMocks.fetch.mockRejectedValue(new Error("Network forbidden"));
    vi.stubGlobal("fetch", supabaseMocks.fetch);
    profileMocks.upsertUserProfile.mockResolvedValue(undefined);
  });

  afterEach(() => {
    expect(supabaseMocks.fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it.each(["profile", "repair-write", "repair-read", "assurance"])(
    "contains a rejected %s read and emits only a closed session",
    async (stage) => {
      const harness = buildClient();
      supabaseMocks.getSupabaseBrowserClient.mockReturnValue(harness.client);
      profileMocks.getUserProfile.mockResolvedValue(profile("Teacher"));
      if (stage === "assurance") {
        harness.client.auth.mfa.getAuthenticatorAssuranceLevel.mockRejectedValue(new Error("private assurance failure"));
      } else if (stage === "profile") {
        profileMocks.getUserProfile.mockRejectedValue(new Error("private profile failure"));
      } else {
        profileMocks.getUserProfile.mockResolvedValueOnce(null);
        if (stage === "repair-write") profileMocks.upsertUserProfile.mockRejectedValue(new Error("private repair failure"));
        else profileMocks.getUserProfile.mockRejectedValueOnce(new Error("private reread failure"));
      }
      const seen: AuthSession[] = [];
      const unsubscribe = listenToAuthState((session) => seen.push(session));
      harness.fire("INITIAL_SESSION", { user: supabaseUser });
      await flush();
      expect(seen).toEqual([
        { status: "loading", user: null },
        { status: "unauthenticated", user: null },
      ]);
      expect(JSON.stringify(seen)).not.toContain("private");
      unsubscribe();
    },
  );

  it.each(["TOKEN_REFRESHED", "SIGNED_IN"])("preserves an earlier authenticated user after a same-user %s profile failure", async (event) => {
    const harness = buildClient();
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(harness.client);
    profileMocks.getUserProfile.mockResolvedValue(profile("Teacher"));
    const seen: AuthSession[] = [];
    const unsubscribe = listenToAuthState((session) => seen.push(session));
    harness.fire("SIGNED_IN", { user: supabaseUser });
    await flush();
    profileMocks.getUserProfile.mockRejectedValueOnce(new Error("private outage"));
    harness.fire(event, { user: supabaseUser });
    await flush();
    expect(seen.at(-1)?.status).toBe("authenticated");
    harness.fire("SIGNED_IN", { user: supabaseUser });
    await flush();
    expect(seen.map((session) => session.status)).toEqual([
      "loading", "authenticated",
    ]);
    unsubscribe();
  });

  it.each(["unsubscribe", "logout", "mfa", "newer-user"])("a rejected refresh emits nothing after %s", async (next) => {
    const harness = buildClient();
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(harness.client);
    profileMocks.getUserProfile.mockResolvedValue(profile("Teacher"));
    const seen: AuthSession[] = [];
    const unsubscribe = listenToAuthState((session) => seen.push(session));
    // Sem sessao previa no unsubscribe: o catch teria motivo para emitir se
    // esquecesse a guarda de atividade, mesmo depois da tela desmontada.
    if (next !== "unsubscribe") {
      harness.fire("SIGNED_IN", { user: supabaseUser });
      await flush();
    }
    let rejectProfile!: (reason: Error) => void;
    profileMocks.getUserProfile.mockImplementationOnce(() => new Promise((_, reject) => { rejectProfile = reject; }));
    const refresh = unsubscribe.refreshUser();
    void refresh.catch(() => {});
    await flush();
    if (next === "unsubscribe") unsubscribe();
    else if (next === "logout") harness.fire("SIGNED_OUT", null);
    else if (next === "mfa") {
      harness.client.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({
        data: { currentLevel: "aal1", nextLevel: "aal2" }, error: null,
      });
      harness.fire("SIGNED_IN", { user: supabaseUser });
    } else {
      profileMocks.getUserProfile.mockResolvedValue({ ...profile("Second"), uid: "user-2" });
      harness.fire("SIGNED_IN", { user: { ...supabaseUser, id: "user-2" } });
    }
    await flush();
    const before = [...seen];
    rejectProfile(new Error("private superseded failure"));
    await expect(refresh).rejects.toThrow("private superseded failure");
    await flush();
    expect(seen).toEqual(before);
    if (next !== "unsubscribe") unsubscribe();
  });

  it.each(["signout", "newer-user"])("ignores an older rejection after %s", async (next) => {
    const harness = buildClient();
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(harness.client);
    let rejectOld!: (error: Error) => void;
    profileMocks.getUserProfile.mockImplementationOnce(() => new Promise((_, reject) => { rejectOld = reject; }));
    const seen: AuthSession[] = [];
    const unsubscribe = listenToAuthState((session) => seen.push(session));
    harness.fire("SIGNED_IN", { user: supabaseUser });
    await flush();
    if (next === "signout") harness.fire("SIGNED_OUT", null);
    else {
      profileMocks.getUserProfile.mockResolvedValue({ ...profile("Second"), uid: "user-2" });
      harness.fire("SIGNED_IN", { user: { ...supabaseUser, id: "user-2" } });
    }
    await flush();
    const before = [...seen];
    rejectOld(new Error("private stale failure"));
    await flush();
    expect(seen).toEqual(before);
    expect(seen.at(-1)?.user?.uid ?? null).toBe(next === "signout" ? null : "user-2");
    unsubscribe();
  });

  it("does not read a queued profile after unsubscribe", async () => {
    const harness = buildClient();
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(harness.client);
    profileMocks.getUserProfile.mockResolvedValue(profile("Teacher"));
    const seen: AuthSession[] = [];
    const unsubscribe = listenToAuthState((session) => seen.push(session));
    harness.fire("SIGNED_IN", { user: supabaseUser });
    unsubscribe();
    await flush();
    expect(profileMocks.getUserProfile).not.toHaveBeenCalled();
    expect(seen).toEqual([{ status: "loading", user: null }]);
  });

  it.each(["resolve", "reject"])("does not emit when an in-flight profile settles after unsubscribe: %s", async (result) => {
    const harness = buildClient();
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(harness.client);
    let resolveProfile!: (value: unknown) => void;
    let rejectProfile!: (error: Error) => void;
    profileMocks.getUserProfile.mockImplementation(() => new Promise((resolve, reject) => {
      resolveProfile = resolve;
      rejectProfile = reject;
    }));
    const seen: AuthSession[] = [];
    const unsubscribe = listenToAuthState((session) => seen.push(session));
    harness.fire("SIGNED_IN", { user: supabaseUser });
    await flush();
    unsubscribe();
    if (result === "resolve") resolveProfile(profile("Teacher"));
    else rejectProfile(new Error("private late failure"));
    await flush();
    expect(seen).toEqual([{ status: "loading", user: null }]);
    expect(harness.wasUnsubscribed()).toBe(true);
  });

  it("nao reemite quando o conteudo da sessao e identico", async () => {
    const harness = buildClient();
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(harness.client);
    profileMocks.getUserProfile.mockResolvedValue(profile("Teacher"));

    const seen: AuthSession[] = [];
    listenToAuthState((session) => seen.push(session));

    harness.fire("SIGNED_IN", { user: supabaseUser });
    await flush();
    harness.fire("TOKEN_REFRESHED", { user: supabaseUser });
    await flush();
    harness.fire("SIGNED_IN", { user: supabaseUser });
    await flush();

    const emitidas = seen.filter(
      (session) => session.status === "authenticated",
    );

    expect(emitidas).toHaveLength(1);
    expect(emitidas[0]?.user?.displayName).toBe("Teacher");
  });

  it("emite de novo quando o conteudo muda de verdade", async () => {
    const harness = buildClient();
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(harness.client);
    profileMocks.getUserProfile
      .mockResolvedValueOnce(profile("Teacher"))
      .mockResolvedValueOnce(profile("Teacher Renamed"));

    const seen: AuthSession[] = [];
    listenToAuthState((session) => seen.push(session));

    harness.fire("SIGNED_IN", { user: supabaseUser });
    await flush();
    harness.fire("USER_UPDATED", { user: supabaseUser });
    await flush();

    const nomes = seen
      .filter((session) => session.status === "authenticated")
      .map((session) => session.user?.displayName);

    expect(nomes).toEqual(["Teacher", "Teacher Renamed"]);
  });

  it("nao repete a saida: dois SIGNED_OUT seguidos emitem uma vez so", async () => {
    const harness = buildClient();
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(harness.client);

    const seen: AuthSession[] = [];
    listenToAuthState((session) => seen.push(session));

    harness.fire("SIGNED_OUT", null);
    harness.fire("SIGNED_OUT", null);
    await flush();

    expect(
      seen.filter((session) => session.status === "unauthenticated"),
    ).toHaveLength(1);
  });

  it("volta a emitir a mesma pessoa depois de um logout no meio", async () => {
    const harness = buildClient();
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(harness.client);
    profileMocks.getUserProfile.mockResolvedValue(profile("Teacher"));

    const seen: AuthSession[] = [];
    listenToAuthState((session) => seen.push(session));

    harness.fire("SIGNED_IN", { user: supabaseUser });
    await flush();
    harness.fire("SIGNED_OUT", null);
    await flush();
    harness.fire("SIGNED_IN", { user: supabaseUser });
    await flush();

    expect(
      seen
        .map((session) => session.status)
        .filter((status) => status !== "loading"),
    ).toEqual(["authenticated", "unauthenticated", "authenticated"]);
  });

  it("continua devolvendo o cancelamento da inscricao", () => {
    const harness = buildClient();
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(harness.client);

    const unsubscribe = listenToAuthState(() => {});
    unsubscribe();

    expect(harness.wasUnsubscribed()).toBe(true);
  });
});
