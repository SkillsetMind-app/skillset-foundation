"use client";

import { Ban, ShieldCheck, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { StatusChip } from "@/components/shared/status-chip";
import { Button, Field, InlineAlert } from "@/components/ui";
import { cn } from "@/lib/cn";
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

// O botão diz o que vai acontecer; "Confirm account change" servia para as três.
const confirmKeys: Record<AccountAction, string> = {
  suspend: "confirmSuspend",
  block: "confirmBlock",
  restore: "confirmRestore",
};

function accountState(control: AccountControl) {
  return control.blockedEmail ? "blocked" : control.suspended ? "suspended" : "active";
}

export function AccountControlDialog({ uid, label, onClose }: { uid: string; label: string; onClose: () => void }) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const pending = useRef(false);
  const [control, setControl] = useState<AccountControl | null>(null);
  // Abre sem nada marcado: suspender vinha pré-escolhido numa conta ativa (I-02).
  const [action, setAction] = useState<AccountAction | null>(null);
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
      if (current) setControl(value);
    }).catch(caught => {
      if (!current) return;
      const message = caught && typeof caught === "object" && "message" in caught ? caught.message : null;
      setError(typeof message === "string" ? errors[message] ?? "loadError" : "loadError");
    });
    return () => { current = false; };
  }, [uid, reload]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending.current || !control || control.isSelf || !action || reason.trim().length < 3) return;
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

  // Só as ações que mudam algo: o banco ignora suspender quem já está
  // suspenso e restaurar quem está ativo, então elas nem aparecem.
  const options = control
    ? (["suspend", "block", "restore"] as const).filter(value => control.suspended ? value !== "suspend" : value !== "restore")
    : [];
  const close = () => dialog.current?.close();

  return <dialog ref={dialog} aria-labelledby="account-control-title" aria-describedby="account-control-person"
    onCancel={event => { if (pending.current) event.preventDefault(); }} onClose={onClose}
    className="modal-panel modal-panel-scroll m-auto w-[calc(100%_-_2rem)] max-w-lg rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-5 text-[var(--color-ink)] backdrop:bg-[rgba(16,42,67,0.5)] sm:p-6">
    <div className="flex items-start justify-between gap-3">
      <h2 id="account-control-title" className="text-lg font-bold">{t("accountControls.title")}</h2>
      <Button variant="ghost" className="h-11 w-11 shrink-0 p-0" disabled={busy}
        aria-label={t("accountControls.close")} title={t("accountControls.close")} onClick={close}><X size={18} aria-hidden /></Button>
    </div>
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <p id="account-control-person" className="min-w-0 break-all text-sm text-[var(--color-ink-soft)]">{label}</p>
      {/* Mesma regra da tabela e da ficha: e-mail bloqueado é "blocked" (vermelho). */}
      {control ? <StatusChip status={accountState(control)} label={t(`accountControls.${accountState(control)}`)} /> : null}
    </div>
    {error ? <InlineAlert tone="error" className="mt-4">{t(`accountControls.${error}`)}</InlineAlert> : null}
    {!control ? error ? <Button variant="outline" className="mt-4 min-h-11" onClick={() => { setError(null); setReload(value => value + 1); }}>{t("authFlow.loading.retry")}</Button>
      : <p role="status" className="mt-4 text-sm">{t("accountControls.loading")}</p> : <>
      {control.blockedEmail ? <p className="mt-2 break-all text-sm">{t("accountControls.blockedEmail")}: {control.blockedEmail}</p> : null}
      {control.isSelf ? <InlineAlert tone="warning" className="mt-4">{t("accountControls.self")}</InlineAlert> : null}
      {saved ? <div className="mt-5 grid gap-4">
        <InlineAlert tone="success">{t("accountControls.saved")}</InlineAlert>
        <Button className="justify-self-end" onClick={close}>{t("accountControls.done")}</Button>
      </div> : <form onSubmit={submit} className="mt-5 space-y-4">
        <fieldset disabled={busy || control.isSelf} className="grid gap-2">
          <legend className="mb-2 text-sm font-semibold">{t("accountControls.action")}</legend>
          {options.map(value => <div key={value} className={cn("rounded-md border px-3.5 py-1",
            action === value ? "border-[1.5px] border-[var(--color-primary)] bg-[var(--color-surface-soft)]" : "border-[var(--color-line)]")}>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-semibold">
              <input type="radio" name="account-action" value={value} checked={action === value} onChange={() => setAction(value)}
                aria-describedby={action === value ? "account-control-impact" : undefined}
                className="h-[18px] w-[18px] shrink-0 accent-[var(--color-primary)]" />
              <span>{t(`accountControls.${value}`)}</span>
            </label>
            {action === value ? <p id="account-control-impact" className="mb-2 pl-[30px] text-[13px] leading-5 text-[var(--color-ink-soft)]">
              {t(`accountControls.${value}Impact`)}
            </p> : null}
          </div>)}
        </fieldset>
        <Field id="account-control-reason" label={t("accountControls.reason")}>
          {a11y => <textarea {...a11y} required minLength={3} maxLength={500} rows={3} disabled={busy || control.isSelf}
            value={reason} onChange={event => setReason(event.target.value)}
            className="field-input resize-y disabled:cursor-not-allowed disabled:opacity-60" />}
        </Field>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <Button variant="outline" disabled={busy} onClick={close}>{t("accountControls.cancel")}</Button>
          {/* Bloquear o e-mail é o mais grave: vermelho cheio. Suspender, contorno vermelho. Restaurar, azul. */}
          <Button type="submit" variant={action === "restore" ? "solid" : action ? "danger" : "outline"}
            className={cn("whitespace-normal", action === "block" && "button-danger-solid")} loading={busy}
            icon={action === "restore" ? <ShieldCheck size={18} className="shrink-0" aria-hidden /> : action ? <Ban size={18} className="shrink-0" aria-hidden /> : null}
            disabled={!action || control.isSelf || reason.trim().length < 3}>
            {t(action ? `accountControls.${confirmKeys[action]}` : "accountControls.chooseAction")}
          </Button>
        </div>
      </form>}
    </>}
  </dialog>;
}
