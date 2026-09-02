import { ProtectedSurface } from "@/components/auth/protected-surface";
import { OpsDashboard } from "@/components/admin/ops-dashboard";
import { PlatformShell } from "@/components/platform/platform-shell";

// Uma página de trabalho abria como página de marketing: sobretítulo, frase de
// efeito de 48px em serifa, subtítulo e uma legenda de três definições — a
// primeira fila começava a ~350px do topo, para quem entra todo dia para tratar
// filas. Título compacto e a fila logo abaixo. "Access levels" (papéis + ver
// como) deixou de ser um segundo modelo de navegação no fim da página: virou a
// oitava fila, dentro das abas, com endereço próprio.
export default function OpsPage() {
  return (
    <ProtectedSurface permissions={["platform.accessAdmin"]}>
      <PlatformShell title="Operations" compact>
        <OpsDashboard />
      </PlatformShell>
    </ProtectedSurface>
  );
}
