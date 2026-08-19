import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RoleManager } from "@/components/admin/role-manager";

const mocks = vi.hoisted(() => ({
  listPlatformUsers: vi.fn(),
  setUserRoles: vi.fn(),
}));

vi.mock("@/lib/data/platform-roles", () => ({
  listPlatformUsers: mocks.listPlatformUsers,
  setUserRoles: mocks.setUserRoles,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function roster(roles: string[]) {
  return [
    {
      uid: "u-1",
      email: "person@example.com",
      displayName: "Test Person",
      roles,
      verificationStatus: null,
      createdAt: "2026-01-01",
    },
  ];
}

describe("RoleManager", () => {
  it("writes all three staff roles when Team is switched on", async () => {
    // Team is one checkbox over three roles. If the mapping ever collapses to a
    // single role, this user silently loses two thirds of their access.
    mocks.listPlatformUsers.mockResolvedValue(roster(["student"]));
    mocks.setUserRoles.mockResolvedValue(["moderator", "ops", "student", "support"]);

    render(<RoleManager />);

    const team = await screen.findByLabelText("Team");
    fireEvent.click(team);

    await waitFor(() => expect(mocks.setUserRoles).toHaveBeenCalledTimes(1));
    const [uid, nextRoles] = mocks.setUserRoles.mock.calls[0];
    expect(uid).toBe("u-1");
    expect([...nextRoles].sort()).toEqual([
      "moderator",
      "ops",
      "student",
      "support",
    ]);
  });

  it("shows the database's own sentence when it refuses a change", async () => {
    // The last-admin and self-lockout guards live in SQL. Their wording is the
    // only thing that explains WHY a click did nothing, so it must reach the
    // screen instead of being swallowed by a generic failure message.
    mocks.listPlatformUsers.mockResolvedValue(roster(["admin"]));
    mocks.setUserRoles.mockRejectedValue(
      new Error("You cannot remove your own admin role."),
    );

    render(<RoleManager />);

    const admin = await screen.findByLabelText("Admin");
    fireEvent.click(admin);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("You cannot remove your own admin role.");
  });
});
