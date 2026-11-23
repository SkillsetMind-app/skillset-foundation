"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/inline-alert";
import { cn } from "@/lib/cn";

/**
 * Por quanto tempo, depois de abrir, o botão de confirmar ignora cliques. No
 * celular os botões empilham e o de confirmar ocupa a largura toda logo abaixo
 * do centro da tela: num toque duplo, o 1º toque abre a janela e o 2º cairia
 * nele. O botão continua com cara de habilitado; o clique só é descartado.
 */
export const CONFIRM_GUARD_MS = 500;

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
 * - nos primeiros CONFIRM_GUARD_MS o confirmar não responde (toque duplo);
 * - durante o `onConfirm` o botão trava e mostra `pendingLabel`: dois cliques
 *   seguidos disparam a ação uma vez só;
 * - cabe na tela (.modal-panel, AGENTS.md) e tem 16px de margem no celular;
 *   a entrada e o fundo (--color-scrim) vêm da mesma classe, iguais às outras
 *   janelas.
 *
 * Erros — escolha um dos dois caminhos:
 * - o `onConfirm` trata o próprio erro e termina normalmente: a janela fecha e
 *   quem chamou mostra o resultado na tela (é o que planos e privacidade fazem);
 * - o `onConfirm` rejeita: a janela FICA aberta, destrava os botões e mostra
 *   `errorLabel` (ou uma frase genérica) para tentar de novo ou desistir.
 *
 * Aviso sem escolha (`acknowledge`): um botão só, o `confirmLabel`, sem
 * vermelho e sem a trava do toque duplo, porque dar ciência não desfaz nada.
 * Dois botões que fazem a mesma coisa (o "Close" ao lado de "Stay") eram lidos
 * como "sair mesmo assim", e o toque rápido caía na trava. Sem `cancelLabel`.
 */
export type ConfirmDialogProps = ConfirmDialogBaseProps &
  ({ acknowledge?: false; cancelLabel: string } | { acknowledge: true; cancelLabel?: never });

type ConfirmDialogBaseProps = {
  title: string;
  /** Rótulo pequeno acima do título. Opcional. */
  eyebrow?: string;
  /** O corpo: a frase que explica a consequência. */
  children: ReactNode;
  confirmLabel: string;
  /** Texto do botão enquanto o `onConfirm` roda. Sem ele, fica o confirmLabel. */
  pendingLabel?: string;
  /** Vermelho cheio no botão de confirmar (apagar, cancelar o que é pago). */
  danger?: boolean;
  onConfirm: () => unknown;
  /** Frase mostrada dentro da janela se o `onConfirm` rejeitar. */
  errorLabel?: string;
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
  errorLabel,
  onClose,
  acknowledge = false,
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  // O estado re-renderiza; a ref barra o segundo clique que chega antes disso.
  const pendingRef = useRef(false);
  const openedAt = useRef(Number.POSITIVE_INFINITY);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    const trigger =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) dialog.showModal();
    openedAt.current = Date.now();
    dialog?.querySelector<HTMLElement>("[data-confirm-cancel]")?.focus();
    return () => {
      // Quando a ação some com a tela (o "Cancel plan" deixa de existir depois
      // de cancelar), não há para onde devolver o foco.
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);

  async function confirm() {
    if (pendingRef.current || (!acknowledge && Date.now() - openedAt.current < CONFIRM_GUARD_MS)) return;
    pendingRef.current = true;
    setPending(true);
    setFailed(false);
    try {
      await onConfirm();
    } catch {
      // Quem chamou deixou o erro subir: a janela fica aberta e avisa, em vez
      // de sumir calada com uma rejeição sem dono.
      pendingRef.current = false;
      setPending(false);
      setFailed(true);
      return;
    }
    pendingRef.current = false;
    setPending(false);
    dialogRef.current?.close();
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
      className="dialog-panel modal-panel modal-panel-scroll m-auto w-[calc(100%_-_2rem)] text-[var(--color-ink)]"
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
        {failed ? (
          <InlineAlert tone="error" className="mt-2">
            {errorLabel ?? t("confirmDialog.error")}
          </InlineAlert>
        ) : null}
      </div>
      {/* O rodapé da casa: no celular os botões empilham com o de confirmar
          em cima; dos 480px em diante ficam à direita, o seguro primeiro. */}
      <div className="dialog-footer">
        {acknowledge ? null : (
          <Button
            variant="outline"
            data-confirm-cancel=""
            disabled={pending}
            onClick={() => dialogRef.current?.close()}
          >
            {cancelLabel}
          </Button>
        )}
        {/* No aviso sem escolha, o foco inicial vem para o botão único. */}
        <Button
          variant={danger && !acknowledge ? "danger" : "solid"}
          className={danger && !acknowledge ? "button-danger-solid" : undefined}
          data-confirm-cancel={acknowledge ? "" : undefined}
          loading={pending}
          onClick={() => void confirm()}
        >
          {pending && pendingLabel ? pendingLabel : confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
