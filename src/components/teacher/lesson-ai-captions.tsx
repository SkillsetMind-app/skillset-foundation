"use client";

import { useEffect, useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { CAPTION_LANGUAGES, captionLanguageName, isCaptionLanguage } from "@/domain/caption-languages";
import { callTeachAi, loadTeachAi, teachAiErrorText } from "@/lib/ai/teach-ai-client";

// Legendas com IA no estúdio da aula (aba Vídeo, só vídeo enviado para a Bunny).
// A IA escreve um rascunho a partir do áudio; o professor lê, corrige e publica.
// O aluno só vê a legenda publicada, no botão CC do player da Bunny.

type Caption = {
  language: string;
  vtt: string;
  translatedFrom: string | null;
  updatedAt: string;
  publishedAt: string | null;
  stale: boolean;
};
type Usage = { usedSeconds: number; limitSeconds: number };
type Notice = { kind: "ok" | "error"; text: string } | null;

function captionState(caption: Caption): "stale" | "draft" | "changed" | "published" {
  if (caption.stale) return "stale";
  if (!caption.publishedAt) return "draft";
  return caption.updatedAt > caption.publishedAt ? "changed" : "published";
}

export function LessonAiCaptions({ courseId, lessonId, assetId }: { courseId: string; lessonId: string; assetId: string }) {
  const { t, locale } = useTranslation();
  const [captions, setCaptions] = useState<Caption[] | null>(null);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [usage, setUsage] = useState<Usage | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [spoken, setSpoken] = useState<string>(isCaptionLanguage(locale) ? locale : "en");
  const [target, setTarget] = useState("");

  useEffect(() => {
    let live = true;
    void loadTeachAi({ courseId, lessonId, assetId }).then((result) => {
      if (!live) return;
      if (!result.ok) {
        setCaptions([]);
        setNotice({ kind: "error", text: teachAiErrorText(result, t) });
        return;
      }
      const loaded = result.body.captions as Caption[];
      setCaptions(loaded);
      setTexts(Object.fromEntries(loaded.map((caption) => [caption.language, caption.vtt])));
      setUsage(result.body.usage as Usage);
      // O idioma falado é o da legenda que não é tradução, se já houver uma.
      const original = loaded.find((caption) => !caption.stale && !caption.translatedFrom);
      if (original) setSpoken(original.language);
    });
    return () => {
      live = false;
    };
  }, [courseId, lessonId, assetId, t]);

  function keep(caption: Caption) {
    setCaptions((current) => {
      const rest = (current ?? []).filter((item) => item.language !== caption.language);
      return [...rest, caption].sort((a, b) => a.language.localeCompare(b.language));
    });
    setTexts((current) => ({ ...current, [caption.language]: caption.vtt }));
  }

  async function run(action: string, extra: Record<string, unknown>, busyKey: string, okText: string): Promise<boolean> {
    setBusy(busyKey);
    setNotice(null);
    const result = await callTeachAi({ action, courseId, lessonId, assetId, ...extra });
    setBusy(null);
    if (result.body.usage) setUsage(result.body.usage as Usage);
    if (!result.ok) {
      setNotice({ kind: "error", text: teachAiErrorText(result, t) });
      return false;
    }
    if (result.body.caption) keep({ ...(result.body.caption as Caption), stale: false });
    if (typeof result.body.removed === "string") {
      const removed = result.body.removed;
      setCaptions((current) => (current ?? []).filter((item) => item.language !== removed));
      setTexts((current) => Object.fromEntries(Object.entries(current).filter(([code]) => code !== removed)));
    }
    setNotice({ kind: "ok", text: okText });
    return true;
  }

  // Publicar com texto editado grava antes: o professor não precisa adivinhar
  // que "Save" vem primeiro.
  async function publish(caption: Caption) {
    const edited = texts[caption.language] !== caption.vtt;
    if (edited && !(await run("saveCaption", { language: caption.language, vtt: texts[caption.language] },
      `publish-${caption.language}`, t("creatorEditor.lesson.ai.saved")))) {
      return;
    }
    await run("publishCaption", { language: caption.language }, `publish-${caption.language}`,
      t("creatorEditor.lesson.ai.publishedNotice"));
  }

  const name = (code: string) => captionLanguageName(code, locale);
  const hours = (seconds: number) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(seconds / 3600);
  const fresh = (captions ?? []).filter((caption) => !caption.stale);
  const source = fresh.find((caption) => caption.language === spoken && !caption.translatedFrom)
    ?? fresh.find((caption) => !caption.translatedFrom)
    ?? fresh[0];
  const targets = CAPTION_LANGUAGES.filter((code) => !fresh.some((caption) => caption.language === code));
  const spokenExists = fresh.some((caption) => caption.language === spoken);
  const working = busy !== null;

  return (
    <section aria-labelledby="lesson-ai-captions-title" className="grid min-w-0 gap-3">
      <h4 id="lesson-ai-captions-title" className="text-sm font-semibold">{t("creatorEditor.lesson.ai.title")}</h4>
      <p className="text-sm text-[var(--color-ink-soft)]">{t("creatorEditor.lesson.ai.help")}</p>
      {usage ? (
        <p className="text-sm text-[var(--color-ink-soft)]">
          {t("creatorEditor.lesson.ai.usage")
            .replace("{used}", () => hours(usage.usedSeconds))
            .replace("{limit}", () => hours(usage.limitSeconds))}
        </p>
      ) : null}

      {captions === null ? (
        <p className="text-sm text-[var(--color-ink-soft)]">{t("creatorEditor.lesson.ai.loading")}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <label className="lesson-modal-field min-w-0 flex-1">
              <span>{t("creatorEditor.lesson.ai.spokenLanguage")}</span>
              <select value={spoken} disabled={working} onChange={(event) => setSpoken(event.target.value)}>
                {CAPTION_LANGUAGES.map((code) => (
                  <option key={code} value={code}>{name(code)}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="button-solid min-h-11 px-4 py-2.5 text-sm disabled:opacity-60"
              disabled={working}
              onClick={() => {
                // Gerar de novo apaga as correções e gasta as horas do vídeo outra vez.
                if (spokenExists && !window.confirm(t("creatorEditor.lesson.ai.confirmRegenerate"))) return;
                void run("transcribe", { language: spoken }, "transcribe", t("creatorEditor.lesson.ai.generated"));
              }}
            >
              {busy === "transcribe"
                ? t("creatorEditor.lesson.ai.generating")
                : t(spokenExists ? "creatorEditor.lesson.ai.regenerate" : "creatorEditor.lesson.ai.generate")}
            </button>
          </div>

          {captions.map((caption) => {
            const state = captionState(caption);
            const edited = (texts[caption.language] ?? caption.vtt) !== caption.vtt;
            return (
              <details
                key={caption.language}
                className="lesson-modal-field"
                open={expanded[caption.language] ?? (state === "draft" || state === "changed")}
                onToggle={(event) => {
                  const open = event.currentTarget.open;
                  setExpanded((current) => ({ ...current, [caption.language]: open }));
                }}
              >
                <summary>
                  {name(caption.language)} · {t(edited ? "creatorEditor.lesson.ai.unsaved" : `creatorEditor.lesson.ai.state.${state}`)}
                </summary>
                {state === "stale" ? null : (
                  <textarea
                    value={texts[caption.language] ?? caption.vtt}
                    onChange={(event) => setTexts((current) => ({ ...current, [caption.language]: event.target.value }))}
                    disabled={working}
                    rows={10}
                    spellCheck
                    aria-label={t("creatorEditor.lesson.ai.editLabel").replace("{language}", () => name(caption.language))}
                  />
                )}
                <div className="flex flex-wrap gap-2">
                  {state === "stale" ? null : (
                    <>
                      <button
                        type="button"
                        className="button-outline min-h-11 px-3 text-sm disabled:opacity-60"
                        disabled={working || !edited}
                        onClick={() => void run("saveCaption", { language: caption.language, vtt: texts[caption.language] },
                          `save-${caption.language}`, t("creatorEditor.lesson.ai.saved"))}
                      >
                        {t("creatorEditor.lesson.ai.save")}
                      </button>
                      <button
                        type="button"
                        className="button-solid min-h-11 px-4 py-2.5 text-sm disabled:opacity-60"
                        disabled={working || (state === "published" && !edited)}
                        onClick={() => void publish(caption)}
                      >
                        {t("creatorEditor.lesson.ai.publish")}
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className="button-danger px-3.5 py-2 text-xs disabled:opacity-60"
                    disabled={working}
                    onClick={() => {
                      if (!window.confirm(t("creatorEditor.lesson.ai.confirmRemove"))) return;
                      void run("removeCaption", { language: caption.language },
                        `remove-${caption.language}`, t("creatorEditor.lesson.ai.removed"));
                    }}
                  >
                    {t("creatorEditor.lesson.ai.remove")}
                  </button>
                </div>
              </details>
            );
          })}

          {source ? (
            <div className="flex flex-wrap items-end gap-3">
              <label className="lesson-modal-field min-w-0 flex-1">
                <span>
                  {t("creatorEditor.lesson.ai.translateTo").replace("{language}", () => name(source.language))}
                </span>
                <select value={target} disabled={working} onChange={(event) => setTarget(event.target.value)}>
                  <option value="">{t("creatorEditor.lesson.ai.chooseLanguage")}</option>
                  {targets.map((code) => (
                    <option key={code} value={code}>{name(code)}</option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="button-outline min-h-11 px-3 text-sm disabled:opacity-60"
                disabled={working || !target}
                onClick={() => void run("translate", { from: source.language, to: target }, "translate",
                  t("creatorEditor.lesson.ai.translated"))}
              >
                {busy === "translate" ? t("creatorEditor.lesson.ai.translating") : t("creatorEditor.lesson.ai.translate")}
              </button>
            </div>
          ) : null}
        </>
      )}

      <p role="status" aria-live="polite" className={notice?.kind === "error" ? "text-sm font-semibold text-[var(--color-danger-fg)]" : "text-sm text-[var(--color-ink-soft)]"}>
        {notice?.text ?? ""}
      </p>
    </section>
  );
}
