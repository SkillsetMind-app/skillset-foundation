"use client";

import {
  ArrowRight,
  Banknote,
  CheckCircle2,
  Download,
  FileText,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { InlineHelp } from "@/components/shared/inline-help";
import { StatusChip } from "@/components/shared/status-chip";
import { TeacherConnectOnboarding } from "@/components/teacher/teacher-connect-onboarding";
import {
  summarizeCreatorWallet,
  type CurrencyAmount,
} from "@/domain/creator-ops";
import type { PayoutLedgerEntry } from "@/domain/payout-ledger";
import type { UserProfile } from "@/domain/user-profile";
import { fetchCreatorActivationBlocked } from "@/lib/data/creator-verification";
import { subscribeToTeacherPayoutLedger } from "@/lib/data/payout-ledger";
import { subscribeToUserProfile } from "@/lib/data/user-profiles";
import { toDate } from "@/lib/format-date";
import {
  isConnectNotEnabledError,
  refreshTeacherStripeAccountStatus,
} from "@/lib/payments/connect";

// Mostrado (como aviso calmo, nunca com cara de erro) quando a PLATAFORMA ainda
// nao habilitou o Stripe Connect — estado de configuracao do lado da
// SkillsetMind, nao falha e nada que o professor possa resolver.
const PAYOUTS_UNAVAILABLE_KEY = "teach.earnings.payoutsUnavailable";

type LedgerReadState = "loading" | "ready" | "error";

type Translate = (key: string) => string;

export function TeacherWalletPanel() {
  const { user } = useAuth();
  const { t } = useTranslation();
  // `t` fica fora das dependencias dos efeitos: com ele la, um provider que
  // devolva funcao nova por render reinscreve tudo em laco (a suite do CI
  // ficou muda 16 min). A ref le sempre o `t` atual sem reinscrever nada.
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isRefreshingStripe, setIsRefreshingStripe] = useState(false);
  const [ledgerEntries, setLedgerEntries] = useState<PayoutLedgerEntry[]>([]);
  const [ledgerState, setLedgerState] = useState<LedgerReadState>("loading");
  // Platform-level truth reported by the onboarding component: when Stripe
  // Connect isn't enabled on SkillsetMind's Stripe account, NO stored account id is
  // verifiable or usable — so the panel must not present one as "Connected".
  const [platformPayoutsUnavailable, setPlatformPayoutsUnavailable] =
    useState(false);
  const [activationBlocked, setActivationBlocked] = useState(false);
  const autoRefreshedRef = useRef(false);

  // Best-effort: if the RPC is unreachable we fall back to "not blocked", which
  // shows the normal onboarding. The server-side gate is the one that actually
  // enforces payment, so a failed read here can only cost a clearer message,
  // never open the paywall.
  useEffect(() => {
    let active = true;
    fetchCreatorActivationBlocked()
      .then((blocked) => {
        if (active) {
          setActivationBlocked(blocked);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!user) {
      return;
    }

    return subscribeToUserProfile(
      user.uid,
      (nextProfile) => {
        setProfile(nextProfile);
        setIsLoading(false);
      },
      () => {
        setError(tRef.current("teach.earnings.profileError"));
        setIsLoading(false);
      },
    );
  }, [user]);

  useEffect(() => {
    if (!user) {
      return;
    }

    return subscribeToTeacherPayoutLedger(
      user.uid,
      (entries) => {
        setLedgerEntries(entries);
        setLedgerState("ready");
      },
      () => {
        setLedgerState("error");
        setError(tRef.current("teach.earnings.ledgerReadError"));
      },
    );
  }, [user]);

  function handleOnboardingComplete() {
    void refreshStripeStatus();
  }

  // Self-truing: re-verify the stored Connect state against Stripe once per
  // visit, silently. This is what clears a stale account id (or stale
  // ready flags) server-side without requiring the teacher to find a button —
  // the profile subscription then repaints the panel from the corrected doc.
  // Errors stay silent here; the manual button and the onboarding panel below
  // surface real problems with context.
  useEffect(() => {
    if (!user || autoRefreshedRef.current) {
      return;
    }
    autoRefreshedRef.current = true;
    refreshTeacherStripeAccountStatus()
      .then((status) => {
        if (status.payoutsUnavailable) {
          setPlatformPayoutsUnavailable(true);
        }
      })
      .catch(() => {
        // Silent by design (see comment above).
      });
  }, [user]);

  async function refreshStripeStatus() {
    setError("");
    setMessage("");
    setIsRefreshingStripe(true);

    try {
      const status = await refreshTeacherStripeAccountStatus();
      if (status.payoutsUnavailable) {
        // Platform-side Connect configuration gap — calm info, not an error.
        setPlatformPayoutsUnavailable(true);
        setMessage(t(PAYOUTS_UNAVAILABLE_KEY));
        return;
      }
      setPlatformPayoutsUnavailable(false);
      setMessage(
        status.chargesEnabled && status.payoutsEnabled
          ? t("teach.earnings.stripeReady")
          : t("teach.earnings.stripeNeedsInfo"),
      );
    } catch (cause) {
      // Same platform gap reported by an older deployed function as a thrown
      // precondition — keep it calm rather than error-styled.
      if (isConnectNotEnabledError(cause)) {
        setPlatformPayoutsUnavailable(true);
        setMessage(t(PAYOUTS_UNAVAILABLE_KEY));
        return;
      }
      // Surface the real reason (e.g. missing STRIPE_SECRET_KEY secret or a
      // permission error) rather than a mute status string, so a stuck Connect
      // account is diagnosable instead of silently failing.
      const detail = cause instanceof Error ? cause.message.trim() : "";
      setError(
        detail
          ? t("teach.earnings.refreshErrorDetail").replace("{detail}", detail)
          : t("teach.earnings.refreshError"),
      );
    } finally {
      setIsRefreshingStripe(false);
    }
  }

  // Money figures derive from the payout LEDGER — the authoritative record for
  // BOTH one-time orders AND subscription invoices. The ledger carries the
  // server-computed gross/commission/Stripe-fee/net per entry, so these are
  // exact as a record of what was CHARGED, not a payout figure: the Stripe fee
  // is our own computation, and settlement/payout happen on Stripe's side where
  // we never see the number. Reconcile against Stripe, never the reverse.
  const financialsReady = ledgerState === "ready";
  const financials = useMemo(
    () => summarizeCreatorWallet(ledgerEntries),
    [ledgerEntries],
  );
  const money = (values: CurrencyAmount[]) =>
    ledgerState === "ready"
      ? formatCurrencyBreakdown(values)
      : ledgerState === "error"
        ? t("teach.earnings.unavailable")
        : "—";
  const connected = Boolean(profile?.stripeConnectedAccountId);
  // The Connect routes now answer 402 activation_required for an unpaid
  // creator, so mounting the embedded onboarding widget would just fail with
  // no explanation. Swap it for the activation call to action instead —
  // /account/payments is where a new creator lands first, so this doubles as
  // the earliest discoverable entry point to /teach/activate.
  // (activationBlocked comes straight from creator_activation_blocked() above —
  // same predicate as the courses trigger, so the admin exemption and the paid
  // check can't drift out of sync with a second copy written here.)
  // A panel must never claim "Ready" while the platform itself can't run
  // Connect — stale profile flags don't outrank the live platform signal.
  const ready =
    !platformPayoutsUnavailable
    && Boolean(
      profile?.stripeConnectChargesEnabled
      && profile?.stripeConnectPayoutsEnabled,
    );
  const statusLabel = platformPayoutsUnavailable
    ? t("teach.earnings.statusNotAvailable")
    : ready
      ? t("teach.earnings.statusReady")
      : connected
        ? t("teach.earnings.statusOnboarding")
        : t("teach.earnings.statusNotConnected");

  return (
    <section className="payouts-shell">
      <header className="payouts-head">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
            {t("account.payoutsTax")}
          </p>
          {/* h1, nao h2: este painel e o cabecalho da unica pagina que o usa
              (/account/payments), e a casca esconde o titulo dela para nao
              repetir a mesma frase tres vezes. Sem isto a pagina ficaria sem
              cabecalho de nivel 1 e a navegacao por titulos comecaria no 2
              (revisao do Codex). */}
          <h1 className="display-title mt-3 flex items-center gap-2 text-4xl leading-tight text-[var(--color-primary)]">
            {t("teach.earnings.title")}
            <InlineHelp topic={t("teach.earnings.helpTopic")} href="/help#payouts">
              {t("teach.earnings.helpBody")}
            </InlineHelp>
          </h1>
          {/* Uma frase, e o resto recolhido. `details` nativo: sem estado, sem
              portal, e o texto longo so ocupa a tela de quem pediu por ele. */}
          <p className="mt-3 max-w-3xl text-sm leading-7 text-[var(--color-ink-soft)]">
            {t("teach.earnings.intro")}
          </p>
          <details className="mt-2 max-w-3xl text-sm leading-7 text-[var(--color-ink-soft)]">
            <summary className="cursor-pointer font-semibold text-[var(--color-primary)]">
              {t("teach.earnings.learnMore")}
            </summary>
            <p className="mt-2">{t("teach.earnings.details")}</p>
          </details>
        </div>
        <p className="flex items-center gap-2 text-sm text-[var(--color-ink-soft)]">
          <Download aria-hidden="true" size={14} strokeWidth={2} />
          {t("teach.earnings.taxForms")}
        </p>
      </header>

      {message ? (
        <p className="rounded-[10px] border border-[rgba(24,58,94,0.12)] bg-[var(--color-surface-soft)] px-4 py-3 text-sm font-semibold text-[var(--color-primary)]">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]">
          {error}
        </p>
      ) : null}

      <div className="payouts-grid">
        <article className="payout-balance-card">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[rgba(255,255,255,0.66)]">
            {t("teach.earnings.netEstimate")}
          </p>
          <p className="display-title mt-3 break-words text-3xl leading-tight text-white sm:text-4xl">
            {money(financials.teacherNetByCurrency)}
          </p>
          {/* Uma linha ao lado do numero grande. O resto (cobranca na conta do
              professor, timing de repasse da Stripe) esta no "Learn more". */}
          <p className="mt-2 text-sm text-[rgba(255,255,255,0.72)]">
            {t("teach.earnings.netHint")}
          </p>

          <div className="mt-6 grid gap-3">
            <BalanceRow
              label={t("teach.earnings.refunded")}
              value={money(financials.refundedByCurrency)}
            />
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            {ready ? (
              <button
                type="button"
                onClick={refreshStripeStatus}
                disabled={isRefreshingStripe}
                className="button-solid-light px-4 py-2.5 text-sm disabled:opacity-60"
              >
                {isRefreshingStripe
                  ? t("teach.earnings.refreshing")
                  : t("teach.earnings.refreshStripe")}
              </button>
            ) : (
              <a href="#stripe-connect" className="button-solid-light px-4 py-2.5 text-sm">
                {t("teach.earnings.completeSetup")}
              </a>
            )}
            <Link href="/teach/sales" className="button-outline-light px-4 py-2.5 text-sm">
              {t("teach.earnings.viewSales")}
            </Link>
          </div>
        </article>

        <aside className="payout-bank-card">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
                {t("teach.earnings.destination")}
              </p>
              <h3 className="display-title mt-2 text-2xl text-[var(--color-primary)]">
                Stripe Connect
              </h3>
            </div>
            <StatusChip
              status={
                platformPayoutsUnavailable
                  ? "draft"
                  : ready
                    ? "active"
                    : connected
                      ? "pending"
                      : "draft"
              }
              label={isLoading ? t("teach.earnings.loadingStatus") : statusLabel}
            />
          </div>
          <p className="mt-3 text-sm leading-6 text-[var(--color-ink-soft)]">
            {t("teach.earnings.bankNote")}
          </p>

          <div className="mt-5 grid gap-3">
            <PayoutStatusRow
              icon={Banknote}
              label={t("teach.earnings.connectedAccount")}
              value={
                platformPayoutsUnavailable
                  // A stored id can't be verified (or used) while the platform
                  // has Connect off — presenting it as "Connected" reads like
                  // a finished setup that never happened.
                  ? t("teach.earnings.notActiveYet")
                  : profile?.stripeConnectedAccountId
                    ? maskStripeId(profile.stripeConnectedAccountId)
                    : t("teach.earnings.notCreated")
              }
            />
            <PayoutStatusRow
              icon={ShieldCheck}
              label={t("teach.earnings.charges")}
              value={
                platformPayoutsUnavailable
                  ? t("teach.earnings.unavailable")
                  : profile?.stripeConnectChargesEnabled
                    ? t("teach.earnings.enabled")
                    : t("teach.earnings.pending")
              }
            />
            <PayoutStatusRow
              icon={CheckCircle2}
              label={t("teach.earnings.payouts")}
              value={
                platformPayoutsUnavailable
                  ? t("teach.earnings.unavailable")
                  : profile?.stripeConnectPayoutsEnabled
                    ? t("teach.earnings.enabled")
                    : t("teach.earnings.pending")
              }
            />
          </div>

          <button
            type="button"
            onClick={refreshStripeStatus}
            disabled={isRefreshingStripe}
            className="button-outline mt-5 w-full justify-center px-4 py-2.5 text-sm disabled:opacity-60"
          >
            <RefreshCw aria-hidden="true" size={14} strokeWidth={2} />
            {isRefreshingStripe
              ? t("teach.earnings.refreshing")
              : t("teach.earnings.refreshAccount")}
          </button>
        </aside>
      </div>

      {/* Sao QUATRO tiles: em `md:grid-cols-3` o quarto sobrava sozinho numa
          linha. 2x2 no tablet, 4 colunas no desktop — nenhum orfao. */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label={t("teach.earnings.paidSales")}
          value={financialsReady
            ? String(financials.salesCount)
            : ledgerState === "error"
              ? t("teach.earnings.unavailable")
              : "—"}
        />
        <MetricCard
          label={t("teach.earnings.grossSales")}
          value={money(financials.grossPaidByCurrency)}
        />
        <MetricCard
          label={t("teach.earnings.platformFee")}
          value={money(financials.platformFeeByCurrency)}
        />
        <MetricCard
          label={t("teach.earnings.stripeFee")}
          value={money(financials.stripeFeeByCurrency)}
        />
      </div>

      {ready || !activationBlocked ? null : (
        <section id="stripe-connect" className="scroll-mt-24 rounded-[18px] border border-[var(--color-line)] bg-white p-5 shadow-[var(--shadow-soft)]">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
            {t("teach.earnings.activateEyebrow")}
          </p>
          <h3 className="display-title mt-2 text-2xl text-[var(--color-primary)]">
            {t("teach.earnings.activateTitle")}
          </h3>
          <p className="mt-2 max-w-3xl text-sm leading-7 text-[var(--color-ink-soft)]">
            {t("teach.earnings.activateBody")}
          </p>
          <Link
            href="/teach/activate"
            className="button-solid mt-5 inline-flex px-4 py-2.5 text-sm"
          >
            {t("teach.earnings.activateCta")}
            <ArrowRight aria-hidden="true" size={14} strokeWidth={2} />
          </Link>
        </section>
      )}

      {ready || activationBlocked ? null : (
        <section id="stripe-connect" className="scroll-mt-24 rounded-[18px] border border-[var(--color-line)] bg-white p-5 shadow-[var(--shadow-soft)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
                {connected
                  ? t("teach.earnings.connectContinue")
                  : t("teach.earnings.connectStart")}
              </p>
              <h3 className="display-title mt-2 text-2xl text-[var(--color-primary)]">
                {t("teach.earnings.connectTitle")}
              </h3>
              <p className="mt-2 max-w-3xl text-sm leading-7 text-[var(--color-ink-soft)]">
                {t("teach.earnings.connectBody")}
              </p>
            </div>
          </div>
          <div className="mt-5">
            <TeacherConnectOnboarding
              onComplete={handleOnboardingComplete}
              onAvailabilityChange={setPlatformPayoutsUnavailable}
            />
          </div>
        </section>
      )}

      <section className="payout-statements">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
              {t("teach.earnings.statements")}
            </p>
            <h3 className="display-title mt-2 text-3xl text-[var(--color-primary)]">
              {t("teach.earnings.statementsTitle")}
            </h3>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-ink-soft)]">
              {t("teach.earnings.statementsBody")}
            </p>
          </div>
          <button type="button" disabled className="button-outline px-4 py-2.5 text-sm opacity-60">
            {t("teach.earnings.export")}
          </button>
        </div>

        <div className="mt-5 overflow-hidden rounded-[14px] border border-[var(--color-line)]">
          {ledgerState === "loading" ? (
            <div className="bg-[var(--color-surface-soft)] p-6 text-sm leading-7 text-[var(--color-ink-soft)]">
              {t("teach.earnings.ledgerLoading")}
            </div>
          ) : ledgerState === "error" ? (
            <div className="bg-[var(--color-surface-soft)] p-6 text-sm leading-7 text-[var(--color-ink-soft)]">
              {t("teach.earnings.ledgerError")}
            </div>
          ) : ledgerEntries.length === 0 ? (
            <div className="bg-[var(--color-surface-soft)] p-6 text-sm leading-7 text-[var(--color-ink-soft)]">
              {t("teach.earnings.ledgerEmpty")}
            </div>
          ) : (
            <div className="divide-y divide-[var(--color-line)]">
              {/* O ledger é carregado em ordem CRESCENTE (o cálculo de saldo
                  depende disso), então .slice(0, 6) mostrava as seis vendas
                  MAIS ANTIGAS sob o título "recentes" — para um criador com
                  histórico, a venda de hoje nunca aparecia. Ordena por data
                  decrescente só para exibir, sem mexer na fonte. */}
              {[...ledgerEntries]
                .sort((a, b) => {
                  const left = Date.parse(String(a.createdAt ?? ""));
                  const right = Date.parse(String(b.createdAt ?? ""));
                  if (Number.isNaN(left) && Number.isNaN(right)) return 0;
                  if (Number.isNaN(left)) return 1;
                  if (Number.isNaN(right)) return -1;
                  return right - left;
                })
                .slice(0, 6)
                .map((entry) => (
                  <LedgerRow key={entry.id} entry={entry} t={t} />
                ))}
            </div>
          )}
        </div>
      </section>

      <section className="payout-tax-card">
        <span className="grid size-12 place-items-center rounded-[14px] bg-[var(--color-surface-soft)] text-[var(--color-primary)]">
          <FileText aria-hidden="true" size={22} strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="display-title text-2xl text-[var(--color-primary)]">
            {t("teach.earnings.taxCenter")}
          </h3>
          <p className="mt-1 text-sm leading-6 text-[var(--color-ink-soft)]">
            {t("teach.earnings.taxCenterBody")}
          </p>
        </div>
      </section>
    </section>
  );
}

function BalanceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-[12px] bg-white/10 px-4 py-3 text-sm text-white">
      <span className="text-[rgba(255,255,255,0.72)]">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-[16px] border border-[var(--color-line)] bg-white p-5 shadow-[var(--shadow-soft)]">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-ink-muted)]">
        {label}
      </p>
      <p className="mt-2 text-2xl font-black text-[var(--color-primary)]">
        {value}
      </p>
    </article>
  );
}

function PayoutStatusRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Banknote;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-[12px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-3">
      <span className="grid size-9 place-items-center rounded-[10px] bg-white text-[var(--color-primary)]">
        <Icon aria-hidden="true" size={16} strokeWidth={2} />
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
          {label}
        </span>
        <span className="mt-1 block truncate text-sm font-bold text-[var(--color-ink)]">
          {value}
        </span>
      </span>
    </div>
  );
}

function LedgerRow({ entry, t }: { entry: PayoutLedgerEntry; t: Translate }) {
  return (
    <Link
      href={`/teach/sales/${entry.orderId}`}
      className="grid gap-3 bg-white p-4 transition hover:bg-[var(--color-surface-soft)] md:grid-cols-[140px_1fr_150px_120px_auto]"
    >
      <span className="text-xs font-semibold text-[var(--color-ink-soft)]">
        {formatDate(entry.createdAt ?? entry.releaseAt, t("teach.earnings.datePending"))}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-bold text-[var(--color-ink)]">
          {t("teach.earnings.orderLabel").replace("{id}", entry.orderId)}
        </span>
        <span className="mt-1 block truncate text-xs text-[var(--color-ink-soft)]">
          {t("teach.earnings.paymentLabel").replace("{id}", entry.paymentId)}
        </span>
      </span>
      <StatusChip
        status={mapLedgerStatus(entry.status)}
        label={t(ledgerStatusKey(entry.status))}
      />
      <span className="text-right text-sm font-black text-[var(--color-primary)] md:text-left">
        {formatMoney(entry.netAmountMinor, entry.currency)}
      </span>
      <ArrowRight aria-hidden="true" size={15} strokeWidth={2} className="hidden text-[var(--color-ink-muted)] md:block" />
    </Link>
  );
}

function formatMoney(amountMinor: number, currency = "USD") {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
  }).format(amountMinor / 100);
}

function formatCurrencyBreakdown(values: CurrencyAmount[]): string {
  if (!values.length) return "0";
  return values
    .map((value) => `${value.currency} ${(value.amountMinor / 100).toFixed(2)}`)
    .join(" + ");
}

function formatDate(value: unknown, pendingLabel: string) {
  const date = toDate(value);
  if (!date) {
    return pendingLabel;
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
  }).format(date);
}

// Every non-refunded, non-disputed row is money the buyer already paid into the
// teacher's own Stripe balance, so none of them is "pending" on anything of
// ours. The four release-model values only ever appear on historical rows.
const LEDGER_STATUS_KEYS: Record<PayoutLedgerEntry["status"], string> = {
  settled: "teach.earnings.statusRecorded",
  in_release: "teach.earnings.statusRecorded",
  releasing: "teach.earnings.statusRecorded",
  released: "teach.earnings.statusRecorded",
  released_advance: "teach.earnings.statusRecorded",
  disputed: "teach.earnings.statusDisputed",
  refunded: "teach.earnings.statusRefunded",
  partially_refunded: "teach.earnings.statusPartiallyRefunded",
};

function ledgerStatusKey(status: PayoutLedgerEntry["status"]) {
  return LEDGER_STATUS_KEYS[status] ?? "teach.earnings.statusRecorded";
}

function mapLedgerStatus(status: PayoutLedgerEntry["status"]) {
  if (status === "refunded" || status === "partially_refunded" || status === "disputed") {
    return "refunded";
  }

  return "paid";
}

function maskStripeId(value: string) {
  if (value.length <= 8) {
    return value;
  }

  return `${value.slice(0, 7)}...${value.slice(-4)}`;
}
