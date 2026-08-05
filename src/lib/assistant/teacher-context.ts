import type { SupabaseClient } from "@supabase/supabase-js";

// Grounding context for the STUDIO ADVISOR — the teacher's own situation.
//
// Why this exists: the advisor already ships with buildAssistantKnowledge()
// (how the PLATFORM works — plans, fees, FAQ). That makes it accurate and
// completely generic: it can explain what a commission is, but not that THIS
// teacher published a course 40 days ago that still has zero students and no
// cover image. Advice that ignores the teacher's numbers reads like a chatbot,
// which is the one thing this feature must not be.
//
// SECURITY: takes the request-scoped client (anon key + the caller's session),
// never the service-role client. RLS therefore scopes every row to the caller —
// this function cannot read another teacher's data even if uid were wrong.
// ponytail: two queries, no joins — courses already denormalises the counters
// (enrollment_count, rating_average, review_count), so there is nothing to join.

type CourseRow = {
  title: string | null;
  status: string | null;
  price_amount_minor: number | null;
  currency: string | null;
  enrollment_count: number | null;
  lesson_count: number | null;
  rating_average: number | null;
  review_count: number | null;
  cover_image_url: string | null;
  created_at: string | null;
};

type TeacherRow = {
  display_name: string | null;
  current_plan_id: string | null;
  stripe_connect_status: string | null;
  stripe_connect_charges_enabled: boolean | null;
  stripe_connect_payouts_enabled: boolean | null;
};

const MAX_COURSES = 25; // a payload bound, not a product limit — see note below

function money(minor: number | null, currency: string | null): string {
  if (minor === null || minor === 0) return "free";
  return `${(currency ?? "usd").toUpperCase()} ${(minor / 100).toFixed(2)}`;
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  return Math.floor((Date.now() - then) / 86_400_000);
}

function describeCourse(c: CourseRow): string {
  const bits = [
    `"${c.title ?? "(untitled)"}"`,
    c.status ?? "unknown status",
    `${c.lesson_count ?? 0} lessons`,
    money(c.price_amount_minor, c.currency),
    `${c.enrollment_count ?? 0} students`,
  ];

  if ((c.review_count ?? 0) > 0) {
    bits.push(`rated ${(c.rating_average ?? 0).toFixed(1)} from ${c.review_count} reviews`);
  } else {
    bits.push("no reviews yet");
  }
  if (!c.cover_image_url) bits.push("NO COVER IMAGE");

  const age = daysSince(c.created_at);
  if (age !== null) bits.push(`created ${age}d ago`);

  return `- ${bits.join(" · ")}`;
}

function describePayments(t: TeacherRow | null): string {
  if (!t) return "Payment setup: unknown.";
  if (t.stripe_connect_charges_enabled && t.stripe_connect_payouts_enabled) {
    return "Payment setup: COMPLETE — this teacher can take payments and receive payouts.";
  }
  // The single most consequential fact about a teacher: a published course on an
  // unfinished Stripe account cannot take money. Say it plainly so the advisor
  // leads with it instead of suggesting marketing tactics to someone who
  // literally cannot be paid yet.
  const missing = [
    t.stripe_connect_charges_enabled ? null : "cannot accept charges",
    t.stripe_connect_payouts_enabled ? null : "cannot receive payouts",
  ].filter(Boolean);
  return `Payment setup: INCOMPLETE (${missing.join(", ")}; status "${
    t.stripe_connect_status ?? "not started"
  }"). Until Stripe onboarding is finished in Studio → Payments, published courses cannot be sold. Treat this as the top priority in any advice about sales or launching.`;
}

/**
 * Snapshot of the signed-in teacher's own catalogue and payment readiness, as
 * plain text for the model. Returns "" when nothing can be read — the advisor
 * must still answer generically rather than fail, so callers append this
 * unconditionally.
 */
export async function buildTeacherContext(
  supabase: SupabaseClient,
  uid: string,
): Promise<string> {
  const [coursesResult, teacherResult] = await Promise.all([
    supabase
      .from("courses")
      .select(
        "title,status,price_amount_minor,currency,enrollment_count,lesson_count,rating_average,review_count,cover_image_url,created_at",
      )
      .eq("owner_id", uid)
      .order("created_at", { ascending: false })
      .limit(MAX_COURSES),
    supabase
      .from("users")
      .select(
        "display_name,current_plan_id,stripe_connect_status,stripe_connect_charges_enabled,stripe_connect_payouts_enabled",
      )
      .eq("uid", uid)
      .maybeSingle(),
  ]);

  // A broken context must never break the chat: on error we return "" and the
  // advisor degrades to the generic-but-correct behaviour it has today.
  if (coursesResult.error && teacherResult.error) return "";

  const courses = (coursesResult.data ?? []) as CourseRow[];
  const teacher = (teacherResult.data ?? null) as TeacherRow | null;

  const lines = [
    "# This teacher's current situation (private, live data — prefer it over generic advice)",
    teacher?.display_name ? `Name: ${teacher.display_name}` : null,
    teacher?.current_plan_id ? `Plan: ${teacher.current_plan_id}` : null,
    describePayments(teacher),
    "",
  ].filter((l): l is string => l !== null);

  if (courses.length === 0) {
    lines.push(
      "Courses: NONE created yet. This teacher has an empty studio — advice should be about creating and shipping a first course, not about optimising an existing one.",
    );
  } else {
    const published = courses.filter((c) => c.status === "published").length;
    const students = courses.reduce((n, c) => n + (c.enrollment_count ?? 0), 0);
    lines.push(
      `Courses: ${courses.length} total, ${published} published, ${students} students enrolled across all of them.`,
      ...courses.map(describeCourse),
    );
    if (courses.length === MAX_COURSES) {
      // Never let a cap read as a complete picture — the model would otherwise
      // state totals as fact when it is looking at a truncated list.
      lines.push(
        `(Only the ${MAX_COURSES} most recent courses are listed; the teacher may have more.)`,
      );
    }
  }

  return lines.join("\n");
}
