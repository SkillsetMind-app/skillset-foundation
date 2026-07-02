import { getFeaturedCourseCards, getProductSurfaces } from "@/lib/data/catalog";
import type { Permission } from "@/lib/permissions";

export type Track = {
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
};

export type Surface = {
  title: string;
  href: string;
  label: string;
  summary: string;
};

export type PlatformNavContext = "learner" | "teacher" | "ops";

export type PlatformNavItem = {
  href: string;
  label: string;
  /** Lucide icon key — resolved to a component in platform-nav.tsx. */
  icon: string;
  /** Which workspace context(s) this item belongs to. */
  contexts: readonly PlatformNavContext[];
  /** Section label; an uppercase header is drawn when the section changes. */
  section: string;
  permission?: Permission;
  /**
   * Opens in a new browser tab with an external-link affordance. Used for
   * cross-surface jumps (e.g. a teacher hopping into the student classroom)
   * so the studio tab is preserved.
   */
  newTab?: boolean;
};

export const featuredTracks: Track[] = getFeaturedCourseCards();

export const productSurfaces: Surface[] = getProductSurfaces().map(
  ({ title, href, label, summary }) => ({ title, href, label, summary }),
);

export const marketplaceHighlights = [
  "Professional programs across leadership, psychology, health, and management",
  "Experienced instructors with practical and academic credibility",
  "A learning experience shaped for clarity, support, and momentum",
  "Designed for international learners and educators",
];

export const platformNav: PlatformNavItem[] = [
  // --- Learner workspace ---
  {
    href: "/learn",
    label: "Classroom",
    icon: "BookOpen",
    contexts: ["learner"],
    section: "Learn",
    permission: "courses.viewLearning",
  },
  {
    href: "/learn/community",
    label: "Communities",
    icon: "Users",
    contexts: ["learner"],
    section: "Learn",
    permission: "community.read",
  },
  {
    href: "/learn/wishlist",
    label: "Wishlist",
    icon: "Bookmark",
    contexts: [],
    section: "Learn",
    permission: "courses.viewLearning",
  },
  {
    href: "/learn/events",
    label: "Agenda",
    icon: "Calendar",
    contexts: ["learner"],
    section: "Learn",
    permission: "courses.viewLearning",
  },
  {
    href: "/learn/credentials",
    label: "Credentials",
    icon: "Award",
    contexts: ["learner"],
    section: "Learn",
    permission: "certificates.view",
  },
  // --- Teacher-as-student: a teacher also buys courses. Pinned to the very top
  // of the teacher workspace (its own "My Learning" section is ordered first in
  // platform-nav.tsx), above the teaching tools. Reuses the learner classroom. ---
  {
    href: "/learn",
    label: "My courses",
    icon: "GraduationCap",
    contexts: [],
    section: "My Learning",
    permission: "courses.viewLearning",
    newTab: true,
  },
  // --- Teacher workspace ---
  {
    href: "/teach",
    label: "Studio",
    icon: "LayoutDashboard",
    contexts: ["teacher"],
    section: "Teach",
    permission: "teacherStudio.access",
  },
  {
    href: "/teach/builder",
    label: "Course Builder",
    icon: "BookOpen",
    contexts: ["teacher"],
    section: "Teach",
    permission: "teacherStudio.manageCourses",
  },
  {
    href: "/teach/events",
    label: "Agenda",
    icon: "Calendar",
    contexts: ["teacher"],
    section: "Teach",
    permission: "teacherStudio.manageCourses",
  },
  {
    href: "/teach/messages",
    label: "Messages",
    icon: "MessageCircle",
    contexts: ["teacher"],
    section: "Teach",
    permission: "teacherStudio.access",
  },
  {
    href: "/teach/coupons",
    label: "Coupons",
    icon: "Tag",
    contexts: [],
    section: "Growth",
    permission: "teacherStudio.manageCourses",
  },
  {
    href: "/teach/co-productions",
    label: "Co-productions",
    icon: "Users",
    contexts: [],
    section: "Growth",
    permission: "teacherStudio.access",
  },
  {
    href: "/teach/refunds",
    label: "Reviews & refunds",
    icon: "RefreshCw",
    contexts: ["teacher"],
    section: "Teach",
    permission: "teacherStudio.access",
  },
  {
    href: "/teach/team",
    label: "Team",
    icon: "UserCheck",
    contexts: [],
    section: "Setup",
    permission: "teacherStudio.access",
  },
  {
    href: "/teach/integrations",
    label: "Integrations",
    icon: "Plug",
    contexts: [],
    section: "Setup",
    permission: "teacherStudio.access",
  },
  // --- Operations workspace ---
  {
    href: "/ops",
    label: "Operations",
    icon: "Settings",
    contexts: ["ops"],
    section: "Operations",
    permission: "platform.accessAdmin",
  },
  // --- Shared across every workspace ---
  {
    href: "/courses",
    label: "Marketplace",
    icon: "ShoppingBag",
    contexts: ["learner", "teacher", "ops"],
    section: "Discover",
  },
  {
    href: "/account",
    label: "Settings",
    icon: "Settings",
    contexts: [],
    section: "Account",
  },
  {
    href: "/account/plans",
    label: "Plans & fees",
    icon: "Receipt",
    contexts: [],
    section: "Account",
  },
  {
    href: "/account/payments",
    label: "Payouts & tax",
    icon: "CreditCard",
    contexts: [],
    section: "Account",
    permission: "teacherStudio.access",
  },
  {
    href: "/account/billing",
    label: "Billing",
    icon: "Receipt",
    contexts: [],
    section: "Account",
  },
];
