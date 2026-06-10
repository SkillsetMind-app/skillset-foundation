import { PlansPanel } from "@/components/account/plans-panel";
import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { payoutClearDays, refundWindowDays } from "@/data/plans";

export default function AccountPlansPage() {
  return (
    <ProtectedSurface permissions={["auth.signOut"]}>
      <PlatformShell
        title="Plans & fees"
        description="Choose a plan, check out securely through Stripe, manage your subscription, and review platform fees."
        compact
      >
        <section className="grid gap-5">
          <div className="platform-hero-card rounded-[18px] border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-soft)]">
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
              Pricing model
            </p>
            <h2 className="display-title mt-3 text-3xl text-[var(--color-primary)] sm:text-4xl">
              Choose the plan that fits your course business.
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-[var(--color-ink-soft)]">
              Every plan includes every Skillset feature. Paid plans lower
              the platform commission, and you check out through Stripe
              without leaving this page.
            </p>
          </div>

          <PlansPanel />

          <div className="grid gap-4 lg:grid-cols-3">
            <PolicyCard
              title="Stripe processing"
              detail="Stripe processing is separate from Skillset commission and appears in the creator ledger per transaction."
            />
            <PolicyCard
              title="Refund window"
              detail={`Learners can refund a purchase within ${refundWindowDays} days if they've completed less than half the course.`}
            />
            <PolicyCard
              title="Payout clearance"
              detail={`Your earnings move from pending to available ${payoutClearDays} days after each sale — well past the ${refundWindowDays}-day refund window.`}
            />
          </div>
        </section>
      </PlatformShell>
    </ProtectedSurface>
  );
}

function PolicyCard({ detail, title }: { detail: string; title: string }) {
  return (
    <article className="rounded-[16px] border border-[var(--color-line)] bg-white p-5 shadow-[var(--shadow-soft)]">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
        {title}
      </p>
      <p className="mt-3 text-sm leading-7 text-[var(--color-ink-soft)]">
        {detail}
      </p>
    </article>
  );
}
