import type { ReactNode } from "react";

import { AdvisorSidebar } from "@/components/teacher/advisor-sidebar";

// Wraps every /teach route so the floating studio advisor is available across
// the teacher panel. AdvisorSidebar self-gates (env flag + teacher permission),
// so this stays a thin mount with no auth logic of its own.
export default function TeachLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <AdvisorSidebar />
    </>
  );
}
