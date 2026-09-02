import { PlansPanel } from "@/components/account/plans-panel";
import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { refundWindowDays } from "@/data/plans";

export default function AccountPlansPage() {
  return (
    <ProtectedSurface permissions={["auth.signOut"]}>
      {/* O cartão de abertura ("Pricing model / Choose the plan that fits…")
          era a segunda manchete da página, antes de "Current plan" virar a
          terceira. A página abre no que importa: o plano atual e os cartões.
          A frase de que todo plano inclui tudo foi para a descrição do título. */}
      <PlatformShell
        title="Plans & fees"
        description="Every plan includes every SkillsetMind feature. Paid plans lower the platform commission; checkout and changes go through Stripe."
        compact
      >
        <section className="grid gap-5">
          <PlansPanel />

          <div className="grid gap-4 lg:grid-cols-3">
            <PolicyCard
              title="Stripe processing"
              detail="Stripe processing is separate from SkillsetMind commission and appears in the creator ledger per transaction."
            />
            <PolicyCard
              title="Refund window"
              detail={`Learners can refund a purchase within ${refundWindowDays} days if they've completed less than half the course and no certificate has been issued — once per course.`}
            />
            <PolicyCard
              title="Payouts"
              detail="Buyers pay your Stripe account directly. There is no platform hold — Stripe then settles and pays out to your bank on its own timing, which depends on your country and the payment method."
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
