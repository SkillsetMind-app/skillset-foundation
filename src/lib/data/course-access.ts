"use client";

import type { Database } from "@/lib/supabase/database.types";
export type CourseAccessGrant = Database["public"]["Tables"]["course_access_grants"]["Row"];
export type CourseAccessAction = { courseId: string; email: string } | { action: "resend" | "revoke"; grantId: string };
export type CourseAccessResult = { grant: CourseAccessGrant; accessStatus: CourseAccessGrant["access_status"]; emailStatus?: "sent" | "failed" };

export async function listCourseAccess(courseId: string): Promise<CourseAccessGrant[]> {
  const response = await fetch(`/api/teach/course-access?courseId=${encodeURIComponent(courseId)}`, { cache: "no-store" });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Could not load course access.");
  return body.grants;
}

export async function changeCourseAccess(action: CourseAccessAction): Promise<CourseAccessResult> {
  const response = await fetch("/api/teach/course-access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Could not update course access.");
  return body;
}
