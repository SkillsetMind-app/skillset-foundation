"use client";

import Link from "next/link";
import { useSyncExternalStore, type ReactNode } from "react";

import { uuidPattern } from "@/lib/uuid";

// The course being published rides in this tab, not in Stripe: an open
// activation session is reused across courses and its idempotency key must not
// vary, so its return URL cannot name a course.
const RETURN_COURSE_KEY = "skillset.activation.returnCourse";

/** Called by the checkout panel before Stripe can redirect; null forgets. */
export function rememberActivationReturnCourse(courseId: string | null) {
  try {
    if (courseId) sessionStorage.setItem(RETURN_COURSE_KEY, courseId);
    else sessionStorage.removeItem(RETURN_COURSE_KEY);
  } catch {
    // Storage blocked: the return link falls back to /teach.
  }
}

function readReturnCourse(): string | null {
  try {
    const id = sessionStorage.getItem(RETURN_COURSE_KEY);
    return id && uuidPattern.test(id) ? id : null;
  } catch {
    return null;
  }
}

const noSubscription = () => () => {};

/** "Back to your course" after checkout: the remembered course, else /teach. */
export function ActivationReturnLink({ className, children }: { className?: string; children: ReactNode }) {
  const courseId = useSyncExternalStore(noSubscription, readReturnCourse, () => null);
  return (
    <Link
      href={courseId ? `/teach/builder?courseId=${courseId}&tab=review` : "/teach"}
      className={className}
    >
      {children}
    </Link>
  );
}
