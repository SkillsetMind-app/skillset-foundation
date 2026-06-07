import { Suspense } from "react";
import Link from "next/link";

import { EmbeddedCheckoutPanel } from "@/components/account/embedded-checkout-panel";
import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import type { PlanBillingCycle, PlanId } from "@/data/plans";

type SearchParamValue = string | string[] | undefined;

type UpgradePageProps = {
  searchParams?: Promise<Record<string, SearchParamValue>>;
};

function firstParam(value: SearchParamValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parsePlanId(value: string | undefined): Exclude<PlanId, "free"> | null {
  if (value === "starter" || value === "pro" || value === "plus") return value;
  return null;
}

function parseCycle(value: string | undefined): PlanBillingCycle {
  return value === "yearly" ? "yearly" : "monthly";
}

export default async function BillingUpgradePage({
  searchParams,
}: UpgradePageProps) {
  const params = (await searchParams) ?? {};
  const planId = parsePlanId(firstParam(params.plan));
  const cycle = parseCycle(firstParam(params.cycle));

  return (
    <ProtectedSurface permissions={["auth.signOut"]}>
      <PlatformShell title="Upgrade your plan" compact>
        {planId ? (
            <Suspense
              fallback={
                <div className="rounded-[4px] border fine-rule bg-white p-8 text-sm text-[var(--color-ink-soft)] shadow-[var(--shadow-soft)]">
                  Preparing secure checkout…
                </div>
              }
            >
              <EmbeddedCheckoutPanel planId={planId} cycle={cycle} />
            </Suspense>
        ) : (
          <MissingPlanState />
        )}
      </PlatformShell>
    </ProtectedSurface>
  );
}

function MissingPlanState() {
  return (
    <div className="rounded-[4px] border border-dashed border-[var(--color-line-strong)] bg-[var(--color-surface-soft)] p-8 text-center">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
        Pick a plan first
      </p>
      <h2 className="display-title mt-3 text-3xl text-[var(--color-primary)]">
        No plan selected.
      </h2>
      <p className="mx-auto mt-3 max-w-md text-sm leading-7 text-[var(--color-ink-soft)]">
        Choose a plan from the plans page and we&apos;ll bring the embedded
        checkout right here.
      </p>
      <Link
        href="/account/billing?tab=subscriptions"
        className="button-solid mt-5 inline-flex px-5 py-3 text-sm"
      >
        See plans
      </Link>
    </div>
  );
}
