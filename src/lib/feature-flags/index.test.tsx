import { describe, expect, it } from "vitest";

import {
  createFeatureFlags,
  defaultFeatureFlags,
  featureFlagKeys,
  getFeatureFlagDefinition,
  getFeatureFlagsByArea,
  isFeatureEnabled,
  isFeatureFlagKey,
} from "./index";

describe("feature flags", () => {
  it("exposes typed flag definitions for each product area", () => {
    expect(getFeatureFlagsByArea("auth").map((flag) => flag.key)).toEqual([
      "auth.emailPassword",
      "auth.passwordReset",
      "auth.mfa",
    ]);
    expect(getFeatureFlagsByArea("firebaseIntegration")[0]).toMatchObject({
      area: "firebaseIntegration",
      defaultEnabled: true,
    });
  });

  it("creates a complete flag state with safe defaults and overrides", () => {
    const flags = createFeatureFlags({
      "payments.checkout": true,
      "community.discussions": false,
    });

    expect(flags["auth.emailPassword"]).toBe(true);
    expect(flags["payments.checkout"]).toBe(true);
    expect(flags["community.discussions"]).toBe(false);
  });

  it("evaluates partial snapshots against defaults", () => {
    expect(isFeatureEnabled(undefined, "payments.checkout")).toBe(false);
    expect(isFeatureEnabled({ "payments.checkout": true }, "payments.checkout")).toBe(
      true,
    );
    expect(isFeatureEnabled({}, "community.spaces")).toBe(
      defaultFeatureFlags["community.spaces"],
    );
  });

  it("guards known flag keys for runtime inputs", () => {
    expect(isFeatureFlagKey("teacherStudio.courseBuilder")).toBe(true);
    expect(isFeatureFlagKey("missing.flag")).toBe(false);
    expect(getFeatureFlagDefinition(featureFlagKeys[0])?.key).toBe(
      featureFlagKeys[0],
    );
  });
});
