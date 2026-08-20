"use client";

import { Check, Copy, Globe, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import type { CustomDomainStatus } from "@/domain/custom-domain";
import {
  dnsInstructionFor,
  domainRejectionMessage,
  nextActionFor,
  parseCustomDomain,
} from "@/domain/custom-domain";

type DomainRow = {
  id: string;
  hostname: string;
  status: CustomDomainStatus;
  verification_name: string | null;
  verification_value: string | null;
  error_reason: string | null;
};

type Quota = { used: number; limit: number };

const statusLabel: Record<CustomDomainStatus, string> = {
  pending_dns: "Waiting for DNS",
  pending_verification: "Waiting for verification",
  active: "Live",
  error: "Problem",
};

/**
 * Status colour carries the same information as the label, for the same reason
 * the rest of the studio does it: a teacher scanning a list of three domains
 * should see which one needs them without reading.
 */
const statusTone: Record<CustomDomainStatus, string> = {
  pending_dns: "bg-amber-100 text-amber-900",
  pending_verification: "bg-amber-100 text-amber-900",
  active: "bg-emerald-100 text-emerald-900",
  error: "bg-red-100 text-red-900",
};

/**
 * A DNS record is copied into another website's form, character by character.
 * A typo in a TXT challenge fails silently and looks exactly like "DNS has not
 * propagated yet", so the copy button is not a nicety here — it removes the
 * single most likely reason a teacher's domain never goes live.
 */
function CopyableRecord({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="grid gap-1">
      <span className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-ink-soft)]">
        {label}
      </span>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-[8px] border border-[var(--color-line)] bg-white px-3 py-2 font-mono text-sm text-[var(--color-ink)]">
          {value}
        </code>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(value).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2000);
            });
          }}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-[8px] border border-[var(--color-line)] bg-white text-[var(--color-ink-soft)] transition hover:text-[var(--color-ink)]"
          aria-label={`Copy ${label}`}
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

function DomainCard({
  domain,
  onRemove,
  onRecheck,
  busy,
}: {
  domain: DomainRow;
  onRemove: (id: string) => void;
  onRecheck: (id: string) => void;
  busy: boolean;
}) {
  const action = nextActionFor(domain);
  const dns = dnsInstructionFor(domain.hostname);

  return (
    <div className="grid gap-3 rounded-[14px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Globe className="h-4 w-4 shrink-0 text-[var(--color-ink-soft)]" />
        <span className="min-w-0 flex-1 truncate font-semibold text-[var(--color-ink)]">
          {domain.hostname}
        </span>
        <span
          className={`rounded-full px-3 py-1 text-xs font-bold ${statusTone[domain.status]}`}
        >
          {statusLabel[domain.status]}
        </span>
      </div>

      {domain.status === "error" && domain.error_reason ? (
        <p className="text-sm text-red-800">{domain.error_reason}</p>
      ) : null}

      {action ? (
        <p className="text-sm leading-6 text-[var(--color-ink-soft)]">{action}</p>
      ) : null}

      {domain.status === "pending_dns" ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <CopyableRecord label="Type" value={dns.type} />
          <CopyableRecord label="Name" value={dns.name} />
          <CopyableRecord label="Value" value={dns.value} />
        </div>
      ) : null}

      {domain.status === "pending_verification" &&
      domain.verification_name &&
      domain.verification_value ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <CopyableRecord label="Type" value="TXT" />
          <CopyableRecord label="Name" value={domain.verification_name} />
          <CopyableRecord label="Value" value={domain.verification_value} />
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {domain.status !== "active" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onRecheck(domain.id)}
            className="inline-flex items-center gap-2 rounded-[10px] border border-[var(--color-line)] bg-white px-3 py-2 text-sm font-semibold text-[var(--color-ink)] disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
            Check again
          </button>
        ) : null}
        <button
          type="button"
          disabled={busy}
          onClick={() => onRemove(domain.id)}
          className="inline-flex items-center gap-2 rounded-[10px] border border-[var(--color-line)] bg-white px-3 py-2 text-sm font-semibold text-red-700 disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" />
          Disconnect
        </button>
      </div>
    </div>
  );
}

export function CustomDomainsPanel() {
  const [domains, setDomains] = useState<DomainRow[]>([]);
  const [quota, setQuota] = useState<Quota>({ used: 0, limit: 0 });
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [hostname, setHostname] = useState("");
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/teach/domains");
      if (!response.ok) throw new Error();
      const payload = await response.json();
      setDomains(payload.domains ?? []);
      setQuota(payload.quota ?? { used: 0, limit: 0 });
      setConfigured(payload.configured !== false);
    } catch {
      setError("We could not load your domains.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Defer so the effect body itself does not synchronously setState (lint).
    // Same shape as course-offers-panel.tsx.
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function handleAdd(event: FormEvent) {
    event.preventDefault();
    setError("");

    // Validated here as well as on the server so the common typo — a pasted
    // full web address — is answered instantly rather than after a round trip.
    const parsed = parseCustomDomain(hostname);
    if (!parsed.ok) {
      setError(domainRejectionMessage[parsed.reason]);
      return;
    }

    setAdding(true);
    try {
      const response = await fetch("/api/teach/domains", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hostname: parsed.hostname }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? "Could not add that domain.");
        return;
      }
      setHostname("");
      await load();
    } catch {
      setError("Could not add that domain.");
    } finally {
      setAdding(false);
    }
  }

  async function handleRecheck(id: string) {
    setBusyId(id);
    try {
      await fetch(`/api/teach/domains/${id}`, { method: "POST" });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function handleRemove(id: string) {
    setBusyId(id);
    try {
      await fetch(`/api/teach/domains/${id}`, { method: "DELETE" });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  const atQuota = quota.limit > 0 && quota.used >= quota.limit;
  const lockedOnPlan = quota.limit === 0;

  return (
    <section className="settings-section-card">
      <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
        Teacher Studio
      </p>
      <h2 className="display-title mt-3 text-3xl text-[var(--color-primary)]">
        Your own domain
      </h2>
      <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
        Point a domain you own at your storefront, so students arrive at your
        address instead of ours. You keep the domain; we handle the certificate.
      </p>

      {!configured ? (
        <p className="mt-6 rounded-[12px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-4 text-sm text-[var(--color-ink-soft)]">
          Custom domains are not switched on yet. Nothing is wrong with your
          account — check back shortly.
        </p>
      ) : lockedOnPlan ? (
        <p className="mt-6 rounded-[12px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-4 text-sm text-[var(--color-ink-soft)]">
          Your plan does not include a custom domain. Upgrade to Starter to
          connect one.
        </p>
      ) : (
        <>
          <p className="mt-6 text-sm font-semibold text-[var(--color-ink)]">
            {quota.used} of {quota.limit} used
          </p>

          {loading ? (
            <p className="mt-4 flex items-center gap-2 text-sm text-[var(--color-ink-soft)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading your domains…
            </p>
          ) : (
            <div className="mt-4 grid gap-3">
              {domains.map((domain) => (
                <DomainCard
                  key={domain.id}
                  domain={domain}
                  busy={busyId === domain.id}
                  onRecheck={handleRecheck}
                  onRemove={handleRemove}
                />
              ))}
            </div>
          )}

          <form className="mt-5 grid gap-2" onSubmit={handleAdd}>
            <label className="grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
              Add a domain
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={hostname}
                  onChange={(event) => setHostname(event.target.value)}
                  placeholder="yourname.com"
                  disabled={atQuota || adding}
                  className="min-w-0 flex-1 rounded-[10px] border border-[var(--color-line)] bg-white px-3 py-2.5 font-mono text-sm text-[var(--color-ink)] disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={atQuota || adding || !hostname.trim()}
                  className="inline-flex items-center gap-2 rounded-[10px] bg-[var(--color-primary)] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
                >
                  {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Connect
                </button>
              </div>
            </label>

            {atQuota ? (
              <p className="text-sm text-[var(--color-ink-soft)]">
                You have connected every domain your plan includes. Upgrade to add
                another.
              </p>
            ) : null}

            {error ? <p className="text-sm text-red-700">{error}</p> : null}
          </form>
        </>
      )}
    </section>
  );
}
