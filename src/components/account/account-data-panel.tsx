"use client";

import { useState } from "react";

import {
  requestAccountDeletionAction,
  requestDataExportAction,
} from "@/lib/data/account-actions";

export function AccountDataPanel() {
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
      setMessage("Data export request received. Skillset will process it manually within 72 hours.");
    } catch {
      setError("Could not request your data export. Try again in a moment.");
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
      setMessage("Account deletion request received. Skillset will process it manually within 72 hours.");
      setConfirmingDelete(false);
    } catch {
      setError("Could not request account deletion. Try again in a moment.");
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <section className="rounded-[4px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
      <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-brand)]">
        Account and data
      </p>
      <h3 className="display-title mt-3 text-3xl text-[var(--color-ink)]">
        Your data, your account
      </h3>
      <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
        Your data belongs to you. Export a copy or request account deletion
        at any time. These requests are handled manually and confirmed by
        our team.
      </p>

      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={handleExport}
          disabled={isExporting || isDeleting}
          className="button-outline px-4 py-2 text-sm disabled:opacity-60"
        >
          {isExporting ? "Requesting..." : "Export everything"}
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={isExporting || isDeleting}
          className="rounded-[8px] border border-[rgba(178,34,52,0.3)] bg-white px-4 py-2 text-sm font-semibold text-[var(--color-accent-fg)] transition hover:bg-[rgba(178,34,52,0.06)] disabled:opacity-60"
        >
          {isDeleting
            ? "Requesting..."
            : confirmingDelete
              ? "Confirm delete request"
              : "Delete account"}
        </button>
        {confirmingDelete ? (
          <button
            type="button"
            onClick={() => setConfirmingDelete(false)}
            className="button-outline px-4 py-2 text-sm"
          >
            Cancel
          </button>
        ) : null}
      </div>
      <p className="mt-3 text-xs leading-5 text-[var(--color-ink-soft)]">
        Requests are currently processed manually within 72 hours. Automated
        one-click export and deletion are in development.
      </p>

      {message ? (
        <p className="mt-4 info-notice">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="mt-4 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-accent-fg)]">
          {error}
        </p>
      ) : null}
    </section>
  );
}
