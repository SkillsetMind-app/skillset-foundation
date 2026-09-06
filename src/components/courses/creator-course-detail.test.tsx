import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CreatorCourseDetail } from "@/components/courses/creator-course-detail";
import { startCourseCheckout, enrollInFreeCreatorCourse } from "@/lib/payments/checkout";
import { PaymentRequestError } from "@/lib/payments/client-fetch";
import { getCourseLanding } from "@/lib/data/course-landings";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";
import type { TeacherCourse } from "@/domain/teacher-course";

const fixtures = vi.hoisted(() => ({
  auth: { status: "unauthenticated", user: null as { uid: string } | null },
  query: "",
  locale: "en" as "en" | "es",
  subscriptions: 0,
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

vi.mock("@/components/i18n/i18n-provider", () => ({ useTranslation: () => ({ locale: fixtures.locale, t: (key: string) => translate(getDictionary(fixtures.locale), key) }) }));

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
    fixtures.subscriptions += 1;
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
  fixtures.locale = "en";
  fixtures.subscriptions = 0;
  fixtures.auth.status = "unauthenticated";
  fixtures.auth.user = null;
  fixtures.course.paymentType = "one_time";
  fixtures.course.priceAmountMinor = 14900;
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
    Object.assign(fixtures.course, { paymentType: "free", priceAmountMinor: 0 });
    withOffers([]);
    render(<CreatorCourseDetail courseIdOverride="course-1" checkoutOnly />);
    fireEvent.click(await screen.findByRole("button", { name: "Enroll free" }));
    await waitFor(() => expect(fixtures.router.push).toHaveBeenCalledWith("/learn/courses/course-1"));
    expect(enrollInFreeCreatorCourse).toHaveBeenCalledWith("course-1");
    expect(startCourseCheckout).not.toHaveBeenCalled();
  });
});

it("switches loaded checkout to Spanish without losing the coupon or subscribing again", async () => {
  fixtures.auth = { status: "authenticated", user: { uid: "buyer" } };
  const { rerender } = render(<CreatorCourseDetail courseIdOverride="course-1" checkoutOnly />);
  await screen.findByRole("button", { name: "Have a coupon?" });
  fireEvent.click(screen.getByRole("button", { name: "Have a coupon?" }));
  fireEvent.change(screen.getByLabelText("Coupon code"), { target: { value: "SAVE25" } });
  const calls = fixtures.subscriptions;
  fixtures.locale = "es";
  rerender(<CreatorCourseDetail courseIdOverride="course-1" checkoutOnly />);
  expect(screen.getByLabelText("Código de cupón")).toHaveValue("SAVE25");
  expect(screen.getByRole("heading", { name: "Deep Focus Systems" })).toBeInTheDocument();
  expect(screen.getByText("Build a repeatable focus practice.")).toBeInTheDocument();
  expect(fixtures.subscriptions).toBe(calls);
  fireEvent.click(screen.getByRole("button", { name: /Inscribirse —/ }));
  await waitFor(() => expect(startCourseCheckout).toHaveBeenCalledWith("course-1", { couponCode: "SAVE25" }));
});

describe("checkout errors in the current locale", () => {
  beforeEach(() => {
    fixtures.auth = { status: "authenticated", user: { uid: "buyer" } };
    fixtures.locale = "es";
  });

  it.each([
    ["Coupon not found.", "Este cupón no es válido. Revisa el código o elimínalo para continuar."],
    ["Invalid coupon code.", "Este cupón no es válido. Revisa el código o elimínalo para continuar."],
    ["This coupon is not active.", "Este cupón ya no está disponible. Elimínalo o usa otro código."],
    ["This coupon is no longer available.", "Este cupón ya no está disponible. Elimínalo o usa otro código."],
    ["This coupon has expired.", "Este cupón ha caducado. Elimínalo o usa otro código."],
    ["This coupon has reached its redemption limit.", "Este cupón ha alcanzado su límite de usos. Elimínalo o usa otro código."],
    ["Invalid price for coupon redemption.", "Este cupón no se puede aplicar a este precio. Elimínalo o usa otro código."],
    ["Coupon would zero out a paid checkout.", "Este cupón no se puede aplicar a este precio. Elimínalo o usa otro código."],
  ])("shows a safe actionable coupon message for %s", async (message, expected) => {
    vi.mocked(startCourseCheckout).mockRejectedValueOnce(new PaymentRequestError(message, 400));
    render(<CreatorCourseDetail courseIdOverride="course-1" checkoutOnly />);
    fireEvent.click(await screen.findByRole("button", { name: /Inscribirse —/ }));
    expect(await screen.findByText(expected)).toBeInTheDocument();
    expect(screen.queryByText(message)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Inscribirse —/ })).toBeEnabled();
  });

  it.each([
    [409, "Another offer already has an active checkout. Close it or wait for it to expire before switching offers.", "Ya hay un proceso de pago activo para otra oferta. Vuelve a él o espera a que caduque antes de cambiar de oferta."],
    [409, "A checkout for this course is already starting. Please try again in a moment.", "Ya se está iniciando el pago de este curso. Vuelve a intentarlo en un momento."],
    [409, "A subscription checkout for this course is already starting. Please try again in a moment.", "Ya se está iniciando el pago de este curso. Vuelve a intentarlo en un momento."],
    [409, "This course is already attached to your learning workspace.", "Ya tienes acceso a este curso. Ábrelo desde tu espacio de aprendizaje."],
    [409, "You already have a subscription for this course.", "Ya tienes una suscripción a este curso. Revisa tus suscripciones antes de volver a intentarlo."],
    [400, "A valid courseId is required.", "Abre este curso desde el catálogo y vuelve a intentarlo."],
    [400, "The selected offer is invalid.", "La oferta seleccionada ya no está disponible."],
    [400, "The selected offer code is invalid.", "La oferta seleccionada ya no está disponible."],
    [400, "This course is not available for purchase right now.", "Este curso no está disponible para comprar en este momento."],
    [400, "You can't purchase your own course.", "No puedes comprar tu propio curso."],
    [400, "This course does not have a paid checkout price yet.", "Este curso todavía no tiene un precio de compra."],
    [400, "This teacher has not connected Stripe payouts yet.", "Este instructor todavía no está listo para aceptar pagos."],
    [400, "This teacher must finish Stripe onboarding before paid checkout opens.", "Este instructor todavía no está listo para aceptar pagos."],
    [404, "Course not found.", "Curso no encontrado."],
    [429, "Too many attempts. Please wait before trying again.", "Demasiados intentos. Espera antes de volver a intentarlo."],
  ])("localizes the known checkout response %s: %s", async (status, message, expected) => {
    vi.mocked(startCourseCheckout).mockRejectedValueOnce(new PaymentRequestError(message, status));
    render(<CreatorCourseDetail courseIdOverride="course-1" checkoutOnly />);
    fireEvent.click(await screen.findByRole("button", { name: /Inscribirse —/ }));
    expect(await screen.findByText(expected)).toBeInTheDocument();
    expect(screen.queryByText(message)).not.toBeInTheDocument();
  });

  it.each([
    [401, "unauthenticated", "Vuelve a iniciar sesión para comenzar el pago."],
    [503, "payments_not_configured", "Los pagos no están disponibles temporalmente. Inténtalo más tarde."],
  ])("uses the public error code %s/%s without showing provider details", async (status, code, expected) => {
    vi.mocked(startCourseCheckout).mockRejectedValueOnce(new PaymentRequestError("PRIVATE_INTERNAL_DETAIL", status, code));
    render(<CreatorCourseDetail courseIdOverride="course-1" checkoutOnly />);
    fireEvent.click(await screen.findByRole("button", { name: /Inscribirse —/ }));
    expect(await screen.findByText(expected)).toBeInTheDocument();
    expect(screen.queryByText(/PRIVATE_INTERNAL_DETAIL/)).not.toBeInTheDocument();
  });

  it("translates an existing error on toggle without losing coupon, offer, or subscriptions", async () => {
    fixtures.locale = "en";
    fixtures.query = "offer=LAUNCH";
    withOffers();
    vi.mocked(startCourseCheckout).mockRejectedValueOnce(new PaymentRequestError("This coupon has expired.", 400));
    const { rerender } = render(<CreatorCourseDetail courseIdOverride="course-1" checkoutOnly />);
    fireEvent.click(await screen.findByRole("button", { name: "Have a coupon?" }));
    fireEvent.change(screen.getByLabelText("Coupon code"), { target: { value: "SAVE25" } });
    fireEvent.click(await screen.findByRole("button", { name: /Enroll — \$49.00/ }));
    expect(await screen.findByText("This coupon has expired. Remove it or use another code.")).toBeInTheDocument();
    const calls = fixtures.subscriptions;

    fixtures.locale = "es";
    rerender(<CreatorCourseDetail courseIdOverride="course-1" checkoutOnly />);

    expect(screen.getByText("Este cupón ha caducado. Elimínalo o usa otro código.")).toBeInTheDocument();
    expect(screen.getByLabelText("Código de cupón")).toHaveValue("SAVE25");
    expect(screen.getByRole("button", { name: /Inscribirse —/ })).toBeEnabled();
    expect(fixtures.subscriptions).toBe(calls);
    expect(startCourseCheckout).toHaveBeenCalledTimes(1);
    expect(startCourseCheckout).toHaveBeenCalledWith("course-1", { couponCode: "SAVE25", offerId: "offer-1", offerCode: "LAUNCH", priceId: "price-1" });
  });

  it.each([
    new Error("This coupon has expired."),
    new PaymentRequestError("PRIVATE_INTERNAL_DETAIL", 400),
    new PaymentRequestError("This coupon has expired. PRIVATE_INTERNAL_DETAIL", 400),
    new PaymentRequestError("This coupon has expired.", 500),
    new PaymentRequestError("PRIVATE_INTERNAL_DETAIL", 500, "payments_not_configured"),
  ])("keeps an unknown or mismatched response generic: %s", async (error) => {
    vi.mocked(startCourseCheckout).mockRejectedValueOnce(error);
    render(<CreatorCourseDetail courseIdOverride="course-1" checkoutOnly />);
    fireEvent.click(await screen.findByRole("button", { name: /Inscribirse —/ }));
    expect(await screen.findByText("No pudimos iniciar el pago seguro. Inténtalo de nuevo o contacta con soporte.")).toBeInTheDocument();
    expect(screen.queryByText(/PRIVATE_INTERNAL_DETAIL|This coupon has expired/)).not.toBeInTheDocument();
  });
});
