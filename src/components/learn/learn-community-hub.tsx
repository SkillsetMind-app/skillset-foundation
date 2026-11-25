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
// The search only shows from 3 communities up: with one or two it was a whole
// card just to filter what already fits on the screen.
const SEARCH_FROM = 3;

export function LearnCommunityHub() {
  const { t, locale } = useTranslation();
  const { user } = useAuth();
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  // Which courses have the community turned on, and for which course list
  // that was read (the enrollment arrives through realtime and can change).
  const [community, setCommunity] = useState<{ courses: string; ids: ReadonlySet<string> } | null>(null);
  const courses = useMemo(() => communityEnrollmentCourseIds(enrollments).join(" "), [enrollments]);
  // Each "Try again" counts one attempt: the communities read runs again.
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

  // Reads the enrollments again through the same channel (without reconnecting) and the communities
  // once more. Until the answer arrives, "loading" applies, never the empty state.
  function retryLoad() {
    setError("");
    setIsLoading(true);
    setCommunity(null);
    setAttempt((value) => value + 1);
    void subscription.current?.reload();
  }

  // With no real course there is nothing to ask the database; with a course, it waits for the
  // answer for the current list (no card for a community that is turned off).
  const communityIds = !courses ? NO_COURSES : community?.courses === courses ? community.ids : null;

  if (isLoading || (!error && communityIds === null)) {
    // The top row is two cards, in place of the loose sentence in a plain
    // white card. No search: it only shows with many communities.
    return <CardListSkeleton label={t("learnWave2.communityHub.loading")} head="title" />;
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
      // Only for the search: the card no longer shows the category.
      categories: t("learnWave2.communityHub.category"),
    }));
  const showSearch = communityCards.length >= SEARCH_FROM;
  const filteredCards = communityCards.filter((space) => {
    // With the box hidden the text does not filter: if the count drops with a typed
    // search, the learner was left on "No communities match" with no box
    // to clear it.
    const normalizedSearch = showSearch ? search.trim().toLowerCase() : "";
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
      {showSearch ? (
        <div className="rounded-lg border border-[var(--color-line)] bg-white p-5 shadow-[var(--shadow-soft)]">
          <div className="grid gap-3">
            <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
              {t("learnWave2.communityHub.search")}
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("learnWave2.communityHub.placeholder")}
                className="field-input"
              />
            </label>
          </div>
          <p className="mt-4 text-xs uppercase tracking-[0.14em] text-[var(--color-ink-soft)]">
            {t("learnWave2.communityHub.count")
              .replace("{count}", () => new Intl.NumberFormat(locale).format(filteredCards.length))
              .replace("{total}", () => new Intl.NumberFormat(locale).format(communityCards.length))}
          </p>
        </div>
      ) : null}

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

      {/* Each card says only what changes from one community to another: the course.
          Before there were four lines identical on all of them ("COURSE COMMUNITY",
          "ENROLLED COURSE", the same description sentence and "ENROLLED ONLY"). */}
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
