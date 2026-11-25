"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { startTransition, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { RefreshCw, X } from "lucide-react";

import { PlansPanel } from "@/components/account/plans-panel";
import { BusyLabel } from "@/components/ui/busy-label";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { useAuth } from "@/components/auth/auth-provider";
import { HorizontalTabs } from "@/components/shared/horizontal-tabs";
import { ShortId } from "@/components/shared/short-id";
import { StatusChip } from "@/components/shared/status-chip";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineAlert } from "@/components/ui/inline-alert";
import { LoadErrorAlert } from "@/components/ui/load-error-alert";
import { plans } from "@/data/plans";
import type { Order } from "@/domain/order";
import type { UserProfile } from "@/domain/user-profile";
import { subscribeToUserOrders } from "@/lib/data/orders";
import { subscribeToUserProfile } from "@/lib/data/user-profiles";
import { useModalFocus } from "@/lib/a11y/use-modal-focus";
import { hasPermission } from "@/lib/permissions";
import { toDate } from "@/lib/format-date";
import { fetchPlanBillingState, openBillingPortal, requestOrderRefund, type PlanBillingState } from "@/lib/payments/billing";

const billingTabs = [
  { value: "overview", label: "Overview" },
  { value: "purchases", label: "Purchases" },
  { value: "payment-methods", label: "Payment methods" },
  { value: "subscriptions", label: "Subscription" },
];

const subscriptionStatusKeys: Record<string, string> = {
  active: "statusChip.active",
  trialing: "teach.subscriptions.statusTrialing",
  past_due: "teach.subscriptions.statusPastDue",
  unpaid: "teach.subscriptions.statusUnpaid",
};

function formatMoney(amountMinor: number, currency: string, locale: string) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  }).format(amountMinor / 100);
}

function formatDate(value: unknown, locale: string, pending: string) {
  const date = toDate(value);
  if (!date) {
    return pending;
  }

  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
  }).format(date);
}

function toMillis(value: unknown): number {
  return toDate(value)?.getTime() ?? 0;
}

export function BillingTabs() {
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { status, user } = useAuth();
  // Creator access can come from a grant, without a paid subscription.
  const canTeach = hasPermission({ roles: user?.roles }, "teacherStudio.access");
  const requestedTab = searchParams.get("tab") ?? "overview";
  const activeTab = requestedTab === "subscriptions" && !canTeach ? "overview" : requestedTab;

  const [orders, setOrders] = useState<Order[]>([]);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  // A missing or unreadable profile does not prove free access.
  const [profileStatus, setProfileStatus] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  // "Try again" for purchases (the summary and the list come from this read): subscribes again.
  // The effect cleanup undoes the previous subscription before the new one.
  const [ordersReadAttempt, setOrdersReadAttempt] = useState(0);
  // "Try again" for the profile (the portal card in Overview): subscribes again.
  const [profileReadAttempt, setProfileReadAttempt] = useState(0);
  // Stays on screen in both outcomes and receives the focus from "Try again".
  const panelRef = useRef<HTMLDivElement>(null);

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
        setError("accountBilling.purchasesError");
        setIsLoading(false);
      },
    );
  }, [user, ordersReadAttempt]);

  // Goes back to the usual wait (the skeleton), never to "No purchases yet" or to
  // zeroed values in place of the error, until the new read responds.
  function retryOrdersRead() {
    setError("");
    setIsLoading(true);
    setOrdersReadAttempt((attempt) => attempt + 1);
  }

  // Customer allows looking up history; it does not prove a subscription.
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
  }, [user, profileReadAttempt]);

  // Goes back to the Overview skeleton until the new read responds.
  function retryProfileRead() {
    setProfileStatus("loading");
    setProfileReadAttempt((attempt) => attempt + 1);
  }

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
    <section className="rounded-lg border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
      <HorizontalTabs
        tabs={billingTabs
          .filter((tab) => canTeach || tab.value !== "subscriptions")
          .map((tab) => ({ ...tab, label: t(`accountBilling.tabs.${tab.value}`) }))}
        activeValue={activeTab}
        onChange={handleTabChange}
        ariaLabel={t("accountBilling.sections")}
      />
      <div ref={panelRef} tabIndex={-1} className="mt-6">
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
            onRetry={retryOrdersRead}
            retryFocusRef={panelRef}
            isSignedIn={isSignedIn}
            authResolving={authResolving}
          />
        ) : (
          <OverviewTab
            orders={sortedOrders}
            userId={user?.uid ?? null}
            profile={profile}
            profileStatus={profileStatus}
            onRetryProfile={retryProfileRead}
            isLoading={isLoading}
            error={error}
            onRetry={retryOrdersRead}
            retryFocusRef={panelRef}
            isSignedIn={isSignedIn}
            authResolving={authResolving}
            showPlan={canTeach}
            onSeePurchases={() => handleTabChange("purchases")}
            onSeePlans={() => handleTabChange("subscriptions")}
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
  /** "Try again" on the error: subscribes to the purchases read again. */
  onRetry: () => void;
  retryFocusRef: RefObject<HTMLDivElement | null>;
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
  userId,
  profile,
  profileStatus,
  onRetryProfile,
  isLoading,
  error,
  onRetry,
  retryFocusRef,
  isSignedIn,
  authResolving,
  showPlan,
  onSeePurchases,
  onSeePlans,
}: OrderTabProps & {
  userId: string | null;
  profile: UserProfile | null;
  profileStatus: "loading" | "ready" | "error";
  onRetryProfile: () => void;
  showPlan: boolean;
  onSeePurchases: () => void;
  onSeePlans: () => void;
}) {
  const { t, locale } = useTranslation();
  const [refreshVersion, setRefreshVersion] = useState(0);
  const profilePlanId = profile?.currentPlanId;
  const profileCustomerId = profile?.stripeCustomerId;
  const profileUpdatedAt = profile?.updatedAt;
  const billingRequest = useMemo(() => ({
    userId, profileStatus, profilePlanId, profileCustomerId, profileUpdatedAt, refreshVersion,
  }), [userId, profileStatus, profilePlanId, profileCustomerId, profileUpdatedAt, refreshVersion]);
  const [billingRead, setBillingRead] = useState<{
    request: typeof billingRequest;
    state: PlanBillingState | null;
  } | null>(null);

  useEffect(() => {
    if (!isSignedIn || !showPlan || !billingRequest.userId || billingRequest.profileStatus === "loading") return;
    let cancelled = false;
    fetchPlanBillingState()
      .then((state) => {
        if (!cancelled) setBillingRead({ request: billingRequest, state });
      })
      .catch(() => {
        if (!cancelled) setBillingRead({ request: billingRequest, state: null });
      });
    return () => { cancelled = true; };
  }, [isSignedIn, showPlan, billingRequest]);

  if (authResolving || isLoading || profileStatus === "loading") {
    return <BillingSkeleton shape="overview" label={t("accountBilling.loadingOverview")} />;
  }

  if (!isSignedIn) {
    return <BillingNotice>{t("accountBilling.signInOverview")}</BillingNotice>;
  }

  if (error) {
    return <LoadErrorAlert onRetry={onRetry} focusRef={retryFocusRef}>{t(error)}</LoadErrorAlert>;
  }

  const { courseCount, refundCount, spentMinor, currency } =
    summarisePurchases(orders);
  const profileFailed = profileStatus === "error";
  // Each read belongs to the profile snapshot; an old response does not count as current.
  const billing = billingRead?.request === billingRequest ? billingRead.state : undefined;
  const subscription = billing?.subscription;
  const accessPlanName = profileFailed || !profilePlanId
    ? t("accountBilling.unavailable")
    : profilePlanId === "free"
      ? t("accountBilling.defaultAccess")
      : plans.find((plan) => plan.id === profilePlanId)?.name ?? t("accountBilling.unavailable");
  const planName = subscription
    ? plans.find((plan) => plan.id === subscription.planId)?.name ?? t("accountBilling.unavailable")
    : billing
      ? t("accountBilling.noStripeSubscription")
      : t(billing === null ? "accountBilling.unavailable" : "accountPlans.loading");
  const planDetails = showPlan ? [
    [t("accountBilling.accessPlan"), accessPlanName],
    [t("accountBilling.subscriptionLabel"), planName],
    ...(subscription ? [
      [t("accountBilling.subscriptionStatus"), t(subscriptionStatusKeys[subscription.status] ?? "accountBilling.unavailable")],
      [t("accountPlans.cycle"), t(subscription.cycle === "monthly" || subscription.cycle === "yearly"
        ? `accountPlans.cycles.${subscription.cycle}.label`
        : "accountBilling.unavailable")],
    ] : []),
  ] : [];
  const hasCustomer = Boolean(profile?.stripeCustomerId);

  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      {/* Lifetime summary */}
      <div className="rounded-lg border fine-rule bg-[var(--color-surface-soft)] p-5">
        <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
          {t("accountBilling.lifetimeSpend")}
        </p>
        {/* The value in plain type (the serif is for the page title). The phrase "N
            courses purchased" was removed: the number is already on the row right below. */}
        <p className="mt-2 text-3xl font-bold leading-tight tabular-nums text-[var(--color-primary)]">
          {formatMoney(spentMinor, currency, locale)}
        </p>

        <dl className="mt-5 grid gap-px overflow-hidden rounded-md border fine-rule bg-[var(--color-line)]">
          {[
            [t("accountBilling.coursesLabel"), String(courseCount)],
            ...planDetails,
            [t("accountBilling.refunds"), String(refundCount)],
          ].map(([label, value]) => (
            <div
              key={label}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 bg-white px-4 py-3 text-sm"
            >
              <dt className="text-[var(--color-ink-soft)]">{label}</dt>
              <dd className="min-w-0 break-words font-semibold text-[var(--color-ink)]">{value}</dd>
            </div>
          ))}
        </dl>

        {showPlan && subscription?.cancelAtPeriodEnd ? (
          <p className="mt-3 text-sm text-[var(--color-ink-soft)]">
            {t("accountBilling.cancellationScheduled")}
          </p>
        ) : null}
        {showPlan && billing === null ? (
          <p role="status" className="mt-3 text-sm text-[var(--color-ink-soft)]">
            {t("accountBilling.detailsError")}
          </p>
        ) : null}

        {showPlan ? (
          <button
            type="button"
            onClick={() => setRefreshVersion((version) => version + 1)}
            disabled={billing === undefined}
            aria-busy={billing === undefined}
            className="button-outline mt-3 max-w-full gap-2 whitespace-normal px-4 py-2 text-sm"
          >
            <RefreshCw size={16} aria-hidden="true" className="shrink-0" />
            {t("accountBilling.refreshStatus")}
          </button>
        ) : null}

        <button
          type="button"
          onClick={onSeePurchases}
          className="button-outline mt-5 px-4 py-2 text-sm"
        >
          {t("accountBilling.seePurchases")} &rarr;
        </button>
      </div>

      {/* Payments & invoices via Stripe */}
      <div className="rounded-lg border border-[var(--color-line)] bg-white p-5">
        <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
          {t("accountBilling.paymentsInvoices")}
        </p>
        <p className="mt-2 text-sm leading-7 text-[var(--color-ink-soft)]">
          {t("accountBilling.portalBody")}
        </p>
        {showPlan && billing?.subscription === null ? (
          <button type="button" onClick={onSeePlans} className="button-solid mt-3 px-4 py-2 text-sm">
            {t("accountBilling.reviewPlans")}
          </button>
        ) : null}
        {hasCustomer ? (
          <PortalButton label={t(showPlan
            ? subscription ? "accountPlans.manage" : "accountBilling.billingHistory"
            : "accountBilling.openPortal")} />
        ) : profileFailed ? (
          // The profile did not come: the sentence told the user to refresh the page; now the button reads again.
          <LoadErrorAlert className="mt-3" onRetry={onRetryProfile} focusRef={retryFocusRef}>
            {t("accountBilling.detailsLoadError")}
          </LoadErrorAlert>
        ) : (
          <p className="mt-3 rounded-md border fine-rule bg-[var(--color-surface-soft)] px-4 py-3 text-sm leading-6 text-[var(--color-ink-soft)]">
            {t("accountBilling.portalAfterPurchase")}
          </p>
        )}
        <p className="mt-4 text-xs leading-6 text-[var(--color-ink-soft)]">
          {t("accountBilling.processedBy")} <strong>Stripe</strong>. {t("accountBilling.cardDetails")}
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
  const { t } = useTranslation();
  if (authResolving) {
    return <BillingSkeleton shape="panel" label={t("accountBilling.loadingMethods")} />;
  }

  if (!isSignedIn) {
    return <BillingNotice>{t("accountBilling.signInMethods")}</BillingNotice>;
  }

  const hasCustomer = Boolean(profile?.stripeCustomerId);

  return (
    <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-5">
      <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
        {t("accountBilling.tabs.payment-methods")}
      </p>
      <h3 className="display-title mt-2 text-2xl text-[var(--color-ink)]">
        {t("accountBilling.managedStripe")}
      </h3>
      <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
        {t("accountBilling.methodsBody")}
      </p>
      {hasCustomer ? (
        <PortalButton label={t("accountBilling.manageMethods")} />
      ) : (
        <p className="mt-3 rounded-md border fine-rule bg-white px-4 py-3 text-sm leading-6 text-[var(--color-ink-soft)]">
          {t("accountBilling.firstCard")}
        </p>
      )}
    </div>
  );
}

/** Opens the Stripe portal, owning its own busy/error state so both the
 * overview and payment-methods tabs can drop it in. */
function PortalButton({ label }: { label: string }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [portalError, setPortalError] = useState("");

  async function handleOpenPortal() {
    setPortalError("");
    setBusy(true);
    try {
      await openBillingPortal();
      // openBillingPortal navigates away on success; leave it busy if it
      // resolves (the redirect is already in flight).
    } catch {
      setPortalError("accountBilling.portalError");
      setBusy(false);
    }
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={handleOpenPortal}
        disabled={busy}
        className="button-outline px-4 py-2 text-sm"
      >
        <BusyLabel busy={busy} idle={label} busyText={t("accountBilling.openingStripe")} />
      </button>
      {portalError ? (
        <InlineAlert tone="error" className="mt-3">{t(portalError)}</InlineAlert>
      ) : null}
    </div>
  );
}

function PurchasesTab({
  orders,
  userId,
  isLoading,
  error,
  onRetry,
  retryFocusRef,
  isSignedIn,
  authResolving,
}: OrderTabProps & { userId: string | null }) {
  const { t, locale } = useTranslation();
  const [refundFor, setRefundFor] = useState<Order | null>(null);

  if (authResolving) {
    return <BillingSkeleton shape="list" label={t("accountBilling.loadingPurchases")} />;
  }

  if (!isSignedIn) {
    return <BillingNotice>{t("accountBilling.signInPurchases")}</BillingNotice>;
  }

  if (isLoading) {
    return <BillingSkeleton shape="list" label={t("accountBilling.loadingPurchases")} />;
  }

  if (error) {
    return <LoadErrorAlert onRetry={onRetry} focusRef={retryFocusRef}>{t(error)}</LoadErrorAlert>;
  }

  // Empty state ONLY when the query genuinely returned zero rows — no
  // client-side filtering hides real orders here.
  if (orders.length === 0) {
    return (
      // The platform's default empty state, without the "EMPTY" tag in the amber of
      // pending: nothing is pending, there are just no purchases.
      <EmptyState
        as="h3"
        title={t("accountBilling.noPurchases")}
        description={t("accountBilling.noPurchasesBody")}
      />
    );
  }

  return (
    <div className="grid gap-3">
      <p className="text-sm text-[var(--color-ink-soft)]">
        {t(orders.length === 1 ? "accountBilling.purchaseCount" : "accountBilling.purchasesCount").replace("{count}", () => String(orders.length))}
      </p>
      {/* Direct charges: each course order was charged on the educator's own
          connected account and we set no statement_descriptor override, so the
          bank shows THEIR descriptor. Said here, where a learner reconciles a
          statement line, it turns an unrecognised charge into a recognised one
          instead of a chargeback against the educator's balance. */}
      <p className="rounded-md border fine-rule bg-[var(--color-surface-soft)] px-4 py-3 text-xs leading-6 text-[var(--color-ink-soft)]">
        {t("accountBilling.sellerBody")}
      </p>
      <ul className="grid gap-3">
        {orders.map((order) => (
          <li
            key={order.id}
            className="rounded-lg border fine-rule bg-[var(--color-surface-soft)] p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <StatusChip status={order.status} />
                <h4 className="mt-2 truncate text-base font-semibold text-[var(--color-ink)]">
                  {order.courseTitle}
                </h4>
                <p className="mt-1 text-xs text-[var(--color-ink-soft)]">
                  {formatDate(order.paidAt ?? order.createdAt, locale, t("accountBilling.datePending"))}
                </p>
                {/* The number the learner sends to support when "I bought it and did not get access". */}
                <div className="mt-1">
                  <ShortId id={order.id} label={t("shortId.order")} />
                </div>
              </div>
              <div className="flex flex-col items-end gap-2">
                <span className="rounded-md bg-white px-3 py-1 text-sm font-bold text-[var(--color-primary)]">
                  {formatMoney(order.amountMinor, order.currency, locale)}
                </span>
                {/* Receipt: text link with a 44px target. Asking for a refund is
                    money: an outline button, not a gold link (brass is
                    only for milestones, ui/button.tsx). */}
                <div className="flex flex-wrap items-center justify-end gap-3">
                  {order.receiptUrl ? (
                    <a
                      href={order.receiptUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-11 items-center text-xs font-semibold text-[var(--color-primary)] hover:underline"
                    >
                      {t("accountBilling.receipt")} &rarr;
                    </a>
                  ) : null}
                  {order.status === "paid" && userId ? (
                    <button
                      type="button"
                      onClick={() => setRefundFor(order)}
                      className="button-outline px-3 py-2 text-xs"
                    >
                      {t("accountBilling.requestRefund")}
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
 * gate (window, progress, certificate). Known policy errors are translated
 * without duplicating eligibility decisions. We do not collect
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
  const { t, locale } = useTranslation();
  // This was the only dialog in the app that declared `aria-modal="true"` and did not
  // manage any focus. `aria-modal` promises the screen reader that the rest
  // of the page is inert, and here the promise was false on all three counts: focus
  // stayed on the button behind the modal, Tab walked into the hidden page, and
  // Escape did not close it. On a MONEY action, the only way out was to hit
  // "Cancel" with the mouse.
  //
  // The hook already existed in @/lib/a11y — the other seven dialogs use it. It was missing
  // only from this one.
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocus(dialogRef, true);

  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [done, setDone] = useState(false);

  // While the refund request is being sent, no exit closes the dialog:
  // Cancel locks and the X disappears; Esc and a click outside follow the same rule
  // (before, they closed it and the request result arrived in an already closed dialog).
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [busy, onClose]);

  // The page behind does not scroll while the dialog is open. In the account, what
  // scrolls is .platform-content (outside the panel, the body).
  useEffect(() => {
    const scroller = document.querySelector<HTMLElement>(".platform-content") ?? document.body;
    const previousOverflow = scroller.style.overflow;
    scroller.style.overflow = "hidden";
    return () => {
      scroller.style.overflow = previousOverflow;
    };
  }, []);

  async function handleSubmit() {
    setSubmitError("");
    setBusy(true);
    try {
      await requestOrderRefund(`${userId}__${order.courseId}`);
      setDone(true);
    } catch (cause) {
      setSubmitError(refundErrorKey(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      className="dialog-backdrop fixed inset-0 z-[70] grid place-items-center p-4 outline-none"
      role="dialog"
      aria-modal="true"
      aria-label={t("accountBilling.requestRefund")}
      onClick={busy ? undefined : onClose}
    >
      <div
        className="dialog-panel modal-panel modal-panel-scroll relative"
        onClick={(event) => event.stopPropagation()}
      >
        {/* The X does the same as Cancel (and Done): it disappears while the
            refund request is being sent, when Cancel also locks. */}
        {busy ? null : (
          <button
            type="button"
            onClick={onClose}
            aria-label={t("accountBilling.closeDialog")}
            className="button-icon absolute right-3 top-3"
          >
            <X aria-hidden="true" size={18} />
          </button>
        )}
        {done ? (
          <>
            <div className="p-6">
            <p className="pr-10 text-xs uppercase tracking-[0.22em] text-[var(--color-success-fg)]">
              {t("accountBilling.refundRequested")}
            </p>
            <h2 className="display-title mt-2 pr-10 text-2xl text-[var(--color-primary)]">
              {t("accountBilling.refundReceived")}
            </h2>
            <p className="mt-3 text-sm leading-7 text-[var(--color-ink-soft)]">
              {t("accountBilling.refundFor")} <strong>{order.courseTitle}</strong> {t("accountBilling.refundSubmittedBody")}
            </p>
            </div>
            <div className="dialog-footer">
              <button
                type="button"
                onClick={onClose}
                className="button-solid px-4 py-2 text-sm"
              >
                {t("accountBilling.done")}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="p-6">
            <p className="pr-10 text-xs uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
              {t("accountBilling.refundRequest")}
            </p>
            <h2 className="display-title mt-2 pr-10 text-2xl text-[var(--color-primary)]">
              {t("accountBilling.requestRefund")}.
            </h2>
            <p className="mt-3 text-sm leading-7 text-[var(--color-ink-soft)]">
              {t("accountBilling.refundPolicy")}
            </p>

            <dl className="mt-4 grid gap-px overflow-hidden rounded-md border fine-rule bg-[var(--color-line)]">
              {[
                [t("accountBilling.course"), order.courseTitle],
                [t("accountBilling.purchased"), formatDate(order.paidAt ?? order.createdAt, locale, t("accountBilling.datePending"))],
                [t("accountBilling.amount"), formatMoney(order.amountMinor, order.currency, locale)],
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
              <InlineAlert tone="error" className="mt-4">{t(submitError)}</InlineAlert>
            ) : null}
            </div>

            {/* The app's standard footer: below sm it stacks, the request on top and the
                Cancel at the bottom. */}
            <div className="dialog-footer">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="button-outline px-4 py-2 text-sm"
              >
                {t("accountBilling.cancel")}
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={busy}
                className="button-solid px-4 py-2 text-sm"
              >
                <BusyLabel busy={busy} idle={t("accountBilling.submitRefund")} busyText={t("accountBilling.submitting")} />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function refundErrorKey(error: unknown): string {
  const keys: Record<string, string> = {
    "Enrollment not found.": "notFound",
    "Paid order not found.": "notFound",
    "You can only request refunds for your own enrollments.": "permission",
    "Only paid enrollments can request a refund.": "paidOnly",
    "This enrollment is not eligible for a refund.": "ineligible",
    "Automatic refunds are unavailable after substantial course progress.": "progress",
    "This enrollment already has an issued certificate.": "certificate",
    "A refund was already issued for this course. Contact support for further help.": "previous",
    "The automatic refund window has ended.": "window",
    "This order has no connected account on record. Contact support.": "account",
  };
  return `accountBilling.refundErrors.${error instanceof Error ? keys[error.message] ?? "unknown" : "unknown"}`;
}

// Read errors use the LoadErrorAlert (with "Try again"); here only the neutral notice.
function BillingNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-[var(--color-line-strong)] bg-[var(--color-surface-soft)] p-6 text-sm text-[var(--color-ink-soft)]">
      {children}
    </div>
  );
}

// F-03: each tab loaded in a dashed one-line box ("Loading your
// billing overview...") that later turned into a much taller layout. Now
// blocks in the shape of what is coming, following the profile skeleton pattern: the phrase stays
// for the screen reader, the blocks do not. The pulse stops in the global block of
// "reduce motion".
const skeletonBlock = "bg-[var(--color-surface-strong)]";

function BillingSkeleton({ label, shape }: { label: string; shape: "overview" | "list" | "panel" }) {
  return (
    <div role="status">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="animate-pulse">
        {shape === "overview" ? (
          <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            <div className="grid gap-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-5">
              <div className={`h-3 w-2/5 rounded-sm ${skeletonBlock}`} />
              <div className={`h-8 w-1/2 rounded-md ${skeletonBlock}`} />
              <div className={`mt-2 h-24 rounded-md ${skeletonBlock}`} />
              <div className={`mt-2 h-11 w-2/5 rounded-md ${skeletonBlock}`} />
            </div>
            <div className="grid content-start gap-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
              <div className={`h-3 w-3/5 rounded-sm ${skeletonBlock}`} />
              <div className={`h-3 rounded-sm ${skeletonBlock}`} />
              <div className={`h-3 rounded-sm ${skeletonBlock}`} />
              <div className={`h-3 w-2/3 rounded-sm ${skeletonBlock}`} />
              <div className={`mt-2 h-16 rounded-md ${skeletonBlock}`} />
            </div>
          </div>
        ) : shape === "list" ? (
          <div className="grid gap-3">
            <div className={`h-4 w-28 rounded-sm ${skeletonBlock}`} />
            {[0, 1, 2].map((row) => (
              <div key={row} className={`h-28 rounded-lg ${skeletonBlock}`} />
            ))}
          </div>
        ) : (
          <div className="grid gap-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-5">
            <div className={`h-3 w-1/4 rounded-sm ${skeletonBlock}`} />
            <div className={`h-7 w-1/2 rounded-md ${skeletonBlock}`} />
            <div className={`h-3 w-full max-w-2xl rounded-sm ${skeletonBlock}`} />
            <div className={`mt-2 h-11 w-48 rounded-md ${skeletonBlock}`} />
          </div>
        )}
      </div>
    </div>
  );
}
