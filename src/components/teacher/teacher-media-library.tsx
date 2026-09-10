"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import type { CourseAsset, CourseAssetKind } from "@/domain/course-asset";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { getCourseAssetKindLabel } from "@/lib/i18n/course-assets";
import type { TeacherCourse } from "@/domain/teacher-course";
import { subscribeToCourseAssets } from "@/lib/data/course-assets";
import { subscribeToTeacherCourses } from "@/lib/data/teacher-courses";
import {
  EmptyState,
  Field,
  InlineAlert,
  SectionHeader,
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
  const [error, setError] = useState("");
  const [isLoadingCourses, setIsLoadingCourses] = useState(true);

  useEffect(() => {
    if (!user) {
      return;
    }

    return subscribeToTeacherCourses(
      user.uid,
      (nextCourses) => {
        setCourses(nextCourses);
        setIsLoadingCourses(false);

        if (!selectedCourseId && nextCourses[0]) {
          setSelectedCourseId(nextCourses[0].id);
        }
      },
      () => {
        setError("teacherMedia.coursesError");
        setIsLoadingCourses(false);
      },
    );
  }, [selectedCourseId, user]);

  useEffect(() => {
    if (!selectedCourseId) {
      return;
    }

    return subscribeToCourseAssets(
      selectedCourseId,
      (nextAssets) => {
        setAssets(nextAssets);
      },
      () => {
        setError("teacherMedia.assetsError");
      },
    );
  }, [selectedCourseId]);

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
    <section className="settings-section-card">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <SectionHeader
            as="h3"
            eyebrow={t("teacherMedia.eyebrow")}
            title={t("teacherMedia.title")}
            description={t("teacherMedia.description")}
          />
          <p className="mt-3 max-w-2xl rounded-[10px] border fine-rule bg-[var(--color-surface-soft)] px-4 py-3 text-sm font-semibold leading-6 text-[var(--color-ink)]">
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
        </div>
        {selectedCourse ? (
          <Link
            href={`/teach/builder?courseId=${selectedCourse.id}`}
            className={buttonClasses()}
          >
            {t("teacherMedia.upload")}
          </Link>
        ) : null}
      </div>

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
                className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)]"
              />
            )}
          </Field>

          <Field id="media-kind" label={t("teacherMedia.type")}>
            {(a11y) => (
              <select
                {...a11y}
                value={kindFilter}
                onChange={(event) => setKindFilter(event.target.value as CourseAssetKind | "all")}
                className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)]"
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
                className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)]"
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
        <InlineAlert tone="error" className="mt-5">
          {t(error)}
        </InlineAlert>
      ) : null}

      <div className="mt-6 grid gap-3">
        {isLoadingCourses ? (
          <p className="rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm leading-6 text-[var(--color-ink-soft)]">
            {t("teacherMedia.loading")}
          </p>
        ) : courses.length === 0 ? (
          <EmptyState
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
        ) : filteredAssets.length === 0 ? (
          <EmptyState
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
              className="grid gap-4 rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4 md:grid-cols-[80px_1fr_auto]"
            >
              <div className="grid h-20 w-20 place-items-center overflow-hidden rounded-[10px] border border-[var(--color-line)] bg-white text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-primary)]">
                {asset.downloadUrl && asset.contentType.startsWith("image/") ? (
                  // Capas e thumbnails vivem no bucket público, então a URL já
                  // está na linha. Sem a miniatura, três capas chamadas
                  // IMG_4821.jpg eram três quadrados idênticos escritos "image".
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
                <span className="rounded-[8px] bg-white px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-primary)]">
                  {t(asset.isPreview ? "teacherMedia.preview" : "teacherMedia.private")}
                </span>
                {asset.lessonId ? (
                  <span className="rounded-[8px] bg-white px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-ink-soft)]">
                    {t("teacherMedia.lessonAsset")}
                  </span>
                ) : null}
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
