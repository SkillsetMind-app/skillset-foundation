"use client";

import { useEffect, useState } from "react";

import type { CommunityReport } from "@/domain/community-report";
import type { SupportTicket } from "@/domain/support-ticket";
import type { TeacherCourse } from "@/domain/teacher-course";
import { subscribeToCommunityReports } from "@/lib/data/community-posts";
import { subscribeToAdminSupportTickets } from "@/lib/data/support-tickets";
import { subscribeToCoursesInReview } from "@/lib/data/teacher-courses";

export function OpsOverviewMetrics() {
  const [courses, setCourses] = useState<TeacherCourse[]>([]);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [reports, setReports] = useState<CommunityReport[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    try {
      return subscribeToCoursesInReview(
        (nextCourses) => {
          setCourses(nextCourses);
          setIsLoading(false);
        },
        () => setIsLoading(false),
      );
    } catch (error) {
      // Data layer unavailable (e.g. Firebase not initialized): degrade to an
      // empty state instead of crashing the whole ops surface. Deliberate
      // one-shot recovery reset.
      console.warn(
        "OpsOverviewMetrics: courses-in-review subscription unavailable",
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
        "OpsOverviewMetrics: support tickets subscription unavailable",
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
        "OpsOverviewMetrics: community reports subscription unavailable",
        error,
      );
    }
  }, []);

  const coursesInReview = courses.length;
  const openTickets = tickets.filter(
    (ticket) => ticket.status !== "resolved",
  ).length;
  const openReports = reports.filter(
    (report) => report.status === "open",
  ).length;

  const cards = [
    {
      label: "Courses in review",
      value: String(coursesInReview),
      hint: "Awaiting a SkillsetMind decision",
    },
    {
      label: "Open support tickets",
      value: String(openTickets),
      hint: "Open or in review",
    },
    {
      label: "Pending reports",
      value: String(openReports),
      hint: "Community reports to triage",
    },
  ];

  return (
    <section className="grid gap-4 sm:grid-cols-3">
      {cards.map((card) => (
        <div
          key={card.label}
          className="rounded-[14px] border border-[var(--color-line)] bg-white p-5 shadow-[var(--shadow-soft)]"
        >
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-ink-muted)]">
            {card.label}
          </p>
          {isLoading ? (
            <div className="mt-3 h-8 w-16 animate-pulse rounded bg-[var(--color-surface-strong)]" />
          ) : (
            <p className="mt-2 text-3xl font-bold text-[var(--color-primary)]">
              {card.value}
            </p>
          )}
          <p className="mt-2 text-xs leading-5 text-[var(--color-ink-soft)]">
            {card.hint}
          </p>
        </div>
      ))}
    </section>
  );
}
