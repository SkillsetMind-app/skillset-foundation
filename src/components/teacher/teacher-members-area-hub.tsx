"use client";

import Link from "next/link";
import { BookOpen, ExternalLink, Image as ImageIcon, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { useAuth } from "@/components/auth/auth-provider";
import { PlatformPageHeader } from "@/components/platform/platform-page-header";
import { PeriodTabs } from "@/components/shared/period-tabs";
import { StatusChip } from "@/components/shared/status-chip";
import { buttonClasses, InlineAlert } from "@/components/ui";
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
  // A primeira leitura que falhou nao e "nenhum espaco ainda": a lista nao
  // mostra o vazio, e o aviso ganha "Try again".
  const [loaded, setLoaded] = useState(false);
  const subscription = useRef<{ reload: () => Promise<void> } | null>(null);

  useEffect(() => {
    if (!user) {
      return;
    }

    const current = subscribeToTeacherCourses(
      user.uid,
      (nextCourses) => {
        setCourses(nextCourses);
        setError("");
        setLoaded(true);
        setIsLoading(false);
      },
      () => {
        setError("teacherMembers.loadError");
        setIsLoading(false);
      }
    );
    subscription.current = current;
    return () => {
      subscription.current = null;
      current();
    };
  }, [user]);

  function retryLoad() {
    setError("");
    // Com a lista na tela ela fica; so a primeira leitura volta ao esqueleto.
    if (!loaded) setIsLoading(true);
    void subscription.current?.reload();
  }

  const visibleCourses =
    view === "communities" ? courses.filter((course) => course.communityEnabled) : courses;
  const createHref =
    view === "communities"
      ? "/teach/builder?newCourse=1&format=community"
      : "/teach/builder?newCourse=1&format=course";

  return (
    <div className="grid gap-6">
      <PlatformPageHeader
        eyebrow={t("teacherMembers.products")}
        title={t("teacherMembers.title")}
        description={t("teacherMembers.description")}
        actions={
          <Link href={createHref} className={buttonClasses()}>
            <Plus aria-hidden="true" size={16} strokeWidth={2} />
            {t(view === "communities" ? "teacherMembers.newCommunity" : "teacherMembers.newProduct")}
          </Link>
        }
      />

      {error ? (
        <div className="grid gap-3">
          <InlineAlert tone="error">{t(error)}</InlineAlert>
          <button type="button" onClick={retryLoad} className="button-outline justify-self-start px-4 text-sm">
            {t("appErrors.retry")}
          </button>
        </div>
      ) : null}

      {/* A área do criador junta todos os produtos; os espaços abaixo são de cada produto. */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--color-line)] bg-[var(--color-surface-soft)] px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--color-ink)]">{t("teacherMembers.creatorAreaTitle")}</p>
          <p className="text-sm text-[var(--color-ink-soft)]">{t("teacherMembers.creatorAreaDescription")}</p>
        </div>
        <Link href="/teach/member-area" className={buttonClasses({ variant: "outline", size: "sm" })}>
          {t("teacherMembers.creatorAreaOpen")}
        </Link>
      </div>

      <section aria-labelledby="members-products-title">
        {/* O seletor de uma entre poucas opcoes da casa (o mesmo do periodo
            dos relatorios), no lugar do bloco azul cheio feito so aqui. */}
        <div className="mb-5">
          <PeriodTabs
            options={["members", "communities"] as const}
            value={view}
            label={t("teacherMembers.contentType")}
            renderLabel={(option) => t(option === "members" ? "teacherMembers.spaces" : "teacherMembers.communities")}
            onChange={(nextView) =>
              router.push(nextView === "communities" ? "/teach/members?view=communities" : "/teach/members")
            }
          />
        </div>

        <div className="flex items-baseline justify-between gap-3">
          <h2 id="members-products-title" className="text-lg font-semibold text-[var(--color-ink)]">
            {t(view === "communities" ? "teacherMembers.communities" : "teacherMembers.spaces")}
          </h2>
          {!isLoading && loaded ? (
            <span className="text-sm tabular-nums text-[var(--color-ink-muted)]">
              {number(visibleCourses.length)}
            </span>
          ) : null}
        </div>

        {isLoading || loaded ? (
        <div className="mt-4 divide-y divide-[var(--color-line)] border-y border-[var(--color-line)]">
          {isLoading ? (
            [1, 2, 3].map((item) => (
              <div key={item} className="h-28 animate-pulse bg-[var(--color-surface-soft)]" />
            ))
          ) : visibleCourses.length === 0 ? (
            <div className="grid place-items-center px-5 py-14 text-center">
              <span className="grid size-11 place-items-center rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-primary)]">
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
                  <div className="grid aspect-video w-24 shrink-0 place-items-center overflow-hidden rounded-md border border-[var(--color-line)] bg-[var(--color-surface-soft)] text-[var(--color-primary)]">
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
                    // Acao de linha em contorno: com um "Preview" solido por
                    // produto, a lista tinha um botao forte em cada linha.
                    className={buttonClasses({ variant: "outline", size: "sm" })}
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
        ) : null}
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
