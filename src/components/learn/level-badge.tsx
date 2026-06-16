import { MAX_LEVEL } from "@/domain/gamification";

/**
 * Compact community level pill (e.g. "Lv 3"), shown next to a member's name on
 * posts, comments, and the leaderboard. Level is derived server-side from
 * cumulative likes received (the Skool-standard 9-level ladder).
 */
export function LevelBadge({
  level,
  className,
}: {
  level: number;
  className?: string;
}) {
  const safeLevel = Math.max(1, Math.min(MAX_LEVEL, Math.round(level)));

  return (
    <span
      className={`inline-flex items-center rounded-[8px] bg-[var(--color-primary)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-white ${
        className ?? ""
      }`}
      title={`Level ${safeLevel} — earned from likes on community posts`}
    >
      Lv {safeLevel}
    </span>
  );
}
