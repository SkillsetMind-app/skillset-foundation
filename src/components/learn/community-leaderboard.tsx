"use client";

import { useEffect, useState } from "react";
import { Trophy } from "lucide-react";

import { LevelBadge } from "@/components/learn/level-badge";
import type {
  Leaderboard,
  LeaderboardWindow,
  MemberStats,
} from "@/domain/gamification";
import {
  LEADERBOARD_WINDOWS,
  leaderboardWindowLabels,
  levelProgress,
} from "@/domain/gamification";
import { subscribeToLeaderboard } from "@/lib/data/gamification";

/**
 * Community leaderboard tab — ranks members by points earned (likes received)
 * within the selected window (this week / this month / all time). Rankings are
 * precomputed server-side (the scheduled rebuildLeaderboards job) and read live
 * from leaderboards/{window}.
 */
export function CommunityLeaderboard({
  currentUserStats,
}: {
  currentUserStats: MemberStats | null;
}) {
  const [window, setWindow] = useState<LeaderboardWindow>("7d");
  const [boardState, setBoardState] = useState<{
    window: LeaderboardWindow;
    board: Leaderboard | null;
    ready: boolean;
  }>({ window: "7d", board: null, ready: false });
  const [error, setError] = useState("");

  useEffect(() => {
    return subscribeToLeaderboard(
      window,
      (board) => setBoardState({ window, board, ready: true }),
      () => {
        setError("We could not load the leaderboard.");
        setBoardState({ window, board: null, ready: true });
      },
    );
  }, [window]);

  const ready = boardState.ready && boardState.window === window;
  const entries =
    boardState.window === window ? boardState.board?.entries ?? [] : [];
  // Entries no longer carry a uid (it leaked the global top list's identities),
  // so the viewer is matched by their own displayName + level. That pair is NOT
  // unique — default display names ("Member") collide — so we only tag a row
  // "You" when EXACTLY ONE entry matches. An ambiguous match would mislabel a
  // stranger's row as the viewer; instead we fall back to the dashed summary
  // "You" row below (rendered when currentUserInTop is false).
  const selfMatches = currentUserStats
    ? entries.filter(
        (entry) =>
          entry.displayName === currentUserStats.displayName &&
          entry.level === currentUserStats.level,
      )
    : [];
  const selfRank = selfMatches.length === 1 ? selfMatches[0].rank : null;
  const currentUserInTop = selfRank !== null;
  // The viewer's own standing. Derived from their all-time points, which the
  // leaderboard windows do not expose — a "7d" board says nothing about how
  // close you are to the next level, so this is read from member_stats and is
  // independent of the selected window.
  const progress = currentUserStats
    ? levelProgress(currentUserStats.points)
    : null;

  return (
    <section className="rounded-[14px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Trophy size={18} className="text-[var(--color-primary)]" aria-hidden />
          <h3 className="display-title text-3xl text-[var(--color-ink)]">
            Leaderboard
          </h3>
        </div>
        <div className="flex flex-wrap gap-1 rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-1">
          {LEADERBOARD_WINDOWS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setWindow(option)}
              className={`rounded-[8px] px-3 py-1.5 text-xs font-semibold transition-colors ${
                window === option
                  ? "bg-[var(--color-primary)] text-[var(--color-base)]"
                  : "text-[var(--color-ink-soft)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-ink)]"
              }`}
            >
              {leaderboardWindowLabels[option]}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-3 text-sm leading-7 text-[var(--color-ink-soft)]">
        Earn points when members like your posts — 1 like = 1 point. Levels rise
        as your points grow.
      </p>

      {progress ? (
        <div className="mt-4 rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <LevelBadge level={progress.level} />
              <p className="text-sm font-semibold text-[var(--color-ink)]">
                Your level
              </p>
            </div>
            <p className="text-xs font-semibold tabular-nums text-[var(--color-ink-soft)]">
              {progress.isMax
                ? "Top level reached"
                : `${progress.pointsToNextLevel} ${
                    progress.pointsToNextLevel === 1 ? "pt" : "pts"
                  } to Level ${progress.level + 1}`}
            </p>
          </div>
          <div
            role="progressbar"
            aria-valuenow={progress.percentToNext}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={
              progress.isMax
                ? `Level ${progress.level}, top level reached`
                : `Level ${progress.level}, ${progress.percentToNext}% toward Level ${progress.level + 1}`
            }
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--color-line)]"
          >
            <div
              className="h-full rounded-full bg-[var(--color-primary)] transition-[width] duration-300"
              style={{ width: `${progress.percentToNext}%` }}
            />
          </div>
        </div>
      ) : null}

      <div className="mt-5 grid gap-2">
        {!ready ? (
          <p className="text-sm text-[var(--color-ink-soft)]">
            Loading leaderboard...
          </p>
        ) : entries.length === 0 ? (
          <p className="rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm leading-7 text-[var(--color-ink-soft)]">
            No points yet for this window. Be the first — post something worth a
            like.
          </p>
        ) : (
          entries.map((entry) => {
            const isCurrent = entry.rank === selfRank;
            return (
              <div
                key={entry.rank}
                className={`flex items-center justify-between gap-3 rounded-[14px] border px-4 py-3 ${
                  isCurrent
                    ? "border-[var(--color-primary)] bg-[var(--color-surface-soft)]"
                    : "border-[var(--color-line)] bg-white"
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="w-6 text-sm font-bold tabular-nums text-[var(--color-ink-soft)]">
                    {entry.rank}
                  </span>
                  <p className="text-sm font-semibold text-[var(--color-ink)]">
                    {isCurrent ? "You" : entry.displayName}
                  </p>
                  <LevelBadge level={entry.level} />
                </div>
                <p className="text-sm font-semibold tabular-nums text-[var(--color-primary)]">
                  {entry.points} {entry.points === 1 ? "pt" : "pts"}
                </p>
              </div>
            );
          })
        )}
      </div>

      {ready && currentUserStats && !currentUserInTop ? (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-[14px] border border-dashed border-[var(--color-line)] bg-[var(--color-surface-soft)] px-4 py-3">
          <div className="flex items-center gap-3">
            <p className="text-sm font-semibold text-[var(--color-ink)]">You</p>
            <LevelBadge level={currentUserStats.level} />
          </div>
          <p className="text-sm font-semibold tabular-nums text-[var(--color-ink-soft)]">
            {currentUserStats.points}{" "}
            {currentUserStats.points === 1 ? "pt" : "pts"} all-time
          </p>
        </div>
      ) : null}

      {error ? (
        <p className="mt-3 text-xs font-semibold text-[var(--color-accent-fg)]">
          {error}
        </p>
      ) : null}
    </section>
  );
}
