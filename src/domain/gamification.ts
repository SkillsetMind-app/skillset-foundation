/**
 * Community gamification — points & levels.
 *
 * Model (Skool-standard, the reference the product parity backlog names):
 * points come ONLY from likes RECEIVED on your community posts — 1 like = 1
 * point. We deliberately do NOT award points for merely posting/commenting
 * (that would be trivially farmable by spamming); points reflect peer signal.
 * Levels are derived from cumulative all-time points using Skool's published
 * 9-level thresholds.
 *
 * Points are SERVER-AUTHORITATIVE: the `memberStats/{uid}` aggregate is written
 * exclusively by Cloud Functions (the like trigger). Clients can never write
 * points/level — see firestore.rules (`memberStats` write: if false).
 *
 * ⚠️ SOURCE OF TRUTH: `LEVEL_THRESHOLDS` and `levelForPoints` are mirrored in
 * functions/src/index.ts (the award trigger runs server-side and cannot import
 * from this package). Keep both copies in sync — this module is canonical.
 */

// Cumulative points required to REACH each level (index 0 = Level 1).
// Skool's published ladder: L1 0, L2 5, L3 20, L4 65, L5 155, L6 515,
// L7 2015, L8 8015, L9 33015.
export const LEVEL_THRESHOLDS = [
  0, 5, 20, 65, 155, 515, 2015, 8015, 33015,
] as const;

export const MAX_LEVEL = LEVEL_THRESHOLDS.length; // 9

/** Level (1..MAX_LEVEL) for a cumulative all-time point total. */
export function levelForPoints(points: number): number {
  const safe = Number.isFinite(points) && points > 0 ? Math.floor(points) : 0;
  let level = 1;
  for (let index = 0; index < LEVEL_THRESHOLDS.length; index += 1) {
    if (safe >= LEVEL_THRESHOLDS[index]) {
      level = index + 1;
    }
  }
  return level;
}

export type LevelProgress = {
  level: number;
  points: number;
  isMax: boolean;
  currentThreshold: number;
  nextThreshold: number | null;
  pointsIntoLevel: number;
  pointsToNextLevel: number | null;
  percentToNext: number; // 0..100 (100 when max level)
};

/** Progress within the current level — for badges and progress bars. */
export function levelProgress(points: number): LevelProgress {
  const safe = Number.isFinite(points) && points > 0 ? Math.floor(points) : 0;
  const level = levelForPoints(safe);
  const currentThreshold = LEVEL_THRESHOLDS[level - 1];
  const isMax = level >= MAX_LEVEL;
  const nextThreshold = isMax ? null : LEVEL_THRESHOLDS[level];
  const pointsIntoLevel = safe - currentThreshold;
  const pointsToNextLevel = nextThreshold === null ? null : nextThreshold - safe;
  const span = nextThreshold === null ? 0 : nextThreshold - currentThreshold;
  const percentToNext =
    nextThreshold === null || span <= 0
      ? 100
      : Math.max(0, Math.min(100, Math.round((pointsIntoLevel / span) * 100)));

  return {
    level,
    points: safe,
    isMax,
    currentThreshold,
    nextThreshold,
    pointsIntoLevel,
    pointsToNextLevel,
    percentToNext,
  };
}

/**
 * Per-member aggregate. Lives in `memberStats/{uid}` (signed-in read,
 * server-only write). Drives post/comment level badges + the all-time
 * leaderboard.
 */
export type MemberStats = {
  uid: string;
  displayName: string;
  points: number;
  level: number;
  totalLikesReceived: number;
  updatedAt?: unknown;
};

export type LeaderboardWindow = "all-time" | "30d" | "7d";

export const LEADERBOARD_WINDOWS: LeaderboardWindow[] = ["7d", "30d", "all-time"];

export const leaderboardWindowLabels: Record<LeaderboardWindow, string> = {
  "7d": "This week",
  "30d": "This month",
  "all-time": "All time",
};

export type LeaderboardEntry = {
  uid: string;
  displayName: string;
  points: number;
  level: number;
  rank: number;
};

/**
 * Precomputed leaderboard for one window. Lives in `leaderboards/{window}`
 * (signed-in read, server-only write), rebuilt by the scheduled function.
 */
export type Leaderboard = {
  window: LeaderboardWindow;
  entries: LeaderboardEntry[];
  updatedAt?: unknown;
};
