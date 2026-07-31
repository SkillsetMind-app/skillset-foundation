import Link from "next/link";

import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";

/**
 * Post-checkout landing. Deliberately does NOT decide whether the fee is paid:
 * the Stripe webhook stamps `users.activation_fee_paid_at` and the SQL publish
 * gate reads that column, so reporting success from a return URL a creator can
 * type by hand would be a lie the database might not agree with.
 */
export default function TeachActivateReturnPage() {
  return (
    <ProtectedSurface permissions={["teacherStudio.access"]}>
      <PlatformShell title="Storefront activation" compact>
        <div className="rounded-[14px] border fine-rule bg-white p-8 shadow-[var(--shadow-soft)]">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
            Thanks
          </p>
          <h2 className="display-title mt-3 text-3xl text-[var(--color-primary)]">
            We&apos;re confirming your payment.
          </h2>
          <p className="mt-3 max-w-lg text-sm leading-7 text-[var(--color-ink-soft)]">
            Stripe confirms activation to us in the background — it is usually
            instant. Head back to your course and publish. If publishing still
            asks for the fee, wait a moment and try once more.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link href="/teach/builder" className="button-solid px-4 py-2.5 text-sm">
              Back to course studio
            </Link>
            <Link href="/support" className="button-outline px-4 py-2.5 text-sm">
              Contact support
            </Link>
          </div>
        </div>
      </PlatformShell>
    </ProtectedSurface>
  );
}
