import type { ReactNode } from "react";

import { ActivationGate } from "@/components/teacher/activation-gate";
import { AdvisorSidebar } from "@/components/teacher/advisor-sidebar";

// Wraps every /teach route so the floating studio advisor and the activation
// wall are available across the teacher panel. Both self-gate (env flag or
// activation verdict, plus the teacher permission), so this stays a thin mount
// with no auth logic of its own.
export default function TeachLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <AdvisorSidebar />
      <ActivationGate />
    </>
  );
}
