import type { ProductSurface } from "@/domain/learning";

export const demoProductSurfaces: ProductSurface[] = [
  {
    title: "Learning Hub",
    href: "/learn",
    label: "For learners",
    summary:
      "A focused member area for active courses, progress, events, community, and certificates.",
    modules: ["My learning", "Course player", "Progress", "Events", "Credentials"],
  },
  {
    title: "Educator Studio",
    href: "/teach",
    label: "For educators",
    summary:
      "A guided workspace for creating courses, managing students, scheduling live sessions, and publishing with quality.",
    modules: ["Course builder", "Media", "Events", "Students", "Publishing checklist"],
  },
  {
    title: "Support and Operations",
    href: "/ops",
    label: "For the team",
    summary:
      "Internal queues for professional verification, support, moderation, certificates, and payment oversight.",
    modules: ["Verification", "Moderation", "Support", "Payments", "Audit"],
  },
];
