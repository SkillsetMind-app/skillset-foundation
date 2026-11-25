"use client";

import { Lock, MessagesSquare, PlayCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { CourseCover } from "@/components/learn/course-unlock-modal";
import { MemberAreaShell, type MemberAreaBrand } from "@/components/learn/member-area-shell";
import { ProgressBar } from "@/components/ui/progress-bar";
import { classroomTabHref } from "@/domain/classroom-tabs";
import {
  getMemberAreaCommunity,
  getMemberAreaHome,
  memberAreaCoverUrl,
  memberAreaRoutePath,
  rememberMemberAreaTheme,
  rememberedMemberAreaTheme,
  type MemberAreaCommunity,
  type MemberAreaHome,
  type MemberAreaLockedProduct,
} from "@/lib/data/member-areas";

type State =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; home: MemberAreaHome; community: MemberAreaCommunity | null };

const cardClass =
  "group flex min-w-0 flex-col overflow-hidden rounded-lg border border-[var(--ma-line)] bg-[var(--ma-surface)] shadow-[var(--ma-shadow)]";
const actionClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold";

/** Whoever is neither a learner nor the owner goes to the creator's public storefront. */
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

function priceLabel(
  product: MemberAreaLockedProduct,
  locale: string,
  labels: { free: string; month: string; year: string },
): string | null {
  if (product.paymentType === "free" || product.priceAmountMinor === 0) return labels.free;
  if (product.priceAmountMinor === null || !product.currency) return null;
  try {
    const amount = new Intl.NumberFormat(locale, { style: "currency", currency: product.currency.toUpperCase() })
      .format(product.priceAmountMinor / 100);
    // Same format as the sales page: "$19.00 / month".
    if (product.paymentType === "subscription_monthly") return `${amount} / ${labels.month}`;
    if (product.paymentType === "subscription_yearly") return `${amount} / ${labels.year}`;
    return amount;
  } catch {
    return null;
  }
}

// A skeleton in the shape of the finished area: a cover with a title and three cards. Before,
// it was a loose sentence, and the whole page came together at once. The skeleton color
// follows the theme when it is already known (--ma-line) and falls back to the platform
// gray in the neutral frame.
const bone = "animate-pulse rounded-lg bg-[var(--ma-line,var(--color-surface-strong))]";

export function MemberAreaHomeSkeleton({ label }: { label: string }) {
  return (
    <div className="grid gap-8">
      <p role="status" className="sr-only">{label}</p>
      <div aria-hidden="true" className="grid gap-3">
        <div className={`aspect-video max-h-[min(40svh,22rem)] w-full ${bone}`} />
        <div className={`h-9 w-2/3 max-w-sm ${bone}`} />
      </div>
      <div aria-hidden="true" className="grid gap-3">
        <div className={`h-6 w-40 ${bone}`} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((item) => (
            <div key={item} className={`aspect-[4/3] ${bone}`} />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * /learn/areas/[criador] (and /[area] on an extra one): the creator's area for the
 * learner. It does not unlock lessons: each product opens its own room.
 */
export function MemberAreaHomeView({
  areaRef,
  slug = null,
  brand = null,
}: {
  areaRef: string;
  slug?: string | null;
  brand?: MemberAreaBrand | null;
}) {
  const { t, locale } = useTranslation();
  const router = useRouter();
  const [state, setState] = useState<State>({ status: "loading" });
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // The area's community is an extra: if it fails, the area opens without the card.
    Promise.all([getMemberAreaHome(areaRef, slug), getMemberAreaCommunity(areaRef, slug).catch(() => null)])
      .then(([home, community]) => {
        if (cancelled) return;
        if (!home) {
          router.replace(memberAreaStorefrontPath(areaRef));
          return;
        }
        rememberMemberAreaTheme(areaRef, slug, home.area.theme);
        setState({ status: "ready", home, community });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [areaRef, slug, retryKey, router]);

  if (state.status !== "ready") {
    // The theme only arrives with the read: until then the last one seen in this area applies, or
    // the neutral frame (null). The error keeps the default light theme from before.
    const remembered = rememberedMemberAreaTheme(areaRef, slug);
    return (
      <MemberAreaShell brand={brand} theme={state.status === "loading" ? remembered : remembered ?? undefined}>
        <div className="px-4 md:px-0">
          {state.status === "loading" ? (
            <MemberAreaHomeSkeleton label={t("learn.memberArea.loading")} />
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
  const { community } = state;
  const areaName = area.name ?? area.creatorName ?? "";
  const priceLabels = {
    free: t("learn.memberArea.free"),
    month: t("publicCourses.month"),
    year: t("publicCourses.year"),
  };

  return (
    <MemberAreaShell theme={area.theme} brand={brand}>
      <div className="grid gap-8 px-4 md:px-0">
        {area.isOwnerPreview ? (
          <p className="rounded-md border border-[var(--ma-line)] bg-[var(--ma-surface-2)] px-4 py-3 text-sm text-[var(--ma-ink-soft)]">
            {t("learn.memberArea.ownerPreview")}{" "}
            <Link href="/teach/member-area" className="font-semibold text-[var(--ma-accent-ink)]! underline-offset-2 hover:underline">
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

        {community ? (
          <Link
            href={`${memberAreaRoutePath(areaRef, slug)}/community`}
            className="flex min-w-0 items-center gap-4 rounded-lg border border-[var(--ma-line)] bg-[var(--ma-surface)] p-4 hover:border-[var(--ma-accent)]"
          >
            <MessagesSquare aria-hidden="true" size={32} className="shrink-0 text-[var(--ma-accent)]" />
            <span className="min-w-0">
              <span className="block truncate text-base font-semibold text-[var(--ma-ink)]">
                {t("learn.memberArea.communityTitle")}
              </span>
              <span className="block truncate text-sm text-[var(--ma-ink-soft)]">
                {t("learn.memberArea.communityBody").replace("{name}", () => area.creatorName ?? areaName)}
              </span>
            </span>
            {/* 14px text: --ma-accent is a button background (2.9:1 on a dark
                course); the readable highlight text is --ma-accent-ink. */}
            <span className="ml-auto hidden shrink-0 text-sm font-semibold text-[var(--ma-accent-ink)] sm:inline">
              {t("learn.memberArea.communityOpen")}
            </span>
          </Link>
        ) : null}

        {/* An empty section goes away: a title and "nothing here" below were a whole
            section with no content. Only "My products" stays with the empty notice. */}
        {continueWatching ? (
          <section aria-labelledby="area-continue-title" className="grid gap-3">
            <h2 id="area-continue-title" className="text-xl font-semibold text-[var(--ma-ink)]">
              {t("learn.memberArea.continueTitle")}
            </h2>
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
          </section>
        ) : null}

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
                  <Link
                    href={classroomPath(product.courseId)}
                    className="flex min-w-0 flex-1 flex-col rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ma-accent)]"
                  >
                    <span className="relative block aspect-video overflow-hidden">
                      <CourseCover course={{ coverImageUrl: product.coverImageUrl, title: product.title }} sizes="(max-width: 640px) 100vw, 33vw" />
                    </span>
                    <span className="grid gap-2 p-4">
                      <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ma-ink-soft)]">
                        {t(`courseCreation.types.${product.productFormat ?? "course"}.label`)}
                      </span>
                      <span className="line-clamp-2 break-words text-base font-semibold text-[var(--ma-ink)]">{product.title}</span>
                      {/* The house bar (ui/progress-bar), in the area's colors, and
                          announced as a bar. The number written below is the
                          same label as the bar: it stays out of the tree so the name of the
                          card does not say the progress twice. */}
                      <ProgressBar
                        value={product.progressPercent}
                        label={t("learn.memberArea.progress").replace("{percent}", () => String(Math.round(product.progressPercent)))}
                        className="bg-[var(--ma-surface-2)]"
                        fillClassName="bg-[var(--ma-accent)]"
                      />
                      <span aria-hidden="true" className="text-xs text-[var(--ma-ink-soft)]">
                        {t("learn.memberArea.progress").replace("{percent}", () => String(Math.round(product.progressPercent)))}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {moreProducts.length > 0 ? (
          <section aria-labelledby="area-more-title" className="grid gap-3">
            <h2 id="area-more-title" className="text-xl font-semibold text-[var(--ma-ink)]">
              {t("learn.memberArea.moreProducts")}
            </h2>
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {moreProducts.map((product) => {
                const price = priceLabel(product, locale, priceLabels);
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
                        className={`${actionClass} bg-[var(--ma-accent)] text-[var(--ma-on-accent)]! hover:bg-[var(--ma-accent-hover)]`}
                      >
                        {t("learn.memberArea.viewProduct")}
                      </Link>
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
      </div>
    </MemberAreaShell>
  );
}
