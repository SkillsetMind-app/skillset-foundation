"use client";

import { useEffect, useState } from "react";

import { getOpenCommunityQuestions } from "@/lib/data/community-posts";
import { countThreadsAwaitingTeacher } from "@/lib/data/course-messages";
import { getMyCourseSummaries } from "@/lib/data/teacher-courses";

export type TeacherInbox = {
  courses: Awaited<ReturnType<typeof getMyCourseSummaries>>;
  /** Ids of the unanswered questions, only from communities that are ON. */
  questions: string[];
  /** Conversations where the learner spoke last; null if the read failed. */
  threads: number | null;
};

const inFlight = new Map<string, Promise<TeacherInbox>>();

/**
  * What is waiting for the teacher, read ONCE at a time: on the Inbox page the shell
  * (the bar number) and the question list ask at the same time and share the
  * same read. A course with the community turned off is left out: the learner has
  * nowhere to ask, and the teacher has nowhere to answer.
 *
  * ponytail: only merges simultaneous requests, no cache; each page reads again.
  * If the cost per click gets heavy, the upgrade is to keep the result for a minute.
 */
export function loadTeacherInbox(teacherId: string): Promise<TeacherInbox> {
  const pending = inFlight.get(teacherId);
  if (pending) return pending;

  const load = (async () => {
    const courses = await getMyCourseSummaries(teacherId);
    const withCommunity = courses.filter((course) => course.communityEnabled).map((course) => course.id);
    const [questions, threads] = await Promise.all([
      getOpenCommunityQuestions(withCommunity, teacherId),
      countThreadsAwaitingTeacher(teacherId).catch(() => null),
    ]);
    return { courses, questions, threads };
  })().finally(() => inFlight.delete(teacherId));

  inFlight.set(teacherId, load);
  return load;
}

/**
  * The number beside "Inbox" in the teacher bar: unanswered community questions
  * + conversations where the learner wrote last. `null` turns it off
  * (learner, or outside the teacher side).
 *
  * Failing shows no error: the bar just stays without the number.
 */
export function useTeacherInboxCount(teacherId: string | null): number | undefined {
  const [result, setResult] = useState<{ teacherId: string; count: number } | null>(null);

  useEffect(() => {
    if (!teacherId) {
      return;
    }

    let alive = true;
    loadTeacherInbox(teacherId).then(
      ({ questions, threads }) => {
        if (alive && threads !== null) setResult({ teacherId, count: questions.length + threads });
      },
      () => {
        // No number; the Inbox stays one click away.
      },
    );

    return () => {
      alive = false;
    };
  }, [teacherId]);

  return teacherId && result?.teacherId === teacherId ? result.count : undefined;
}
