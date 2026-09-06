import type { skillsetCourseCategories } from "@/domain/teacher-course";

const categoryKeys = {
  "Applied Psychology & Behavior": "psychology",
  "Hypnosis & Guided Change": "hypnosis",
  "Integrative & Holistic Practices": "holistic",
  "Family Constellations & Systemic Work": "systemic",
  "Emotional Resilience & Wellbeing": "wellbeing",
  "Personal Development": "development",
  "Coaching as a Business": "business",
  "Mentorship & Professional Growth": "mentorship",
} satisfies Record<(typeof skillsetCourseCategories)[number], string>;

// Only platform-defined categories have translated labels. Creator-written
// categories remain content, and callers keep the original value for filters.
export function getCourseCategoryLabel(category: string, t: (key: string) => string): string {
  return Object.hasOwn(categoryKeys, category)
    ? t(`publicCourses.categories.${categoryKeys[category as keyof typeof categoryKeys]}`)
    : category;
}
