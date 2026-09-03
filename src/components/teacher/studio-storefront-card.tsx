"use client";

import Link from "next/link";
import { ExternalLink, Store } from "lucide-react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { buttonClasses, Card, Eyebrow } from "@/components/ui";
import type { TeacherCourse } from "@/domain/teacher-course";

// "Onde as pessoas me compram?" não tinha resposta na Home: a vitrine pública
// existe em /instructors/{uid} desde sempre, mas o único caminho até ela era o
// editor — o professor nunca via o próprio endereço, nem conseguia abri-lo para
// conferir o que o comprador vê.

export function StudioStorefrontCard({
  uid,
  courses,
  coursesLoaded,
}: {
  uid: string;
  courses: TeacherCourse[];
  coursesLoaded: boolean;
}) {
  const { t } = useTranslation();
  const path = `/instructors/${uid}`;
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
          <span className="grid size-10 shrink-0 place-items-center rounded-[8px] border border-[var(--color-line)] text-[var(--color-primary)]">
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
      </Card>
    </section>
  );
}
