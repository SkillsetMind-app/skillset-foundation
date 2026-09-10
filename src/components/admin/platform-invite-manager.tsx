"use client";

import { Ban, RotateCcw, Send } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { Button, Field, InlineAlert } from "@/components/ui";
import type { PlatformInvite } from "@/domain/platform-invites";
import { createPlatformInvite, listPlatformInvites, resendPlatformInvite, revokePlatformInvite } from "@/lib/data/platform-invites";

const copy = "platformInvites";
const levels = ["student", "teacher", "staff", "admin"] as const;

export function PlatformInviteManager() {
  const { t, locale } = useTranslation();
  const [invites, setInvites] = useState<PlatformInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [email, setEmail] = useState("");
  const [accessLevel, setAccessLevel] = useState<PlatformInvite["access_level"]>("student");
  const [waiveActivation, setWaiveActivation] = useState(false);
  const [confirmAdmin, setConfirmAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [emailStatuses, setEmailStatuses] = useState<Record<string, "sent" | "failed">>({});
  const [revision, setRevision] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    listPlatformInvites().then(rows => {
      if (!cancelled) setInvites(rows);
    }).catch(() => {
      if (!cancelled) setLoadFailed(true);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [revision]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  function remember(result: { invite: PlatformInvite; emailStatus: "sent" | "failed" }) {
    setInvites(current => [result.invite, ...current.filter(invite => invite.id !== result.invite.id)]);
    setEmailStatuses(current => ({ ...current, [result.invite.id]: result.emailStatus }));
    setNotice(result.emailStatus === "sent" ? "emailSent" : "emailFailed");
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || loading || !email.trim() || (accessLevel === "admin" && !confirmAdmin)) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      remember(await createPlatformInvite({ email: email.trim(), accessLevel, waiveActivation: accessLevel === "teacher" && waiveActivation }));
      setEmail("");
      setWaiveActivation(false);
      setConfirmAdmin(false);
    } catch {
      setError("saveError");
    } finally {
      setBusy(false);
    }
  }

  async function update(invite: PlatformInvite, action: "resend" | "revoke", clickedAt: number) {
    if (busy || invite.accepted_at || invite.revoked_at) return;
    if (action === "resend" && !(Date.parse(invite.expires_at) > clickedAt)) {
      setNow(clickedAt);
      return;
    }
    if (action === "revoke" && !window.confirm(t(`${copy}.revokeConfirm`).replace("{email}", () => invite.email))) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (action === "resend") {
        remember(await resendPlatformInvite(invite.id));
      } else {
        await revokePlatformInvite(invite.id);
        setInvites(current => current.map(row => row.id === invite.id ? { ...row, revoked_at: new Date().toISOString() } : row));
        setNotice("revokedNotice");
      }
    } catch {
      setError("saveError");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-w-0 space-y-6">
      <form onSubmit={event => void create(event)} className="space-y-4">
        <h2 className="text-lg font-bold text-[var(--color-ink)]">{t(`${copy}.newInvite`)}</h2>
        <fieldset disabled={busy} className="min-w-0 space-y-4">
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <Field id="platform-invite-email" label={t(`${copy}.email`)}>
              {a11y => <input {...a11y} type="email" autoComplete="email" required value={email} onChange={event => { setEmail(event.target.value); setConfirmAdmin(false); }} className="min-h-11 w-full min-w-0 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink)]" />}
            </Field>
            <Field id="platform-invite-level" label={t(`${copy}.level`)}>
              {a11y => <select {...a11y} value={accessLevel} onChange={event => {
                const next = event.target.value;
                if (!levels.some(level => level === next)) return;
                setAccessLevel(next as PlatformInvite["access_level"]);
                setWaiveActivation(false);
                setConfirmAdmin(false);
              }} className="min-h-11 w-full min-w-0 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink)]">
                {levels.map(level => <option key={level} value={level}>{t(`platform.ops.accessPanel.levels.${level}.label`)}</option>)}
              </select>}
            </Field>
          </div>
          {accessLevel === "teacher" ? <label className="flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" checked={waiveActivation} onChange={event => setWaiveActivation(event.target.checked)} />
            {t(`${copy}.waive`)}
          </label> : null}
          {accessLevel === "admin" ? <label className="flex min-h-11 items-center gap-3 text-sm text-[var(--color-danger-fg)]">
            <input type="checkbox" required checked={confirmAdmin} onChange={event => setConfirmAdmin(event.target.checked)} />
            {t(`${copy}.confirmAdmin`)}
          </label> : null}
          <Button type="submit" variant={accessLevel === "admin" ? "danger" : "solid"} disabled={busy || loading || (accessLevel === "admin" && !confirmAdmin)} className="min-h-11 max-w-full whitespace-normal">
            <Send size={16} className="shrink-0" aria-hidden />{t(`${copy}.${busy ? "saving" : "send"}`)}
          </Button>
        </fieldset>
      </form>
      {error ? <InlineAlert tone="error">{t(`${copy}.${error}`)}</InlineAlert> : null}
      {notice ? <InlineAlert tone={notice === "emailFailed" ? "warning" : "success"}>{t(`${copy}.${notice}`)}</InlineAlert> : null}
      <section className="min-w-0 border-t border-[var(--color-line)] pt-5" aria-label={t(`${copy}.list`)}>
        <h2 className="text-lg font-bold text-[var(--color-ink)]">{t(`${copy}.list`)}</h2>
        {loading ? <p role="status" className="mt-4 text-sm">{t(`${copy}.loading`)}</p> : null}
        {loadFailed ? <InlineAlert tone="error" className="mt-4">
          <p>{t(`${copy}.loadError`)}</p>
          <Button variant="outline" disabled={busy || loading} className="mt-2 min-h-11" onClick={() => { setLoading(true); setLoadFailed(false); setRevision(value => value + 1); }}><RotateCcw size={16} aria-hidden />{t(`${copy}.retry`)}</Button>
        </InlineAlert> : null}
        {!loading && !loadFailed && invites.length === 0 ? <p className="mt-4 text-sm text-[var(--color-ink-soft)]">{t(`${copy}.empty`)}</p> : null}
        <ul className="mt-4 divide-y divide-[var(--color-line)]">
          {invites.map(invite => {
            const state = invite.revoked_at ? "revoked" : invite.accepted_at ? "accepted" : Date.parse(invite.expires_at) > now ? "pending" : "expired";
            const ended = Boolean(invite.revoked_at || invite.accepted_at);
            const date = new Date(invite.expires_at);
            return <li key={invite.id} className="min-w-0 space-y-2 py-4">
              <p className="break-all text-sm font-bold">{invite.email}</p>
              <p className="text-sm">{t(`platform.ops.accessPanel.levels.${invite.access_level}.label`)} · {t(`${copy}.status.${state}`)}</p>
              <p className="text-sm text-[var(--color-ink-soft)]">{t(`${copy}.expires`)}: <time dateTime={invite.expires_at}>{Number.isNaN(date.getTime()) ? t(`${copy}.unavailable`) : date.toLocaleString(locale)}</time></p>
              {invite.access_level === "teacher" ? <p className="text-sm">{t(`${copy}.${invite.waive_activation ? "waived" : "notWaived"}`)}</p> : null}
              {emailStatuses[invite.id] ? <p className={`text-sm ${emailStatuses[invite.id] === "failed" ? "text-[var(--color-warning-fg)]" : "text-[var(--color-ink-soft)]"}`}>{t(`${copy}.${emailStatuses[invite.id] === "failed" ? "emailFailed" : "emailSent"}`)}</p> : null}
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" disabled={busy || loading || ended || state === "expired"} className="min-h-11 max-w-full whitespace-normal" onClick={() => void update(invite, "resend", Date.now())}><Send size={16} className="shrink-0" aria-hidden />{t(`${copy}.resend`)}</Button>
                <Button variant="danger" disabled={busy || loading || ended} className="min-h-11 max-w-full whitespace-normal" onClick={() => void update(invite, "revoke", Date.now())}><Ban size={16} className="shrink-0" aria-hidden />{t(`${copy}.revoke`)}</Button>
              </div>
            </li>;
          })}
        </ul>
      </section>
    </div>
  );
}
