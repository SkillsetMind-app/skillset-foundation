// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: vi.fn(), admin: vi.fn(), limit: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.client }));
vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdminClient: mocks.admin }));
vi.mock("@/lib/payments/server/auth", () => ({ enforceRateLimit: mocks.limit }));
import { GET, POST } from "./route";

const grant = { id: "11111111-1111-4111-8111-111111111111", course_id: "course-1", learner_email: "learner@example.com", access_status: "pending", revoked_at: null };
let rpc: ReturnType<typeof vi.fn>;
let send: ReturnType<typeof vi.fn>;
let query: Record<string, ReturnType<typeof vi.fn>>;
function request(body: unknown) { return new Request("https://www.skillsetmind.com/api/teach/course-access", { method: "POST", body: JSON.stringify(body) }); }
beforeEach(() => {
  vi.clearAllMocks();
  rpc = vi.fn().mockResolvedValue({ data: grant, error: null });
  send = vi.fn().mockResolvedValue({ error: null });
  query = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn(), single: vi.fn() };
  for (const key of ["select", "eq", "order"]) query[key].mockReturnValue(query);
  query.limit.mockResolvedValue({ data: [grant], error: null });
  query.single.mockResolvedValue({ data: grant, error: null });
  mocks.client.mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "teacher" } }, error: null }) }, rpc, from: vi.fn().mockReturnValue(query) });
  mocks.admin.mockReturnValue({ auth: { signInWithOtp: send } });
  mocks.limit.mockResolvedValue(undefined);
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
    rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
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
    rpc.mockResolvedValue({ data: { ...grant, access_status: "revoked" }, error: null });
    expect((await POST(request({ action: "revoke", grantId: grant.id }))).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("revoke_course_access", { p_grant_id: grant.id });
    expect(send).not.toHaveBeenCalled();
  });
});
