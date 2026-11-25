"use client";

import { FileText } from "lucide-react";
import { useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { ProtectedAssetDownload, ProtectedAssetPreview } from "@/components/shared/protected-asset-preview";
import type { CourseAsset } from "@/domain/course-asset";
import { compareCourseAssets, formatCourseAssetSize, getCourseAssetTitle } from "@/domain/course-asset";
import type { CourseModule, Lesson } from "@/domain/learning";

export type CourseMaterialGroups = {
  /** Files of the whole course (no lesson), from old courses. */
  courseFiles: CourseAsset[];
  modules: Array<{
    module: CourseModule;
    lessons: Array<{ lesson: Lesson; files: CourseAsset[] }>;
  }>;
  count: number;
};

/**
 * The Materials tab: the files of all the lessons ALREADY unlocked, by module and
 * lesson, in curriculum order and in the order the teacher gave. Before, it only
 * listed whole-course files, which nobody can upload anymore, and lived
 * vazia.
 *
 * RLS already does not deliver the closed lesson's row (20260915020000); filtering by the
 * screen's unlock is the same rule, so nothing shows up before the lesson opens
 * in the lesson list. A lesson outside the curriculum does not come in.
 */
export function groupReleasedMaterials(
  modules: CourseModule[],
  assets: CourseAsset[],
  isReleased: (lessonId: string) => boolean,
): CourseMaterialGroups {
  const files = assets.filter((asset) => asset.kind === "lesson_material").sort(compareCourseAssets);
  const courseFiles = files.filter((asset) => !asset.lessonId && !asset.moduleId);
  const grouped = modules
    .map((module) => ({
      module,
      lessons: module.lessons
        .filter((lesson) => isReleased(lesson.id))
        .map((lesson) => ({ lesson, files: files.filter((asset) => asset.lessonId === lesson.id) }))
        .filter((entry) => entry.files.length > 0),
    }))
    .filter((entry) => entry.lessons.length > 0);
  const count = courseFiles.length
    + grouped.reduce((total, entry) => total + entry.lessons.reduce((sum, lesson) => sum + lesson.files.length, 0), 0);

  return { courseFiles, modules: grouped, count };
}

export function CourseMaterialsPanel({
  groups,
  isLoading,
}: {
  groups: CourseMaterialGroups;
  isLoading: boolean;
}) {
  const { t } = useTranslation();

  return (
    <section className="member-resource-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        {/* No "N files" badge: the "Materials N" tab right above already says it. */}
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
            {t("learn.classroom.resources.title")}
          </p>
          <h2 className="mt-2 text-lg font-semibold text-[var(--color-primary)]">
            {t("learn.classroom.resources.heading")}
          </h2>
        </div>
      </div>
      {isLoading ? (
        // The wait with the shape of the file rows, in the classroom's bone color
        // (--ma-line), and the sentence only for the screen reader.
        <div role="status" className="mt-5 grid gap-2">
          <span className="sr-only">{t("learn.classroom.resources.loading")}</span>
          {[0, 1].map((row) => (
            <div key={row} aria-hidden="true" className="h-16 rounded-lg bg-[var(--ma-line,var(--color-surface-strong))] motion-safe:animate-pulse" />
          ))}
        </div>
      ) : groups.count === 0 ? (
        <p className="mt-4 rounded-md bg-white px-3 py-2 text-sm text-[var(--color-ink-soft)]">
          {t("learn.classroom.resources.empty")}
        </p>
      ) : (
        <div className="mt-5 grid gap-6">
          {groups.courseFiles.length > 0 ? (
            <div>
              <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-[var(--color-ink-soft)]">
                {t("learn.classroom.resources.courseFiles")}
              </h3>
              <MaterialFileList files={groups.courseFiles} />
            </div>
          ) : null}
          {groups.modules.map(({ module, lessons }) => (
            <div key={module.id}>
              <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-[var(--color-ink-soft)]">
                {module.title}
              </h3>
              {lessons.map(({ lesson, files }) => (
                <div key={lesson.id} className="mt-3">
                  <h4 className="text-base font-semibold text-[var(--color-ink)]">{lesson.title}</h4>
                  <MaterialFileList files={files} />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** One row per file: name, size and the button that downloads. */
export function MaterialFileList({ files, large = false }: { files: CourseAsset[]; large?: boolean }) {
  const { t } = useTranslation();
  return (
    <ul className="mt-2 grid gap-2">
      {files.map((asset) => {
        const title = getCourseAssetTitle(asset);
        return (
          <li
            key={asset.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--color-line)] bg-white p-3"
          >
            <div className="flex min-w-0 items-center gap-3">
              <FileText aria-hidden="true" size={large ? 24 : 18} className="shrink-0 text-[var(--color-primary)]" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[var(--color-ink)] [overflow-wrap:anywhere]">{title}</p>
                <p className="mt-0.5 text-xs text-[var(--color-ink-soft)]">{formatCourseAssetSize(asset.size)}</p>
                <MaterialAppHint fileName={asset.fileName} />
              </div>
            </div>
            {/* Solid button only on a lesson that is just the file (`large`). In the list,
                outline: ten files were ten identical solid buttons. */}
            <ProtectedAssetDownload
              asset={asset}
              label={t("courseMedia.preview.downloadNamed").replace("{title}", () => title)}
              className={large ? "button-solid button-lg w-full sm:w-auto" : "button-outline px-4 text-sm"}
            />
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Actions for an attachment inside the lesson: "Preview" and "Download", discreet. The
 * preview (320px PDF, image, extra video) only mounts when the person asks:
 * before, every attachment came already open and three PDFs added up to ~1,100px of embedded
 * document, besides one link request per file when opening the lesson.
 *
 * A single button, which swaps the label and the aria-expanded: swapping the element
 * took keyboard focus away and the screen reader lost its place.
 */
export function LessonAssetActions({ asset }: { asset: CourseAsset }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const title = getCourseAssetTitle(asset);
  const type = asset.contentType;
  const isVideo = type.startsWith("video/");
  // Audio and text have no embedded preview: open, it shows "Open file" (the
  // mp3 plays in the browser) and "Download", as before.
  const previewable = /^(video|image|audio|text)\//.test(type) || type === "application/pdf";

  // The other types (docx, mind map...) stay as they were: "Open file" and
  // "Download" right away. Nothing the person did before goes away.
  if (!previewable) {
    return <ProtectedAssetPreview asset={asset} />;
  }

  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-expanded={open}
          aria-label={t(open ? "courseMedia.preview.hideNamed" : "courseMedia.preview.showNamed").replace("{title}", () => title)}
          onClick={() => setOpen((current) => !current)}
          className="button-outline px-4 py-2 text-xs"
        >
          {t(open ? "courseMedia.preview.hide" : "courseMedia.preview.show")}
        </button>
        {/* Open, the image, PDF, audio and text preview already brings its own
            "Download"; the video one (just the player) does not. */}
        {open && !isVideo ? null : (
          <ProtectedAssetDownload
            asset={asset}
            label={t("courseMedia.preview.downloadNamed").replace("{title}", () => title)}
            className="button-outline px-4 py-2 text-xs"
          />
        )}
      </div>
      {open ? <ProtectedAssetPreview asset={asset} /> : null}
    </div>
  );
}

/**
 * A mind map (.xmind, .mm) does not open on the phone or the computer without its
 * own program: whoever downloaded it was left with a file that "does not open". A
 * line says which free program to use.
 */
export function MaterialAppHint({ fileName }: { fileName: string }) {
  const { t } = useTranslation();
  const app = /\.(xmind|mm)$/i.exec(fileName)?.[1].toLowerCase();
  return app ? (
    <p className="mt-0.5 text-xs text-[var(--color-ink-soft)]">{t(`courseMedia.preview.openWith.${app}`)}</p>
  ) : null;
}
