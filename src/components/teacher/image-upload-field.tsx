"use client";

import { Image as ImageIcon, UploadCloud } from "lucide-react";
import { useId, type InputHTMLAttributes, type Ref } from "react";

import { InlineAlert } from "@/components/ui";
import type { UploadCourseAssetProgress } from "@/lib/data/course-assets";
import { cn } from "@/lib/cn";

import { UploadProgressNote } from "./upload-progress-note";

type FileInputAttrs = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "className"> & {
  ref?: Ref<HTMLInputElement>;
  /** Trocar o valor remonta o campo de arquivo e limpa a escolha anterior. */
  resetKey?: number;
};

export type ImageUploadFieldProps = {
  /** Nome do campo: o título visível e o nome da região. */
  title: string;
  /** Regras do arquivo, logo abaixo do título; também descrevem o botão. */
  help?: string;
  preview: {
    src: string | null | undefined;
    alt: string;
    /** 2:3 em 128px (capa do módulo); sem isto, 16:9 em até 200px. */
    portrait?: boolean;
    /** Outra moldura (proporção e largura) no lugar de 16:9 em até 200px:
     *  a vitrine usa 1:1 no logo e 16:7 na capa, como já desenhava. */
    frame?: string;
    /** A imagem inteira, com folga, em vez de cobrir a moldura (o logo). */
    contain?: boolean;
    /** Texto do quadro vazio. */
    emptyLabel?: string;
  };
  /** Rótulo fixo do botão: não vira "Uploading..."; o andamento é a nota. */
  triggerLabel: string;
  /** O campo de arquivo como cada tela já o tinha (accept, onChange, disabled...). */
  input: FileInputAttrs;
  /** "Remove" em texto vermelho, só com imagem e fora da vista durante um envio. */
  remove?: { label: string; onClick: () => void };
  progress: UploadCourseAssetProgress | null;
  error?: string;
  /** Linha de ajuda quando nada sobe e não há erro. */
  note?: string;
  className?: string;
};

/**
 * A casca única do campo de imagem (B-05): prévia, botão de escolher/trocar,
 * nota de envio, aviso de erro e o "Remove". Eram quatro desenhos à mão (as
 * duas capas do construtor, a imagem da página de venda e a capa da área de
 * membros). Só apresentação: cada tela segue com o próprio envio, limites,
 * compressão e o que faz com o resultado.
 */
export function ImageUploadField({
  title,
  help,
  preview,
  triggerLabel,
  input,
  remove,
  progress,
  error,
  note,
  className,
}: ImageUploadFieldProps) {
  const helpId = useId();
  const { resetKey, ...inputAttrs } = input;
  const disabled = Boolean(inputAttrs.disabled);
  const { portrait = false } = preview;

  return (
    <section aria-label={title} className={cn("grid min-w-0 content-start gap-3", className)}>
      <div>
        <p className="text-sm font-semibold text-[var(--color-ink)]">{title}</p>
        {help ? (
          <p id={helpId} className="mt-1 max-w-xl text-xs leading-5 text-[var(--color-ink-soft)]">
            {help}
          </p>
        ) : null}
      </div>

      <div className={portrait ? "grid min-w-0 gap-3" : "grid min-w-0 gap-3 sm:grid-cols-[200px_minmax(0,1fr)] sm:items-start"}>
        <div
          className={`relative overflow-hidden rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] ${
            portrait ? "aspect-[2/3] w-32" : (preview.frame ?? "aspect-video w-full max-w-[200px]")
          }`}
        >
          {preview.src ? (
            // eslint-disable-next-line @next/next/no-img-element -- a imagem vem do Storage ou de um link colado
            <img src={preview.src} alt={preview.alt} className={preview.contain ? "h-full w-full object-contain p-2" : "h-full w-full object-cover"} />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-[var(--color-ink-soft)]">
              <ImageIcon size={22} aria-hidden />
              {preview.emptyLabel ? (
                <span className="text-[11px] font-semibold uppercase tracking-[0.12em]">{preview.emptyLabel}</span>
              ) : null}
            </div>
          )}
        </div>

        <div className="grid min-w-0 content-start gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <label
              className={`inline-flex min-h-11 w-fit items-center gap-2 rounded-md border border-dashed border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 text-sm font-semibold text-[var(--color-primary)] transition-colors duration-[var(--duration-base)] ease-[var(--ease-standard)] hover:border-[var(--color-primary-light)] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--focus-ring)] ${
                disabled ? "pointer-events-none opacity-60" : "cursor-pointer"
              }`}
            >
              <UploadCloud size={16} aria-hidden />
              {triggerLabel}
              <input
                key={resetKey}
                {...inputAttrs}
                type="file"
                aria-describedby={help ? helpId : undefined}
                className="sr-only"
              />
            </label>
            {remove && preview.src && !progress ? (
              <button
                type="button"
                onClick={remove.onClick}
                className="min-h-11 w-fit text-xs font-semibold text-[var(--color-danger-fg)] underline-offset-2 hover:underline"
              >
                {remove.label}
              </button>
            ) : null}
          </div>

          {/* Um lugar só para o estado: andamento, ou erro, ou a ajuda. */}
          {progress ? (
            <UploadProgressNote progress={progress} />
          ) : error ? (
            <InlineAlert tone="error" className="px-3 py-2 text-xs">
              {error}
            </InlineAlert>
          ) : note ? (
            <p className="text-xs leading-5 text-[var(--color-ink-soft)]">{note}</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
