import { demoCourses } from "@/data/demo/courses";
import { demoCommunitySpaces, demoLiveEvents, demoProductSurfaces } from "@/data/demo/platform";
import type { Course } from "@/domain/learning";

export type CourseCard = {
  slug: string;
  title: string;
  category: string;
  duration: string;
  status: string;
  summary: string;
  image: string;
  detail: string;
  priceLabel: string;
  freePreviewLabel: string;
  hasPaidAccess: boolean;
  href?: string;
  freePreviewHref?: string;
  sourceLabel?: string;
  ratingLabel?: string;
  // Dono do curso, quando o cartao vem de um curso publicado por professor.
  // O nome nao viaja aqui: o cartao resolve os perfis publicos em UMA consulta
  // por lista (useInstructorNames), em vez de uma por cartao.
  ownerId?: string;
  // Raw numeric signals carried alongside the display strings so the
  // marketplace can offer sort options (price, rating) without re-parsing the
  // formatted labels. Optional: static/demo cards may omit them, and the sort
  // comparators treat missing values as "lowest" so those cards sink to the end.
  priceAmountMinor?: number | null;
  currency?: string;
  lessonCount?: number;
  ratingAverage?: number;
  ratingCount?: number;
  // Editorial curation flags (ops-set). `featured` pins the card to the top of
  // the marketplace grid regardless of the active sort; `featuredRank` orders
  // featured cards among themselves (lower = higher). Demo/static cards omit
  // these, so the sort treats them as not-featured (no change to today's order).
  featured?: boolean;
  featuredRank?: number | null;
  // Server-computed popularity signals feeding the "Trending now" sort.
  // `trendingScore` = enrollments in the last 7 days; `enrollmentCount` =
  // lifetime enrollments (trending tiebreaker). Missing → treated as 0, so a
  // course with no activity (or a demo card) sinks under any with momentum.
  trendingScore?: number;
  enrollmentCount?: number;
};

export function getCourses(): Course[] {
  return demoCourses;
}

export function getCourseBySlug(slug: string): Course | undefined {
  return demoCourses.find((course) => course.slug === slug);
}

export function getCourseSlugs(): string[] {
  return demoCourses.map((course) => course.slug);
}

export function getFeaturedCourseCards(): CourseCard[] {
  return demoCourses.map((course) => ({
    slug: course.slug,
    title: course.title,
    category: course.category,
    duration: course.durationLabel,
    status: course.statusLabel,
    summary: course.summary,
    image: course.image,
    detail: course.detail,
    priceLabel: course.priceLabel,
    freePreviewLabel: course.freePreviewLabel,
    hasPaidAccess: course.priceAmountMinor !== null,
  }));
}

export function getProductSurfaces() {
  return demoProductSurfaces;
}

export function getCommunitySpaces() {
  return demoCommunitySpaces;
}

export function getLiveEvents() {
  return demoLiveEvents;
}
