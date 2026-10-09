"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { hasPermission } from "@/lib/permissions";

/**
 * Os planos sao o que o PROFESSOR paga para vender (mesma regra do /teach).
 * O aluno nao ve "Plans & fees" no menu; se abrir /account/plans pelo
 * endereco, vai para "My purchases", que e o dinheiro dele.
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
