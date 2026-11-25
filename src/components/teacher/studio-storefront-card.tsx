"use client";

import Link from "next/link";
import { Store } from "lucide-react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { VerifiedSeal } from "@/components/shared/verified-badge";
import { buttonClasses, Card, Eyebrow } from "@/components/ui";
import type { TeacherCourse } from "@/domain/teacher-course";
import { useStorefrontPath } from "@/components/teacher/use-storefront-path";

// "Where do people buy from me?" had no answer on Home: the public storefront
// has always existed at /instructors/{uid}, but the only path to it was the
// editor — the teacher never saw their own address, nor could open it to
// check what the buyer sees.

export function StudioStorefrontCard({
  uid,
  courses,
  coursesLoaded,
  verificationStatus,
}: {
  uid: string;
  courses: TeacherCourse[];
  coursesLoaded: boolean;
  /** Badge status; null/undefined = unknown (the row does not appear). */
  verificationStatus?: string | null;
}) {
  const { t } = useTranslation();
  const path = useStorefrontPath(uid);
  const published = courses.filter((course) => course.status === "published").length;
  // With nothing published the storefront exists but is empty: saying "it is live" would be
  // a lie, so the card tells the person to publish instead of telling them to visit.
  const isLive = published > 0;

  return (
    <section aria-labelledby="studio-storefront-title">
      <Eyebrow>{t("teach.storefrontCard.eyebrow")}</Eyebrow>
      <h2
        id="studio-storefront-title"
        className="mt-1 text-xl font-semibold text-[var(--color-primary)]"
      >
        {t("teach.storefrontCard.title")}
      </h2>

      <Card className="mt-4" padding="md">
        <div className="flex flex-wrap items-start gap-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-md border border-[var(--color-line)] text-[var(--color-primary)]">
            <Store aria-hidden="true" size={18} strokeWidth={1.8} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="break-all font-mono text-sm font-semibold text-[var(--color-ink)]">
              {path}
            </p>
            <p className="mt-1 text-sm leading-6 text-[var(--color-ink-soft)]">
              {!coursesLoaded
                ? t("teach.storefrontCard.loading")
                : isLive
                  ? t(
                      published === 1
                        ? "teach.storefrontCard.liveSingular"
                        : "teach.storefrontCard.livePlural",
                    ).replace("{count}", String(published))
                  : t("teach.storefrontCard.empty")}
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href={path}
            className={buttonClasses({ variant: "outline", size: "sm" })}
          >
            {t("teach.storefrontCard.open")}
          </Link>
          {/* Outline, not solid: on Home the strong button is the next action's
              (the open step or "Create my first product"), not the storefront. */}
          <Link
            href="/teach/storefront"
            className={buttonClasses({ variant: "outline", size: "sm" })}
          >
            {t("teach.storefrontCard.edit")}
          </Link>
        </div>

        {/* Fixed spot for the badge: after 3 "Not now" on the offer, it is only here.
            Only for those who can ask; unknown status offers nothing. */}
        {verificationStatus === "none" || verificationStatus === "rejected" ? (
          <div data-verified-badge-slot="" className="mt-4 border-t border-[var(--color-line)] pt-3 text-sm">
            <Link
              href="/teach/verification"
              className="inline-flex min-h-11 items-center gap-2 font-semibold text-[var(--color-primary)] underline-offset-4 hover:underline"
            >
              <VerifiedSeal size={14} />
              {t("verifiedBadge.slot.offer")}
            </Link>
          </div>
        ) : null}
      </Card>
    </section>
  );
}
