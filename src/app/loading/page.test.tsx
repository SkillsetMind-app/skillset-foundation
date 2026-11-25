// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerAccount: vi.fn(),
  redirect: vi.fn((destination: string) => {
    // next/navigation's redirect() never returns: it throws to stop the render.
    throw new Error(`REDIRECT ${destination}`);
  }),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth/server-session", () => ({ getServerAccount: mocks.getServerAccount }));
vi.mock("@/lib/i18n/server", () => ({
  getServerTranslation: async () => ({ t: (key: string) => key }),
}));
vi.mock("@/components/auth/loading-screen", () => ({ LoadingScreen: () => null }));
vi.mock("@/components/shared/skillset-spinner", () => ({ SkillsetSpinner: () => null }));

import LoadingPage from "@/app/loading/page";

// /loading is the hop between signing in and the first workspace page. When
// the server knows who is signed in it must answer with the redirect itself
// (nothing painted); when it does not, the client screen decides as before.

function account(profile: Record<string, unknown>) {
  return {
    user: { uid: "u-1", roles: profile.roles },
    profile: { uid: "u-1", onboardingCompleted: true, roles: ["student"], ...profile },
  };
}

function open(query: Record<string, string | string[]>) {
  return LoadingPage({ searchParams: Promise.resolve(query) });
}

describe("/loading on the server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends an onboarded teacher straight to the studio", async () => {
    mocks.getServerAccount.mockResolvedValue(account({ roles: ["teacher"] }));
    await expect(open({ next: "route" })).rejects.toThrow("REDIRECT /teach");
  });

  it("sends an onboarded learner to their courses", async () => {
    mocks.getServerAccount.mockResolvedValue(account({ roles: ["student"] }));
    await expect(open({ next: "route" })).rejects.toThrow("REDIRECT /learn");
  });

  it("honors the deep link the sign-in wall captured", async () => {
    mocks.getServerAccount.mockResolvedValue(account({ roles: ["student"] }));
    await expect(open({ next: "welcome", returnTo: "/courses/intro?ref=ad" })).rejects.toThrow(
      "REDIRECT /courses/intro?ref=ad",
    );
  });

  it("never follows a link off the site", async () => {
    mocks.getServerAccount.mockResolvedValue(account({ roles: ["student"] }));
    await expect(open({ next: "route", returnTo: "//evil.example/x" })).rejects.toThrow("REDIRECT /learn");
    await expect(open({ next: "route", returnTo: "https://evil.example/x" })).rejects.toThrow("REDIRECT /learn");
  });

  it("takes a first-timer to onboarding with the entry they chose and their deep link", async () => {
    mocks.getServerAccount.mockResolvedValue(account({ onboardingCompleted: false, roles: [] }));
    await expect(open({ next: "welcome", path: "teacher", returnTo: "/courses/intro" })).rejects.toThrow(
      "REDIRECT /welcome?path=teacher&returnTo=%2Fcourses%2Fintro",
    );
  });

  it("reads a repeated query parameter the way the browser does: the first one", async () => {
    mocks.getServerAccount.mockResolvedValue(account({ roles: ["teacher", "student"] }));
    await expect(open({ next: "route", path: ["student", "teacher"] })).rejects.toThrow("REDIRECT /learn");
  });

  it("renders the waiting screen, with no redirect, when the server cannot tell who is signed in", async () => {
    mocks.getServerAccount.mockResolvedValue(null);
    await expect(open({ next: "route" })).resolves.toBeTruthy();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
