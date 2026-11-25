"use client";

import Link from "next/link";
import { useId, useState, useSyncExternalStore } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { UserAvatar } from "@/components/shared/user-avatar";
import { VerifiedSeal, verifiedLabelClass, verifiedLabelTextClass } from "@/components/shared/verified-badge";
import { buttonClasses } from "@/components/ui";
import { brand } from "@/data/brand";

/** "Not now" postpones for 21 days; after the 3rd refusal the offer does not come back. */
export const BADGE_OFFER_SNOOZE_MS = 21 * 24 * 60 * 60 * 1000;
export const BADGE_OFFER_MAX_DISMISSALS = 3;

const storageKey = (uid: string) => `skillsetmind.verifiedBadgeOffer.${uid}`;

type OfferMemory = { dismissals: number; snoozedUntil: number };

function readOffer(uid: string): OfferMemory {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey(uid)) ?? "null") as Partial<OfferMemory> | null;
    return {
      dismissals: Number(saved?.dismissals) || 0,
      snoozedUntil: Number(saved?.snoozedUntil) || 0,
    };
  } catch {
    return { dismissals: 0, snoozedUntil: 0 };
  }
}

/** Does the offer show up now? Storage blocked = it shows (and "Not now" lasts for the session). */
export function badgeOfferDue(uid: string, now: number): boolean {
  const memory = readOffer(uid);
  return memory.dismissals < BADGE_OFFER_MAX_DISMISSALS && now >= memory.snoozedUntil;
}

export function snoozeBadgeOffer(uid: string, now: number): void {
  const memory = readOffer(uid);
  try {
    localStorage.setItem(storageKey(uid), JSON.stringify({
      dismissals: memory.dismissals + 1,
      snoozedUntil: now + BADGE_OFFER_SNOOZE_MS,
    }));
  } catch {
    // Storage blocked: it only goes away on this visit.
  }
}

const noSubscription = () => () => {};

/**
  * Offer of the badge on the publish success screen. It blocks nothing: it is a
  * card below the course link, with a preview of the teacher's name already with the
  * badge. Only for whoever did not ask (`none`) or had the request rejected
  * (`rejected`); whoever is under review, in adjustment or approved does not see it, and unknown
  * status (`null`: read failed or did not arrive) does not either.
 *
  * `onDismiss`: where focus goes when "Not now" removes the card.
 *
  * Never promises learners, sales or featured placement: the badge is cosmetic.
 */
export function VerifiedBadgeOffer({
  uid,
  name,
  photoURL,
  verificationStatus,
  onDismiss,
}: {
  uid: string;
  name: string | null;
  photoURL: string | null;
  verificationStatus: string | null;
  onDismiss?: () => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const [dismissed, setDismissed] = useState(false);
  // Server and 1st render: hidden (storage only exists in the browser).
  const due = useSyncExternalStore(noSubscription, () => badgeOfferDue(uid, Date.now()), () => false);

  if (!due || dismissed || (verificationStatus !== "none" && verificationStatus !== "rejected")) {
    return null;
  }

  const displayName = name?.trim() || t("publicPages.profile.fallback_name").replace("{brand}", () => brand.name);

  return (
    <aside
      aria-labelledby={titleId}
      data-verified-badge-offer=""
      // Without the gold strip on the left (card with a colored border on the side and a
      // forbidden pattern): the plain thin border is enough.
      className="mt-4 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4"
    >
      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--color-accent-fg)]">
        {t("verifiedBadge.offer.eyebrow")}
      </p>
      <h3 id={titleId} className="mt-1 text-base font-semibold leading-6 text-[var(--color-primary)]">
        {t("verifiedBadge.offer.title")}
      </h3>
      <p className="mt-1 text-sm leading-6 text-[var(--color-ink-soft)]">{t("verifiedBadge.offer.body")}</p>

      {/* Header preview of the profile: the name itself, already with the badge. */}
      <figure className="mt-3 rounded-md border border-dashed border-[var(--color-line-strong)] bg-[var(--color-surface-soft)] px-3 py-3">
        <figcaption className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-ink-muted)]">
          {t("verifiedBadge.offer.preview")}
        </figcaption>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
          <UserAvatar name={displayName} photoURL={photoURL} size="sm" />
          <span className="display-title min-w-0 truncate text-lg leading-tight text-[var(--color-primary)]">
            {displayName}
          </span>
          <span className={verifiedLabelClass}>
            <VerifiedSeal size={14} />
            <span className={verifiedLabelTextClass}>{t("verifiedBadge.label")}</span>
          </span>
        </div>
      </figure>

      <div className="mt-4 flex flex-wrap gap-2">
        <Link href="/teach/verification" className={buttonClasses({ variant: "solid", size: "sm" }, "min-h-11")}>
          {t("verifiedBadge.offer.cta")}
        </Link>
        <button
          type="button"
          onClick={() => {
            snoozeBadgeOffer(uid, Date.now());
            // Before the button disappears: focus must not fall on the <body>.
            onDismiss?.();
            setDismissed(true);
          }}
          className={buttonClasses({ variant: "ghost", size: "sm" }, "min-h-11")}
        >
          {/* On the <span>: `button { font: inherit }` ignores the button's font. */}
          <span className="text-xs font-semibold">{t("verifiedBadge.offer.notNow")}</span>
        </button>
      </div>
    </aside>
  );
}
