"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { useAuth } from "@/components/auth/auth-provider";
import type { Enrollment, EnrollmentCommunityCard } from "@/domain/enrollment";
import { createEnrollmentCommunityCards } from "@/domain/enrollment";
import { subscribeToUserEnrollments } from "@/lib/data/enrollments";

export function LearnCommunityHub() {
  const { t, locale } = useTranslation();
  const { user } = useAuth();
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) {
      return;
    }

    return subscribeToUserEnrollments(
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
  }, [user]);

  if (isLoading) {
    return (
      <section className="rounded-[14px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
        <p className="text-sm text-[var(--color-ink-soft)]">{t("learnWave2.communityHub.loading")}</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="rounded-[14px] border border-[rgba(178,34,52,0.2)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
        <p role="alert" className="rounded-[10px] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]">
          {t(error)}
        </p>
      </section>
    );
  }

  const communityCards: EnrollmentCommunityCard[] =
    createEnrollmentCommunityCards(enrollments).map((space) => ({
      ...space,
      name: t("learnWave2.communityHub.name").replace("{course}", () => space.courseTitle),
      categories: t("learnWave2.communityHub.category"),
      description: t("learnWave2.communityHub.description"),
      visibility: t("learnWave2.communityHub.visibility"),
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
      <section className="rounded-[14px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
          {t("learnWave2.communityHub.eyebrow")}
        </p>
        <h2 className="display-title mt-3 text-3xl text-[var(--color-ink)]">
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
      <div className="rounded-[14px] border border-[var(--color-line)] bg-white p-5 shadow-[var(--shadow-soft)]">
        <div className="grid gap-3">
          <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
            {t("learnWave2.communityHub.search")}
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("learnWave2.communityHub.placeholder")}
              className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)]"
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
        <div className="rounded-[14px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
          <h2 className="display-title text-3xl text-[var(--color-ink)]">
            {t("learnWave2.communityHub.noMatch")}
          </h2>
          <p className="mt-4 text-sm leading-7 text-[var(--color-ink-soft)]">
            {t("learnWave2.communityHub.noMatchDetail")}
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
      {filteredCards.map((space) => (
        <article
          key={space.id}
          className="rounded-[14px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]"
        >
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
            {space.categories}
          </p>
          <span className="mt-4 inline-flex rounded-[8px] bg-[var(--color-surface-soft)] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-primary)]">
            {t("learnWave2.communityHub.enrolled")}
          </span>
          <h2 className="display-title mt-3 text-3xl text-[var(--color-ink)]">
            {space.name}
          </h2>
          <p className="mt-4 text-sm leading-7 text-[var(--color-ink-soft)]">
            {space.description}
          </p>
          <div className="mt-6 flex items-center justify-between gap-3">
            <p className="text-xs uppercase tracking-[0.14em] text-[var(--color-ink-soft)]">
              {space.visibility}
            </p>
            <Link
              href={space.href}
              className="button-solid px-4 py-2.5 text-sm"
            >
              {t("learnWave2.communityHub.open")}
            </Link>
          </div>
        </article>
      ))}
      </div>
    </section>
  );
}
