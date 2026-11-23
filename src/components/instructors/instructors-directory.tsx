"use client";

import { useTranslation } from "@/components/i18n/i18n-provider";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { UserAvatar } from "@/components/shared/user-avatar";
import { SelfReportedTag, VerifiedBadge } from "@/components/shared/verified-badge";
import { useHasRealCourses } from "@/components/site/real-courses";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadErrorAlert } from "@/components/ui/load-error-alert";
import { instructorPagePath, type PublicProfile } from "@/domain/user-profile";
import { listPublicProfiles } from "@/lib/data/user-profiles";

export function InstructorsDirectory() {
  const { t } = useTranslation();
  const hasRealCourses = useHasRealCourses();
  const [profiles, setProfiles] = useState<PublicProfile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let active = true;

    void listPublicProfiles()
      .then((nextProfiles) => {
        if (!active) {
          return;
        }

        setProfiles(nextProfiles);
        setHasError(false);
      })
      .catch(() => {
        if (active) {
          setHasError(true);
        }
      })
      .finally(() => {
        if (active) {
          setIsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  // "Try again" chama a mesma leitura; o aviso só sai quando ela dá certo. Um
  // segundo clique enquanto ela corre devolve a mesma leitura, não abre outra.
  const retryInFlight = useRef<Promise<void> | null>(null);
  function retryLoad() {
    if (!retryInFlight.current) {
      retryInFlight.current = listPublicProfiles()
        .then((nextProfiles) => {
          setProfiles(nextProfiles);
          setHasError(false);
        })
        .catch(() => {
          // O aviso fica, com o botão de novo.
        })
        .finally(() => {
          retryInFlight.current = null;
        });
    }
    return retryInFlight.current;
  }

  // Uma moldura em volta dos estados: o botão some quando a leitura dá certo
  // e o foco fica nela, em vez de cair no <body>.
  const frameRef = useRef<HTMLDivElement>(null);
  const frame = (content: ReactNode) => (
    <div ref={frameRef} tabIndex={-1}>
      {content}
    </div>
  );

  if (isLoading) {
    return frame(
      <section
        aria-busy="true"
        aria-live="polite"
        className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        <p className="sr-only" role="status">
          {t("publicPages.directory.loading_instructors")}
        </p>
        {[0, 1, 2].map((item) => (
          <div
            key={item}
            // Mesma altura mínima do cartão de verdade (min-h-64): sem pulo quando chega.
            className="h-64 animate-pulse rounded-lg bg-[var(--color-surface-strong)]"
          />
        ))}
      </section>
    );
  }

  if (hasError) {
    return frame(
      // Anunciado ao leitor de tela, com o ícone do erro e "Try again". A frase
      // de apoio fica no cinza de sempre, abaixo da do erro.
      <LoadErrorAlert className="mt-12" alertClassName="p-6" focusRef={frameRef} onRetry={retryLoad}>
        <p>{t("publicPages.directory.instructor_profiles_could_not_load_right")}</p>
        <p className="mt-2 font-normal text-[var(--color-ink-soft)]">
          {t("publicPages.directory.course_pages_still_show_verified_instructor")}
        </p>
      </LoadErrorAlert>
    );
  }

  if (profiles.length === 0) {
    return frame(
      // O vazio da plataforma (EmptyState): o título em sans, sem disputar com
      // o h1 serifado da página.
      <EmptyState
        as="h2"
        className="mt-12"
        eyebrow={t("publicPages.directory.first_cohort")}
        title={t("publicPages.directory.public_instructor_profiles_appear_after_review")}
        description={t("publicPages.directory.skillsetmind_only_lists_real_published_profiles")}
        action={
          <>
            <Link
              href="/auth?mode=signup&path=teacher"
              className="button-solid px-4 py-2.5 text-sm"
            >
              {t("publicPages.directory.start_teaching")}
            </Link>
            {hasRealCourses ? (
              <Link
                href="/courses"
                className="button-outline px-4 py-2.5 text-sm"
              >
                {t("publicPages.directory.browse_courses")}
              </Link>
            ) : null}
          </>
        }
      />
    );
  }

  return frame(
    <section className="mt-12" aria-labelledby="instructors-directory-heading">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
            {t("publicPages.directory.directory")}
          </p>
          <h2
            id="instructors-directory-heading"
            className="display-title mt-2 text-3xl text-[var(--color-primary)]"
          >
            {t("publicPages.directory.published_instructors")}
          </h2>
        </div>
        {hasRealCourses ? (
          <Link
            href="/courses"
            className="inline-flex items-center gap-2 text-sm font-bold text-[var(--color-primary)] underline-offset-4 hover:underline"
          >
            {t("publicPages.directory.browse_their_courses")}<ArrowRight aria-hidden="true" size={16} strokeWidth={1.9} />
          </Link>
        ) : null}
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {profiles.map((profile) => (
          <InstructorCard key={profile.uid} profile={profile} />
        ))}
      </div>
    </section>
  );
}

function InstructorCard({ profile }: { profile: PublicProfile }) {
  const { t } = useTranslation();
  const name =
    profile.displayName || profile.username || t("publicPages.directory.fallback_name");
  const credentials = profile.credentials.slice(0, 2);

  return (
    // O cartão inteiro leva ao perfil: o nome é o único link e o ::after do
    // .marketplace-card__link cobre o cartão (o desenho do cartão de curso).
    // Antes só o "View profile" pequeno era clicável e o cartão não reagia.
    <article className="motion-hover-lift relative flex min-h-64 flex-col rounded-lg border border-[var(--color-line)] bg-white p-5 shadow-[var(--shadow-soft)] focus-within:border-[var(--color-line-strong)] hover:border-[var(--color-line-strong)] hover:shadow-[var(--shadow-strong)] motion-safe:transition-transform">
      <div className="flex items-center gap-3">
        <UserAvatar name={name} photoURL={profile.photoURL} size="lg" />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-0.5">
            <h3 className="truncate text-base font-bold text-[var(--color-ink)]">
              <Link href={instructorPagePath(profile.uid, profile.username)} className="marketplace-card__link">
                {name}
              </Link>
            </h3>
            {/* Acima da camada do link: o selo abre a própria explicação. */}
            {profile.verification ? <VerifiedBadge compact verification={profile.verification} className="z-[2]" /> : null}
          </div>
          {profile.username ? (
            <p className="mt-1 truncate text-xs font-semibold text-[var(--color-ink-soft)]">
              @{profile.username}
            </p>
          ) : null}
        </div>
      </div>

      {profile.bio ? (
        <p className="mt-4 line-clamp-4 text-sm leading-6 text-[var(--color-ink-soft)]">
          {profile.bio}
        </p>
      ) : (
        <p className="mt-4 text-sm leading-6 text-[var(--color-ink-soft)]">
          {t("publicPages.directory.this_instructor_has_published_their_profile")}
        </p>
      )}

      {credentials.length > 0 ? (
        <ul className="mt-4 grid gap-2 border-t border-[var(--color-line)] pt-4">
          {credentials.map((credential, index) => (
            <li
              key={`${profile.uid}-credential-${index}`}
              className="text-xs leading-5 text-[var(--color-ink-soft)]"
            >
              {credential}
              {profile.verification ? null : <SelfReportedTag />}
            </li>
          ))}
        </ul>
      ) : null}

      {/* Continua escrito, agora como parte do cartão clicável (o link é o
          nome); escondido do leitor de tela para não repetir o destino. */}
      <span
        aria-hidden="true"
        className="mt-auto inline-flex items-center gap-2 pt-5 text-sm font-bold text-[var(--color-primary)]"
      >
        {t("publicPages.directory.view_profile")}<ArrowRight aria-hidden="true" size={15} strokeWidth={1.9} />
      </span>
    </article>
  );
}
