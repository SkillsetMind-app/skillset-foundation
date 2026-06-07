"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { startTransition, useEffect, useMemo, useState } from "react";

import { PlansPanel } from "@/components/account/plans-panel";
import { useAuth } from "@/components/auth/auth-provider";
import { HorizontalTabs } from "@/components/shared/horizontal-tabs";
import { StatusChip } from "@/components/shared/status-chip";
import type { Order } from "@/domain/order";
import { subscribeToUserOrders } from "@/lib/data/orders";
import { openBillingPortal } from "@/lib/payments/billing";

const billingTabs = [
  { value: "purchases", label: "Purchases" },
  { value: "subscriptions", label: "Subscriptions" },
  { value: "invoices", label: "Invoices" },
];

function formatMoney(amountMinor: number, currency: string) {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
  }).format(amountMinor / 100);
}

function formatDate(value: unknown) {
  const maybeTimestamp = value as
    | { toDate?: () => Date; seconds?: number }
    | undefined;
  const date =
    maybeTimestamp?.toDate?.() ??
    (typeof maybeTimestamp?.seconds === "number"
      ? new Date(maybeTimestamp.seconds * 1000)
      : null);

  if (!date) {
    return "Date pending";
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
  }).format(date);
}

function toMillis(value: unknown): number {
  const maybeTimestamp = value as
    | { toDate?: () => Date; seconds?: number }
    | undefined;
  if (maybeTimestamp?.toDate) {
    return maybeTimestamp.toDate().getTime();
  }
  if (typeof maybeTimestamp?.seconds === "number") {
    return maybeTimestamp.seconds * 1000;
  }
  return 0;
}

export function BillingTabs() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = searchParams.get("tab") ?? "purchases";
  const { status, user } = useAuth();

  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  // One real-time listener feeds both the Purchases and Invoices tabs, so the
  // subscription lives at the tab-shell level (it survives tab switches — only
  // the inner branch re-renders). The Subscriptions tab uses its own source.
  // Only the subscription callbacks call setState (never the effect body), so
  // there are no cascading synchronous re-renders; the signed-out and
  // auth-loading states are derived from `status` at render time instead.
  useEffect(() => {
    if (!user) {
      return;
    }

    return subscribeToUserOrders(
      user.uid,
      (nextOrders) => {
        setOrders(nextOrders);
        setError("");
        setIsLoading(false);
      },
      () => {
        setError("We could not load your purchases. Refresh to try again.");
        setIsLoading(false);
      },
    );
  }, [user]);

  const sortedOrders = useMemo(
    () =>
      [...orders].sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt)),
    [orders],
  );

  const authResolving = status === "loading";
  const isSignedIn = status === "authenticated" && Boolean(user);

  function handleTabChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", value);

    startTransition(() => {
      router.replace(`/account/billing?${params.toString()}`, { scroll: false });
    });
  }

  return (
    <section className="rounded-[4px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
      <div className="mb-5 rounded-[4px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-4">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
          Billing is not payouts
        </p>
        <p className="mt-2 text-sm leading-6 text-[var(--color-ink-soft)]">
          Use Billing for purchases, subscriptions, invoices, and receipts tied
          to this account. Use Payouts when you are a creator connecting Stripe
          or checking money owed to you.
        </p>
      </div>
      <HorizontalTabs
        tabs={billingTabs}
        activeValue={activeTab}
        onChange={handleTabChange}
        ariaLabel="Billing sections"
      />
      <div className="mt-6">
        {activeTab === "subscriptions" ? (
          <PlansPanel />
        ) : activeTab === "invoices" ? (
          <InvoicesTab
            orders={sortedOrders}
            isLoading={isLoading}
            error={error}
            isSignedIn={isSignedIn}
            authResolving={authResolving}
          />
        ) : (
          <PurchasesTab
            orders={sortedOrders}
            isLoading={isLoading}
            error={error}
            isSignedIn={isSignedIn}
            authResolving={authResolving}
          />
        )}
      </div>
    </section>
  );
}

type OrderTabProps = {
  orders: Order[];
  isLoading: boolean;
  error: string;
  isSignedIn: boolean;
  authResolving: boolean;
};

function PurchasesTab({
  orders,
  isLoading,
  error,
  isSignedIn,
  authResolving,
}: OrderTabProps) {
  if (authResolving) {
    return <BillingNotice>Loading your purchases...</BillingNotice>;
  }

  if (!isSignedIn) {
    return <BillingNotice>Sign in to view your purchase history.</BillingNotice>;
  }

  if (isLoading) {
    return <BillingNotice>Loading your purchases...</BillingNotice>;
  }

  if (error) {
    return <BillingNotice tone="error">{error}</BillingNotice>;
  }

  // Empty state ONLY when the query genuinely returned zero rows — no
  // client-side filtering hides real orders here.
  if (orders.length === 0) {
    return (
      <BillingEmptyState
        eyebrow="Purchases"
        title="No purchases yet."
        detail="Courses you buy will appear here with their value, payment status, date, and receipt as soon as Stripe confirms the checkout."
        statusLabel="Empty"
      />
    );
  }

  return (
    <div className="grid gap-3">
      <p className="text-sm text-[var(--color-ink-soft)]">
        {orders.length} {orders.length === 1 ? "purchase" : "purchases"}
      </p>
      <ul className="grid gap-3">
        {orders.map((order) => (
          <li
            key={order.id}
            className="rounded-[3px] border fine-rule bg-[var(--color-surface-soft)] p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <StatusChip status={order.status} />
                <h4 className="mt-2 truncate text-base font-semibold text-[var(--color-ink)]">
                  {order.courseTitle}
                </h4>
                <p className="mt-1 text-xs text-[var(--color-ink-soft)]">
                  {formatDate(order.paidAt ?? order.createdAt)}
                </p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <span className="rounded-[8px] bg-white px-3 py-1 text-sm font-bold text-[var(--color-primary)]">
                  {formatMoney(order.amountMinor, order.currency)}
                </span>
                {order.receiptUrl ? (
                  <a
                    href={order.receiptUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-semibold text-[var(--color-primary)] hover:underline"
                  >
                    View receipt &rarr;
                  </a>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function InvoicesTab({
  orders,
  isLoading,
  error,
  isSignedIn,
  authResolving,
}: OrderTabProps) {
  const [portalBusy, setPortalBusy] = useState(false);
  const [portalError, setPortalError] = useState("");

  // One-off course purchases get a Stripe charge receipt (captured on the
  // order). Subscription invoices live in the Customer Portal, surfaced via
  // the button below.
  const receipts = useMemo(
    () => orders.filter((order) => Boolean(order.receiptUrl)),
    [orders],
  );

  async function handleOpenPortal() {
    setPortalError("");
    setPortalBusy(true);
    try {
      await openBillingPortal();
      // openBillingPortal navigates away on success, so if it resolves the
      // redirect is already in flight — leave the button in its busy state.
    } catch (cause) {
      setPortalError(
        cause instanceof Error
          ? cause.message
          : "Could not open the Stripe billing portal.",
      );
      setPortalBusy(false);
    }
  }

  if (authResolving) {
    return <BillingNotice>Loading your invoices...</BillingNotice>;
  }

  if (!isSignedIn) {
    return (
      <BillingNotice>Sign in to view your invoices and receipts.</BillingNotice>
    );
  }

  return (
    <div className="grid gap-5">
      <div className="rounded-[4px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-4">
        <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-brand)]">
          Subscription invoices
        </p>
        <p className="mt-2 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
          Your subscription invoices, payment method, and billing history live
          in the Stripe Customer Portal — the canonical source Stripe keeps in
          sync with every charge.
        </p>
        <button
          type="button"
          onClick={handleOpenPortal}
          disabled={portalBusy}
          className="button-outline mt-3 px-4 py-2 text-sm disabled:opacity-60"
        >
          {portalBusy ? "Opening Stripe..." : "View invoices in Stripe portal"}
        </button>
        {portalError ? (
          <p
            role="alert"
            className="mt-3 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-accent-fg)]"
          >
            {portalError}
          </p>
        ) : null}
      </div>

      <div>
        <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-brand)]">
          Purchase receipts
        </p>
        {isLoading ? (
          <p className="mt-3 text-sm text-[var(--color-ink-soft)]">
            Loading receipts...
          </p>
        ) : error ? (
          <p className="mt-3 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-accent-fg)]">
            {error}
          </p>
        ) : receipts.length === 0 ? (
          <p className="mt-3 rounded-[3px] border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm leading-6 text-[var(--color-ink-soft)]">
            No one-off purchase receipts yet. Receipts appear here after a course
            checkout is paid.
          </p>
        ) : (
          <ul className="mt-3 grid gap-3">
            {receipts.map((order) => (
              <li
                key={order.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-[3px] border fine-rule bg-[var(--color-surface-soft)] p-4"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[var(--color-ink)]">
                    {order.courseTitle}
                  </p>
                  <p className="mt-1 text-xs text-[var(--color-ink-soft)]">
                    {formatDate(order.paidAt ?? order.createdAt)} -{" "}
                    {formatMoney(order.amountMinor, order.currency)}
                  </p>
                </div>
                {order.receiptUrl ? (
                  <a
                    href={order.receiptUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm font-semibold text-[var(--color-primary)] hover:underline"
                  >
                    View receipt &rarr;
                  </a>
                ) : (
                  <span className="text-sm text-[var(--color-ink-soft)]">
                    Receipt pending
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function BillingNotice({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "muted" | "error";
}) {
  if (tone === "error") {
    return (
      <p className="rounded-[4px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-accent-fg)]">
        {children}
      </p>
    );
  }

  return (
    <div className="rounded-[4px] border border-dashed border-[var(--color-line-strong)] bg-[var(--color-surface-soft)] p-6 text-sm text-[var(--color-ink-soft)]">
      {children}
    </div>
  );
}

function BillingEmptyState({
  eyebrow,
  title,
  detail,
  statusLabel,
}: {
  eyebrow: string;
  title: string;
  detail: string;
  statusLabel: string;
}) {
  return (
    <div className="rounded-[4px] border border-dashed border-[var(--color-line-strong)] bg-[var(--color-surface-soft)] p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-brand)]">
            {eyebrow}
          </p>
          <h3 className="display-title mt-3 text-3xl text-[var(--color-ink)]">
            {title}
          </h3>
        </div>
        <StatusChip status="pending" label={statusLabel} />
      </div>
      <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
        {detail}
      </p>
    </div>
  );
}
