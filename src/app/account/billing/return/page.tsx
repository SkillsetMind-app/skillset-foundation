import Link from "next/link";
import { Clock } from "lucide-react";

import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { getServerTranslation } from "@/lib/i18n/server";

type SearchParamValue = string | string[] | undefined;

type BillingReturnPageProps = {
  searchParams?: Promise<Record<string, SearchParamValue>>;
};

function firstParam(value: SearchParamValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Stripe's embedded Checkout redirects to this URL after a completed
 * session, appending ?session_id=… The customer.subscription.created
 * webhook updates the profile's currentPlanId asynchronously, so by the
 * time the user lands here the plan change is usually — but not always —
 * already applied. A session_id in the URL is NOT proof of payment. This page
 * only reports pending confirmation; the webhook remains authoritative.
 *
 * TODO(posthog): emit CHECKOUT_COMPLETED here once we expose a backend
 * endpoint to resolve the Stripe session_id → order doc (order_id,
 * gross_minor, platform_fee_bps, platform_fee_minor). We deliberately
 * DO NOT track the event here without those fields: platform_fee_bps is
 * the C1-leak detector — its absence makes the event noise. The richer
 * server-side capture should land in functions/src/index.ts inside the
 * customer.subscription.created webhook handler.
 */
export default async function BillingReturnPage({
  searchParams,
}: BillingReturnPageProps) {
  const { t } = await getServerTranslation();
  const params = (await searchParams) ?? {};
  const sessionId = firstParam(params.session_id);
  const hasSessionReference = Boolean(sessionId);

  return (
    <ProtectedSurface permissions={["auth.signOut"]}>
      <PlatformShell title={t("billingCheckout.returnTitle")} compact>
        {hasSessionReference ? (
          <div className="rounded-[14px] border fine-rule bg-white p-10 text-center shadow-[var(--shadow-soft)]">
            <div className="mx-auto grid size-12 place-items-center rounded-full bg-[var(--color-primary)] text-[var(--color-base)]">
              <Clock aria-hidden="true" size={24} strokeWidth={2.4} />
            </div>
            <h2 className="display-title mt-5 text-3xl text-[var(--color-primary)]">
              {t("billingCheckout.confirming")}
            </h2>
            <p className="mx-auto mt-3 max-w-md text-sm leading-7 text-[var(--color-ink-soft)]">
              {t("billingCheckout.returnBody")}
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link
                href="/account/billing?tab=subscriptions"
                className="button-outline px-4 py-2.5 text-sm"
              >
                {t("billingCheckout.backToBilling")}
              </Link>
              <Link href="/teach" className="button-solid px-4 py-2.5 text-sm">
                {t("billingCheckout.openStudio")}
              </Link>
            </div>
          </div>
        ) : (
          <div className="rounded-[14px] border border-dashed border-[var(--color-line-strong)] bg-[var(--color-surface-soft)] p-8 text-center">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
              {t("billingCheckout.nothingToConfirm")}
            </p>
            <h2 className="display-title mt-3 text-3xl text-[var(--color-primary)]">
              {t("billingCheckout.noCheckout")}
            </h2>
            <p className="mx-auto mt-3 max-w-md text-sm leading-7 text-[var(--color-ink-soft)]">
              {t("billingCheckout.noCheckoutBody")}
            </p>
            <Link
              href="/account/billing?tab=subscriptions"
              className="button-solid mt-5 inline-flex px-4 py-2.5 text-sm"
            >
              {t("billingCheckout.goToBilling")}
            </Link>
          </div>
        )}
      </PlatformShell>
    </ProtectedSurface>
  );
}
