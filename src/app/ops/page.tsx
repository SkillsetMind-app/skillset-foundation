import { ProtectedSurface } from "@/components/auth/protected-surface";
import { OpsDashboard } from "@/components/admin/ops-dashboard";
import { RoleManager } from "@/components/admin/role-manager";
import { ViewAsSwitcher } from "@/components/admin/view-as";
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
        {/* Estes três cards eram 376x180 cada, com borda, sombra e fundo — os
            três sinais de card clicável — e nenhum link dentro: pura decoração
            prometendo uma interação que não existe. Junto com o título, comiam
            77% da primeira dobra (a primeira aba de trabalho começava a 522px
            de 674px de viewport), então quem OPERA a plataforma rolava para
            alcançar a ferramenta, todo dia.

            Viram uma linha de legenda: o mesmo conteúdo, sem fingir que clica e
            sem empurrar a fila de trabalho para fora da tela. */}
        <p className="text-sm leading-7 text-[var(--color-ink-soft)]">
          {opsCards.map((card, index) => (
            <span key={card.title}>
              {index > 0 ? " · " : ""}
              <strong className="font-semibold text-[var(--color-ink)]">
                {card.title}
              </strong>
              {": "}
              {card.description}
            </span>
          ))}
        </p>
        <OpsDashboard />
        {/* Access levels. Sits behind the same platform.accessAdmin gate as
            the rest of this page; the database gates every write again on
            its own, so the surface alone grants nothing. */}
        <div className="mt-8">
          <h2 className="display-title text-3xl leading-none text-[var(--color-ink)]">
            Access levels
          </h2>
          <p className="mt-3 text-sm leading-7 text-[var(--color-ink-soft)]">
            Who can do what on the platform, and who holds each level.
          </p>
          <div className="mt-5 space-y-5">
            <ViewAsSwitcher />
            <RoleManager />
          </div>
        </div>
      </PlatformShell>
    </ProtectedSurface>
  );
}
