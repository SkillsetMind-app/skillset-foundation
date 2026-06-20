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

  return (
    <section className="rounded-[4px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Trophy size={18} className="text-[var(--color-primary)]" aria-hidden />
          <h3 className="display-title text-3xl text-[var(--color-ink)]">
            Leaderboard
          </h3>
        </div>
        <div className="flex flex-wrap gap-1 rounded-[4px] border fine-rule bg-[var(--color-surface-soft)] p-1">
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

      <div className="mt-5 grid gap-2">
        {!ready ? (
          <p className="text-sm text-[var(--color-ink-soft)]">
            Loading leaderboard...
          </p>
        ) : entries.length === 0 ? (
          <p className="rounded-[4px] border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm leading-7 text-[var(--color-ink-soft)]">
            No points yet for this window. Be the first — post something worth a
            like.
          </p>
        ) : (
          entries.map((entry) => {
            const isCurrent = entry.rank === selfRank;
            return (
              <div
                key={entry.rank}
                className={`flex items-center justify-between gap-3 rounded-[4px] border px-4 py-3 ${
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
        <div className="mt-4 flex items-center justify-between gap-3 rounded-[4px] border border-dashed border-[var(--color-line)] bg-[var(--color-surface-soft)] px-4 py-3">
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
