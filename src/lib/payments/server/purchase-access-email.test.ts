import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ signInWithOtp: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdminClient: () => ({ auth: { signInWithOtp: mocks.signInWithOtp } }),
}));

import { sendPurchaseAccessEmail } from "@/lib/payments/server/purchase-access-email";

describe("sendPurchaseAccessEmail", () => {
  beforeEach(() => {
    mocks.signInWithOtp.mockReset().mockResolvedValue({ error: null });
  });

  it("sends a sign-in link that lands on the course, never creating an account", async () => {
    await sendPurchaseAccessEmail({
      email: "buyer@example.test",
      courseUrl: "https://www.skillsetmind.com/learn/courses/course_1",
    });

    expect(mocks.signInWithOtp).toHaveBeenCalledWith({
      email: "buyer@example.test",
      options: {
        shouldCreateUser: false,
        emailRedirectTo: "https://www.skillsetmind.com/auth/confirm?next=%2Flearn%2Fcourses%2Fcourse_1",
      },
    });
  });

  it("throws when Supabase refuses the send, so the caller can alert", async () => {
    mocks.signInWithOtp.mockResolvedValue({ error: { message: "rate limited" } });

    await expect(
      sendPurchaseAccessEmail({ email: "buyer@example.test", courseUrl: "https://www.skillsetmind.com/learn/courses/course_1" }),
    ).rejects.toThrow("rate limited");
  });
});
