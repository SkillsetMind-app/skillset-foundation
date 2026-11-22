"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

/**
 * Confirmação de uma ação que não volta (cancelar plano, pedir exclusão).
 * Substitui o `window.confirm`: a caixa cinza do navegador trava a aba, não
 * tem nada da marca e "OK / Cancel" não diz o que acontece.
 *
 * Uso — monte só enquanto a pergunta está aberta:
 *
 *   {asking ? (
 *     <ConfirmDialog
 *       title={t("planTrial.cancel")}
 *       confirmLabel={t("planTrial.cancel")}
 *       pendingLabel={t("planTrial.cancelling")}
 *       cancelLabel={t("planTrial.keepPlan")}
 *       danger
 *       onConfirm={cancelPlan}          // pode ser async
 *       onClose={() => setAsking(false)}
 *     >
 *       {frase que já existia no window.confirm}
 *     </ConfirmDialog>
 *   ) : null}
 *
 * O que ele garante, para quem chama não precisar lembrar:
 * - `<dialog>` nativo aberto com showModal(): a página de trás fica inerte e
 *   o foco não sai da janela;
 * - o foco começa em "cancelar" (o lado seguro) e volta ao botão que abriu;
 * - Esc fecha, exceto enquanto a confirmação está em andamento;
 * - durante o `onConfirm` o botão trava e mostra `pendingLabel`: dois cliques
 *   seguidos disparam a ação uma vez só;
 * - fecha sozinho quando o `onConfirm` termina (o resultado, sucesso ou erro,
 *   é mostrado por quem chamou, na própria tela);
 * - cabe na tela (.modal-panel, AGENTS.md) e tem 16px de margem no celular.
 */
export type ConfirmDialogProps = {
  title: string;
  /** Rótulo pequeno acima do título. Opcional. */
  eyebrow?: string;
  /** O corpo: a frase que explica a consequência. */
  children: ReactNode;
  confirmLabel: string;
  /** Texto do botão enquanto o `onConfirm` roda. Sem ele, fica o confirmLabel. */
  pendingLabel?: string;
  cancelLabel: string;
  /** Vermelho cheio no botão de confirmar (apagar, cancelar o que é pago). */
  danger?: boolean;
  onConfirm: () => unknown;
  /** Chamado quando a janela fecha, por qualquer caminho. Desmonte aqui. */
  onClose: () => void;
};

export function ConfirmDialog({
  title,
  eyebrow,
  children,
  confirmLabel,
  pendingLabel,
  cancelLabel,
  danger = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  // O estado re-renderiza; a ref barra o segundo clique que chega antes disso.
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    const trigger =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) dialog.showModal();
    dialog?.querySelector<HTMLElement>("[data-confirm-cancel]")?.focus();
    return () => {
      // Quando a ação some com a tela (o "Cancel plan" deixa de existir depois
      // de cancelar), não há para onde devolver o foco.
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);

  async function confirm() {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    try {
      await onConfirm();
    } finally {
      pendingRef.current = false;
      setPending(false);
      dialogRef.current?.close();
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onCancel={(event) => {
        // Esc: fechamos nós mesmos para respeitar o "em andamento".
        event.preventDefault();
        if (!pendingRef.current) dialogRef.current?.close();
      }}
      onClose={onClose}
      className="modal-panel modal-panel-scroll motion-panel-in m-auto w-[calc(100%_-_2rem)] max-w-md rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-0 text-[var(--color-ink)] shadow-[var(--shadow-strong)] backdrop:bg-[rgba(15,39,68,0.62)]"
    >
      <div className="grid gap-2 p-6">
        {eyebrow ? (
          <p
            className={cn(
              "text-[11px] font-bold uppercase tracking-[0.18em]",
              danger ? "text-[var(--color-danger-fg)]" : "text-[var(--color-accent-fg)]",
            )}
          >
            {eyebrow}
          </p>
        ) : null}
        <h2 id={titleId} className="display-title text-2xl leading-tight text-[var(--color-primary)]">
          {title}
        </h2>
        <div id={bodyId} className="text-sm leading-6 text-[var(--color-ink-soft)]">
          {children}
        </div>
      </div>
      {/* No celular os botões empilham com o de confirmar em cima; do sm em
          diante ficam à direita, o seguro primeiro. */}
      <div className="flex flex-col-reverse gap-3 border-t border-[var(--color-line)] px-6 py-4 sm:flex-row sm:justify-end">
        <Button
          variant="outline"
          data-confirm-cancel=""
          disabled={pending}
          onClick={() => dialogRef.current?.close()}
        >
          {cancelLabel}
        </Button>
        <Button
          variant={danger ? "danger" : "solid"}
          className={danger ? "button-danger-solid" : undefined}
          loading={pending}
          onClick={() => void confirm()}
        >
          {pending && pendingLabel ? pendingLabel : confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
