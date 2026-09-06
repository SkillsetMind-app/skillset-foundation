import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import OpsPage from "@/app/ops/page";
import { I18nProvider } from "@/components/i18n/i18n-provider";
import { PlatformNav } from "@/components/platform/platform-nav";
import type { AuthStatus, SkillsetUser } from "@/domain/auth";

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
vi.mock("@/lib/data/published-courses", () => ({ subscribeToPublishedTeacherCourses: (next: (rows: never[]) => void) => { next([]); return () => {}; } }));
vi.mock("@/lib/data/enrollments", () => ({
  subscribeToAdminGrantedEnrollments: (next: (rows: never[]) => void) => { next([]); return () => {}; },
  createAdminEnrollmentForTeacherCourse: vi.fn(), revokeEnrollment: vi.fn(),
}));

const queues = [
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
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

function sidebar() { return screen.getByRole("navigation", { name: "Workspace" }); }

describe("filas de Operações na barra", () => {
  it("exposes all eight existing URLs directly without retaining a second tab menu", () => {
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
    expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
  });

  it.each(["", "tab=unknown", "tab=", "tab=verification&tab=access"])("preserves the safe default for query %s", (query) => {
    mocks.query = query;
    render(<OpsPage />);
    expect(sidebar().querySelector('[aria-current="page"]')).toHaveAttribute("href", "/ops?tab=verification");
    expect(screen.getByRole("heading", { name: "Professional admission applications" })).toBeInTheDocument();
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
    expect(sidebar().querySelector('[aria-current="page"]')).toHaveAttribute("href", "/ops?tab=verification");
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
    expect(verification).toHaveAttribute("title", "Creator verification, 128 pending");
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
  });

  it("does not open Ops subscriptions before MFA is completed", () => {
    mocks.status = "mfa_required";
    render(<OpsPage />);
    expect(mocks.verification).not.toHaveBeenCalled();
    expect(mocks.support).not.toHaveBeenCalled();
    expect(mocks.reports).not.toHaveBeenCalled();
  });
});
