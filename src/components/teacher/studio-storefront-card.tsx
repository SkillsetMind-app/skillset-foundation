"use client";

import Link from "next/link";
import { ExternalLink, Store } from "lucide-react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { VerifiedSeal } from "@/components/shared/verified-badge";
import { buttonClasses, Card, Eyebrow } from "@/components/ui";
import type { TeacherCourse } from "@/domain/teacher-course";
import { useStorefrontPath } from "@/components/teacher/use-storefront-path";

// "Onde as pessoas me compram?" não tinha resposta na Home: a vitrine pública
// existe em /instructors/{uid} desde sempre, mas o único caminho até ela era o
// editor — o professor nunca via o próprio endereço, nem conseguia abri-lo para
// conferir o que o comprador vê.

export function StudioStorefrontCard({
  uid,
  courses,
  coursesLoaded,
  verificationStatus,
}: {
  uid: string;
  courses: TeacherCourse[];
  coursesLoaded: boolean;
  /** Status do selo; null/undefined = desconhecido (a linha não aparece). */
  verificationStatus?: string | null;
}) {
  const { t } = useTranslation();
  const path = useStorefrontPath(uid);
  const published = courses.filter((course) => course.status === "published").length;
  // Sem nada publicado a vitrine existe mas está vazia: dizer "está no ar" seria
  // mentira, então o cartão manda publicar em vez de mandar visitar.
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
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClasses({ variant: "outline", size: "sm" })}
          >
            {t("teach.storefrontCard.open")}
            <ExternalLink aria-hidden="true" size={14} strokeWidth={1.9} />
            <span className="sr-only">{t("platform.opensInNewTab")}</span>
          </Link>
          <Link
            href="/teach/storefront"
            className={buttonClasses({ variant: "solid", size: "sm" })}
          >
            {t("teach.storefrontCard.edit")}
          </Link>
        </div>

        {/* Lugar fixo do selo: depois de 3 "Agora não" na oferta, é só aqui.
            Só para quem pode pedir; status desconhecido não oferece nada. */}
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
