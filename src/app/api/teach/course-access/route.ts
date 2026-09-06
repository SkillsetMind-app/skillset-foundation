import { NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/payments/server/auth";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function failure(status: number, error: string) { return NextResponse.json({ error }, { status }); }
function databaseFailure(error: { code?: string; message?: string }) {
  if (error.code === "42501") return failure(403, "Only the course owner can manage access to a published course.");
  if (error.code === "22023") return failure(400, "Enter a valid email address.");
  if (error.message?.includes("RATE_LIMIT")) return failure(429, "Too many attempts. Please wait before trying again.");
  return failure(500, "Could not update course access. Please try again.");
}

export async function GET(request: Request) {
  try {
    const client = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError || !user) return failure(401, "Sign in to manage course access.");
    const courseId = new URL(request.url).searchParams.get("courseId");
    if (!courseId || courseId.length > 200) return failure(400, "Choose a course.");
    // ponytail: latest 200 grants; add cursor pagination when a creator reaches that volume.
    const { data, error } = await client.from("course_access_grants").select("*").eq("course_id", courseId).order("created_at", { ascending: false }).limit(200);
    if (error) return databaseFailure(error);
    return NextResponse.json({ grants: data });
  } catch { return failure(500, "Could not load course access. Please try again."); }
}

export async function POST(request: Request) {
  try {
    const client = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError || !user) return failure(401, "Sign in to manage course access.");
    const text = await request.text();
    if (text.length > 2048) return failure(400, "Request is too large.");
    let body: Record<string, unknown>;
    try { body = JSON.parse(text); } catch { return failure(400, "Invalid request."); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return failure(400, "Invalid request.");
    const action = body.action ?? "grant";
    if (!["grant", "resend", "revoke"].includes(String(action))) return failure(400, "Invalid action.");
    const allowed = action === "grant" ? ["courseId", "email", "action"] : ["action", "grantId"];
    if (Object.keys(body).some((key) => !allowed.includes(key))) return failure(400, "Invalid request fields.");
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (action === "grant" && (typeof body.courseId !== "string" || !body.courseId || body.courseId.length > 200 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return failure(400, "Choose a course and enter a valid email address.");
    if (action !== "grant" && (typeof body.grantId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.grantId))) return failure(400, "Choose an access record.");
    await enforceRateLimit(`course_access_${user.id}`, 30, 3600000);
    const result = action === "grant"
      ? await client.rpc("grant_course_access", { p_course_id: body.courseId as string, p_email: email })
      : action === "revoke"
        ? await client.rpc("revoke_course_access", { p_grant_id: body.grantId as string })
        : await client.from("course_access_grants").select("*").eq("id", body.grantId as string).single();
    if (result.error) return databaseFailure(result.error);
    const grant = result.data;
    if (!grant) return failure(403, "Access record is not available.");
    if (action === "revoke") return NextResponse.json({ grant, accessStatus: grant.access_status });
    if (grant.revoked_at || grant.access_status === "conflict") return NextResponse.json({ grant, accessStatus: grant.access_status, emailStatus: "failed" });
    let emailStatus: "sent" | "failed" = "failed";
    try {
      // Record-bound + actor-bound limits are persistent, including failed sends.
      await enforceRateLimit(`course_access_email_${grant.id}`, 3, 3600000);
      const { error } = await getSupabaseAdminClient().auth.signInWithOtp({
        email: grant.learner_email,
        options: { shouldCreateUser: true, emailRedirectTo: "https://www.skillsetmind.com/loading?next=route" },
      });
      if (!error) emailStatus = "sent";
    } catch { /* Access remains recorded. Never expose the provider response. */ }
    return NextResponse.json({ grant, accessStatus: grant.access_status, emailStatus });
  } catch (error) {
    if (error && typeof error === "object" && "status" in error && error.status === 429) return failure(429, "Too many attempts. Please wait before trying again.");
    return failure(500, "Could not update course access. Please try again.");
  }
}
