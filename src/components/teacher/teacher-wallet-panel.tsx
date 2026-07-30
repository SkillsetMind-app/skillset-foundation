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
import { InlineHelp } from "@/components/shared/inline-help";
import { StatusChip } from "@/components/shared/status-chip";
import { TeacherConnectOnboarding } from "@/components/teacher/teacher-connect-onboarding";
import {
  summarizeCreatorWallet,
  type CurrencyAmount,
} from "@/domain/creator-ops";
import type { PayoutLedgerEntry } from "@/domain/payout-ledger";
import type { UserProfile } from "@/domain/user-profile";
import { subscribeToTeacherPayoutLedger } from "@/lib/data/payout-ledger";
import { subscribeToUserProfile } from "@/lib/data/user-profiles";
import { toDate } from "@/lib/format-date";
import {
  isConnectNotEnabledError,
  refreshTeacherStripeAccountStatus,
} from "@/lib/payments/connect";

// Shown (as a calm info message, never error styling) when the PLATFORM hasn't
// enabled Stripe Connect yet — a SkillsetMind-side configuration state, not a
// failure and not something the teacher can fix.
const PAYOUTS_UNAVAILABLE_MESSAGE =
  "Paid selling isn't open on SkillsetMind yet — Stripe Connect is still being " +
  "configured on our side. No Stripe account is connected yet, so buyers have " +
  "nowhere to pay you; onboarding will open on this page automatically once " +
  "it's ready.";

type LedgerReadState = "loading" | "ready" | "error";

export function TeacherWalletPanel() {
  const { user } = useAuth();
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
  const autoRefreshedRef = useRef(false);

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
        setError("We could not load your payout profile.");
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
        setError("We could not load your earnings record.");
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
        setMessage(PAYOUTS_UNAVAILABLE_MESSAGE);
        return;
      }
      setPlatformPayoutsUnavailable(false);
      setMessage(
        status.chargesEnabled && status.payoutsEnabled
          ? "Stripe charges and payouts are ready for this teacher account."
          : "Stripe still requires more information before paid checkout and payouts are enabled.",
      );
    } catch (cause) {
      // Same platform gap reported by an older deployed function as a thrown
      // precondition — keep it calm rather than error-styled.
      if (isConnectNotEnabledError(cause)) {
        setPlatformPayoutsUnavailable(true);
        setMessage(PAYOUTS_UNAVAILABLE_MESSAGE);
        return;
      }
      // Surface the real reason (e.g. missing STRIPE_SECRET_KEY secret or a
      // permission error) rather than a mute status string, so a stuck Connect
      // account is diagnosable instead of silently failing.
      const detail = cause instanceof Error ? cause.message.trim() : "";
      setError(
        detail
          ? `We could not refresh Stripe payout status: ${detail}`
          : "We could not refresh Stripe payout status.",
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
        ? "Unavailable"
        : "—";
  const connected = Boolean(profile?.stripeConnectedAccountId);
  // A panel must never claim "Ready" while the platform itself can't run
  // Connect — stale profile flags don't outrank the live platform signal.
  const ready =
    !platformPayoutsUnavailable
    && Boolean(
      profile?.stripeConnectChargesEnabled
      && profile?.stripeConnectPayoutsEnabled,
    );
  const statusLabel = platformPayoutsUnavailable
    ? "Not available yet"
    : ready
      ? "Ready"
      : connected
        ? "Onboarding required"
        : "Not connected";

  return (
    <section className="payouts-shell">
      <header className="payouts-head">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
            Payouts & tax
          </p>
          <h2 className="display-title mt-3 flex items-center gap-2 text-4xl leading-tight text-[var(--color-primary)]">
            Your earnings, your payout setup.
            <InlineHelp topic="Payout schedule" href="/help#payouts">
              Buyers pay your Stripe account directly, so there is no platform
              hold. Stripe then settles and pays out to your bank on its own
              timing, which depends on your country and the payment method, and
              a new account waits on verification before its first payout.
              Stripe Connect must have both charges and payouts enabled before
              a paid product can go live.
            </InlineHelp>
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-[var(--color-ink-soft)]">
            This is your earnings record: paid orders, what SkillsetMind
            charged, and your Stripe Connect status. Profile and security stay
            in Settings.
          </p>
        </div>
        <p className="flex items-center gap-2 text-sm text-[var(--color-ink-soft)]">
          <Download aria-hidden="true" size={14} strokeWidth={2} />
          Stripe issues your tax forms
        </p>
      </header>

      {message ? (
        <p className="rounded-[10px] border border-[rgba(24,58,94,0.12)] bg-[var(--color-surface-soft)] px-4 py-3 text-sm font-semibold text-[var(--color-primary)]">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-accent-fg)]">
          {error}
        </p>
      ) : null}

      <div className="payouts-grid">
        <article className="payout-balance-card">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[rgba(255,255,255,0.66)]">
            Creator net estimate
          </p>
          <p className="display-title mt-3 break-words text-3xl leading-tight text-white sm:text-4xl">
            {money(financials.teacherNetByCurrency)}
          </p>
          <p className="mt-2 text-sm text-[rgba(255,255,255,0.72)]">
            Net across one-time and subscription sales, after SkillsetMind commission
            and Stripe fees. Every charge was created on your own Stripe account —
            SkillsetMind never holds it. Stripe&apos;s own settlement timing then
            decides when it is available to pay out.
          </p>

          <div className="mt-6 grid gap-3">
            <BalanceRow label="Refunded" value={money(financials.refundedByCurrency)} />
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            {ready ? (
              <button
                type="button"
                onClick={refreshStripeStatus}
                disabled={isRefreshingStripe}
                className="button-solid-light px-4 py-2.5 text-sm disabled:opacity-60"
              >
                {isRefreshingStripe ? "Refreshing..." : "Refresh Stripe status"}
              </button>
            ) : (
              <a href="#stripe-connect" className="button-solid-light px-4 py-2.5 text-sm">
                Complete payout setup
              </a>
            )}
            <Link href="/teach/sales" className="button-outline-light px-4 py-2.5 text-sm">
              View sales
            </Link>
          </div>
        </article>

        <aside className="payout-bank-card">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
                Payout destination
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
              label={isLoading ? "Loading" : statusLabel}
            />
          </div>
          <p className="mt-3 text-sm leading-6 text-[var(--color-ink-soft)]">
            SkillsetMind never stores full bank details. Stripe collects identity,
            tax, and bank information inside the embedded onboarding flow.
          </p>

          <div className="mt-5 grid gap-3">
            <PayoutStatusRow
              icon={Banknote}
              label="Connected account"
              value={
                platformPayoutsUnavailable
                  // A stored id can't be verified (or used) while the platform
                  // has Connect off — presenting it as "Connected" reads like
                  // a finished setup that never happened.
                  ? "Not active yet"
                  : profile?.stripeConnectedAccountId
                    ? maskStripeId(profile.stripeConnectedAccountId)
                    : "Not created"
              }
            />
            <PayoutStatusRow
              icon={ShieldCheck}
              label="Charges"
              value={
                platformPayoutsUnavailable
                  ? "Unavailable"
                  : profile?.stripeConnectChargesEnabled
                    ? "Enabled"
                    : "Pending"
              }
            />
            <PayoutStatusRow
              icon={CheckCircle2}
              label="Payouts"
              value={
                platformPayoutsUnavailable
                  ? "Unavailable"
                  : profile?.stripeConnectPayoutsEnabled
                    ? "Enabled"
                    : "Pending"
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
            {isRefreshingStripe ? "Refreshing..." : "Refresh account status"}
          </button>
        </aside>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard
          label="Paid sales"
          value={financialsReady
            ? String(financials.salesCount)
            : ledgerState === "error"
              ? "Unavailable"
              : "—"}
        />
        <MetricCard label="Gross sales" value={money(financials.grossPaidByCurrency)} />
        <MetricCard label="Platform fee est." value={money(financials.platformFeeByCurrency)} />
        <MetricCard label="Stripe fee est." value={money(financials.stripeFeeByCurrency)} />
      </div>

      {ready ? null : (
        <section id="stripe-connect" className="scroll-mt-24 rounded-[18px] border border-[var(--color-line)] bg-white p-5 shadow-[var(--shadow-soft)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
                {connected ? "Continue payout setup" : "Set up payouts"}
              </p>
              <h3 className="display-title mt-2 text-2xl text-[var(--color-primary)]">
                Complete Stripe onboarding before selling paid courses.
              </h3>
              <p className="mt-2 max-w-3xl text-sm leading-7 text-[var(--color-ink-soft)]">
                You stay on SkillsetMind the whole time. Stripe collects the
                legally required identity, tax, and bank details in this
                embedded step so your payout account meets payment
                regulations. After that, buyers pay your Stripe account directly:
                SkillsetMind never holds your money and there is no platform
                waiting period. Stripe pays out to your bank on your account&apos;s
                payout schedule — note that Stripe verifies new accounts before
                the very first payout.
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
              Statements
            </p>
            <h3 className="display-title mt-2 text-3xl text-[var(--color-primary)]">
              Recent earnings record.
            </h3>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-ink-soft)]">
              One line per paid order — a record, not a wallet. The payouts
              themselves are made by Stripe out of your own balance, on your
              account&apos;s payout schedule.
            </p>
          </div>
          <button type="button" disabled className="button-outline px-4 py-2.5 text-sm opacity-60">
            Export after first payout
          </button>
        </div>

        <div className="mt-5 overflow-hidden rounded-[14px] border border-[var(--color-line)]">
          {ledgerState === "loading" ? (
            <div className="bg-[var(--color-surface-soft)] p-6 text-sm leading-7 text-[var(--color-ink-soft)]">
              Loading your earnings record…
            </div>
          ) : ledgerState === "error" ? (
            <div className="bg-[var(--color-surface-soft)] p-6 text-sm leading-7 text-[var(--color-ink-soft)]">
              Your earnings record is unavailable.
            </div>
          ) : ledgerEntries.length === 0 ? (
            <div className="bg-[var(--color-surface-soft)] p-6 text-sm leading-7 text-[var(--color-ink-soft)]">
              No entries yet. Each paid order adds a line here after checkout
              succeeds — and the money for it goes straight to your own Stripe
              balance, not to a SkillsetMind account.
            </div>
          ) : (
            <div className="divide-y divide-[var(--color-line)]">
              {ledgerEntries.slice(0, 6).map((entry) => (
                <LedgerRow key={entry.id} entry={entry} />
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
            Tax center
          </h3>
          <p className="mt-1 text-sm leading-6 text-[var(--color-ink-soft)]">
            Tax forms appear once you have real payout volume. Stripe Connect
            collects your tax details, and SkillsetMind keeps the payout ledger
            fully transparent.
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

function LedgerRow({ entry }: { entry: PayoutLedgerEntry }) {
  return (
    <Link
      href={`/teach/sales/${entry.orderId}`}
      className="grid gap-3 bg-white p-4 transition hover:bg-[var(--color-surface-soft)] md:grid-cols-[140px_1fr_150px_120px_auto]"
    >
      <span className="text-xs font-semibold text-[var(--color-ink-soft)]">
        {formatDate(entry.createdAt ?? entry.releaseAt)}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-bold text-[var(--color-ink)]">
          Order {entry.orderId}
        </span>
        <span className="mt-1 block truncate text-xs text-[var(--color-ink-soft)]">
          Payment {entry.paymentId}
        </span>
      </span>
      <StatusChip status={mapLedgerStatus(entry.status)} label={formatLedgerStatus(entry.status)} />
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

function formatDate(value: unknown) {
  const date = toDate(value);
  if (!date) {
    return "Pending";
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
  }).format(date);
}

// Every non-refunded, non-disputed row is money the buyer already paid into the
// teacher's own Stripe balance, so none of them is "pending" on anything of
// ours. The four release-model values only ever appear on historical rows.
const LEDGER_STATUS_LABELS: Record<PayoutLedgerEntry["status"], string> = {
  settled: "Recorded",
  in_release: "Recorded",
  releasing: "Recorded",
  released: "Recorded",
  released_advance: "Recorded",
  disputed: "Disputed",
  refunded: "Refunded",
  partially_refunded: "Partially refunded",
};

function formatLedgerStatus(status: PayoutLedgerEntry["status"]) {
  return LEDGER_STATUS_LABELS[status] ?? "Recorded";
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
