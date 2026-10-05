import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
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
    base: [inProgress, completed],
    enrollments: [inProgress, completed],
    notifications,
    liveEvent,
    events: [liveEvent] as CourseEvent[],
    // Cursos reais que o banco devolve quando o painel pergunta por id.
    realCourses: [] as Course[],
    fetchedIds: [] as string[][],
    emitEnrollments: (() => undefined) as (next: Enrollment[]) => void,
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

// O I18nProvider chama useRouter() para o refresh ao trocar de idioma.
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/navigation")>(),
  useRouter: () => router,
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ user: mockUser, status: "authenticated" }),
}));

vi.mock("@/components/learn/welcome-tour", () => ({
  WelcomeTour: () => null,
}));

// Mostra o que o painel repassa para as fileiras: a lista de cursos e uma so.
vi.mock("@/components/learn/learning-paths-rows", () => ({
  LearningPathsRows: ({ enrolledCourses }: { enrolledCourses: { id: string }[] }) => (
    <div>Learning paths: {enrolledCourses.map((course) => course.id).join(",")}</div>
  ),
}));

vi.mock("@/lib/data/catalog", () => ({
  getCourseBySlug: (slug: string) =>
    slug === fixtures.course.slug ? fixtures.course : undefined,
}));

vi.mock("@/lib/data/published-courses", () => ({
  fetchCoursesByIds: async (ids: string[]) => {
    fuse();
    fixtures.fetchedIds.push(ids);
    return fixtures.realCourses.filter((course) => ids.includes(course.id));
  },
  teacherCourseToLearningCourse: (course: unknown) => course,
}));

vi.mock("@/lib/data/enrollments", () => ({
  subscribeToUserEnrollments: (
    _uid: string,
    onData: (enrollments: Enrollment[]) => void,
  ) => {
    fuse();
    fixtures.emitEnrollments = onData;
    onData(fixtures.enrollments);
    return () => undefined;
  },
}));

// Matriculas ativas a mais, mais antigas que a de Effective Communication.
function extraEnrollments(count: number): Enrollment[] {
  return Array.from({ length: count }, (_, index) => ({
    ...fixtures.base[0],
    id: `extra-${index}`,
    courseId: `extra-${index}`,
    courseSlug: `extra-${index}`,
    courseTitle: `Extra Course ${index}`,
    lastLessonId: null,
    updatedAt: "2026-07-01T10:00:00.000Z",
  }));
}

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
    fixtures.enrollments = fixtures.base;
    fixtures.realCourses = [];
    fixtures.fetchedIds = [];
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
    fixtures.enrollments = [...fixtures.base, ...extraEnrollments(2)];
    render(<LearnDashboard />);

    for (const name of ["Continue watching", "My courses"]) {
      const heading = await screen.findByRole("heading", { name });
      expect(heading).not.toHaveClass("display-title");
      expect(heading.className).toContain("font-semibold");
    }
  });

  it("'Continue watching' abre na aula seguinte a ultima concluida — o mesmo destino do cartao em 'My courses'", async () => {
    fixtures.enrollments = [...fixtures.base, ...extraEnrollments(2)];
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

    // O mesmo curso em "My courses" leva ao mesmo lugar, nao a capa.
    const card = within(screen.getByRole("region", { name: "My courses" }))
      .getByRole("heading", { level: 3, name: "Effective Communication" })
      .closest("article") as HTMLElement;
    expect(within(card).getByRole("link", { name: "Open" })).toHaveAttribute(
      "href",
      "/learn/courses/effective-communication?lesson=l4",
    );
  });

  it("com ate 3 cursos, 'Continue watching' nao repete o que 'My courses' ja mostra", async () => {
    render(<LearnDashboard />);

    const region = await screen.findByRole("region", { name: "My courses" });
    expect(
      screen.queryByRole("region", { name: "Continue watching" }),
    ).not.toBeInTheDocument();
    // O cartao de "My courses" herda o destino de retomar.
    const card = within(region)
      .getByRole("heading", { level: 3, name: "Effective Communication" })
      .closest("article") as HTMLElement;
    expect(within(card).getByRole("link", { name: "Open" })).toHaveAttribute(
      "href",
      "/learn/courses/effective-communication?lesson=l4",
    );
  });

  it("um curso fora do catalogo publico ainda retoma na aula: o painel busca so os cursos da pessoa, por id, uma vez", async () => {
    // Despublicado, ou alem dos 200 que o catalogo baixava: antes o cartao
    // nunca achava o curso e abria a capa generica.
    const purchase: Enrollment = {
      ...fixtures.base[0],
      id: "enrollment-real",
      courseId: "course-real",
      // O webhook do Stripe grava o id em course_slug.
      courseSlug: "course-real",
      courseTitle: "Private Coaching Lab",
      lastLessonId: "r1",
    };
    fixtures.enrollments = [purchase];
    fixtures.realCourses = [
      {
        ...fixtures.course,
        id: "course-real",
        slug: "course-real",
        modules: [
          {
            id: "rm",
            title: "Only module",
            summary: "",
            lessons: [
              { id: "r1", title: "One", type: "video", duration: "5 min", isPreview: false },
              { id: "r2", title: "Two", type: "video", duration: "5 min", isPreview: false },
            ],
          },
        ],
      },
    ];
    render(<LearnDashboard />);

    const region = await screen.findByRole("region", { name: "My courses" });
    await waitFor(() =>
      expect(within(region).getByRole("link", { name: "Open" })).toHaveAttribute(
        "href",
        "/learn/courses/course-real?lesson=r2",
      ),
    );
    expect(fixtures.fetchedIds).toEqual([["course-real"]]);
    // A mesma lista desce para as fileiras de baixo, sem segunda busca.
    expect(screen.getByText("Learning paths: course-real")).toBeInTheDocument();

    // Progresso salvo re-emite as matriculas; os cursos sao os mesmos, entao
    // nada e baixado de novo.
    act(() => fixtures.emitEnrollments([{ ...purchase, progressPercent: 60 }]));
    expect(fixtures.fetchedIds).toEqual([["course-real"]]);
  });

  it("com poucos cursos nao ha busca nem filtro, e o concluido aparece junto", async () => {
    render(<LearnDashboard />);

    const region = await screen.findByRole("region", { name: "My courses" });
    expect(within(region).queryByRole("tab")).not.toBeInTheDocument();
    expect(within(region).queryByRole("searchbox")).not.toBeInTheDocument();
    for (const name of ["Effective Communication", "Brand Design Atelier"]) {
      expect(
        within(region).getByRole("heading", { level: 3, name }),
      ).toBeInTheDocument();
    }
  });

  it("o filtro Completed esconde a em andamento, e In progress e o padrao", async () => {
    // Busca e filtro so aparecem com mais de 6 cursos.
    fixtures.enrollments = [...fixtures.base, ...extraEnrollments(5)];
    render(<LearnDashboard />);

    const region = await screen.findByRole("region", { name: "My courses" });
    expect(within(region).getByRole("searchbox")).toBeInTheDocument();
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

  it("nenhum 'Request refund' no cartao, e o aviso de reembolso nao aparece a cada visita", async () => {
    render(<LearnDashboard />);

    await screen.findByRole("region", { name: "My courses" });
    expect(screen.queryByRole("button", { name: /refund/i })).not.toBeInTheDocument();
    // Nenhuma compra dentro da janela de reembolso: nada a dizer.
    expect(
      screen.queryByRole("link", { name: "Billing → Purchases" }),
    ).not.toBeInTheDocument();
  });

  it("com uma compra ainda dentro da janela de reembolso, aponta Billing → Purchases", async () => {
    fixtures.enrollments = [
      ...fixtures.base,
      {
        ...extraEnrollments(1)[0],
        progressPercent: 10,
        createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      },
    ];
    render(<LearnDashboard />);

    const region = await screen.findByRole("region", { name: "My courses" });
    expect(
      within(region).getByRole("link", { name: "Billing → Purchases" }),
    ).toHaveAttribute("href", "/account/billing?tab=purchases");
  });

  it("assinatura recente nao mostra o aviso: ela nao gera pedido, nao ha o que reembolsar em Purchases", async () => {
    fixtures.enrollments = [
      ...fixtures.base,
      {
        ...extraEnrollments(1)[0],
        source: "subscription",
        progressPercent: 10,
        createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      },
    ];
    render(<LearnDashboard />);

    await screen.findByRole("region", { name: "My courses" });
    expect(
      screen.queryByRole("link", { name: "Billing → Purchases" }),
    ).not.toBeInTheDocument();
  });

  it("curso concluido abre na capa da area de membros, nao na ultima aula", async () => {
    fixtures.enrollments = [
      {
        ...fixtures.base[0],
        status: "completed",
        progressPercent: 100,
        lastLessonId: "l4",
      },
    ];
    render(<LearnDashboard />);

    const region = await screen.findByRole("region", { name: "My courses" });
    expect(within(region).getByRole("link", { name: "Open" })).toHaveAttribute(
      "href",
      "/learn/courses/effective-communication",
    );
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

  it("sem live marcada, a coluna some em vez de gastar meia linha dizendo isso, e a metrica some", async () => {
    fixtures.events = [];
    render(<LearnDashboard />);

    await screen.findByRole("region", { name: "What's new" });
    expect(
      screen.queryByRole("region", { name: "Upcoming lives" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("1 course in progress")).toBeInTheDocument();
  });

  it.each(["javascript:void(0)", "data:text/plain,not-a-session", "ftp://example.com/live", "not a URL", ""])(
    "keeps the upcoming live details without a join link for invalid URL %j",
    async (externalUrl) => {
      fixtures.events = [{ ...fixtures.liveEvent, externalUrl }];
      render(<I18nProvider initialLocale="es"><LearnDashboard /></I18nProvider>);
      const lives = await screen.findByRole("region", { name: "Próximas sesiones en vivo" });
      expect(lives).toHaveTextContent("Live Q&A");
      expect(within(lives).queryByRole("link")).not.toBeInTheDocument();
      expect(lives).toHaveTextContent("El enlace de la sesión no está disponible. Contacta a tu instructor.");
    },
  );

  it("preserves a valid HTTP upcoming link and trims surrounding whitespace", async () => {
    fixtures.events = [{ ...fixtures.liveEvent, externalUrl: "  http://example.com/live  " }];
    render(<LearnDashboard />);
    const lives = await screen.findByRole("region", { name: "Upcoming lives" });
    const join = within(lives).getByRole("link", { name: "Join" });
    expect(join).toHaveAttribute("href", "http://example.com/live");
    expect(join).toHaveAttribute("target", "_blank");
    expect(join).toHaveAttribute("rel", "noreferrer");
  });

  it("a data da proxima live sai no idioma da pessoa", async () => {
    render(<I18nProvider initialLocale="es"><LearnDashboard /></I18nProvider>);

    expect(await screen.findByText(
      new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" }).format(new Date(fixtures.liveEvent.startsAt)),
    )).toBeInTheDocument();
  });

  it("um nome com $& na saudacao aparece literal, sem virar '{name}'", async () => {
    // Num replace sem callback, "$&" vira o trecho casado ("{name}") e "$'" o
    // resto da frase. O nome vem do cadastro: e texto da pessoa, nao nosso.
    mockUser.displayName = "Mc$&Donald Simon";
    try {
      render(<LearnDashboard />);

      expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(
        "Hi, Mc$&Donald",
      );
    } finally {
      mockUser.displayName = "Patrick Simon";
    }
  });
});
