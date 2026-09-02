"use client";

import { useEffect, useState } from "react";

import type { CommunityReport } from "@/domain/community-report";
import type { CreatorVerificationCase } from "@/domain/creator-verification";
import type { SupportTicket } from "@/domain/support-ticket";
import { subscribeToCommunityReports } from "@/lib/data/community-posts";
import { subscribeToVerificationQueue } from "@/lib/data/creator-verification";
import { subscribeToAdminSupportTickets } from "@/lib/data/support-tickets";

export type OpsQueueCounts = {
  isLoading: boolean;
  pendingVerifications: number;
  openTickets: number;
  openReports: number;
};

// Os três números que eram três cartões de métrica entre as abas e o conteúdo.
// Eles não mudavam com a aba, então interrompiam o caminho entre a aba escolhida
// e a fila dela. Viraram contadores ao lado do nome de cada fila — mesma fonte,
// mesmas regras (pendente = na fila; ticket aberto = não resolvido; report
// aberto = status "open").
export function useOpsQueueCounts(): OpsQueueCounts {
  const [verificationCases, setVerificationCases] = useState<CreatorVerificationCase[]>([]);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [reports, setReports] = useState<CommunityReport[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    try {
      return subscribeToVerificationQueue(
        (nextCases) => {
          setVerificationCases(nextCases);
          setIsLoading(false);
        },
        () => setIsLoading(false),
      );
    } catch (error) {
      // Data layer unavailable (e.g. Supabase client not configured): degrade to an
      // empty state instead of crashing the whole ops surface. Deliberate
      // one-shot recovery reset.
      console.warn(
        "useOpsQueueCounts: creator-verification subscription unavailable",
        error,
      );
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    try {
      return subscribeToAdminSupportTickets(setTickets, () => {});
    } catch (error) {
      // Non-blocking metric: degrade silently in the UI but keep the failure
      // visible in logs.
      console.warn(
        "useOpsQueueCounts: support tickets subscription unavailable",
        error,
      );
    }
  }, []);

  useEffect(() => {
    try {
      return subscribeToCommunityReports(setReports, () => {});
    } catch (error) {
      // Non-blocking metric: degrade silently in the UI but keep the failure
      // visible in logs.
      console.warn(
        "useOpsQueueCounts: community reports subscription unavailable",
        error,
      );
    }
  }, []);

  return {
    isLoading,
    pendingVerifications: verificationCases.length,
    openTickets: tickets.filter((ticket) => ticket.status !== "resolved").length,
    openReports: reports.filter((report) => report.status === "open").length,
  };
}
