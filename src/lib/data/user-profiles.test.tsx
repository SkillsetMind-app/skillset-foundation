import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseMocks = vi.hoisted(() => ({
  getSupabaseBrowserClient: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowserClient: supabaseMocks.getSupabaseBrowserClient,
}));

import {
  acceptTeacherTerms,
  acceptUserTerms,
  updateUserIdentity,
} from "@/lib/data/user-profiles";

// update().eq().select(): RLS can filter the update to zero rows with no error.
function buildAcceptClient(rows: Array<{ uid: string }>) {
  const calls: { payload?: Record<string, unknown>; columns?: string } = {};
  const client = {
    from: vi.fn(() => ({
      update: (payload: Record<string, unknown>) => {
        calls.payload = payload;
        return {
          eq: vi.fn(() => ({
            select: vi.fn(async (columns: string) => {
              calls.columns = columns;
              return { data: rows, error: null };
            }),
          })),
        };
      },
    })),
  };
  return { client, calls };
}

const legalWrites = [
  ["acceptUserTerms", () => acceptUserTerms("u-1", false), "terms_version", "2026-09-24"],
  ["acceptTeacherTerms", () => acceptTeacherTerms("u-1"), "teacher_terms_version", "2026-10-06"],
] as const;

describe("legal acceptance writes must land on a row", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(legalWrites)("%s throws when RLS filters the update to zero rows", async (_name, accept) => {
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(buildAcceptClient([]).client);

    await expect(accept()).rejects.toThrow("no profile row was updated");
  });

  it.each(legalWrites)("%s resolves when its own row is updated", async (_name, accept, versionColumn, version) => {
    const { client, calls } = buildAcceptClient([{ uid: "u-1" }]);
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(client);

    await expect(accept()).resolves.toBeUndefined();
    expect(calls.columns).toBe("uid");
    expect(calls.payload).toHaveProperty(versionColumn, version);
  });
});

// O aceite do cadastro e gravado na primeira pagina logada, as vezes dias
// depois do tique. A hora gravada tem que ser a do tique, nao a da gravacao.
describe("acceptUserTerms records when the box was ticked", () => {
  it("stores the given acceptance time for terms and privacy, and now as the update time", async () => {
    const { client, calls } = buildAcceptClient([{ uid: "u-1" }]);
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(client);
    const signedUpAt = "2026-10-05T10:00:00.000Z";

    await acceptUserTerms("u-1", false, signedUpAt);

    expect(calls.payload).toMatchObject({ terms_accepted_at: signedUpAt, privacy_accepted_at: signedUpAt });
    expect(calls.payload?.updated_at).not.toBe(signedUpAt);
  });

  it("uses the current time when the person ticks it now", async () => {
    const { client, calls } = buildAcceptClient([{ uid: "u-1" }]);
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(client);

    await acceptUserTerms("u-1", false);

    expect(calls.payload?.terms_accepted_at).toBe(calls.payload?.updated_at);
    expect(calls.payload?.privacy_accepted_at).toBe(calls.payload?.updated_at);
  });
});

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
