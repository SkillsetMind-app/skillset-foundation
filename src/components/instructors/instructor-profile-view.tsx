"use client";

import { ArrowRight, Star } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { CourseTile } from "@/components/courses/course-tile";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { UserAvatar } from "@/components/shared/user-avatar";
import { brand } from "@/data/brand";
import {
  isStorefrontHexColor,
  publicProfileName,
  type PublicProfile,
  type StorefrontShowcase,
} from "@/domain/user-profile";
import type { CreatorCourse } from "@/lib/data/server/public-profile";

/**
 * O perfil público do professor como link da bio: uma coluna de celular, na
 * ordem cabeçalho → UM botão principal → cursos em linhas → prova → sobre.
 *
 * Os dados chegam prontos do servidor (page.tsx). Nada aqui leva para fora do
 * professor: sem "explorar o marketplace", sem link para /courses — o
 * visitante veio do Instagram dele e só sai daqui para um curso dele.
 *
 * Redes sociais (Instagram, site...) ficam para depois: public_profiles ainda
 * não guarda esses campos.
 */
export function InstructorProfileView({
  profile,
  courses,
}: {
  profile: PublicProfile;
  /** null = a leitura dos cursos falhou (o perfil continua no ar). */
  courses: CreatorCourse[] | null;
}) {
  const { t, locale } = useTranslation();
  const name = publicProfileName(profile)
    ?? t("publicPages.profile.fallback_name").replace("{brand}", () => brand.name);
  const showcase = profile.storefront?.showcase;
  const branding = profile.storefront?.branding;
  const tagline = showcase?.tagline?.trim();
  // A projeção já sanitiza; segunda trava barata antes de virar CSS.
  const accent = branding?.accentColor && isStorefrontHexColor(branding.accentColor)
    ? branding.accentColor
    : null;
  const ordered = orderShowcaseCourses(courses ?? [], showcase);
  const primary = ordered[0];
  // Soma de inscrições por curso: a mesma pessoa em dois cursos conta duas
  // vezes, então o rótulo é "inscrições", nunca "alunos".
  const enrollments = ordered.reduce((sum, course) => sum + course.enrollmentCount, 0);
  const ratingCount = ordered.reduce((sum, course) => sum + course.ratingCount, 0);
  const ratingAverage = ratingCount
    ? ordered.reduce((sum, course) => sum + course.ratingAverage * course.ratingCount, 0) / ratingCount
    : 0;
  const decimal = (value: number) =>
    value.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  return (
    <article className="grid gap-8">
      <header data-section="header" className="flex flex-col items-center text-center">
        {branding?.heroImageUrl ? (
          <div className="relative mb-6 aspect-[3/1] w-full overflow-hidden bg-[var(--color-surface-strong)]">
            <Image
              src={branding.heroImageUrl}
              alt=""
              fill
              priority
              sizes="(max-width: 640px) 100vw, 640px"
              className="object-cover"
              // Host do professor, fora do remotePatterns.
              unoptimized
            />
          </div>
        ) : null}
        <UserAvatar name={name} photoURL={profile.photoURL} size="lg" />
        <div className="mt-4 flex items-center justify-center gap-2">
          <h1 className="display-title text-3xl leading-tight text-[var(--color-primary)] sm:text-4xl">
            {name}
          </h1>
          {/* Selo de verificado (próximo PR): entra aqui, logo depois do nome. */}
        </div>
        {profile.username ? (
          <p className="mt-1 text-sm font-semibold text-[var(--color-ink-soft)]">@{profile.username}</p>
        ) : null}
        {tagline ? (
          // A cor da marca do professor (plano com vitrine) vira o fio acima.
          <p
            className={`mt-3 max-w-md text-base font-semibold leading-6 text-[var(--color-primary)] ${accent ? "border-t-2 pt-3" : ""}`}
            style={accent ? { borderColor: accent } : undefined}
          >
            {tagline}
          </p>
        ) : null}
      </header>

      {primary ? (
        <Link
          data-section="primary"
          href={primary.href}
          className="button-solid min-h-12 w-full px-5 py-3 text-base"
        >
          <span className="min-w-0 truncate">{primary.title}</span>
          <ArrowRight aria-hidden="true" size={18} strokeWidth={2} className="shrink-0" />
        </Link>
      ) : null}

      <section data-section="courses" aria-labelledby="creator-courses-heading">
        <h2
          id="creator-courses-heading"
          className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--color-accent-fg)]"
        >
          {t("publicPages.profile.courses_heading")}
        </h2>
        {courses === null ? (
          <p className="mt-4 border border-[var(--color-danger)] bg-[var(--color-danger-soft)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]">
            {t("publicPages.profile.courses_error")}
          </p>
        ) : ordered.length === 0 ? (
          <div className="mt-4 border border-dashed border-[var(--color-line-strong)] p-6 text-center">
            <p className="text-sm font-bold text-[var(--color-primary)]">
              {t("publicPages.profile.no_public_courses_yet")}
            </p>
            <p className="mt-2 text-sm leading-6 text-[var(--color-ink-soft)]">
              {t("publicPages.profile.this_instructor_s_first_courses_will")}
            </p>
          </div>
        ) : (
          <ul className="mt-4 grid gap-3">
            {ordered.map((course) => (
              <li key={course.id}>
                <CourseTile
                  href={course.href}
                  title={course.title}
                  image={course.coverImageUrl || "/brand/logo-mark.png"}
                  priceLabel={formatPrice(course, t, locale)}
                  rating={course.ratingCount ? { average: course.ratingAverage, count: course.ratingCount } : null}
                  className="marketplace-card--row"
                  imageSizes="96px"
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Prova só com número de verdade: zero não aparece. */}
      {enrollments > 0 || ratingCount > 0 ? (
        <dl
          data-section="proof"
          className="flex flex-wrap justify-center gap-x-8 gap-y-3 border-y border-[var(--color-line)] py-4 text-center"
        >
          {enrollments > 0 ? (
            <div>
              <dt className="sr-only">{t("publicPages.profile.enrollments_label")}</dt>
              <dd className="text-sm font-semibold text-[var(--color-ink)]">
                {t(enrollments === 1 ? "publicPages.profile.enrollments_one" : "publicPages.profile.enrollments_many")
                  .replace("{count}", () => enrollments.toLocaleString(locale))}
              </dd>
            </div>
          ) : null}
          {ratingCount > 0 ? (
            <div>
              <dt className="sr-only">{t("publicPages.profile.rating_label")}</dt>
              <dd className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--color-ink)]">
                <Star
                  aria-hidden="true"
                  size={14}
                  strokeWidth={1.5}
                  className="fill-[var(--color-brand)] text-[var(--color-brand)]"
                />
                {decimal(ratingAverage)}
                <span className="font-normal text-[var(--color-ink-soft)]">
                  {t(ratingCount === 1 ? "publicPages.profile.ratings_one" : "publicPages.profile.ratings_many")
                    .replace("{count}", () => ratingCount.toLocaleString(locale))}
                </span>
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {profile.bio || profile.credentials.length > 0 ? (
        <section data-section="about" aria-labelledby="creator-about-heading">
          <h2
            id="creator-about-heading"
            className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--color-accent-fg)]"
          >
            {t("publicPages.profile.about").replace("{name}", () => name)}
          </h2>
          {profile.bio ? (
            // Recolhida: quem chega do Instagram quer o curso, não a biografia.
            <details className="group mt-3">
              <summary className="cursor-pointer list-none text-sm leading-6 text-[var(--color-ink-soft)]">
                <span className="line-clamp-2 group-open:line-clamp-none">{profile.bio}</span>
                <span className="mt-1 inline-block text-sm font-semibold text-[var(--color-primary)] underline underline-offset-4 group-open:hidden">
                  {t("publicPages.profile.read_more")}
                </span>
              </summary>
            </details>
          ) : null}
          {profile.credentials.length > 0 ? (
            <ul className="mt-4 grid gap-2">
              {profile.credentials.map((credential, index) => (
                <li
                  key={`${profile.uid}-credential-${index}`}
                  className="border-l-2 border-[var(--color-line-strong)] pl-3 text-sm leading-6 text-[var(--color-ink-soft)]"
                >
                  {credential}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </article>
  );
}

/**
 * Ordem da vitrine: o curso em destaque primeiro, depois a ordem do editor.
 * Sem posição, mantém a ordem que chegou (alfabética), no fim — mesma
 * convenção `?? MAX_SAFE_INTEGER` do marketplace para `featured_rank` nulo.
 */
function orderShowcaseCourses(
  courses: CreatorCourse[],
  showcase: StorefrontShowcase | null | undefined,
): CreatorCourse[] {
  const featuredId = showcase?.featuredCourseId ?? null;
  const orderedIds = showcase?.orderedCourseIds ?? [];

  if (!featuredId && orderedIds.length === 0) {
    return courses;
  }

  const rank = new Map(orderedIds.map((id, index) => [id, index]));

  return [...courses].sort((a, b) => {
    if (a.id === featuredId) return -1;
    if (b.id === featuredId) return 1;
    return (
      (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
      (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER)
    );
  });
}

function formatPrice(course: CreatorCourse, t: (key: string) => string, locale: string): string {
  if (course.free) {
    return t("publicPages.profile.free");
  }

  if (typeof course.priceAmountMinor === "number") {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: course.currency,
    }).format(course.priceAmountMinor / 100);
  }

  return t("publicPages.profile.enrollment_soon");
}
