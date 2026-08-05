import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { buildTeacherContext } from "./teacher-context";

// Minimal stand-in for the query builder: every chained call returns `this`,
// and awaiting it resolves to the canned result. Enough to exercise the two
// queries buildTeacherContext makes without booting Supabase.
function fakeClient(
  coursesResult: { data: unknown; error: unknown },
  userResult: { data: unknown; error: unknown },
): SupabaseClient {
  const chain = (result: { data: unknown; error: unknown }) => {
    const self = {
      select: () => self,
      eq: () => self,
      order: () => self,
      limit: () => Promise.resolve(result),
      maybeSingle: () => Promise.resolve(result),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
    };
    return self;
  };
  return {
    from: (table: string) => chain(table === "courses" ? coursesResult : userResult),
  } as unknown as SupabaseClient;
}

const READY_TEACHER = {
  display_name: "Dr. Ada",
  current_plan_id: "pro",
  stripe_connect_status: "complete",
  stripe_connect_charges_enabled: true,
  stripe_connect_payouts_enabled: true,
};

describe("buildTeacherContext", () => {
  it("leads with unfinished Stripe setup — selling advice is useless if they cannot be paid", async () => {
    const client = fakeClient(
      { data: [], error: null },
      {
        data: { ...READY_TEACHER, stripe_connect_charges_enabled: false, stripe_connect_status: "pending" },
        error: null,
      },
    );

    const out = await buildTeacherContext(client, "uid-1");

    expect(out).toContain("INCOMPLETE");
    expect(out).toContain("cannot accept charges");
    expect(out).toContain("top priority");
  });

  it("says the studio is empty rather than implying courses exist", async () => {
    const client = fakeClient({ data: [], error: null }, { data: READY_TEACHER, error: null });

    const out = await buildTeacherContext(client, "uid-1");

    expect(out).toContain("NONE created yet");
    expect(out).toContain("Payment setup: COMPLETE");
  });

  it("surfaces per-course gaps the teacher can act on", async () => {
    const client = fakeClient(
      {
        data: [
          {
            title: "Anxiety 101",
            status: "published",
            price_amount_minor: 4900,
            currency: "usd",
            enrollment_count: 0,
            lesson_count: 12,
            rating_average: 0,
            review_count: 0,
            cover_image_url: null,
            created_at: new Date(Date.now() - 40 * 86_400_000).toISOString(),
          },
        ],
        error: null,
      },
      { data: READY_TEACHER, error: null },
    );

    const out = await buildTeacherContext(client, "uid-1");

    expect(out).toContain("Anxiety 101");
    expect(out).toContain("NO COVER IMAGE");
    expect(out).toContain("no reviews yet");
    expect(out).toContain("USD 49.00");
    expect(out).toContain("0 students");
    expect(out).toContain("40d ago");
    expect(out).toContain("1 total, 1 published");
  });

  it("prices a zero-cost course as free instead of 'USD 0.00'", async () => {
    const client = fakeClient(
      {
        data: [
          {
            title: "Intro",
            status: "draft",
            price_amount_minor: 0,
            currency: "usd",
            enrollment_count: 0,
            lesson_count: 1,
            rating_average: 0,
            review_count: 0,
            cover_image_url: "https://example.test/c.png",
            created_at: null,
          },
        ],
        error: null,
      },
      { data: READY_TEACHER, error: null },
    );

    const out = await buildTeacherContext(client, "uid-1");

    expect(out).toContain("free");
    expect(out).not.toContain("USD 0.00");
    expect(out).not.toContain("NO COVER IMAGE");
  });

  it("returns empty string when it cannot read anything, so the chat still answers", async () => {
    const boom = { data: null, error: { message: "denied" } };
    const client = fakeClient(boom, boom);

    expect(await buildTeacherContext(client, "uid-1")).toBe("");
  });
});
