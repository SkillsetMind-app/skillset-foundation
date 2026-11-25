"use client";

import Image from "next/image";
import Link from "next/link";
import { BookOpen, Lock, X } from "lucide-react";
import { useEffect, useRef, type MouseEvent } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import type { TeacherCourse } from "@/domain/teacher-course";
import { useModalFocus } from "@/lib/a11y/use-modal-focus";
import { scrollBehavior } from "@/lib/ui/scroll-behavior";

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

/**
 * The button's verb and the notice come from the price the course already carries. "Unlock" is
 * a word the brand avoids, but swapping it for "Buy" everywhere put "Buy
 * course" on a free course. Paid buys; free enrolls (the same text as the
 * course page); with no known price the neutral "Unlock course" stays. Button and
 * notice come from the same pair, so they never disagree.
 */
export function unlockCopyKeys(priceAmountMinor: number | null | undefined): { label: string; note: string } {
  if (typeof priceAmountMinor !== "number") {
    return { label: "learn.paths.unlock", note: "learn.paths.unlockNote" };
  }
  return priceAmountMinor > 0
    ? { label: "learn.paths.buy", note: "learn.paths.buyNote" }
    : { label: "publicCourses.enrollFree", note: "publicCourses.unlockNoteFree" };
}

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
      target?.scrollIntoView?.({ behavior: scrollBehavior(), block: "start" });
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
        className="dialog-backdrop absolute inset-0"
        aria-label={t("learn.paths.close")}
        onClick={onClose}
      />
      {/* The app's own panel from sm up (on the phone, full screen). The
          bg-white and the border by class stay: inside the classroom it is through these
          names that the background and the thin line pass to the course colors. */}
      <div className="dialog-panel dialog-panel--md modal-panel relative z-[75] flex flex-col overflow-hidden border-[var(--color-line)] bg-white max-sm:rounded-none max-sm:border-0">
        <div className="relative aspect-[16/9] w-full overflow-hidden">
          <CourseCover course={course} sizes="(min-width: 640px) 576px, 100vw" />
          <button
            type="button"
            onClick={onClose}
            // The X of all dialogs (.button-icon, 44px, 8px corner), with
            // a light background because it sits on top of the cover. It was a navy circle only here.
            className="button-icon absolute right-3 top-3 bg-[var(--color-surface)] shadow-[var(--shadow-soft)] hover:bg-[var(--color-surface-soft)]"
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

          <p className="mt-4 flex items-start gap-2 rounded-md bg-[var(--color-surface-soft)] px-3 py-2.5 text-xs leading-6 text-[var(--color-ink-soft)]">
            <Lock aria-hidden="true" size={14} className="mt-1 shrink-0" />
            <span>{note ?? t(unlockCopyKeys(course.priceAmountMinor).note)}</span>
          </p>

          <Link
            href={href}
            onClick={handleCtaClick}
            className="button-solid mt-5 inline-flex w-full items-center justify-center gap-2 px-4 py-2.5 text-sm"
          >
            <Lock aria-hidden="true" size={15} />
            {ctaLabel
              ?? (price
                ? `${t(unlockCopyKeys(course.priceAmountMinor).label)} - ${price}`
                : t(unlockCopyKeys(course.priceAmountMinor).label))}
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
