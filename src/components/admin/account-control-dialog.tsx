"use client";

import { Ban, ShieldCheck, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { Button, Field, InlineAlert } from "@/components/ui";
import { getAccountControl, setAccountControl, type AccountAction, type AccountControl } from "@/lib/data/account-controls";

const errors: Record<string, string> = {
  ACCOUNT_CONTROL_ADMIN_MFA_REQUIRED: "mfaRequired",
  ACCOUNT_CONTROL_SELF: "self",
  ACCOUNT_CONTROL_LAST_ADMIN: "lastAdmin",
  ACCOUNT_CONTROL_USER_MISSING: "userMissing",
  ACCOUNT_CONTROL_EMAIL_MISSING: "emailMissing",
  ACCOUNT_CONTROL_EMAIL_CONFLICT: "emailConflict",
  ACCOUNT_CONTROL_INVALID_INPUT: "invalidInput",
};

export function AccountControlDialog({ uid, label, onClose }: { uid: string; label: string; onClose: () => void }) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const pending = useRef(false);
  const [control, setControl] = useState<AccountControl | null>(null);
  const [action, setAction] = useState<AccountAction>("suspend");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  useEffect(() => {
    let current = true;
    void getAccountControl(uid).then(value => {
      if (!current) return;
      setControl(value);
      setAction(value.suspended ? "restore" : "suspend");
    }).catch(caught => {
      if (!current) return;
      const message = caught && typeof caught === "object" && "message" in caught ? caught.message : null;
      setError(typeof message === "string" ? errors[message] ?? "loadError" : "loadError");
    });
    return () => { current = false; };
  }, [uid, reload]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending.current || !control || control.isSelf || reason.trim().length < 3) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      setControl(await setAccountControl(uid, action, reason));
      setSaved(true);
    } catch (caught) {
      const message = caught && typeof caught === "object" && "message" in caught ? caught.message : null;
      setError(typeof message === "string" ? errors[message] ?? "saveError" : "saveError");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return <dialog ref={dialog} aria-labelledby="account-control-title" aria-describedby="account-control-person"
    onCancel={event => { if (pending.current) event.preventDefault(); }} onClose={onClose}
    className="modal-panel modal-panel-scroll m-auto w-[calc(100%_-_2rem)] max-w-lg rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-5 text-[var(--color-ink)] backdrop:bg-black/50">
    <div className="flex items-start justify-between gap-3">
      <h2 id="account-control-title" className="text-lg font-bold">{t("accountControls.title")}</h2>
      <Button variant="ghost" className="h-11 w-11 shrink-0 p-0" disabled={busy}
        aria-label={t("accountControls.close")} title={t("accountControls.close")} onClick={() => dialog.current?.close()}><X size={18} aria-hidden /></Button>
    </div>
    <p id="account-control-person" className="mt-2 break-all text-sm">{label}</p>
    {error ? <InlineAlert tone="error" className="mt-4">{t(`accountControls.${error}`)}</InlineAlert> : null}
    {!control ? error ? <Button variant="outline" className="mt-4 min-h-11" onClick={() => { setError(null); setReload(value => value + 1); }}>{t("authFlow.loading.retry")}</Button>
      : <p role="status" className="mt-4 text-sm">{t("accountControls.loading")}</p> : <>
      <p className="mt-4 text-sm font-semibold">{t(`accountControls.${control.suspended ? "suspended" : "active"}`)}</p>
      {control.blockedEmail ? <p className="mt-2 break-all text-sm">{t("accountControls.blockedEmail")}: {control.blockedEmail}</p> : null}
      {control.isSelf ? <InlineAlert tone="warning" className="mt-4">{t("accountControls.self")}</InlineAlert> : null}
      {saved ? <InlineAlert tone="success" className="mt-4">{t("accountControls.saved")}</InlineAlert> : <form onSubmit={submit} className="mt-4 space-y-4">
        <fieldset disabled={busy || control.isSelf} className="space-y-2">
          <legend className="mb-2 text-sm font-semibold">{t("accountControls.action")}</legend>
          {(["suspend", "block", "restore"] as const).map(value => <label key={value} className="flex min-h-11 items-center gap-3 text-sm">
            <input type="radio" name="account-action" value={value} checked={action === value} onChange={() => setAction(value)} />
            <span>{t(`accountControls.${value}`)}</span>
          </label>)}
        </fieldset>
        <p className="text-sm text-[var(--color-ink-soft)]">{t(`accountControls.${action}Impact`)}</p>
        <Field id="account-control-reason" label={t("accountControls.reason")}>
          {a11y => <textarea {...a11y} required minLength={3} maxLength={500} rows={3} disabled={busy || control.isSelf}
            value={reason} onChange={event => setReason(event.target.value)}
            className="w-full resize-y rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-3 text-sm" />}
        </Field>
        <Button type="submit" variant={action === "restore" ? "solid" : "danger"}
          className="min-h-11 w-full whitespace-normal" disabled={busy || control.isSelf || reason.trim().length < 3}>
          {action === "restore" ? <ShieldCheck size={18} className="shrink-0" aria-hidden /> : <Ban size={18} className="shrink-0" aria-hidden />}
          {t(`accountControls.${busy ? "saving" : "confirm"}`)}
        </Button>
      </form>}
    </>}
  </dialog>;
}
