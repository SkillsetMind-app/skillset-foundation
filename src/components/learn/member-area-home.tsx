"use client";

import { Lock, PlayCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { CourseCover } from "@/components/learn/course-unlock-modal";
import { MemberAreaShell } from "@/components/learn/member-area-shell";
import { classroomTabHref } from "@/domain/classroom-tabs";
import {
  getMemberAreaHome,
  memberAreaCoverUrl,
  type MemberAreaHome,
  type MemberAreaLockedProduct,
} from "@/lib/data/member-areas";

type State = { status: "loading" } | { status: "error" } | { status: "ready"; home: MemberAreaHome };

const cardClass =
  "group flex min-w-0 flex-col overflow-hidden rounded-lg border border-[var(--ma-line)] bg-[var(--ma-surface)] shadow-[var(--ma-shadow)]";
const actionClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold";

/** Quem não é aluno nem dono vai para a vitrine pública do criador. */
export function memberAreaStorefrontPath(ref: string): string {
  return ref.startsWith("@")
    ? `/@${encodeURIComponent(ref.slice(1))}`
    : `/instructors/${encodeURIComponent(ref)}`;
}

const classroomPath = (courseId: string) => `/learn/courses/${encodeURIComponent(courseId)}`;

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function priceLabel(product: MemberAreaLockedProduct, locale: string, free: string): string | null {
  if (product.paymentType === "free" || product.priceAmountMinor === 0) return free;
  if (product.priceAmountMinor === null || !product.currency) return null;
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency: product.currency.toUpperCase() })
      .format(product.priceAmountMinor / 100);
  } catch {
    return null;
  }
}

/** /learn/areas/[criador]: a área do criador para o aluno. Não libera aula: cada produto abre a própria sala. */
export function MemberAreaHomeView({ areaRef }: { areaRef: string }) {
  const { t, locale } = useTranslation();
  const router = useRouter();
  const [state, setState] = useState<State>({ status: "loading" });
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getMemberAreaHome(areaRef)
      .then((home) => {
        if (cancelled) return;
        if (!home) {
          router.replace(memberAreaStorefrontPath(areaRef));
          return;
        }
        setState({ status: "ready", home });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [areaRef, retryKey, router]);

  if (state.status !== "ready") {
    return (
      <MemberAreaShell>
        <div className="px-4 md:px-0">
          {state.status === "loading" ? (
            <p role="status" className="text-sm text-[var(--ma-ink-soft)]">{t("learn.memberArea.loading")}</p>
          ) : (
            <div role="alert" className="grid justify-items-start gap-3">
              <p className="text-sm text-[var(--ma-ink)]">{t("learn.memberArea.loadError")}</p>
              <button
                type="button"
                onClick={() => {
                  setState({ status: "loading" });
                  setRetryKey((current) => current + 1);
                }}
                className={`${actionClass} border border-[var(--ma-line)] text-[var(--ma-ink)]`}
              >
                {t("authFlow.loading.retry")}
              </button>
            </div>
          )}
        </div>
      </MemberAreaShell>
    );
  }

  const { area, continueWatching, myProducts, moreProducts } = state.home;
  const areaName = area.name ?? area.creatorName ?? "";
  const free = t("learn.memberArea.free");

  return (
    <MemberAreaShell theme={area.theme}>
      <div className="grid gap-8 px-4 md:px-0">
        {area.isOwnerPreview ? (
          <p className="rounded-md border border-[var(--ma-line)] bg-[var(--ma-surface-2)] px-4 py-3 text-sm text-[var(--ma-ink-soft)]">
            {t("learn.memberArea.ownerPreview")}{" "}
            <Link href="/teach/member-area" className="font-semibold text-[var(--ma-accent)] underline-offset-2 hover:underline">
              {t("learn.memberArea.editArea")}
            </Link>
          </p>
        ) : null}

        <header className="overflow-hidden rounded-lg border border-[var(--ma-line)] bg-[var(--ma-surface)]">
          {area.coverPath ? (
            <div className="relative aspect-video max-h-[min(40svh,22rem)] w-full overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={memberAreaCoverUrl(area.coverPath)} alt="" className="h-full w-full object-cover" />
            </div>
          ) : null}
          <div className="grid gap-2 p-5 sm:p-7">
            <h1 className="display-title text-3xl text-[var(--ma-ink)] sm:text-4xl">{areaName}</h1>
            {area.creatorName && area.creatorName !== areaName ? (
              <p className="text-sm text-[var(--ma-ink-soft)]">
                {t("learn.memberArea.byCreator").replace("{name}", () => area.creatorName ?? "")}
              </p>
            ) : null}
            {area.welcomeText ? (
              <p className="max-w-3xl whitespace-pre-line break-words text-base leading-7 text-[var(--ma-ink-soft)]">
                {area.welcomeText}
              </p>
            ) : null}
          </div>
        </header>

        <section aria-labelledby="area-continue-title" className="grid gap-3">
          <h2 id="area-continue-title" className="text-xl font-semibold text-[var(--ma-ink)]">
            {t("learn.memberArea.continueTitle")}
          </h2>
          {continueWatching ? (
            <Link
              href={classroomTabHref(classroomPath(continueWatching.courseId), "lesson", continueWatching.lessonId)}
              className="flex min-w-0 items-center gap-4 rounded-lg border border-[var(--ma-line)] bg-[var(--ma-surface)] p-4 hover:border-[var(--ma-accent)]"
            >
              <PlayCircle aria-hidden="true" size={32} className="shrink-0 text-[var(--ma-accent)]" />
              <span className="min-w-0">
                <span className="block truncate text-base font-semibold text-[var(--ma-ink)]">
                  {t("learn.memberArea.resumeLesson").replace("{title}", () => continueWatching.lessonTitle)}
                </span>
                <span className="block truncate text-sm text-[var(--ma-ink-soft)]">
                  {continueWatching.courseTitle}
                  {continueWatching.positionSeconds > 0
                    ? ` · ${t("learn.memberArea.resumeAt").replace("{time}", () => formatTime(continueWatching.positionSeconds))}`
                    : ""}
                </span>
              </span>
            </Link>
          ) : (
            <p className="text-sm text-[var(--ma-ink-soft)]">{t("learn.memberArea.continueEmpty")}</p>
          )}
        </section>

        <section aria-labelledby="area-mine-title" className="grid gap-3">
          <h2 id="area-mine-title" className="text-xl font-semibold text-[var(--ma-ink)]">
            {t("learn.memberArea.myProducts")}
          </h2>
          {myProducts.length === 0 ? (
            <p className="text-sm text-[var(--ma-ink-soft)]">{t("learn.memberArea.myProductsEmpty")}</p>
          ) : (
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {myProducts.map((product) => (
                <li key={product.courseId} className={cardClass}>
                  <Link href={classroomPath(product.courseId)} className="flex min-w-0 flex-1 flex-col">
                    <span className="relative block aspect-video overflow-hidden">
                      <CourseCover course={{ coverImageUrl: product.coverImageUrl, title: product.title }} sizes="(max-width: 640px) 100vw, 33vw" />
                    </span>
                    <span className="grid gap-2 p-4">
                      <span className="line-clamp-2 break-words text-base font-semibold text-[var(--ma-ink)]">{product.title}</span>
                      <span className="h-1.5 overflow-hidden rounded-full bg-[var(--ma-surface-2)]" aria-hidden="true">
                        <span
                          className="block h-full rounded-full bg-[var(--ma-accent)]"
                          style={{ width: `${Math.max(0, Math.min(100, product.progressPercent))}%` }}
                        />
                      </span>
                      <span className="text-xs text-[var(--ma-ink-soft)]">
                        {t("learn.memberArea.progress").replace("{percent}", () => String(Math.round(product.progressPercent)))}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="area-more-title" className="grid gap-3">
          <h2 id="area-more-title" className="text-xl font-semibold text-[var(--ma-ink)]">
            {t("learn.memberArea.moreProducts")}
          </h2>
          {moreProducts.length === 0 ? (
            <p className="text-sm text-[var(--ma-ink-soft)]">{t("learn.memberArea.moreProductsEmpty")}</p>
          ) : (
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {moreProducts.map((product) => {
                const price = priceLabel(product, locale, free);
                return (
                  <li key={product.courseId} className={cardClass}>
                    <span className="relative block aspect-video overflow-hidden">
                      <CourseCover course={{ coverImageUrl: product.coverImageUrl, title: product.title }} sizes="(max-width: 640px) 100vw, 33vw" />
                      <span className="absolute inset-0 bg-black/45" aria-hidden="true" />
                      <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-black/70 px-2.5 py-1 text-xs font-semibold text-white">
                        <Lock aria-hidden="true" size={13} />
                        {t("learn.memberArea.locked")}
                      </span>
                    </span>
                    <span className="grid flex-1 content-between gap-3 p-4">
                      <span className="grid gap-1">
                        <span className="line-clamp-2 break-words text-base font-semibold text-[var(--ma-ink)]">{product.title}</span>
                        {price ? <span className="text-sm text-[var(--ma-ink-soft)]">{price}</span> : null}
                      </span>
                      <Link
                        href={`/courses/${encodeURIComponent(product.salesKey)}`}
                        className={`${actionClass} bg-[var(--ma-accent)] text-[var(--ma-on-accent)] hover:bg-[var(--ma-accent-hover)]`}
                      >
                        {t("learn.memberArea.viewProduct")}
                      </Link>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </MemberAreaShell>
  );
}
