import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MemberAreaShell } from "@/components/learn/member-area-shell";

// The classroom uses this shell (no sidebar) and it had no bell: the
// messages panel said "the reply lands in the bell" on a screen where the bell did not
// exist. Same component as the platform, same list of notices.

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    status: "authenticated",
    user: {
      uid: "student-1",
      email: "student@example.com",
      displayName: "Student",
      emailVerified: true,
      photoURL: null,
      roles: ["student"],
    },
  }),
}));

vi.mock("@/components/i18n/i18n-provider", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@/lib/data/user-profiles", () => ({
  subscribeToUserProfile: () => () => {},
}));

vi.mock("@/lib/data/notifications", () => ({
  subscribeToNotifications: vi.fn((_uid, onNext) => {
    onNext([]);
    return vi.fn();
  }),
  markNotificationAsRead: vi.fn(),
  markAllNotificationsAsRead: vi.fn(),
}));

// With an identity t(), the bell's accessible name is the key itself.
const bellName = /platform\.notifications\.open/;

describe("the bell in the members area bar", () => {
  it("shows up in the platform bar — alone: the classroom exit lives in the cover/header", () => {
    render(
      <MemberAreaShell>
        <p>Lesson</p>
      </MemberAreaShell>,
    );

    expect(screen.getByRole("button", { name: bellName })).toBeInTheDocument();
    // "Exit to dashboard" was the third exit to /learn (reanalysis item 8).
    expect(screen.queryByText("Exit to dashboard")).toBeNull();
  });

  // Before, the bell was left out of the teacher-branded area, and that area's learner
  // never knew the teacher had replied (the messages panel says
  // the reply "lands in the bell"). Now it shows up in both modes.
  it("also shows up in the teacher-branded area", () => {
    render(
      <MemberAreaShell brand={{ name: "Atelier Curie" }}>
        <p>Lesson</p>
      </MemberAreaShell>,
    );

    expect(screen.getByRole("button", { name: bellName })).toBeInTheDocument();
  });
});
