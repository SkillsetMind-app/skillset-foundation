"use client";

import { Check, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { Button, InlineAlert, buttonClasses } from "@/components/ui";
import type { PlatformInvite } from "@/domain/platform-invites";
import { acceptPlatformInvite, getMyPlatformInvite } from "@/lib/data/platform-invites";

const copy = "platformInvites";

export function PlatformInviteAcceptance({ id }: { id: string }) {
  const { status, user } = useAuth();
  const { t } = useTranslation();
  const returnTo = encodeURIComponent(`/invitations/${encodeURIComponent(id)}`);

  return <section className="mx-auto w-full max-w-xl min-w-0 space-y-5 px-4 py-10 text-[var(--color-ink)]">
    <h1 className="text-2xl font-bold">{t(`${copy}.acceptTitle`)}</h1>
    {status === "loading" ? <p role="status">{t(`${copy}.loading`)}</p> : status === "authenticated" && user ? (
      <RecipientInvite key={`${id}:${user.uid}:${user.email}:${user.emailVerified}`} id={id} />
    ) : <div className="space-y-4">
      <p className="text-sm">{t(`${copy}.signInRequired`)}</p>
      <div className="flex flex-wrap gap-3">
        <Link href={`/login?returnTo=${returnTo}`} className={buttonClasses({}, "min-h-11 max-w-full whitespace-normal")}>{t(`${copy}.signIn`)}</Link>
        <Link href={`/signup?returnTo=${returnTo}`} className={buttonClasses({ variant: "outline" }, "min-h-11 max-w-full whitespace-normal")}>{t(`${copy}.signUp`)}</Link>
      </div>
    </div>}
  </section>;
}

function RecipientInvite({ id }: { id: string }) {
  const { t } = useTranslation();
  const [invite, setInvite] = useState<PlatformInvite | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const active = useRef(true);

  useEffect(() => {
    let cancelled = false;
    active.current = true;
    getMyPlatformInvite(id).then(result => {
      if (!cancelled) setInvite(result);
    }).catch(() => {
      if (!cancelled) setError("recipientError");
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; active.current = false; };
  }, [id, revision]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const ended = invite?.revoked_at ? "revoked" : invite?.accepted_at ? (invite.activation_pending ? null : "accepted") : invite && !(Date.parse(invite.expires_at) > now) ? "expired" : null;

  async function accept() {
    if (!invite || busy || ended) return;
    if (!invite.activation_pending && !(Date.parse(invite.expires_at) > Date.now())) { setNow(Date.now()); return; }
    setBusy(true);
    setError("");
    try {
      const { next_path } = await acceptPlatformInvite(id);
      if (!active.current) return;
      if (!["/onboarding?path=teacher", "/ops", "/learn"].includes(next_path)) throw new Error("Invalid destination");
      window.location.assign(next_path);
    } catch {
      if (!active.current) return;
      setError("acceptError");
      setBusy(false);
    }
  }

  return <div className="min-w-0 space-y-4">
    {loading ? <p role="status">{t(`${copy}.loading`)}</p> : null}
    {error ? <InlineAlert tone="error">{t(`${copy}.${error}`)}</InlineAlert> : null}
    {!loading && !invite ? <Button variant="outline" className="min-h-11" onClick={() => { setError(""); setLoading(true); setRevision(value => value + 1); }}><RotateCcw size={16} aria-hidden />{t(`${copy}.retry`)}</Button> : null}
    {invite ? <>
      <p className="break-all text-sm font-semibold">{invite.email}</p>
      <dl className="space-y-3 border-y border-[var(--color-line)] py-4 text-sm">
        <div><dt className="text-[var(--color-ink-soft)]">{t(`${copy}.level`)}</dt><dd className="font-semibold">{t(`platform.ops.accessPanel.levels.${invite.access_level}.label`)}</dd></div>
        {invite.access_level === "teacher" ? <div><dt className="text-[var(--color-ink-soft)]">{t(`${copy}.activationFee`)}</dt><dd>{t(`${copy}.${invite.waive_activation ? "waived" : "notWaived"}`)}</dd></div> : null}
      </dl>
      {ended ? <InlineAlert tone="info">{t(`${copy}.status.${ended}`)}</InlineAlert> : <Button disabled={busy} className="min-h-11 max-w-full whitespace-normal" onClick={() => void accept()}><Check size={16} className="shrink-0" aria-hidden />{t(`${copy}.${busy ? "accepting" : "accept"}`)}</Button>}
    </> : null}
  </div>;
}
