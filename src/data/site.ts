import {
  hasPermission,
  hasRole,
  type Permission,
  type PermissionSubject,
  type Role,
} from "@/lib/permissions";

export type PlatformNavContext = "learner" | "teacher" | "ops";
export type PlatformNavCount = number | "loading" | "unavailable";
export type PlatformNavCounts = Partial<Record<string, PlatformNavCount>>;

export type PlatformNavItem = {
  href: string;
  /** Dictionary key for the visible label (resolved with t() at render time). */
  labelKey: string;
  /** Lucide icon key — resolved to a component in platform-nav.tsx. */
  icon: string;
  /** Which workspace context(s) this item belongs to. */
  contexts: readonly PlatformNavContext[];
  /** Group of the sidebar; the label is `platform.navSection.<sectionKey>`. */
  sectionKey: string;
  permission?: Permission;
  /** Hidden from accounts that hold this permission: lets one page carry a
   *  learner label and a teacher label as two entries with the same href. */
  hiddenWithPermission?: Permission;
  /** Additional role scope when the backing queue has narrower RLS policies. */
  roles?: readonly Role[];
};

// These are the existing ?tab= destinations. Navigation, panels and counters
// share the workspace gate AND the roles that can read each complete queue.
// Overview reads users, orders, enrollments and the audit log: admin-only RLS.
const opsQueues = [
  { tab: "overview", icon: "LayoutDashboard", roles: ["admin"] },
  { tab: "verification", icon: "UserCheck", roles: ["admin", "ops"] },
  { tab: "catalog", icon: "BookOpen", roles: ["admin", "ops"] },
  { tab: "payments", icon: "CreditCard", roles: ["admin"] },
  { tab: "community", icon: "Flag", roles: ["admin", "support", "moderator"] },
  { tab: "support", icon: "LifeBuoy", roles: ["admin", "support"] },
  { tab: "users", icon: "Users", roles: ["admin"] },
  { tab: "audit", icon: "ClipboardList", roles: ["admin"] },
  { tab: "access", icon: "ShieldCheck", roles: ["admin"] },
] as const satisfies readonly { tab: string; icon: string; roles: readonly Role[] }[];

export type OpsQueue = (typeof opsQueues)[number]["tab"];

export const opsNavItems: readonly (PlatformNavItem & { tab: OpsQueue })[] = opsQueues.map(
  (queue) => ({
    ...queue,
    href: `/ops?tab=${queue.tab}`,
    labelKey: `platform.ops.${queue.tab}`,
    contexts: ["ops"],
    sectionKey: "operations",
    permission: "platform.accessAdmin",
  }),
);

export function canAccessPlatformNavItem(
  subject: PermissionSubject | null | undefined,
  item: PlatformNavItem,
): boolean {
  return (
    (!item.permission || hasPermission(subject, item.permission)) &&
    !isPlatformNavItemHidden(subject, item) &&
    (!item.roles || item.roles.some((role) => hasRole(subject, role)))
  );
}

export function isPlatformNavItemHidden(
  subject: PermissionSubject | null | undefined,
  item: PlatformNavItem,
): boolean {
  return Boolean(item.hiddenWithPermission && hasPermission(subject, item.hiddenWithPermission));
}

// A known ?tab= wins (the dashboard explains when the role cannot open it).
// Without one, each person lands on the first destination they can open:
// Overview for admins, the first queue for the rest of the staff.
export function getOpsNavItem(tab: string | null, subject?: PermissionSubject | null) {
  return opsNavItems.find((item) => item.tab === tab)
    ?? opsNavItems.find((item) => canAccessPlatformNavItem(subject, item))
    ?? opsNavItems[0];
}

// List order = order in the bar within each section; the order of the sections
// lives in platform-nav.tsx (sectionOrder). `contexts: []` does not show in the bar,
// but stays here: platform-header's getPageLabel scans the whole list to
// translate the page title, and without the entry the header would fall back to a piece of the URL.
export const platformNav: PlatformNavItem[] = [
  // --- Learner: four fixed items (+ Help, which is a button and not a route).
  // "Classroom" used to be the name of the course LIST; the classroom is a different screen. ---
  {
    href: "/learn",
    labelKey: "platform.nav.myCourses",
    icon: "BookOpen",
    contexts: ["learner"],
    sectionKey: "learn",
    permission: "courses.viewLearning",
  },
  {
    // The learner's inbox: one conversation per course. It used to live in the
    // Account group, which is closed for people in "Learn".
    href: "/learn/messages",
    labelKey: "platform.nav.messages",
    icon: "MessageCircle",
    contexts: ["learner"],
    sectionKey: "learn",
    permission: "courses.viewLearning",
  },
  {
    href: "/learn/community",
    labelKey: "platform.nav.communities",
    icon: "Users",
    contexts: ["learner"],
    sectionKey: "learn",
    permission: "community.read",
  },
  {
    href: "/learn/credentials",
    labelKey: "platform.nav.credentials",
    icon: "Award",
    contexts: ["learner"],
    sectionKey: "learn",
    permission: "certificates.view",
  },
  {
    // Outside the bar: the upcoming lives show up in "My courses", with a link
    // to this page.
    href: "/learn/events",
    labelKey: "platform.nav.agenda",
    icon: "Calendar",
    contexts: [],
    sectionKey: "learn",
    permission: "courses.viewLearning",
  },
  {
    // The wishlist lives in the avatar menu.
    href: "/learn/wishlist",
    labelKey: "platform.nav.wishlist",
    icon: "Bookmark",
    contexts: [],
    sectionKey: "learn",
    permission: "courses.viewLearning",
  },
  // --- Teacher: eight items on the first level. Tools (Verification) and
  // plans went to the avatar menu; "Collaborators", "Integrations" and the
  // "Coupons" plate were removed (the routes redirect). Switching to the learner
  // side is the button at the top, not a link in the footer. ---
  {
    href: "/teach",
    labelKey: "platform.nav.studio",
    icon: "House",
    contexts: ["teacher"],
    sectionKey: "home",
    permission: "teacherStudio.access",
  },
  {
    href: "/teach/builder",
    labelKey: "platform.nav.courseBuilder",
    icon: "BookOpen",
    contexts: ["teacher"],
    sectionKey: "products",
    permission: "teacherStudio.manageCourses",
  },
  {
    href: "/teach/events",
    labelKey: "platform.nav.onlineEvents",
    icon: "Calendar",
    contexts: ["teacher"],
    sectionKey: "products",
    permission: "teacherStudio.manageCourses",
  },
  {
    // All the learners of all the products. "Members & communities" was a
    // list of PRODUCTS with that name; the route is still alive, outside the bar.
    href: "/teach/students",
    labelKey: "platform.nav.students",
    icon: "Users",
    contexts: ["teacher"],
    sectionKey: "students",
    permission: "teacherStudio.manageCourses",
  },
  {
    href: "/teach/members",
    labelKey: "platform.nav.membersArea",
    icon: "Users",
    contexts: [],
    sectionKey: "students",
    permission: "teacherStudio.manageCourses",
  },
  {
    // Messages + community questions. It used to be "Messages", hidden inside
    // the Marketing group.
    href: "/teach/messages",
    labelKey: "platform.nav.inbox",
    icon: "Inbox",
    contexts: ["teacher"],
    sectionKey: "inbox",
    permission: "teacherStudio.access",
  },
  {
    href: "/teach/sales",
    labelKey: "platform.nav.sales",
    icon: "Receipt",
    contexts: ["teacher"],
    sectionKey: "sales",
    permission: "teacherStudio.access",
  },
  {
    href: "/teach/subscriptions",
    labelKey: "platform.nav.subscriptions",
    icon: "Repeat2",
    contexts: ["teacher"],
    sectionKey: "sales",
    permission: "teacherStudio.access",
  },
  {
    href: "/teach/reports",
    labelKey: "platform.nav.reports",
    icon: "BarChart3",
    contexts: ["teacher"],
    sectionKey: "sales",
    permission: "teacherStudio.access",
  },
  // No "Reviews & refunds" entry: /teach/refunds is a bare redirect to
  // /account/payments, and /teach/operations redirects to /teach/reports.
  // Earnings — a record of what Stripe already paid into the creator's own
  // connected account. ONE name everywhere (bar, avatar, title, errors):
  // before, there were four ("Payments", "Earnings", "Payouts & tax", "Payouts panel").
  {
    href: "/account/payments",
    labelKey: "platform.nav.earnings",
    icon: "TrendingUp",
    contexts: ["teacher"],
    sectionKey: "earnings",
    permission: "teacherStudio.access",
  },
  // Promote: what makes the product get found. Coupons live inside
  // each product; /teach/coupons redirects to the product list.
  {
    href: "/teach/marketing",
    labelKey: "platform.nav.marketingOverview",
    icon: "Megaphone",
    contexts: ["teacher"],
    sectionKey: "promote",
    permission: "teacherStudio.access",
  },
  {
    href: "/teach/storefront",
    labelKey: "platform.nav.storefrontPages",
    icon: "Store",
    contexts: ["teacher"],
    sectionKey: "promote",
    // Matches the page's own gate (manageStorefront).
    permission: "teacherStudio.manageStorefront",
  },
  {
    href: "/teach/media",
    labelKey: "platform.nav.mediaLibrary",
    icon: "Image",
    contexts: ["teacher"],
    sectionKey: "promote",
    permission: "teacherStudio.manageCourses",
  },
  {
    // Avatar menu; here only as the source of the title.
    href: "/teach/verification",
    labelKey: "platform.nav.verification",
    icon: "UserCheck",
    contexts: [],
    sectionKey: "tools",
    permission: "teacherStudio.access",
  },
  // --- Operations workspace ---
  ...opsNavItems,
  {
    // Title source for /ops outside its dashboard; the nine tabs are the
    // actual sidebar destinations, so a second Operations link is redundant.
    href: "/ops",
    labelKey: "platform.nav.operations",
    icon: "Settings",
    contexts: [],
    sectionKey: "operations",
    permission: "platform.accessAdmin",
  },
  // --- Shared across every workspace ---
  {
    href: "/courses",
    labelKey: "platform.nav.marketplace",
    icon: "ShoppingBag",
    contexts: ["learner", "teacher", "ops"],
    sectionKey: "discover",
  },
  // --- Learner account, below the fixed items: purchases and settings. ---
  // Same page, two names: for the learner it only holds what they bought,
  // so it is called "My purchases"; the teacher still sees "Billing". The learner's
  // comes first: it is the title that getPageLabel finds while the role loads.
  {
    href: "/account/billing",
    labelKey: "platform.nav.myPurchases",
    icon: "Receipt",
    contexts: ["learner"],
    sectionKey: "account",
    hiddenWithPermission: "teacherStudio.access",
  },
  {
    href: "/account/billing",
    labelKey: "platform.nav.billing",
    icon: "Receipt",
    contexts: ["learner"],
    sectionKey: "account",
    permission: "teacherStudio.access",
  },
  {
    href: "/account",
    labelKey: "platform.nav.settings",
    icon: "Settings",
    contexts: ["learner"],
    sectionKey: "account",
  },
  {
    // The plans belong to whoever SELLS: only the teacher gets here, through the "Creator
    // plan" item in the avatar menu. Outside the bar (the learner read "Plans & fees" and
    // thought they had to pay a subscription).
    href: "/account/plans",
    labelKey: "platform.nav.plansFees",
    icon: "Receipt",
    contexts: [],
    sectionKey: "account",
    permission: "teacherStudio.access",
  },
  {
    // The only /account subpage that renders its own PlatformShell instead of
    // redirecting into a tab. Reached from the bell; kept as a title source.
    href: "/account/notifications",
    labelKey: "platform.notifications.title",
    icon: "Bell",
    contexts: [],
    sectionKey: "account",
  },
];
