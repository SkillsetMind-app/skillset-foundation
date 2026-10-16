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

// Ordem da lista = ordem na barra dentro de cada secao; a ordem das secoes
// mora em platform-nav.tsx (sectionOrder). `contexts: []` nao aparece na barra,
// mas segue aqui: platform-header's getPageLabel varre a lista inteira para
// traduzir o titulo da pagina, e sem a entrada o topo cairia num pedaco de URL.
export const platformNav: PlatformNavItem[] = [
  // --- Aluno: quatro itens fixos (+ Ajuda, que e um botao e nao uma rota).
  // "Classroom" era o nome da LISTA de cursos; a sala de aula e outra tela. ---
  {
    href: "/learn",
    labelKey: "platform.nav.myCourses",
    icon: "BookOpen",
    contexts: ["learner"],
    sectionKey: "learn",
    permission: "courses.viewLearning",
  },
  {
    // A caixa de entrada do aluno: uma conversa por curso. Antes morava no
    // grupo Account, fechado para quem estava em "Learn".
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
    // Fora da barra: as proximas lives aparecem em "My courses", com um link
    // para esta pagina.
    href: "/learn/events",
    labelKey: "platform.nav.agenda",
    icon: "Calendar",
    contexts: [],
    sectionKey: "learn",
    permission: "courses.viewLearning",
  },
  {
    // A lista de desejos mora no menu do avatar.
    href: "/learn/wishlist",
    labelKey: "platform.nav.wishlist",
    icon: "Bookmark",
    contexts: [],
    sectionKey: "learn",
    permission: "courses.viewLearning",
  },
  // --- Professor: oito itens no primeiro nivel. Ferramentas (Verification) e
  // planos foram para o menu do avatar; "Collaborators", "Integrations" e a
  // placa de "Coupons" sairam (as rotas redirecionam). A troca para o lado do
  // aluno e o botao do topo, nao um link no rodape. ---
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
    // Todos os alunos de todos os produtos. "Members & communities" era uma
    // lista de PRODUTOS com esse nome; a rota segue viva, fora da barra.
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
    // Mensagens + perguntas da comunidade. Era "Messages", escondido dentro
    // do grupo Marketing.
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
  // connected account. ONE name everywhere (barra, avatar, titulo, erros):
  // antes eram quatro ("Payments", "Earnings", "Payouts & tax", "Payouts panel").
  {
    href: "/account/payments",
    labelKey: "platform.nav.earnings",
    icon: "TrendingUp",
    contexts: ["teacher"],
    sectionKey: "earnings",
    permission: "teacherStudio.access",
  },
  // Promote: o que faz o produto ser encontrado. Os cupons vivem dentro de
  // cada produto; /teach/coupons redireciona para a lista de produtos.
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
    // Menu do avatar; aqui so como fonte do titulo.
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
  // --- Conta do aluno, abaixo dos itens fixos: compras e configuracoes. ---
  // Mesma pagina, dois nomes: para o aluno ela so guarda o que ele comprou,
  // entao se chama "My purchases"; o professor segue vendo "Billing". O do
  // aluno vem primeiro: e o titulo que getPageLabel acha enquanto o papel carrega.
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
    // Os planos sao de quem VENDE: so o professor chega aqui, pelo "Creator
    // plan" do menu do avatar. Fora da barra (o aluno lia "Plans & fees" e
    // achava que precisava pagar assinatura).
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
