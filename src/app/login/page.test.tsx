import { beforeEach, describe, expect, it, vi } from "vitest";

import LoginPage from "@/app/login/page";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

describe("LoginPage", () => {
  beforeEach(() => {
    mocks.redirect.mockClear();
  });

  it("forwards a protected deep link to the unified sign-in page", async () => {
    await expect(
      LoginPage({
        searchParams: Promise.resolve({
          returnTo: "/learn/courses/focus?lesson=2",
        }),
      }),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(mocks.redirect).toHaveBeenCalledWith(
      "/auth?mode=signin&returnTo=%2Flearn%2Fcourses%2Ffocus%3Flesson%3D2",
    );
  });
});
