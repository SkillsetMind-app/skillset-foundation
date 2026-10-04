import type { ReactNode } from "react";

import { StudioAdvisorFrame } from "@/components/teacher/studio-advisor-frame";

// Wraps every /teach route so the persistent studio advisor is available
// across the teacher panel. The studio is open before the activation fee; the
// fee is asked for when the creator publishes their first course.
export default function TeachLayout({ children }: { children: ReactNode }) {
  return <StudioAdvisorFrame>{children}</StudioAdvisorFrame>;
}
