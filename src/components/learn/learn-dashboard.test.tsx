import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LearnDashboard } from "@/components/learn/learn-dashboard";
import type { CourseEvent } from "@/domain/course-event";
import type { Enrollment } from "@/domain/enrollment";
import type { Course } from "@/domain/learning";
import type { AppNotification } from "@/domain/notification";

/**
 * O que a pessoa sofria ao entrar em /learn: duas boas-vindas (a manchete do
 * shell e o "Welcome back"), tres cartoes de metrica dizendo "1 · 0 · 0" e so
 * depois os cursos, cada um com "Open" e "Request refund" lado a lado. O
 * "Continue" abria a CAPA do curso, nao a aula onde ela parou. O que chegou de
 * novo so aparecia no sino.
 *
 * Estes testes RENDERIZAM o painel com matriculas de mentira e provam o
 * desenho novo: uma saudacao, retomar direto na aula, filtro de cursos, e
 * nenhum reembolso no cartao.
 */

// O MESMO objeto de usuario em todos os renders: um objeto novo por render
// reinscreve os efeitos que dependem de `user` e entra em laco.
const { mockUser, fixtures, fuse } = vi.hoisted(() => {
  const mockUser = {
    uid: "student-1",
    displayName: "Patrick Simon",
    roles: ["student"],
  };

  const course: Course = {
    id: "course-ec",
    slug: "effective-communication",
    title: "Effective Communication",
    category: "Soft Skills",
    durationLabel: "4 weeks",
    status: "published",
    statusLabel: "Popular",
    summary: "Summary",
    detail: "Detail",
    image: "/covers/ec.jpg",
    level: "Foundation",
    priceLabel: "$79",
    priceAmountMinor: 7900,
    currency: "USD",
    platformFeeBps: 800,
    freePreviewLabel: "Free preview",
    outcomes: [],
    communityEnabled: true,
    modules: [
      {
        id: "m1",
        title: "Foundations",
        summary: "",
        lessons: [
          { id: "l1", title: "Welcome", type: "video", duration: "8 min", isPreview: true },
          { id: "l2", title: "Framework", type: "video", duration: "12 min", isPreview: false },
        ],
      },
      {
        id: "m2",
        title: "Practice",
        summary: "",
        lessons: [
          { id: "l3", title: "Exercise", type: "video", duration: "35 min", isPreview: false },
          { id: "l4", title: "Wrap-up", type: "video", duration: "10 min", isPreview: false },
        ],
      },
    ],
  };

  const inProgress: Enrollment = {
    id: "enrollment-1",
    userId: "student-1",
    courseId: "course-ec",
    courseSlug: "effective-communication",
    courseTitle: "Effective Communication",
    courseCategory: "Soft Skills",
    courseImage: "/covers/ec.jpg",
    status: "active",
    source: "payment",
    progressPercent: 50,
    // A aula em que a pessoa parou: e para ela que o cartao tem que apontar.
    lastLessonId: "l3",
    updatedAt: "2026-09-01T10:00:00.000Z",
  };

  const completed: Enrollment = {
    id: "enrollment-2",
    userId: "student-1",
    courseId: "course-bd",
    courseSlug: "brand-design",
    courseTitle: "Brand Design Atelier",
    courseCategory: "Design",
    courseImage: "/covers/bd.jpg",
    status: "completed",
    source: "payment",
    progressPercent: 100,
    lastLessonId: null,
    updatedAt: "2026-08-20T10:00:00.000Z",
  };

  const liveEvent: CourseEvent = {
    id: "event-1",
    courseId: "course-ec",
    courseSlug: "effective-communication",
    courseTitle: "Effective Communication",
    ownerId: "teacher-1",
    title: "Live Q&A",
    description: "",
    type: "live_class",
    status: "scheduled",
    startsAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
    externalUrl: "https://meet.example.com/live",
    recordingAssetId: null,
  };

  // Ja em ordem do mais novo para o mais velho, como a fonte devolve.
  const notifications: AppNotification[] = [
    {
      id: "n1",
      type: "community_reply",
      title: "Ana replied to your post",
      body: "",
      read: false,
      link: "/learn/community/effective-communication?post=1",
      createdAt: "2026-09-02T08:00:00.000Z",
    },
    {
      id: "n2",
      type: "course_message",
      title: "Message from your teacher",
      body: "",
      read: false,
      link: "/learn/courses/effective-communication",
      createdAt: "2026-09-01T08:00:00.000Z",
    },
    {
      id: "n3",
      type: "certificate",
      title: "Certificate issued",
      body: "",
      read: true,
      link: "/learn/credentials",
      createdAt: "2026-08-30T08:00:00.000Z",
    },
    {
      id: "n4",
      type: "enrollment",
      title: "Older notification",
      body: "",
      read: true,
      link: null,
      createdAt: "2026-08-01T08:00:00.000Z",
    },
  ];

  const fixtures = {
    course,
    enrollments: [inProgress, completed],
    notifications,
    liveEvent,
    events: [liveEvent] as CourseEvent[],
    calls: 0,
  };

  // Fusivel: um laco de render sincrono nao estoura o timeout do vitest, come
  // memoria ate matar o processo. Acima de 20 inscricoes num teste o mock
  // explode com mensagem legivel em vez de sumir.
  function fuse() {
    fixtures.calls += 1;
    if (fixtures.calls > 20) {
      throw new Error("laco de inscricao: mais de 20 subscribe num teste");
    }
  }

  return { mockUser, fixtures, fuse };
});

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ user: mockUser, status: "authenticated" }),
}));

vi.mock("@/components/learn/welcome-tour", () => ({
  WelcomeTour: () => null,
}));

vi.mock("@/components/learn/learning-paths-rows", () => ({
  LearningPathsRows: () => <div>Learning paths</div>,
}));

vi.mock("@/lib/data/catalog", () => ({
  getCourseBySlug: (slug: string) =>
    slug === fixtures.course.slug ? fixtures.course : undefined,
}));

vi.mock("@/lib/data/published-courses", () => ({
  subscribeToPublishedTeacherCourses: (onData: (courses: unknown[]) => void) => {
    fuse();
    onData([]);
    return () => undefined;
  },
  teacherCourseToLearningCourse: (course: unknown) => course,
}));

vi.mock("@/lib/data/enrollments", () => ({
  subscribeToUserEnrollments: (
    _uid: string,
    onData: (enrollments: Enrollment[]) => void,
  ) => {
    fuse();
    onData(fixtures.enrollments);
    return () => undefined;
  },
}));

vi.mock("@/lib/data/notifications", () => ({
  subscribeToNotifications: (
    _uid: string,
    onData: (notifications: AppNotification[]) => void,
  ) => {
    fuse();
    onData(fixtures.notifications);
    return () => undefined;
  },
}));

vi.mock("@/lib/data/course-events", () => ({
  subscribeToCourseEvents: (
    courseSlug: string,
    onData: (events: CourseEvent[]) => void,
  ) => {
    fuse();
    onData(fixtures.events.filter((event) => event.courseSlug === courseSlug));
    return () => undefined;
  },
}));

describe("LearnDashboard", () => {
  beforeEach(() => {
    fixtures.calls = 0;
    fixtures.events = [fixtures.liveEvent];
  });

  it("sauda uma vez so: um h1 e nenhum 'Welcome back'", async () => {
    render(<LearnDashboard />);

    const headings = await screen.findAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent("Hi, Patrick");
    expect(screen.queryByText(/welcome back/i)).not.toBeInTheDocument();
    // As tres metricas viraram uma linha de texto.
    expect(
      screen.getByText("1 course in progress · 1 live session this week"),
    ).toBeInTheDocument();
  });

  it("titulo de secao nao usa a serifa de display — Manrope 600, tamanho de cartao", async () => {
    // Cormorant e uma serifa de DISPLAY: em 24px, dentro de um cartao, ela
    // some — vira "quase o texto do corpo", so que mais claro.
    render(<LearnDashboard />);

    for (const name of ["Continue watching", "My courses"]) {
      const heading = await screen.findByRole("heading", { name });
      expect(heading).not.toHaveClass("display-title");
      expect(heading.className).toContain("font-semibold");
    }
  });

  it("'Continue watching' abre na aula seguinte a ultima concluida", async () => {
    render(<LearnDashboard />);

    const region = await screen.findByRole("region", { name: "Continue watching" });
    const link = within(region).getByRole("link", { name: /Effective Communication/ });
    // lastLessonId = l3 e a ultima aula CONCLUIDA; retomar e l4. Antes o
    // cartao abria l3 de novo — a pessoa reassistia o que acabou de terminar.
    expect(link).toHaveAttribute(
      "href",
      "/learn/courses/effective-communication?lesson=l4",
    );
    // l4 e a segunda aula do modulo 2; falta so ela (10).
    expect(
      within(region).getByText("Module 2 · Lesson 2 · 10 min left"),
    ).toBeInTheDocument();
    // Curso concluido nao entra na fila de retomar.
    expect(within(region).queryByText("Brand Design Atelier")).not.toBeInTheDocument();
  });

  it("o filtro Completed esconde a em andamento, e In progress e o padrao", async () => {
    render(<LearnDashboard />);

    const region = await screen.findByRole("region", { name: "My courses" });
    expect(
      within(region).getByRole("heading", { level: 3, name: "Effective Communication" }),
    ).toBeInTheDocument();
    expect(
      within(region).queryByRole("heading", { level: 3, name: "Brand Design Atelier" }),
    ).not.toBeInTheDocument();

    fireEvent.click(within(region).getByRole("tab", { name: "Completed" }));

    expect(
      within(region).getByRole("heading", { level: 3, name: "Brand Design Atelier" }),
    ).toBeInTheDocument();
    expect(
      within(region).queryByRole("heading", { level: 3, name: "Effective Communication" }),
    ).not.toBeInTheDocument();
    expect(within(region).getByRole("tab", { name: "Completed" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("nenhum 'Request refund' no cartao; o caminho e Billing → Purchases", async () => {
    render(<LearnDashboard />);

    const region = await screen.findByRole("region", { name: "My courses" });
    expect(screen.queryByRole("button", { name: /refund/i })).not.toBeInTheDocument();
    expect(
      within(region).getByRole("link", { name: "Billing → Purchases" }),
    ).toHaveAttribute("href", "/account/billing?tab=purchases");
  });

  it("mostra a proxima live com 'Join' e as tres ultimas novidades com destino", async () => {
    render(<LearnDashboard />);

    const lives = await screen.findByRole("region", { name: "Upcoming lives" });
    expect(within(lives).getByText("Live Q&A")).toBeInTheDocument();
    expect(within(lives).getByRole("link", { name: "Join" })).toHaveAttribute(
      "href",
      "https://meet.example.com/live",
    );

    const news = screen.getByRole("region", { name: "What's new" });
    expect(
      within(news).getByRole("link", { name: /Ana replied to your post/ }),
    ).toHaveAttribute("href", "/learn/community/effective-communication?post=1");
    expect(within(news).getByText("Certificate issued")).toBeInTheDocument();
    // A quarta fica para o sino e a caixa de entrada.
    expect(within(news).queryByText("Older notification")).not.toBeInTheDocument();
  });

  it("sem live marcada, a coluna diz isso em uma linha e a metrica some", async () => {
    fixtures.events = [];
    render(<LearnDashboard />);

    const lives = await screen.findByRole("region", { name: "Upcoming lives" });
    expect(
      within(lives).getByText("No live sessions scheduled in your courses."),
    ).toBeInTheDocument();
    expect(screen.getByText("1 course in progress")).toBeInTheDocument();
  });
});
