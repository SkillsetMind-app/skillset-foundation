import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CreatorCourseDetail } from "@/components/courses/creator-course-detail";
import type { TeacherCourse } from "@/domain/teacher-course";

const fixtures = vi.hoisted(() => ({
  course: {
    id: "course-1",
    ownerId: "teacher-1",
    title: "Deep Focus Systems",
    summary: "Build a repeatable focus practice.",
    category: "Performance",
    status: "published",
    learningOutcomes: ["Protect two deep-work blocks a day"],
    priceAmountMinor: 14900,
    currency: "USD",
    paymentType: "one_time",
    ratingAverage: 4.8,
    ratingCount: 12,
    modules: [
      {
        id: "module-1",
        title: "Foundations",
        lessons: [
          {
            id: "lesson-1",
            title: "Why focus breaks",
            type: "video",
            description: "",
            durationMinutes: 90,
          },
        ],
      },
    ],
    lessonCount: 1,
  } satisfies TeacherCourse,
  profile: {
    uid: "teacher-1",
    displayName: "Ana Prado",
    username: "ana",
    photoURL: null,
    bio: null,
    credentials: ["PhD in cognitive science"],
  },
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    refreshUser: vi.fn(),
    status: "unauthenticated",
    user: null,
    signOut: vi.fn(),
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/supabase/config", () => ({
  getSupabaseClientConfig: () => ({}),
}));

// Entrega o curso publicado na hora, como a assinatura real faria.
vi.mock("@/lib/data/published-courses", () => ({
  subscribeToViewableTeacherCourse: (
    _ref: string,
    onNext: (course: TeacherCourse) => void,
  ) => {
    onNext(fixtures.course);
    return () => {};
  },
}));

vi.mock("@/lib/data/course-landings", () => ({
  emptyCourseLanding: { template: "classic", blocks: [] },
  getCourseLanding: async () => ({ template: "classic", blocks: [] }),
}));

vi.mock("@/lib/data/lesson-content", () => ({
  getLessonContentDoc: vi.fn(),
  resolveLessonContent: () => ({ contentText: null, externalUrl: null }),
}));

vi.mock("@/lib/payments/checkout", () => ({
  enrollInFreeCreatorCourse: vi.fn(),
  startCourseCheckout: vi.fn(),
}));

vi.mock("@/components/courses/course-landing-blocks", () => ({
  CourseLandingBlocks: () => null,
}));

vi.mock("@/components/courses/course-social-proof", () => ({
  CourseInstructorCard: () => <div data-testid="instructor-card" />,
  CourseReviewsSection: () => null,
  useInstructorProfile: () => fixtures.profile,
}));

vi.mock("@/components/courses/bunny-video-player", () => ({
  BunnyVideoPlayer: () => null,
}));

beforeEach(() => {
  // Sem oferta cadastrada o preço cai no campo do próprio curso: US$ 149.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ offers: [] }) })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CreatorCourseDetail", () => {
  it("por padrão desenha o próprio cabeçalho com o título do curso", () => {
    render(<CreatorCourseDetail courseIdOverride="course-1" />);

    const title = screen.getByRole("heading", { level: 1, name: "Deep Focus Systems" });
    // Clamp, não 60px fixos.
    expect(title).toHaveClass("page-title");
    expect(title.className).not.toMatch(/text-6xl/);
  });

  it("com hideHeader não repete o título que a página já renderizou no servidor", () => {
    const { container } = render(
      <CreatorCourseDetail courseIdOverride="course-1" hideHeader />,
    );

    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(screen.queryByText("Deep Focus Systems")).not.toBeInTheDocument();
    // O resto do conteúdo interativo continua no lugar.
    expect(container.querySelector("#free-preview")).not.toBeNull();
  });
});

describe("CreatorCourseDetail: o cartão que vende", () => {
  it("põe o preço no topo do cartão de compra, e não na quarta linha de uma lista", async () => {
    const { container } = render(
      <CreatorCourseDetail courseIdOverride="course-1" hideHeader />,
    );

    const card = container.querySelector("#enroll-card");
    expect(card).not.toBeNull();
    expect(await screen.findAllByText("$149.00")).toHaveLength(2);

    // O preço é o número grande do topo, antes de qualquer lista.
    const price = card?.querySelector(".display-title");
    expect(price?.textContent).toContain("$149.00");
    expect(price?.textContent).toContain("one-time");
  });

  it("tira Status e Access da lista: são vocabulário interno", async () => {
    const { container } = render(
      <CreatorCourseDetail courseIdOverride="course-1" hideHeader />,
    );
    await screen.findAllByText("$149.00");

    const labels = Array.from(
      container.querySelectorAll("#enroll-card dt"),
    ).map((node) => node.textContent);
    expect(labels).not.toContain("Status");
    expect(labels).not.toContain("Access");
    expect(labels).not.toContain("Price");
    expect(labels).toContain("Category");
  });

  it("mantém o cartão à vista: gruda na rolagem e ganha barra fixa no celular", async () => {
    const { container } = render(
      <CreatorCourseDetail courseIdOverride="course-1" hideHeader />,
    );
    await screen.findAllByText("$149.00");

    expect(container.querySelector("#enroll-card")).toHaveClass("lg:sticky");
    // Barra do celular: leva ao cartão e some no desktop.
    const bar = container.querySelector('a[href="#enroll-card"]');
    expect(bar).not.toBeNull();
    expect(bar?.closest("div.fixed")).toHaveClass("lg:hidden");
  });

  it("assina o curso com quem ensina, com credencial, nota e duração", async () => {
    render(<CreatorCourseDetail courseIdOverride="course-1" hideHeader />);
    await screen.findAllByText("$149.00");

    expect(
      screen.getByRole("link", { name: /Ana Prado/ }),
    ).toHaveAttribute("href", "/instructors/teacher-1");
    expect(screen.getByText("PhD in cognitive science")).toBeInTheDocument();
    expect(screen.getByText("4.8")).toBeInTheDocument();
    // Na assinatura e na ficha do cartao de compra.
    expect(screen.getAllByText("1h 30m")).toHaveLength(2);
  });

  it("sobe a prova social: o instrutor vem antes da amostra gratuita", async () => {
    const { container } = render(
      <CreatorCourseDetail courseIdOverride="course-1" hideHeader />,
    );
    await screen.findAllByText("$149.00");

    const blocks = Array.from(
      container.querySelectorAll("#what-you-will-learn, #instructor, #free-preview"),
    ).map((node) => node.id);
    // Depois do "What you'll learn", e nao no fim da barra lateral.
    expect(blocks).toEqual(["what-you-will-learn", "instructor", "free-preview"]);
  });

  it("chama o visitante de volta para o curso depois de criar conta", async () => {
    render(<CreatorCourseDetail courseIdOverride="course-1" hideHeader />);

    const enroll = await screen.findByRole("link", {
      name: /Enroll \u2014 \$149\.00/,
    });
    expect(enroll).toHaveAttribute(
      "href",
      "/auth?mode=signup&returnTo=%2Fcourses%2Fcourse-1",
    );
  });

  it("oferece as seções que existem, e só elas", async () => {
    render(<CreatorCourseDetail courseIdOverride="course-1" hideHeader />);
    await screen.findAllByText("$149.00");

    const nav = screen.getByRole("navigation", { name: "Course sections" });
    expect(
      Array.from(nav.querySelectorAll("a")).map((link) => link.textContent),
    ).toEqual([
      "Overview",
      "What you'll learn",
      "Free preview",
      "Curriculum",
      "Reviews",
      "Instructor",
    ]);
  });
});
