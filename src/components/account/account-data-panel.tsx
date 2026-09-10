"use client";

import { useState } from "react";
import { useTranslation } from "@/components/i18n/i18n-provider";

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
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }

    setIsDeleting(true);
    setMessage("");
    setError("");

    try {
      await requestAccountDeletionAction();
      setMessage("accountData.deleteSuccess");
      setConfirmingDelete(false);
    } catch {
      setError("accountData.deleteError");
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <section className="rounded-[14px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
      <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
        {t("accountData.label")}
      </p>
      <h3 className="display-title mt-3 text-3xl text-[var(--color-ink)]">
        {t("accountData.title")}
      </h3>
      <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
        {t("accountData.description")}
      </p>

      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={handleExport}
          disabled={isExporting || isDeleting}
          className="button-outline px-4 py-2 text-sm disabled:opacity-60"
        >
          {t(isExporting ? "accountData.requesting" : "accountData.export")}
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={isExporting || isDeleting}
          className="rounded-[8px] border border-[rgba(178,34,52,0.3)] bg-white px-4 py-2 text-sm font-semibold text-[var(--color-danger-fg)] transition hover:bg-[rgba(178,34,52,0.06)] disabled:opacity-60"
        >
          {t(isDeleting
            ? "accountData.requesting"
            : confirmingDelete
              ? "accountData.confirmDelete"
              : "accountData.delete")}
        </button>
        {confirmingDelete ? (
          <button
            type="button"
            onClick={() => setConfirmingDelete(false)}
            className="button-outline px-4 py-2 text-sm"
          >
            {t("accountData.cancel")}
          </button>
        ) : null}
      </div>
      <p className="mt-3 text-xs leading-5 text-[var(--color-ink-soft)]">
        {t("accountData.processing")}
      </p>

      {message ? (
        <p className="mt-4 info-notice">
          {t(message)}
        </p>
      ) : null}
      {error ? (
        <p className="mt-4 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]">
          {t(error)}
        </p>
      ) : null}
    </section>
  );
}
