import { ProtectedSurface } from "@/components/auth/protected-surface";
import { OpsDashboard } from "@/components/admin/ops-dashboard";
import { PlatformShell } from "@/components/platform/platform-shell";

const opsCards = [
  {
    title: "Professional verification",
    description: "Resolve credential exceptions and appeals before a professional can publish.",
  },
  {
    title: "Marketplace compliance",
    description: "Triage reports and monitor published programs without delaying legitimate launches.",
  },
  {
    title: "Learner support",
    description: "Keep account questions, learner care, and support requests organized in one place.",
  },
];

export default function OpsPage() {
  return (
    <ProtectedSurface permissions={["platform.accessAdmin"]}>
      <PlatformShell
        eyebrow="Support and safety"
        title="A calm operations layer behind the learning experience."
        description="Professional verification, marketplace compliance, and learner support keep the platform trustworthy as it grows."
      >
        <div className="grid gap-5 lg:grid-cols-3">
          {opsCards.map((card) => (
            <div key={card.title} className="rounded-[14px] border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-soft)]">
              <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
                Platform controls
              </p>
              <h3 className="display-title mt-3 text-3xl leading-none text-[var(--color-ink)]">
                {card.title}
              </h3>
              <p className="mt-4 text-sm leading-7 text-[var(--color-ink-soft)]">
                {card.description}
              </p>
            </div>
          ))}
        </div>
        <OpsDashboard />
      </PlatformShell>
    </ProtectedSurface>
  );
}
