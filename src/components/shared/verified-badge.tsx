"use client";

import Link from "next/link";
import { BadgeCheck } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { brand } from "@/data/brand";
import type { ProfessionalVerification } from "@/domain/user-profile";
import { cn } from "@/lib/cn";

/**
 * Next to the credential of someone without the badge: the text is what the
 * teacher typed, and nobody checked it. With the badge, it does not appear.
 */
export function SelfReportedTag() {
  const { t } = useTranslation();
  return (
    <span className="ml-1.5 whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-muted)]">
      {t("verifiedBadge.selfReported")}
    </span>
  );
}

/**
 * The badge itself: a cut-out outline with a check, using BadgeCheck. Colors in
 * `.verified-seal` (globals.css), which switches in the dark theme.
 *
 * With `label` it becomes an image with an accessible name (cards, where the badge is inside
 * a link and cannot be a button); without, it is decorative.
 */
export function VerifiedSeal({
  size = 16,
  label,
  className,
}: {
  size?: number;
  label?: string;
  className?: string;
}) {
  return (
    <BadgeCheck
      width={size}
      height={size}
      focusable="false"
      fill="var(--seal-ground)"
      stroke="var(--seal-mark)"
      strokeWidth={2}
      data-verified-seal=""
      className={cn("verified-seal shrink-0", className)}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    />
  );
}

/**
 * The badge with the words next to it: the profile button and the offer preview.
 * Font size and weight stay in the inner <span> (`verifiedLabelTextClass`):
 * the unlayered rule `button { font: inherit }` in globals.css beats
 * any font utility put on the <button> itself.
 */
export const verifiedLabelClass =
  "inline-flex min-h-8 items-center gap-1.5 whitespace-nowrap rounded-chip border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1 uppercase tracking-[0.14em] text-[var(--color-accent-fg)]";
export const verifiedLabelTextClass = "text-[11px] font-bold leading-none";

/** Popover sentence: what was checked, and when (date in the page's language). */
export function verificationStatement(
  verification: ProfessionalVerification,
  t: (key: string) => string,
  locale: string,
): string {
  const license = verification.kind === "license";
  const date = verification.verifiedAt ? new Date(verification.verifiedAt) : null;
  const dated = date !== null && !Number.isNaN(date.getTime());
  const key = license
    ? dated ? "verifiedBadge.licenseChecked" : "verifiedBadge.licenseCheckedUndated"
    : dated ? "verifiedBadge.evidenceReviewed" : "verifiedBadge.evidenceReviewedUndated";
  return t(key)
    .replace("{brand}", () => brand.name)
    // UTC: the same day on the server and in the browser, in any time zone.
    .replace("{date}", () =>
      dated ? new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(date) : "",
    );
}

/**
 * "Verified professional": the badge and, next to the name on the profile, the words.
 * `compact` shows only the badge (with an accessible name) where space is short.
 *
 * Opens on click, on touch and on keyboard focus (the phone has no hover); Esc,
 * a click outside or focus leaving close it. The text says literally what was
 * checked and when — never "certified", never the registration number.
 * Cosmetic: nothing here ranks, filters or highlights anyone.
 */
export function VerifiedBadge({
  verification,
  compact = false,
  className,
}: {
  verification: ProfessionalVerification;
  compact?: boolean;
  className?: string;
}) {
  const { t, locale } = useTranslation();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLSpanElement>(null);
  // Focus that came from a pointer (or that we returned ourselves) does not open: what
  // opens in that case is the click, otherwise touch would open and close it instantly.
  const pointerFocus = useRef(false);
  const label = t("verifiedBadge.label");

  // Nothing off screen (AGENTS.md §1): the panel is born centered on the badge and moves
  // inward if it goes past any edge.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel) return;
    const rect = panel.getBoundingClientRect();
    const width = document.documentElement.clientWidth || window.innerWidth;
    const gutter = 8;
    const shift = rect.left < gutter
      ? gutter - rect.left
      : rect.right > width - gutter ? width - gutter - rect.right : 0;
    // In `translate`, not in `transform`: the entrance (motion-drop-in) animates the
    // transform and, if the center lived in it, the panel would jump sideways.
    panel.style.translate = `calc(-50% + ${shift}px) 0`;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== "Escape" || !open) return;
    event.stopPropagation();
    setOpen(false);
    pointerFocus.current = true;
    buttonRef.current?.focus();
    pointerFocus.current = false;
  }

  // Focus that leaves for another element closes. Without relatedTarget (click on the text
  // of the panel, window switch) it stays open; the click outside closes through the effect.
  function onBlur(event: FocusEvent) {
    const next = event.relatedTarget as Node | null;
    if (next && !rootRef.current?.contains(next)) {
      setOpen(false);
      pointerFocus.current = false;
    }
  }

  return (
    <span ref={rootRef} className={cn("relative inline-flex", className)} onKeyDown={onKeyDown} onBlur={onBlur}>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={compact ? label : undefined}
        onPointerDown={() => {
          pointerFocus.current = true;
        }}
        onFocus={() => {
          if (!pointerFocus.current) setOpen(true);
        }}
        onClick={() => {
          // Touch and mouse toggle; Enter/Space from someone who already opened it by focus
          // do not close it by mistake (Esc closes).
          setOpen(pointerFocus.current ? !open : true);
          pointerFocus.current = false;
        }}
        className={
          compact
            ? // The badge is 28px next to the name, but the target is 44px: the
              // ::after grows without pushing the line (the design of the help
              // "?"). It grows to the right, not to the left: the badge sits
              // 2px from the instructor's name, and an equal ring on both sides
              // stole the touch at the end of the name link.
              "relative grid size-7 place-items-center rounded-sm after:absolute after:-inset-y-2 after:-left-0.5 after:-right-3.5 after:content-['']"
            : cn(verifiedLabelClass, "transition-colors duration-[var(--duration-fast)] hover:border-[var(--color-accent)]")
        }
      >
        <VerifiedSeal size={compact ? 16 : 14} />
        {compact ? null : <span className={verifiedLabelTextClass}>{label}</span>}
      </button>

      {open ? (
        <span
          ref={panelRef}
          id={panelId}
          data-verified-popover=""
          style={{ translate: "-50% 0" }}
          className="motion-drop-in absolute block left-1/2 top-full z-30 mt-2 w-72 max-w-[calc(100vw-1rem)] rounded-lg border border-[var(--color-line-strong)] border-t-2 border-t-[var(--color-accent)] bg-[var(--color-surface)] p-4 text-left shadow-[var(--shadow-strong)]"
        >
          <span className="flex items-center gap-2 text-sm font-bold text-[var(--color-primary)]">
            <VerifiedSeal size={16} />
            {label}
          </span>
          <span className="mt-2 block text-sm font-normal normal-case leading-6 tracking-normal text-[var(--color-ink)]">
            {verificationStatement(verification, t, locale)}
          </span>
          <span className="mt-2 block text-xs font-normal normal-case leading-5 tracking-normal text-[var(--color-ink-soft)]">
            {t("verifiedBadge.noClaims")}
          </span>
          <Link
            href="/trust"
            // On touch the link is 44px tall (it was 32px); the top margin
            // shrinks by the same amount.
            className="mt-3 inline-flex min-h-8 items-center text-xs font-semibold normal-case tracking-normal text-[var(--color-primary)] underline underline-offset-4 pointer-coarse:mt-1.5 pointer-coarse:min-h-11"
          >
            {t("verifiedBadge.trustLink")}
          </Link>
        </span>
      ) : null}
    </span>
  );
}
