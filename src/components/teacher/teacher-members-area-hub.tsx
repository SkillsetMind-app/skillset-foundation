"use client";

import Link from "next/link";
import { BookOpen, ExternalLink, Image as ImageIcon, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { useAuth } from "@/components/auth/auth-provider";
import { StatusChip } from "@/components/shared/status-chip";
import { buttonClasses, Eyebrow, InlineAlert } from "@/components/ui";
import type { TeacherCourse } from "@/domain/teacher-course";
import { subscribeToTeacherCourses } from "@/lib/data/teacher-courses";

export function TeacherMembersAreaHub() {
  const { user } = useAuth();
  const { t, locale } = useTranslation();
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const router = useRouter();
  const searchParams = useSearchParams();
  const view = searchParams.get("view") === "communities" ? "communities" : "members";
  const [courses, setCourses] = useState<TeacherCourse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) {
      return;
    }

    return subscribeToTeacherCourses(
      user.uid,
      (nextCourses) => {
        setCourses(nextCourses);
        setIsLoading(false);
      },
      () => {
        setError("teacherMembers.loadError");
        setIsLoading(false);
      }
    );
  }, [user]);

  const visibleCourses =
    view === "communities" ? courses.filter((course) => course.communityEnabled) : courses;
  const createHref =
    view === "communities"
      ? "/teach/builder?newCourse=1&format=community"
      : "/teach/builder?newCourse=1&format=course";

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--color-line)] pb-5">
        <div>
          <Eyebrow>{t("teacherMembers.products")}</Eyebrow>
          <h1 className="mt-2 text-3xl font-semibold leading-tight text-[var(--color-primary)]">
            {t("teacherMembers.title")}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-ink-soft)]">
            {t("teacherMembers.description")}
          </p>
        </div>
        <Link href={createHref} className={buttonClasses()}>
          <Plus aria-hidden="true" size={16} strokeWidth={2} />
          {t(view === "communities" ? "teacherMembers.newCommunity" : "teacherMembers.newProduct")}
        </Link>
      </header>

      {error ? <InlineAlert tone="error">{t(error)}</InlineAlert> : null}

      <section aria-labelledby="members-products-title">
        <div
          className="mb-5 inline-grid grid-cols-2 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-1"
          role="radiogroup"
          aria-label={t("teacherMembers.contentType")}
        >
          {(["members", "communities"] as const).map((nextView) => (
            <button
              key={nextView}
              type="button"
              role="radio"
              aria-checked={view === nextView}
              onClick={() =>
                router.push(
                  nextView === "communities" ? "/teach/members?view=communities" : "/teach/members"
                )
              }
              className={`min-h-11 rounded-[var(--radius-xs)] px-4 text-sm font-semibold transition-colors ${
                view === nextView
                  ? "bg-[var(--color-primary)] text-[var(--color-on-primary)]"
                  : "text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]"
              }`}
            >
              {t(nextView === "members" ? "teacherMembers.spaces" : "teacherMembers.communities")}
            </button>
          ))}
        </div>

        <div className="flex items-baseline justify-between gap-3">
          <h2 id="members-products-title" className="text-lg font-semibold text-[var(--color-ink)]">
            {t(view === "communities" ? "teacherMembers.communities" : "teacherMembers.spaces")}
          </h2>
          {!isLoading ? (
            <span className="text-sm tabular-nums text-[var(--color-ink-muted)]">
              {number(visibleCourses.length)}
            </span>
          ) : null}
        </div>

        <div className="mt-4 divide-y divide-[var(--color-line)] border-y border-[var(--color-line)]">
          {isLoading ? (
            [1, 2, 3].map((item) => (
              <div key={item} className="h-28 animate-pulse bg-[var(--color-surface-soft)]" />
            ))
          ) : visibleCourses.length === 0 ? (
            <div className="grid place-items-center px-5 py-14 text-center">
              <span className="grid size-11 place-items-center rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-primary)]">
                <BookOpen aria-hidden="true" size={20} strokeWidth={1.8} />
              </span>
              <h3 className="mt-4 text-lg font-semibold text-[var(--color-ink)]">
                {t(view === "communities" ? "teacherMembers.noCommunity" : "teacherMembers.noSpace")}
              </h3>
              <p className="mt-2 max-w-md text-sm leading-6 text-[var(--color-ink-soft)]">
                {t(view === "communities" ? "teacherMembers.noCommunityDescription" : "teacherMembers.noSpaceDescription")}
              </p>
            </div>
          ) : (
            visibleCourses.map((course) => (
              <article
                key={course.id}
                className="grid gap-4 bg-[var(--color-surface)] px-3 py-4 transition-colors hover:bg-[var(--color-surface-soft)] sm:px-4 lg:grid-cols-[minmax(0,1fr)_minmax(180px,0.45fr)_auto] lg:items-center"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="grid aspect-video w-24 shrink-0 place-items-center overflow-hidden rounded-[var(--radius-xs)] border border-[var(--color-line)] bg-[var(--color-surface-soft)] text-[var(--color-primary)]">
                    {course.coverImageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={course.coverImageUrl}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <ImageIcon aria-hidden="true" size={19} strokeWidth={1.7} />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[var(--color-ink)]">
                      {course.title || t("teacherMembers.untitled")}
                    </p>
                    <p className="mt-1 text-xs text-[var(--color-ink-soft)]">
                      {t(course.modules.length === 1 ? "teacherMembers.moduleOne" : "teacherMembers.moduleMany").replace("{count}", () => number(course.modules.length))} · {t(course.lessonCount === 1 ? "teacherMembers.lessonOne" : "teacherMembers.lessonMany").replace("{count}", () => number(course.lessonCount))}
                    </p>
                    <div className="mt-2">
                      <StatusChip status={course.status} />
                    </div>
                  </div>
                </div>

                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
                    {t("teacherMembers.presentation")}
                  </p>
                  <p className="mt-1 text-sm font-semibold capitalize text-[var(--color-ink-soft)]">
                    {t(`teacherMembers.themes.${course.membersTheme ?? "light"}`)}
                  </p>
                  <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
                    {t(course.membersTitle ? "teacherMembers.customWelcome" : "teacherMembers.defaultWelcome")}
                  </p>
                  <p className="mt-1 text-xs font-semibold text-[var(--color-ink-soft)]">
                    {t(course.communityEnabled ? "teacherMembers.communityEnabled" : "teacherMembers.communityDisabled")}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2 lg:justify-end">
                  <Link
                    href={`/teach/builder/${encodeURIComponent(course.id)}/preview`}
                    className={buttonClasses({ size: "sm" })}
                  >
                    <ExternalLink aria-hidden="true" size={14} strokeWidth={1.8} />
                    {t("teacherMembers.preview")}
                  </Link>
                  <Link
                    href={`/teach/builder?courseId=${encodeURIComponent(course.id)}&tab=members`}
                    className={buttonClasses({ variant: "outline", size: "sm" })}
                  >
                    {t("teacherMembers.customize")}
                  </Link>
                  <Link
                    href={`/teach/builder?courseId=${encodeURIComponent(course.id)}&tab=content`}
                    className={buttonClasses({ variant: "outline", size: "sm" })}
                  >
                    {t("teacherMembers.content")}
                  </Link>
                </div>
              </article>
            ))
          )}
        </div>
      </section>

      <section className="border-t border-[var(--color-line)] pt-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-[var(--color-ink)]">{t("teacherMembers.storefront")}</h2>
            <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
              {t("teacherMembers.storefrontDescription")}
            </p>
          </div>
          <Link
            href="/teach/storefront"
            className={buttonClasses({ variant: "outline" })}
          >
            {t("teacherMembers.openStorefront")}
          </Link>
        </div>
      </section>
    </div>
  );
}
