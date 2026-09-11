import { beforeEach, describe, expect, it, vi } from "vitest";

import { getOpsUserDossier, OPS_USERS_PAGE_SIZE, parseDossier, searchOpsUsers } from "@/lib/data/ops-users";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/client", () => ({ getSupabaseBrowserClient: () => ({ rpc }) }));

beforeEach(() => rpc.mockReset());

function row(overrides: Record<string, unknown> = {}) {
  return {
    uid: "u-1", email: "a@example.test", display_name: "Ana", roles: ["teacher", "not-a-role"],
    created_at: "2026-09-01T00:00:00Z", last_sign_in_at: null, suspended: false, blocked: false,
    total_count: 3, ...overrides,
  };
}

describe("searchOpsUsers", () => {
  it("manda filtros e página para o banco e omite o que está vazio", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await searchOpsUsers({ search: "  ", status: "suspended", role: null, page: 2 });
    expect(rpc).toHaveBeenCalledWith("admin_search_users", {
      p_search: undefined, p_status: "suspended", p_role: undefined,
      p_limit: OPS_USERS_PAGE_SIZE, p_offset: 2 * OPS_USERS_PAGE_SIZE,
    });
  });

  it("deriva o status (banido vence suspenso), descarta papel desconhecido e lê o total", async () => {
    rpc.mockResolvedValue({
      data: [row(), row({ uid: "u-2", suspended: true }), row({ uid: "u-3", suspended: true, blocked: true }), row({ uid: null })],
      error: null,
    });
    const page = await searchOpsUsers();
    expect(page.total).toBe(3);
    expect(page.users.map((user) => user.status)).toEqual(["active", "suspended", "blocked"]);
    expect(page.users[0].roles).toEqual(["teacher"]);
  });

  it("propaga a recusa do banco sem traduzir", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "OPS_ADMIN_MFA_REQUIRED" } });
    await expect(searchOpsUsers()).rejects.toMatchObject({ message: "OPS_ADMIN_MFA_REQUIRED" });
  });
});

describe("getOpsUserDossier", () => {
  it("pede o dossiê pelo uid e limpa os papéis", async () => {
    rpc.mockResolvedValue({ data: { identity: { uid: "u-1", roles: ["admin", "root"] } }, error: null });
    const dossier = await getOpsUserDossier("u-1");
    expect(rpc).toHaveBeenCalledWith("admin_get_user_dossier", { p_uid: "u-1" });
    expect(dossier.identity.roles).toEqual(["admin"]);
  });

  it("respostas do cadastro que não são objeto viram objeto vazio, e a linha do tempo vira lista", () => {
    const parsed = parseDossier({ identity: { uid: "u-1", roles: [] }, onboarding: { answers: ["x"] }, timeline: null });
    expect(parsed.onboarding.answers).toEqual({});
    expect(parsed.timeline).toEqual([]);
    const kept = parseDossier({ identity: { uid: "u-1", roles: [] }, onboarding: { answers: { profession: "Coach" } } });
    expect(kept.onboarding.answers).toEqual({ profession: "Coach" });
  });

  it("recusa resposta sem identidade", () => {
    expect(() => parseDossier({ access: {} })).toThrow("USER_DOSSIER_MALFORMED");
    expect(() => parseDossier(null)).toThrow("USER_DOSSIER_MALFORMED");
  });
});
