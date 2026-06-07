import { describe, expect, it } from "vitest";

import type { CourseCard } from "@/lib/data/catalog";
import {
  courseSortOptions,
  sortCourseCards,
  type CourseSortKey,
} from "@/lib/data/course-sort";

function card(partial: Partial<CourseCard> & { title: string }): CourseCard {
  return {
    slug: partial.slug ?? partial.title.toLowerCase().replace(/\s+/g, "-"),
    title: partial.title,
    category: partial.category ?? "Business and management",
    duration: partial.duration ?? "8 lessons",
    status: partial.status ?? "Creator course",
    summary: partial.summary ?? "Summary",
    image: partial.image ?? "/brand/logo-mark.png",
    detail: partial.detail ?? "Detail",
    priceLabel: partial.priceLabel ?? "$49.00",
    freePreviewLabel: partial.freePreviewLabel ?? "Preview coming soon",
    hasPaidAccess: partial.hasPaidAccess ?? false,
    href: partial.href,
    freePreviewHref: partial.freePreviewHref,
    sourceLabel: partial.sourceLabel,
    ratingLabel: partial.ratingLabel,
    priceAmountMinor: partial.priceAmountMinor,
    ratingAverage: partial.ratingAverage,
    ratingCount: partial.ratingCount,
  };
}

const titles = (cards: CourseCard[]) => cards.map((c) => c.title);

describe("course-sort", () => {
  it("defaults to alphabetical so an untouched control is a no-op", () => {
    // The very first option must be 'alpha' — the marketplace seeds sortKey to
    // it, preserving the catalog's long-standing A->Z order (zero regression).
    const expectedDefault: CourseSortKey = "alpha";
    expect(courseSortOptions[0].value).toBe(expectedDefault);
  });

  it("sorts alphabetically by title (A->Z)", () => {
    const input = [card({ title: "Zebra" }), card({ title: "Alpha" }), card({ title: "Mango" })];
    expect(titles(sortCourseCards(input, "alpha"))).toEqual(["Alpha", "Mango", "Zebra"]);
  });

  it("ranks by rating descending, with unrated courses last", () => {
    const input = [
      card({ title: "NoRating" }), // ratingAverage undefined
      card({ title: "Low", ratingAverage: 3.2, ratingCount: 10 }),
      card({ title: "High", ratingAverage: 4.9, ratingCount: 5 }),
    ];
    expect(titles(sortCourseCards(input, "rating"))).toEqual(["High", "Low", "NoRating"]);
  });

  it("breaks rating ties by review count, then title", () => {
    const input = [
      card({ title: "Bravo", ratingAverage: 4.5, ratingCount: 8 }),
      card({ title: "Alpha", ratingAverage: 4.5, ratingCount: 8 }),
      card({ title: "Charlie", ratingAverage: 4.5, ratingCount: 40 }),
    ];
    // Charlie wins on count; Alpha before Bravo on the title tiebreaker.
    expect(titles(sortCourseCards(input, "rating"))).toEqual(["Charlie", "Alpha", "Bravo"]);
  });

  it("sorts by price ascending with unpriced courses last", () => {
    const input = [
      card({ title: "Free-ish", priceAmountMinor: null }), // "opening soon"
      card({ title: "Pricey", priceAmountMinor: 9900 }),
      card({ title: "Cheap", priceAmountMinor: 1900 }),
    ];
    expect(titles(sortCourseCards(input, "price-asc"))).toEqual(["Cheap", "Pricey", "Free-ish"]);
  });

  it("sorts by price descending but STILL keeps unpriced courses last", () => {
    const input = [
      card({ title: "Unset", priceAmountMinor: null }),
      card({ title: "Cheap", priceAmountMinor: 1900 }),
      card({ title: "Pricey", priceAmountMinor: 9900 }),
    ];
    // Unpriced sinks to the end in BOTH directions, so the priced catalog leads.
    expect(titles(sortCourseCards(input, "price-desc"))).toEqual(["Pricey", "Cheap", "Unset"]);
  });

  it("is pure — does not mutate the input array", () => {
    const input = [card({ title: "B" }), card({ title: "A" })];
    const before = titles(input);
    sortCourseCards(input, "alpha");
    expect(titles(input)).toEqual(before);
  });
});
