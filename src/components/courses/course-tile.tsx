"use client";

import { getCourseCategoryLabel } from "@/lib/i18n/course-categories";

import { useTranslation } from "@/components/i18n/i18n-provider";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Star } from "lucide-react";
import type { ReactNode } from "react";

import { UserAvatar } from "@/components/shared/user-avatar";
import type { CourseCard } from "@/lib/data/catalog";

/**
 * O UNICO selo do cartao, e so quando ha o que dizer.
 *
 * "Published" saiu: e o estado interno do curso, nao uma informacao de compra
 * — todo curso do catalogo esta publicado, entao o selo nao separava nada.
 */
export function courseCardBadge(card: CourseCard): string | null {
  if (card.freePreviewHref) return "Free preview";
  if (!card.ratingCount) return "New";
  return null;
}

/**
 * O cartao de curso. UM so, para as tres telas que mostram curso em lista:
 * home (FeaturedCourses), catalogo (CourseMarketplace) e vitrine do professor
 * (InstructorProfileView).
 *
 * Antes eram tres desenhos diferentes para a mesma coisa: na home o cartao
 * inteiro era link, no catalogo so o botao navegava (e o preco aparecia duas
 * vezes, com dois selos e dois botoes de tamanhos diferentes), na vitrine so a
 * capa navegava. Quem procurava curso aprendia a clicar em tres lugares
 * diferentes conforme a pagina.
 *
 * Regras que o componente garante:
 * - o cartao inteiro e link (link esticado a partir do titulo);
 * - o preco aparece UMA vez, no rodape;
 * - no maximo UM selo, e so quando ha o que dizer;
 * - resumo cortado em duas linhas em qualquer tela.
 */
export type CourseTileProps = {
  courseData?: Pick<CourseCard, "lessonCount" | "priceAmountMinor" | "currency" | "freePreviewHref" | "ratingCount" | "ownerId">;
  href: string;
  title: string;
  image: string;
  summary?: string;
  /** Categoria e dados curtos: viram a linha "Categoria · 8 aulas". */
  category?: string;
  meta?: string;
  /** No maximo um. "Published" nao e selo: e vocabulario interno. */
  badge?: string | null;
  priceLabel?: string;
  rating?: { average: number; count: number } | null;
  instructor?: { name: string; photoURL?: string | null } | null;
  actionLabel?: string;
  /** Botao de salvar e afins. Fica acima do link esticado pelo z-index. */
  overlay?: ReactNode;
  imageSizes?: string;
  className?: string;
};

export function CourseTile({
  courseData,
  href,
  title,
  image,
  summary,
  category,
  meta,
  badge,
  priceLabel,
  rating,
  instructor,
  actionLabel,
  overlay,
  imageSizes = "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw",
  className = "",
}: CourseTileProps) {
  const { t, locale } = useTranslation();
  const displayMeta = typeof courseData?.lessonCount === "number"
    ? t(courseData.lessonCount === 1 ? "publicCourses.lessonOne" : "publicCourses.lessonMany").replace("{count}", String(courseData.lessonCount))
    : meta;
  const displayPrice = typeof courseData?.priceAmountMinor === "number"
    ? new Intl.NumberFormat(locale, { style: "currency", currency: courseData.currency ?? "USD" }).format(courseData.priceAmountMinor / 100)
    : courseData?.ownerId ? t("publicCourses.enrollmentSoon") : priceLabel;
  const displayBadge = courseData
    ? courseData.freePreviewHref ? t("publicCourses.preview") : !courseData.ratingCount ? t("publicCourses.new") : null
    : badge;
  const kicker = [category ? getCourseCategoryLabel(category, t) : category, displayMeta].filter(Boolean).join(" · ");
  const hasRating = Boolean(rating && rating.count > 0);

  return (
    <article className={`marketplace-card group ${className}`.trim()}>
      <div className="marketplace-card__media">
        <Image
          src={image}
          alt=""
          fill
          sizes={imageSizes}
          className="object-cover"
        />
        <div className="marketplace-card__scrim" />
        {displayBadge ? (
          <div className="marketplace-card__badges">
            <span className="marketplace-card__tag">{displayBadge}</span>
          </div>
        ) : null}
        {overlay}
      </div>
      <div className="marketplace-card__body">
        {kicker ? (
          <span className="marketplace-card__kicker">{kicker}</span>
        ) : null}
        <h3 className="marketplace-card__title">
          <Link href={href} className="marketplace-card__link">
            {title}
          </Link>
        </h3>
        {summary ? (
          <p className="marketplace-card__summary">{summary}</p>
        ) : null}
        {instructor || hasRating ? (
          <p className="marketplace-card__instructor">
            {instructor ? (
              <>
                <UserAvatar
                  name={instructor.name}
                  photoURL={instructor.photoURL}
                  size="sm"
                  className="size-6"
                />
                <span className="min-w-0 truncate">{instructor.name}</span>
              </>
            ) : null}
            {hasRating && rating ? (
              <span className="inline-flex shrink-0 items-center gap-1 text-[var(--color-primary)]">
                <Star
                  aria-hidden="true"
                  size={13}
                  strokeWidth={1.5}
                  className="fill-[var(--color-brand)] text-[var(--color-brand)]"
                />
                {rating.average.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                <span className="font-normal text-[var(--color-ink-soft)]">
                  ({rating.count})
                </span>
              </span>
            ) : null}
          </p>
        ) : null}
        <div className="marketplace-card__footer">
          {displayPrice ? (
            <span className="marketplace-card__price">{displayPrice}</span>
          ) : (
            <span />
          )}
          <span className="marketplace-card__cta">
            {actionLabel ?? t("publicCourses.viewCourse")}
            <ArrowRight
              aria-hidden="true"
              size={14}
              strokeWidth={2}
              className="transition-transform duration-200 group-hover:translate-x-1"
            />
          </span>
        </div>
      </div>
    </article>
  );
}
