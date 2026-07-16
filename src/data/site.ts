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
  /** Dictionary key for the visible label (resolved with t() at render time). */
  labelKey: string;
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
  ({ title, href, label, summary }) => ({ title, href, label, summary })
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
    labelKey: "platform.nav.classroom",
    icon: "BookOpen",
    contexts: ["learner"],
    section: "Learn",
    permission: "courses.viewLearning",
  },
  {
    href: "/learn/community",
    labelKey: "platform.nav.communities",
    icon: "Users",
    contexts: ["learner"],
    section: "Learn",
    permission: "community.read",
  },
  {
    href: "/learn/wishlist",
    labelKey: "platform.nav.wishlist",
    icon: "Bookmark",
    contexts: [],
    section: "Learn",
    permission: "courses.viewLearning",
  },
  {
    href: "/learn/events",
    labelKey: "platform.nav.agenda",
    icon: "Calendar",
    contexts: ["learner"],
    section: "Learn",
    permission: "courses.viewLearning",
  },
  {
    href: "/learn/credentials",
    labelKey: "platform.nav.credentials",
    icon: "Award",
    contexts: ["learner"],
    section: "Learn",
    permission: "certificates.view",
  },
  // --- Teacher-as-student: a teacher also buys courses. Kept as a direct
  // workspace destination after the producer tools. Reuses the learner classroom. ---
  {
    href: "/learn",
    labelKey: "platform.nav.myCourses",
    icon: "GraduationCap",
    contexts: ["teacher"],
    section: "My Learning",
    permission: "courses.viewLearning",
    newTab: true,
  },
  // --- Teacher workspace: workflow hierarchy informed by the live producer
  // audit, using only SkillsetMind routes and capabilities. ---
  {
    href: "/teach",
    labelKey: "platform.nav.studio",
    icon: "LayoutDashboard",
    contexts: ["teacher"],
    section: "Home",
    permission: "teacherStudio.access",
  },
  // Products
  {
    href: "/teach/builder",
    labelKey: "platform.nav.courseBuilder",
    icon: "BookOpen",
    contexts: ["teacher"],
    section: "Products",
    permission: "teacherStudio.manageCourses",
  },
  {
    href: "/teach/members",
    labelKey: "platform.nav.membersArea",
    icon: "Image",
    contexts: ["teacher"],
    section: "Products",
    permission: "teacherStudio.manageCourses",
  },
  {
    href: "/teach/events",
    labelKey: "platform.nav.onlineEvents",
    icon: "Calendar",
    contexts: ["teacher"],
    section: "Products",
    permission: "teacherStudio.manageCourses",
  },
  {
    href: "/teach/marketing",
    labelKey: "platform.nav.marketingOverview",
    icon: "Megaphone",
    contexts: ["teacher"],
    section: "Marketing",
    permission: "teacherStudio.access",
  },
  {
    href: "/teach/storefront",
    labelKey: "platform.nav.storefrontPages",
    icon: "Store",
    contexts: ["teacher"],
    section: "Marketing",
    permission: "teacherStudio.manageCourses",
  },
  {
    href: "/teach/media",
    labelKey: "platform.nav.mediaLibrary",
    icon: "Image",
    contexts: ["teacher"],
    section: "Marketing",
    permission: "teacherStudio.manageCourses",
  },
  {
    href: "/teach/messages",
    labelKey: "platform.nav.messages",
    icon: "MessageCircle",
    contexts: ["teacher"],
    section: "Marketing",
    permission: "teacherStudio.access",
  },
  // Sales
  {
    href: "/teach/sales",
    labelKey: "platform.nav.sales",
    icon: "Receipt",
    contexts: ["teacher"],
    section: "Sales",
    permission: "teacherStudio.access",
  },
  {
    href: "/teach/subscriptions",
    labelKey: "platform.nav.subscriptions",
    icon: "Repeat2",
    contexts: ["teacher"],
    section: "Sales",
    permission: "teacherStudio.access",
  },
  {
    href: "/teach/refunds",
    labelKey: "platform.nav.reviewsRefunds",
    icon: "RefreshCw",
    contexts: ["teacher"],
    section: "Sales",
    permission: "teacherStudio.access",
  },
  // Wallet (receivables)
  {
    href: "/account/payments",
    labelKey: "platform.nav.wallet",
    icon: "Wallet",
    contexts: ["teacher"],
    section: "Wallet",
    permission: "teacherStudio.access",
  },
  // Reports
  {
    href: "/teach/reports",
    labelKey: "platform.nav.reports",
    icon: "BarChart3",
    contexts: ["teacher"],
    section: "Reports",
    permission: "teacherStudio.access",
  },
  {
    href: "/teach/operations",
    labelKey: "platform.nav.creatorOps",
    icon: "LayoutDashboard",
    contexts: ["teacher"],
    section: "Reports",
    permission: "teacherStudio.access",
  },
  // Partnerships
  {
    href: "/teach/affiliates",
    labelKey: "platform.nav.affiliatePrograms",
    icon: "Handshake",
    contexts: ["teacher"],
    section: "Partnerships",
    permission: "teacherStudio.access",
  },
  {
    href: "/teach/coupons",
    labelKey: "platform.nav.coupons",
    icon: "Tag",
    contexts: ["teacher"],
    section: "Partnerships",
    permission: "teacherStudio.manageCourses",
  },
  {
    href: "/teach/co-productions",
    labelKey: "platform.nav.coProductions",
    icon: "Users",
    contexts: ["teacher"],
    section: "Partnerships",
    permission: "teacherStudio.access",
  },
  {
    href: "/teach/team",
    labelKey: "platform.nav.team",
    icon: "UserCheck",
    contexts: ["teacher"],
    section: "Partnerships",
    permission: "teacherStudio.access",
  },
  // Tools
  {
    href: "/teach/verification",
    labelKey: "platform.nav.verification",
    icon: "UserCheck",
    contexts: ["teacher"],
    section: "Tools",
    permission: "teacherStudio.access",
  },
  {
    href: "/teach/integrations",
    labelKey: "platform.nav.integrations",
    icon: "Plug",
    contexts: ["teacher"],
    section: "Tools",
    permission: "teacherStudio.access",
  },
  // --- Operations workspace ---
  {
    href: "/ops",
    labelKey: "platform.nav.operations",
    icon: "Settings",
    contexts: ["ops"],
    section: "Operations",
    permission: "platform.accessAdmin",
  },
  // --- Shared across every workspace ---
  {
    href: "/courses",
    labelKey: "platform.nav.marketplace",
    icon: "ShoppingBag",
    contexts: ["learner", "teacher", "ops"],
    section: "Discover",
  },
  {
    href: "/account",
    labelKey: "platform.nav.settings",
    icon: "Settings",
    contexts: [],
    section: "Account",
  },
  {
    href: "/account/plans",
    labelKey: "platform.nav.plansFees",
    icon: "Receipt",
    contexts: [],
    section: "Account",
  },
  {
    href: "/account/payments",
    labelKey: "platform.nav.payoutsTax",
    icon: "CreditCard",
    contexts: [],
    section: "Account",
    permission: "teacherStudio.access",
  },
  {
    href: "/account/billing",
    labelKey: "platform.nav.billing",
    icon: "Receipt",
    contexts: [],
    section: "Account",
  },
];
