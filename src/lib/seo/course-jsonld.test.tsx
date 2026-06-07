import { describe, expect, it } from "vitest";

import type { Course } from "@/domain/learning";
import { buildCourseJsonLd } from "@/lib/seo/course-jsonld";

const SITE = "https://example.test";

function makeCourse(overrides: Partial<Course> = {}): Course {
  return {
    id: "course-x",
    slug: "course-x",
    title: "Course X",
    category: "Management",
    durationLabel: "8-12 weeks",
    status: "published",
    statusLabel: "New",
    summary: "A practical course.",
    detail: "Detail.",
    image: "/courses/x.jpg",
    level: "Professional",
    priceLabel: "$49",
    priceAmountMinor: 4900,
    currency: "USD",
    platformFeeBps: 800,
    freePreviewLabel: "Free preview",
    outcomes: ["Outcome one", "Outcome two"],
    modules: [],
    communityEnabled: true,
    ...overrides,
  };
}

// Default to purchasable=true so the field-shape tests exercise the full
// payload (Course + Offer). The purchasability gate has its own tests below.
function build(course: Course, purchasable = true): Record<string, unknown> {
  return buildCourseJsonLd(course, { purchasable, siteUrl: SITE });
}

describe("course JSON-LD (C2)", () => {
  it("emits a valid Course with an Organization provider and required fields", () => {
    const data = build(makeCourse());
    expect(data["@context"]).toBe("https://schema.org");
    expect(data["@type"]).toBe("Course");
    expect(data.name).toBe("Course X");
    expect(data.description).toBe("A practical course.");
    expect(data.url).toBe(`${SITE}/courses/course-x`);
    expect(data.educationalLevel).toBe("Professional");
    expect(data.about).toBe("Management");
    expect(data.teaches).toEqual(["Outcome one", "Outcome two"]);
    const provider = data.provider as Record<string, unknown>;
    expect(provider["@type"]).toBe("Organization");
    expect(typeof provider.name).toBe("string");
    expect(provider.url).toBe(SITE);
  });

  it("includes an Offer with the exact numeric price when purchasable", () => {
    const data = build(makeCourse({ priceAmountMinor: 14900, currency: "USD" }));
    const offer = data.offers as Record<string, unknown>;
    expect(offer["@type"]).toBe("Offer");
    expect(offer.price).toBe("149.00");
    expect(offer.priceCurrency).toBe("USD");
    expect(offer.availability).toBe("https://schema.org/InStock");
    expect(offer.category).toBe("Paid");
    expect(offer.url).toBe(`${SITE}/courses/course-x`);
  });

  it("omits the Offer when the course is priced but NOT yet purchasable (checkout disabled)", () => {
    // The exact No-Invention regression: a priced course whose checkout is still
    // off renders "Checkout opening soon", so structured data must NOT advertise
    // an InStock Offer. purchasable=false must win even with a numeric price.
    const data = build(makeCourse({ priceAmountMinor: 14900 }), false);
    expect(data.offers).toBeUndefined();
    expect(data["@type"]).toBe("Course");
    expect(data.name).toBe("Course X");
  });

  it("omits the Offer entirely for a null (to-be-announced) price", () => {
    const data = build(
      makeCourse({ priceAmountMinor: null, priceLabel: "Price to be announced" }),
    );
    expect(data.offers).toBeUndefined();
  });

  it("marks a zero price as a Free offer when purchasable", () => {
    const data = build(makeCourse({ priceAmountMinor: 0 }));
    const offer = data.offers as Record<string, unknown>;
    expect(offer.price).toBe("0.00");
    expect(offer.category).toBe("Free");
  });

  it("NEVER emits aggregateRating or review (the catalog carries no ratings)", () => {
    const data = build(makeCourse());
    expect(data.aggregateRating).toBeUndefined();
    expect(data.review).toBeUndefined();
  });

  it("NEVER emits hasCourseInstance (durationLabel is not an ISO-8601 workload)", () => {
    const data = build(makeCourse());
    expect(data.hasCourseInstance).toBeUndefined();
  });

  it("absolutizes a relative image but leaves an http(s) image untouched", () => {
    expect(build(makeCourse({ image: "/courses/x.jpg" })).image).toBe(
      `${SITE}/courses/x.jpg`,
    );
    const remote = "https://cdn.example.com/x.jpg";
    expect(build(makeCourse({ image: remote })).image).toBe(remote);
  });

  it("omits teaches when a course has no outcomes", () => {
    const data = build(makeCourse({ outcomes: [] }));
    expect(data.teaches).toBeUndefined();
  });
});
