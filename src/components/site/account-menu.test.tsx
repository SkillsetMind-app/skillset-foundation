import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AccountMenu } from "@/components/site/account-menu";

const mocks = vi.hoisted(() => ({
  pathname: "/learn",
  subscribeToUserProfile: vi.fn(() => () => {}),
}));

vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));

vi.mock("@/lib/data/user-profiles", () => ({
  subscribeToUserProfile: mocks.subscribeToUserProfile,
}));

function openMenu(roles: string[], pathname: string) {
  mocks.pathname = pathname;
  render(
    <AccountMenu
      user={
        {
          uid: "u-1",
          email: "person@example.com",
          displayName: "Test Person",
          roles,
        } as never
      }
      onSignOut={async () => {}}
    />,
  );
  fireEvent.click(screen.getByRole("button"));
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("workspace switcher in the account menu", () => {
  it("offers an admin who also teaches both of their other workspaces", () => {
    // The founder holds admin and teacher on one account. Staff used to be
    // excluded from the switcher outright, so he had no way into his own
    // studio from the menu — the bug this exists to prevent coming back.
    openMenu(["admin", "teacher"], "/learn");

    expect(screen.getByRole("link", { name: /teacher view/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /operations view/i })).toBeInTheDocument();
  });

  it("hides the workspace you are already in", () => {
    // Otherwise it is a list of links, not a toggle.
    openMenu(["admin", "teacher"], "/teach");

    expect(screen.queryByRole("link", { name: /teacher view/i })).toBeNull();
    expect(screen.getByRole("link", { name: /student view/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /operations view/i })).toBeInTheDocument();
  });

  it("matches a workspace by its subpaths too", () => {
    openMenu(["admin", "teacher"], "/teach/courses/abc");

    expect(screen.queryByRole("link", { name: /teacher view/i })).toBeNull();
  });

  it("offers no studio to someone who does not teach, only the application", () => {
    openMenu(["student"], "/learn");

    expect(screen.queryByRole("link", { name: /teacher view/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /operations view/i })).toBeNull();
    expect(
      screen.getByRole("link", { name: /become a teacher/i }),
    ).toBeInTheDocument();
  });

  it("offers no operations to a teacher who is not an admin", () => {
    openMenu(["teacher"], "/teach");

    expect(screen.queryByRole("link", { name: /operations view/i })).toBeNull();
    expect(screen.getByRole("link", { name: /student view/i })).toBeInTheDocument();
  });
});
