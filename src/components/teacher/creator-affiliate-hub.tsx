"use client";

import Link from "next/link";
import { ArrowRight, Handshake, Plus } from "lucide-react";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { StatusChip } from "@/components/shared/status-chip";
import type { TeacherCourse } from "@/domain/teacher-course";
import { subscribeToTeacherCourses } from "@/lib/data/teacher-courses";

export function CreatorAffiliateHub() {
  const { user } = useAuth();
  const [courses, setCourses] = useState<TeacherCourse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) {
      return;
    }

    return subscribeToTeacherCourses(
      user.uid,
      (nextCourses) => {
        setCourses(nextCourses);
        setIsLoading(false);
      },
      () => {
        setError("We could not load your affiliate programs. Please try again.");
        setIsLoading(false);
      }
    );
  }, [user]);

  return (
    <div className="grid gap-7">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--color-line)] pb-5">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--color-accent-fg)]">
            Partnerships
          </p>
          <h1 className="mt-2 text-3xl font-semibold leading-tight text-[var(--color-primary)]">
            Affiliate programs
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-ink-soft)]">
            Set commission and approval rules independently for each product.
          </p>
        </div>
        <Link href="/teach/builder?newCourse=1" className="button-solid min-h-10 px-4 text-sm">
          <Plus aria-hidden="true" size={16} strokeWidth={2} />
          New product
        </Link>
      </header>

      {error ? (
        <p
          role="alert"
          className="rounded-[8px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-semibold text-[var(--color-danger)]"
        >
          {error}
        </p>
      ) : null}

      <section aria-labelledby="affiliate-products-title">
        <div className="flex items-baseline justify-between gap-3">
          <h2
            id="affiliate-products-title"
            className="text-lg font-semibold text-[var(--color-ink)]"
          >
            Product programs
          </h2>
          {!isLoading ? (
            <span className="text-sm tabular-nums text-[var(--color-ink-muted)]">
              {courses.length}
            </span>
          ) : null}
        </div>

        <div className="mt-4 divide-y divide-[var(--color-line)] border-y border-[var(--color-line)]">
          {isLoading ? (
            [1, 2, 3].map((item) => (
              <div key={item} className="h-20 animate-pulse bg-[var(--color-surface-soft)]" />
            ))
          ) : courses.length === 0 ? (
            <div className="grid place-items-center px-5 py-14 text-center">
              <span className="grid size-11 place-items-center rounded-[8px] border border-[var(--color-line)] bg-white text-[var(--color-primary)]">
                <Handshake aria-hidden="true" size={20} strokeWidth={1.8} />
              </span>
              <h3 className="mt-4 text-lg font-semibold text-[var(--color-ink)]">
                Create a product first
              </h3>
              <p className="mt-2 max-w-md text-sm leading-6 text-[var(--color-ink-soft)]">
                Affiliate terms belong to a specific product and its checkout.
              </p>
            </div>
          ) : (
            courses.map((course) => (
              <article
                key={course.id}
                className="grid gap-3 bg-white px-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:px-4"
              >
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold text-[var(--color-ink)]">
                    {course.title || "Untitled product"}
                  </h3>
                  <p className="mt-1 text-xs text-[var(--color-ink-soft)]">
                    {course.category || "Uncategorized"}
                  </p>
                </div>
                <StatusChip status={course.status} />
                <Link
                  href={`/teach/courses/${encodeURIComponent(course.id)}/manage?section=affiliates`}
                  className="button-outline min-h-9 px-3 text-xs"
                >
                  Configure
                  <ArrowRight aria-hidden="true" size={14} strokeWidth={1.8} />
                </Link>
              </article>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
