"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { ProgressBar } from "@/components/ui/progress-bar";

export interface MembersAreaHeroProps {
  theme: "light" | "dark";
  coverUrl?: string | null;
  title: string;
  subtitle?: string | null;
  description?: string | null;
  studioName?: string | null;
  studioInitials?: string | null;
  progressPercent?: number | null;
  /** "N of M lessons · X%" next to the bar (Hotmart parity). Without both, the
   *  line stays "X% complete" as it always was. */
  completedCount?: number | null;
  totalCount?: number | null;
  /** Only shows at 100%: whoever finished sees the certificate right in the hero,
   *  not only in the credentials tab. null (whitelabel, preview) = nothing. */
  certificateHref?: string | null;
  backHref?: string | null;
  /** The cover's main action: "Start lesson 1" or "Continue: <lesson>". The room
   *  already knows which lesson to open; the hero only draws the button. */
  primaryAction?: { href: string; label: string } | null;
  /** Where the "back" leads. On the room's About tab it goes up ONE level — to
   *  the lesson — instead of leaving the whole course. */
  backTo?: "courses" | "lesson";
  /** Label of the "back" when it leads somewhere else (the creator's area). */
  backLabel?: string | null;
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
  primaryAction,
  backTo = "courses",
  backLabel = null,
}: MembersAreaHeroProps) {
  const { t } = useTranslation();
  const [showFullDescription, setShowFullDescription] = useState(false);
  // "Show more" only when the description is actually clipped at 2 lines. Before,
  // the button appeared even under a one-line sentence. It measures closed: once
  // before the first paint (layout effect, so the button does not flicker) and
  // again when the box changes size (screen width) or the font finishes
  // loading (the line break changes). Open does not measure: there the text always
  // fits, and "Show less" has to stay.
  const descriptionId = useId();
  const descriptionRef = useRef<HTMLParagraphElement>(null);
  const [descriptionClamped, setDescriptionClamped] = useState(false);
  useLayoutEffect(() => {
    const element = descriptionRef.current;
    if (!element) return;
    const measure = () => {
      if (element.classList.contains("members-hero__sub--full")) return;
      setDescriptionClamped(element.scrollHeight > element.clientHeight + 1);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element);
    let active = true;
    void document.fonts?.ready.then(() => {
      if (active) measure();
    });
    return () => {
      active = false;
      observer?.disconnect();
    };
  }, [description]);

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
            {backLabel
              ?? (backTo === "lesson"
                ? t("learn.membersHero.backToLesson")
                : t("learn.membersHero.back"))}
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
              id={descriptionId}
              ref={descriptionRef}
              className={
                showFullDescription
                  ? "members-hero__sub members-hero__sub--full"
                  : "members-hero__sub"
              }
            >
              {description}
            </p>
            {descriptionClamped ? (
              <button
                type="button"
                className="members-hero__more"
                aria-expanded={showFullDescription}
                aria-controls={descriptionId}
                onClick={() => setShowFullDescription((open) => !open)}
              >
                {showFullDescription
                  ? t("learn.membersHero.showLess")
                  : t("learn.membersHero.showMore")}
              </button>
            ) : null}
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
            {/* The house bar (ui/progress-bar): the light track over the photo
                comes from .members-hero__bar, the fill in the course accent. */}
            <ProgressBar
              value={pct}
              label={t("learn.paths.percentComplete").replace("{percent}", () => String(pct))}
              className="members-hero__bar"
              fillClassName="bg-[var(--ma-accent)]"
            />
          </div>
        ) : null}

        {/* Finished the course: the main action is the certificate. Same label as the
            tab bar and the last-lesson button. button-solid: the room's
            primary button (course color, shadow, rises 1px on hover in 180ms);
            before it only changed color, without the feedback of the other buttons. */}
        {pct === 100 && certificateHref ? (
          <Link className="members-hero__cta button-solid" href={certificateHref}>
            {t("learn.classroom.workspace.certificate")}
          </Link>
        ) : primaryAction ? (
          <Link className="members-hero__cta button-solid" href={primaryAction.href}>
            {primaryAction.label}
          </Link>
        ) : null}
      </div>
    </header>
  );
}
