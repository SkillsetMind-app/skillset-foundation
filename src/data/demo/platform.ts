import type { CommunitySpace, LiveEvent, ProductSurface } from "@/domain/learning";

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

export const demoCommunitySpaces: CommunitySpace[] = [
  {
    id: "community-leadership-development",
    courseSlug: "leadership-development",
    name: "Leadership Practice Circle",
    description:
      "A course-linked space for questions, weekly reflections, resources, and live session follow-ups.",
    visibility: "enrolled_only",
    categories: ["announcement", "discussion", "question", "resource"],
  },
  {
    id: "community-effective-communication",
    courseSlug: "effective-communication",
    name: "Communication Lab",
    description:
      "A practical discussion space for presentation drills, peer feedback, and communication challenges.",
    visibility: "enrolled_only",
    categories: ["announcement", "discussion", "question", "resource"],
  },
];

export const demoLiveEvents: LiveEvent[] = [
  {
    id: "event-leadership-office-hours",
    courseSlug: "leadership-development",
    title: "Leadership office hours",
    type: "office_hours",
    timingLabel: "Weekly live session",
    delivery: "external_link",
  },
  {
    id: "event-communication-workshop",
    courseSlug: "effective-communication",
    title: "Presentation practice workshop",
    type: "live_class",
    timingLabel: "Monthly workshop",
    delivery: "recording_upload",
  },
];
