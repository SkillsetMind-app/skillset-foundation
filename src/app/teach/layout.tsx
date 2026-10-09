import type { ReactNode } from "react";

import SidebarPreferenceLayout from "@/components/platform/sidebar-preference-layout";
import { StudioAdvisorFrame } from "@/components/teacher/studio-advisor-frame";

// Wraps every /teach route so the persistent studio advisor is available
// across the teacher panel. The studio is open before the activation fee; the
// fee is asked for when the creator publishes their first course.
// A barra lateral abre como a pessoa deixou (cookie lido no servidor).
export default function TeachLayout({ children }: { children: ReactNode }) {
  return (
    <SidebarPreferenceLayout>
      <StudioAdvisorFrame>{children}</StudioAdvisorFrame>
    </SidebarPreferenceLayout>
  );
}
