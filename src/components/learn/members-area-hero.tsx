"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";

export interface MembersAreaHeroProps {
  theme: "light" | "dark";
  coverUrl?: string | null;
  title: string;
  subtitle?: string | null;
  description?: string | null;
  studioName?: string | null;
  studioInitials?: string | null;
  progressPercent?: number | null;
  /** "N de M aulas · X%" junto da barra (paridade Hotmart). Sem os dois, a
   *  linha continua "X% complete" como sempre foi. */
  completedCount?: number | null;
  totalCount?: number | null;
  /** So aparece com 100%: quem terminou ve o certificado no proprio hero,
   *  nao so na aba de credenciais. null (whitelabel, preview) = nada. */
  certificateHref?: string | null;
  backHref?: string | null;
  /** Para onde o "voltar" leva. Na aba About da sala ele sobe UM nivel — para
   *  a aula — em vez de sair do curso inteiro. */
  backTo?: "courses" | "lesson";
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
  completedCount,
  totalCount,
  certificateHref,
  backHref,
  backTo = "courses",
}: MembersAreaHeroProps) {
  const { t } = useTranslation();
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
            <ArrowLeft size={17} aria-hidden="true" />{" "}
            {backTo === "lesson"
              ? t("learn.membersHero.backToLesson")
              : t("learn.membersHero.back")}
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
              {showFullDescription
                ? t("learn.membersHero.showLess")
                : t("learn.membersHero.showMore")}
            </button>
          </>
        ) : null}

        {pct != null ? (
          <div className="members-hero__prog">
            <span className="members-hero__prog-label">
              {completedCount != null && totalCount != null ? (
                t("learn.membersHero.progress")
                  .replace("{completed}", () => String(completedCount))
                  .replace("{total}", () => String(totalCount))
                  .replace("{percent}", () => String(pct))
              ) : (
                <>
                  <strong>{pct}%</strong> {t("learn.membersHero.complete")}
                </>
              )}
            </span>
            <span className="members-hero__bar">
              <span style={{ width: `${pct}%` }} />
            </span>
          </div>
        ) : null}

        {pct === 100 && certificateHref ? (
          <Link className="members-hero__cta" href={certificateHref}>
            {t("learn.membersHero.certificate")}
          </Link>
        ) : null}
      </div>
    </header>
  );
}
