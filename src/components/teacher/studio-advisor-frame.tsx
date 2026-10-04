"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { AdvisorSidebar } from "@/components/teacher/advisor-sidebar";
import { hasAnyPermission } from "@/lib/permissions";

/**
 * Mounts the persistent studio advisor around every /teach page.
 *
 * The studio is open before the one-time activation fee: a creator drafts,
 * uploads and connects Stripe first, and the fee is asked for at the first
 * Publish (publish_teacher_course and the builder's "Activate storefront"
 * link). So there is no wall here any more, only the advisor.
 */
export function StudioAdvisorFrame({ children }: { children?: ReactNode }) {
  const { user } = useAuth();
  const pathname = usePathname();

  // The layout mounts outside each page's ProtectedSurface, so repeat the
  // teacher check: a learner who lands on /teach gets the page's refusal, not
  // an advisor for a studio they cannot use.
  const isTeacher = Boolean(
    user && hasAnyPermission({ roles: user.roles }, ["teacherStudio.access"]),
  );
  // Checkout, its Stripe return leg and verification are single-purpose pages.
  const outsideStudio = pathname === "/teach/activate"
    || pathname?.startsWith("/teach/activate/") === true
    || pathname === "/teach/verification";
  if (!isTeacher || outsideStudio) return children;

  // Keyed by account: a different sign-in must not inherit another advisor's
  // conversation. Ordinary navigation keeps the mounted advisor and its draft.
  return <AdvisorSidebar key={user?.uid}>{children}</AdvisorSidebar>;
}
