"use client";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

/**
 * Pergunta antes das ações do /ops que tiram algo do ar ou recusam alguém
 * (I-04): eram um clique só, no mesmo contorno de "Request changes".
 *
 * Casca fina sobre a janela única da plataforma (`ui/confirm-dialog`), para o
 * admin ter uma implementação só: <dialog> nativo com showModal(), foco que
 * começa no lado seguro e volta a quem abriu, Esc, a trava do toque duplo e a
 * trava enquanto grava (os dois botões param e o Esc não fecha; um duplo
 * clique grava uma vez e não cai no botão de baixo).
 *
 * O contrato de quem chama continua o daqui: o painel já mostra o erro no
 * próprio lugar (a promessa não rejeita), então a janela fecha também quando a
 * gravação falha, em vez de abrir um segundo aviso dentro dela.
 */
export function ConfirmActionDialog({ title, body, confirmLabel, onConfirm, onClose }: {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => Promise<unknown>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <ConfirmDialog
      title={title}
      confirmLabel={confirmLabel}
      cancelLabel={t("platform.ops.confirmDialog.cancel")}
      danger
      onConfirm={async () => {
        try {
          await onConfirm();
        } catch {
          // Quem chamou já avisa no painel; aqui só fecha, como antes.
        }
      }}
      onClose={onClose}
    >
      {body}
    </ConfirmDialog>
  );
}
