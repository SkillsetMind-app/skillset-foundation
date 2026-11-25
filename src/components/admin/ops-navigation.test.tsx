import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import OpsPage from "@/app/ops/page";
import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import { PlatformNav } from "@/components/platform/platform-nav";
import type { AuthStatus, SkillsetUser } from "@/domain/auth";
import type { AuditLogEntry } from "@/lib/data/audit-log";

const mocks = vi.hoisted(() => ({
  query: "",
  status: "authenticated" as AuthStatus,
  user: {
    uid: "ops-test", email: "operator@example.test", displayName: "Operator",
    emailVerified: true, photoURL: null, roles: ["admin"],
  } as SkillsetUser | null,
  push: vi.fn(), replace: vi.fn(), refresh: vi.fn(),
  verification: vi.fn(), support: vi.fn(), reports: vi.fn(),
  orders: vi.fn(), users: vi.fn(), accounts: vi.fn(), audit: vi.fn(), roster: vi.fn(),
  overview: vi.fn(), session: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/ops",
  useSearchParams: () => new URLSearchParams(mocks.query),
  useRouter: () => ({ push: mocks.push, replace: mocks.replace, refresh: mocks.refresh }),
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ status: mocks.status, user: mocks.user, signOut: vi.fn(), isRealAdmin: mocks.user?.roles.includes("admin"), setViewAsRole: vi.fn() }),
}));
vi.mock("@/components/platform/status-banner", () => ({ StatusBanner: () => null }));
vi.mock("@/components/platform/notification-bell", () => ({ NotificationBell: () => null }));
vi.mock("@/lib/data/user-profiles", () => ({ subscribeToUserProfile: (_uid: string, next: (profile: null) => void) => { next(null); return () => {}; } }));
vi.mock("@/lib/supabase/config", () => ({ getSupabaseClientConfig: () => ({ url: "https://example.test" }) }));
vi.mock("@/lib/data/creator-verification", () => ({ subscribeToVerificationQueue: mocks.verification, reviewCreatorVerification: vi.fn() }));
vi.mock("@/lib/data/support-tickets", () => ({ subscribeToAdminSupportTickets: mocks.support, respondToSupportTicket: vi.fn(), updateSupportTicketStatus: vi.fn() }));
vi.mock("@/lib/data/community-posts", () => ({ subscribeToCommunityReports: mocks.reports, updateCommunityReportStatus: vi.fn() }));
vi.mock("@/lib/data/teacher-courses", () => ({
  subscribeToManagedCourses: (next: (rows: never[]) => void) => { next([]); return () => {}; },
  deleteCourseAsAdmin: vi.fn(), setCourseFeatured: vi.fn(), updateCourseReviewStatus: vi.fn(),
}));
vi.mock("@/lib/data/orders", () => ({ subscribeToRecentOrders: mocks.orders }));
vi.mock("@/lib/data/admin-users", () => ({ subscribeToAdminUserProfiles: mocks.users }));
vi.mock("@/lib/data/account-actions", () => ({ subscribeToAccountActionRequests: mocks.accounts, resolveAccountActionRequest: vi.fn() }));
vi.mock("@/lib/data/audit-log", () => ({ subscribeToAuditLog: mocks.audit }));
vi.mock("@/lib/data/platform-roles", () => ({ listPlatformUsers: mocks.roster, setUserRoles: vi.fn() }));
vi.mock("@/lib/data/ops-users", () => ({ OPS_USERS_PAGE_SIZE: 50, searchOpsUsers: () => Promise.resolve({ users: [], total: 0 }) }));
vi.mock("@/lib/data/published-courses", () => ({ subscribeToPublishedTeacherCourses: (next: (rows: never[]) => void) => { next([]); return () => {}; } }));
vi.mock("@/lib/data/ops-overview", () => ({
  readOverviewAdminSession: mocks.session,
  readOverviewUsers: mocks.overview, readOverviewCourses: mocks.overview, readOverviewPublications: mocks.overview,
  readOverviewActivations: mocks.overview, readOverviewEnrollments: mocks.overview, readOverviewOrders: mocks.overview,
}));
vi.mock("@/lib/data/enrollments", () => ({
  subscribeToAdminGrantedEnrollments: (next: (rows: never[]) => void) => { next([]); return () => {}; },
  createAdminEnrollmentForTeacherCourse: vi.fn(), revokeEnrollment: vi.fn(),
}));

const queues = [
  ["overview", "Overview", "How the business is doing"],
  ["verification", "Creator verification", "Professional admission applications"],
  ["catalog", "Published catalog", "Manage the live catalog"],
  ["payments", "Payments", "Stripe order monitor."],
  ["community", "Community reports", "Trust reports"],
  ["support", "Support tickets", "User support tickets"],
  ["users", "Users", "Find learners and educators."],
  ["audit", "Audit log", "Audit log"],
  ["access", "Access", "Access levels"],
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.query = "";
  mocks.status = "authenticated";
  mocks.user = {
    uid: "ops-test", email: "operator@example.test", displayName: "Operator",
    emailVerified: true, photoURL: null, roles: ["admin"],
  };
  for (const subscribe of [mocks.verification, mocks.support, mocks.reports, mocks.orders, mocks.users, mocks.accounts, mocks.audit]) {
    subscribe.mockImplementation((next: (rows: never[]) => void) => { next([]); return vi.fn(); });
  }
  mocks.roster.mockResolvedValue([]);
  mocks.overview.mockResolvedValue([]);
  mocks.session.mockResolvedValue(true);
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

function sidebar() { return screen.getByRole("navigation", { name: "Workspace" }); }

function ChangeAuditLanguage() {
  const { locale, setLocale } = useTranslation();
  return <button onClick={() => setLocale(locale === "en" ? "es" : "en")}>Change audit language</button>;
}

describe("Operations queues in the sidebar", () => {
  it("contains the access matrix in its own keyboard-scrollable region", () => {
    mocks.query = "tab=access";
    render(<OpsPage />);
    fireEvent.click(screen.getByRole("tab", { name: "What each level can do" }));
    const matrix = screen.getByRole("region", { name: "What each level can do" });
    expect(matrix).toHaveAttribute("tabindex", "0");
    expect(matrix).toHaveClass("overflow-x-auto");
    expect(within(matrix).getByRole("table")).toHaveClass("min-w-[640px]");
    const card = matrix.closest("section")!;
    expect(card).toHaveClass("min-w-0");
    expect(card.parentElement).toHaveClass("grid-cols-1", "min-w-0");
  });

  it.each(["access", "catalog", "payments", "community", "users", "audit"])("does not offer a global search without a consumer in %s", tab => {
    mocks.query = `tab=${tab}&q=old`;
    const { container } = render(<OpsPage />);
    const header = container.querySelector(".platform-topbar")! as HTMLElement;
    expect(within(header).queryByRole("searchbox")).toBeNull();
    expect(within(header).queryByRole("button", { name: "Open search" })).toBeNull();
  });

  it.each(["support", "verification"])("connects a %s deep-link search to its loaded records", tab => {
    mocks.query = `tab=${tab}&q=Ana`;
    const rows = tab === "support"
      ? [
          { id: "a", userId: "a", userName: "Ana", userEmail: "ana@example.test", category: "course", status: "open", subject: "First ticket", message: "Original message" },
          { id: "b", userId: "b", userName: "Bruno", userEmail: "bruno@example.test", category: "other", status: "open", subject: "Second ticket", message: "Another message" },
        ]
      : ["Ana", "Bruno"].map(name => ({ id: name, creatorId: name, applicantName: name, status: "pending", profession: "Mentor", registrationType: "Registry", registrationId: name, registrationRegion: "Florida", evidenceLinks: [], createdAt: "2026-08-20T13:00:00Z" }));
    (tab === "support" ? mocks.support : mocks.verification).mockImplementation(next => { next(rows); return vi.fn(); });
    const { rerender } = render(<OpsPage />);
    const first = tab === "support" ? "First ticket" : "Ana";
    const second = tab === "support" ? "Second ticket" : "Bruno";
    expect(screen.getByRole("heading", { name: first })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: second })).toBeNull();
    const field = screen.getByRole("searchbox");
    expect(field).toHaveValue("Ana");
    fireEvent.change(field, { target: { value: "Bruno" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(mocks.push).toHaveBeenLastCalledWith(`/ops?tab=${tab}&q=Bruno`);
    mocks.query = `tab=${tab}&q=Bruno`;
    rerender(<OpsPage />);
    expect(screen.getByRole("heading", { name: second })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: first })).toBeNull();
    mocks.query = `tab=${tab}&q=Ana`;
    rerender(<OpsPage />);
    expect(screen.getByRole("heading", { name: first })).toBeInTheDocument();
  });

  it("does not turn q into support access for an ops role without permission", () => {
    mocks.user!.roles = ["ops"];
    mocks.query = "tab=support&q=private";
    const { container } = render(<OpsPage />);
    expect(mocks.support).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Your access level does not include this queue.");
    expect(within(container.querySelector(".platform-topbar")! as HTMLElement).queryByRole("searchbox")).toBeNull();
  });

  it("exposes all nine existing URLs directly without retaining a second tab menu", () => {
    render(<OpsPage />);
    for (const [id, label] of queues) {
      expect(within(sidebar()).getByRole("link", { name: new RegExp(`^${label}`) })).toHaveAttribute("href", `/ops?tab=${id}`);
    }
    expect(within(sidebar()).queryByRole("link", { name: /^Operations$/ })).toBeNull();
    expect(screen.queryByRole("group", { name: "Operations queues" })).toBeNull();
  });

  it.each(queues)("keeps the %s bookmark and selects only its sidebar link", (id, label, heading) => {
    mocks.query = `from=bookmark&tab=${id}`;
    render(<OpsPage />);
    const current = sidebar().querySelectorAll('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAttribute("href", `/ops?tab=${id}`);
    expect(current[0]).toHaveTextContent(label);
    expect(within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByText(label)).toBeInTheDocument();
    // Each tab is named after itself, not "Operations" on all nine (I-07).
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(label);
    expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
  });

  it("puts open privacy requests above the people list, and below it when none are open", () => {
    mocks.query = "tab=users";
    const order = () => {
      const requests = screen.getByRole("heading", { name: "Export and deletion requests." });
      const people = screen.getByRole("heading", { name: "Find learners and educators." });
      return requests.compareDocumentPosition(people) & Node.DOCUMENT_POSITION_FOLLOWING ? "requests first" : "people first";
    };
    const { unmount } = render(<OpsPage />);
    expect(order()).toBe("people first");
    unmount();
    mocks.accounts.mockImplementation((next: (rows: unknown[]) => void) => {
      next([{ id: "r-1", type: "account_deletion", requestedBy: "u-1", email: null, status: "pending", requestedAt: null, updatedAt: null, resolvedBy: null, resolvedAt: null }]);
      return vi.fn();
    });
    render(<OpsPage />);
    expect(order()).toBe("requests first");
  });

  it.each([
    ["0 to 1", [], "people first"],
    ["1 to 0", ["pending"], "requests first"],
  ] as const)("keeps the first order when the live request count goes %s, so the people table never moves", (_change, initial, expected) => {
    mocks.query = "tab=users";
    const row = (status: string) => ({ id: `r-${status}`, type: "account_deletion", requestedBy: "u-1", email: null, status, requestedAt: null, updatedAt: null, resolvedBy: null, resolvedAt: null });
    let rows: unknown[] = initial.map(row);
    // The counter and the panel subscribe to the same source; each subscription receives the current list.
    mocks.accounts.mockImplementation((next: (value: unknown[]) => void) => { next(rows); return vi.fn(); });
    const order = () => {
      const requests = screen.getByRole("heading", { name: "Export and deletion requests." });
      const people = screen.getByRole("heading", { name: "Find learners and educators." });
      return requests.compareDocumentPosition(people) & Node.DOCUMENT_POSITION_FOLLOWING ? "requests first" : "people first";
    };
    render(<OpsPage />);
    const table = screen.getByRole("heading", { name: "Find learners and educators." }).closest("section");
    expect(order()).toBe(expected);
    rows = initial.length ? [] : [row("pending")];
    act(() => { for (const [next] of mocks.accounts.mock.calls) (next as (value: unknown[]) => void)(rows); });
    // The count really did change (the badge follows it), but the order did not.
    if (initial.length) expect(sidebar()).not.toHaveTextContent(/Users, 1 pending/);
    else expect(sidebar()).toHaveTextContent(/Users, 1 pending/);
    expect(order()).toBe(expected);
    // The same table node stays in place (a <dialog> open inside it does not leave the top layer).
    expect(screen.getByRole("heading", { name: "Find learners and educators." }).closest("section")).toBe(table);
  });

  it.each(["", "tab=unknown", "tab="])("lands an admin on Overview for query %s", (query) => {
    mocks.query = query;
    render(<OpsPage />);
    expect(sidebar().querySelector('[aria-current="page"]')).toHaveAttribute("href", "/ops?tab=overview");
    expect(screen.getByRole("heading", { name: "How the business is doing" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the first tab of a repeated query", () => {
    mocks.query = "tab=verification&tab=access";
    render(<OpsPage />);
    expect(sidebar().querySelector('[aria-current="page"]')).toHaveAttribute("href", "/ops?tab=verification");
    expect(screen.getByRole("heading", { name: "Professional admission applications" })).toBeInTheDocument();
  });

  it.each([[["ops"]], [["ops", "support", "moderator"]]] as const)("lands staff without admin (%j) on the first queue they can open", (roles) => {
    mocks.user!.roles = [...roles];
    render(<OpsPage />);
    expect(sidebar().querySelector('[aria-current="page"]')).toHaveAttribute("href", "/ops?tab=verification");
    expect(screen.getByRole("heading", { name: "Professional admission applications" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.overview).not.toHaveBeenCalled();
  });

  it("does not read business numbers for an ops role that opens the Overview link", () => {
    mocks.user!.roles = ["ops"];
    mocks.query = "tab=overview";
    render(<OpsPage />);
    expect(screen.getByRole("alert")).toHaveTextContent("Your access level does not include this queue.");
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.overview).not.toHaveBeenCalled();
  });

  it("shares the same links and count subscriptions with the mobile drawer", () => {
    render(<OpsPage />);
    const before = [mocks.verification.mock.calls.length, mocks.support.mock.calls.length, mocks.reports.mock.calls.length];
    fireEvent.click(screen.getByRole("button", { name: "Open more navigation" }));
    const drawer = screen.getByRole("dialog", { name: "Platform navigation" });
    for (const [id, label] of queues) {
      expect(within(drawer).getByRole("link", { name: new RegExp(`^${label}`) })).toHaveAttribute("href", `/ops?tab=${id}`);
    }
    expect([mocks.verification.mock.calls.length, mocks.support.mock.calls.length, mocks.reports.mock.calls.length]).toEqual(before);
    fireEvent.click(within(drawer).getByRole("link", { name: /^Support tickets/ }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("translates queue links and the breadcrumb in Spanish", () => {
    mocks.query = "tab=support";
    render(<I18nProvider initialLocale="es"><OpsPage /></I18nProvider>);
    const nav = screen.getByRole("navigation", { name: "Espacio de trabajo" });
    expect(within(nav).getByRole("link", { name: /^Tickets de soporte/ })).toHaveAttribute("aria-current", "page");
    expect(within(nav).queryByRole("link", { name: /^Support tickets/ })).toBeNull();
    expect(within(screen.getByRole("navigation", { name: "Ruta de navegación" })).getByText("Tickets de soporte")).toBeInTheDocument();
  });

  it("keeps panel and selection together when the query changes on the mounted page", () => {
    const { rerender } = render(<OpsPage />);
    mocks.query = "tab=support";
    rerender(<OpsPage />);
    expect(sidebar().querySelector('[aria-current="page"]')).toHaveAttribute("href", "/ops?tab=support");
    expect(screen.getByRole("heading", { name: "User support tickets" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Professional admission applications" })).toBeNull();
    mocks.query = "";
    rerender(<OpsPage />);
    expect(sidebar().querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(sidebar().querySelector('[aria-current="page"]')).toHaveAttribute("href", "/ops?tab=overview");
  });

  it("labels loading, unavailable and confirmed zero separately in navigation", () => {
    mocks.query = "tab=catalog";
    mocks.verification.mockImplementation(() => vi.fn());
    mocks.support.mockImplementation((_next, error) => { error(new Error("Read failed")); return vi.fn(); });
    render(<OpsPage />);
    expect(within(sidebar()).getByRole("link", { name: "Creator verification, Count loading" })).toHaveTextContent("…");
    expect(within(sidebar()).getByRole("link", { name: "Support tickets, Count unavailable" })).toHaveTextContent("—");
    expect(within(sidebar()).getByRole("link", { name: "Community reports, 0 pending" })).toBeInTheDocument();
  });

  it("limits the visible rail count while retaining the exact accessible count", () => {
    render(<PlatformNav collapsed navigationCounts={{ "/ops?tab=verification": 128 }} />);
    const verification = screen.getByRole("link", { name: "Creator verification, 128 pending" });
    expect(verification).toHaveTextContent("99+");
    // No title (the hint is the label itself, which carries the exact count).
    expect(verification).not.toHaveAttribute("title");
    expect(verification.querySelector(".platform-sidebar-label")).toHaveTextContent("Creator verification, 128 pending");
  });

  it("does not present admin data or counters to a bare ops role", () => {
    mocks.user!.roles = ["ops"];
    mocks.query = "tab=payments";
    render(<OpsPage />);
    const links = within(sidebar()).getAllByRole("link").map(link => link.getAttribute("href"));
    expect(links.filter(href => href?.startsWith("/ops"))).toEqual(["/ops?tab=verification", "/ops?tab=catalog"]);
    expect(screen.queryByRole("heading", { name: "Stripe order monitor." })).toBeNull();
    expect(mocks.orders).not.toHaveBeenCalled();
    expect(mocks.users).not.toHaveBeenCalled();
    expect(mocks.support).not.toHaveBeenCalled();
    expect(mocks.reports).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Your access level does not include this queue.");
  });

  it("keeps the existing Team queues without role management", () => {
    mocks.user!.roles = ["ops", "support", "moderator"];
    mocks.query = "tab=support";
    render(<OpsPage />);
    const links = within(sidebar()).getAllByRole("link").map(link => link.getAttribute("href"));
    expect(links.filter(href => href?.startsWith("/ops"))).toEqual(["/ops?tab=verification", "/ops?tab=catalog", "/ops?tab=community", "/ops?tab=support"]);
    expect(mocks.users).not.toHaveBeenCalled();
    expect(mocks.roster).not.toHaveBeenCalled();
  });

  it.each(["teacher", "student", "support", "moderator"] as const)("does not open Ops subscriptions for %s", role => {
    mocks.user!.roles = [role];
    render(<OpsPage />);
    expect(screen.queryByRole("navigation", { name: "Workspace" })).toBeNull();
    expect(mocks.verification).not.toHaveBeenCalled();
    expect(mocks.support).not.toHaveBeenCalled();
    expect(mocks.reports).not.toHaveBeenCalled();
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.overview).not.toHaveBeenCalled();
  });

  it("does not open Ops subscriptions before MFA is completed", () => {
    mocks.status = "mfa_required";
    render(<OpsPage />);
    expect(mocks.verification).not.toHaveBeenCalled();
    expect(mocks.support).not.toHaveBeenCalled();
    expect(mocks.reports).not.toHaveBeenCalled();
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.overview).not.toHaveBeenCalled();
  });
});

describe("audit presentation inside the protected Operations page", () => {
  it("translates the four known actions while preserving historical summaries and identities", () => {
    mocks.query = "tab=audit";
    const actions = [
      ["refund.requested", "Refund requested", "Reembolso solicitado"],
      ["refund.issued", "Refund issued", "Reembolso emitido"],
      ["account.deletion_requested", "Account deletion requested", "Eliminación de cuenta solicitada"],
      ["account.data_export_requested", "Data export requested", "Exportación de datos solicitada"],
      ["future.audit_action", "future audit action", "future audit action"],
    ];
    const entries: AuditLogEntry[] = actions.map(([action], index) => ({ id: `event-${index}`, action, actorId: "actor-$$-$&", actorEmail: index ? null : "actor@example.test", targetType: index === 4 ? "future_target" : index < 2 ? "order" : "user", targetId: `target-$$-$&-${index}`, summary: `Registro histórico $$50 $& "áéí" ${index}`, metadata: {}, createdAt: index === 4 ? "not-a-date" : "2026-09-04T12:00:00.000Z" }));
    mocks.audit.mockImplementation((next: (rows: AuditLogEntry[]) => void) => { next(entries); return vi.fn(); });
    render(<I18nProvider initialLocale="en"><ChangeAuditLanguage /><OpsPage /></I18nProvider>);
    // Once in the block and once in the table (CSS shows one of the two).
    for (const [, english] of actions) expect(screen.getAllByText(english)).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Change audit language" }));
    expect(screen.getByRole("heading", { name: "Registro de auditoría" })).toBeInTheDocument();
    // The blocks (narrow card) and the table (wide card) have the same
    // events, in the same order; CSS shows one of the two.
    const articles = screen.getAllByRole("article");
    for (const [index, entry] of entries.entries()) {
      const article = articles[index];
      expect(within(article).getByText(entry.summary)).toBeInTheDocument();
      expect(within(article).getByText(actions[index][2])).toBeInTheDocument();
      expect(article).toHaveTextContent(entry.targetId);
      expect(article).toHaveTextContent(entry.actorEmail ?? entry.actorId);
    }
    expect(screen.getAllByText("future target")).toHaveLength(2);
    // Each part has its own label, not one run-on sentence (I-06).
    const parts = (index: number) => [...articles[index].querySelectorAll("dt")].map((term) => [term.textContent, term.nextElementSibling?.textContent]);
    expect(parts(4)).toEqual([["Cuándo", "Fecha pendiente"], ["Responsable", "actor-$$-$&"], ["Destino", "target-$$-$&-4"]]);
    const date = new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" }).format(new Date(entries[0].createdAt!));
    expect(parts(0)).toEqual([["Cuándo", date], ["Responsable", "actor@example.test"], ["Destino", "target-$$-$&-0"]]);
    // I-06: on the wide card, a real table, with each part in its own column.
    const table = screen.getByRole("table", { name: "Registro de auditoría, del más reciente al más antiguo" });
    expect(articles[0].parentElement).toHaveClass("@3xl:hidden");
    expect(table.closest(".hidden")).toHaveClass("@3xl:block");
    expect(within(table).getAllByRole("columnheader").map((head) => head.textContent)).toEqual(["Cuándo", "Acción", "Responsable", "Destino"]);
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(entries.length);
    const [whenCell, actorCell, targetCell] = within(rows[0]).getAllByRole("cell");
    expect(whenCell.textContent).toBe(date);
    expect(within(rows[0]).getByRole("rowheader")).toHaveTextContent(`${actions[0][2]}${entries[0].summary}`);
    expect(actorCell).toHaveTextContent("actor@example.test");
    expect(within(targetCell).getByText("target-$$-$&-0")).toHaveClass("select-all", "font-mono");
    // The page title is the queue name (I-07); the panel is found by its explanation.
    expect(screen.getByRole("heading", { level: 1, name: "Registro de auditoría" })).toBeInTheDocument();
    const panel = screen.getByText(/Los reembolsos y las solicitudes de cuenta se registran aquí/).closest("section")!;
    expect(panel).not.toHaveClass("platform-content");
    expect(within(panel).queryAllByRole("button")).toHaveLength(0);
    expect(mocks.audit).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Change audit language" }));
    expect(screen.getAllByText(entries[0].summary)).toHaveLength(2);
    expect(screen.getAllByText("Refund requested")).toHaveLength(2);
  });

  it("separates a failed audit read from empty and translates recovery", () => {
    mocks.query = "tab=audit";
    mocks.audit.mockImplementation(() => vi.fn());
    render(<I18nProvider initialLocale="en"><ChangeAuditLanguage /><OpsPage /></I18nProvider>);
    expect(screen.getByRole("status")).toHaveTextContent("Loading audit log");
    act(() => mocks.audit.mock.calls[0][1](new Error("Private audit detail")));
    fireEvent.click(screen.getByRole("button", { name: "Change audit language" }));
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos cargar el registro de auditoría.");
    expect(screen.queryByText("Todavía no hay eventos de auditoría registrados.")).toBeNull();
    expect(screen.queryByText("Private audit detail")).toBeNull();
    act(() => mocks.audit.mock.calls[0][0]([]));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Todavía no hay eventos de auditoría registrados.")).toBeInTheDocument();
    expect(mocks.audit).toHaveBeenCalledTimes(1);
  });
});
