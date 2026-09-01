import { beforeEach, describe, expect, it, vi } from "vitest";

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
    auth: {
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
    vi.clearAllMocks();
    profileMocks.upsertUserProfile.mockResolvedValue(undefined);
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
