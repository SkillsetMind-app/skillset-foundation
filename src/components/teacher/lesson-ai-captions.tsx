"use client";

import { useEffect, useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { RetryAlert } from "@/components/teacher/save-status-line";
import { useConfirm } from "@/components/teacher/use-confirm";
import { Button } from "@/components/ui";
import { CAPTION_LANGUAGES, captionLanguageName, isCaptionLanguage } from "@/domain/caption-languages";
import { callTeachAi, loadTeachAi, teachAiErrorText, type TeachAiResult } from "@/lib/ai/teach-ai-client";

// AI captions in the lesson studio (Video tab, only video uploaded to Bunny).
// The AI writes a draft from the audio; the teacher reads, corrects and publishes.
// The learner only sees the published caption, on the CC button of the Bunny player.

type Caption = {
  language: string;
  vtt: string;
  translatedFrom: string | null;
  updatedAt: string;
  publishedAt: string | null;
  stale: boolean;
};
type Usage = { usedSeconds: number; limitSeconds: number };
// The error keeps the request that failed: "Try again" repeats exactly that one.
type Notice = { kind: "ok"; text: string } | { kind: "error"; text: string; retry: () => void } | null;

function captionState(caption: Caption): "stale" | "draft" | "changed" | "published" {
  if (caption.stale) return "stale";
  if (!caption.publishedAt) return "draft";
  return caption.updatedAt > caption.publishedAt ? "changed" : "published";
}

export function LessonAiCaptions({ courseId, lessonId, assetId }: { courseId: string; lessonId: string; assetId: string }) {
  const { t, locale } = useTranslation();
  const { ask, dialog: confirmDialog } = useConfirm();
  const [captions, setCaptions] = useState<Caption[] | null>(null);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [usage, setUsage] = useState<Usage | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [spoken, setSpoken] = useState<string>(isCaptionLanguage(locale) ? locale : "en");
  const [target, setTarget] = useState("");
  // Each read attempt: "Try again" after a failure reads again.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    void loadTeachAi({ courseId, lessonId, assetId }).then((result) => {
      if (!live) return;
      if (!result.ok) {
        setCaptions([]);
        setNotice({
          kind: "error",
          text: teachAiErrorText(result, t),
          retry: () => {
            setCaptions(null);
            setNotice(null);
            setAttempt((current) => current + 1);
          },
        });
        return;
      }
      const loaded = result.body.captions as Caption[];
      setCaptions(loaded);
      setTexts(Object.fromEntries(loaded.map((caption) => [caption.language, caption.vtt])));
      setUsage(result.body.usage as Usage);
      // The spoken language is that of the caption that is not a translation, if there is one already.
      const original = loaded.find((caption) => !caption.stale && !caption.translatedFrom);
      if (original) setSpoken(original.language);
    });
    return () => {
      live = false;
    };
  }, [courseId, lessonId, assetId, t, attempt]);

  function keep(caption: Caption) {
    setCaptions((current) => {
      const rest = (current ?? []).filter((item) => item.language !== caption.language);
      return [...rest, caption].sort((a, b) => a.language.localeCompare(b.language));
    });
    setTexts((current) => ({ ...current, [caption.language]: caption.vtt }));
  }

  // `retry`: what "Try again" redoes. Without it, the same request; Publish
  // passes the whole action (save and publish), not only the step that failed.
  // `handled`: an error the caller handles on its own (true = no alert).
  async function run(
    action: string,
    extra: Record<string, unknown>,
    busyKey: string,
    okText: string,
    retry?: () => void,
    handled?: (result: TeachAiResult) => boolean,
  ): Promise<boolean> {
    setBusy(busyKey);
    setNotice(null);
    const result = await callTeachAi({ action, courseId, lessonId, assetId, ...extra });
    setBusy(null);
    if (result.body.usage) setUsage(result.body.usage as Usage);
    if (!result.ok) {
      if (handled?.(result)) return false;
      setNotice({
        kind: "error",
        text: teachAiErrorText(result, t),
        retry: retry ?? (() => void run(action, extra, busyKey, okText)),
      });
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

  // Publishing with edited text saves first: the teacher does not have to guess
  // that "Save" comes first.
  async function publish(caption: Caption) {
    const again = () => void publish(caption);
    const edited = texts[caption.language] !== caption.vtt;
    if (edited && !(await run("saveCaption", { language: caption.language, vtt: texts[caption.language] },
      `publish-${caption.language}`, t("creatorEditor.lesson.ai.saved"), again))) {
      return;
    }
    const busyKey = `publish-${caption.language}`;
    const okText = t("creatorEditor.lesson.ai.publishedNotice");
    // The video already has a caption in this language, made outside here: publishing replaces it.
    // Asks; canceling changes nothing and shows no error.
    await run("publishCaption", { language: caption.language }, busyKey, okText, again, (result) => {
      if (result.body.code !== "caption_exists") return false;
      ask({
        title: t("creatorEditor.lesson.ai.confirmReplaceCaptionsTitle"),
        body: t("creatorEditor.lesson.ai.confirmReplaceCaptions").replace("{language}", () => name(caption.language)),
        confirmLabel: t("creatorEditor.lesson.ai.replaceCaptions"),
        danger: true,
        run: () => void run("publishCaption", { language: caption.language, replace: true }, busyKey, okText),
      });
      return true;
    });
  }

  // The text or a language changed after the failure: "Try again" would redo the old
  // request (old text on top, or another language spending the AI hours). The
  // error goes away; the action button uses what is on screen.
  function dropStaleRetry() {
    setNotice((current) => (current?.kind === "error" ? null : current));
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
    <section aria-labelledby="lesson-ai-captions-title" aria-busy={working || captions === null} className="grid min-w-0 gap-3">
      <h4 id="lesson-ai-captions-title" className="text-sm font-semibold">{t("creatorEditor.lesson.ai.title")}</h4>
      <p className="text-sm text-[var(--color-ink-soft)]">{t("creatorEditor.lesson.ai.help")}</p>
      {usage ? (
        <p className="text-sm text-[var(--color-ink-soft)]">
          {t("creatorEditor.lesson.ai.usage")
            .replace("{used}", () => hours(usage.usedSeconds))
            .replace("{limit}", () => hours(usage.limitSeconds))}
        </p>
      ) : null}

      {/* The shape of the row that comes next (language + button), not a loose sentence
          (F-03). The section's aria-busy already says it is loading. */}
      {captions === null ? (
        <div className="flex animate-pulse flex-wrap items-end gap-3">
          <span className="sr-only">{t("creatorEditor.lesson.ai.loading")}</span>
          <div aria-hidden="true" className="h-11 min-w-[12rem] flex-1 rounded-md bg-[var(--color-surface-strong)]" />
          <div aria-hidden="true" className="h-11 w-40 rounded-md bg-[var(--color-surface-strong)]" />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <label className="lesson-modal-field min-w-0 flex-1">
              <span>{t("creatorEditor.lesson.ai.spokenLanguage")}</span>
              <select
                value={spoken}
                disabled={working}
                onChange={(event) => {
                  setSpoken(event.target.value);
                  dropStaleRetry();
                }}
              >
                {CAPTION_LANGUAGES.map((code) => (
                  <option key={code} value={code}>{name(code)}</option>
                ))}
              </select>
            </label>
            <Button
              disabled={working}
              loading={busy === "transcribe"}
              onClick={() => {
                const generate = () => {
                  void run("transcribe", { language: spoken }, "transcribe", t("creatorEditor.lesson.ai.generated"));
                };
                // Generating again erases the corrections and spends the video's hours once more.
                if (!spokenExists) return generate();
                ask({
                  title: t("creatorEditor.lesson.ai.confirmRegenerateTitle"),
                  body: t("creatorEditor.lesson.ai.confirmRegenerate"),
                  confirmLabel: t("creatorEditor.lesson.ai.regenerate"),
                  danger: true,
                  run: generate,
                });
              }}
            >
              {/* The label keeps swapping, on purpose: the wait is a sentence
                  (about three times "Generate captions") and reserving it
                  would leave the button wide and the language selector squeezed. */}
              {busy === "transcribe"
                ? t("creatorEditor.lesson.ai.generating")
                : t(spokenExists ? "creatorEditor.lesson.ai.regenerate" : "creatorEditor.lesson.ai.generate")}
            </Button>
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
                    onChange={(event) => {
                      setTexts((current) => ({ ...current, [caption.language]: event.target.value }));
                      dropStaleRetry();
                    }}
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
                        disabled={working || !edited}
                        aria-busy={busy === `save-${caption.language}` || undefined}
                        onClick={() => void run("saveCaption", { language: caption.language, vtt: texts[caption.language] },
                          `save-${caption.language}`, t("creatorEditor.lesson.ai.saved"))}
                      >
                        {t("creatorEditor.lesson.ai.save")}
                      </button>
                      <button
                        type="button"
                        className="button-solid min-h-11 px-4 py-2.5 text-sm"
                        disabled={working || (state === "published" && !edited)}
                        aria-busy={busy === `publish-${caption.language}` || undefined}
                        onClick={() => void publish(caption)}
                      >
                        {t("creatorEditor.lesson.ai.publish")}
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className="button-danger px-3.5 py-2 text-xs"
                    disabled={working}
                    onClick={() => ask({
                      title: t("creatorEditor.lesson.ai.confirmRemoveTitle"),
                      body: t("creatorEditor.lesson.ai.confirmRemove"),
                      confirmLabel: t("creatorEditor.lesson.ai.remove"),
                      danger: true,
                      run: () => {
                        void run("removeCaption", { language: caption.language },
                          `remove-${caption.language}`, t("creatorEditor.lesson.ai.removed"));
                      },
                    })}
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
                <select
                  value={target}
                  disabled={working}
                  onChange={(event) => {
                    setTarget(event.target.value);
                    dropStaleRetry();
                  }}
                >
                  <option value="">{t("creatorEditor.lesson.ai.chooseLanguage")}</option>
                  {targets.map((code) => (
                    <option key={code} value={code}>{name(code)}</option>
                  ))}
                </select>
              </label>
              <Button
                variant="outline"
                disabled={working || !target}
                loading={busy === "translate"}
                onClick={() => void run("translate", { from: source.language, to: target }, "translate",
                  t("creatorEditor.lesson.ai.translated"))}
              >
                {/* Like "Generate captions": reserving spinner and
                    "Translating..." would squeeze the language selector beside it. */}
                {busy === "translate" ? t("creatorEditor.lesson.ai.translating") : t("creatorEditor.lesson.ai.translate")}
              </Button>
            </div>
          ) : null}
        </>
      )}

      <p role="status" aria-live="polite" className="text-sm text-[var(--color-ink-soft)]">
        {notice?.kind === "ok" ? notice.text : ""}
      </p>
      {notice?.kind === "error" ? <RetryAlert text={notice.text} onRetry={notice.retry} /> : null}
      {confirmDialog}
    </section>
  );
}
