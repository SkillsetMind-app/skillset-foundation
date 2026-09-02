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
    isLoading: false,
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

vi.mock("@/components/admin/user-lookup-panel", () => ({
  UserLookupPanel: () => <div>User lookup panel</div>,
}));

vi.mock("@/components/admin/support-ticket-queue", () => ({
  SupportTicketQueue: () => <div>Support ticket queue</div>,
}));

describe("platform shells", () => {
  it("entrega a home do aluno ao painel, sem a manchete do shell", async () => {
    mockAuthState.roles = ["student"];
    render(await LearnPage());

    // O aluno via duas boas-vindas seguidas: a manchete do shell e o
    // "Welcome back" do painel. Com hideHeader so o painel sauda.
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

    // Título compacto: a fila começa logo abaixo, não depois de uma frase de
    // efeito de 48px, três métricas e dois filtros que nenhuma fila lia.
    expect(
      screen.getByRole("heading", { name: "Operations" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/A calm operations layer/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Period:")).not.toBeInTheDocument();
    expect(screen.queryByText("Status:")).not.toBeInTheDocument();

    // As três métricas viraram contadores na aba da fila correspondente.
    const queues = screen.getByRole("group", { name: "Operations queues" });
    expect(queues).toHaveTextContent(/Creator verification\s*3/);
    expect(queues).toHaveTextContent(/Support tickets\s*2/);
    expect(queues).toHaveTextContent(/Community reports\s*1/);

    // "Access levels" deixou de ser um bloco solto no fim da página: é a
    // oitava fila, com endereço próprio (?tab=access).
    expect(
      screen.getByRole("button", { name: /^Access$/ }),
    ).toBeInTheDocument();
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
    expect(screen.getByText("Switch view")).toBeInTheDocument();
    const studentViewLink = screen.getByRole("link", { name: /Student view/i });
    expect(studentViewLink).toHaveAttribute("href", "/learn");
    expect(studentViewLink).not.toHaveAttribute("target");
    // A teacher should not see the learner-to-teacher upgrade prompt.
    expect(
      screen.queryByRole("link", { name: /Become a teacher/i }),
    ).not.toBeInTheDocument();
  });
});
