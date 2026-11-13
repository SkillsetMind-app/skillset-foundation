"use client";

import { useEffect, useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { CAPTION_LANGUAGES, captionLanguageName } from "@/domain/caption-languages";

// Legendas com IA no estúdio da aula (aba Vídeo, só vídeo enviado para a Bunny).
// A IA escreve um rascunho a partir do áudio; o professor lê, corrige e publica.
// O aluno só vê a legenda publicada, no botão CC do player da Bunny.

type Caption = { language: string; vtt: string; updatedAt: string; publishedAt: string | null; stale: boolean };
type Usage = { usedSeconds: number; limitSeconds: number };
type Notice = { kind: "ok" | "error"; text: string } | null;

const hours = (seconds: number) => (seconds / 3600).toFixed(1);

function captionState(caption: Caption): "stale" | "draft" | "changed" | "published" {
  if (caption.stale) return "stale";
  if (!caption.publishedAt) return "draft";
  return caption.updatedAt > caption.publishedAt ? "changed" : "published";
}

export function LessonAiCaptions({ courseId, lessonId, assetId }: { courseId: string; lessonId: string; assetId: string }) {
  const { t, locale } = useTranslation();
  const [captions, setCaptions] = useState<Caption[] | null>(null);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [usage, setUsage] = useState<Usage | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [spoken, setSpoken] = useState("en");
  const [target, setTarget] = useState("");

  useEffect(() => {
    let live = true;
    const query = new URLSearchParams({ courseId, lessonId, assetId });
    fetch(`/api/teach/ai?${query}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!live) return;
        if (!response.ok) {
          setCaptions([]);
          setNotice({ kind: "error", text: body.error ?? t("creatorEditor.lesson.ai.errorGeneric") });
          return;
        }
        setCaptions(body.captions);
        setTexts(Object.fromEntries(body.captions.map((caption: Caption) => [caption.language, caption.vtt])));
        setUsage(body.usage);
      })
      .catch(() => {
        if (live) {
          setCaptions([]);
          setNotice({ kind: "error", text: t("creatorEditor.lesson.ai.errorGeneric") });
        }
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

  async function run(action: string, extra: Record<string, unknown>, busyKey: string, okText: string) {
    setBusy(busyKey);
    setNotice(null);
    try {
      const response = await fetch("/api/teach/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, courseId, lessonId, assetId, ...extra }),
      });
      const body = await response.json().catch(() => ({}));
      if (body.usage) setUsage(body.usage);
      if (!response.ok) {
        setNotice({ kind: "error", text: body.error ?? t("creatorEditor.lesson.ai.errorGeneric") });
        return;
      }
      if (body.caption) keep({ ...body.caption, stale: false });
      if (body.removed) {
        setCaptions((current) => (current ?? []).filter((item) => item.language !== body.removed));
        setTexts((current) => Object.fromEntries(Object.entries(current).filter(([code]) => code !== body.removed)));
      }
      setNotice({ kind: "ok", text: okText });
    } catch {
      setNotice({ kind: "error", text: t("creatorEditor.lesson.ai.errorGeneric") });
    } finally {
      setBusy(null);
    }
  }

  const name = (code: string) => captionLanguageName(code, locale);
  const fresh = (captions ?? []).filter((caption) => !caption.stale);
  const source = fresh.find((caption) => caption.language === spoken) ?? fresh[0];
  const targets = CAPTION_LANGUAGES.filter((code) => !fresh.some((caption) => caption.language === code));
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
              onClick={() => run("transcribe", { language: spoken }, "transcribe", t("creatorEditor.lesson.ai.generated"))}
            >
              {busy === "transcribe"
                ? t("creatorEditor.lesson.ai.generating")
                : t(fresh.some((caption) => caption.language === spoken)
                  ? "creatorEditor.lesson.ai.regenerate"
                  : "creatorEditor.lesson.ai.generate")}
            </button>
          </div>

          {captions.map((caption) => {
            const state = captionState(caption);
            return (
              <details key={caption.language} className="lesson-modal-field" open={state !== "published" && state !== "stale"}>
                <summary>
                  {name(caption.language)} · {t(`creatorEditor.lesson.ai.state.${state}`)}
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
                        className="button-outline min-h-11 px-3 text-sm"
                        disabled={working || texts[caption.language] === caption.vtt}
                        onClick={() => run("saveCaption", { language: caption.language, vtt: texts[caption.language] },
                          `save-${caption.language}`, t("creatorEditor.lesson.ai.saved"))}
                      >
                        {t("creatorEditor.lesson.ai.save")}
                      </button>
                      <button
                        type="button"
                        className="button-solid min-h-11 px-4 py-2.5 text-sm disabled:opacity-60"
                        disabled={working || texts[caption.language] !== caption.vtt || state === "published"}
                        onClick={() => run("publishCaption", { language: caption.language },
                          `publish-${caption.language}`, t("creatorEditor.lesson.ai.publishedNotice"))}
                      >
                        {t("creatorEditor.lesson.ai.publish")}
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className="button-danger px-3.5 py-2 text-xs disabled:opacity-60"
                    disabled={working}
                    onClick={() => run("removeCaption", { language: caption.language },
                      `remove-${caption.language}`, t("creatorEditor.lesson.ai.removed"))}
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
                className="button-outline min-h-11 px-3 text-sm"
                disabled={working || !target}
                onClick={() => run("translate", { from: source.language, to: target }, "translate",
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
