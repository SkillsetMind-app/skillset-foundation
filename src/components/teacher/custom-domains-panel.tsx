"use client";

import { Check, Copy, Globe, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { StatusChip } from "@/components/shared/status-chip";
import {
  Button,
  Card,
  Eyebrow,
  Field,
  InlineAlert,
  SectionHeader,
} from "@/components/ui";
import type { CustomDomainStatus } from "@/domain/custom-domain";
import {
  dnsInstructionFor,
  domainRejectionMessage,
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

// These API messages predate localized UI. Keep the mapping here, without
// changing their contract or treating every HTTP 403 as a plan restriction.
const apiErrorKeys = new Map<string, string>([
  ["You must be signed in.", "signIn"],
  ["Custom domains are not available yet. Support has been notified.", "unavailable"],
  ["You have used every domain your plan includes. Upgrade to add another.", "quota"],
  ["Custom domains are not included on your plan.", "plan"],
  ["That domain is already connected.", "duplicate"],
  ["Could not add that domain.", "add"],
  ["Could not remove that domain.", "remove"],
  ["Domain not found.", "notFound"],
  ["That domain is already connected somewhere else.", "connectedElsewhere"],
  ["Too many domain changes right now. Try again in a few minutes.", "tooManyChanges"],
  ["The platform could not reach the domain provider. Support has been notified.", "providerUnavailable"],
  ["The domain could not be set up. Check the spelling and try again.", "setup"],
]);

function domainErrorKey(message: unknown, fallback: "add" | "recheck" | "remove" | "setup") {
  if (typeof message === "string") {
    const rejection = Object.entries(domainRejectionMessage).find(([, text]) => text === message);
    if (rejection) return `teach.customDomains.rejections.${rejection[0]}`;
    const known = apiErrorKeys.get(message);
    if (known) return `teach.customDomains.errors.${known}`;
  }
  return `teach.customDomains.errors.${fallback}`;
}

/**
 * A DNS record is copied into another website's form, character by character.
 * A typo in a TXT challenge fails silently and looks exactly like "DNS has not
 * propagated yet", so the copy button is not a nicety here — it removes the
 * single most likely reason a teacher's domain never goes live.
 */
function CopyableRecord({ label, value }: { label: string; value: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  async function copyValue() {
    setCopied(false);
    setCopyFailed(false);
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyFailed(true);
    }
  }

  return (
    <div className="relative grid grid-cols-1 gap-1">
      <Eyebrow as="span" tone="muted">
        {label}
      </Eyebrow>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-[8px] border border-[var(--color-line)] bg-white px-3 py-2 font-mono text-sm text-[var(--color-ink)]">
          {value}
        </code>
        <button
          type="button"
          onClick={() => void copyValue()}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-[8px] border border-[var(--color-line)] bg-white text-[var(--color-ink-soft)] transition hover:text-[var(--color-ink)]"
          aria-label={t("teach.customDomains.copyAria").replace("{label}", () => label)}
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
      {copied ? <span role="status" className="sr-only">{t("teach.customDomains.copied")}</span> : null}
      {copyFailed ? (
        <p role="alert" className="text-xs text-[var(--color-danger-fg)]">
          {t("teach.customDomains.copyError")}
        </p>
      ) : null}
    </div>
  );
}

function DomainCard({
  domain,
  onRemove,
  onRecheck,
  busy,
  errorMessage,
}: {
  domain: DomainRow;
  onRemove: (id: string) => void;
  onRecheck: (id: string) => void;
  busy: boolean;
  errorMessage?: string;
}) {
  const { t } = useTranslation();
  const action = domain.status === "active" ? null : t(`teach.customDomains.nextAction.${domain.status}`);
  const dns = dnsInstructionFor(domain.hostname);

  return (
    <Card tone="soft" padding="sm" shadow={false} className="grid grid-cols-1 gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Globe className="h-4 w-4 shrink-0 text-[var(--color-ink-soft)]" />
        <span className="min-w-0 flex-1 truncate font-semibold text-[var(--color-ink)]">
          {domain.hostname}
        </span>
        {/* O chip da casa: a cor carrega a mesma informação do rótulo, no
            mesmo vocabulário do resto do estúdio, e acompanha o tema escuro —
            a paleta crua do Tailwind (bg-amber-100...) não acompanhava. */}
        <StatusChip status={domain.status} label={t(`teach.customDomains.status.${domain.status}`)} className="max-w-full whitespace-normal!" />
      </div>

      {domain.status === "error" && domain.error_reason ? (
        <p className="text-sm text-[var(--color-danger-fg)]">{t(domainErrorKey(domain.error_reason, "setup"))}</p>
      ) : null}

      {action ? (
        <p className="text-sm leading-6 text-[var(--color-ink-soft)]">{action}</p>
      ) : null}

      {domain.status === "pending_dns" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <CopyableRecord label={t("teach.customDomains.record.type")} value={dns.type} />
          <CopyableRecord label={t("teach.customDomains.record.name")} value={dns.name} />
          <CopyableRecord label={t("teach.customDomains.record.value")} value={dns.value} />
        </div>
      ) : null}

      {domain.status === "pending_verification" &&
      domain.verification_name &&
      domain.verification_value ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <CopyableRecord label={t("teach.customDomains.record.type")} value="TXT" />
          <CopyableRecord label={t("teach.customDomains.record.name")} value={domain.verification_name} />
          <CopyableRecord label={t("teach.customDomains.record.value")} value={domain.verification_value} />
        </div>
      ) : null}

      {errorMessage ? <InlineAlert tone="error">{errorMessage}</InlineAlert> : null}

      <div className="flex flex-wrap gap-2">
        {domain.status !== "active" ? (
          <Button variant="outline" disabled={busy} onClick={() => onRecheck(domain.id)}>
            <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
            {t("teach.customDomains.recheck")}
          </Button>
        ) : null}
        {/* Confirmação + folga do vizinho (mesmo remédio do #129). Este botão
            era gêmeo do "Check again" — o que o professor martela enquanto o
            DNS propaga — a 8px dele, e derrubava o domínio em um clique, sem
            desfazer: certificado descartado e DNS inteiro para refazer. */}
        <Button
          variant="danger"
          disabled={busy}
          onClick={() => {
            const confirmed = window.confirm(
              t("teach.customDomains.confirmDisconnect").replace("{hostname}", () => domain.hostname),
            );
            if (confirmed) {
              onRemove(domain.id);
            }
          }}
          className="ml-auto"
        >
          <Trash2 className="h-4 w-4" />
          {t("teach.customDomains.disconnect")}
        </Button>
      </div>
    </Card>
  );
}

export function CustomDomainsPanel() {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLElement>(null);
  const retryTrigger = useRef<HTMLButtonElement | null>(null);
  const [domains, setDomains] = useState<DomainRow[]>([]);
  const [quota, setQuota] = useState<Quota>({ used: 0, limit: 0 });
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [hostname, setHostname] = useState("");
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState(false);
  const [actionError, setActionError] = useState<{ id: string; key: string } | null>(null);
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
      setHasLoaded(true);
      // Keep a stable destination before Retry disappears, without stealing focus.
      if (document.activeElement === retryTrigger.current) {
        panelRef.current?.focus({ preventScroll: true });
      }
      setLoadError(false);
    } catch {
      setLoadError(true);
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
      setError(`teach.customDomains.rejections.${parsed.reason}`);
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
        setError(domainErrorKey(payload.error ?? payload.errorReason, "add"));
        return;
      }
      setHostname("");
      await load();
    } catch {
      setError("teach.customDomains.errors.add");
    } finally {
      setAdding(false);
    }
  }

  async function handleRecheck(id: string) {
    setActionError(null);
    setBusyId(id);
    try {
      const response = await fetch(`/api/teach/domains/${id}`, { method: "POST" });
      if (!response.ok) {
        const payload = await response.json();
        setActionError({ id, key: domainErrorKey(payload.error ?? payload.errorReason, "recheck") });
        if (response.status === 404) await load();
        return;
      }
      await load();
    } catch {
      setActionError({ id, key: "teach.customDomains.errors.recheck" });
    } finally {
      setBusyId(null);
    }
  }

  async function handleRemove(id: string) {
    setActionError(null);
    setBusyId(id);
    try {
      const response = await fetch(`/api/teach/domains/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = await response.json();
        setActionError({ id, key: domainErrorKey(payload.error, "remove") });
        if (response.status === 404) await load();
        return;
      }
      await load();
    } catch {
      setActionError({ id, key: "teach.customDomains.errors.remove" });
    } finally {
      setBusyId(null);
    }
  }

  const atQuota = quota.limit > 0 && quota.used >= quota.limit;
  const lockedOnPlan = quota.limit === 0;

  return (
    <section ref={panelRef} tabIndex={-1} className="settings-section-card" aria-label={t("teach.customDomains.title")} aria-busy={loading}>
      <SectionHeader
        eyebrow={t("teach.page.eyebrow")}
        title={t("teach.customDomains.title")}
        description={t("teach.customDomains.description")}
      />

      {loading || loadError ? (
        <div className="mt-6 grid gap-3">
          {loading ? (
            <p role="status" className="flex items-center gap-2 text-sm text-[var(--color-ink-soft)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("teach.customDomains.loading")}
            </p>
          ) : (
            <InlineAlert tone="error">
              {t(hasLoaded ? "teach.customDomains.errors.refresh" : "teach.customDomains.errors.load")}
            </InlineAlert>
          )}
          {loadError ? (
            <Button
              variant="outline"
              className="justify-self-start aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
              aria-disabled={loading}
              onClick={(event) => {
                if (loading) return;
                retryTrigger.current = event.currentTarget;
                setLoading(true);
                void load();
              }}
            >
              {t("authFlow.loading.retry")}
            </Button>
          ) : null}
        </div>
      ) : null}

      {!hasLoaded ? null : !configured ? (
        <InlineAlert tone="info" className="mt-6">
          {t("teach.customDomains.notConfigured")}
        </InlineAlert>
      ) : lockedOnPlan ? (
        <InlineAlert tone="info" className="mt-6">
          {t("teach.customDomains.planLocked")}
        </InlineAlert>
      ) : (
        <>
          <p className="mt-6 text-sm font-semibold text-[var(--color-ink)]">
            {t("teach.customDomains.quota")
              .replace("{used}", () => String(quota.used))
              .replace("{limit}", () => String(quota.limit))}
          </p>

          <div className="mt-4 grid grid-cols-1 gap-3">
            {domains.map((domain) => (
              <DomainCard
                key={domain.id}
                domain={domain}
                busy={busyId === domain.id}
                errorMessage={actionError?.id === domain.id ? t(actionError.key) : undefined}
                onRecheck={handleRecheck}
                onRemove={handleRemove}
              />
            ))}
          </div>

          <form className="mt-5 grid gap-2" onSubmit={handleAdd}>
            {/* O erro do domínio recusado era um <p> solto no fim do
                formulário: sem ligação com o campo e sem anúncio nenhum. Quem
                usa leitor de tela digitava "https://meusite.com", apertava
                Connect e não recebia absolutamente nada. */}
            <Field id="custom-domain-hostname" label={t("teach.customDomains.addLabel")} error={error ? t(error) : undefined}>
              {(a11y) => (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    {...a11y}
                    value={hostname}
                    onChange={(event) => setHostname(event.target.value)}
                    placeholder={t("teach.customDomains.hostnamePlaceholder")}
                    disabled={atQuota || adding}
                    className="min-w-0 flex-1 rounded-[10px] border border-[var(--color-line)] bg-white px-3 py-2.5 font-mono text-sm text-[var(--color-ink)] disabled:opacity-50"
                  />
                  <Button type="submit" disabled={atQuota || adding || !hostname.trim()}>
                    {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {t("teach.customDomains.connect")}
                  </Button>
                </div>
              )}
            </Field>

            {atQuota ? (
              <p className="text-sm text-[var(--color-ink-soft)]">
                {t("teach.customDomains.quotaFull")}
              </p>
            ) : null}
          </form>
        </>
      )}
    </section>
  );
}
