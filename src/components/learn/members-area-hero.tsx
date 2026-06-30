"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";

export interface MembersAreaHeroProps {
  theme: "light" | "dark";
  coverUrl?: string | null;
  title: string;
  subtitle?: string | null;
  description?: string | null;
  studioName?: string | null;
  studioInitials?: string | null;
  progressPercent?: number | null;
  backHref?: string | null;
}

function deriveInitials(studioName?: string | null): string {
  if (!studioName) return "";
  return studioName
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function MembersAreaHero({
  theme,
  coverUrl,
  title,
  subtitle,
  description,
  studioName,
  studioInitials,
  progressPercent,
  backHref,
}: MembersAreaHeroProps) {
  const [showFullDescription, setShowFullDescription] = useState(false);

  // No-cover fallback monogram: prefer an explicit studio, but always fall back
  // to the title so the art mark is never blank (title is always present).
  const initials =
    studioInitials?.trim() || deriveInitials(studioName) || deriveInitials(title);
  const hasCover = Boolean(coverUrl);
  // Real student progress only — clamp so a stray value never overflows the bar.
  const pct =
    progressPercent == null
      ? null
      : Math.max(0, Math.min(100, Math.round(progressPercent)));

  return (
    <header className="members-hero" data-members-theme={theme}>
      {hasCover ? (
        // eslint-disable-next-line @next/next/no-img-element -- cover is an arbitrary CourseAsset URL, not a build-time import
        <img className="members-hero__cover" src={coverUrl ?? undefined} alt="" />
      ) : (
        <div className="members-hero__art" aria-hidden="true">
          {initials ? (
            <span className="members-hero__art-mark">{initials}</span>
          ) : null}
          {studioName ? (
            <span className="members-hero__art-studio">{studioName}</span>
          ) : null}
        </div>
      )}

      <div className="members-hero__scrim" />

      <div className="members-hero__inner">
        {backHref ? (
          <Link className="members-hero__back" href={backHref}>
            <ArrowLeft size={17} aria-hidden="true" /> Voltar ao painel
          </Link>
        ) : null}

        <h1 className="members-hero__title">{title}</h1>

        {subtitle || studioName ? (
          <p className="members-hero__studio">
            {subtitle ?? <strong>{studioName}</strong>}
          </p>
        ) : null}

        {description ? (
          <>
            <p
              className={
                showFullDescription
                  ? "members-hero__sub members-hero__sub--full"
                  : "members-hero__sub"
              }
            >
              {description}
            </p>
            <button
              type="button"
              className="members-hero__more"
              onClick={() => setShowFullDescription((open) => !open)}
            >
              {showFullDescription ? "Mostrar menos" : "Mostrar mais"}
            </button>
          </>
        ) : null}

        {pct != null ? (
          <div className="members-hero__prog">
            <span className="members-hero__prog-label">
              <strong>{pct}%</strong> concluído
            </span>
            <span className="members-hero__bar">
              <span style={{ width: `${pct}%` }} />
            </span>
          </div>
        ) : null}
      </div>
    </header>
  );
}
