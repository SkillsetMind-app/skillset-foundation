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
// enrollments_select_admin, orders_owner_sel). No new RPC, no service role.
//
// ponytail: rows are summed in the browser. Fine for thousands of rows per
// window; past that, an aggregate view/RPC (a migration) is the upgrade.

// PostgREST max_rows. The server may cap lower, so paging advances by what
// actually came back and only an empty page ends the read.
const PAGE_SIZE = 1000;

type Page<T> = PromiseLike<{ data: T[] | null; error: unknown }>;

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String((error as { message?: unknown }).message ?? error));
}

async function readAll<T>(page: (from: number, to: number) => Page<T>): Promise<T[]> {
  const rows: T[] = [];
  for (;;) {
    const { data, error } = await page(rows.length, rows.length + PAGE_SIZE - 1);
    if (error) throw asError(error);
    if (!data?.length) return rows;
    rows.push(...data);
  }
}

// RLS hides rows instead of failing: an admin whose session lacks the second
// factor (is_admin() requires aal2) would read zeros that look real. Ask the
// same predicate the policies use before reading anything.
export async function readOverviewAdminSession(signal?: AbortSignal): Promise<boolean> {
  const call = getSupabaseBrowserClient().rpc("is_admin");
  const { data, error } = await (signal ? call.abortSignal(signal) : call);
  if (error) throw asError(error);
  return data === true;
}

export function readOverviewUsers(since: string, signal?: AbortSignal): Promise<OverviewUserRow[]> {
  return readAll((from, to) => {
    const query = getSupabaseBrowserClient()
      .from("users")
      .select("uid,created_at,roles")
      .gte("created_at", since)
      .order("created_at")
      .order("uid")
      .range(from, to);
    return signal ? query.abortSignal(signal) : query;
  });
}

/** Every course: "creators with a published course" is a now-state, not a window. */
export function readOverviewCourses(signal?: AbortSignal): Promise<OverviewCourseRow[]> {
  return readAll((from, to) => {
    const query = getSupabaseBrowserClient()
      .from("courses")
      .select("id,title,owner_id,status,created_at")
      .order("created_at")
      .order("id")
      .range(from, to);
    return signal ? query.abortSignal(signal) : query;
  });
}

function readAudit(action: string, since: string, signal?: AbortSignal): Promise<OverviewAuditRow[]> {
  return readAll((from, to) => {
    const query = getSupabaseBrowserClient()
      .from("audit_log")
      .select("id,target_id,created_at,metadata")
      .eq("action", action)
      .gte("created_at", since)
      .order("created_at")
      .order("id")
      .range(from, to);
    return signal ? query.abortSignal(signal) : query;
  });
}

export function readOverviewPublications(since: string, signal?: AbortSignal) {
  return readAudit("COURSE_PUBLISHED_BY_CREATOR", since, signal);
}

export function readOverviewActivations(since: string, signal?: AbortSignal) {
  return readAudit("STOREFRONT_ACTIVATION_FEE_PAID", since, signal);
}

export function readOverviewEnrollments(since: string, signal?: AbortSignal): Promise<OverviewEnrollmentRow[]> {
  return readAll((from, to) => {
    const query = getSupabaseBrowserClient()
      .from("enrollments")
      .select("id,course_id,course_title,source,created_at")
      .gte("created_at", since)
      .order("created_at")
      .order("id")
      .range(from, to);
    return signal ? query.abortSignal(signal) : query;
  });
}

/** updated_at >= paid_at, so one filter covers sales and refunds in the window. */
export function readOverviewOrders(since: string, signal?: AbortSignal): Promise<OverviewOrderRow[]> {
  return readAll((from, to) => {
    const query = getSupabaseBrowserClient()
      .from("orders")
      .select("id,course_id,course_title,status,amount_minor,currency,platform_fee_bps,refunded_amount_minor,paid_at,updated_at")
      .gte("updated_at", since)
      .order("updated_at")
      .order("id")
      .range(from, to);
    return signal ? query.abortSignal(signal) : query;
  });
}
