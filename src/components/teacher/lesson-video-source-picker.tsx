"use client";

import { useId, useImperativeHandle, useRef, useState, type DragEvent, type ReactNode, type Ref } from "react";
import { HelpCircle, Link2, ShieldAlert, UploadCloud } from "lucide-react";

import { Tooltip } from "@/components/shared/tooltip";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { getTrustedLessonEmbed } from "@/domain/lesson-embed";

export type LessonVideoMode = "upload" | "link";

// O modal chama flushLink antes de fechar por Esc ou clique fora: nesses
// caminhos o campo e desmontado sem blur que chegue ao React 19, e o link
// digitado se perdia. "rejected" e "declined" seguram o modal aberto, com o
// erro ou o aviso na tela, em vez de perder o link calado.
export type LinkCommitResult = "saved" | "unchanged" | "rejected" | "declined";
// `silent`: descarga ao sair da pagina. Nunca abre confirmacao; o que pediria
// uma ("declined") simplesmente nao e gravado.
export type LessonVideoSourcePickerHandle = {
  flushLink: (options?: { silent?: boolean }) => LinkCommitResult;
};

// Um input type="url" tira quebras de linha e os espacos das pontas do valor:
// o valor esperado de uma colagem e comparado ja limpo.
function cleanUrlInput(value: string) {
  return value.replace(/[\r\n]/g, "").trim();
}

// Sem esquema ("youtube.com/watch?v=..."), assume https:// antes de validar; o
// link gravado ja sai normalizado.
function normalizeLink(value: string) {
  const trimmed = value.trim();
  return !trimmed || /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

// Uma aula, um video (decisao de 14/09): o estudio mostra OU o envio OU o link
// do YouTube/Vimeo, nunca os dois. Trocar e uma acao explicita ("Replace with
// link" / "Replace with upload") e nao apaga nada: o envio antigo continua
// listado no modal, com o proprio botao de apagar.
// ponytail: o ref sai de `props` na desestruturacao; se ficasse, a regra
// react-hooks/refs tratava todo `props.x` como leitura de ref no render.
export function LessonVideoSourcePicker({ replaceButtonRef, linkHandleRef, ...props }: {
  mode: LessonVideoMode;
  disabled?: boolean;
  accept: string;
  externalUrl: string;
  embedStatus: string;
  onModeChange: (next: LessonVideoMode) => void;
  onSelectFile: (file: File) => void;
  // So recebe link aceito (YouTube/Vimeo), ou null quando o professor apaga o
  // link aceito que o campo mostrava. Link recusado nunca sai daqui. Devolve
  // false quando o modal nao gravou (o professor nao confirmou): o campo volta
  // ao que esta salvo.
  onLinkChange: (next: string | null, options?: { silent?: boolean }) => boolean | void;
  uploadPanel?: ReactNode;
  // Alvo estavel de foco para o modal (ex.: depois de tirar o link antigo).
  replaceButtonRef?: Ref<HTMLButtonElement>;
  linkHandleRef?: Ref<LessonVideoSourcePickerHandle>;
  // Com texto, o campo de link fica so leitura e mostra este aviso (ex.: os
  // arquivos da aula ainda nao chegaram).
  linkLockedHint?: string;
}) {
  const { t } = useTranslation();
  const urlInputId = useId();
  const errorId = useId();
  const [isDragActive, setIsDragActive] = useState(false);
  const savedIsEmbed = Boolean(getTrustedLessonEmbed(props.externalUrl));
  // Rascunho local: o que o professor digita so vira dado quando e link aceito.
  // Um link antigo que nao e video (Drive etc.) nao entra no campo: o modal o
  // mostra a parte, so leitura.
  const [draft, setDraft] = useState(() => (savedIsEmbed ? props.externalUrl : ""));
  const [rejected, setRejected] = useState(false);
  // Valor que a ultima colagem deve produzir; o onChange seguinte o consome.
  const pastedValueRef = useRef<string | null>(null);
  const locked = Boolean(props.linkLockedHint);

  function selectFile(file: File) {
    // Escolher um arquivo NÃO declara a fonte da aula. Antes declarava, e isso
    // apagava a aula para quem já tinha pago: `videoSource` é persistido pelo
    // autosave de 1,8s e é o campo que o aluno lê para escolher o player. Com a
    // fonte em "upload" e nenhum arquivo enviado — porque o professor escolheu o
    // arquivo errado, ou desistiu ao estourar o limite —, o aluno passava a ver
    // "Media not attached yet", enquanto o link do YouTube continuava salvo e
    // válido, só nunca mais consultado.
    //
    // Quem declara a fonte é o caminho de SUCESSO do envio, no
    // lesson-content-modal — quando existe, de fato, um arquivo para tocar.
    props.onSelectFile(file);
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDragActive(false);

    if (props.disabled) {
      return;
    }

    const file = Array.from(event.dataTransfer.files).find((candidate) =>
      candidate.type.startsWith("video/"),
    );

    if (file) {
      selectFile(file);
    }
  }

  // Grava so ao sair do campo, no Enter ou ao colar: salvar a cada tecla
  // gravava ids de video truncados e acusava erro no meio da digitacao.
  function commitLink(value: string, silent = false): LinkCommitResult {
    if (locked) {
      return "unchanged";
    }

    const url = normalizeLink(value);

    if (url && !getTrustedLessonEmbed(url)) {
      setRejected(true);
      return "rejected";
    }

    setRejected(false);
    // Campo vazio tira o link aceito que ele mostrava. Um link antigo nunca
    // aparece aqui (a base e ""), entao nunca e apagado por este caminho.
    const saved = savedIsEmbed ? props.externalUrl : "";
    if (url === saved) {
      setDraft(url);
      return "unchanged";
    }
    const kept = (silent
      ? props.onLinkChange(url || null, { silent: true })
      : props.onLinkChange(url || null)) !== false;
    // Nao gravou: o campo volta ao salvo, senao cada blur seguinte (X, aba,
    // "Replace with upload") perguntava de novo e comia o clique. Na descarga
    // silenciosa ninguem foi perguntado: o que foi digitado fica no campo.
    if (kept || !silent) {
      setDraft(kept ? url : saved);
    }
    return kept ? "saved" : "declined";
  }

  useImperativeHandle(linkHandleRef, () => ({
    flushLink: (options) => (props.mode === "link" ? commitLink(draft, options?.silent) : "unchanged"),
  }));

  return (
    <div className="lesson-video-source-picker">
      <p className="lesson-video-source-picker__heading">{t("creatorEditor.videoSource.heading")}</p>
      <div className="lesson-video-source-picker__options">
        {props.mode === "upload" ? (
          props.uploadPanel ?? (
            <label
              className={`lesson-video-source-picker__dropzone${
                isDragActive ? " is-drag-active" : ""
              }`}
              data-disabled={props.disabled ? "true" : undefined}
              onDragOver={(event) => {
                event.preventDefault();
                if (!props.disabled) {
                  setIsDragActive(true);
                }
              }}
              onDragLeave={() => setIsDragActive(false)}
              onDrop={handleDrop}
            >
              <input
                type="file"
                accept={props.accept}
                disabled={props.disabled}
                aria-label={t("creatorEditor.videoSource.fileInput")}
                className="lesson-modal-upload__input"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    selectFile(file);
                  }
                  // Allow re-picking the same file after a failed upload.
                  event.target.value = "";
                }}
              />
              <UploadCloud aria-hidden="true" size={22} />
              <span>
                <strong>{t("creatorEditor.videoSource.device")}</strong>
                <small>
                  {isDragActive
                    ? t("creatorEditor.videoSource.dropActive")
                    : t("creatorEditor.videoSource.dropIdle")}
                </small>
                <small>{t("creatorEditor.videoSource.browseHelp")}</small>
              </span>
              <span className="button-solid">
                {t("creatorEditor.videoSource.chooseVideo")}
              </span>
            </label>
          )
        ) : (
          <div className="lesson-video-source-picker__url is-active">
            <span className="lesson-video-source-picker__url-label">
              <Link2 aria-hidden="true" size={15} className="shrink-0" />
              <label htmlFor={urlInputId} className="min-w-0 font-bold">{t("creatorEditor.videoSource.url")}</label>
              <Tooltip content={t("creatorEditor.videoSource.help")}>
                <button
                  type="button"
                  aria-label={t("creatorEditor.videoSource.helpLabel")}
                  className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                >
                  <HelpCircle aria-hidden="true" size={13} />
                </button>
              </Tooltip>
            </span>
            <input
              id={urlInputId}
              type="url"
              value={draft}
              disabled={props.disabled}
              readOnly={locked}
              aria-invalid={rejected || undefined}
              aria-describedby={rejected ? errorId : undefined}
              placeholder="https://www.youtube.com/watch?v=..."
              // O navegador cola no cursor ou na selecao (e o Ctrl+Z desfaz);
              // aqui so se anota o valor que a colagem deve produzir, e o
              // onChange seguinte grava se o valor bater. Colar o mesmo texto
              // (ou nada) nao dispara onChange, e a anotacao nao bate com a
              // tecla seguinte, entao nenhuma tecla vira colagem.
              onPaste={(event) => {
                const text = event.clipboardData?.getData("text") ?? "";
                const input = event.currentTarget;
                const start = input.selectionStart ?? input.value.length;
                const end = input.selectionEnd ?? start;
                pastedValueRef.current = text
                  ? input.value.slice(0, start) + text + input.value.slice(end)
                  : null;
              }}
              onChange={(event) => {
                const pasted = pastedValueRef.current;
                pastedValueRef.current = null;
                if (locked) {
                  return;
                }
                setDraft(event.target.value);
                setRejected(false);
                if (pasted !== null && cleanUrlInput(pasted) === cleanUrlInput(event.target.value)) {
                  commitLink(event.target.value);
                }
              }}
              onBlur={(event) => commitLink(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitLink(event.currentTarget.value);
                }
              }}
            />
            {rejected ? (
              <small id={errorId} role="alert" className="font-semibold text-[var(--color-danger-fg)]">
                {t("creatorEditor.videoSource.rejected")}
              </small>
            ) : (
              <small>{props.linkLockedHint ?? props.embedStatus}</small>
            )}
            {/* The protection trade-off belongs next to the link: an embed is
                still a public link on YouTube or Vimeo; only Upload gets
                per-student signed playback. */}
            <small className="mt-1 flex items-start gap-1.5 text-[var(--color-ink-muted)]">
              <ShieldAlert aria-hidden="true" size={13} className="mt-px shrink-0" />
              <span>
                {t("creatorEditor.videoSource.protectionNote")}
              </span>
            </small>
          </div>
        )}
      </div>
      <button
        ref={replaceButtonRef}
        type="button"
        className="button-outline justify-self-start px-3 py-2 text-xs disabled:opacity-60"
        disabled={props.disabled}
        onClick={() => props.onModeChange(props.mode === "upload" ? "link" : "upload")}
      >
        {props.mode === "upload"
          ? t("creatorEditor.videoSource.replaceWithLink")
          : t("creatorEditor.videoSource.replaceWithUpload")}
      </button>
    </div>
  );
}
