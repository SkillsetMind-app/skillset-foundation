import { describe, expect, it } from "vitest";

import { getLoadingRoute } from "@/lib/auth/routing";

describe("getLoadingRoute", () => {
  it("carries the deep link so /loading can honor it after the OAuth round trip", () => {
    expect(
      getLoadingRoute("welcome", "student", "/learn/courses/x?lesson=2"),
    ).toBe(
      "/loading?next=welcome&path=student&returnTo=%2Flearn%2Fcourses%2Fx%3Flesson%3D2",
    );
  });

  it("leaves the URL as before without one", () => {
    expect(getLoadingRoute("welcome", "teacher")).toBe(
      "/loading?next=welcome&path=teacher",
    );
    expect(getLoadingRoute("route", null, null)).toBe("/loading?next=route");
  });
});
