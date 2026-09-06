import { beforeEach, describe, expect, it, vi } from "vitest";

import SignupPage from "@/app/signup/page";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn<(destination: string) => never>(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

describe("SignupPage preserves the checkout destination", () => {
  const checkout = "/courses/focus/checkout?offer=LAUNCH&priceId=price-1";

  beforeEach(() => {
    mocks.redirect.mockClear();
  });

  it("keeps the selected offer and explicit intent when opening unified signup", async () => {
    await expect(SignupPage({
      searchParams: Promise.resolve({
        path: "student", role: "teacher", returnTo: checkout, external: "discard",
      }),
    })).rejects.toThrow("NEXT_REDIRECT");

    const destination = new URL(mocks.redirect.mock.calls[0][0], "https://skillsetmind.example");
    expect(destination.pathname).toBe("/auth");
    expect(destination.searchParams.get("mode")).toBe("signup");
    expect(destination.searchParams.get("path")).toBe("student");
    expect(destination.searchParams.get("returnTo")).toBe(checkout);
    expect(destination.searchParams.has("external")).toBe(false);
  });

  it("uses the first legacy role and destination values without copying arbitrary parameters", async () => {
    await expect(SignupPage({
      searchParams: Promise.resolve({
        role: ["teacher", "student"],
        returnTo: [checkout, "https://outside.example/checkout"],
        next: "https://outside.example/checkout",
      }),
    })).rejects.toThrow("NEXT_REDIRECT");

    const destination = new URL(mocks.redirect.mock.calls[0][0], "https://skillsetmind.example");
    expect(destination.searchParams.get("path")).toBe("teacher");
    expect(destination.searchParams.get("returnTo")).toBe(checkout);
    expect(destination.searchParams.has("next")).toBe(false);
  });

  it.each(["//outside.example/checkout", "/auth?mode=signin"])(
    "discards an unsafe or looping destination: %s",
    async (returnTo) => {
      await expect(SignupPage({
        searchParams: Promise.resolve({ path: "student", returnTo }),
      })).rejects.toThrow("NEXT_REDIRECT");

      expect(mocks.redirect).toHaveBeenCalledWith("/auth?mode=signup&path=student");
    },
  );
});
