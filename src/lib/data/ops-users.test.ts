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
  it("sends filters and page to the database and omits what is empty", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await searchOpsUsers({ search: "  ", status: "suspended", role: null, page: 2 });
    expect(rpc).toHaveBeenCalledWith("admin_search_users", {
      p_search: undefined, p_status: "suspended", p_role: undefined,
      p_limit: OPS_USERS_PAGE_SIZE, p_offset: 2 * OPS_USERS_PAGE_SIZE,
    });
  });

  it("derives the status (banned beats suspended), discards an unknown role and reads the total", async () => {
    rpc.mockResolvedValue({
      data: [row(), row({ uid: "u-2", suspended: true }), row({ uid: "u-3", suspended: true, blocked: true }), row({ uid: null })],
      error: null,
    });
    const page = await searchOpsUsers();
    expect(page.total).toBe(3);
    expect(page.users.map((user) => user.status)).toEqual(["active", "suspended", "blocked"]);
    expect(page.users[0].roles).toEqual(["teacher"]);
  });

  it("passes the database refusal through without translating it", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "OPS_ADMIN_MFA_REQUIRED" } });
    await expect(searchOpsUsers()).rejects.toMatchObject({ message: "OPS_ADMIN_MFA_REQUIRED" });
  });
});

describe("getOpsUserDossier", () => {
  it("asks for the dossier by uid and cleans the roles", async () => {
    rpc.mockResolvedValue({ data: { identity: { uid: "u-1", roles: ["admin", "root"] } }, error: null });
    const dossier = await getOpsUserDossier("u-1");
    expect(rpc).toHaveBeenCalledWith("admin_get_user_dossier", { p_uid: "u-1" });
    expect(dossier.identity.roles).toEqual(["admin"]);
  });

  it("signup answers that are not an object become an empty object, and the timeline becomes a list", () => {
    const parsed = parseDossier({ identity: { uid: "u-1", roles: [] }, onboarding: { answers: ["x"] }, timeline: null });
    expect(parsed.onboarding.answers).toEqual({});
    expect(parsed.timeline).toEqual([]);
    const kept = parseDossier({ identity: { uid: "u-1", roles: [] }, onboarding: { answers: { profession: "Coach" } } });
    expect(kept.onboarding.answers).toEqual({ profession: "Coach" });
  });

  it("refuses a response without an identity", () => {
    expect(() => parseDossier({ access: {} })).toThrow("USER_DOSSIER_MALFORMED");
    expect(() => parseDossier(null)).toThrow("USER_DOSSIER_MALFORMED");
  });
});
