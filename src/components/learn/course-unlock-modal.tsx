"use client";

import Image from "next/image";
import Link from "next/link";
import { BookOpen, Lock, X } from "lucide-react";
import { useEffect, useRef, type MouseEvent } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import type { TeacherCourse } from "@/domain/teacher-course";
import { useModalFocus } from "@/lib/a11y/use-modal-focus";

/**
 * Course cover with a designed fallback. A published course with no artwork
 * used to render the brand logo stretched into a 16/10 box, which read as a
 * broken image; the fallback is now a deliberate placeholder carrying the
 * course initial so a row of coverless courses still looks curated.
 */
export function CourseCover({
  course,
  sizes,
}: {
  course: Pick<TeacherCourse, "coverImageUrl" | "title">;
  sizes: string;
}) {
  if (course.coverImageUrl) {
    return (
      <Image
        src={course.coverImageUrl}
        alt={course.title}
        fill
        sizes={sizes}
        className="object-cover"
      />
    );
  }

  return (
    <div
      aria-hidden="true"
      className="absolute inset-0 grid place-items-center bg-[linear-gradient(135deg,var(--color-primary),var(--color-accent))]"
    >
      <BookOpen className="absolute right-3 top-3 text-white/25" size={26} />
      <span className="display-title text-4xl text-white/85">
        {course.title.trim().charAt(0).toUpperCase()}
      </span>
    </div>
  );
}

/**
 * Locked-course popup inside the members area. A student who clicks a padlocked
 * card gets the pitch here instead of losing the dashboard to a full page load;
 * the CTA then hands off to /courses/[id], which owns the real purchase flow
 * (offers, coupons, Stripe). No checkout logic is duplicated here.
 *
 * Also used on the public course page (padlocked lesson) and in the classroom
 * for someone without an enrollment. It only reads public course fields.
 */
export type CourseUnlockModalCourse = Pick<
  TeacherCourse,
  "id" | "title" | "summary" | "category" | "coverImageUrl" | "priceAmountMinor" | "currency"
>;

export function CourseUnlockModal({
  course,
  onClose,
  ctaHref,
  ctaLabel,
  note,
  secondaryLink,
}: {
  course: CourseUnlockModalCourse | null;
  onClose: () => void;
  // Where the buy button goes; defaults to the course page. A "#id" stays on
  // the same page: the popup closes, the page scrolls to that element and
  // focus moves to its main action ([data-cta-focus]), or to the element.
  ctaHref?: string;
  // Button text shown as is. The course page passes its buy card's own label
  // (resolved offer, interval, locale), so the two never disagree on price.
  ctaLabel?: string;
  note?: string;
  secondaryLink?: { href: string; label: string };
}) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);

  useModalFocus(dialogRef, Boolean(course));

  useEffect(() => {
    if (!course) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [course, onClose]);

  if (!course) {
    return null;
  }

  const price =
    typeof course.priceAmountMinor === "number" && course.priceAmountMinor > 0
      ? new Intl.NumberFormat("en", {
          style: "currency",
          currency: course.currency || "USD",
        }).format(course.priceAmountMinor / 100)
      : "";
  const href = ctaHref ?? `/courses/${course.id}`;

  function handleCtaClick(event: MouseEvent<HTMLAnchorElement>) {
    if (!href.startsWith("#")) {
      return;
    }
    // Same page: the buyer never leaves it. Close first so the page can scroll
    // again, then bring the target (the buy card) into view.
    event.preventDefault();
    const target = document.getElementById(href.slice(1));
    onClose();
    // Runs after the modal has handed focus back to its opener, so this wins.
    requestAnimationFrame(() => {
      target?.scrollIntoView?.({ behavior: "smooth", block: "start" });
      const action = target?.querySelector<HTMLElement>("[data-cta-focus]:not([disabled])");
      (action ?? target)?.focus({ preventScroll: true });
    });
  }

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      className="fixed inset-0 z-[70] flex items-stretch justify-center outline-none sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="course-unlock-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-[rgba(15,39,68,0.62)] backdrop-blur-[2px]"
        aria-label={t("learn.paths.close")}
        onClick={onClose}
      />
      <div className="modal-panel relative z-[75] flex w-full max-w-lg flex-col overflow-hidden bg-white shadow-[0_30px_80px_rgba(15,39,68,0.32)] sm:rounded-[8px]">
        <div className="relative aspect-[16/9] w-full overflow-hidden">
          <CourseCover course={course} sizes="(min-width: 640px) 512px, 100vw" />
          <button
            type="button"
            onClick={onClose}
            className="absolute right-3 top-3 grid size-9 place-items-center rounded-full bg-[rgba(15,39,68,0.62)] text-white transition hover:bg-[#102a43] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            aria-label={t("learn.paths.close")}
          >
            <X aria-hidden="true" size={18} strokeWidth={1.8} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
            {course.category}
          </p>
          <h2
            id="course-unlock-title"
            className="display-title mt-1 text-2xl text-[var(--color-primary)]"
          >
            {course.title}
          </h2>
          <p className="mt-3 text-sm leading-7 text-[var(--color-ink-soft)]">
            {course.summary}
          </p>

          <p className="mt-4 flex items-start gap-2 rounded-[10px] bg-[var(--color-surface-soft)] px-3 py-2.5 text-xs leading-6 text-[var(--color-ink-soft)]">
            <Lock aria-hidden="true" size={14} className="mt-1 shrink-0" />
            <span>{note ?? t("learn.paths.unlockNote")}</span>
          </p>

          <Link
            href={href}
            onClick={handleCtaClick}
            className="button-solid mt-5 inline-flex w-full items-center justify-center gap-2 px-4 py-2.5 text-sm"
          >
            <Lock aria-hidden="true" size={15} />
            {ctaLabel
              ?? (price ? `${t("learn.paths.unlock")} - ${price}` : t("learn.paths.unlock"))}
          </Link>
          {secondaryLink ? (
            <Link
              href={secondaryLink.href}
              className="button-outline mt-3 inline-flex w-full items-center justify-center px-4 py-2.5 text-sm"
            >
              {secondaryLink.label}
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
