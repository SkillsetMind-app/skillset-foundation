import type { CourseCard } from "@/lib/data/catalog";

// Marketplace sort. "featured" is the default discovery mode: editorial picks
// (ops-curated `featured` flag) lead, then the rest A->Z — when nothing is
// featured it is byte-identical to plain alphabetical, so it is a no-op until
// ops curate. The explicit data sorts (rating / price) stay PURE: a user who
// picks "Price: low to high" gets exactly that, with no featured pinning jumping
// the order. "trending" (activity-metric aggregation) is still a separate
// follow-up and intentionally absent here.
export type CourseSortKey =
  | "featured"
  | "alpha"
  | "rating"
  | "price-asc"
  | "price-desc";

export const courseSortOptions: { value: CourseSortKey; label: string }[] = [
  { value: "featured", label: "Featured & top picks" },
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

function isFeatured(card: CourseCard): boolean {
  return card.featured === true;
}

// Featured discovery: ops-featured cards lead, ordered by `featuredRank` (lower =
// higher; missing rank sinks below any explicit rank), then A->Z; non-featured
// follow A->Z. Pure and total. When no card is featured the featured slice is
// empty, so the result equals plain alphabetical — the historical default order.
function sortFeaturedFirst(courses: CourseCard[]): CourseCard[] {
  const featured = courses
    .filter(isFeatured)
    .sort((left, right) => {
      const leftRank = left.featuredRank ?? Number.MAX_SAFE_INTEGER;
      const rightRank = right.featuredRank ?? Number.MAX_SAFE_INTEGER;
      if (leftRank !== rightRank) return leftRank - rightRank;
      return compareCourseTitle(left, right);
    });
  const rest = courses.filter((card) => !isFeatured(card)).sort(compareCourseTitle);
  return [...featured, ...rest];
}

/**
 * Return a new array of cards ordered by the chosen key. Pure and total:
 * - "featured" leads with ops-curated picks (by rank, then A->Z), rest A->Z;
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
    case "featured":
      return sortFeaturedFirst(next);
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
