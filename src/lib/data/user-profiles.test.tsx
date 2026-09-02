import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseMocks = vi.hoisted(() => ({
  getSupabaseBrowserClient: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowserClient: supabaseMocks.getSupabaseBrowserClient,
}));

import { updateUserIdentity } from "@/lib/data/user-profiles";

const usernameCollision = {
  code: "23505",
  details: "Key (username)=(joao-silva) already exists.",
  message: 'duplicate key value violates unique constraint "users_username_key"',
};

function buildClient(errors: Array<unknown | null>) {
  const updates: Array<Record<string, unknown>> = [];
  const remainingErrors = [...errors];
  const client = {
    from: vi.fn(() => ({
      update: (payload: Record<string, unknown>) => {
        updates.push(payload);
        const error = remainingErrors.shift() ?? null;
        return { eq: vi.fn(async () => ({ error })) };
      },
    })),
  };

  return { client, updates };
}

describe("updateUserIdentity — sufixo automático de username", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("tenta o sufixo -2 quando o username base já existe", async () => {
    const { client, updates } = buildClient([usernameCollision, null]);
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(client);

    await updateUserIdentity("user-2", {
      displayName: "João Silva",
      username: "joao-silva",
    });

    expect(updates.map((patch) => patch.username)).toEqual(["joao-silva", "joao-silva-2"]);
    expect(updates[1]).toEqual(
      expect.objectContaining({ display_name: "João Silva", username: "joao-silva-2" }),
    );
  });

  it("grava null quando o username base e os sufixos até -9 já existem", async () => {
    const { client, updates } = buildClient(Array(9).fill(usernameCollision));
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(client);

    await updateUserIdentity("user-10", { username: "joao-silva" });

    expect(updates.map((patch) => patch.username)).toEqual([
      "joao-silva",
      "joao-silva-2",
      "joao-silva-3",
      "joao-silva-4",
      "joao-silva-5",
      "joao-silva-6",
      "joao-silva-7",
      "joao-silva-8",
      "joao-silva-9",
      null,
    ]);
  });

  it("reserva espaço para o sufixo sem ultrapassar 32 caracteres", async () => {
    const { client, updates } = buildClient([usernameCollision, null]);
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(client);
    const base = "a".repeat(32);

    await updateUserIdentity("user-long", { username: base });

    expect(updates.map((patch) => patch.username)).toEqual([base, `${"a".repeat(30)}-2`]);
  });

  it("mantém o username base quando não há colisão", async () => {
    const { client, updates } = buildClient([null]);
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(client);

    await updateUserIdentity("user-1", {
      displayName: "João Silva",
      username: "joao-silva",
    });

    expect(updates).toHaveLength(1);
    expect(updates[0]).toEqual(
      expect.objectContaining({ display_name: "João Silva", username: "joao-silva" }),
    );
  });
});
