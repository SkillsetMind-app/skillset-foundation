import { describe, expect, it } from "vitest";

import {
  LEVEL_THRESHOLDS,
  MAX_LEVEL,
  levelForPoints,
  levelProgress,
} from "@/domain/gamification";

// The ladder is duplicated by the out-of-repo award job (see the SOURCE OF
// TRUTH note in gamification.ts), so these assertions are also the contract
// that copy has to match.
describe("levelForPoints", () => {
  it("floors junk input to level 1 instead of NaN", () => {
    expect(levelForPoints(0)).toBe(1);
    expect(levelForPoints(-40)).toBe(1);
    expect(levelForPoints(Number.NaN)).toBe(1);
  });

  it("levels up exactly at the threshold, not one point early", () => {
    expect(levelForPoints(4)).toBe(1);
    expect(levelForPoints(5)).toBe(2);
    expect(levelForPoints(19)).toBe(2);
    expect(levelForPoints(20)).toBe(3);
  });

  it("caps at the top level", () => {
    expect(levelForPoints(LEVEL_THRESHOLDS[MAX_LEVEL - 1])).toBe(MAX_LEVEL);
    expect(levelForPoints(999_999)).toBe(MAX_LEVEL);
  });
});

describe("levelProgress", () => {
  it("reports the distance to the next level", () => {
    // Level 2 spans 5..19, so 12 points is 7 into a 15-point band.
    const progress = levelProgress(12);
    expect(progress.level).toBe(2);
    expect(progress.pointsIntoLevel).toBe(7);
    expect(progress.pointsToNextLevel).toBe(8);
    expect(progress.percentToNext).toBe(47);
    expect(progress.isMax).toBe(false);
  });

  it("starts a fresh level at 0%", () => {
    expect(levelProgress(5).percentToNext).toBe(0);
    expect(levelProgress(0).percentToNext).toBe(0);
  });

  it("shows a full bar and no next target at max level", () => {
    const progress = levelProgress(LEVEL_THRESHOLDS[MAX_LEVEL - 1] + 500);
    expect(progress.level).toBe(MAX_LEVEL);
    expect(progress.isMax).toBe(true);
    expect(progress.nextThreshold).toBeNull();
    expect(progress.pointsToNextLevel).toBeNull();
    expect(progress.percentToNext).toBe(100);
  });
});
