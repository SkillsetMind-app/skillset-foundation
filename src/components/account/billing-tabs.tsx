"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { startTransition, useEffect, useMemo, useState } from "react";

import { PlansPanel } from "@/components/account/plans-panel";
import { useAuth } from "@/components/auth/auth-provider";
import { HorizontalTabs } from "@/components/shared/horizontal-tabs";
import { StatusChip } from "@/components/shared/status-chip";
import { planById, type PlanId } from "@/data/plans";
import type { Order } from "@/domain/order";
import type { UserProfile } from "@/domain/user-profile";
import { subscribeToUserOrders } from "@/lib/data/orders";
import { subscribeToUserProfile } from "@/lib/data/user-profiles";
import { toDate } from "@/lib/format-date";
import { openBillingPortal, requestOrderRefund } from "@/lib/payments/billing";

const billingTabs = [
  { value: "overview", label: "Overview" },
  { value: "purchases", label: "Purchases" },
  { value: "payment-methods", label: "Payment methods" },
  { value: "subscriptions", label: "Subscription" },
];

function formatMoney(amountMinor: number, currency: string) {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
  }).format(amountMinor / 100);
}

function formatDate(value: unknown) {
  const date = toDate(value);
  if (!date) {
    return "Date pending";
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
  }).format(date);
}

function toMillis(value: unknown): number {
  return toDate(value)?.getTime() ?? 0;
}

export function BillingTabs() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = searchParams.get("tab") ?? "overview";
  const { status, user } = useAuth();

  const [orders, setOrders] = useState<Order[]>([]);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  // "loading" until the first profile snapshot resolves. The Overview waits on
  // this so it never flashes "Free subscription" from a still-null profile
  // during the orders-vs-profile load race; "error" lets it show plan/portal as
  // unknown instead of asserting Free when the listener fails.
  const [profileStatus, setProfileStatus] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  // One real-time listener feeds the Overview and Purchases tabs, so the
  // subscription lives at the tab-shell level (it survives tab switches — only
  // the inner branch re-renders). The Subscription tab uses its own source.
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

  // Profile feeds the current plan + whether a Stripe customer exists (so the
  // portal button is only offered when it can actually open). Failure is
  // non-fatal — the overview just falls back to the Free plan label.
  useEffect(() => {
    if (!user) {
      return;
    }

    return subscribeToUserProfile(
      user.uid,
      (nextProfile) => {
        setProfile(nextProfile);
        setProfileStatus("ready");
      },
      () => {
        setProfile(null);
        setProfileStatus("error");
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
    <section className="rounded-[14px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
      <HorizontalTabs
        tabs={billingTabs}
        activeValue={activeTab}
        onChange={handleTabChange}
        ariaLabel="Billing sections"
      />
      <div className="mt-6">
        {activeTab === "subscriptions" ? (
          <PlansPanel />
        ) : activeTab === "payment-methods" ? (
          <PaymentMethodsTab
            profile={profile}
            isSignedIn={isSignedIn}
            authResolving={authResolving}
          />
        ) : activeTab === "purchases" ? (
          <PurchasesTab
            orders={sortedOrders}
            userId={user?.uid ?? null}
            isLoading={isLoading}
            error={error}
            isSignedIn={isSignedIn}
            authResolving={authResolving}
          />
        ) : (
          <OverviewTab
            orders={sortedOrders}
            profile={profile}
            profileStatus={profileStatus}
            isLoading={isLoading}
            error={error}
            isSignedIn={isSignedIn}
            authResolving={authResolving}
            onSeePurchases={() => handleTabChange("purchases")}
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

/** Sum of paid orders. Single-currency assumption — the marketplace prices in
 * one currency today; the label uses the currency of the most recent paid
 * order. ponytail: per-currency grouping when multi-currency selling lands. */
function summarisePurchases(orders: Order[]) {
  // A partial refund leaves the learner with course access and net-paid most of
  // the price, so it counts as an owned purchase (net of the refunded portion);
  // only a full refund removes the course.
  const owned = orders.filter(
    (order) =>
      order.status === "paid" || order.status === "partially_refunded",
  );
  const refunded = orders.filter(
    (order) =>
      order.status === "refunded" || order.status === "partially_refunded",
  );
  const spentMinor = owned.reduce(
    (total, order) =>
      total + Math.max(0, order.amountMinor - (order.refundedAmountMinor ?? 0)),
    0,
  );
  const currency = owned[0]?.currency ?? "USD";
  return {
    courseCount: owned.length,
    refundCount: refunded.length,
    spentMinor,
    currency,
  };
}

function OverviewTab({
  orders,
  profile,
  profileStatus,
  isLoading,
  error,
  isSignedIn,
  authResolving,
  onSeePurchases,
}: OrderTabProps & {
  profile: UserProfile | null;
  profileStatus: "loading" | "ready" | "error";
  onSeePurchases: () => void;
}) {
  // Wait on the profile too, so the plan/portal block never renders a default
  // "Free" from a not-yet-loaded profile during the orders-vs-profile race.
  if (authResolving || isLoading || profileStatus === "loading") {
    return <BillingNotice>Loading your billing overview...</BillingNotice>;
  }

  if (!isSignedIn) {
    return <BillingNotice>Sign in to view your billing overview.</BillingNotice>;
  }

  if (error) {
    return <BillingNotice tone="error">{error}</BillingNotice>;
  }

  const { courseCount, refundCount, spentMinor, currency } =
    summarisePurchases(orders);
  // Profile listener failed: we don't know the plan, so show it as unknown
  // rather than asserting "Free" (which would misstate a paying user's plan).
  const profileFailed = profileStatus === "error";
  const planId: PlanId = profile?.currentPlanId ?? "free";
  const planName = profileFailed ? "Unavailable" : planById(planId).name;
  const hasCustomer = Boolean(profile?.stripeCustomerId);

  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      {/* Lifetime summary */}
      <div className="rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-5">
        <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
          Lifetime spend
        </p>
        <p className="display-title mt-2 text-4xl text-[var(--color-primary)]">
          {formatMoney(spentMinor, currency)}
        </p>
        <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
          {courseCount} {courseCount === 1 ? "course" : "courses"} purchased
          {profileFailed ? "" : ` · ${planName} subscription`}
        </p>

        <dl className="mt-5 grid gap-px overflow-hidden rounded-[10px] border fine-rule bg-[var(--color-line)]">
          {[
            ["Courses purchased", String(courseCount)],
            ["Active subscription", planName],
            ["Refunds", String(refundCount)],
          ].map(([label, value]) => (
            <div
              key={label}
              className="flex items-center justify-between gap-4 bg-white px-4 py-3 text-sm"
            >
              <dt className="text-[var(--color-ink-soft)]">{label}</dt>
              <dd className="font-semibold text-[var(--color-ink)]">{value}</dd>
            </div>
          ))}
        </dl>

        <button
          type="button"
          onClick={onSeePurchases}
          className="button-outline mt-5 px-4 py-2 text-sm"
        >
          See all purchases &rarr;
        </button>
      </div>

      {/* Payments & invoices via Stripe */}
      <div className="rounded-[14px] border border-[var(--color-line)] bg-white p-5">
        <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
          Payments & invoices
        </p>
        <p className="mt-2 text-sm leading-7 text-[var(--color-ink-soft)]">
          Your payment method, subscription invoices, and billing history live
          in the Stripe Customer Portal — the canonical record Stripe keeps in
          sync with every charge.
        </p>
        {hasCustomer ? (
          <PortalButton label="Open Stripe portal" />
        ) : (
          <p className="mt-3 rounded-[10px] border fine-rule bg-[var(--color-surface-soft)] px-4 py-3 text-sm leading-6 text-[var(--color-ink-soft)]">
            {profileFailed
              ? "We couldn't load your billing details right now. Refresh to try again."
              : "Your portal opens once you have a paid purchase or subscription."}
          </p>
        )}
        <p className="mt-4 text-xs leading-6 text-[var(--color-ink-soft)]">
          All payments are processed by <strong>Stripe</strong>. Card details
          are never stored on SkillsetMind. Course purchases are charged by the
          educator&rsquo;s own Stripe account — your SkillsetMind subscription
          is the only thing charged by us.
        </p>
      </div>
    </div>
  );
}

/** Cards live in Stripe, never on SkillsetMind — so this tab is an honest portal
 * delegation, not a fabricated card list. */
function PaymentMethodsTab({
  profile,
  isSignedIn,
  authResolving,
}: {
  profile: UserProfile | null;
  isSignedIn: boolean;
  authResolving: boolean;
}) {
  if (authResolving) {
    return <BillingNotice>Loading your payment methods...</BillingNotice>;
  }

  if (!isSignedIn) {
    return <BillingNotice>Sign in to manage your payment methods.</BillingNotice>;
  }

  const hasCustomer = Boolean(profile?.stripeCustomerId);

  return (
    <div className="rounded-[14px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-5">
      <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
        Payment methods
      </p>
      <h3 className="display-title mt-2 text-2xl text-[var(--color-ink)]">
        Managed securely by Stripe.
      </h3>
      <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
        SkillsetMind never stores your full card details. Add, replace, or remove a
        card — and set your default — inside the Stripe Customer Portal, the same
        secure surface that holds your invoices and billing history.
      </p>
      {hasCustomer ? (
        <PortalButton label="Manage payment methods" />
      ) : (
        <p className="mt-3 rounded-[10px] border fine-rule bg-white px-4 py-3 text-sm leading-6 text-[var(--color-ink-soft)]">
          You&rsquo;ll add your first card during checkout — Stripe stores it
          securely and it appears here for management afterwards.
        </p>
      )}
    </div>
  );
}

/** Opens the Stripe portal, owning its own busy/error state so both the
 * overview and payment-methods tabs can drop it in. */
function PortalButton({ label }: { label: string }) {
  const [busy, setBusy] = useState(false);
  const [portalError, setPortalError] = useState("");

  async function handleOpenPortal() {
    setPortalError("");
    setBusy(true);
    try {
      await openBillingPortal();
      // openBillingPortal navigates away on success; leave it busy if it
      // resolves (the redirect is already in flight).
    } catch (cause) {
      setPortalError(
        cause instanceof Error
          ? cause.message
          : "Could not open the Stripe billing portal.",
      );
      setBusy(false);
    }
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={handleOpenPortal}
        disabled={busy}
        className="button-outline px-4 py-2 text-sm disabled:opacity-60"
      >
        {busy ? "Opening Stripe..." : label}
      </button>
      {portalError ? (
        <p
          role="alert"
          className="mt-3 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]"
        >
          {portalError}
        </p>
      ) : null}
    </div>
  );
}

function PurchasesTab({
  orders,
  userId,
  isLoading,
  error,
  isSignedIn,
  authResolving,
}: OrderTabProps & { userId: string | null }) {
  const [refundFor, setRefundFor] = useState<Order | null>(null);

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
      {/* Direct charges: each course order was charged on the educator's own
          connected account and we set no statement_descriptor override, so the
          bank shows THEIR descriptor. Said here, where a learner reconciles a
          statement line, it turns an unrecognised charge into a recognised one
          instead of a chargeback against the educator's balance. */}
      <p className="rounded-[10px] border fine-rule bg-[var(--color-surface-soft)] px-4 py-3 text-xs leading-6 text-[var(--color-ink-soft)]">
        Each course is sold by the educator who publishes it — SkillsetMind is
        not the seller. Their Stripe account takes the payment, so the name on
        your card statement is usually theirs. Where a receipt is available,
        open it to see exactly who charged you.
      </p>
      <ul className="grid gap-3">
        {orders.map((order) => (
          <li
            key={order.id}
            className="rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4"
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
                <div className="flex flex-wrap items-center justify-end gap-3">
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
                  {order.status === "paid" && userId ? (
                    <button
                      type="button"
                      onClick={() => setRefundFor(order)}
                      className="text-xs font-semibold text-[var(--color-accent-fg)] hover:underline"
                    >
                      Request a refund
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {refundFor && userId ? (
        <RefundModal
          order={refundFor}
          userId={userId}
          onClose={() => setRefundFor(null)}
        />
      ) : null}
    </div>
  );
}

/** Confirms and submits a self-serve refund. The server enforces every policy
 * gate (window, progress, certificate) and returns a precise message we show
 * verbatim — so this modal stays a thin, honest confirmation. We do not collect
 * a reason the callable would silently drop. */
function RefundModal({
  order,
  userId,
  onClose,
}: {
  order: Order;
  userId: string;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [done, setDone] = useState(false);

  async function handleSubmit() {
    setSubmitError("");
    setBusy(true);
    try {
      await requestOrderRefund(`${userId}__${order.courseId}`);
      setDone(true);
    } catch (cause) {
      setSubmitError(
        cause instanceof Error
          ? cause.message
          : "We could not submit your refund request. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-[rgba(7,9,13,0.55)] p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Request a refund"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-[16px] border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-strong)]"
        onClick={(event) => event.stopPropagation()}
      >
        {done ? (
          <>
            <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-success-fg)]">
              Refund requested
            </p>
            <h2 className="display-title mt-2 text-2xl text-[var(--color-primary)]">
              We&rsquo;re on it.
            </h2>
            <p className="mt-3 text-sm leading-7 text-[var(--color-ink-soft)]">
              Your request for <strong>{order.courseTitle}</strong> was
              submitted. Eligible refunds are returned from the
              educator&rsquo;s Stripe account to your original payment method,
              and the status here updates as soon as Stripe confirms it.
            </p>
            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="button-solid px-4 py-2 text-sm"
              >
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
              Refund request
            </p>
            <h2 className="display-title mt-2 text-2xl text-[var(--color-primary)]">
              Request a refund.
            </h2>
            <p className="mt-3 text-sm leading-7 text-[var(--color-ink-soft)]">
              Course purchases are refundable within the refund window if you
              have completed less than half the course and have not been issued
              a certificate. Eligible requests are processed automatically: the
              refund is issued from the educator&rsquo;s Stripe account — the
              same account that charged you — straight back to your original
              payment method.
            </p>

            <dl className="mt-4 grid gap-px overflow-hidden rounded-[10px] border fine-rule bg-[var(--color-line)]">
              {[
                ["Course", order.courseTitle],
                ["Purchased", formatDate(order.paidAt ?? order.createdAt)],
                ["Amount", formatMoney(order.amountMinor, order.currency)],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="flex items-center justify-between gap-4 bg-white px-4 py-2.5 text-sm"
                >
                  <dt className="text-[var(--color-ink-soft)]">{label}</dt>
                  <dd className="truncate font-semibold text-[var(--color-ink)]">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>

            {submitError ? (
              <p
                role="alert"
                className="mt-4 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]"
              >
                {submitError}
              </p>
            ) : null}

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="button-outline px-4 py-2 text-sm disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={busy}
                className="button-solid px-4 py-2 text-sm disabled:opacity-60"
              >
                {busy ? "Submitting..." : "Request refund"}
              </button>
            </div>
          </>
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
      <p className="rounded-[14px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]">
        {children}
      </p>
    );
  }

  return (
    <div className="rounded-[14px] border border-dashed border-[var(--color-line-strong)] bg-[var(--color-surface-soft)] p-6 text-sm text-[var(--color-ink-soft)]">
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
    <div className="rounded-[14px] border border-dashed border-[var(--color-line-strong)] bg-[var(--color-surface-soft)] p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
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
