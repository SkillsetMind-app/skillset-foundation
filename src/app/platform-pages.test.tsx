import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import LearnPage from "@/app/learn/page";
import OpsPage from "@/app/ops/page";
import TeachPage from "@/app/teach/page";
import { AccountMenu } from "@/components/site/account-menu";

const mockAuthState = vi.hoisted(() => ({
  roles: ["admin"],
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    status: "authenticated",
    user: {
      uid: "test-user",
      email: "test@example.com",
      displayName: "Test User",
      emailVerified: true,
      photoURL: null,
      roles: mockAuthState.roles,
    },
    signOut: vi.fn(),
  }),
}));

vi.mock("@/lib/data/user-profiles", () => ({
  subscribeToUserProfile: vi.fn((_uid, onNext) => {
    onNext(null);
    return vi.fn();
  }),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/platform",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

// Learn/Teach are async server components (they resolve the locale via
// next/headers); give them an empty request scope so they render in English.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));

vi.mock("@/components/teacher/teacher-course-studio", () => ({
  TeacherCourseStudio: () => <div>Teacher course studio</div>,
}));

vi.mock("@/components/teacher/teacher-event-studio", () => ({
  TeacherEventStudio: () => <div>Teacher event studio</div>,
}));

vi.mock("@/components/teacher/teacher-wallet-panel", () => ({
  TeacherWalletPanel: () => <div>Teacher wallet panel</div>,
}));

vi.mock("@/components/teacher/teacher-studio-dashboard", () => ({
  TeacherStudioDashboard: () => (
    <div>
      <h3>Publishing flow</h3>
      <p>Educator support</p>
    </div>
  ),
}));

vi.mock("@/components/learn/learn-dashboard", () => ({
  LearnDashboard: () => <div>Learn dashboard</div>,
}));

vi.mock("@/components/admin/managed-course-panel", () => ({
  ManagedCoursePanel: () => <div>Managed course panel</div>,
}));

vi.mock("@/components/admin/creator-verification-queue", () => ({
  CreatorVerificationQueue: () => <div>Creator verification queue</div>,
}));

vi.mock("@/components/admin/admin-enrollment-panel", () => ({
  AdminEnrollmentPanel: () => <div>Admin enrollment panel</div>,
}));

vi.mock("@/components/admin/payment-operations-panel", () => ({
  PaymentOperationsPanel: () => <div>Payment operations panel</div>,
}));

vi.mock("@/components/admin/ops-overview-metrics", () => ({
  useOpsQueueCounts: () => ({
    pendingVerifications: 3,
    openTickets: 2,
    openReports: 1,
  }),
}));

vi.mock("@/components/admin/account-action-requests-panel", () => ({
  AccountActionRequestsPanel: () => <div>Account action requests panel</div>,
}));

vi.mock("@/components/admin/community-moderation-queue", () => ({
  CommunityModerationQueue: () => <div>Community moderation queue</div>,
}));

vi.mock("@/components/admin/ops-user-table", () => ({
  OpsUserTable: () => <div>User table</div>,
}));

vi.mock("@/components/admin/support-ticket-queue", () => ({
  SupportTicketQueue: () => <div>Support ticket queue</div>,
}));

describe("platform shells", () => {
  it("hands the learner home to the dashboard, without the shell headline", async () => {
    mockAuthState.roles = ["student"];
    render(await LearnPage());

    // The learner used to see two welcomes in a row: the shell headline and
    // the dashboard's "Welcome back". With hideHeader only the dashboard greets.
    expect(screen.getByText("Learn dashboard")).toBeInTheDocument();
    expect(
      screen.queryByText("Your learning, in one place."),
    ).not.toBeInTheDocument();
  });

  it("renders the teacher publishing view", async () => {
    mockAuthState.roles = ["teacher"];
    render(await TeachPage());

    expect(
      screen.getByRole("heading", { name: "Publishing flow" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Educator support")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Learner" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Creator" })).not.toBeInTheDocument();
  });

  it("opens the operations page on the queues, not on a marketing headline", () => {
    mockAuthState.roles = ["admin"];
    render(<OpsPage />);

    // Compact title: the queue starts right below, not after a 48px catchphrase,
    // three metrics and two filters that no queue read.
    // The title is the open queue (Overview by default); "Operations" becomes the eyebrow.
    expect(
      screen.getByRole("heading", { level: 1, name: "Overview" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/A calm operations layer/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Period:")).not.toBeInTheDocument();
    expect(screen.queryByText("Status:")).not.toBeInTheDocument();

    // The queues and their counters live in the main navigation, with no second bar.
    const queues = screen.getByRole("navigation", { name: "Workspace" });
    // Label with the exact count (read by the screen reader and shown in the tooltip), then the badge.
    expect(queues).toHaveTextContent(/Creator verification, 3 pending\s*3/);
    expect(queues).toHaveTextContent(/Support tickets, 2 pending\s*2/);
    expect(queues).toHaveTextContent(/Community reports, 1 pending\s*1/);

    // "Access levels" is no longer a loose block at the end of the page: it is
    // the eighth queue, with its own address (?tab=access).
    expect(
      screen.getByRole("link", { name: /^Access$/ }),
    ).toHaveAttribute("href", "/ops?tab=access");
    expect(
      screen.queryByRole("heading", { name: "Access levels" }),
    ).not.toBeInTheDocument();
  });

  it("exposes student-view switching for a teacher in the account dropdown", () => {
    render(
      <AccountMenu
        onSignOut={vi.fn()}
        user={{
          uid: "teacher-user",
          email: "teacher@example.com",
          displayName: "Teacher User",
          emailVerified: true,
          photoURL: null,
          roles: ["teacher"],
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open account menu" }));

    // One account, both roles: a teacher can drop into the student classroom.
    // It navigates in the SAME tab. It used to open a new one to preserve the
    // studio context, but the menu now lists every workspace the account holds
    // and hides the current one, so it reads as a toggle — and a toggle that
    // opens a tab per press leaves you with a pile of them.
    expect(screen.getByText("Switch area")).toBeInTheDocument();
    const studentViewLink = screen.getByRole("link", { name: /Student area/i });
    expect(studentViewLink).toHaveAttribute("href", "/learn");
    expect(studentViewLink).not.toHaveAttribute("target");
    // A teacher should not see the learner-to-teacher upgrade prompt.
    expect(
      screen.queryByRole("link", { name: /Become a teacher/i }),
    ).not.toBeInTheDocument();
  });
});
