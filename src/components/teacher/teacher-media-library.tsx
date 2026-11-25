"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { isVideoAssetKind, type CourseAsset, type CourseAssetKind } from "@/domain/course-asset";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { PlatformPageHeader } from "@/components/platform/platform-page-header";
import { CardStackSkeleton } from "@/components/teacher/builder-skeleton";
import { getCourseAssetKindLabel } from "@/lib/i18n/course-assets";
import type { TeacherCourse } from "@/domain/teacher-course";
import { subscribeToCourseAssets } from "@/lib/data/course-assets";
import { subscribeToTeacherCourses } from "@/lib/data/teacher-courses";
import {
  EmptyState,
  Field,
  InlineAlert,
  buttonClasses,
} from "@/components/ui";

const assetKindFilters = [
  "all",
  "course_cover",
  "module_cover",
  "lesson_thumbnail",
  "lesson_material",
  "lesson_video",
  "live_recording",
] as const satisfies Array<CourseAssetKind | "all">;

function formatAssetSize(size: number, locale: string): string {
  const unit = size < 1024 ? 0 : size < 1024 ** 2 ? 1 : size < 1024 ** 3 ? 2 : 3;
  const decimals = unit === 0 || (unit === 3 && size % 1024 ** 3 === 0) ? 0 : 1;
  return `${new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(size / 1024 ** unit)} ${["B", "KB", "MB", "GB"][unit]}`;
}

export function TeacherMediaLibrary() {
  const { user } = useAuth();
  const { t, locale } = useTranslation();
  const [courses, setCourses] = useState<TeacherCourse[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState("");
  const [assets, setAssets] = useState<CourseAsset[]>([]);
  const [kindFilter, setKindFilter] = useState<CourseAssetKind | "all">("all");
  const [search, setSearch] = useState("");
  const [coursesFailed, setCoursesFailed] = useState(false);
  const [isLoadingCourses, setIsLoadingCourses] = useState(true);
  // Which course the file list arrived for (or failed). Before, the list
  // said "no files" before the files arrived and, when switching course,
  // showed the previous course's files until the new list came.
  const [assetsFor, setAssetsFor] = useState<string | null>(null);
  const [assetsFailedFor, setAssetsFailedFor] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const coursesSubscription = useRef<{ reload: () => Promise<void> } | null>(null);
  const assetsSubscription = useRef<{ reload: () => Promise<void> } | null>(null);

  // Only the user in the dependencies: choosing another course used to turn off and on
  // the courses channel and re-read the whole list, with nothing having changed.
  useEffect(() => {
    if (!user) {
      return;
    }

    const current = subscribeToTeacherCourses(
      user.uid,
      (nextCourses) => {
        setCourses(nextCourses);
        setCoursesFailed(false);
        setIsLoadingCourses(false);
        setSelectedCourseId((selected) => selected || nextCourses[0]?.id || "");
      },
      () => {
        setCoursesFailed(true);
        setIsLoadingCourses(false);
      },
    );
    coursesSubscription.current = current;
    return () => {
      coursesSubscription.current = null;
      current();
    };
  }, [user]);

  useEffect(() => {
    if (!selectedCourseId) {
      return;
    }

    const current = subscribeToCourseAssets(
      selectedCourseId,
      (nextAssets) => {
        setAssets(nextAssets);
        setAssetsFor(selectedCourseId);
        setAssetsFailedFor(null);
      },
      () => {
        setAssetsFailedFor(selectedCourseId);
      },
    );
    assetsSubscription.current = current;
    return () => {
      assetsSubscription.current = null;
      current();
    };
  }, [selectedCourseId]);

  const assetsFailed = Boolean(selectedCourseId) && assetsFailedFor === selectedCourseId;
  const error = coursesFailed
    ? "teacherMedia.coursesError"
    : assetsFailed
      ? "teacherMedia.assetsError"
      : "";

  // "Try again" re-reads through the same channels. Re-reading the files is
  // silent when it fails (the notice stays), so the button waits for the response.
  function retryLoad() {
    setRetrying(true);
    void Promise.allSettled([
      coursesFailed ? coursesSubscription.current?.reload() : undefined,
      assetsFailed ? assetsSubscription.current?.reload() : undefined,
    ]).finally(() => setRetrying(false));
  }

  const selectedCourse = courses.find((course) => course.id === selectedCourseId) ?? null;
  const filteredAssets = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase(locale);

    return assets.filter((asset) => {
      const matchesKind = kindFilter === "all" || asset.kind === kindFilter;
      const matchesSearch =
        !normalizedSearch ||
        asset.fileName.toLocaleLowerCase(locale).includes(normalizedSearch) ||
        getCourseAssetKindLabel(asset.kind, t).toLocaleLowerCase(locale).includes(normalizedSearch);

      return matchesKind && matchesSearch;
    });
  }, [assets, kindFilter, search, t, locale]);

  return (
    <div className="grid gap-6">
      {/* The page title was an h3 inside the card (the screen had no
          h1). Now it is the header of the sibling screens, outside the card. */}
      <PlatformPageHeader
        title={t("teacherMedia.title")}
        description={t("teacherMedia.description")}
        actions={
          selectedCourse ? (
            <Link
              href={`/teach/builder?courseId=${selectedCourse.id}`}
              // Outline: the library's empty state already has the strong button for the
              // same place.
              className={buttonClasses({ variant: "outline" })}
            >
              {t("teacherMedia.upload")}
            </Link>
          ) : null
        }
      />
    <section className="settings-section-card">
      <p className="max-w-2xl rounded-md border fine-rule bg-[var(--color-surface-soft)] px-4 py-3 text-sm font-semibold leading-6 text-[var(--color-ink)]">
        {t("teacherMedia.videosInBuilder")}
        {selectedCourse ? (
          <>
            {" — "}
            <Link
              href={`/teach/builder?courseId=${selectedCourse.id}&tab=content`}
              className="underline underline-offset-2"
            >
              {t("teacherMedia.openBuilder")}
            </Link>
          </>
        ) : (
          t("teacherMedia.createToAdd")
        )}
      </p>
      {courses.length > 0 ? (
        <div className="mt-6 grid gap-3 lg:grid-cols-[1fr_180px_220px]">
          <Field id="media-search" label={t("teacherMedia.search")}>
            {(a11y) => (
              <input
                {...a11y}
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("teacherMedia.searchPlaceholder")}
                className="field-input"
              />
            )}
          </Field>

          <Field id="media-kind" label={t("teacherMedia.type")}>
            {(a11y) => (
              <select
                {...a11y}
                value={kindFilter}
                onChange={(event) => setKindFilter(event.target.value as CourseAssetKind | "all")}
                className="field-input"
              >
                {assetKindFilters.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind === "all" ? t("teacherMedia.all") : getCourseAssetKindLabel(kind, t)}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <Field id="media-course" label={t("teacherMedia.course")}>
            {(a11y) => (
              <select
                {...a11y}
                value={selectedCourseId}
                onChange={(event) => setSelectedCourseId(event.target.value)}
                className="field-input"
              >
                {courses.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.title}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
      ) : null}

      {error ? (
        <div className="mt-5 grid gap-3">
          <InlineAlert tone="error">{t(error)}</InlineAlert>
          <button
            type="button"
            onClick={retryLoad}
            disabled={retrying}
            aria-busy={retrying}
            className={`${buttonClasses({ variant: "outline" })} justify-self-start`}
          >
            {t("appErrors.retry")}
          </button>
        </div>
      ) : null}

      <div className="mt-6 grid gap-3">
        {/* File cards (thumbnail + name) in place of a sentence in a card,
            that later became the whole list at once. */}
        {isLoadingCourses ? (
          <CardStackSkeleton label={t("teacherMedia.loading")} thumb />
        ) : courses.length === 0 ? (
          // A failure is not "you have no course": the error above with "Try again" is enough.
          coursesFailed ? null : <EmptyState
            as="h2"
            eyebrow={t("teacherMedia.noCourse")}
            title={t("teacherMedia.createFirst")}
            description={t("teacherMedia.noCourseDescription")}
            action={
              <>
                <Link href="/teach/builder?newCourse=1" className={buttonClasses()}>
                  {t("teacherMedia.create")}
                </Link>
                <Link href="/teach" className={buttonClasses({ variant: "outline" })}>
                  {t("teacherMedia.back")}
                </Link>
              </>
            }
          />
        ) : assetsFor !== selectedCourseId ? (
          // This course's files have not arrived yet (or failed: the error
          // above says so). No "no files" before we know.
          assetsFailed ? null : <CardStackSkeleton label={t("teacherMedia.loadingAssets")} thumb />
        ) : assets.length > 0 && filteredAssets.length === 0 ? (
          // There are files, but none matches the search or the type: this is not
          // the first time ("Upload from the builder."), it is "no results"
          // with the way back.
          <div className="grid justify-items-start gap-3 rounded-lg border fine-rule bg-[var(--color-surface-soft)] p-4">
            <p role="status" className="text-sm leading-6 text-[var(--color-ink-soft)]">{t("teacherMedia.noMatches")}</p>
            <button
              type="button"
              onClick={() => {
                setSearch("");
                setKindFilter("all");
              }}
              className="button-outline px-4 text-sm"
            >
              {t("teacherMedia.clearFilters")}
            </button>
          </div>
        ) : filteredAssets.length === 0 ? (
          <EmptyState
            as="h2"
            eyebrow={t("teacherMedia.ready")}
            title={t("teacherMedia.emptyTitle")}
            description={t("teacherMedia.emptyDescription")}
            action={
              selectedCourse ? (
                <Link
                  href={`/teach/builder?courseId=${selectedCourse.id}`}
                  className={buttonClasses()}
                >
                  {t("teacherMedia.openUploads")}
                </Link>
              ) : null
            }
          />
        ) : (
          filteredAssets.map((asset) => (
            <article
              key={asset.id}
              className="grid gap-4 rounded-lg border fine-rule bg-[var(--color-surface-soft)] p-4 md:grid-cols-[80px_1fr_auto]"
            >
              <div className="grid h-20 w-20 place-items-center overflow-hidden rounded-md border border-[var(--color-line)] bg-white text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-primary)]">
                {asset.downloadUrl && asset.contentType.startsWith("image/") ? (
                  // Covers and thumbnails live in the public bucket, so the URL is already
                  // on the row. Without the thumbnail, three covers named
                  // IMG_4821.jpg were three identical squares labeled "image".
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={asset.downloadUrl}
                    alt={`${getCourseAssetKindLabel(asset.kind, t)}: ${asset.fileName}`}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  t(`teacherMedia.fileTypes.${["image", "video", "audio", "application", "text"].includes(asset.contentType.split("/")[0]) ? asset.contentType.split("/")[0] : "file"}`)
                )}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-[var(--color-ink)]">
                  {asset.fileName}
                </p>
                <p className="mt-1 text-xs uppercase tracking-[0.12em] text-[var(--color-ink-soft)]">
                  {getCourseAssetKindLabel(asset.kind, t)} - {formatAssetSize(asset.size, locale)}
                </p>
              </div>
              <div className="flex flex-wrap items-start gap-2 md:justify-end">
                {/* "Preview" only applies to video (the sample lesson), as in the
                    studio. Material marked as a preview in the past stays closed. */}
                <span className="rounded-chip bg-white px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-primary)]">
                  {t(asset.isPreview && isVideoAssetKind(asset.kind) ? "teacherMedia.preview" : "teacherMedia.private")}
                </span>
                {asset.lessonId ? (
                  <span className="rounded-chip bg-white px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-ink-soft)]">
                    {t("teacherMedia.lessonAsset")}
                  </span>
                ) : null}
              </div>
            </article>
          ))
        )}
      </div>
    </section>
    </div>
  );
}
