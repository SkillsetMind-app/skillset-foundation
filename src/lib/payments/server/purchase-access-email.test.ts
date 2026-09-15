import { afterEach, describe, expect, it, vi } from "vitest";

import { buildPurchaseAccessEmail, sendPurchaseAccessEmail } from "@/lib/payments/server/purchase-access-email";

const sale = {
  email: "buyer@example.test",
  courseTitle: "Course",
  courseUrl: "https://www.skillsetmind.com/learn/courses/course_1",
  locale: "en" as const,
  idempotencyKey: "order_1",
};

describe("purchase access email", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("escapes a creator's title in the HTML and keeps it readable in text", () => {
    const email = buildPurchaseAccessEmail({ ...sale, courseTitle: "<script>alert(1)</script>\nPart 2" });

    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; Part 2");
    expect(email.text).toContain("<script>alert(1)</script> Part 2");
    expect(email.subject).toBe("Your course is ready: <script>alert(1)</script> Part 2");
  });

  it("throws on a Resend error so the webhook can alert", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_fixture");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));

    await expect(sendPurchaseAccessEmail(sale)).rejects.toThrow("Resend answered 500.");
  });
});
