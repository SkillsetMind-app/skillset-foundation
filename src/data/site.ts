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
  /** Additional role scope when the backing queue has narrower RLS policies. */
  roles?: readonly Role[];
  /**
   * Opens in a new browser tab with an external-link affordance. Used for
   * cross-surface jumps (e.g. a teacher hopping into the student classroom)
   * so the studio tab is preserved.
   */
  newTab?: boolean;
};

// These are the existing ?tab= destinations. Navigation, panels and counters
// share the workspace gate AND the roles that can read each complete queue.
const opsQueues = [
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
    (!item.roles || item.roles.some((role) => hasRole(subject, role)))
  );
}

export function getOpsNavItem(tab: string | null) {
  return opsNavItems.find((item) => item.tab === tab) ?? opsNavItems[0];
}

export const platformNav: PlatformNavItem[] = [
  // --- Learner workspace ---
  {
    href: "/learn",
    labelKey: "platform.nav.classroom",
    icon: "BookOpen",
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
    // Title source only — see the note above the Account block. The wishlist
    // link lives in the account dropdown, not the learner sidebar.
    href: "/learn/wishlist",
    labelKey: "platform.nav.wishlist",
    icon: "Bookmark",
    contexts: [],
    sectionKey: "learn",
    permission: "courses.viewLearning",
  },
  {
    href: "/learn/events",
    labelKey: "platform.nav.agenda",
    icon: "Calendar",
    contexts: ["learner"],
    sectionKey: "learn",
    permission: "courses.viewLearning",
  },
  {
    href: "/learn/credentials",
    labelKey: "platform.nav.credentials",
    icon: "Award",
    contexts: ["learner"],
    sectionKey: "learn",
    permission: "certificates.view",
  },
  // --- Teacher-as-student: a teacher also buys courses. Kept as a direct
  // workspace destination after the producer tools. Reuses the learner classroom. ---
  {
    href: "/learn",
    labelKey: "platform.nav.myCourses",
    icon: "GraduationCap",
    contexts: ["teacher"],
    sectionKey: "myLearning",
    permission: "courses.viewLearning",
  },
  // --- Teacher workspace: workflow hierarchy informed by the live producer
  // audit, using only SkillsetMind routes and capabilities. ---
  {
    href: "/teach",
    labelKey: "platform.nav.studio",
    icon: "House",
    contexts: ["teacher"],
    sectionKey: "home",
    permission: "teacherStudio.access",
  },
  // Products
  {
    href: "/teach/builder",
    labelKey: "platform.nav.courseBuilder",
    icon: "BookOpen",
    contexts: ["teacher"],
    sectionKey: "products",
    permission: "teacherStudio.manageCourses",
  },
  {
    href: "/teach/members",
    labelKey: "platform.nav.membersArea",
    icon: "Image",
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
    href: "/teach/marketing",
    labelKey: "platform.nav.marketingOverview",
    icon: "Megaphone",
    contexts: ["teacher"],
    sectionKey: "marketing",
    permission: "teacherStudio.access",
  },
  {
    href: "/teach/storefront",
    labelKey: "platform.nav.storefrontPages",
    icon: "Store",
    contexts: ["teacher"],
    sectionKey: "marketing",
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
    sectionKey: "marketing",
    permission: "teacherStudio.manageCourses",
  },
  {
    href: "/teach/messages",
    labelKey: "platform.nav.messages",
    icon: "MessageCircle",
    contexts: ["teacher"],
    sectionKey: "marketing",
    permission: "teacherStudio.access",
  },
  // Sales
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
    sectionKey: "earnings",
    permission: "teacherStudio.access",
  },
  // Reports
  {
    href: "/teach/reports",
    labelKey: "platform.nav.reports",
    icon: "BarChart3",
    contexts: ["teacher"],
    sectionKey: "reports",
    permission: "teacherStudio.access",
  },
  // No "Business overview" entry: /teach/operations rendered the exact same
  // <CreatorOpsHub /> as /teach/reports above it — two adjacent menu items, one
  // screen. Two names for one page reads as an unfinished product. The route
  // stays as a redirect for old bookmarks, same as /teach/refunds.
  // O grupo "Growth" tinha exatamente dois itens — Coupons e Team — e nenhum
  // dos dois era sobre crescimento: um é um desconto que se anuncia, o outro é
  // quem tem acesso ao estúdio. (Afiliados e coproduções, que seriam o miolo do
  // grupo, sumiram na virada para cobrança direta: a plataforma nunca segura o
  // dinheiro, então não pode dividi-lo.) Sobrou uma gaveta com o nome errado,
  // então cada item foi para a casa que descreve o que ele faz: Coupons é
  // promoção (Marketing) e Team é acesso ao estúdio (Tools).
  {
    href: "/teach/coupons",
    labelKey: "platform.nav.coupons",
    icon: "Tag",
    contexts: ["teacher"],
    sectionKey: "marketing",
    permission: "teacherStudio.manageCourses",
  },
  // Tools
  {
    href: "/teach/team",
    labelKey: "platform.nav.team",
    icon: "UserCheck",
    contexts: ["teacher"],
    sectionKey: "tools",
    permission: "teacherStudio.access",
  },
  {
    href: "/teach/verification",
    labelKey: "platform.nav.verification",
    icon: "UserCheck",
    contexts: ["teacher"],
    sectionKey: "tools",
    permission: "teacherStudio.access",
  },
  {
    href: "/teach/integrations",
    labelKey: "platform.nav.integrations",
    icon: "Plug",
    contexts: ["teacher"],
    sectionKey: "tools",
    permission: "teacherStudio.access",
  },
  // --- Operations workspace ---
  ...opsNavItems,
  {
    // Title source for /ops outside its dashboard; the eight queues are the
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
  // --- Account. Para o ALUNO, um grupo "Account" na barra lateral: mensagens,
  // avisos, compras e configuracoes. Antes nada disso aparecia na barra (os
  // links moravam so no menu do avatar) e, dentro de /account, a barra nao
  // acendia item nenhum — "onde eu estava?". Para o professor os itens seguem
  // com `contexts: []`: nao renderizam, mas platform-header's getPageLabel
  // varre a lista inteira para traduzir o titulo da pagina; remover degradaria
  // o titulo a um segmento de URL em toda lingua. ---
  {
    // A caixa de entrada do aluno: uma conversa por curso (reanalise item 12).
    href: "/learn/messages",
    labelKey: "platform.nav.messages",
    icon: "MessageCircle",
    contexts: ["learner"],
    sectionKey: "account",
    permission: "courses.viewLearning",
  },
  {
    href: "/account",
    labelKey: "platform.nav.settings",
    icon: "Settings",
    contexts: ["learner"],
    sectionKey: "account",
  },
  {
    // "Subscription" no menu do avatar leva o aluno para ca; com `contexts: []`
    // a barra nao acendia nada nesta pagina (reanalise Ops 6).
    href: "/account/plans",
    labelKey: "platform.nav.plansFees",
    icon: "Receipt",
    contexts: ["learner"],
    sectionKey: "account",
  },
  {
    href: "/account/payments",
    labelKey: "platform.nav.payoutsTax",
    icon: "CreditCard",
    contexts: [],
    sectionKey: "account",
    permission: "teacherStudio.access",
  },
  {
    href: "/account/billing",
    labelKey: "platform.nav.billing",
    icon: "Receipt",
    contexts: ["learner"],
    sectionKey: "account",
  },
  {
    // The only /account subpage that renders its own PlatformShell instead of
    // redirecting into a tab, so it was the only one whose header fell back to
    // the slugified URL segment — untranslated in Spanish. Reuses the existing
    // notifications-panel title rather than minting a duplicate key.
    href: "/account/notifications",
    labelKey: "platform.notifications.title",
    icon: "Bell",
    contexts: ["learner"],
    sectionKey: "account",
  },
];
