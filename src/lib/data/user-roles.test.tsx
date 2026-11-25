import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseMocks = vi.hoisted(() => ({
  getSupabaseBrowserClient: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowserClient: supabaseMocks.getSupabaseBrowserClient,
}));

import { updateUserRoles } from "@/lib/data/user-profiles";

// Builds a fake Supabase client that records the update payload and returns
// the current roles on the read.
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

describe("updateUserRoles — onboarding adds roles, never removes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // The real case: the platform tells the user to "update the onboarding" when
  // they hit a screen without permission. A teacher accepted the default in the three
  // steps and came back without the Teacher Studio, with no notice at all.
  it("keeps teacher when onboarding sends only student", async () => {
    const { client, captured } = buildClient(["student", "teacher"]);
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(client);

    await updateUserRoles("teacher-1", ["student"]);

    expect(captured.roles).toEqual(expect.arrayContaining(["student", "teacher"]));
  });

  it("adds teacher to someone who was only student", async () => {
    const { client, captured } = buildClient(["student"]);
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(client);

    await updateUserRoles("student-1", ["teacher"]);

    expect(captured.roles).toEqual(expect.arrayContaining(["student", "teacher"]));
  });

  it("does not duplicate a role already present", async () => {
    const { client, captured } = buildClient(["student", "teacher"]);
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(client);

    await updateUserRoles("teacher-1", ["teacher"]);

    const roles = captured.roles as string[];
    expect(new Set(roles).size).toBe(roles.length);
  });

  // Privileged roles are not self-assignable: the users_field_guard trigger
  // refuses any value outside {student, teacher}. Sending them in the payload would make
  // the whole write fail and the user would also lose the legitimate change.
  it("discards privileged roles that are on the row", async () => {
    const { client, captured } = buildClient(["student", "admin", "ops"]);
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(client);

    await updateUserRoles("admin-1", ["teacher"]);

    expect(captured.roles).not.toContain("admin");
    expect(captured.roles).not.toContain("ops");
    expect(captured.roles).toEqual(expect.arrayContaining(["student", "teacher"]));
  });

  it("tolerates missing or malformed roles without erasing what was requested", async () => {
    const { client, captured } = buildClient(null);
    supabaseMocks.getSupabaseBrowserClient.mockReturnValue(client);

    await updateUserRoles("novo", ["student"]);

    expect(captured.roles).toEqual(["student"]);
  });
});
