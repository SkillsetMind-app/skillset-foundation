import { ProtectedSurface } from "@/components/auth/protected-surface";
import { OpsDashboard } from "@/components/admin/ops-dashboard";

// Authenticate before mounting queue subscriptions. The dashboard resolves
// ?tab= once and supplies the same destination/counts to both sidebar surfaces.
export default function OpsPage() {
  return (
    <ProtectedSurface permissions={["platform.accessAdmin"]}>
      <OpsDashboard />
    </ProtectedSurface>
  );
}
