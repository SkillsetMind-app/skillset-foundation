"use client";

import { useEffect, useId, useRef } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui";

/**
 * Pergunta antes das ações do /ops que tiram algo do ar ou recusam alguém
 * (I-04): eram um clique só, no mesmo contorno de "Request changes".
 * Mesmo padrão da janela de acesso à conta: <dialog> nativo com showModal(),
 * que prende o foco, fecha no Esc e devolve o foco a quem abriu. Nunca
 * window.confirm: a caixa do navegador não diz o que vai acontecer.
 */
export function ConfirmActionDialog({ title, body, confirmLabel, onConfirm, onClose }: {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  return <dialog ref={dialog} aria-labelledby={`${id}-title`} aria-describedby={`${id}-body`} onClose={onClose}
    className="modal-panel modal-panel-scroll m-auto w-[calc(100%_-_2rem)] max-w-[480px] rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-5 text-[var(--color-ink)] backdrop:bg-[rgba(16,42,67,0.5)] sm:p-6">
    <h2 id={`${id}-title`} className="break-words text-lg font-bold">{title}</h2>
    <p id={`${id}-body`} className="mt-2 text-sm leading-6 text-[var(--color-ink-soft)]">{body}</p>
    <div className="mt-6 flex flex-wrap justify-end gap-3">
      <Button variant="outline" onClick={() => dialog.current?.close()}>{t("platform.ops.confirmDialog.cancel")}</Button>
      <Button variant="danger" className="whitespace-normal" onClick={() => { onConfirm(); dialog.current?.close(); }}>
        {confirmLabel}
      </Button>
    </div>
  </dialog>;
}
