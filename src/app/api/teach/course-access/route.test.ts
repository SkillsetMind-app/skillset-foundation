// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: vi.fn(), admin: vi.fn(), limit: vi.fn(), free: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.client }));
vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdminClient: mocks.admin }));
vi.mock("@/lib/payments/server/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/payments/server/auth")>()),
  enforceRateLimit: mocks.limit,
  isOnFreePlan: mocks.free,
}));
import { PaymentError } from "@/lib/payments/server/auth";
import { GET, POST } from "./route";

const grant = { id: "11111111-1111-4111-8111-111111111111", course_id: "course-1", learner_email: "learner@example.com", access_status: "pending", revoked_at: null };
let rpc: ReturnType<typeof vi.fn>;
let send: ReturnType<typeof vi.fn>;
let query: Record<string, ReturnType<typeof vi.fn>>;
function request(body: unknown) { return new Request("https://www.skillsetmind.com/api/teach/course-access", { method: "POST", body: JSON.stringify(body) }); }
beforeEach(() => {
  vi.clearAllMocks();
  rpc = vi.fn(async (name: string) => ({ data: name === "creator_activation_blocked" ? false : grant, error: null }));
  send = vi.fn().mockResolvedValue({ error: null });
  query = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn(), single: vi.fn() };
  for (const key of ["select", "eq", "order"]) query[key].mockReturnValue(query);
  query.limit.mockResolvedValue({ data: [grant], error: null });
  query.single.mockResolvedValue({ data: grant, error: null });
  mocks.client.mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "teacher" } }, error: null }) }, rpc, from: vi.fn().mockReturnValue(query) });
  mocks.admin.mockReturnValue({ auth: { signInWithOtp: send } });
  mocks.limit.mockResolvedValue(undefined);
  mocks.free.mockResolvedValue(false);
});

describe("manual course access route", () => {
  it("records access even if mail fails, and resends only to the authorized record", async () => {
    send.mockResolvedValueOnce({ error: { message: "SMTP failed" } });
    const response = await POST(request({ courseId: "course-1", email: " LEARNER@example.com " }));
    expect(await response.json()).toMatchObject({ accessStatus: "pending", emailStatus: "failed", grant });
    expect(rpc).toHaveBeenCalledWith("grant_course_access", { p_course_id: "course-1", p_email: "learner@example.com" });
    expect((await POST(request({ action: "resend", grantId: grant.id }))).status).toBe(200);
    expect(send).toHaveBeenLastCalledWith({ email: grant.learner_email, options: { shouldCreateUser: true, emailRedirectTo: "https://www.skillsetmind.com/loading?next=route" } });
    expect(mocks.limit).toHaveBeenCalledWith(`course_access_email_${grant.id}`, 3, 3600000);
  });
  it("refuses anonymous or incomplete MFA before transport", async () => {
    mocks.client.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: null }, error: { code: "mfa_required" } }) } });
    expect((await POST(request({ courseId: "course-1", email: grant.learner_email }))).status).toBe(401);
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("does not send if the owner RPC refuses or fails", async () => {
    rpc.mockImplementation(async (name: string) => name === "creator_activation_blocked"
      ? { data: false, error: null }
      : { data: null, error: { code: "42501" } });
    expect((await POST(request({ courseId: "course-1", email: grant.learner_email }))).status).toBe(403);
    expect(send).not.toHaveBeenCalled();
  });
  it("rejects malformed addresses and additional resend destinations", async () => {
    expect((await POST(request({ courseId: "course-1", email: "invalid" }))).status).toBe(400);
    expect((await POST(request({ action: "resend", grantId: grant.id, email: "other@example.com" }))).status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });
  it("fails closed on persistent rate-limit failure", async () => {
    mocks.limit.mockRejectedValue(new Error("database unavailable"));
    expect((await POST(request({ courseId: "course-1", email: grant.learner_email }))).status).toBe(500);
    expect(rpc).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
  it("does not report a failed list as an empty successful list", async () => {
    query.limit.mockResolvedValue({ data: null, error: { code: "offline" } });
    expect((await GET(new Request("https://www.skillsetmind.com/api/teach/course-access?courseId=course-1"))).status).toBe(500);
  });
  it("revokes through the owner RPC without sending email", async () => {
    rpc.mockImplementation(async (name: string) => ({ data: name === "creator_activation_blocked" ? false : { ...grant, access_status: "revoked" }, error: null }));
    expect((await POST(request({ action: "revoke", grantId: grant.id }))).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("revoke_course_access", { p_grant_id: grant.id });
    expect(send).not.toHaveBeenCalled();
  });

  it.each(["grant", "resend", "revoke"])("blocks %s before changing access or sending mail when activation is unpaid", async (action) => {
    rpc.mockImplementation(async (name: string) => ({ data: name === "creator_activation_blocked" ? true : grant, error: null }));
    const response = await POST(request(action === "grant"
      ? { courseId: "course-1", email: grant.learner_email }
      : { action, grantId: grant.id }));
    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({ code: "activation_required" });
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(["creator_activation_blocked"]);
    expect(query.single).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("fails closed on an unavailable activation verdict without leaking diagnostics", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "private activation diagnostic" } });
    const response = await POST(request({ courseId: "course-1", email: grant.learner_email }));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("private activation diagnostic");
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(["creator_activation_blocked"]);
    expect(send).not.toHaveBeenCalled();
  });

  // Free plan: 10 grants a day on top of the hourly 30, by plan, never by the
  // activation flag. Resend and revoke do not count.
  const freeDaily = ["course_access_daily_teacher", 10, 86400000];

  it("holds a Free-plan creator to 10 grants a day on top of the hourly limit", async () => {
    mocks.free.mockResolvedValue(true);
    expect((await POST(request({ courseId: "course-1", email: grant.learner_email }))).status).toBe(200);
    expect(mocks.free).toHaveBeenCalledWith("teacher");
    expect(mocks.limit).toHaveBeenCalledWith("course_access_teacher", 30, 3600000);
    expect(mocks.limit).toHaveBeenCalledWith(...freeDaily);
  });

  it("refuses a Free-plan grant over the daily cap with a come-back-tomorrow 429", async () => {
    mocks.free.mockResolvedValue(true);
    mocks.limit.mockImplementation(async (key: string) => {
      if (key === "course_access_daily_teacher") throw new PaymentError("Too many attempts. Please wait before trying again.", 429);
    });
    const response = await POST(request({ courseId: "course-1", email: grant.learner_email }));
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      error: "Daily limit for manual access without a plan. Try again tomorrow.",
      code: "free_plan_daily_limit",
    });
    expect(rpc).not.toHaveBeenCalledWith("grant_course_access", expect.anything());
    expect(send).not.toHaveBeenCalled();
  });

  it.each(["resend", "revoke"])("does not count a Free-plan %s against the daily grants", async (action) => {
    mocks.free.mockResolvedValue(true);
    await POST(request({ action, grantId: grant.id }));
    expect(mocks.limit).not.toHaveBeenCalledWith(...freeDaily);
  });

  it("leaves a paid-plan creator with the hourly limit only", async () => {
    await POST(request({ courseId: "course-1", email: grant.learner_email }));
    expect(mocks.limit).not.toHaveBeenCalledWith(...freeDaily);
  });
});
