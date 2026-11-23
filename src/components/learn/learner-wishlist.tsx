"use client";

import Image from "next/image";
import Link from "next/link";
import { BookmarkX } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { useAuth } from "@/components/auth/auth-provider";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineAlert } from "@/components/ui/inline-alert";
import { LoadErrorAlert } from "@/components/ui/load-error-alert";
import type { WishlistItem } from "@/domain/wishlist";
import { getFeaturedCourseCards, type CourseCard } from "@/lib/data/catalog";
import {
  subscribeToPublishedTeacherCourses,
  teacherCourseToCourseCard,
} from "@/lib/data/published-courses";
import {
  subscribeToUserWishlist,
  toggleWishlistCourse,
} from "@/lib/data/wishlist";
import { getSupabaseClientConfig } from "@/lib/supabase/config";

export function LearnerWishlist() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [items, setItems] = useState<WishlistItem[]>([]);
  const [publishedCourses, setPublishedCourses] = useState<CourseCard[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // Cada leitura com a sua falha: a lista que chegar não apaga o erro da outra,
  // e a falha ao remover não troca a lista pelo aviso.
  const [loadFailed, setLoadFailed] = useState(false);
  const [published, setPublished] = useState({ ready: false, failed: false });
  const [removeFailed, setRemoveFailed] = useState(false);
  const [removingId, setRemovingId] = useState("");
  const wishlistSubscription = useRef<{ reload: () => Promise<void> } | null>(null);
  const publishedSubscription = useRef<{ reload: () => Promise<void> } | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) {
      return;
    }

    const current = subscribeToUserWishlist(
      user.uid,
      (nextItems) => {
        setItems(nextItems);
        setLoadFailed(false);
        setIsLoading(false);
      },
      () => {
        setLoadFailed(true);
        setIsLoading(false);
      },
    );
    wishlistSubscription.current = current;
    return () => {
      wishlistSubscription.current = null;
      current();
    };
  }, [user]);

  useEffect(() => {
    if (!getSupabaseClientConfig()) {
      return;
    }

    const current = subscribeToPublishedTeacherCourses(
      (nextCourses) => {
        setPublishedCourses(nextCourses.map(teacherCourseToCourseCard));
        setPublished({ ready: true, failed: false });
      },
      () => {
        setPublished((state) => ({ ...state, failed: true }));
      },
    );
    publishedSubscription.current = current;
    return () => {
      publishedSubscription.current = null;
      current();
    };
  }, []);

  // "Try again" lê de novo só o que falhou, pelos mesmos canais (sem religar).
  function retryLoad() {
    return Promise.all([
      loadFailed ? wishlistSubscription.current?.reload() : undefined,
      published.failed ? publishedSubscription.current?.reload() : undefined,
    ]);
  }

  const courseBySlug = useMemo(() => {
    const next = new Map<string, CourseCard>();
    [...getFeaturedCourseCards(), ...publishedCourses].forEach((course) => {
      next.set(course.slug, course);
    });
    return next;
  }, [publishedCourses]);

  async function handleRemove(item: WishlistItem) {
    if (!user) {
      return;
    }

    setRemovingId(item.id);
    setRemoveFailed(false);

    try {
      await toggleWishlistCourse({
        userId: user.uid,
        courseId: item.courseId,
        courseSlug: item.courseSlug,
      });
    } catch {
      setRemoveFailed(true);
    } finally {
      setRemovingId("");
    }
  }

  // Uma moldura em volta dos estados: o "Try again" some quando a leitura dá
  // certo, e o foco fica nela em vez de cair no <body>.
  const frame = (content: ReactNode) => (
    <div ref={frameRef} tabIndex={-1}>
      {content}
    </div>
  );

  if (isLoading) {
    return frame(
      <div className="dash-card dash-card--strong p-5 text-sm text-[var(--color-ink-soft)]">
        {t("learnWave2.wishlistHub.loading")}
      </div>
    );
  }

  const loadErrorKey = loadFailed
    ? "learnWave2.wishlistHub.loadError"
    : published.failed
      ? "learnWave2.wishlistHub.publishedError"
      : "";
  const alerts = loadErrorKey || removeFailed ? (
    <div className="grid gap-3">
      {loadErrorKey ? (
        <LoadErrorAlert focusRef={frameRef} onRetry={retryLoad}>
          {t(loadErrorKey)}
        </LoadErrorAlert>
      ) : null}
      {removeFailed ? (
        <InlineAlert tone="error">{t("learnWave2.wishlistHub.removeError")}</InlineAlert>
      ) : null}
    </div>
  ) : null;

  // Sem linhas que valham: a lista nunca chegou, ou os cursos nunca chegaram e
  // todo favorito pareceria "indisponível". Só o aviso, nunca o vazio.
  if (loadErrorKey && (items.length === 0 || (published.failed && !published.ready))) {
    return frame(<div className="dash-card dash-card--strong p-5">{alerts}</div>);
  }

  // O vazio da plataforma (EmptyState), em h2 logo abaixo do h1 do shell.
  if (items.length === 0) {
    return frame(
      <EmptyState
        as="h2"
        eyebrow={t("learnWave2.wishlistHub.eyebrow")}
        title={t("learnWave2.wishlistHub.emptyTitle")}
        description={t("learnWave2.wishlistHub.emptyDetail")}
        action={
          <Link href="/courses" className="button-solid inline-flex px-4 py-2.5 text-sm">
            {t("learnWave2.wishlistHub.explore")}
          </Link>
        }
      />
    );
  }

  // Linhas já na tela ficam; o aviso vem acima delas, na largura toda.
  return frame(
    <section className="grid gap-5 lg:grid-cols-2">
      {alerts ? <div className="lg:col-span-2">{alerts}</div> : null}
      {items.map((item) => {
        const course = courseBySlug.get(item.courseSlug) ?? courseBySlug.get(item.courseId);

        return (
          <article
            key={item.id}
            className="dash-card dash-card--strong overflow-hidden"
          >
            {course ? (
              <div className="grid gap-0 md:grid-cols-[220px_1fr]">
                <div className="relative min-h-[180px] overflow-hidden">
                  <Image
                    src={course.image}
                    alt={course.title}
                    fill
                    sizes="220px"
                    className="object-cover"
                  />
                </div>
                <div className="p-5">
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--color-accent-fg)]">
                    {course.category}
                  </p>
                  {/* h2: os cartões ficam logo abaixo do h1 do shell (antes o h2
                      do vazio vinha primeiro no arquivo e escondia o salto). */}
                  <h2 className="mt-3 text-lg font-semibold leading-6 text-[var(--color-primary)]">
                    {course.title}
                  </h2>
                  <p className="mt-3 text-sm leading-7 text-[var(--color-ink-soft)]">
                    {course.summary}
                  </p>
                  <div className="mt-5 flex flex-wrap gap-2">
                    <Link
                      href={course.href ?? `/courses/${course.slug}`}
                      className="button-solid px-4 py-2.5 text-sm"
                    >
                      {t("learnWave2.wishlistHub.view")}
                    </Link>
                    <button
                      type="button"
                      disabled={removingId === item.id}
                      onClick={() => void handleRemove(item)}
                      className="button-outline px-4 py-2.5 text-sm"
                    >
                      {removingId === item.id ? t("learnWave2.wishlistHub.removing") : t("learnWave2.wishlistHub.remove")}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-5">
                <div className="grid size-12 place-items-center rounded-md bg-[var(--color-surface-soft)] text-[var(--color-primary)]">
                  <BookmarkX aria-hidden="true" size={22} />
                </div>
                <h2 className="mt-4 text-lg font-semibold text-[var(--color-primary)]">
                  {t("learnWave2.wishlistHub.unavailable")}
                </h2>
                <p className="mt-3 text-sm leading-7 text-[var(--color-ink-soft)]">
                  {t("learnWave2.wishlistHub.unavailableDetail")}
                </p>
                <button
                  type="button"
                  disabled={removingId === item.id}
                  onClick={() => void handleRemove(item)}
                  className="button-outline mt-5 px-4 py-2.5 text-sm"
                >
                  {removingId === item.id ? t("learnWave2.wishlistHub.removing") : t("learnWave2.wishlistHub.remove")}
                </button>
              </div>
            )}
          </article>
        );
      })}
    </section>
  );
}
