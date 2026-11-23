"use client";

import { useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { RetryAlert } from "@/components/teacher/save-status-line";
import { useConfirm } from "@/components/teacher/use-confirm";
import { Button } from "@/components/ui";
import { callTeachAi, teachAiErrorText } from "@/lib/ai/teach-ai-client";

// "Suggest with AI" para título e descrição da aula ou do módulo. A IA lê a
// transcrição (legenda) e devolve até 3 de cada; "Use" só preenche o campo.
export function AiSuggest({
  courseId,
  lessonId,
  assetId,
  moduleId,
  target,
  currentDescription,
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
  /** Texto atual da descrição: se houver, "Use" pergunta antes de substituir. */
  currentDescription?: string | null;
  disabled?: boolean;
  onUseTitle: (title: string) => void;
  onUseDescription: (description: string) => void;
}) {
  const { t } = useTranslation();
  const { ask, dialog: confirmDialog } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  // Erro tem lugar e cor próprios: antes saía no mesmo cinza do "Suggestions ready".
  const [error, setError] = useState("");
  const [suggestions, setSuggestions] = useState<{ titles: string[]; descriptions: string[] } | null>(null);

  async function suggest() {
    setBusy(true);
    setMessage("");
    setError("");
    const result = await callTeachAi({ action: "suggest", target, courseId, lessonId, assetId, moduleId });
    setBusy(false);
    if (!result.ok) {
      setError(teachAiErrorText(result, t));
      return;
    }
    setSuggestions(result.body.suggestions as { titles: string[]; descriptions: string[] });
    setMessage(t("creatorEditor.lesson.ai.suggestionsReady"));
  }

  function applyDescription(value: string) {
    const apply = () => {
      onUseDescription(value);
      setMessage(t("creatorEditor.lesson.ai.used"));
    };
    // A descrição da aula é o texto inteiro dela: não some sem o professor querer.
    if (!currentDescription?.trim()) return apply();
    ask({
      title: t("creatorEditor.lesson.ai.confirmReplaceDescriptionTitle"),
      body: t("creatorEditor.lesson.ai.confirmReplaceDescription"),
      confirmLabel: t("creatorEditor.lesson.ai.replaceDescription"),
      run: apply,
    });
  }

  const list = (items: string[], label: string, pick: (value: string) => void) =>
    items.length > 0 ? (
      <div className="grid gap-2">
        <p className="text-xs font-semibold text-[var(--color-ink-soft)]">{label}</p>
        <ul className="grid gap-2">
          {items.map((item, index) => (
            <li key={`${index}-${item}`} className="flex items-start justify-between gap-3 rounded-md border border-[var(--color-line)] p-3 text-sm">
              <span className="min-w-0">{item}</span>
              <button
                type="button"
                className="button-outline min-h-11 shrink-0 px-3 text-sm"
                disabled={disabled}
                onClick={() => pick(item)}
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
      <Button
        variant="outline"
        className="justify-self-start"
        disabled={disabled}
        loading={busy}
        onClick={suggest}
      >
        {busy ? t("creatorEditor.lesson.ai.suggesting") : t("creatorEditor.lesson.ai.suggest")}
      </Button>
      {suggestions ? (
        <>
          {list(suggestions.titles, t("creatorEditor.lesson.ai.suggestedTitles"), (title) => {
            onUseTitle(title);
            setMessage(t("creatorEditor.lesson.ai.used"));
          })}
          {list(suggestions.descriptions, t("creatorEditor.lesson.ai.suggestedDescriptions"), applyDescription)}
        </>
      ) : null}
      <p role="status" aria-live="polite" className="text-sm text-[var(--color-ink-soft)]">{message}</p>
      {error ? <RetryAlert text={error} onRetry={() => void suggest()} /> : null}
      {confirmDialog}
    </div>
  );
}
