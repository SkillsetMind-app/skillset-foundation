"use client";

import { useState, type DragEvent } from "react";
import { HelpCircle, Link2, ShieldAlert, UploadCloud } from "lucide-react";

import { Tooltip } from "@/components/shared/tooltip";
import { useTranslation } from "@/components/i18n/i18n-provider";

type LessonVideoSource = "youtube" | "upload";

// Both video sources are first-class and always visible: a drag&drop dropzone
// for uploads next to the YouTube/Vimeo URL field (stacked on mobile). There is
// no "choose a source first" step — interacting with either side selects it.
export function LessonVideoSourcePicker(props: {
  value: LessonVideoSource | null;
  disabled?: boolean;
  accept: string;
  externalUrl: string;
  embedStatus: string;
  onChange: (next: LessonVideoSource) => void;
  onSelectFile: (file: File) => void;
  onExternalUrlChange: (next: string) => void;
}) {
  const { t } = useTranslation();
  const [isDragActive, setIsDragActive] = useState(false);

  function selectFile(file: File) {
    // Escolher um arquivo NÃO declara a fonte da aula. Antes declarava, e isso
    // apagava a aula para quem já tinha pago: `videoSource` é persistido pelo
    // autosave de 1,8s e é o campo que o aluno lê para escolher o player. Com a
    // fonte em "upload" e nenhum arquivo enviado — porque o professor escolheu o
    // arquivo errado, ou desistiu ao estourar o limite —, o aluno passava a ver
    // "Media not attached yet", enquanto o link do YouTube continuava salvo e
    // válido, só nunca mais consultado. E o cabeçalho do modal seguia dizendo
    // "Media is connected.", porque aquele rótulo olha anexo e embed e ignora a
    // fonte: a tela do professor se contradizia sozinha.
    //
    // Quem declara a fonte é o caminho de SUCESSO do envio, no
    // lesson-content-modal — quando existe, de fato, um arquivo para tocar.
    //
    // O que abre o painel de envio é o `value` que o modal passa: ele considera
    // "upload" enquanto houver arquivo escolhido, mesmo antes de gravar a fonte.
    // Sem isso o professor ficava sem saída — o formulário de envio só aparecia
    // depois de uma gravação que só acontece depois do envio.
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

  return (
    <div className="lesson-video-source-picker">
      <p className="lesson-video-source-picker__heading">{t("creatorEditor.videoSource.heading")}</p>
      <div className="lesson-video-source-picker__options">
        <label
          className={`lesson-video-source-picker__dropzone${
            isDragActive ? " is-drag-active" : ""
          }${props.value === "upload" ? " is-active" : ""}`}
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
            <strong>
              {isDragActive
                ? t("creatorEditor.videoSource.dropActive")
                : t("creatorEditor.videoSource.dropIdle")}
            </strong>
            <small>{t("creatorEditor.videoSource.browseHelp")}</small>
          </span>
        </label>

        <label
          className={`lesson-video-source-picker__url${
            props.value === "youtube" ? " is-active" : ""
          }`}
        >
          <span className="lesson-video-source-picker__url-label">
            <Link2 aria-hidden="true" size={15} />
            <strong>{t("creatorEditor.videoSource.url")}</strong>
            <Tooltip content={t("creatorEditor.videoSource.help")}>
              <button
                type="button"
                aria-label={t("creatorEditor.videoSource.helpLabel")}
                className="inline-flex items-center text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]"
              >
                <HelpCircle aria-hidden="true" size={13} />
              </button>
            </Tooltip>
          </span>
          <input
            type="url"
            value={props.externalUrl}
            disabled={props.disabled}
            placeholder="https://www.youtube.com/watch?v=..."
            onChange={(event) => {
              if (props.value !== "youtube") {
                props.onChange("youtube");
              }
              props.onExternalUrlChange(event.target.value);
            }}
          />
          <small>{props.embedStatus}</small>
          {/* The teacher decides between the two sources right here, so the
              protection trade-off belongs here too — not buried in a help page.
              An embed is still a public link on YouTube or Vimeo; only Upload
              gets per-student signed playback. */}
          <small className="mt-1 flex items-start gap-1.5 text-[var(--color-ink-muted)]">
            <ShieldAlert aria-hidden="true" size={13} className="mt-px shrink-0" />
            <span>
              {t("creatorEditor.videoSource.protectionNote")}
            </span>
          </small>
        </label>
      </div>
    </div>
  );
}
