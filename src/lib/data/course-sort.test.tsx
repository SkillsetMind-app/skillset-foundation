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
    featured: partial.featured,
    featuredRank: partial.featuredRank,
  };
}

const titles = (cards: CourseCard[]) => cards.map((c) => c.title);

describe("course-sort", () => {
  it("defaults to the featured discovery mode (marketplace seeds sortKey to it)", () => {
    // The very first option must be 'featured' — the marketplace seeds sortKey
    // to it. While no course is featured this is byte-identical to A->Z, so it
    // is a zero-regression default that only surfaces ops curation once it exists.
    const expectedDefault: CourseSortKey = "featured";
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

  it("featured mode equals plain alphabetical when nothing is featured (zero regression)", () => {
    const input = [card({ title: "Zebra" }), card({ title: "Alpha" }), card({ title: "Mango" })];
    // No card carries `featured`, so the featured slice is empty and the result
    // must match the historical default A->Z order exactly.
    expect(titles(sortCourseCards(input, "featured"))).toEqual(
      titles(sortCourseCards(input, "alpha")),
    );
  });

  it("featured mode pins featured courses above the rest", () => {
    const input = [
      card({ title: "Alpha" }),
      card({ title: "Zebra", featured: true }),
      card({ title: "Mango" }),
    ];
    // Zebra is featured, so it leads despite being last alphabetically; the
    // non-featured remainder follows in A->Z order.
    expect(titles(sortCourseCards(input, "featured"))).toEqual(["Zebra", "Alpha", "Mango"]);
  });

  it("orders featured courses by featuredRank (lower first), then title", () => {
    const input = [
      card({ title: "RankTwo", featured: true, featuredRank: 2 }),
      card({ title: "NoRank", featured: true }), // missing rank sinks below ranked
      card({ title: "RankOne", featured: true, featuredRank: 1 }),
      card({ title: "Plain" }),
    ];
    expect(titles(sortCourseCards(input, "featured"))).toEqual([
      "RankOne",
      "RankTwo",
      "NoRank",
      "Plain",
    ]);
  });

  it("breaks featuredRank ties by title", () => {
    const input = [
      card({ title: "Bravo", featured: true, featuredRank: 5 }),
      card({ title: "Alpha", featured: true, featuredRank: 5 }),
    ];
    expect(titles(sortCourseCards(input, "featured"))).toEqual(["Alpha", "Bravo"]);
  });

  it("explicit sorts stay PURE — featured does not jump a price/rating sort", () => {
    const input = [
      card({ title: "FeaturedPricey", featured: true, featuredRank: 0, priceAmountMinor: 9900 }),
      card({ title: "PlainCheap", priceAmountMinor: 1900 }),
    ];
    // A user who explicitly picks price-asc gets exactly that: the cheap course
    // leads even though the pricey one is featured. Featuring only governs the
    // dedicated "featured" discovery mode, not the data sorts.
    expect(titles(sortCourseCards(input, "price-asc"))).toEqual([
      "PlainCheap",
      "FeaturedPricey",
    ]);
  });

  it("featured mode is pure — does not mutate the input array", () => {
    const input = [
      card({ title: "B", featured: true }),
      card({ title: "A" }),
    ];
    const before = titles(input);
    sortCourseCards(input, "featured");
    expect(titles(input)).toEqual(before);
  });
});
