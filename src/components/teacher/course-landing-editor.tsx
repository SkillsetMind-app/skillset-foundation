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

import { useAuth } from "@/components/auth/auth-provider";

import {
  courseLandingBlockKinds,
  courseLandingBlockLabels,
  courseLandingTemplateLabels,
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

function blankBlock(kind: CourseLandingBlockKind): CourseLandingBlock {
  switch (kind) {
    case "hero":
      return { kind: "hero", heading: "", subheading: "", imageUrl: null };
    case "about":
      return { kind: "about", heading: "About me", body: "", imageUrl: null };
    case "method":
      return { kind: "method", heading: "My method", body: "" };
    case "steps":
      return { kind: "steps", heading: "Step by step", steps: [{ title: "", body: "" }] };
    case "testimonials":
      return { kind: "testimonials", heading: "What people say", quotes: [{ quote: "", author: "" }] };
    case "faq":
      return { kind: "faq", heading: "Questions", items: [{ question: "", answer: "" }] };
    case "cta":
      return { kind: "cta", heading: "Ready to start?", body: "", buttonLabel: "Enrol now" };
  }
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
  switch (block.kind) {
    case "hero":
      return (
        <div className="grid gap-3">
          <label className={labelClass}>
            Headline
            <input
              className={fieldClass}
              value={block.heading}
              onChange={(e) => onChange({ ...block, heading: e.target.value })}
            />
          </label>
          <label className={labelClass}>
            One line under it
            <input
              className={fieldClass}
              value={block.subheading}
              onChange={(e) => onChange({ ...block, subheading: e.target.value })}
            />
          </label>
          <label className={labelClass}>
            Background image URL
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
            Heading
            <input
              className={fieldClass}
              value={block.heading}
              onChange={(e) => onChange({ ...block, heading: e.target.value })}
            />
          </label>
          <label className={labelClass}>
            Text
            <textarea
              className={`${fieldClass} min-h-32`}
              value={block.body}
              onChange={(e) => onChange({ ...block, body: e.target.value })}
            />
          </label>
          {block.kind === "about" ? (
            <label className={labelClass}>
              Your photo URL
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
            Heading
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
                {`Step ${index + 1} title`}
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
                What happens in this step
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
                Remove step
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => onChange({ ...block, steps: [...block.steps, { title: "", body: "" }] })}
            className="justify-self-start text-sm font-semibold text-[var(--color-primary)]"
          >
            + Add step
          </button>
        </div>
      );

    case "testimonials":
      return (
        <div className="grid gap-3">
          <label className={labelClass}>
            Heading
            <input
              className={fieldClass}
              value={block.heading}
              onChange={(e) => onChange({ ...block, heading: e.target.value })}
            />
          </label>
          {block.quotes.map((quote, index) => (
            <div key={index} className="grid gap-2 rounded-[10px] border border-[var(--color-line)] p-3">
              <label className={labelClass}>
                What they said
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
                Who said it
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
                Remove
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
            + Add one
          </button>
        </div>
      );

    case "faq":
      return (
        <div className="grid gap-3">
          <label className={labelClass}>
            Heading
            <input
              className={fieldClass}
              value={block.heading}
              onChange={(e) => onChange({ ...block, heading: e.target.value })}
            />
          </label>
          {block.items.map((item, index) => (
            <div key={index} className="grid gap-2 rounded-[10px] border border-[var(--color-line)] p-3">
              <label className={labelClass}>
                Question
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
                Answer
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
                Remove
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
            + Add question
          </button>
        </div>
      );

    case "cta":
      return (
        <div className="grid gap-3">
          <label className={labelClass}>
            Heading
            <input
              className={fieldClass}
              value={block.heading}
              onChange={(e) => onChange({ ...block, heading: e.target.value })}
            />
          </label>
          <label className={labelClass}>
            Text
            <textarea
              className={`${fieldClass} min-h-20`}
              value={block.body}
              onChange={(e) => onChange({ ...block, body: e.target.value })}
            />
          </label>
          <label className={labelClass}>
            Button label
            <input
              className={fieldClass}
              value={block.buttonLabel}
              onChange={(e) => onChange({ ...block, buttonLabel: e.target.value })}
            />
          </label>
          {/* Said out loud because a teacher WILL look for a link field, and the
              absence is deliberate rather than missing. */}
          <p className="text-xs leading-5 text-[var(--color-ink-soft)]">
            The button always opens this course&apos;s own checkout, with your
            current price and any coupon applied.
          </p>
        </div>
      );
  }
}

export function CourseLandingEditor({ course }: { course: TeacherCourse }) {
  const { user } = useAuth();
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
    const result = await saveCourseLanding(course.id, { template, blocks });
    if (result.ok) {
      setMessage("Saved.");
    } else {
      setError(result.reason);
    }
    setSaving(false);
  }

  if (loading) {
    return (
      <section className="settings-section-card">
        <p className="flex items-center gap-2 text-sm text-[var(--color-ink-soft)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading your sales page…
        </p>
      </section>
    );
  }

  return (
    <section className="settings-section-card">
      <h2 className="display-title text-2xl text-[var(--color-primary)]">
        Sales page
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
        Build the page a buyer sees before they enrol. Pick a template, then add
        the sections you want.
      </p>

      <div className="mt-5 grid gap-2">
        <span className={labelClass}>Template</span>
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
                    ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-white"
                    : "border-[var(--color-line)] bg-white text-[var(--color-ink)]"
                }`}
              >
                {courseLandingTemplateLabels[option]}
                {locked ? " — paid plans" : ""}
              </button>
            );
          })}
        </div>
      </div>

      <p className="mt-5 text-sm font-semibold text-[var(--color-ink)]">
        {blocks.length} of {limit} sections used
      </p>

      {blocks.length === 0 ? (
        <button
          type="button"
          onClick={() => setBlocks(starterLandingBlocks(course.title).slice(0, limit))}
          className="mt-3 justify-self-start rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-2.5 text-sm font-semibold text-[var(--color-ink)]"
        >
          Start from a suggested page
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
                {courseLandingBlockLabels[block.kind]}
              </span>
              <button
                type="button"
                onClick={() => move(index, -1)}
                disabled={index === 0}
                aria-label="Move up"
                className="grid h-8 w-8 place-items-center rounded-[8px] border border-[var(--color-line)] bg-white disabled:opacity-30"
              >
                <ChevronUp className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => move(index, 1)}
                disabled={index === blocks.length - 1}
                aria-label="Move down"
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
                    `Remove the "${courseLandingBlockLabels[block.kind]}" section and everything written in it?`,
                  );
                  if (confirmed) {
                    setBlocks((c) => c.filter((_, i) => i !== index));
                  }
                }}
                aria-label={`Remove ${courseLandingBlockLabels[block.kind]} section`}
                title={`Remove ${courseLandingBlockLabels[block.kind]} section`}
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
            onClick={() => setBlocks((current) => [...current, blankBlock(kind)])}
            className="inline-flex items-center gap-1.5 rounded-[10px] border border-[var(--color-line)] bg-white px-3 py-2 text-sm font-semibold text-[var(--color-ink)] disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" />
            {courseLandingBlockLabels[kind]}
          </button>
        ))}
      </div>

      {atLimit ? (
        <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
          You have used every section your plan includes. Remove one, or upgrade
          to add more.
        </p>
      ) : null}

      {/* Warns, never blocks. A teacher with a real licence must still be able
          to say so; deciding for them is not our call, and staying quiet about
          it is not either. */}
      {warnings.length > 0 ? (
        <p className="mt-4 rounded-[10px] border border-amber-300 bg-amber-50 p-3 text-sm leading-6 text-amber-900">
          Heads up — this page uses {warnings.map((w) => `“${w}”`).join(", ")}.
          Some of those are protected professional titles or outcome claims in
          the United States. If they apply to you, keep them; if not, they can
          create a problem you did not intend.
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-[12px] bg-[var(--color-primary)] px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Save page
        </button>
        {message ? <span className="text-sm text-emerald-800">{message}</span> : null}
        {error ? <span className="text-sm text-[var(--color-danger-fg)]">{error}</span> : null}
      </div>
    </section>
  );
}
