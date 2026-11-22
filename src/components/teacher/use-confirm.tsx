"use client";

import { useState, type ReactNode } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

/**
 * Pergunta antes de uma ação que não volta, na janela da plataforma no lugar
 * do window.confirm (a caixa cinza do navegador, sem a marca, com "OK /
 * Cancel" que não diz o que acontece). `ask` guarda a pergunta; a janela monta
 * só enquanto ela existe e `run` roda uma vez, no confirmar: é o mesmo código
 * que rodava quando o confirm() devolvia true.
 */
export type ConfirmRequest = {
  title: string;
  /** A frase que já existia no window.confirm. */
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  run: () => unknown;
};

export function useConfirm(): {
  ask: (request: ConfirmRequest) => void;
  asking: boolean;
  dialog: ReactNode;
} {
  const { t } = useTranslation();
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  return {
    ask: setRequest,
    asking: request !== null,
    dialog: request ? (
      <ConfirmDialog
        title={request.title}
        confirmLabel={request.confirmLabel}
        cancelLabel={request.cancelLabel ?? t("creatorEditor.builder.curriculum.cancel")}
        danger={request.danger}
        onConfirm={request.run}
        onClose={() => setRequest(null)}
      >
        {request.body}
      </ConfirmDialog>
    ) : null,
  };
}
