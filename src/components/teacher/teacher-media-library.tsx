"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import type { CourseAsset, CourseAssetKind } from "@/domain/course-asset";
import {
  courseAssetKindLabels,
  formatCourseAssetSize,
} from "@/domain/course-asset";
import type { TeacherCourse } from "@/domain/teacher-course";
import { subscribeToCourseAssets } from "@/lib/data/course-assets";
import { subscribeToTeacherCourses } from "@/lib/data/teacher-courses";

const assetKindFilters = [
  "all",
  "course_cover",
  "module_cover",
  "lesson_thumbnail",
  "lesson_material",
  "lesson_video",
  "live_recording",
] as const satisfies Array<CourseAssetKind | "all">;

export function TeacherMediaLibrary() {
  const { user } = useAuth();
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
        setError("We could not load your courses.");
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
        setError("We could not load assets for this course.");
      },
    );
  }, [selectedCourseId]);

  const selectedCourse = courses.find((course) => course.id === selectedCourseId) ?? null;
  const filteredAssets = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return assets.filter((asset) => {
      const matchesKind = kindFilter === "all" || asset.kind === kindFilter;
      const matchesSearch =
        !normalizedSearch ||
        asset.fileName.toLowerCase().includes(normalizedSearch) ||
        courseAssetKindLabels[asset.kind].toLowerCase().includes(normalizedSearch);

      return matchesKind && matchesSearch;
    });
  }, [assets, kindFilter, search]);

  return (
    <section className="settings-section-card">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
            Media library
          </p>
          <h3 className="display-title mt-3 text-3xl text-[var(--color-primary)]">
            Course files and lesson assets
          </h3>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
            Review assets uploaded through the builder. Private lesson files stay protected;
            this library is for organization and course production control.
          </p>
          <p className="mt-3 max-w-2xl rounded-[10px] border fine-rule bg-[var(--color-surface-soft)] px-4 py-3 text-sm font-semibold leading-6 text-[var(--color-ink)]">
            Lesson videos live in the course builder
            {selectedCourse ? (
              <>
                {" — "}
                <Link
                  href={`/teach/builder?courseId=${selectedCourse.id}&tab=content`}
                  className="underline underline-offset-2"
                >
                  Open builder
                </Link>
              </>
            ) : (
              ". Create or open a course to add them."
            )}
          </p>
        </div>
        {selectedCourse ? (
          <Link
            href={`/teach/builder?courseId=${selectedCourse.id}`}
            className="button-solid px-4 py-2.5 text-sm"
          >
            Upload in builder
          </Link>
        ) : null}
      </div>

      {courses.length > 0 ? (
        <div className="mt-6 grid gap-3 lg:grid-cols-[1fr_180px_220px]">
          <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
            Search assets
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by filename or type"
              className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)]"
            />
          </label>

          <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
            Type
            <select
              value={kindFilter}
              onChange={(event) => setKindFilter(event.target.value as CourseAssetKind | "all")}
              className="rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)]"
            >
              {assetKindFilters.map((kind) => (
                <option key={kind} value={kind}>
                  {kind === "all" ? "All files" : courseAssetKindLabels[kind]}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
            Course
            <select
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
          </label>
        </div>
      ) : null}

      {error ? (
        <p className="mt-5 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]">
          {error}
        </p>
      ) : null}

      <div className="mt-6 grid gap-3">
        {isLoadingCourses ? (
          <p className="rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm leading-6 text-[var(--color-ink-soft)]">
            Loading media library...
          </p>
        ) : courses.length === 0 ? (
          <div className="rounded-[16px] border border-dashed border-[var(--color-line-strong)] bg-[var(--color-surface-soft)] p-6">
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
              No course container yet
            </p>
            <h4 className="display-title mt-3 text-3xl text-[var(--color-primary)]">
              Create a course before uploading files.
            </h4>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
              Media uploads stay attached to a course, module, or lesson. That
              keeps access rules clean for videos, PDFs, slides, docs, and
              private learner materials.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link href="/teach/builder?newCourse=1" className="button-solid px-4 py-2.5 text-sm">
                Create first course
              </Link>
              <Link href="/teach" className="button-outline px-4 py-2.5 text-sm">
                Back to Studio
              </Link>
            </div>
          </div>
        ) : filteredAssets.length === 0 ? (
          <div className="rounded-[16px] border border-dashed border-[var(--color-line-strong)] bg-[var(--color-surface-soft)] p-6">
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
              Library is ready
            </p>
            <h4 className="display-title mt-3 text-3xl text-[var(--color-primary)]">
              Upload from the builder.
            </h4>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
              Add a course cover, module cover, lesson video, PDF, slide deck,
              worksheet, audio file, or replay from the selected course builder.
            </p>
            {selectedCourse ? (
              <Link
                href={`/teach/builder?courseId=${selectedCourse.id}`}
                className="button-solid mt-5 px-4 py-2.5 text-sm"
              >
                Open builder upload area
              </Link>
            ) : null}
          </div>
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
                    alt={`${courseAssetKindLabels[asset.kind]}: ${asset.fileName}`}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  asset.contentType.split("/")[0] || "file"
                )}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-[var(--color-ink)]">
                  {asset.fileName}
                </p>
                <p className="mt-1 text-xs uppercase tracking-[0.12em] text-[var(--color-ink-soft)]">
                  {courseAssetKindLabels[asset.kind]} - {formatCourseAssetSize(asset.size)}
                </p>
              </div>
              <div className="flex flex-wrap items-start gap-2 md:justify-end">
                <span className="rounded-[8px] bg-white px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-primary)]">
                  {asset.isPreview ? "Preview" : "Private"}
                </span>
                {asset.lessonId ? (
                  <span className="rounded-[8px] bg-white px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-ink-soft)]">
                    Lesson asset
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
