import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseMocks = vi.hoisted(() => ({
  getSupabaseBrowserClient: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowserClient: supabaseMocks.getSupabaseBrowserClient,
}));

import { updateUserRoles } from "@/lib/data/user-profiles";

// Constrói um cliente Supabase falso que registra o payload do update e devolve
// os papéis atuais na leitura.
function buildClient(existingRoles: unknown) {
  const captured: { roles?: unknown } = {};

  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { roles: existingRoles }, error: null }),
        }),
      }),
      update: (payload: Record<string, unknown>) => {
        captured.roles = payload.roles;
        return { eq: async () => ({ error: null }) };
      },
    }),
  };

  return { client, captured };
}

describe("updateUserRoles — o onboarding soma papéis, nunca remove", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // O caso real: a plataforma manda o usuário "atualizar o onboarding" quando
  // ele topa com uma tela sem permissão. Um professor aceitava o padrão nos três
  // passos e voltava sem o Teacher Studio, sem aviso nenhum.
  it("mantém teacher quando o onboarding envia apenas student", async () => {
    const { client, captured } = buildClient(["student", "teacher"]);
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(client);

    await updateUserRoles("teacher-1", ["student"]);

    expect(captured.roles).toEqual(expect.arrayContaining(["student", "teacher"]));
  });

  it("adiciona teacher a quem só era student", async () => {
    const { client, captured } = buildClient(["student"]);
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(client);

    await updateUserRoles("student-1", ["teacher"]);

    expect(captured.roles).toEqual(expect.arrayContaining(["student", "teacher"]));
  });

  it("não duplica papel já presente", async () => {
    const { client, captured } = buildClient(["student", "teacher"]);
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(client);

    await updateUserRoles("teacher-1", ["teacher"]);

    const roles = captured.roles as string[];
    expect(new Set(roles).size).toBe(roles.length);
  });

  // Papéis privilegiados não são auto-atribuíveis: o trigger users_field_guard
  // recusa qualquer valor fora de {student, teacher}. Enviá-los no payload faria
  // a escrita inteira falhar e o usuário perderia também a mudança legítima.
  it("descarta papéis privilegiados que estejam na linha", async () => {
    const { client, captured } = buildClient(["student", "admin", "ops"]);
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(client);

    await updateUserRoles("admin-1", ["teacher"]);

    expect(captured.roles).not.toContain("admin");
    expect(captured.roles).not.toContain("ops");
    expect(captured.roles).toEqual(expect.arrayContaining(["student", "teacher"]));
  });

  it("tolera roles ausente ou malformado sem apagar o que foi pedido", async () => {
    const { client, captured } = buildClient(null);
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(client);

    await updateUserRoles("novo", ["student"]);

    expect(captured.roles).toEqual(["student"]);
  });
});
