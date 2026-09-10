import type { ReactNode } from "react";

import { ActivationGate } from "@/components/teacher/activation-gate";

// Wraps every /teach route so the persistent studio advisor and the activation
// wall are available across the teacher panel. Activation comes first: neither
// the studio nor its advisor mounts until the shared verdict permits access.
export default function TeachLayout({ children }: { children: ReactNode }) {
  return (
    <ActivationGate>
      {children}
    </ActivationGate>
  );
}
