import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildCreatorSaleEmail,
  buildPurchaseAccessEmail,
  sendPurchaseAccessEmail,
} from "@/lib/payments/server/purchase-access-email";

const sale = {
  email: "buyer@example.test",
  courseTitle: "Course",
  courseUrl: "https://www.skillsetmind.com/learn/courses/course_1",
  locale: "en" as const,
  idempotencyKey: "order_1",
};

const creatorSale = {
  email: "creator@example.test",
  courseTitle: "Course",
  amountMinor: 10000,
  currency: "USD",
  salesUrl: "https://www.skillsetmind.com/teach/sales",
  idempotencyKey: "order_1:creator-sale",
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

describe("creator sale email", () => {
  it("prints the stored amount, zero-decimal currencies included", () => {
    expect(buildCreatorSaleEmail(creatorSale).text).toContain("Amount: $100.00");
    expect(buildCreatorSaleEmail({ ...creatorSale, amountMinor: 100000, currency: "JPY" }).text).toContain("Amount: ¥1,000");
  });

  it("escapes the title in the HTML", () => {
    const email = buildCreatorSaleEmail({ ...creatorSale, courseTitle: "<script>x</script>" });

    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;x&lt;/script&gt;");
    expect(email.subject).toBe("New sale: <script>x</script>");
  });
});
