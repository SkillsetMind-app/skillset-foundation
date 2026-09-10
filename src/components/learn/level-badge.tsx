"use client";

import { useTranslation } from "@/components/i18n/i18n-provider";
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
  const { t, locale } = useTranslation();
  const safeLevel = Math.max(1, Math.min(MAX_LEVEL, Math.round(level)));

  return (
    <span
      className={`inline-flex items-center rounded-[8px] bg-[var(--color-primary)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--color-base)] ${
        className ?? ""
      }`}
      title={t("learnWave2.leaderboard.badgeTitle").replace("{level}", () => new Intl.NumberFormat(locale).format(safeLevel))}
    >
      {t("learnWave2.leaderboard.badge").replace("{level}", () => new Intl.NumberFormat(locale).format(safeLevel))}
    </span>
  );
}
