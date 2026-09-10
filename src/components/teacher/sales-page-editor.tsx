"use client";

import { useState, type FormEvent } from "react";
import { useTranslation } from "@/components/i18n/i18n-provider";

import { PanelCard } from "@/components/teacher/course-commerce-panels";
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
export function SalesPageEditor({ course }: { course: TeacherCourse }) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(course.title ?? "");
  const [summary, setSummary] = useState(course.summary ?? "");
  const [outcomesText, setOutcomesText] = useState(
    (course.learningOutcomes ?? []).join("\n"),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function handleSave(event: FormEvent) {
    event.preventDefault();
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
        paymentType: course.paymentType ?? "one_time",
        priceAmountMinor: course.priceAmountMinor ?? 0,
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
      setNotice("teacherSalesCopy.saved");
    } catch {
      setError("teacherSalesCopy.saveError");
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
            className="rounded-[10px] border border-[var(--color-line)] bg-white px-3.5 py-2.5 text-sm outline-none focus:border-[var(--color-primary-light)]"
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
            className="min-h-[120px] rounded-[10px] border border-[var(--color-line)] bg-white px-3.5 py-2.5 text-sm outline-none focus:border-[var(--color-primary-light)]"
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
            className="min-h-[100px] rounded-[10px] border border-[var(--color-line)] bg-white px-3.5 py-2.5 text-sm outline-none focus:border-[var(--color-primary-light)]"
            value={outcomesText}
            onChange={(e) => setOutcomesText(e.target.value)}
            placeholder={t("teacherSalesCopy.outcomesPlaceholder")}
          />
        </label>
        {error ? (
          <p className="text-sm text-[var(--color-danger,#b91c1c)]" role="alert">
            {t(error)}
          </p>
        ) : null}
        {notice ? (
          <p className="text-sm text-[var(--color-ink-soft)]" role="status">
            {t(notice)}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button type="submit" className="button-solid px-4 py-2 text-xs" disabled={saving}>
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
        </div>
      </form>
    </PanelCard>
  );
}
