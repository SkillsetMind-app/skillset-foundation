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

  // Subscription: the email for the first charge confirms the renewal terms.
  it("confirms the renewal terms and how to cancel on a subscription, in both languages", () => {
    const renewal = { amountMinor: 2900, currency: "usd", interval: "month" as const };
    const english = buildPurchaseAccessEmail({ ...sale, renewal });
    for (const part of [english.text, english.html]) {
      expect(part).toContain("It renews automatically at $29.00 every month until you cancel.");
      expect(part).toContain("under Subscription. You keep access until the end of the period you already paid for.");
    }
    expect(english.text).toContain('choose "Cancel subscription"');
    expect(english.html).toContain("choose &quot;Cancel subscription&quot;");

    const spanish = buildPurchaseAccessEmail({ ...sale, locale: "es", renewal: { ...renewal, interval: "year" } });
    expect(spanish.text).toContain("cada año hasta que canceles.");
    expect(spanish.text).toContain("elige «Cancelar suscripción» en Suscripción");
  });

  // EU, EEA and UK: the immediate-access confirmation on a durable medium.
  it("confirms the immediate-access consent only when it was given, in both languages", () => {
    const english = buildPurchaseAccessEmail({ ...sale, withdrawalConsent: true });
    const sentence = "At checkout you asked for access to start right away and acknowledged that you lose your 14-day right of withdrawal once access starts.";
    expect(english.text).toContain(sentence);
    expect(english.html).toContain(sentence);

    expect(buildPurchaseAccessEmail({ ...sale, locale: "es", withdrawalConsent: true }).text)
      .toContain("reconociste que pierdes tu derecho de desistimiento de 14 días cuando empieza el acceso.");

    expect(buildPurchaseAccessEmail(sale).text).not.toMatch(/withdrawal/i);
  });

  it("says nothing about renewal on a one-time purchase", () => {
    const email = buildPurchaseAccessEmail(sale);
    expect(email.text).not.toMatch(/renews|subscription/i);
    expect(email.html).not.toMatch(/renews|subscription/i);
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
