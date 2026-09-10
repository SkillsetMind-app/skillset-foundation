"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { startTransition, useEffect, useMemo, useRef, useState } from "react";

import { PlansPanel } from "@/components/account/plans-panel";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { useAuth } from "@/components/auth/auth-provider";
import { HorizontalTabs } from "@/components/shared/horizontal-tabs";
import { StatusChip } from "@/components/shared/status-chip";
import { planById, type PlanId } from "@/data/plans";
import type { Order } from "@/domain/order";
import type { UserProfile } from "@/domain/user-profile";
import { subscribeToUserOrders } from "@/lib/data/orders";
import { subscribeToUserProfile } from "@/lib/data/user-profiles";
import { useModalFocus } from "@/lib/a11y/use-modal-focus";
import { toDate } from "@/lib/format-date";
import { openBillingPortal, requestOrderRefund } from "@/lib/payments/billing";

const billingTabs = [
  { value: "overview", label: "Overview" },
  { value: "purchases", label: "Purchases" },
  { value: "payment-methods", label: "Payment methods" },
  { value: "subscriptions", label: "Subscription" },
];

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
        setError("accountBilling.purchasesError");
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
        tabs={billingTabs.map((tab) => ({ ...tab, label: t(`accountBilling.tabs.${tab.value}`) }))}
        activeValue={activeTab}
        onChange={handleTabChange}
        ariaLabel={t("accountBilling.sections")}
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
  const { t, locale } = useTranslation();
  // Wait on the profile too, so the plan/portal block never renders a default
  // "Free" from a not-yet-loaded profile during the orders-vs-profile race.
  if (authResolving || isLoading || profileStatus === "loading") {
    return <BillingNotice>{t("accountBilling.loadingOverview")}</BillingNotice>;
  }

  if (!isSignedIn) {
    return <BillingNotice>{t("accountBilling.signInOverview")}</BillingNotice>;
  }

  if (error) {
    return <BillingNotice tone="error">{t(error)}</BillingNotice>;
  }

  const { courseCount, refundCount, spentMinor, currency } =
    summarisePurchases(orders);
  // Profile listener failed: we don't know the plan, so show it as unknown
  // rather than asserting "Free" (which would misstate a paying user's plan).
  const profileFailed = profileStatus === "error";
  const planId: PlanId = profile?.currentPlanId ?? "free";
  const planName = profileFailed ? t("accountBilling.unavailable") : planById(planId).name;
  const hasCustomer = Boolean(profile?.stripeCustomerId);

  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      {/* Lifetime summary */}
      <div className="rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-5">
        <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
          {t("accountBilling.lifetimeSpend")}
        </p>
        <p className="display-title mt-2 text-4xl text-[var(--color-primary)]">
          {formatMoney(spentMinor, currency, locale)}
        </p>
        <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
          {t(courseCount === 1 ? "accountBilling.coursePurchased" : "accountBilling.coursesPurchased").replace("{count}", () => String(courseCount))}
          {profileFailed ? "" : ` · ${t("accountBilling.planSubscription").replace("{plan}", () => planName)}`}
        </p>

        <dl className="mt-5 grid gap-px overflow-hidden rounded-[10px] border fine-rule bg-[var(--color-line)]">
          {[
            [t("accountBilling.coursesLabel"), String(courseCount)],
            [t("accountBilling.subscriptionLabel"), planName],
            [t("accountBilling.refunds"), String(refundCount)],
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
          {t("accountBilling.seePurchases")} &rarr;
        </button>
      </div>

      {/* Payments & invoices via Stripe */}
      <div className="rounded-[14px] border border-[var(--color-line)] bg-white p-5">
        <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
          {t("accountBilling.paymentsInvoices")}
        </p>
        <p className="mt-2 text-sm leading-7 text-[var(--color-ink-soft)]">
          {t("accountBilling.portalBody")}
        </p>
        {hasCustomer ? (
          <PortalButton label={t("accountBilling.openPortal")} />
        ) : (
          <p className="mt-3 rounded-[10px] border fine-rule bg-[var(--color-surface-soft)] px-4 py-3 text-sm leading-6 text-[var(--color-ink-soft)]">
            {t(profileFailed ? "accountBilling.detailsError" : "accountBilling.portalAfterPurchase")}
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
    return <BillingNotice>{t("accountBilling.loadingMethods")}</BillingNotice>;
  }

  if (!isSignedIn) {
    return <BillingNotice>{t("accountBilling.signInMethods")}</BillingNotice>;
  }

  const hasCustomer = Boolean(profile?.stripeCustomerId);

  return (
    <div className="rounded-[14px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-5">
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
        <p className="mt-3 rounded-[10px] border fine-rule bg-white px-4 py-3 text-sm leading-6 text-[var(--color-ink-soft)]">
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
        className="button-outline px-4 py-2 text-sm disabled:opacity-60"
      >
        {busy ? t("accountBilling.openingStripe") : label}
      </button>
      {portalError ? (
        <p
          role="alert"
          className="mt-3 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]"
        >
          {t(portalError)}
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
  const { t, locale } = useTranslation();
  const [refundFor, setRefundFor] = useState<Order | null>(null);

  if (authResolving) {
    return <BillingNotice>{t("accountBilling.loadingPurchases")}</BillingNotice>;
  }

  if (!isSignedIn) {
    return <BillingNotice>{t("accountBilling.signInPurchases")}</BillingNotice>;
  }

  if (isLoading) {
    return <BillingNotice>{t("accountBilling.loadingPurchases")}</BillingNotice>;
  }

  if (error) {
    return <BillingNotice tone="error">{t(error)}</BillingNotice>;
  }

  // Empty state ONLY when the query genuinely returned zero rows — no
  // client-side filtering hides real orders here.
  if (orders.length === 0) {
    return (
      <BillingEmptyState
        eyebrow={t("accountBilling.tabs.purchases")}
        title={t("accountBilling.noPurchases")}
        detail={t("accountBilling.noPurchasesBody")}
        statusLabel={t("accountBilling.empty")}
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
      <p className="rounded-[10px] border fine-rule bg-[var(--color-surface-soft)] px-4 py-3 text-xs leading-6 text-[var(--color-ink-soft)]">
        {t("accountBilling.sellerBody")}
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
                  {formatDate(order.paidAt ?? order.createdAt, locale, t("accountBilling.datePending"))}
                </p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <span className="rounded-[8px] bg-white px-3 py-1 text-sm font-bold text-[var(--color-primary)]">
                  {formatMoney(order.amountMinor, order.currency, locale)}
                </span>
                <div className="flex flex-wrap items-center justify-end gap-3">
                  {order.receiptUrl ? (
                    <a
                      href={order.receiptUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs font-semibold text-[var(--color-primary)] hover:underline"
                    >
                      {t("accountBilling.receipt")} &rarr;
                    </a>
                  ) : null}
                  {order.status === "paid" && userId ? (
                    <button
                      type="button"
                      onClick={() => setRefundFor(order)}
                      className="text-xs font-semibold text-[var(--color-accent-fg)] hover:underline"
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
  // Este era o único diálogo do app que declarava `aria-modal="true"` e não
  // gerenciava foco nenhum. `aria-modal` promete ao leitor de tela que o resto
  // da página está inerte, e aqui a promessa era falsa nas três frentes: o foco
  // ficava no botão atrás do modal, Tab caminhava para a página escondida, e
  // Escape não fechava. Numa ação de DINHEIRO, a única saída era acertar o
  // "Cancel" com o mouse.
  //
  // A hook já existia em @/lib/a11y — os outros sete diálogos a usam. Faltava
  // só este.
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocus(dialogRef, true);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

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
      setSubmitError(refundErrorKey(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      className="fixed inset-0 z-50 grid place-items-center bg-[rgba(7,9,13,0.55)] p-4 outline-none"
      role="dialog"
      aria-modal="true"
      aria-label={t("accountBilling.requestRefund")}
      onClick={onClose}
    >
      <div
        className="modal-panel modal-panel-scroll w-full max-w-md rounded-[16px] border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-strong)]"
        onClick={(event) => event.stopPropagation()}
      >
        {done ? (
          <>
            <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-success-fg)]">
              {t("accountBilling.refundRequested")}
            </p>
            <h2 className="display-title mt-2 text-2xl text-[var(--color-primary)]">
              {t("accountBilling.refundReceived")}
            </h2>
            <p className="mt-3 text-sm leading-7 text-[var(--color-ink-soft)]">
              {t("accountBilling.refundFor")} <strong>{order.courseTitle}</strong> {t("accountBilling.refundSubmittedBody")}
            </p>
            <div className="mt-6 flex justify-end">
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
            <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
              {t("accountBilling.refundRequest")}
            </p>
            <h2 className="display-title mt-2 text-2xl text-[var(--color-primary)]">
              {t("accountBilling.requestRefund")}.
            </h2>
            <p className="mt-3 text-sm leading-7 text-[var(--color-ink-soft)]">
              {t("accountBilling.refundPolicy")}
            </p>

            <dl className="mt-4 grid gap-px overflow-hidden rounded-[10px] border fine-rule bg-[var(--color-line)]">
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
              <p
                role="alert"
                className="mt-4 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]"
              >
                {t(submitError)}
              </p>
            ) : null}

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="button-outline px-4 py-2 text-sm disabled:opacity-60"
              >
                {t("accountBilling.cancel")}
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={busy}
                className="button-solid px-4 py-2 text-sm disabled:opacity-60"
              >
                {t(busy ? "accountBilling.submitting" : "accountBilling.submitRefund")}
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
