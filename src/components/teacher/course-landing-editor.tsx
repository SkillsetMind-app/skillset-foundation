"use client";

/**
 * The sales page editor.
 *
 * Deliberately a form, not a canvas. The teacher picks a template, adds blocks
 * from a fixed set, fills in fields and reorders them. That is the whole of the
 * decision recorded in the 2026-07-14 backlog: templates plus editable blocks,
 * and explicitly NOT a freeform multi-page site builder, which the same document
 * marks "do not build".
 *
 * The quota shown here comes from `planEntitlements`, and the server checks it
 * again in `save_own_course_landing`. Showing it up front is what turns "your
 * plan does not allow that" from a failure into a decision the teacher makes
 * before typing.
 */

import { ChevronDown, ChevronUp, Loader2, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { useAuth } from "@/components/auth/auth-provider";

import {
  courseLandingBlockKinds,
  courseLandingTemplates,
  protectedTitleWarnings,
  starterLandingBlocks,
  type CourseLandingBlock,
  type CourseLandingBlockKind,
  type CourseLandingTemplate,
} from "@/domain/course-landing";
import { planEntitlements } from "@/domain/entitlements";
import type { TeacherCourse } from "@/domain/teacher-course";
import { getCourseLanding, saveCourseLanding } from "@/lib/data/course-landings";
import { getUserProfile } from "@/lib/data/user-profiles";

function blankBlock(kind: CourseLandingBlockKind, t: (key: string) => string): CourseLandingBlock {
  switch (kind) {
    case "hero":
      return { kind: "hero", heading: "", subheading: "", imageUrl: null };
    case "about":
      return { kind: "about", heading: t("teacherLanding.defaults.about"), body: "", imageUrl: null };
    case "method":
      return { kind: "method", heading: t("teacherLanding.defaults.method"), body: "" };
    case "steps":
      return { kind: "steps", heading: t("teacherLanding.defaults.steps"), steps: [{ title: "", body: "" }] };
    case "testimonials":
      return { kind: "testimonials", heading: t("teacherLanding.defaults.testimonials"), quotes: [{ quote: "", author: "" }] };
    case "faq":
      return { kind: "faq", heading: t("teacherLanding.defaults.faq"), items: [{ question: "", answer: "" }] };
    case "cta":
      return { kind: "cta", heading: t("teacherLanding.defaults.cta"), body: "", buttonLabel: t("teacherLanding.defaults.buttonLabel") };
  }
}

// These are the adapter's public failure reasons, not arbitrary backend text.
const landingSaveErrorKeys: Record<string, string> = {
  "This page has more blocks than your plan allows. Remove one, or upgrade.": "teacherLanding.errors.quota",
  "That template is not included on your plan.": "teacherLanding.errors.template",
  "This page is too long. Shorten a section and try again.": "teacherLanding.errors.tooLong",
  "You can only edit your own courses.": "teacherLanding.errors.owner",
};

function suggestedBlocks(courseTitle: string, t: (key: string) => string): CourseLandingBlock[] {
  // Only new, explicitly requested defaults are localized. Saved blocks never pass here.
  return starterLandingBlocks(courseTitle).map((block): CourseLandingBlock => {
    switch (block.kind) {
      case "hero":
        return { ...block, heading: courseTitle ? block.heading : t("teacherLanding.defaults.course"), subheading: t("teacherLanding.defaults.subheading") };
      case "about":
        return { ...block, heading: t("teacherLanding.defaults.about") };
      case "method":
        return { ...block, heading: t("teacherLanding.defaults.teaching") };
      case "steps":
        return { ...block, heading: t("teacherLanding.defaults.process"), steps: [{ title: t("teacherLanding.defaults.firstStep"), body: "" }] };
      case "cta":
        return { ...block, heading: t("teacherLanding.defaults.cta"), buttonLabel: t("teacherLanding.defaults.buttonLabel") };
      default:
        return block;
    }
  });
}

const fieldClass =
  "w-full rounded-[10px] border border-[var(--color-line)] bg-white px-3 py-2.5 text-sm text-[var(--color-ink)]";
const labelClass = "grid gap-1.5 text-xs font-bold uppercase tracking-[0.16em] text-[var(--color-ink-soft)]";

function BlockFields({
  block,
  onChange,
}: {
  block: CourseLandingBlock;
  onChange: (next: CourseLandingBlock) => void;
}) {
  const { t, locale } = useTranslation();
  switch (block.kind) {
    case "hero":
      return (
        <div className="grid gap-3">
          <label className={labelClass}>
            {t("teacherLanding.fields.headline")}
            <input
              className={fieldClass}
              value={block.heading}
              onChange={(e) => onChange({ ...block, heading: e.target.value })}
            />
          </label>
          <label className={labelClass}>
            {t("teacherLanding.fields.subheading")}
            <input
              className={fieldClass}
              value={block.subheading}
              onChange={(e) => onChange({ ...block, subheading: e.target.value })}
            />
          </label>
          <label className={labelClass}>
            {t("teacherLanding.fields.backgroundUrl")}
            <input
              className={fieldClass}
              value={block.imageUrl ?? ""}
              placeholder="/uploads/your-image.jpg"
              onChange={(e) => onChange({ ...block, imageUrl: e.target.value || null })}
            />
          </label>
        </div>
      );

    case "about":
    case "method":
      return (
        <div className="grid gap-3">
          <label className={labelClass}>
            {t("teacherLanding.fields.heading")}
            <input
              className={fieldClass}
              value={block.heading}
              onChange={(e) => onChange({ ...block, heading: e.target.value })}
            />
          </label>
          <label className={labelClass}>
            {t("teacherLanding.fields.text")}
            <textarea
              className={`${fieldClass} min-h-32`}
              value={block.body}
              onChange={(e) => onChange({ ...block, body: e.target.value })}
            />
          </label>
          {block.kind === "about" ? (
            <label className={labelClass}>
              {t("teacherLanding.fields.photoUrl")}
              <input
                className={fieldClass}
                value={block.imageUrl ?? ""}
                placeholder="/uploads/your-photo.jpg"
                onChange={(e) => onChange({ ...block, imageUrl: e.target.value || null })}
              />
            </label>
          ) : null}
        </div>
      );

    case "steps":
      return (
        <div className="grid gap-3">
          <label className={labelClass}>
            {t("teacherLanding.fields.heading")}
            <input
              className={fieldClass}
              value={block.heading}
              onChange={(e) => onChange({ ...block, heading: e.target.value })}
            />
          </label>
          {block.steps.map((step, index) => (
            <div key={index} className="grid gap-2 rounded-[10px] border border-[var(--color-line)] p-3">
              {/* Rótulo de verdade, não placeholder. Todo campo repetido deste
                  editor identificava-se só pelo placeholder — que some no
                  primeiro caractere digitado. Revisando uma página de vendas com
                  seis passos preenchidos, nada na tela dizia qual caixa era
                  título e qual era descrição, e leitor de tela não anunciava
                  nome nenhum. */}
              <label className={labelClass}>
                {t("teacherLanding.fields.stepTitle").replace("{count}", () => new Intl.NumberFormat(locale).format(index + 1))}
                <input
                  className={fieldClass}
                  value={step.title}
                  onChange={(e) => {
                    const steps = [...block.steps];
                    steps[index] = { ...steps[index], title: e.target.value };
                    onChange({ ...block, steps });
                  }}
                />
              </label>
              <label className={labelClass}>
                {t("teacherLanding.fields.stepBody")}
                <textarea
                  className={`${fieldClass} min-h-20`}
                  value={step.body}
                  onChange={(e) => {
                    const steps = [...block.steps];
                    steps[index] = { ...steps[index], body: e.target.value };
                    onChange({ ...block, steps });
                  }}
                />
              </label>
              <button
                type="button"
                onClick={() =>
                  onChange({ ...block, steps: block.steps.filter((_, i) => i !== index) })
                }
                className="justify-self-start text-xs font-semibold text-[var(--color-danger-fg)]"
              >
                {t("teacherLanding.fields.removeStep")}
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => onChange({ ...block, steps: [...block.steps, { title: "", body: "" }] })}
            className="justify-self-start text-sm font-semibold text-[var(--color-primary)]"
          >
            {t("teacherLanding.fields.addStep")}
          </button>
        </div>
      );

    case "testimonials":
      return (
        <div className="grid gap-3">
          <label className={labelClass}>
            {t("teacherLanding.fields.heading")}
            <input
              className={fieldClass}
              value={block.heading}
              onChange={(e) => onChange({ ...block, heading: e.target.value })}
            />
          </label>
          {block.quotes.map((quote, index) => (
            <div key={index} className="grid gap-2 rounded-[10px] border border-[var(--color-line)] p-3">
              <label className={labelClass}>
                {t("teacherLanding.fields.quote")}
                <textarea
                  className={`${fieldClass} min-h-20`}
                  value={quote.quote}
                  onChange={(e) => {
                    const quotes = [...block.quotes];
                    quotes[index] = { ...quotes[index], quote: e.target.value };
                    onChange({ ...block, quotes });
                  }}
                />
              </label>
              <label className={labelClass}>
                {t("teacherLanding.fields.author")}
                <input
                  className={fieldClass}
                  value={quote.author}
                  onChange={(e) => {
                    const quotes = [...block.quotes];
                    quotes[index] = { ...quotes[index], author: e.target.value };
                    onChange({ ...block, quotes });
                  }}
                />
              </label>
              <button
                type="button"
                onClick={() =>
                  onChange({ ...block, quotes: block.quotes.filter((_, i) => i !== index) })
                }
                className="justify-self-start text-xs font-semibold text-[var(--color-danger-fg)]"
              >
                {t("teacherLanding.fields.remove")}
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              onChange({ ...block, quotes: [...block.quotes, { quote: "", author: "" }] })
            }
            className="justify-self-start text-sm font-semibold text-[var(--color-primary)]"
          >
            {t("teacherLanding.fields.addQuote")}
          </button>
        </div>
      );

    case "faq":
      return (
        <div className="grid gap-3">
          <label className={labelClass}>
            {t("teacherLanding.fields.heading")}
            <input
              className={fieldClass}
              value={block.heading}
              onChange={(e) => onChange({ ...block, heading: e.target.value })}
            />
          </label>
          {block.items.map((item, index) => (
            <div key={index} className="grid gap-2 rounded-[10px] border border-[var(--color-line)] p-3">
              <label className={labelClass}>
                {t("teacherLanding.fields.question")}
                <input
                  className={fieldClass}
                  value={item.question}
                  onChange={(e) => {
                    const items = [...block.items];
                    items[index] = { ...items[index], question: e.target.value };
                    onChange({ ...block, items });
                  }}
                />
              </label>
              <label className={labelClass}>
                {t("teacherLanding.fields.answer")}
                <textarea
                  className={`${fieldClass} min-h-20`}
                  value={item.answer}
                  onChange={(e) => {
                    const items = [...block.items];
                    items[index] = { ...items[index], answer: e.target.value };
                    onChange({ ...block, items });
                  }}
                />
              </label>
              <button
                type="button"
                onClick={() =>
                  onChange({ ...block, items: block.items.filter((_, i) => i !== index) })
                }
                className="justify-self-start text-xs font-semibold text-[var(--color-danger-fg)]"
              >
                {t("teacherLanding.fields.remove")}
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              onChange({ ...block, items: [...block.items, { question: "", answer: "" }] })
            }
            className="justify-self-start text-sm font-semibold text-[var(--color-primary)]"
          >
            {t("teacherLanding.fields.addQuestion")}
          </button>
        </div>
      );

    case "cta":
      return (
        <div className="grid gap-3">
          <label className={labelClass}>
            {t("teacherLanding.fields.heading")}
            <input
              className={fieldClass}
              value={block.heading}
              onChange={(e) => onChange({ ...block, heading: e.target.value })}
            />
          </label>
          <label className={labelClass}>
            {t("teacherLanding.fields.text")}
            <textarea
              className={`${fieldClass} min-h-20`}
              value={block.body}
              onChange={(e) => onChange({ ...block, body: e.target.value })}
            />
          </label>
          <label className={labelClass}>
            {t("teacherLanding.fields.buttonLabel")}
            <input
              className={fieldClass}
              value={block.buttonLabel}
              onChange={(e) => onChange({ ...block, buttonLabel: e.target.value })}
            />
          </label>
          {/* Said out loud because a teacher WILL look for a link field, and the
              absence is deliberate rather than missing. */}
          <p className="text-xs leading-5 text-[var(--color-ink-soft)]">
            {t("teacherLanding.checkoutHint")}
          </p>
        </div>
      );
  }
}

export function CourseLandingEditor({ course }: { course: TeacherCourse }) {
  const { user } = useAuth();
  const { t, locale } = useTranslation();
  const uid = user?.uid ?? null;

  const [template, setTemplate] = useState<CourseLandingTemplate>("classic");
  const [blocks, setBlocks] = useState<CourseLandingBlock[]>([]);
  const [planId, setPlanId] = useState<"free" | "starter" | "pro" | "plus">("free");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [landing, profile] = await Promise.all([
      getCourseLanding(course.id),
      // Falls back to `free` when the profile cannot be read. That errs toward
      // the tighter quota, so the worst case is the editor offering fewer
      // sections than the teacher paid for — visible and complainable — rather
      // than more than the server will accept, which would only surface as a
      // failed save after they had done the work.
      uid ? getUserProfile(uid).catch(() => null) : Promise.resolve(null),
    ]);
    setTemplate(landing.template);
    setBlocks(landing.blocks);
    setPlanId(profile?.currentPlanId ?? "free");
    setLoading(false);
  }, [course.id, uid]);

  useEffect(() => {
    // Defer so the effect body itself does not synchronously setState (lint).
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const limit = planEntitlements[planId].quotas.landingBlocks ?? 0;
  const canChooseTemplate = planId !== "free";
  const atLimit = blocks.length >= limit;

  const warnings = useMemo(() => protectedTitleWarnings(blocks), [blocks]);

  function updateBlock(index: number, next: CourseLandingBlock) {
    setBlocks((current) => current.map((b, i) => (i === index ? next : b)));
  }

  function move(index: number, direction: -1 | 1) {
    const to = index + direction;
    if (to < 0 || to >= blocks.length) return;
    setBlocks((current) => {
      const next = [...current];
      const [moved] = next.splice(index, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const result = await saveCourseLanding(course.id, { template, blocks });
      if (result.ok) {
        setMessage("teacherLanding.saved");
      } else {
        setError(landingSaveErrorKeys[result.reason] ?? "teacherLanding.errors.save");
      }
    } catch {
      setError("teacherLanding.errors.save");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <section className="settings-section-card">
        <p className="flex items-center gap-2 text-sm text-[var(--color-ink-soft)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("teacherLanding.loading")}
        </p>
      </section>
    );
  }

  return (
    <section className="settings-section-card">
      <h2 className="display-title text-2xl text-[var(--color-primary)]">
        {t("teacherLanding.title")}
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
        {t("teacherLanding.description")}
      </p>

      <div className="mt-5 grid gap-2">
        <span className={labelClass}>{t("teacherLanding.template")}</span>
        <div className="flex flex-wrap gap-2">
          {courseLandingTemplates.map((option) => {
            const locked = option !== "classic" && !canChooseTemplate;
            return (
              <button
                key={option}
                type="button"
                disabled={locked}
                onClick={() => setTemplate(option)}
                className={`rounded-[10px] border px-4 py-2 text-sm font-semibold disabled:opacity-50 ${
                  template === option
                    ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-[var(--color-on-primary)]"
                    : "border-[var(--color-line)] bg-white text-[var(--color-ink)]"
                }`}
              >
                {t(`teacherLanding.templates.${option}`)}
                {locked ? t("teacherLanding.paidPlans") : ""}
              </button>
            );
          })}
        </div>
      </div>

      <p className="mt-5 text-sm font-semibold text-[var(--color-ink)]">
        {t("teacherLanding.sectionsUsed").replace(/\{count\}|\{limit\}/g, (token) => new Intl.NumberFormat(locale).format(token === "{count}" ? blocks.length : limit))}
      </p>

      {blocks.length === 0 ? (
        <button
          type="button"
          onClick={() => setBlocks(suggestedBlocks(course.title, t).slice(0, limit))}
          className="mt-3 justify-self-start rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-2.5 text-sm font-semibold text-[var(--color-ink)]"
        >
          {t("teacherLanding.suggested")}
        </button>
      ) : null}

      <div className="mt-4 grid gap-4">
        {blocks.map((block, index) => (
          <div
            key={index}
            className="grid gap-3 rounded-[14px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-4"
          >
            <div className="flex items-center gap-2">
              <span className="flex-1 text-sm font-bold text-[var(--color-ink)]">
                {t(`teacherLanding.blocks.${block.kind}`)}
              </span>
              <button
                type="button"
                onClick={() => move(index, -1)}
                disabled={index === 0}
                aria-label={t("teacherLanding.moveUp")}
                className="grid h-8 w-8 place-items-center rounded-[8px] border border-[var(--color-line)] bg-white disabled:opacity-30"
              >
                <ChevronUp className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => move(index, 1)}
                disabled={index === blocks.length - 1}
                aria-label={t("teacherLanding.moveDown")}
                className="grid h-8 w-8 place-items-center rounded-[8px] border border-[var(--color-line)] bg-white disabled:opacity-30"
              >
                <ChevronDown className="h-4 w-4" />
              </button>
              {/* Confirmação + folga do vizinho. Este botão fica a 8px do
                  "Move down", tem o mesmo tamanho e a mesma moldura, e apagava a
                  seção inteira — com todo o texto digitado dentro dela — em um
                  clique, sem desfazer. Errar o alvo por um botão custava o
                  trabalho todo. */}
              <button
                type="button"
                onClick={() => {
                  const confirmed = window.confirm(
                    t("teacherLanding.confirmRemove").replace("{section}", () => t(`teacherLanding.blocks.${block.kind}`)),
                  );
                  if (confirmed) {
                    setBlocks((c) => c.filter((_, i) => i !== index));
                  }
                }}
                aria-label={t("teacherLanding.removeSection").replace("{section}", () => t(`teacherLanding.blocks.${block.kind}`))}
                title={t("teacherLanding.removeSection").replace("{section}", () => t(`teacherLanding.blocks.${block.kind}`))}
                className="ml-2 grid h-8 w-8 place-items-center rounded-[8px] border border-[var(--color-line)] bg-white text-[var(--color-danger-fg)]"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <BlockFields block={block} onChange={(next) => updateBlock(index, next)} />
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {courseLandingBlockKinds.map((kind) => (
          <button
            key={kind}
            type="button"
            disabled={atLimit}
            onClick={() => setBlocks((current) => [...current, blankBlock(kind, t)])}
            className="inline-flex items-center gap-1.5 rounded-[10px] border border-[var(--color-line)] bg-white px-3 py-2 text-sm font-semibold text-[var(--color-ink)] disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" />
            {t(`teacherLanding.blocks.${kind}`)}
          </button>
        ))}
      </div>

      {atLimit ? (
        <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
          {t("teacherLanding.limitReached")}
        </p>
      ) : null}

      {/* Warns, never blocks. A teacher with a real licence must still be able
          to say so; deciding for them is not our call, and staying quiet about
          it is not either. */}
      {warnings.length > 0 ? (
        <p className="mt-4 rounded-[10px] border border-[rgba(192,123,10,0.35)] bg-[var(--color-warning-soft)] p-3 text-sm leading-6 text-[var(--color-warning-fg)]">
          {t("teacherLanding.warning").replace("{terms}", () => warnings.map((w) => `“${w}”`).join(", "))}
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-[12px] bg-[var(--color-primary)] px-5 py-2.5 text-sm font-bold text-[var(--color-on-primary)] disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {t(saving ? "teacherLanding.saving" : "teacherLanding.save")}
        </button>
        {message ? <span role="status" className="text-sm text-[var(--color-success-fg)]">{t(message)}</span> : null}
        {error ? <span role="alert" className="text-sm text-[var(--color-danger-fg)]">{t(error)}</span> : null}
      </div>
    </section>
  );
}
