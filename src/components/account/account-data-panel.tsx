"use client";

import { useState } from "react";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { BusyLabel } from "@/components/ui/busy-label";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { InlineAlert } from "@/components/ui/inline-alert";

import {
  requestAccountDeletionAction,
  requestDataExportAction,
} from "@/lib/data/account-actions";

export function AccountDataPanel() {
  const { t } = useTranslation();
  const [isExporting, setIsExporting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function handleExport() {
    setIsExporting(true);
    setMessage("");
    setError("");

    try {
      await requestDataExportAction();
      setMessage("accountData.exportSuccess");
    } catch {
      setError("accountData.exportError");
    } finally {
      setIsExporting(false);
    }
  }

  async function handleDelete() {
    setIsDeleting(true);
    setMessage("");
    setError("");

    try {
      await requestAccountDeletionAction();
      setMessage("accountData.deleteSuccess");
    } catch {
      setError("accountData.deleteError");
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <section className="settings-section-card">
      <h2 className="text-lg font-bold text-[var(--color-ink)]">
        {t("accountData.title")}
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-ink-soft)]">
        {t("accountData.description")}
      </p>

      <div className="mt-5 flex flex-wrap gap-3">
        <Button
          variant="outline"
          onClick={handleExport}
          disabled={isExporting || isDeleting}
        >
          <BusyLabel busy={isExporting} idle={t("accountData.export")} busyText={t("accountData.requesting")} />
        </Button>
        {/* Antes o próprio botão virava "Confirm delete request" no mesmo
            lugar, e um clique duplo já pedia a exclusão. A pergunta agora é
            uma janela, e só o botão de dentro dela envia o pedido. */}
        <Button
          variant="danger"
          aria-haspopup="dialog"
          onClick={() => setConfirmingDelete(true)}
          disabled={isExporting || isDeleting}
        >
          <BusyLabel busy={isDeleting} idle={t("accountData.delete")} busyText={t("accountData.requesting")} />
        </Button>
      </div>
      <p className="mt-3 text-xs leading-5 text-[var(--color-ink-soft)]">
        {t("accountData.processing")}
      </p>

      {message ? (
        <InlineAlert tone="success" className="mt-4">
          {t(message)}
        </InlineAlert>
      ) : null}
      {error ? (
        <InlineAlert tone="error" className="mt-4">
          {t(error)}
        </InlineAlert>
      ) : null}

      {confirmingDelete ? (
        <ConfirmDialog
          eyebrow={t("accountData.delete")}
          title={t("accountData.deleteTitle")}
          confirmLabel={t("accountData.confirmDelete")}
          pendingLabel={t("accountData.requesting")}
          cancelLabel={t("accountData.cancel")}
          danger
          onConfirm={handleDelete}
          onClose={() => setConfirmingDelete(false)}
        >
          {t("accountData.processing")}
        </ConfirmDialog>
      ) : null}
    </section>
  );
}
