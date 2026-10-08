"use client";

import { FileText } from "lucide-react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { ProtectedAssetDownload } from "@/components/shared/protected-asset-preview";
import type { CourseAsset } from "@/domain/course-asset";
import { compareCourseAssets, formatCourseAssetSize, getCourseAssetTitle } from "@/domain/course-asset";
import type { CourseModule, Lesson } from "@/domain/learning";

export type CourseMaterialGroups = {
  /** Arquivos do curso inteiro (sem aula), de cursos antigos. */
  courseFiles: CourseAsset[];
  modules: Array<{
    module: CourseModule;
    lessons: Array<{ lesson: Lesson; files: CourseAsset[] }>;
  }>;
  count: number;
};

/**
 * A aba Materiais: os arquivos de todas as aulas JÁ liberadas, por módulo e
 * aula, na ordem do currículo e na ordem que o professor deu. Antes ela só
 * listava arquivo do curso inteiro, que ninguém mais consegue enviar, e vivia
 * vazia.
 *
 * A RLS já não entrega a linha da aula fechada (20260915020000); o filtro pela
 * liberação da tela é a mesma regra, para nada aparecer antes de a aula abrir
 * na lista de aulas. Aula fora do currículo não entra.
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
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
            {t("learn.classroom.resources.title")}
          </p>
          <h2 className="mt-2 text-lg font-semibold text-[var(--color-primary)]">
            {t("learn.classroom.resources.heading")}
          </h2>
        </div>
        <span className="member-meta-chip">
          <FileText size={14} aria-hidden />
          {t(`learn.classroom.resources.${groups.count === 1 ? "fileOne" : "fileMany"}`).replace("{count}", () => String(groups.count))}
        </span>
      </div>
      {isLoading ? (
        <p className="mt-4 rounded-md bg-white px-3 py-2 text-sm text-[var(--color-ink-soft)]">
          {t("learn.classroom.resources.loading")}
        </p>
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

/** Uma linha por arquivo: nome, tamanho e o botão que baixa. */
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
            <ProtectedAssetDownload
              asset={asset}
              label={t("courseMedia.preview.downloadNamed").replace("{title}", () => title)}
              className={large ? "button-solid button-lg w-full sm:w-auto" : "button-solid px-4 text-sm"}
            />
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Mapa mental (.xmind, .mm) não abre no celular nem no computador sem um
 * programa próprio: quem baixava ficava com um arquivo "que não abre". Uma
 * linha diz qual programa gratuito usar.
 */
export function MaterialAppHint({ fileName }: { fileName: string }) {
  const { t } = useTranslation();
  const app = /\.(xmind|mm)$/i.exec(fileName)?.[1].toLowerCase();
  return app ? (
    <p className="mt-0.5 text-xs text-[var(--color-ink-soft)]">{t(`courseMedia.preview.openWith.${app}`)}</p>
  ) : null;
}
