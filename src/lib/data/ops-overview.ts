"use client";

import type {
  OverviewAuditRow,
  OverviewCourseRow,
  OverviewEnrollmentRow,
  OverviewOrderRow,
  OverviewUserRow,
} from "@/domain/ops-overview";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

// One-shot reads for the /ops Overview. Browser session only: every table
// here is already readable by an admin through its existing RLS policy
// (users_select_admin, courses_select_admin, audit_log_admin_select,
// enrollments_select_admin, orders_owner_sel). No RPC, no service role.
//
// ponytail: rows are summed in the browser. Fine for thousands of rows per
// window; past that, an aggregate view/RPC (a migration) is the upgrade.

const PAGE_SIZE = 1000; // PostgREST max_rows: a bigger page is silently cut.

type Page<T> = PromiseLike<{ data: T[] | null; error: unknown }>;

async function readAll<T>(page: (from: number, to: number) => Page<T>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) {
      throw error instanceof Error ? error : new Error(String((error as { message?: unknown }).message ?? error));
    }
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < PAGE_SIZE) return rows;
  }
}

export function readOverviewUsers(since: string): Promise<OverviewUserRow[]> {
  return readAll((from, to) =>
    getSupabaseBrowserClient()
      .from("users")
      .select("uid,created_at,roles")
      .gte("created_at", since)
      .order("created_at")
      .order("uid")
      .range(from, to),
  );
}

/** Every course: "creators with a published course" is a now-state, not a window. */
export function readOverviewCourses(): Promise<OverviewCourseRow[]> {
  return readAll((from, to) =>
    getSupabaseBrowserClient()
      .from("courses")
      .select("id,title,owner_id,status,created_at")
      .order("created_at")
      .order("id")
      .range(from, to),
  );
}

function readAudit(action: string, since: string): Promise<OverviewAuditRow[]> {
  return readAll((from, to) =>
    getSupabaseBrowserClient()
      .from("audit_log")
      .select("id,target_id,created_at,metadata")
      .eq("action", action)
      .gte("created_at", since)
      .order("created_at")
      .order("id")
      .range(from, to),
  );
}

export function readOverviewPublications(since: string) {
  return readAudit("COURSE_PUBLISHED_BY_CREATOR", since);
}

export function readOverviewActivations(since: string) {
  return readAudit("STOREFRONT_ACTIVATION_FEE_PAID", since);
}

export function readOverviewEnrollments(since: string): Promise<OverviewEnrollmentRow[]> {
  return readAll((from, to) =>
    getSupabaseBrowserClient()
      .from("enrollments")
      .select("id,course_id,course_title,source,created_at")
      .gte("created_at", since)
      .order("created_at")
      .order("id")
      .range(from, to),
  );
}

/** updated_at >= paid_at, so one filter covers sales, refunds and failures in the window. */
export function readOverviewOrders(since: string): Promise<OverviewOrderRow[]> {
  return readAll((from, to) =>
    getSupabaseBrowserClient()
      .from("orders")
      .select("id,course_id,course_title,status,amount_minor,currency,platform_fee_bps,refunded_amount_minor,paid_at,updated_at")
      .gte("updated_at", since)
      .order("updated_at")
      .order("id")
      .range(from, to),
  );
}
