"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { useAuth } from "@/components/auth/auth-provider";
import { CardListSkeleton } from "@/components/shared/page-skeletons";
import { InlineAlert } from "@/components/ui/inline-alert";
import type { Enrollment, EnrollmentCommunityCard } from "@/domain/enrollment";
import { communityEnrollmentCourseIds, createEnrollmentCommunityCards } from "@/domain/enrollment";
import { getCommunityCourseIds, subscribeToUserEnrollments } from "@/lib/data/enrollments";

const NO_COURSES: ReadonlySet<string> = new Set();

export function LearnCommunityHub() {
  const { t, locale } = useTranslation();
  const { user } = useAuth();
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  // Quais cursos estao com a comunidade ligada, e para qual lista de cursos
  // isso foi lido (a matricula chega pelo realtime e pode mudar).
  const [community, setCommunity] = useState<{ courses: string; ids: ReadonlySet<string> } | null>(null);
  const courses = useMemo(() => communityEnrollmentCourseIds(enrollments).join(" "), [enrollments]);
  // Cada "Try again" conta uma tentativa: a leitura das comunidades roda de novo.
  const [attempt, setAttempt] = useState(0);
  const subscription = useRef<{ reload: () => Promise<void> } | null>(null);

  useEffect(() => {
    if (!user) {
      return;
    }

    const current = subscribeToUserEnrollments(
      user.uid,
      (nextEnrollments) => {
        setEnrollments(nextEnrollments);
        setIsLoading(false);
      },
      () => {
        setError("learnWave2.communityHub.loadError");
        setIsLoading(false);
      },
    );
    subscription.current = current;
    return () => {
      subscription.current = null;
      current();
    };
  }, [user]);

  useEffect(() => {
    if (!courses) {
      return;
    }
    let active = true;
    getCommunityCourseIds(courses.split(" ")).then(
      (ids) => {
        if (active) setCommunity({ courses, ids });
      },
      () => {
        if (active) setError("learnWave2.communityHub.loadError");
      },
    );
    return () => {
      active = false;
    };
  }, [courses, attempt]);

  // Le as matriculas de novo pelo mesmo canal (sem religar) e as comunidades
  // outra vez. Ate a resposta vale o "carregando", nunca o vazio.
  function retryLoad() {
    setError("");
    setIsLoading(true);
    setCommunity(null);
    setAttempt((value) => value + 1);
    void subscription.current?.reload();
  }

  // Sem curso real nao ha o que perguntar ao banco; com curso, espera a
  // resposta para a lista atual (nada de cartao de comunidade desligada).
  const communityIds = !courses ? NO_COURSES : community?.courses === courses ? community.ids : null;

  if (isLoading || (!error && communityIds === null)) {
    // A busca e dois cartões, no lugar da frase solta num cartão branco.
    return <CardListSkeleton label={t("learnWave2.communityHub.loading")} head="search" />;
  }

  if (error) {
    return (
      <section className="rounded-lg border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
        <InlineAlert tone="error">{t(error)}</InlineAlert>
        <button type="button" onClick={retryLoad} className="button-outline mt-4 px-4 text-sm">
          {t("appErrors.retry")}
        </button>
      </section>
    );
  }

  const communityCards: EnrollmentCommunityCard[] =
    createEnrollmentCommunityCards(enrollments, communityIds ?? NO_COURSES).map((space) => ({
      ...space,
      name: t("learnWave2.communityHub.name").replace("{course}", () => space.courseTitle),
      // Só para a busca: o cartão não mostra mais a categoria.
      categories: t("learnWave2.communityHub.category"),
    }));
  const filteredCards = communityCards.filter((space) => {
    const normalizedSearch = search.trim().toLowerCase();
    const matchesSearch =
      !normalizedSearch ||
      space.name.toLowerCase().includes(normalizedSearch) ||
      space.courseTitle.toLowerCase().includes(normalizedSearch) ||
      space.categories.toLowerCase().includes(normalizedSearch);

    return matchesSearch;
  });

  if (communityCards.length === 0) {
    return (
      <section className="rounded-lg border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
          {t("learnWave2.communityHub.eyebrow")}
        </p>
        <h2 className="mt-3 text-lg font-semibold text-[var(--color-primary)]">
          {t("learnWave2.communityHub.emptyTitle")}
        </h2>
        <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
          {t("learnWave2.communityHub.emptyDetail")}
        </p>
        <div className="mt-6">
          <Link href="/courses" className="button-solid px-4 py-2.5 text-sm">
            {t("learnWave2.communityHub.explore")}
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-5">
      <div className="rounded-lg border border-[var(--color-line)] bg-white p-5 shadow-[var(--shadow-soft)]">
        <div className="grid gap-3">
          <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
            {t("learnWave2.communityHub.search")}
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("learnWave2.communityHub.placeholder")}
              className="rounded-md border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)]"
            />
          </label>
        </div>
        <p className="mt-4 text-xs uppercase tracking-[0.14em] text-[var(--color-ink-soft)]">
          {t("learnWave2.communityHub.count")
            .replace("{count}", () => new Intl.NumberFormat(locale).format(filteredCards.length))
            .replace("{total}", () => new Intl.NumberFormat(locale).format(communityCards.length))}
        </p>
      </div>

      {filteredCards.length === 0 ? (
        <div className="rounded-lg border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
          <h2 className="text-lg font-semibold text-[var(--color-primary)]">
            {t("learnWave2.communityHub.noMatch")}
          </h2>
          <p className="mt-4 text-sm leading-7 text-[var(--color-ink-soft)]">
            {t("learnWave2.communityHub.noMatchDetail")}
          </p>
        </div>
      ) : null}

      {/* Cada cartão diz só o que muda de uma comunidade para outra: o curso.
          Antes eram quatro linhas iguais em todos ("COURSE COMMUNITY",
          "ENROLLED COURSE", a mesma frase de descrição e "ENROLLED ONLY"). */}
      <div className="grid gap-4 lg:grid-cols-2">
      {filteredCards.map((space) => (
        <article
          key={space.id}
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]"
        >
          <h2 className="min-w-0 break-words text-lg font-semibold text-[var(--color-primary)]">
            {space.name}
          </h2>
          <Link
            href={space.href}
            className="button-solid px-4 py-2.5 text-sm"
          >
            {t("learnWave2.communityHub.open")}
          </Link>
        </article>
      ))}
      </div>
    </section>
  );
}
