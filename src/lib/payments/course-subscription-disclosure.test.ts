import { describe, expect, it } from "vitest";

import { getDictionary, translate } from "@/lib/i18n/dictionaries";
import { courseSubscriptionDisclosure } from "@/lib/payments/course-subscription-disclosure";

const t = (locale: "en" | "es") => (key: string) => translate(getDictionary(locale), key);

describe("course subscription renewal notice", () => {
  it("states the price, the interval, the automatic renewal and where to cancel", () => {
    expect(courseSubscriptionDisclosure({ t: t("en"), locale: "en", amountMinor: 2900, currency: "usd", interval: "month" }))
      .toBe("Charged today, then $29.00 every month. Renews automatically until you cancel. Cancel anytime on your course page, under Subscription, to stop the next charge.");
    expect(courseSubscriptionDisclosure({ t: t("en"), locale: "en", amountMinor: 29000, currency: "USD", interval: "year" }))
      .toContain("then $290.00 every year. Renews automatically until you cancel.");
  });

  it("in Spanish, with the same content", () => {
    const text = courseSubscriptionDisclosure({ t: t("es"), locale: "es", amountMinor: 2900, currency: "USD", interval: "month" });
    expect(text).toContain("cada mes. Se renueva automáticamente hasta que canceles.");
    expect(text).toContain("en Suscripción");
    expect(text).not.toContain("{price}");
  });

  it("a currency without cents follows the house convention (value x 100)", () => {
    expect(courseSubscriptionDisclosure({ t: t("en"), locale: "en", amountMinor: 100000, currency: "JPY", interval: "month" }))
      .toContain("then ¥1,000 every month.");
  });
});
