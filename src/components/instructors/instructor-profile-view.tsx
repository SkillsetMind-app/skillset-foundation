"use client";

import { ArrowRight, Star } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { CSSProperties } from "react";

import { CourseTile } from "@/components/courses/course-tile";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { UserAvatar } from "@/components/shared/user-avatar";
import { brand } from "@/data/brand";
import {
  isStorefrontHexColor,
  publicProfileName,
  readableTextOnAccent,
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
  // Bio longa abre recolhida; a curta aparece inteira, sem botão.
  const longBio = (profile.bio?.length ?? 0) > BIO_PREVIEW_CHARS;
  // Tema da vitrine (warm/cool/mono) tinge o cabeçalho; "default" não.
  const theme = branding?.themePreset && branding.themePreset !== "default" ? branding.themePreset : null;
  const ratingCount = ordered.reduce((sum, course) => sum + course.ratingCount, 0);
  const ratingAverage = ratingCount
    ? ordered.reduce((sum, course) => sum + course.ratingAverage * course.ratingCount, 0) / ratingCount
    : 0;
  const decimal = (value: number) =>
    value.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  return (
    // minmax(0,1fr): sem isto a coluna toma a largura do título do botão
    // principal (truncate = sem quebra) e o .page-shell corta o resto.
    <article className="grid grid-cols-[minmax(0,1fr)] gap-8">
      <header
        data-section="header"
        data-storefront-theme={theme ?? undefined}
        className={`creator-profile-header flex flex-col items-center text-center ${theme ? "px-4 py-6" : ""}`}
      >
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
          // Cor da marca do professor no botão; o texto segue o contraste.
          data-accent={accent ? "" : undefined}
          style={accent ? ({
            "--storefront-accent": accent,
            "--storefront-accent-ink": readableTextOnAccent(accent),
          } as CSSProperties) : undefined}
          className="button-solid min-h-12 w-full min-w-0 px-5 py-3 text-base"
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

      {/* Prova só com número de verdade: zero não aparece. Só a nota: o
          contador de inscrições do curso não é mantido por nada no banco. */}
      {ratingCount > 0 ? (
        <dl
          data-section="proof"
          className="flex justify-center border-y border-[var(--color-line)] py-4 text-center"
        >
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
            // Bio longa recolhida (quem chega do Instagram quer o curso). Sem JS:
            // o <details> abre sozinho e o CSS (.creator-bio) solta o texto.
            <div className="creator-bio mt-3">
              <p className={`creator-bio__text text-sm leading-6 text-[var(--color-ink-soft)] ${longBio ? "line-clamp-3" : ""}`}>
                {profile.bio}
              </p>
              {longBio ? (
                <details>
                  <summary className="mt-1 inline-block cursor-pointer list-none text-sm font-semibold text-[var(--color-primary)] underline underline-offset-4">
                    {t("publicPages.profile.read_more")}
                  </summary>
                </details>
              ) : null}
            </div>
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

/** Acima disto a bio abre recolhida em 3 linhas, com "Read more". */
const BIO_PREVIEW_CHARS = 180;

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
