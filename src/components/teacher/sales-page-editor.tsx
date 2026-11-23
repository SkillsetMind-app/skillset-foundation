"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "@/components/i18n/i18n-provider";

import { PanelCard } from "@/components/teacher/course-commerce-panels";
import { SaveStatusLine } from "@/components/teacher/save-status-line";
import type { DripStrategy } from "@/domain/drip-policy";
import { DEFAULT_PLATFORM_FEE_BPS } from "@/lib/payments/rules";
import type { TeacherCourse } from "@/domain/teacher-course";
import { normalizeLearningOutcomes } from "@/domain/teacher-course";
import { updateTeacherCourseBuilder } from "@/lib/data/teacher-courses";

const DEFAULT_DRIP: DripStrategy = "instant";

/**
 * Lightweight "sales page builder" — not a freeform block editor (Hotmart-scale).
 * Edits the fields that drive the public product page: title, summary, outcomes.
 * Full drag-drop page builder remains P2; this covers the critical producer path.
 */
export function SalesPageEditor({
  course,
  onDirtyChange,
}: {
  course: TeacherCourse;
  /** O mesmo "Unsaved changes" da linha ao lado do Save, para o aviso de sair. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(course.title ?? "");
  const [summary, setSummary] = useState(course.summary ?? "");
  const [outcomesText, setOutcomesText] = useState(
    (course.learningOutcomes ?? []).join("\n"),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // O que está na tela contra o que o servidor confirmou por último: "Saved"
  // só vale enquanto os dois são iguais.
  const draft = JSON.stringify([title, summary, outcomesText]);
  const [savedDraft, setSavedDraft] = useState(draft);
  const dirty = draft !== savedDraft;
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  function handleSave(event: FormEvent) {
    event.preventDefault();
    void save();
  }

  async function save() {
    const sent = draft;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const learningOutcomes = normalizeLearningOutcomes(
        outcomesText
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
      );
      await updateTeacherCourseBuilder(course.id, {
        title: title.trim() || course.title,
        summary: summary.trim() || course.summary,
        category: course.category || "Other",
        categories: course.categories ?? [],
        learningOutcomes,
        modules: course.modules ?? [],
        // Mesma leitura do construtor: sem forma gravada e sem valor e gratis.
        // Mandar "pagamento unico a 0" num produto no ar era recusado
        // (PAID_PRODUCT_NEEDS_PRICE) e o texto nao salvava.
        paymentType: course.paymentType ?? (course.priceAmountMinor ? "one_time" : "free"),
        priceAmountMinor: course.priceAmountMinor ?? null,
        currency: course.currency ?? "USD",
        installmentsEnabled: Boolean(course.installmentsEnabled),
        installmentsMax: course.installmentsMax ?? 1,
        platformFeeBps: course.platformFeeBps ?? DEFAULT_PLATFORM_FEE_BPS,
        dripStrategy: (course.dripStrategy as DripStrategy | undefined) ?? DEFAULT_DRIP,
        dripIntervalDays: course.dripIntervalDays ?? 7,
        freePreviewLessonId: course.freePreviewLessonId ?? null,
        membersTheme: course.membersTheme ?? null,
        membersCoverAssetId: course.membersCoverAssetId ?? null,
        membersTitle: course.membersTitle ?? null,
        membersSubtitle: course.membersSubtitle ?? null,
        membersDescription: course.membersDescription ?? null,
        communityEnabled: Boolean(course.communityEnabled),
      });
      setSavedDraft(sent);
      setNotice("teacherSalesCopy.saved");
    } catch (saveError) {
      const reasons: Record<string, string> = {
        "This course status cannot be edited from the builder.": "teacherSalesCopy.statusError",
        "Course title is not specific enough.": "teacherSalesCopy.titleError",
        "A course with this title already exists. Choose a more specific name.": "courseCreation.duplicateError",
      };
      const message = saveError instanceof Error ? saveError.message : "";
      setError(Object.hasOwn(reasons, message) ? reasons[message] : "teacherSalesCopy.saveError");
    } finally {
      setSaving(false);
    }
  }

  return (
    <PanelCard
      title={t("teacherSalesCopy.title")}
      description={t("teacherSalesCopy.description")}
    >
      <form className="mt-4 grid gap-4" onSubmit={handleSave}>
        <label className="grid gap-1.5 text-sm">
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
            {t("teacherSalesCopy.productTitle")}
          </span>
          <input
            className="rounded-md border border-[var(--color-line)] bg-white px-3.5 py-2.5 text-sm outline-none focus:border-[var(--color-primary-light)]"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            required
          />
        </label>
        <label className="grid gap-1.5 text-sm">
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
            {t("teacherSalesCopy.summary")}
          </span>
          <textarea
            className="min-h-[120px] rounded-md border border-[var(--color-line)] bg-white px-3.5 py-2.5 text-sm outline-none focus:border-[var(--color-primary-light)]"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            maxLength={2000}
            required
          />
        </label>
        <label className="grid gap-1.5 text-sm">
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
            {t("teacherSalesCopy.outcomes")}
          </span>
          <textarea
            className="min-h-[100px] rounded-md border border-[var(--color-line)] bg-white px-3.5 py-2.5 text-sm outline-none focus:border-[var(--color-primary-light)]"
            value={outcomesText}
            onChange={(e) => setOutcomesText(e.target.value)}
            placeholder={t("teacherSalesCopy.outcomesPlaceholder")}
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          {/* Contorno: na seção Page o único botão cheio é o "Save page" do
              editor de blocos logo abaixo. */}
          <button type="submit" className="button-outline px-4 py-2 text-xs" disabled={saving}>
            {t(saving ? "teacherSalesCopy.saving" : "teacherSalesCopy.save")}
          </button>
          <a
            href={`/courses/${encodeURIComponent(course.id)}`}
            className="button-outline px-4 py-2 text-xs"
            target="_blank"
            rel="noreferrer"
          >
            {t("teacherSalesCopy.preview")}
          </a>
          <SaveStatusLine
            saving={saving}
            dirty={dirty}
            savedText={notice ? t(notice) : undefined}
            errorText={error ? t(error) : undefined}
            onRetry={() => void save()}
          />
        </div>
      </form>
    </PanelCard>
  );
}
