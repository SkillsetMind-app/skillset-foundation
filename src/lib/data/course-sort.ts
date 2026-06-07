import type { CourseCard } from "@/lib/data/catalog";

// Marketplace sort is purely additive discovery. The default ("alpha")
// preserves the exact A->Z order the catalog has always shipped, so leaving the
// control untouched is a no-op. Every option ranks on data already present on
// the card (price / rating) — deliberately NO "trending" or editorial
// "featured", since those need activity-metric aggregation / a curation
// decision that does not exist yet.
export type CourseSortKey = "alpha" | "rating" | "price-asc" | "price-desc";

export const courseSortOptions: { value: CourseSortKey; label: string }[] = [
  { value: "alpha", label: "Alphabetical (A–Z)" },
  { value: "rating", label: "Top rated" },
  { value: "price-asc", label: "Price: low to high" },
  { value: "price-desc", label: "Price: high to low" },
];

// Deterministic tiebreaker so the grid never reshuffles between renders when the
// primary signal ties or is absent.
function compareCourseTitle(left: CourseCard, right: CourseCard): number {
  return left.title.localeCompare(right.title);
}

/**
 * Return a new array of cards ordered by the chosen key. Pure and total:
 * - missing rating (`ratingAverage` undefined) sorts below any rated course;
 * - missing price ("Enrollment opening soon") sinks to the end in BOTH price
 *   directions, so the priced catalog always leads;
 * - title is the final tiebreaker in every mode for stable, repeatable order.
 */
export function sortCourseCards(
  courses: CourseCard[],
  sortKey: CourseSortKey,
): CourseCard[] {
  const next = [...courses];

  switch (sortKey) {
    case "rating":
      return next.sort((left, right) => {
        const ratingDelta = (right.ratingAverage ?? -1) - (left.ratingAverage ?? -1);
        if (ratingDelta !== 0) return ratingDelta;
        const countDelta = (right.ratingCount ?? 0) - (left.ratingCount ?? 0);
        if (countDelta !== 0) return countDelta;
        return compareCourseTitle(left, right);
      });
    case "price-asc":
    case "price-desc": {
      const direction = sortKey === "price-asc" ? 1 : -1;
      return next.sort((left, right) => {
        const leftPrice =
          typeof left.priceAmountMinor === "number" ? left.priceAmountMinor : null;
        const rightPrice =
          typeof right.priceAmountMinor === "number" ? right.priceAmountMinor : null;
        if (leftPrice === null && rightPrice === null) return compareCourseTitle(left, right);
        if (leftPrice === null) return 1;
        if (rightPrice === null) return -1;
        if (leftPrice !== rightPrice) return (leftPrice - rightPrice) * direction;
        return compareCourseTitle(left, right);
      });
    }
    case "alpha":
    default:
      return next.sort(compareCourseTitle);
  }
}
