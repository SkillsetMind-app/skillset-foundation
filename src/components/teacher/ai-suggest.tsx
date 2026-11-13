"use client";

import { useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { callTeachAi } from "@/lib/ai/teach-ai-client";

// "Suggest with AI" para título e descrição da aula ou do módulo. A IA lê a
// transcrição (legenda) e devolve até 3 de cada; "Use" só preenche o campo.
export function AiSuggest({
  courseId,
  lessonId,
  assetId,
  moduleId,
  target,
  disabled = false,
  onUseTitle,
  onUseDescription,
}: {
  courseId: string;
  /** Uma aula do curso: a rota confere o dono por ela (no módulo, a 1ª aula dele). */
  lessonId: string;
  assetId?: string;
  moduleId?: string;
  target: "lesson" | "module";
  disabled?: boolean;
  onUseTitle: (title: string) => void;
  onUseDescription: (description: string) => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [suggestions, setSuggestions] = useState<{ titles: string[]; descriptions: string[] } | null>(null);

  async function suggest() {
    setBusy(true);
    setError("");
    const result = await callTeachAi({ action: "suggest", target, courseId, lessonId, assetId, moduleId });
    setBusy(false);
    if (!result.ok) {
      setError(result.body.error ?? t("creatorEditor.lesson.ai.errorGeneric"));
      return;
    }
    setSuggestions(result.body.suggestions as { titles: string[]; descriptions: string[] });
  }

  const list = (items: string[], label: string, use: (value: string) => void) =>
    items.length > 0 ? (
      <div className="grid gap-2">
        <p className="text-xs font-semibold text-[var(--color-ink-soft)]">{label}</p>
        <ul className="grid gap-2">
          {items.map((item) => (
            <li key={item} className="flex items-start justify-between gap-3 rounded-md border border-[var(--color-line)] p-3 text-sm">
              <span className="min-w-0">{item}</span>
              <button
                type="button"
                className="button-outline min-h-11 shrink-0 px-3 text-sm"
                disabled={disabled}
                onClick={() => use(item)}
              >
                {t("creatorEditor.lesson.ai.use")}
              </button>
            </li>
          ))}
        </ul>
      </div>
    ) : null;

  return (
    <div className="grid gap-3">
      <button
        type="button"
        className="button-outline min-h-11 justify-self-start px-3 text-sm disabled:opacity-60"
        disabled={disabled || busy}
        onClick={suggest}
      >
        {busy ? t("creatorEditor.lesson.ai.suggesting") : t("creatorEditor.lesson.ai.suggest")}
      </button>
      {suggestions ? (
        <>
          {list(suggestions.titles, t("creatorEditor.lesson.ai.suggestedTitles"), onUseTitle)}
          {list(suggestions.descriptions, t("creatorEditor.lesson.ai.suggestedDescriptions"), onUseDescription)}
        </>
      ) : null}
      <p role="status" aria-live="polite" className="text-sm font-semibold text-[var(--color-danger-fg)]">{error}</p>
    </div>
  );
}
