import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CreatorCourseDetail } from "@/components/courses/creator-course-detail";
import { startCourseCheckout, enrollInFreeCreatorCourse } from "@/lib/payments/checkout";
import { PaymentRequestError } from "@/lib/payments/client-fetch";
import { getCourseLanding } from "@/lib/data/course-landings";
import { getLessonContentDoc } from "@/lib/data/lesson-content";
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

// The consent-gated door to PostHog (its own tests cover the gate): here it
// just records what the page hands over.
const analytics = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock("@/lib/posthog/client", () => ({ captureEvent: analytics.capture }));

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
  // Devolve o que a aula traz em linha (o fixture padrao nao traz nada).
  resolveLessonContent: (
    _doc: unknown,
    lesson: { contentText?: string | null; externalUrl?: string | null },
  ) => ({ contentText: lesson.contentText ?? null, externalUrl: lesson.externalUrl ?? null }),
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

  // A aula de previa gratis mostra o texto na pagina do curso: as mesmas
  // quebras de linha e links clicaveis da area de membros, sem HTML cru.
  it("texto da aula de previa gratis vira link e mantem a quebra de linha", async () => {
    vi.mocked(getLessonContentDoc).mockResolvedValue(null);
    const course = fixtures.course as TeacherCourse;
    const lesson = course.modules[0].lessons[0];
    course.freePreviewLessonId = "lesson-1";
    lesson.contentText = "linha 1\nveja https://a.com/x.";
    try {
      render(<CreatorCourseDetail courseIdOverride="course-1" />);
      await screen.findAllByText("$149.00");

      const preview = document.getElementById("free-preview") as HTMLElement;
      const link = preview.querySelector('a[href="https://a.com/x"]');
      expect(link).not.toBeNull();
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer nofollow ugc");
      expect(link?.parentElement).toHaveClass("whitespace-pre-line");
      expect(preview.textContent).toContain("linha 1\nveja https://a.com/x.");
    } finally {
      delete course.freePreviewLessonId;
      delete lesson.contentText;
    }
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

describe("CreatorCourseDetail: funnel events", () => {
  const enroll = translate(getDictionary("en"), "publicCourses.enroll");

  function sent(name: string) {
    return analytics.capture.mock.calls.filter(([event]) => event === name);
  }

  it("sends course_viewed once, with ids only, when the public page resolves its price", async () => {
    render(<CreatorCourseDetail courseIdOverride="course-1" hideHeader />);
    await screen.findAllByText("$149.00");

    await waitFor(() => expect(sent("course_viewed")).toHaveLength(1));
    const [, props] = sent("course_viewed")[0];
    expect(Object.keys(props).filter((key) => props[key] !== undefined).sort())
      .toEqual(["course_id", "currency", "is_free"]);
    expect(props).toMatchObject({ course_id: "course-1", is_free: false });
    expect(String(props.currency).toUpperCase()).toBe("USD");
  });

  // The checkout-only page is a step of the purchase, not another view.
  it("sends no course_viewed from the checkout-only step", async () => {
    render(<CreatorCourseDetail courseIdOverride="course-1" checkoutOnly />);
    await screen.findAllByText(/\$149\.00/);
    expect(sent("course_viewed")).toHaveLength(0);
  });

  it("sends checkout_started once from the buy button, with no personal data", async () => {
    const buyer = { uid: "buyer-1", email: "buyer@example.test", displayName: "Bia Buyer" };
    fixtures.auth.status = "authenticated";
    fixtures.auth.user = buyer;
    render(<CreatorCourseDetail courseIdOverride="course-1" hideHeader />);
    await screen.findAllByText(/\$149\.00/);

    const buy = screen.getAllByRole("button").find((button) => button.textContent?.startsWith(enroll));
    fireEvent.click(buy!);
    await waitFor(() => expect(startCourseCheckout).toHaveBeenCalledTimes(1));

    expect(sent("checkout_started")).toHaveLength(1);
    const [, props] = sent("checkout_started")[0];
    expect(props).toMatchObject({ course_id: "course-1", price_minor: 14900 });
    expect(String(props.currency).toUpperCase()).toBe("USD");
    expect(props).not.toHaveProperty("coupon_code");
    // Nothing about the buyer, the teacher or the course copy in any payload.
    const everything = JSON.stringify(analytics.capture.mock.calls);
    for (const personal of ["buyer@example.test", "Bia Buyer", "Ana Prado", "Deep Focus Systems", "@"]) {
      expect(everything).not.toContain(personal);
    }
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
function withOffers(offers: object[] = [launchOffer]) {
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

// Padlocked lesson + buy popup: the buyer stays on this page. The popup uses
// only public course fields; no lesson content is fetched for the visitor.
describe("CreatorCourseDetail — padlocked lessons and the buy popup", () => {
  const mutable = fixtures.course as TeacherCourse;
  const original = { modules: mutable.modules, freePreviewLessonId: mutable.freePreviewLessonId };

  afterEach(() => {
    mutable.modules = original.modules;
    mutable.freePreviewLessonId = original.freePreviewLessonId;
  });

  it("clicking a locked lesson opens a dialog with the course title; its button goes to #enroll-card", async () => {
    render(<CreatorCourseDetail courseIdOverride="course-1" />);
    await screen.findAllByText("$149.00");

    fireEvent.click(screen.getByRole("button", { name: /Why focus breaks/ }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Deep Focus Systems" })).toBeInTheDocument();
    const cta = within(dialog).getByRole("link", { name: "Enroll — $149.00" });
    expect(cta).toHaveAttribute("href", "#enroll-card");

    // Same page: the popup closes and nothing navigates away.
    fireEvent.click(cta);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(fixtures.router.push).not.toHaveBeenCalled();

    // Anonymous visitor: no lesson content fetch, and the only network call is
    // the public offers list.
    expect(getLessonContentDoc).not.toHaveBeenCalled();
    for (const [url] of vi.mocked(fetch).mock.calls) {
      expect(String(url)).not.toMatch(/lesson|video/i);
    }
  });

  it("the free-preview lesson is still not locked", async () => {
    mutable.freePreviewLessonId = "lesson-2";
    mutable.modules = [{
      ...original.modules[0],
      lessons: [
        ...original.modules[0].lessons,
        { id: "lesson-2", title: "Free taste", type: "video", description: "" },
      ],
    }];
    vi.mocked(getLessonContentDoc).mockResolvedValue(null as never);
    render(<CreatorCourseDetail courseIdOverride="course-1" />);
    await screen.findAllByText("$149.00");

    expect(screen.queryByRole("button", { name: /Free taste/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Why focus breaks/ })).toHaveAttribute("aria-haspopup", "dialog");
    // Only the preview row can ever be read by a visitor.
    for (const [, lessonId] of vi.mocked(getLessonContentDoc).mock.calls) {
      expect(lessonId).toBe("lesson-2");
    }
  });

  // The popup used to format course.priceAmountMinor itself, in English: a
  // default offer, a discount code, a subscription or a Spanish visitor made it
  // disagree with the buy card. Now it carries the card's own label.
  const cardAction = (container: HTMLElement) =>
    container.querySelector<HTMLElement>("#enroll-card [data-cta-focus]");

  it.each([
    ["a default offer that differs from the course field", () => {
      withOffers([{ ...launchOffer, isDefault: true }]);
    }, "Enroll — $49.00"],
    ["an ?offer= discount code", () => {
      fixtures.query = "offer=LAUNCH";
      withOffers([
        {
          ...launchOffer, id: "offer-std", publicCode: null, isDefault: true,
          prices: [{ ...launchOffer.prices[0], id: "price-std", offerId: "offer-std", amountMinor: 14900 }],
        },
        launchOffer,
      ]);
    }, "Enroll — $49.00"],
    ["a monthly subscription", () => {
      Object.assign(fixtures.course, { paymentType: "subscription_monthly" });
    }, "Subscribe — $149.00 / month"],
    ["a Spanish visitor", () => {
      fixtures.locale = "es";
    }, "Inscribirse —"],
  ])("the popup button says exactly what the buy card says: %s", async (_case, setup, expected) => {
    setup();
    const { container } = render(<CreatorCourseDetail courseIdOverride="course-1" />);
    await waitFor(() => expect(cardAction(container)).toHaveTextContent(expected));

    fireEvent.click(screen.getByRole("button", { name: /Why focus breaks/ }));

    const popupCta = within(screen.getByRole("dialog")).getAllByRole("link")[0];
    expect(popupCta.textContent?.trim()).toBe(cardAction(container)?.textContent?.trim());
  });

  it("a free course gets free wording and no price", async () => {
    Object.assign(fixtures.course, { paymentType: "free", priceAmountMinor: 0 });
    withOffers([]);
    const { container } = render(<CreatorCourseDetail courseIdOverride="course-1" />);
    await waitFor(() => expect(cardAction(container)).toHaveTextContent("Enroll free"));

    fireEvent.click(screen.getByRole("button", { name: /Why focus breaks/ }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Enroll free to watch every lesson.")).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "Enroll free" })).toHaveAttribute("href", "#enroll-card");
    expect(dialog).not.toHaveTextContent(/\$|Buy the course/);
  });

  it("after the popup button, focus lands on the buy card's main button", async () => {
    const { container } = render(<CreatorCourseDetail courseIdOverride="course-1" />);
    await screen.findAllByText("$149.00");

    fireEvent.click(screen.getByRole("button", { name: /Why focus breaks/ }));
    fireEvent.click(within(screen.getByRole("dialog")).getAllByRole("link")[0]);

    await waitFor(() => expect(cardAction(container)).toHaveFocus());
  });

  it("the course owner sees no padlocks on their own course", async () => {
    fixtures.auth.status = "authenticated";
    fixtures.auth.user = { uid: "teacher-1" };
    render(<CreatorCourseDetail courseIdOverride="course-1" />);
    await screen.findAllByText("$149.00");

    expect(screen.queryByRole("button", { name: /Why focus breaks/ })).not.toBeInTheDocument();
    expect(screen.getByText("Why focus breaks")).toBeInTheDocument();
  });
});
