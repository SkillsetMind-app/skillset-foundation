import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CreatorCourseDetail } from "@/components/courses/creator-course-detail";
import { startCourseCheckout, enrollInFreeCreatorCourse } from "@/lib/payments/checkout";
import { getCourseLanding } from "@/lib/data/course-landings";
import type { TeacherCourse } from "@/domain/teacher-course";

const fixtures = vi.hoisted(() => ({
  auth: { status: "unauthenticated", user: null as { uid: string } | null },
  query: "",
  router: { push: vi.fn(), replace: vi.fn() },
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
  useAuth: () => fixtures.auth,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => fixtures.router,
  useSearchParams: () => new URLSearchParams(fixtures.query),
}));

vi.mock("@/lib/feature-flags", () => ({ isPublicFeatureEnabled: () => true }));

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
  getCourseLanding: vi.fn(async () => ({ template: "classic", blocks: [] })),
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
  vi.clearAllMocks();
  fixtures.query = "";
  fixtures.auth.status = "unauthenticated";
  fixtures.auth.user = null;
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
  it("por padrão desenha o próprio cabeçalho com o título do curso", async () => {
    render(<CreatorCourseDetail courseIdOverride="course-1" />);

    await screen.findAllByText("$149.00");
    const title = screen.getByRole("heading", { level: 1, name: "Deep Focus Systems" });
    // Clamp, não 60px fixos.
    expect(title).toHaveClass("page-title");
    expect(title.className).not.toMatch(/text-6xl/);
  });

  it("com hideHeader não repete o título que a página já renderizou no servidor", async () => {
    const { container } = render(
      <CreatorCourseDetail courseIdOverride="course-1" hideHeader />,
    );

    await screen.findAllByText("$149.00");
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

const launchOffer = {
  id: "offer-1", courseId: "course-1", name: "Launch", publicCode: "LAUNCH", active: true,
  prices: [{ id: "price-1", offerId: "offer-1", amountMinor: 4900, currency: "USD", paymentType: "one_time", active: true }],
};
function withOffers(offers = [launchOffer]) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ offers }) })));
}

describe("permanent checkout", () => {
  it("shows identity and one purchase card without loading sales content", async () => {
    const { container } = render(<CreatorCourseDetail courseIdOverride="course-1" checkoutOnly />);
    expect(await screen.findByText("$149.00")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Deep Focus Systems" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Ana Prado/ })).toBeInTheDocument();
    expect(container.querySelector("#enroll-card")).not.toBeNull();
    expect(container.querySelector("#curriculum, #free-preview, .fixed")).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Course sections" })).not.toBeInTheDocument();
    expect(getCourseLanding).not.toHaveBeenCalled();
    expect(startCourseCheckout).not.toHaveBeenCalled();
  });

  it.each([false, true])("keeps offer and price through signup and signin (checkout %s)", async (checkoutOnly) => {
    fixtures.query = "offer=LAUNCH&priceId=price-1&checkout=cancelled&returnTo=https://evil.example";
    withOffers();
    render(<CreatorCourseDetail courseIdOverride="focus-slug" checkoutOnly={checkoutOnly} />);
    const enroll = await screen.findByRole("link", { name: /Enroll — \$49.00/ });
    const destination = `/courses/focus-slug${checkoutOnly ? "/checkout" : ""}?offer=LAUNCH&priceId=price-1`;
    expect(new URL(enroll.getAttribute("href")!, "https://test.local").searchParams.get("returnTo")).toBe(destination);
    const signin = screen.getByRole("link", { name: /Sign in/ });
    expect(new URL(signin.getAttribute("href")!, "https://test.local").searchParams.get("returnTo")).toBe(destination);
  });

  it("keeps offer selection on the checkout surface", async () => {
    fixtures.query = "offer=LAUNCH&checkout=cancelled";
    withOffers([launchOffer, { ...launchOffer, id: "offer-2", name: "Standard" }]);
    render(<CreatorCourseDetail courseIdOverride="focus-slug" checkoutOnly />);
    fireEvent.click(await screen.findByRole("radio", { name: /Standard/ }));
    expect(fixtures.router.replace).toHaveBeenCalledWith("/courses/focus-slug/checkout?offerId=offer-2", { scroll: false });
  });

  it("charges the resolved offer only after an explicit click", async () => {
    fixtures.auth.status = "authenticated"; fixtures.auth.user = { uid: "buyer" };
    fixtures.query = "offer=LAUNCH";
    withOffers();
    render(<CreatorCourseDetail courseIdOverride="focus-slug" checkoutOnly />);
    const button = await screen.findByRole("button", { name: /Enroll — \$49.00/ });
    expect(startCourseCheckout).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(startCourseCheckout).toHaveBeenCalledWith("course-1", { offerId: "offer-1", offerCode: "LAUNCH", priceId: "price-1" });
  });

  it("does not charge for an unavailable offer", async () => {
    fixtures.auth.status = "authenticated"; fixtures.auth.user = { uid: "buyer" };
    fixtures.query = "offer=MISSING";
    withOffers();
    render(<CreatorCourseDetail courseIdOverride="course-1" checkoutOnly />);
    expect(await screen.findByText("The selected offer is no longer available.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Checkout not available yet" })).toBeDisabled();
    expect(startCourseCheckout).not.toHaveBeenCalled();
  });

  it("reuses free enrollment without opening Stripe", async () => {
    fixtures.auth.status = "authenticated"; fixtures.auth.user = { uid: "buyer" };
    withOffers([{ ...launchOffer, prices: [{ ...launchOffer.prices[0], amountMinor: 0, paymentType: "free" }] }]);
    render(<CreatorCourseDetail courseIdOverride="course-1" checkoutOnly />);
    fireEvent.click(await screen.findByRole("button", { name: "Enroll free" }));
    await waitFor(() => expect(fixtures.router.push).toHaveBeenCalledWith("/learn/courses/course-1"));
    expect(enrollInFreeCreatorCourse).toHaveBeenCalledWith("course-1");
    expect(startCourseCheckout).not.toHaveBeenCalled();
  });
});
