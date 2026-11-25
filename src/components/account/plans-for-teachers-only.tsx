"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { hasPermission } from "@/lib/permissions";

/**
 * Plans are what the TEACHER pays to sell (same rule as /teach).
 * The learner does not see "Plans & fees" in the menu; if they open /account/plans by
 * address, they go to "My purchases", which is their own money.
 */
export function PlansForTeachersOnly({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const router = useRouter();
  const canTeach = hasPermission({ roles: user?.roles ?? [] }, "teacherStudio.access");

  useEffect(() => {
    if (user && !canTeach) router.replace("/account/billing");
  }, [user, canTeach, router]);

  return canTeach ? children : null;
}
