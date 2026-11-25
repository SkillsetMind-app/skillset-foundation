"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CircleCheck, Info } from "lucide-react";

import { PaymentReturnCard } from "@/components/account/payment-return-card";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { SpinnerRing } from "@/components/shared/skillset-spinner";
import { buttonClasses } from "@/components/ui/button";
import { PLAN_TRIAL_DAYS } from "@/data/plans";
import { fetchPlanBillingState, type PlanSubscriptionView } from "@/lib/payments/billing";
import { formatTrialDate } from "@/lib/payments/plan-disclosure";

// Whoever had just entered their card landed on "Review your subscription status." and
// a single "Back to billing" button: nothing said the free trial had started
// nor led back to the studio. The screen now asks the server (the same
// read as the Billing page, fed by the Stripe webhook) and confirms.
// The reference in the URL still proves nothing: the subscription is what confirms.
const POLL_MS = 3000;
// ~45 s. The webhook usually arrives in a few seconds; past that, the screen
// goes back to the old text ("check in Billing") instead of spinning forever.
const MAX_TRIES = 15;

export function BillingReturnStatus() {
  const { t, locale } = useTranslation();
  const [subscription, setSubscription] = useState<PlanSubscriptionView | null>(null);
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function check() {
      tries += 1;
      try {
        const state = await fetchPlanBillingState();
        if (cancelled) return;
        const status = state.subscription?.status;
        if (state.subscription && (status === "trialing" || status === "active")) {
          setSubscription(state.subscription);
          return;
        }
      } catch {
        // The read failed (network, session): tries again up to the limit.
      }
      if (cancelled) return;
      if (tries >= MAX_TRIES) {
        setGaveUp(true);
        return;
      }
      timer = setTimeout(check, POLL_MS);
    }

    void check();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  // The studio button only exists after confirmation. While waiting or with no
  // answer, the way out is Billing (and support, when the confirmation did not arrive):
  // nothing here may look confirmed.
  const backToBilling = (variant: "solid" | "outline") => (
    <Link href="/account/billing?tab=overview" className={buttonClasses({ variant })}>
      {t("billingCheckout.backToBilling")}
    </Link>
  );

  const trialing = subscription?.status === "trialing" && Boolean(subscription.trialEnd);
  const confirmed = Boolean(subscription);

  const heading = confirmed
    ? trialing
      ? t("billingCheckout.trialStarted").replace("{days}", () => String(PLAN_TRIAL_DAYS))
      : t("billingCheckout.planActive")
    : gaveUp
      ? t("billingCheckout.returnHeading")
      : t("billingCheckout.confirming");
  const body = confirmed
    ? trialing && subscription?.trialEnd
      ? t("billingCheckout.trialStartedBody").replace("{date}", () =>
          formatTrialDate(new Date(subscription.trialEnd as string), locale))
      : t("billingCheckout.planActiveBody")
    : gaveUp
      ? t("billingCheckout.returnBody")
      : t("billingCheckout.confirmingBody");

  // The live region is a single one across the three states (it lives in the card): swapping the
  // element on each state made the announcement of the result get lost.
  return (
    <PaymentReturnCard
      icon={confirmed ? (
        <CircleCheck aria-hidden="true" size={20} className="text-[var(--color-success-fg)]" />
      ) : gaveUp ? (
        <Info aria-hidden="true" size={20} />
      ) : (
        <SpinnerRing size="sm" />
      )}
      heading={heading}
      body={body}
      actions={confirmed ? (
        <>
          <Link href="/teach" className={buttonClasses({ variant: "solid" })}>
            {t("billingCheckout.openStudio")}
          </Link>
          {backToBilling("outline")}
        </>
      ) : gaveUp ? (
        <>
          {backToBilling("solid")}
          <Link href="/support" className={buttonClasses({ variant: "outline" })}>
            {t("billingCheckout.support")}
          </Link>
        </>
      ) : (
        backToBilling("outline")
      )}
    />
  );
}
