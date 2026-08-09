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
  "Professional programs across coaching, leadership, wellbeing, and management",
  "Experienced instructors with practical, verifiable credibility",
  "A learning experience shaped for clarity, support, and momentum",
  "Designed for international learners and instructors",
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
    // Title source only — see the note above the Account block. The wishlist
    // link lives in the account dropdown, not the learner sidebar.
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
    icon: "House",
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
    // Matches the page's own gate (manageStorefront). They agree today for
    // every role, but a nav entry that gates on a different permission than
    // its destination is a denial screen waiting for the first role split.
    permission: "teacherStudio.manageStorefront",
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
  // No "Reviews & refunds" entry: /teach/refunds is a bare redirect to
  // /account/payments, so the menu item promised a screen that does not exist
  // and dropped the creator on Earnings with no refund surface in sight. The
  // route itself stays as a redirect for old bookmarks. Under direct charges a
  // refund debits the creator's OWN Stripe balance, which is more reason to
  // build them a real refund screen, not less — until then the nav says nothing
  // rather than something false.
  // Earnings — a record of what Stripe already paid into the creator's own
  // connected account. Called "Wallet" until the pivot to direct charges, which
  // is a word for a balance the platform holds. We hold nothing, so the nav no
  // longer says we do.
  {
    href: "/account/payments",
    labelKey: "platform.nav.earnings",
    icon: "TrendingUp",
    contexts: ["teacher"],
    section: "Earnings",
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
  // No "Business overview" entry: /teach/operations rendered the exact same
  // <CreatorOpsHub /> as /teach/reports above it — two adjacent menu items, one
  // screen. Two names for one page reads as an unfinished product. The route
  // stays as a redirect for old bookmarks, same as /teach/refunds.
  // Growth
  // (Affiliates and co-productions were removed with the pivot to direct
  // charges: the platform never holds the money, so it cannot split it.)
  {
    href: "/teach/coupons",
    labelKey: "platform.nav.coupons",
    icon: "Tag",
    contexts: ["teacher"],
    section: "Growth",
    permission: "teacherStudio.manageCourses",
  },
  {
    href: "/teach/team",
    labelKey: "platform.nav.team",
    icon: "UserCheck",
    contexts: ["teacher"],
    section: "Growth",
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
  // `contexts: []` is not a disabled entry — it means "title source only".
  // platform-nav filters by context, so these never render in a sidebar, but
  // platform-header's getPageLabel scans the whole list to translate the page
  // title. Their links live in the account dropdown instead. Removing them
  // would degrade these headers to a slugified URL segment in every language.
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
  {
    // The only /account subpage that renders its own PlatformShell instead of
    // redirecting into a tab, so it was the only one whose header fell back to
    // the slugified URL segment — untranslated in Spanish. Reuses the existing
    // notifications-panel title rather than minting a duplicate key.
    href: "/account/notifications",
    labelKey: "platform.notifications.title",
    icon: "Bell",
    contexts: [],
    section: "Account",
  },
];
