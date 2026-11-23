import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CreatorCourseDetail } from "@/components/courses/creator-course-detail";
import { RealCoursesProvider } from "@/components/site/real-courses";
import { startCourseCheckout, enrollInFreeCreatorCourse, startGuestCourseCheckout } from "@/lib/payments/checkout";
import { getLoadingRoute, getSafeReturnTo } from "@/lib/auth/routing";
import { isPlatformHost } from "@/domain/host-routing";
import { signInWithGoogle } from "@/lib/auth/supabase-auth";
import { PaymentRequestError } from "@/lib/payments/client-fetch";
import { getCourseLanding } from "@/lib/data/course-landings";
import { getLessonContentDoc } from "@/lib/data/lesson-content";
import { getLiveEventSession } from "@/lib/data/course-events";
import { subscribeToEnrollment } from "@/lib/data/enrollments";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";
import type { TeacherCourse } from "@/domain/teacher-course";

const fixtures = vi.hoisted(() => ({
  auth: { status: "unauthenticated", user: null as { uid: string } | null },
  query: "",
  locale: "en" as "en" | "es",
  subscriptions: 0,
  // true: a assinatura do curso não responde, como uma leitura ainda a caminho.
  holdCourse: false,
  // O último onNext da assinatura do curso, para entregar o curso mais tarde.
  courseNext: null as ((course: TeacherCourse) => void) | null,
  // O último onError da assinatura do curso, para simular a rede que cai.
  courseError: null as ((error: Error) => void) | null,
  // As chaves públicas (payments.checkout): ligadas, salvo no teste que as desliga.
  flagsOn: true,
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

vi.mock("@/lib/feature-flags", () => ({ isPublicFeatureEnabled: () => fixtures.flagsOn }));

vi.mock("@/lib/supabase/config", () => ({
  getSupabaseClientConfig: () => ({}),
}));

// Entrega o curso publicado na hora, como a assinatura real faria.
vi.mock("@/lib/data/published-courses", () => ({
  subscribeToViewableTeacherCourse: (
    _ref: string,
    onNext: (course: TeacherCourse) => void,
    onError: (error: Error) => void,
  ) => {
    fixtures.subscriptions += 1;
    fixtures.courseNext = onNext;
    fixtures.courseError = onError;
    if (!fixtures.holdCourse) onNext(fixtures.course);
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

// A data da sessao do evento ao vivo (get_live_event_session).
vi.mock("@/lib/data/course-events", () => ({
  getLiveEventSession: vi.fn(async () => null),
}));

vi.mock("@/lib/payments/checkout", () => ({
  enrollInFreeCreatorCourse: vi.fn(),
  startCourseCheckout: vi.fn(),
  startGuestCourseCheckout: vi.fn(),
}));

// Guest checkout form: the bot check reports a token at once, like a passed
// challenge; Google sign-in is on and never leaves the page here.
vi.mock("@/components/auth/turnstile-widget", async () => {
  const { useEffect } = await import("react");
  return {
    TurnstileWidget: ({ onToken }: { onToken: (token: string) => void }) => {
      useEffect(() => onToken("turnstile-token"), [onToken]);
      return null;
    },
  };
});
vi.mock("@/lib/auth/providers", () => ({ isGoogleAuthEnabled: true }));
vi.mock("@/lib/auth/supabase-auth", () => ({ signInWithGoogle: vi.fn(() => new Promise(() => {})) }));
// Real host rule (jsdom runs on localhost, a platform host); one test swaps it.
vi.mock("@/domain/host-routing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/domain/host-routing")>();
  return { ...actual, isPlatformHost: vi.fn(actual.isPlatformHost) };
});

// The teacher's sales blocks: one button wired to onEnrol, like their CTA block.
// `data-price`: o preço que o bloco recebe (sem atributo quando não recebe nada).
vi.mock("@/components/courses/course-landing-blocks", () => ({
  CourseLandingBlocks: ({ onEnrol, priceLabel }: { onEnrol?: () => void; priceLabel?: string }) => (
    <div data-testid="landing-blocks" data-price={priceLabel}>
      <button type="button" onClick={onEnrol}>Sales block CTA</button>
    </div>
  ),
}));

vi.mock("@/components/courses/course-social-proof", () => ({
  CourseInstructorCard: () => <div data-testid="instructor-card" />,
  CourseReviewsSection: () => null,
  useInstructorProfile: () => fixtures.profile,
}));

vi.mock("@/components/courses/bunny-video-player", () => ({
  BunnyVideoPlayer: () => null,
}));

// The viewer's enrollment (the same read the classroom uses). Default: none,
// delivered at once; `deliverLater` holds it back so a test can send it via
// `onNext`, like a read that arrives after the page has painted.
const enrollmentState = vi.hoisted(() => ({
  current: null as { status: string } | null,
  deliverLater: false,
  onNext: null as ((enrollment: unknown) => void) | null,
}));
vi.mock("@/lib/data/enrollments", () => ({
  subscribeToEnrollment: vi.fn((_uid: string, _courseId: string, onNext: (enrollment: unknown) => void) => {
    enrollmentState.onNext = onNext;
    if (!enrollmentState.deliverLater) onNext(enrollmentState.current);
    return () => {};
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  fixtures.query = "";
  fixtures.locale = "en";
  fixtures.subscriptions = 0;
  fixtures.holdCourse = false;
  fixtures.flagsOn = true;
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

// Carregar não é erro: antes, um segundo h1 "Loading course..." e um botão que
// levava o comprador para fora da página; depois, "Loading pricing..." em 36px
// e "Checkout not available yet" para quem já tinha conta.
describe("CreatorCourseDetail: enquanto carrega", () => {
  it.each([false, true])("o curso a caminho mostra o esqueleto: sem título, sem botão de saída (compra: %s)", (checkoutOnly) => {
    fixtures.holdCourse = true;
    render(<CreatorCourseDetail courseIdOverride="course-1" hideHeader checkoutOnly={checkoutOnly} />);

    expect(screen.getByRole("status")).toHaveTextContent(checkoutOnly ? "Loading course checkout..." : "Loading course...");
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("um erro de verdade segue com o aviso, e vira h2 sob o h1 que o servidor já pôs", () => {
    render(<CreatorCourseDetail hideHeader />);

    expect(screen.getByRole("heading", { level: 2, name: "Course not selected." })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(screen.queryByText("Creator course")).not.toBeInTheDocument();
  });

  it("o preço a caminho guarda o lugar, e o botão de quem tem conta diz Enroll, desligado", async () => {
    fixtures.auth.status = "authenticated";
    fixtures.auth.user = { uid: "buyer" };
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    const { container } = render(<CreatorCourseDetail courseIdOverride="course-1" hideHeader />);

    const button = await waitFor(() => {
      const found = container.querySelector<HTMLButtonElement>("#enroll-card button[data-cta-focus]");
      expect(found).not.toBeNull();
      return found!;
    });
    expect(button).toHaveTextContent(/^Enroll$/);
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText("Checkout not available yet")).not.toBeInTheDocument();
    // O texto só para o leitor de tela; na tela, a barra do tamanho do preço.
    expect(within(container.querySelector<HTMLElement>("#enroll-card")!).getByText("Loading pricing...")).toHaveClass("sr-only");
  });

  // O bloco de chamada do professor imprimia "Loading pricing..." e "Pricing
  // unavailable" em 18px negrito, como se fossem o preço.
  it("o bloco do professor só recebe preço de verdade: nada carregando, nada com falha", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    const loading = render(<CreatorCourseDetail courseIdOverride="course-1" hideHeader />);
    expect(await screen.findByTestId("landing-blocks")).not.toHaveAttribute("data-price");
    loading.unmount();

    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({ error: "unavailable" }) })));
    const failed = render(<CreatorCourseDetail courseIdOverride="course-1" hideHeader />);
    await screen.findByText("Offers are temporarily unavailable.");
    expect(screen.getByTestId("landing-blocks")).not.toHaveAttribute("data-price");
    failed.unmount();

    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ offers: [] }) })));
    render(<CreatorCourseDetail courseIdOverride="course-1" hideHeader />);
    await screen.findAllByText("$149.00");
    expect(screen.getByTestId("landing-blocks")).toHaveAttribute("data-price", "$149.00");
  });

  // Com a compra desligada o botão não diz "Enroll" para virar o aviso depois.
  it("com a compra desligada, o aviso vem direto, sem o rótulo de espera", async () => {
    fixtures.flagsOn = false;
    fixtures.auth.status = "authenticated";
    fixtures.auth.user = { uid: "buyer" };
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    const { container } = render(<CreatorCourseDetail courseIdOverride="course-1" hideHeader />);

    const button = await waitFor(() => {
      const found = container.querySelector<HTMLButtonElement>("#enroll-card button[data-cta-focus]");
      expect(found).not.toBeNull();
      return found!;
    });
    expect(button).toHaveTextContent("Checkout not available yet");
    expect(button).not.toHaveAttribute("aria-busy");
  });

  it("o cancelamento da compra é aviso neutro, e o erro de checkout é anunciado", async () => {
    fixtures.query = "checkout=cancelled";
    fixtures.auth.status = "authenticated";
    fixtures.auth.user = { uid: "buyer" };
    vi.mocked(startCourseCheckout).mockRejectedValue(new Error("network"));
    render(<CreatorCourseDetail courseIdOverride="course-1" hideHeader />);

    expect(await screen.findByRole("status")).toHaveTextContent("Checkout was cancelled.");
    fireEvent.click(await screen.findByRole("button", { name: /Enroll — \$149\.00/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("We could not start secure checkout");
  });
});

// Loja vazia não é destino: a volta e a ação padrão dos estados levam ao início.
describe("CreatorCourseDetail: links para a loja", () => {
  it.each([
    [true, "Back to all courses", "/courses"],
    [false, "Go home", "/"],
  ])("a volta ao catálogo, no alto da página e fora do cartão de compra (loja com curso real: %s)", async (value, name, href) => {
    const { container } = render(<RealCoursesProvider value={value}><CreatorCourseDetail courseIdOverride="course-1" hideHeader /></RealCoursesProvider>);

    const back = await screen.findByRole("link", { name });
    expect(back).toHaveAttribute("href", href);
    expect(back.closest("#enroll-card")).toBeNull();
    // Antes da capa, do título e das seções: é o primeiro item da coluna.
    expect(back.parentElement?.firstElementChild).toBe(back);
    expect(back.compareDocumentPosition(container.querySelector("#enroll-card")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it.each([
    [true, "Open marketplace", "/courses"],
    [false, "Go home", "/"],
  ])("a ação padrão de um estado sem curso (loja com curso real: %s)", (value, name, href) => {
    render(<RealCoursesProvider value={value}><CreatorCourseDetail /></RealCoursesProvider>);

    expect(screen.getByRole("heading", { name: "Course not selected." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name })).toHaveAttribute("href", href);
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

  // Antes: rótulo "Access" no preço e cinco blocos depois do botão, dois em
  // caixas de cores diferentes. Agora: "Price", o botão e um só bloco de fatos.
  it("rotula o preço como 'Price' e junta os fatos num bloco só, depois do botão", async () => {
    fixtures.auth.status = "authenticated"; fixtures.auth.user = { uid: "buyer" };
    const { container } = render(<CreatorCourseDetail courseIdOverride="course-1" hideHeader />);
    const button = await screen.findByRole("button", { name: "Enroll — $149.00" });
    const card = container.querySelector("#enroll-card") as HTMLElement;

    expect(card.firstElementChild).toHaveTextContent(/^Price$/);
    const facts = [
      "Category",
      "Paid access opens automatically once your payment is confirmed — usually within seconds.",
      "Secure payment processed by Stripe.",
      "7-day refund guarantee.",
      "Sold by your instructor, not by SkillsetMind.",
    ].map((text) => within(card).getByText(text));
    for (const fact of facts) {
      expect(button.compareDocumentPosition(fact) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    // Nenhuma caixa colorida própria: o reembolso e o vendedor são linhas da mesma lista.
    const list = within(card).getByRole("list");
    expect(within(list).getByText("7-day refund guarantee.")).toBeInTheDocument();
    expect(within(list).getByText("Sold by your instructor, not by SkillsetMind.")).toBeInTheDocument();
    expect(card.querySelector('[class*="success-soft"]')).toBeNull();
    // A barra fixa do celular usa o mesmo rótulo do cartão.
    expect(container.querySelector('a[href="#enroll-card"]')?.closest("div.fixed")).toHaveTextContent(/^Price/);
  });

  // Até o preço chegar o curso ainda não "é grátis": um curso grátis lia
  // "Paid access opens…", o reembolso e o vendedor enquanto o preço carregava.
  it.each([
    ["carregando", () => new Promise(() => {})],
    ["com a leitura falhando", async () => ({ ok: false, json: async () => ({ error: "unavailable" }) })],
  ])("curso grátis com o preço %s: nenhuma frase de compra paga no cartão", async (_state, respond) => {
    Object.assign(fixtures.course, { paymentType: "free", priceAmountMinor: 0 });
    vi.stubGlobal("fetch", vi.fn(respond));
    const { container } = render(<CreatorCourseDetail courseIdOverride="course-1" hideHeader />);
    await waitFor(() => expect(container.querySelector("#enroll-card")).not.toBeNull());
    const card = container.querySelector("#enroll-card") as HTMLElement;

    for (const text of [
      "Paid access opens automatically once your payment is confirmed — usually within seconds.",
      "7-day refund guarantee.",
      "Sold by your instructor, not by SkillsetMind.",
    ]) {
      expect(within(card).queryByText(text)).not.toBeInTheDocument();
    }
    // A ficha do curso segue no lugar.
    expect(within(card).getByText("Category")).toBeInTheDocument();
  });

  it("mantém o cartão à vista: gruda na rolagem e ganha barra fixa no celular", async () => {
    const { container } = render(
      <CreatorCourseDetail courseIdOverride="course-1" hideHeader />,
    );
    await screen.findAllByText("$149.00");

    expect(container.querySelector("#enroll-card")).toHaveClass("lg:sticky");
    // Barra de compra: leva ao cartão. Sem IntersectionObserver (jsdom), ou
    // antes do primeiro aviso dele, nada foi medido: a barra fica à vista no
    // celular, como sempre foi. Só a medição a esconde.
    const bar = container.querySelector('a[href="#enroll-card"]');
    expect(bar).not.toBeNull();
    expect(bar?.closest("div.fixed")).toHaveClass("lg:hidden");
    expect(bar?.closest("div.fixed")).not.toHaveClass("hidden");
  });

  it("com o cartão fora da tela a barra de compra aparece (no desktop, no canto); com o botão à vista, some", async () => {
    let notify: ((entries: Array<{ isIntersecting: boolean }>) => void) | null = null;
    const observe = vi.fn();
    vi.stubGlobal("IntersectionObserver", class {
      constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) { notify = callback; }
      observe = observe;
      disconnect() {}
    });
    try {
      const { container } = render(<CreatorCourseDetail courseIdOverride="course-1" hideHeader />);
      await screen.findAllByText("$149.00");
      await waitFor(() => expect(observe).toHaveBeenCalledWith(container.querySelector("#enroll-card")));
      const bar = () => container.querySelector('a[href="#enroll-card"]')?.closest("div.fixed");
      // Antes do primeiro aviso: à vista no celular.
      expect(bar()).toHaveClass("lg:hidden");
      expect(bar()).not.toHaveClass("hidden");

      act(() => notify?.([{ isIntersecting: false }]));
      expect(bar()).not.toHaveClass("hidden");
      expect(bar()).toHaveClass("lg:right-6");

      // Topo do cartão à vista, mas o botão ainda abaixo da dobra: a barra fica.
      const cta = container.querySelector("#enroll-card [data-cta-focus]") as HTMLElement;
      const rect = vi.spyOn(cta, "getBoundingClientRect");
      rect.mockReturnValue({ top: window.innerHeight + 200, bottom: window.innerHeight + 244 } as DOMRect);
      act(() => notify?.([{ isIntersecting: true }]));
      expect(bar()).not.toHaveClass("hidden");

      // O botão entrou na tela: a barra some em qualquer largura (display
      // none: fora da ordem do Tab), e não só a partir de lg.
      rect.mockReturnValue({ top: 300, bottom: 344 } as DOMRect);
      act(() => notify?.([{ isIntersecting: true }]));
      expect(bar()).toHaveClass("hidden");
      expect(bar()).not.toHaveClass("lg:right-6");

      // Saiu de novo: a barra volta.
      act(() => notify?.([{ isIntersecting: false }]));
      expect(bar()).not.toHaveClass("hidden");
    } finally {
      vi.unstubAllGlobals();
    }
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

  it("sem minutos em todas as aulas, não mostra uma duração menor que o curso", async () => {
    const course = fixtures.course as TeacherCourse;
    const modules = course.modules;
    course.modules = [{ ...modules[0], lessons: [...modules[0].lessons, { id: "lesson-2", title: "Second", type: "video", description: "" }] }];
    try {
      render(<CreatorCourseDetail courseIdOverride="course-1" hideHeader />);
      await screen.findAllByText("$149.00");
      expect(screen.queryByText("1h 30m")).not.toBeInTheDocument();
      expect(screen.queryByText("Duration")).not.toBeInTheDocument();
    } finally {
      course.modules = modules;
    }
  });

  // A 320 px a assinatura quebra linha: o selo vai junto com o nome, sem
  // margem negativa puxando o ícone para cima de outro item.
  it("selo verificado: só o ícone, preso ao nome do instrutor", async () => {
    Object.assign(fixtures.profile, { verification: { kind: "evidence", verifiedAt: null } });
    try {
      render(<CreatorCourseDetail courseIdOverride="course-1" hideHeader />);
      await screen.findAllByText("$149.00");

      const name = screen.getByRole("link", { name: /Ana Prado/ });
      const badge = screen.getByRole("button", { name: "Verified professional" });
      expect(name.parentElement).toContainElement(badge);
      expect(name.parentElement).toHaveClass("inline-flex");
      expect(badge.closest("[class*='-ml-']")).toBeNull();
    } finally {
      delete (fixtures.profile as { verification?: unknown }).verification;
    }
  });

  // Sem selo, a credencial é o que o professor digitou: a assinatura diz isso
  // ao lado dela; com o selo, não. (O cartão do instrutor tem teste próprio
  // em self-reported-credentials.test.tsx.)
  it("credencial sem selo vem marcada na assinatura", async () => {
    render(<CreatorCourseDetail courseIdOverride="course-1" hideHeader />);
    await screen.findAllByText("$149.00");

    const byline = screen.getByRole("link", { name: /Ana Prado/ }).closest("div")!;
    expect(byline).toHaveTextContent("PhD in cognitive science");
    expect(byline).toHaveTextContent("Self-reported");
  });

  it("credencial com selo não leva a marca", async () => {
    Object.assign(fixtures.profile, { verification: { kind: "evidence", verifiedAt: null } });
    try {
      render(<CreatorCourseDetail courseIdOverride="course-1" hideHeader />);
      await screen.findAllByText("$149.00");
      expect(screen.queryByText("Self-reported")).not.toBeInTheDocument();
    } finally {
      delete (fixtures.profile as { verification?: unknown }).verification;
    }
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

  it("chama o visitante de volta para o checkout do curso depois de criar conta", async () => {
    render(<CreatorCourseDetail courseIdOverride="course-1" hideHeader />);

    const enroll = await screen.findByRole("link", {
      name: /Enroll \u2014 \$149\.00/,
    });
    expect(enroll).toHaveAttribute(
      "href",
      "/auth?mode=signup&returnTo=%2Fcourses%2Fcourse-1%2Fcheckout",
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

// The sales blocks' button called checkout alone: for a visitor, a free course
// or an enrolled learner it did nothing at all.
describe("CreatorCourseDetail: the sales-page button does what the buy card does", () => {
  const salesCta = () => screen.getByRole("button", { name: "Sales block CTA" });

  it("a visitor goes to sign up and comes back to this course's checkout, like the card's link", async () => {
    render(<CreatorCourseDetail courseIdOverride="course-1" />);
    const cardLink = await screen.findByRole("link", { name: "Enroll — $149.00" });

    fireEvent.click(salesCta());

    expect(fixtures.router.push).toHaveBeenCalledWith("/auth?mode=signup&returnTo=%2Fcourses%2Fcourse-1%2Fcheckout");
    expect(fixtures.router.push).toHaveBeenCalledWith(cardLink.getAttribute("href"));
    expect(startCourseCheckout).not.toHaveBeenCalled();
  });

  it("a free course enrolls and opens the classroom", async () => {
    fixtures.auth.status = "authenticated"; fixtures.auth.user = { uid: "buyer" };
    Object.assign(fixtures.course, { paymentType: "free", priceAmountMinor: 0 });
    withOffers([]);
    render(<CreatorCourseDetail courseIdOverride="course-1" />);
    await screen.findByRole("button", { name: "Enroll free" });

    fireEvent.click(salesCta());

    await waitFor(() => expect(fixtures.router.push).toHaveBeenCalledWith("/learn/courses/course-1"));
    expect(enrollInFreeCreatorCourse).toHaveBeenCalledWith("course-1");
    expect(startCourseCheckout).not.toHaveBeenCalled();
  });

  it("an enrolled learner goes to the classroom", async () => {
    fixtures.auth.status = "authenticated"; fixtures.auth.user = { uid: "student-1" };
    enrollmentState.current = { status: "active" };
    try {
      render(<CreatorCourseDetail courseIdOverride="course-1" />);
      await screen.findAllByRole("link", { name: "Continue learning" });

      fireEvent.click(salesCta());

      expect(fixtures.router.push).toHaveBeenCalledWith("/learn/courses/course-1");
      expect(startCourseCheckout).not.toHaveBeenCalled();
    } finally {
      enrollmentState.current = null;
    }
  });

  it("a signed-in buyer of a paid course still opens checkout", async () => {
    fixtures.auth.status = "authenticated"; fixtures.auth.user = { uid: "buyer" };
    render(<CreatorCourseDetail courseIdOverride="course-1" />);
    await screen.findAllByText("$149.00");

    fireEvent.click(salesCta());

    await waitFor(() => expect(startCourseCheckout).toHaveBeenCalledWith("course-1", {}));
    expect(fixtures.router.push).not.toHaveBeenCalled();
  });

  describe("sem resposta visível", () => {
    const scrollIntoView = vi.fn();
    beforeEach(() => {
      scrollIntoView.mockClear();
      Element.prototype.scrollIntoView = scrollIntoView;
    });
    afterEach(() => {
      // @ts-expect-error jsdom não define scrollIntoView; remove o stub do teste
      delete Element.prototype.scrollIntoView;
    });

    it("when checkout cannot proceed, the click brings the buy card into view", async () => {
      fixtures.auth.status = "authenticated"; fixtures.auth.user = { uid: "buyer" };
      fixtures.query = "offer=MISSING";
      withOffers();
      render(<CreatorCourseDetail courseIdOverride="course-1" />);
      await screen.findByText("The selected offer is no longer available.");

      fireEvent.click(salesCta());

      expect(startCourseCheckout).not.toHaveBeenCalled();
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(scrollIntoView.mock.contexts[0]).toBe(document.getElementById("enroll-card"));
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
    });

    it("after a checkout error, the click brings the buy card (with the error) into view", async () => {
      fixtures.auth.status = "authenticated"; fixtures.auth.user = { uid: "buyer" };
      vi.mocked(startCourseCheckout).mockRejectedValueOnce(new Error("boom"));
      render(<CreatorCourseDetail courseIdOverride="course-1" />);
      await screen.findAllByText("$149.00");

      fireEvent.click(salesCta());

      await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
    });
  });

  it("a second click while checkout is running does not open a second session", async () => {
    fixtures.auth.status = "authenticated"; fixtures.auth.user = { uid: "buyer" };
    vi.mocked(startCourseCheckout).mockReturnValueOnce(new Promise(() => {}));
    render(<CreatorCourseDetail courseIdOverride="course-1" />);
    await screen.findAllByText("$149.00");

    fireEvent.click(salesCta());
    fireEvent.click(salesCta());

    await waitFor(() => expect(startCourseCheckout).toHaveBeenCalledTimes(1));
  });

  it("a second click while the free enrollment runs does not enroll twice", async () => {
    fixtures.auth.status = "authenticated"; fixtures.auth.user = { uid: "buyer" };
    Object.assign(fixtures.course, { paymentType: "free", priceAmountMinor: 0 });
    withOffers([]);
    vi.mocked(enrollInFreeCreatorCourse).mockReturnValueOnce(new Promise(() => {}));
    render(<CreatorCourseDetail courseIdOverride="course-1" />);
    await screen.findByRole("button", { name: "Enroll free" });

    fireEvent.click(salesCta());
    fireEvent.click(salesCta());

    await waitFor(() => expect(enrollInFreeCreatorCourse).toHaveBeenCalledTimes(1));
  });
});

// "Preview media can be attached by the educator..." is a note to the teacher.
describe("CreatorCourseDetail: the empty-preview note", () => {
  it.each([
    ["a visitor", null, false],
    ["a signed-in buyer", { uid: "buyer" }, false],
    ["the course owner", { uid: "teacher-1" }, true],
  ])("%s: shown only to the owner", async (_who, user, shown) => {
    vi.mocked(getLessonContentDoc).mockResolvedValue(null);
    if (user) { fixtures.auth.status = "authenticated"; fixtures.auth.user = user; }
    const course = fixtures.course as TeacherCourse;
    course.freePreviewLessonId = "lesson-1";
    try {
      render(<CreatorCourseDetail courseIdOverride="course-1" />);
      await screen.findAllByText("$149.00");
      expect(screen.getByRole("heading", { name: "Why focus breaks" })).toBeInTheDocument();
      expect(Boolean(screen.queryByText(/Preview media can be attached/))).toBe(shown);
    } finally {
      delete course.freePreviewLessonId;
    }
  });
});

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

  // Criar conta volta sempre ao checkout; entrar volta à página onde a pessoa
  // estava. Os dois com a oferta e o preço, nunca o `returnTo` do endereço.
  it.each([false, true])("keeps offer and price through signup (to the checkout) and signin (to this page) (checkout %s)", async (checkoutOnly) => {
    fixtures.query = "offer=LAUNCH&priceId=price-1&checkout=cancelled&returnTo=https://evil.example";
    withOffers();
    render(<CreatorCourseDetail courseIdOverride="focus-slug" checkoutOnly={checkoutOnly} />);
    const enroll = await screen.findByRole("link", { name: /Enroll — \$49.00/ });
    expect(new URL(enroll.getAttribute("href")!, "https://test.local").searchParams.get("returnTo"))
      .toBe("/courses/focus-slug/checkout?offer=LAUNCH&priceId=price-1");
    const signin = screen.getByRole("link", { name: /Sign in/ });
    expect(new URL(signin.getAttribute("href")!, "https://test.local").searchParams.get("returnTo"))
      .toBe(`/courses/focus-slug${checkoutOnly ? "/checkout" : ""}?offer=LAUNCH&priceId=price-1`);
  });

  it("keeps the decision by the price: no detail list, no way back to the catalog, trust marks by the button", async () => {
    const { container } = render(<CreatorCourseDetail courseIdOverride="course-1" checkoutOnly hideHeader />);
    await screen.findByText("$149.00");
    expect(screen.queryByText("Category")).not.toBeInTheDocument();
    expect(container.querySelector('#enroll-card a[href="/"], #enroll-card a[href="/courses"]')).toBeNull();
    expect(screen.getByText("Secure payment processed by Stripe.")).toBeInTheDocument();
    expect(screen.getByText("7-day refund guarantee.")).toBeInTheDocument();
  });

  it("without the server's order summary, the card itself leads back to the course", async () => {
    render(<CreatorCourseDetail courseIdOverride="course-1" checkoutOnly />);
    await screen.findByText("$149.00");
    expect(screen.getByRole("link", { name: "See full course details" })).toHaveAttribute("href", "/courses/course-1");
  });

  it("no secure-payment mark while there is no paid price to process", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({ error: "unavailable" }) })));
    render(<CreatorCourseDetail courseIdOverride="course-1" checkoutOnly hideHeader />);
    // Um aviso só (o vermelho): o lugar do preço não repete "Pricing unavailable".
    expect(await screen.findByRole("alert")).toHaveTextContent("Offers are temporarily unavailable.");
    expect(screen.queryByText("Pricing unavailable")).not.toBeInTheDocument();
    expect(screen.queryByText("Secure payment processed by Stripe.")).not.toBeInTheDocument();
  });

  it("the sales page keeps its detail list and its way back", async () => {
    const { container } = render(<CreatorCourseDetail courseIdOverride="course-1" hideHeader />);
    await screen.findAllByText("$149.00");
    expect(screen.getByText("Category")).toBeInTheDocument();
    // Sem curso real na loja, a volta leva ao início. Ela fica no alto da
    // coluna da esquerda, fora do cartão de compra.
    expect(screen.getByRole("link", { name: "Go home" })).toHaveAttribute("href", "/");
    expect(container.querySelector('#enroll-card a[href="/"]')).toBeNull();
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

  // An enrolled learner saw every lesson padlocked and a popup telling them to
  // buy; checkout then failed with alreadyEnrolled.
  it("an enrolled learner sees no padlocks, like the owner", async () => {
    fixtures.auth.status = "authenticated";
    fixtures.auth.user = { uid: "student-1" };
    enrollmentState.current = { status: "active" };
    try {
      render(<CreatorCourseDetail courseIdOverride="course-1" />);
      await screen.findAllByText("$149.00");

      expect(subscribeToEnrollment).toHaveBeenCalledWith(
        "student-1", "course-1", expect.any(Function), expect.any(Function),
      );
      expect(screen.queryByRole("button", { name: /Why focus breaks/ })).not.toBeInTheDocument();
      expect(screen.getByText("Why focus breaks")).toBeInTheDocument();
    } finally {
      enrollmentState.current = null;
    }
  });

  // With the card's button disabled, the popup said "Enroll" while the card
  // said "Checkout not available yet".
  it("a signed-in viewer whose card says checkout is unavailable gets the same words in the popup", async () => {
    fixtures.auth.status = "authenticated";
    fixtures.auth.user = { uid: "buyer" };
    fixtures.query = "offer=MISSING";
    withOffers();
    const { container } = render(<CreatorCourseDetail courseIdOverride="course-1" />);
    await waitFor(() => expect(cardAction(container)).toHaveTextContent("Checkout not available yet"));

    fireEvent.click(screen.getByRole("button", { name: /Why focus breaks/ }));

    const popupCta = within(screen.getByRole("dialog")).getAllByRole("link")[0];
    expect(popupCta.textContent?.trim()).toBe("Checkout not available yet");
  });

  // The enrollment read arrives late: a learner who clicked a padlock in that
  // gap kept a buy popup open after their access loaded.
  it("the buy popup closes itself when the learner's enrollment arrives late", async () => {
    fixtures.auth.status = "authenticated";
    fixtures.auth.user = { uid: "student-1" };
    enrollmentState.deliverLater = true;
    try {
      render(<CreatorCourseDetail courseIdOverride="course-1" />);
      await screen.findAllByText("$149.00");
      fireEvent.click(screen.getByRole("button", { name: /Why focus breaks/ }));
      expect(screen.getByRole("dialog")).toBeInTheDocument();

      act(() => enrollmentState.onNext?.({ status: "active" }));

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    } finally {
      enrollmentState.deliverLater = false;
      enrollmentState.onNext = null;
    }
  });

  // An enrolled learner was offered "Enroll — $X" on the card and the mobile
  // bar; checkout then refused with alreadyEnrolled.
  it("an enrolled learner gets a link to the classroom on the card and the mobile bar", async () => {
    fixtures.auth.status = "authenticated";
    fixtures.auth.user = { uid: "student-1" };
    enrollmentState.current = { status: "active" };
    try {
      const { container } = render(<CreatorCourseDetail courseIdOverride="course-1" />);
      await screen.findAllByText("$149.00");

      const cta = cardAction(container);
      expect(cta?.tagName).toBe("A");
      expect(cta).toHaveAttribute("href", "/learn/courses/course-1");
      expect(cta).toHaveTextContent("Continue learning");
      const links = screen.getAllByRole("link", { name: "Continue learning" });
      expect(links).toHaveLength(2);
      for (const link of links) expect(link).toHaveAttribute("href", "/learn/courses/course-1");
      expect(container.querySelector('a[href="#enroll-card"]')).toBeNull();
      expect(screen.queryByText(/Enroll —/)).not.toBeInTheDocument();
    } finally {
      enrollmentState.current = null;
    }
  });
});

// Comunidade, evento ao vivo e e-book publicam sem grade de aulas. A pagina de
// venda mostrava "previa ainda sendo preparada", "Enroll to open the remaining
// 0 lessons" e "Lessons: 0". Agora diz o que o comprador recebe.
describe("CreatorCourseDetail: o que cada tipo entrega", () => {
  function renderAs(productFormat: TeacherCourse["productFormat"], modules: TeacherCourse["modules"] = []) {
    const course = fixtures.course as TeacherCourse;
    const saved = { modules: course.modules, lessonCount: course.lessonCount };
    course.productFormat = productFormat;
    course.modules = modules;
    course.lessonCount = modules.reduce((total, item) => total + item.lessons.length, 0);
    const view = render(<CreatorCourseDetail courseIdOverride="course-1" />);
    return {
      ...view,
      restore: () => {
        delete course.productFormat;
        course.modules = saved.modules;
        course.lessonCount = saved.lessonCount;
      },
    };
  }

  function expectNoCurriculum(container: HTMLElement) {
    expect(container.querySelector("#free-preview")).toBeNull();
    expect(container.querySelector("#curriculum")).toBeNull();
    expect(screen.queryByText(/remaining \d+ lessons?/)).not.toBeInTheDocument();
    expect(screen.queryByText(/curriculum preview is still being prepared/)).not.toBeInTheDocument();
    expect(screen.queryByText("Lessons")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Curriculum" })).not.toBeInTheDocument();
  }

  it("comunidade: a pagina fala da comunidade, sem curriculo nem 'Lessons: 0'", async () => {
    const { container, restore } = renderAs("community");
    try {
      await screen.findAllByText("$149.00");
      expectNoCurriculum(container);
      expect(
        within(container.querySelector("#delivery") as HTMLElement).getByText(
          "Members join the community: posts, answers and live calls.",
        ),
      ).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "What you get" })).toHaveAttribute("href", "#delivery");
    } finally {
      restore();
    }
  });

  it("comunidade em espanhol", async () => {
    fixtures.locale = "es";
    const { restore } = renderAs("community");
    try {
      expect(
        await screen.findByText(
          "Los miembros entran a la comunidad: publicaciones, respuestas y encuentros en vivo.",
        ),
      ).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  it("e-book: um arquivo para baixar, mesmo com a aula do arquivo no produto", async () => {
    const { container, restore } = renderAs("ebook", [
      {
        id: "module-1",
        title: "Your file",
        lessons: [{ id: "lesson-1", title: "Workbook", type: "download", description: "" }],
      },
    ]);
    try {
      await screen.findAllByText("$149.00");
      expectNoCurriculum(container);
      expect(screen.getByText("Digital download: a file you get right after purchase.")).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  it("evento ao vivo: a data da sessao no fuso de quem ensina, com o fuso escrito", async () => {
    vi.mocked(getLiveEventSession).mockResolvedValueOnce({
      startsAt: "2026-11-20T22:30:00.000Z",
      timeZone: "America/Sao_Paulo",
    });
    const { container, restore } = renderAs("live_event");
    try {
      expect(
        await screen.findByText(/^Live session on November 20, 2026.*7:30\sPM GMT-3$/),
      ).toBeInTheDocument();
      expect(getLiveEventSession).toHaveBeenCalledWith("course-1");
      expectNoCurriculum(container);
    } finally {
      restore();
    }
  });

  it("evento ao vivo sem data conhecida diz que ela sera anunciada", async () => {
    const { restore } = renderAs("live_event");
    try {
      expect(
        await screen.findByText("Live session. The date will be announced here."),
      ).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  it("curso segue com previa, curriculo e o numero de aulas", async () => {
    const { container, restore } = renderAs("course", (fixtures.course as TeacherCourse).modules);
    try {
      await screen.findAllByText("$149.00");
      expect(container.querySelector("#free-preview")).not.toBeNull();
      expect(container.querySelector("#curriculum")).not.toBeNull();
      expect(screen.getByText("Lessons")).toBeInTheDocument();
      expect(container.querySelector("#delivery")).toBeNull();
      expect(getLiveEventSession).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });
});

// Guest checkout (off by default): a signed-out visitor buys a paid course with
// name, e-mail and the terms box; everyone else sees exactly today's card.
describe("CreatorCourseDetail: buying without an account", () => {
  const checkoutReturn = encodeURIComponent("/courses/course-1/checkout");
  const nameField = () => screen.getByRole("textbox", { name: "Full name" });
  const emailField = () => screen.getByRole("textbox", { name: "Email" });

  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_GUEST_CHECKOUT_ENABLED", "true");
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "site-key");
  });
  afterEach(() => vi.unstubAllEnvs());

  async function fillAndSubmit(options: { accept?: boolean } = {}) {
    const submit = await screen.findByRole("button", { name: /Enroll — \$/ });
    fireEvent.change(nameField(), { target: { value: " Ana Prado " } });
    fireEvent.change(emailField(), { target: { value: "ana@example.com" } });
    if (options.accept !== false) fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.submit(submit.closest("form") as HTMLFormElement);
  }

  it("a signed-out visitor gets the short form, Google and a visible sign-in link", async () => {
    render(<CreatorCourseDetail courseIdOverride="course-1" checkoutOnly />);

    expect(await screen.findByRole("button", { name: "Enroll — $149.00" })).toHaveAttribute("type", "submit");
    expect(nameField()).toBeRequired();
    expect(emailField()).toHaveAttribute("type", "email");
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByRole("link", { name: "Terms of service" })).toHaveAttribute("href", "/legal/terms");
    expect(screen.getByRole("link", { name: "Privacy policy" })).toHaveAttribute("href", "/legal/privacy");
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", `/login?returnTo=${checkoutReturn}`);
    // Not today's "create an account to buy" link.
    expect(screen.queryByRole("link", { name: "Enroll — $149.00" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(signInWithGoogle).toHaveBeenCalledWith(getLoadingRoute("welcome", null, "/courses/course-1/checkout"));
  });

  it("sends name, e-mail, the check token and the chosen offer, and nothing without the terms", async () => {
    fixtures.query = "offer=LAUNCH";
    withOffers();
    vi.mocked(startGuestCourseCheckout).mockResolvedValue("redirected");
    render(<CreatorCourseDetail courseIdOverride="focus-slug" checkoutOnly />);

    await fillAndSubmit({ accept: false });
    expect(await screen.findByRole("alert")).toHaveTextContent("Accept the Terms of Service and Privacy Policy to continue.");
    expect(startGuestCourseCheckout).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.submit(nameField().closest("form") as HTMLFormElement);

    await waitFor(() => expect(startGuestCourseCheckout).toHaveBeenCalledWith({
      courseId: "course-1",
      name: "Ana Prado",
      email: "ana@example.com",
      captchaToken: "turnstile-token",
      offerId: "offer-1",
      offerCode: "LAUNCH",
      priceId: "price-1",
    }));
    expect(startCourseCheckout).not.toHaveBeenCalled();
    expect(fixtures.router.push).not.toHaveBeenCalled();
  });

  it("says the access link went to the e-mail when there is nothing to pay", async () => {
    vi.mocked(startGuestCourseCheckout).mockResolvedValue("access_link_sent");
    render(<CreatorCourseDetail courseIdOverride="course-1" checkoutOnly />);

    await fillAndSubmit();

    expect(await screen.findByText("If this email can access the course, we've sent a sign-in link to it.")).toBeInTheDocument();
  });

  it("shows the security-check failure in its own words", async () => {
    vi.mocked(startGuestCourseCheckout).mockRejectedValue(new PaymentRequestError("x", 400, "captcha_failed"));
    render(<CreatorCourseDetail courseIdOverride="course-1" checkoutOnly />);

    await fillAndSubmit();

    expect(await screen.findByRole("alert")).toHaveTextContent("The security check failed. Please try again.");
  });

  it("asks to try again when the access e-mail could not be sent", async () => {
    vi.mocked(startGuestCourseCheckout).mockRejectedValue(new PaymentRequestError("x", 502, "send_failed"));
    render(<CreatorCourseDetail courseIdOverride="course-1" checkoutOnly />);

    await fillAndSubmit();

    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't send the email right now. Please try again in a moment.");
  });

  it("says a payment is already in progress, without promising an e-mail", async () => {
    vi.mocked(startGuestCourseCheckout).mockRejectedValue(new PaymentRequestError("x", 409, "checkout_pending"));
    render(<CreatorCourseDetail courseIdOverride="course-1" checkoutOnly />);

    await fillAndSubmit();

    expect(await screen.findByRole("alert"))
      .toHaveTextContent("You have a payment in progress for this course. Finish it or try again in a few minutes.");
  });

  it("a signed-in buyer keeps today's button and route", async () => {
    fixtures.auth.status = "authenticated"; fixtures.auth.user = { uid: "buyer" };
    render(<CreatorCourseDetail courseIdOverride="course-1" checkoutOnly />);

    const button = await screen.findByRole("button", { name: "Enroll — $149.00" });
    expect(button).toHaveAttribute("type", "button");
    expect(screen.queryByRole("textbox", { name: "Email" })).not.toBeInTheDocument();
    fireEvent.click(button);
    expect(startCourseCheckout).toHaveBeenCalledWith("course-1", {});
    expect(startGuestCourseCheckout).not.toHaveBeenCalled();
  });

  it.each([
    ["the flag is off", "NEXT_PUBLIC_GUEST_CHECKOUT_ENABLED", "false"],
    ["Turnstile has no site key", "NEXT_PUBLIC_TURNSTILE_SITE_KEY", ""],
  ])("with %s, a visitor keeps today's 'create an account to buy'", async (_label, name, value) => {
    vi.stubEnv(name, value);
    render(<CreatorCourseDetail courseIdOverride="course-1" checkoutOnly />);

    expect(await screen.findByRole("link", { name: "Enroll — $149.00" }))
      .toHaveAttribute("href", `/auth?mode=signup&returnTo=${checkoutReturn}`);
    expect(screen.queryByRole("textbox", { name: "Email" })).not.toBeInTheDocument();
  });

  it("on a creator's own domain, a visitor keeps today's 'create an account to buy'", async () => {
    const hostRule = vi.mocked(isPlatformHost);
    const real = hostRule.getMockImplementation();
    hostRule.mockReturnValue(false);
    try {
      render(<CreatorCourseDetail courseIdOverride="course-1" checkoutOnly />);

      expect(await screen.findByRole("link", { name: "Enroll — $149.00" }))
        .toHaveAttribute("href", `/auth?mode=signup&returnTo=${checkoutReturn}`);
      expect(screen.queryByRole("textbox", { name: "Email" })).not.toBeInTheDocument();
    } finally {
      if (real) hostRule.mockImplementation(real);
    }
  });

  it("caps the sticky buy card to the screen and scrolls inside it while the form shows", async () => {
    const { container } = render(<CreatorCourseDetail courseIdOverride="course-1" />);
    await screen.findByRole("button", { name: "Enroll — $149.00" });

    const card = container.querySelector("#enroll-card") as HTMLElement;
    expect(card).toHaveClass("lg:sticky", "lg:top-24", "lg:max-h-[calc(100svh-7rem)]", "lg:overflow-y-auto");
    // The corner buy bar still watches the card's main field.
    expect(card.querySelector("[data-cta-focus]")).toBe(screen.getByRole("textbox", { name: "Full name" }));
  });

  it("on the checkout page the card is the main column: not stuck to the top, no scrolling box", async () => {
    const { container } = render(<CreatorCourseDetail courseIdOverride="course-1" checkoutOnly hideHeader />);
    await screen.findByRole("button", { name: "Enroll — $149.00" });

    const card = container.querySelector("#enroll-card") as HTMLElement;
    expect(card).not.toHaveClass("lg:sticky");
    expect(card).not.toHaveClass("lg:max-h-[calc(100svh-7rem)]");
    expect(card).not.toHaveClass("lg:overflow-y-auto");
  });

  it("keeps today's card classes for a signed-in buyer", async () => {
    fixtures.auth.status = "authenticated"; fixtures.auth.user = { uid: "buyer" };
    const { container } = render(<CreatorCourseDetail courseIdOverride="course-1" />);
    await screen.findByRole("button", { name: "Enroll — $149.00" });

    const card = container.querySelector("#enroll-card") as HTMLElement;
    expect(card).toHaveClass("lg:sticky", "lg:top-24");
    expect(card).not.toHaveClass("lg:max-h-[calc(100svh-7rem)]");
    expect(card).not.toHaveClass("lg:overflow-y-auto");
  });

  it("shows no form while the session is still loading", async () => {
    fixtures.auth.status = "loading";
    render(<CreatorCourseDetail courseIdOverride="course-1" checkoutOnly />);

    expect(await screen.findByRole("link", { name: "Enroll — $149.00" }))
      .toHaveAttribute("href", `/auth?mode=signup&returnTo=${checkoutReturn}`);
    expect(screen.queryByRole("textbox", { name: "Email" })).not.toBeInTheDocument();
  });

  it("a free course still needs an account", async () => {
    Object.assign(fixtures.course, { paymentType: "free", priceAmountMinor: 0 });
    withOffers([]);
    render(<CreatorCourseDetail courseIdOverride="course-1" checkoutOnly />);

    expect(await screen.findByRole("link", { name: "Enroll free" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Email" })).not.toBeInTheDocument();
  });

  it("the sales-page button brings the form into view instead of the signup page", async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      render(<CreatorCourseDetail courseIdOverride="course-1" />);
      await screen.findByRole("button", { name: "Enroll — $149.00" });

      fireEvent.click(screen.getByRole("button", { name: "Sales block CTA" }));

      expect(fixtures.router.push).not.toHaveBeenCalled();
      expect(scrollIntoView.mock.contexts[0]).toBe(document.getElementById("enroll-card"));
    } finally {
      // @ts-expect-error jsdom não define scrollIntoView; remove o stub do teste
      delete Element.prototype.scrollIntoView;
    }
  });
});

// A capa sozinha acima das colunas empurrava preço e "Enroll" para baixo da
// primeira tela. Agora o cabeçalho do servidor (`lead`) é o topo da coluna da
// esquerda e o cartão de compra é a coluna da direita desde o alto.
describe("CreatorCourseDetail: o cabeçalho do servidor no topo da coluna", () => {
  const lead = (
    <header id="overview">
      <h1>Deep Focus Systems</h1>
      <p>Server summary</p>
    </header>
  );

  it("o cabeçalho abre a coluna da esquerda, e o cartão de compra é a coluna ao lado", async () => {
    const { container } = render(<CreatorCourseDetail courseIdOverride="course-1" hideHeader lead={lead} />);
    await screen.findAllByText("$149.00");

    const title = screen.getByRole("heading", { level: 1, name: "Deep Focus Systems" });
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    const column = title.closest("section") as HTMLElement;
    // Mesma grade: a coluna do cabeçalho e o cartão são irmãos.
    expect(column.nextElementSibling).toBe(container.querySelector("#enroll-card"));
    // Antes da assinatura do instrutor e do menu das seções.
    const nav = screen.getByRole("navigation", { name: "Course sections" });
    expect(title.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("enquanto o curso carrega, o cabeçalho segue à vista (fora do pulso e do aria-hidden)", () => {
    fixtures.holdCourse = true;
    render(<CreatorCourseDetail courseIdOverride="course-1" hideHeader lead={lead} />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading course...");
    const title = screen.getByRole("heading", { level: 1, name: "Deep Focus Systems" });
    expect(title.closest('[aria-hidden="true"]')).toBeNull();
    expect(title.closest(".animate-pulse")).toBeNull();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("quando o curso chega, o cabeçalho é o MESMO nó: não desmonta (a capa não pisca)", async () => {
    fixtures.holdCourse = true;
    render(<CreatorCourseDetail courseIdOverride="course-1" hideHeader lead={lead} />);
    const before = screen.getByRole("heading", { level: 1, name: "Deep Focus Systems" });

    act(() => fixtures.courseNext?.(fixtures.course));
    await screen.findAllByText("$149.00");

    expect(screen.queryByText("Loading course...")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Deep Focus Systems" })).toBe(before);
    expect(before.isConnected).toBe(true);
  });

  it("num estado de erro, o cabeçalho fica no alto e o aviso vira h2", () => {
    render(<CreatorCourseDetail hideHeader lead={lead} />);

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    const state = screen.getByRole("heading", { level: 2, name: "Course not selected." });
    const title = screen.getByRole("heading", { level: 1 });
    expect(title.compareDocumentPosition(state) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("CreatorCourseDetail: preço que falha e quem vende", () => {
  it("com a leitura do preço falhando, o cartão diz uma vez só: o aviso vermelho", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({ error: "unavailable" }) })));
    const { container } = render(<CreatorCourseDetail courseIdOverride="course-1" hideHeader />);
    const card = await waitFor(() => {
      const found = container.querySelector<HTMLElement>("#enroll-card");
      expect(found).not.toBeNull();
      return found!;
    });

    expect(await within(card).findByRole("alert")).toHaveTextContent("Offers are temporarily unavailable.");
    expect(within(card).queryByText("Pricing unavailable")).not.toBeInTheDocument();
  });

  it("na página de venda, quem vende é uma linha com 'Learn more'; a frase inteira segue na página", async () => {
    const { container } = render(<CreatorCourseDetail courseIdOverride="course-1" hideHeader />);
    await screen.findAllByText("$149.00");
    const card = container.querySelector("#enroll-card") as HTMLElement;

    const details = within(card).getByText("Sold by your instructor, not by SkillsetMind.").closest("details") as HTMLElement;
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute("open");
    expect(details.querySelector("summary")).toHaveTextContent("Learn more");
    // Mesma chave, mesmo texto, sem navegar para outra página.
    expect(within(details).getByText(/This course is sold directly by the independent educator/)).toBeInTheDocument();
  });

  it("na página de compra, logo antes de pagar, a frase de quem vende fica inteira e aberta", async () => {
    render(<CreatorCourseDetail courseIdOverride="course-1" checkoutOnly hideHeader />);
    await screen.findByText("$149.00");

    expect(screen.getByText(/This course is sold directly by the independent educator/).closest("details")).toBeNull();
    expect(screen.queryByText("Learn more")).not.toBeInTheDocument();
  });

  it("com o preço a caminho, a barra de compra guarda o lugar com a mesma barra pulsante", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    const { container } = render(<CreatorCourseDetail courseIdOverride="course-1" hideHeader />);
    const bar = await waitFor(() => {
      const found = container.querySelector('a[href="#enroll-card"]')?.closest<HTMLElement>("div.fixed");
      expect(found).toBeTruthy();
      return found!;
    });

    expect(within(bar).getByText("Loading pricing...")).toHaveClass("sr-only");
    expect(bar.querySelector('[aria-hidden="true"].animate-pulse')).not.toBeNull();
  });

  // S-04: com o preço falhando, a barra mostra o traço do cartão (e não
  // "Pricing unavailable" em letra de título) e, no lugar do "Enroll" sem
  // preço, o mesmo "Try again" do aviso do cartão: no celular o cartão fica
  // no fim da página, depois do currículo inteiro.
  it("com a leitura do preço falhando, a barra de compra mostra o traço e o 'Try again' do cartão", async () => {
    let answerRetry: (response: unknown) => void = () => {};
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: "unavailable" }) })
      .mockImplementationOnce(() => new Promise((resolve) => { answerRetry = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    const offerReads = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/offers")).length;
    const { container } = render(<CreatorCourseDetail courseIdOverride="course-1" hideHeader />);
    const card = await waitFor(() => {
      const found = container.querySelector<HTMLElement>("#enroll-card");
      expect(found).not.toBeNull();
      return found!;
    });
    expect(await within(card).findByRole("alert")).toHaveTextContent("Offers are temporarily unavailable.");
    expect(within(card).getByRole("button", { name: "Try again" })).toBeInTheDocument();

    const bar = container.querySelector<HTMLElement>(".course-buy-float")!;
    expect(bar).not.toBeNull();
    expect(within(bar).getByText("—")).toHaveAttribute("aria-hidden", "true");
    expect(within(bar).getByText("Pricing unavailable")).toHaveClass("sr-only");
    expect(bar.querySelector("a")).toBeNull();
    const retry = within(bar).getByRole("button", { name: "Try again" });
    // A mesma altura de 44px do "Enroll": a barra não encolhe neste estado.
    expect(retry).toHaveClass("min-h-11");
    expect(offerReads()).toBe(1);
    // Os dois rótulos já moram no botão (a largura é a do maior); em repouso o
    // da espera fica escondido e fora do nome.
    expect(within(retry).getByText("Trying again...")).toHaveAttribute("aria-hidden", "true");
    expect(within(retry).getByText("Try again")).not.toHaveAttribute("aria-hidden");

    fireEvent.click(retry);
    fireEvent.click(within(bar).getByRole("button", { name: "Trying again..." }));

    // Uma releitura só, e a barra espera com o botão travado: o mesmo botão,
    // agora com o nome da espera, e o rótulo de repouso escondido no lugar.
    expect(offerReads()).toBe(2);
    const waiting = within(bar).getByRole("button", { name: "Trying again..." });
    expect(waiting).toBe(retry);
    expect(waiting).toHaveAttribute("aria-busy", "true");
    expect(within(waiting).getByText("Try again")).toHaveAttribute("aria-hidden", "true");
    expect(within(bar).queryByRole("button", { name: "Try again" })).toBeNull();
    expect(within(bar).getByText("Loading pricing...")).toHaveClass("sr-only");

    await act(async () => answerRetry({ ok: true, json: async () => ({ offers: [] }) }));

    expect(await within(bar).findByText("$149.00")).toBeInTheDocument();
    expect(within(bar).getByRole("link", { name: "Enroll" })).toHaveAttribute("href", "#enroll-card");
    expect(within(bar).queryByRole("button")).toBeNull();
    expect(within(card).queryByRole("alert")).not.toBeInTheDocument();
    expect(offerReads()).toBe(2);
  });
});

// Um curso de 10 módulos era uma coluna enorme, tudo aberto.
describe("CreatorCourseDetail: um módulo por sanfona", () => {
  const mutable = fixtures.course as TeacherCourse;
  const original = mutable.modules;
  afterEach(() => {
    mutable.modules = original;
  });

  it("o primeiro módulo abre sozinho, os outros fecham; aulas e duração na linha do módulo", async () => {
    mutable.modules = [
      original[0],
      {
        id: "module-2",
        title: "Practice",
        lessons: [
          { id: "lesson-2", title: "Morning block", type: "video", description: "", durationMinutes: 20 },
          { id: "lesson-3", title: "Shutdown ritual", type: "text", description: "" },
        ],
      },
    ];
    const { container } = render(<CreatorCourseDetail courseIdOverride="course-1" hideHeader />);
    await screen.findAllByText("$149.00");

    // Cada módulo é um título (navegável por títulos, também no VoiceOver)
    // com o botão de abrir dentro: o padrão de sanfona.
    const curriculum = container.querySelector("#curriculum") as HTMLElement;
    const toggles = Array.from(curriculum.querySelectorAll<HTMLButtonElement>("h2 > button[aria-expanded]"));
    expect(toggles).toHaveLength(2);
    expect(within(curriculum).getByRole("heading", { level: 2, name: /^Foundations 1 lesson · 1h 30m$/ })).toContainElement(toggles[0]);
    expect(toggles[0]).toHaveAttribute("aria-expanded", "true");
    expect(toggles[1]).toHaveAttribute("aria-expanded", "false");
    // Sem minutos em todas as aulas, a duração não aparece (nada se estima).
    expect(within(toggles[1]).getByText("2 lessons")).toBeInTheDocument();
    const panel = (toggle: HTMLButtonElement) => document.getElementById(toggle.getAttribute("aria-controls")!) as HTMLElement;
    expect(panel(toggles[0])).not.toHaveAttribute("hidden");
    expect(panel(toggles[1])).toHaveAttribute("hidden");
    // Nada sai da página: as aulas do módulo fechado seguem no DOM, e a trancada
    // continua abrindo a compra.
    expect(within(panel(toggles[1])).getByText("Shutdown ritual").closest("button")).toHaveAttribute("aria-haspopup", "dialog");

    fireEvent.click(toggles[1]);
    expect(toggles[1]).toHaveAttribute("aria-expanded", "true");
    expect(panel(toggles[1])).not.toHaveAttribute("hidden");
    fireEvent.click(toggles[0]);
    expect(panel(toggles[0])).toHaveAttribute("hidden");
  });
});

// O-09: quem CRIA CONTA para comprar volta ao checkout do curso, com a oferta,
// e nao ao topo da pagina de venda. Quem ENTRA (e a compra sem login) volta a
// esta pagina, como antes. A-11: o cupom e o campo da casa.
describe("CreatorCourseDetail: o visitante que cria conta volta ao checkout", () => {
  const returnOf = (link: HTMLElement) =>
    new URL(link.getAttribute("href")!, "https://test.local").searchParams.get("returnTo");

  it("curso pago, sem oferta: criar conta volta ao checkout; entrar, a esta pagina", async () => {
    render(<CreatorCourseDetail courseIdOverride="course-1" />);
    const enroll = await screen.findByRole("link", { name: "Enroll — $149.00" });

    expect(enroll).toHaveAttribute("href", "/auth?mode=signup&returnTo=%2Fcourses%2Fcourse-1%2Fcheckout");
    expect(screen.getByRole("link", { name: "Sign in" }))
      .toHaveAttribute("href", "/auth?mode=signin&returnTo=%2Fcourses%2Fcourse-1");
  });

  it("curso pago com ?offer=: a oferta vai junto nos dois", async () => {
    fixtures.query = "offer=LAUNCH";
    withOffers();
    render(<CreatorCourseDetail courseIdOverride="focus-slug" />);
    const enroll = await screen.findByRole("link", { name: "Enroll — $49.00" });

    expect(returnOf(enroll)).toBe("/courses/focus-slug/checkout?offer=LAUNCH");
    expect(returnOf(screen.getByRole("link", { name: "Sign in" }))).toBe("/courses/focus-slug?offer=LAUNCH");
  });

  it("curso gratis: criar conta volta ao cartao de entrar gratis do checkout; entrar, a esta pagina", async () => {
    Object.assign(fixtures.course, { paymentType: "free", priceAmountMinor: 0 });
    render(<CreatorCourseDetail courseIdOverride="course-1" />);
    const enroll = await screen.findByRole("link", { name: "Enroll free" });

    expect(returnOf(enroll)).toBe("/courses/course-1/checkout");
    expect(returnOf(screen.getByRole("link", { name: "Sign in" }))).toBe("/courses/course-1");
  });

  // Entrar volta a esta pagina, e quem ja tem o curso ve "Continue learning".
  // O checkout agora tambem le a matricula: quem cai nele (pelo cadastro ou
  // pelo "Sign in" da tela de cadastro) ve o mesmo, e nao o botao de pagar.
  it("quem ja tem o curso e entra pelo cartao volta onde ve 'Continue learning'", async () => {
    const view = render(<CreatorCourseDetail courseIdOverride="course-1" />);
    const signin = await screen.findByRole("link", { name: "Sign in" });
    expect(returnOf(signin)).toBe("/courses/course-1");
    view.unmount();

    fixtures.auth.status = "authenticated"; fixtures.auth.user = { uid: "student-1" };
    enrollmentState.current = { status: "active" };
    try {
      render(<CreatorCourseDetail courseIdOverride="course-1" />);
      expect((await screen.findAllByRole("link", { name: "Continue learning" })).length).toBeGreaterThan(0);
      cleanup();
      vi.mocked(subscribeToEnrollment).mockClear();

      render(<CreatorCourseDetail courseIdOverride="course-1" checkoutOnly />);
      expect(await screen.findByRole("link", { name: "Continue learning" })).toHaveAttribute("href", "/learn/courses/course-1");
      expect(screen.queryByRole("button", { name: /^Enroll/ })).not.toBeInTheDocument();
      expect(subscribeToEnrollment).toHaveBeenCalledTimes(1);
    } finally {
      enrollmentState.current = null;
    }
  });

  it("a compra sem login (desligada hoje) leva o mesmo destino de antes", async () => {
    vi.stubEnv("NEXT_PUBLIC_GUEST_CHECKOUT_ENABLED", "true");
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "site-key");
    try {
      render(<CreatorCourseDetail courseIdOverride="course-1" />);
      await screen.findByRole("button", { name: "Enroll — $149.00" });

      expect(screen.getByRole("link", { name: "Sign in" }))
        .toHaveAttribute("href", `/login?returnTo=${encodeURIComponent("/courses/course-1")}`);
      fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
      expect(signInWithGoogle).toHaveBeenCalledWith(getLoadingRoute("welcome", null, "/courses/course-1"));
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("a barra do celular continua levando ao cartao, cujo link volta ao checkout", async () => {
    const { container } = render(<CreatorCourseDetail courseIdOverride="course-1" />);
    await screen.findByRole("link", { name: "Enroll — $149.00" });

    const bar = container.querySelector("div.fixed") as HTMLElement;
    expect(Array.from(bar.querySelectorAll("a")).map((link) => link.getAttribute("href"))).toEqual(["#enroll-card"]);
    const cardLink = container.querySelector<HTMLElement>("#enroll-card a[data-cta-focus]")!;
    expect(returnOf(cardLink)).toBe("/courses/course-1/checkout");
  });

  // O filtro de sempre (getSafeReturnTo, o mesmo do login, do e-mail de
  // confirmacao e do fim da entrevista) deixa o checkout passar inteiro e
  // continua barrando o que leva para fora.
  it.each([
    ["/courses/focus-slug/checkout", "/courses/focus-slug/checkout"],
    ["/courses/focus-slug/checkout?offer=LAUNCH", "/courses/focus-slug/checkout?offer=LAUNCH"],
    ["/courses/focus-slug/checkout?offer=LAUNCH&priceId=price-1", "/courses/focus-slug/checkout?offer=LAUNCH&priceId=price-1"],
    ["//evil.example", null],
    ["https://evil.example", null],
    ["/\\evil", null],
    ["/%2F%2Fevil.example", null],
    ["/courses/%2F%2Fevil.example/checkout", null],
  ])("o filtro de destino: %s", (returnTo, expected) => {
    expect(getSafeReturnTo(new URLSearchParams({ returnTo }))).toBe(expected);
  });

  it("o destino que o link leva passa no filtro sem mudar", async () => {
    fixtures.query = "offer=LAUNCH&priceId=price-1";
    withOffers();
    render(<CreatorCourseDetail courseIdOverride="focus-slug" />);
    const destination = returnOf(await screen.findByRole("link", { name: "Enroll — $49.00" }))!;

    expect(getSafeReturnTo(new URLSearchParams({ returnTo: destination }))).toBe(destination);
  });

  it("o cupom usa o campo da casa e guarda o mesmo filtro do texto", async () => {
    fixtures.auth.status = "authenticated"; fixtures.auth.user = { uid: "buyer" };
    render(<CreatorCourseDetail courseIdOverride="course-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Have a coupon?" }));

    const field = screen.getByLabelText("Coupon code");
    expect(field).toHaveClass("field-input");
    expect(field).not.toHaveClass("bg-white");
    // Rótulo da casa: o mesmo do Field, 14px e sem caixa alta.
    const label = screen.getByText("Coupon code");
    expect(label.closest("label")).toContainElement(field);
    expect(label).toHaveClass("text-sm", "text-[var(--color-ink)]");
    expect(label).not.toHaveClass("uppercase");
    expect(label).not.toHaveClass("text-xs");
    fireEvent.change(field, { target: { value: "save 25!" } });
    expect(field).toHaveValue("SAVE25");
  });
});

// A página de compra lê a matrícula, como a página de venda: quem já tem o
// curso vê "Continue learning". Até a leitura responder, o botão espera; se
// ela falhar, fica o botão de pagar de antes (o servidor recusa quem já tem).
describe("CreatorCourseDetail: a página de compra reconhece quem já tem o curso", () => {
  const signIn = () => { fixtures.auth.status = "authenticated"; fixtures.auth.user = { uid: "student-1" }; };
  afterEach(() => {
    enrollmentState.current = null;
    enrollmentState.deliverLater = false;
  });

  it("quem já tem: 'Continue learning' para a sala, sem botão de pagar, uma leitura só", async () => {
    signIn();
    enrollmentState.current = { status: "active" };
    render(<CreatorCourseDetail courseIdOverride="course-1" checkoutOnly hideHeader />);

    expect(await screen.findByRole("link", { name: "Continue learning" })).toHaveAttribute("href", "/learn/courses/course-1");
    expect(screen.queryByRole("button", { name: /^Enroll/ })).not.toBeInTheDocument();
    expect(startCourseCheckout).not.toHaveBeenCalled();
    expect(subscribeToEnrollment).toHaveBeenCalledTimes(1);
    expect(subscribeToEnrollment).toHaveBeenCalledWith("student-1", "course-1", expect.any(Function), expect.any(Function));
  });

  it("quem não tem: com o preço na tela o botão espera a leitura, e só depois oferece pagar", async () => {
    signIn();
    enrollmentState.deliverLater = true;
    render(<CreatorCourseDetail courseIdOverride="course-1" checkoutOnly hideHeader />);

    await screen.findByText("$149.00");
    const waiting = screen.getByRole("button", { name: "Enroll" });
    expect(waiting).toBeDisabled();
    expect(waiting).toHaveAttribute("aria-busy", "true");
    fireEvent.click(waiting);
    expect(startCourseCheckout).not.toHaveBeenCalled();

    act(() => enrollmentState.onNext?.(null));
    const pay = await screen.findByRole("button", { name: "Enroll — $149.00" });
    expect(pay).toBeEnabled();
    expect(pay).not.toHaveAttribute("aria-busy");
    expect(screen.queryByRole("link", { name: "Continue learning" })).not.toBeInTheDocument();
  });

  it("curso grátis: o botão de entrar grátis também espera a leitura", async () => {
    Object.assign(fixtures.course, { paymentType: "free", priceAmountMinor: 0 });
    signIn();
    enrollmentState.deliverLater = true;
    render(<CreatorCourseDetail courseIdOverride="course-1" checkoutOnly hideHeader />);

    const waiting = await screen.findByRole("button", { name: "Enroll" });
    expect(waiting).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Enroll free" })).not.toBeInTheDocument();

    act(() => enrollmentState.onNext?.(null));
    expect(await screen.findByRole("button", { name: "Enroll free" })).toBeEnabled();
  });

  it("sem sessão: nada muda, e a matrícula não é lida", async () => {
    render(<CreatorCourseDetail courseIdOverride="course-1" checkoutOnly hideHeader />);

    expect(await screen.findByRole("link", { name: "Enroll — $149.00" }))
      .toHaveAttribute("href", "/auth?mode=signup&returnTo=%2Fcourses%2Fcourse-1%2Fcheckout");
    expect(subscribeToEnrollment).not.toHaveBeenCalled();
  });

  it("a leitura falhou: fica o botão de pagar, como antes", async () => {
    signIn();
    vi.mocked(subscribeToEnrollment).mockImplementationOnce((_uid, _courseId, _onNext, onError) => {
      onError(new Error("offline"));
      return Object.assign(() => {}, { reload: async () => {} });
    });
    render(<CreatorCourseDetail courseIdOverride="course-1" checkoutOnly hideHeader />);

    const pay = await screen.findByRole("button", { name: "Enroll — $149.00" });
    expect(pay).toBeEnabled();
    expect(screen.queryByRole("link", { name: "Continue learning" })).not.toBeInTheDocument();
    fireEvent.click(pay);
    expect(startCourseCheckout).toHaveBeenCalledWith("course-1", {});
  });
});

// F-11: com a rede ruim, a leitura que falha tem saída na própria página
// ("Try again" lê de novo), e nunca mostra preço ou botão de pagar inventados.
describe("CreatorCourseDetail: a leitura que falha tem 'Try again'", () => {
  it.each([false, true])("o curso não carregou: aviso, 'Try again' que assina de novo, e a loja como link (compra: %s)", async (checkoutOnly) => {
    fixtures.holdCourse = true;
    render(<RealCoursesProvider value><CreatorCourseDetail courseIdOverride="course-1" hideHeader checkoutOnly={checkoutOnly} /></RealCoursesProvider>);
    act(() => fixtures.courseError?.(new Error("offline")));

    expect(screen.getByRole("alert")).toHaveTextContent("We could not load this course right now.");
    expect(screen.getByRole("link", { name: "Open marketplace" })).toHaveAttribute("href", "/courses");
    expect(screen.queryByText("$149.00")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Enroll/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(fixtures.subscriptions).toBe(2);
    // O aviso fica até a resposta, com o botão ocupado.
    expect(screen.getByRole("button", { name: "Trying again..." })).toHaveAttribute("aria-busy", "true");

    act(() => fixtures.courseNext?.(fixtures.course));
    expect((await screen.findAllByText("$149.00")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("a releitura que falha de novo devolve o aviso, sem botão de pagar", async () => {
    fixtures.holdCourse = true;
    render(<CreatorCourseDetail courseIdOverride="course-1" hideHeader />);
    act(() => fixtures.courseError?.(new Error("offline")));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    act(() => fixtures.courseError?.(new Error("offline")));

    expect(await screen.findByRole("button", { name: "Try again" })).toBeEnabled();
    expect(screen.getByRole("alert")).toHaveTextContent("We could not load this course right now.");
    expect(screen.queryByRole("button", { name: /Enroll/ })).not.toBeInTheDocument();
  });

  it("o preço não carregou: 'Try again' no cartão lê as ofertas de novo, e o preço chega", async () => {
    fixtures.auth.status = "authenticated"; fixtures.auth.user = { uid: "buyer" };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: "unavailable" }) })
      .mockResolvedValue({ ok: true, json: async () => ({ offers: [] }) });
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<CreatorCourseDetail courseIdOverride="course-1" hideHeader />);
    const card = await waitFor(() => {
      const found = container.querySelector<HTMLElement>("#enroll-card");
      expect(found).not.toBeNull();
      return found!;
    });

    expect(await within(card).findByRole("alert")).toHaveTextContent("Offers are temporarily unavailable.");
    expect(within(card).queryByText("$149.00")).not.toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Checkout not available yet" })).toBeDisabled();

    fireEvent.click(within(card).getByRole("button", { name: "Try again" }));
    expect(await within(card).findByRole("button", { name: "Enroll — $149.00" })).toBeEnabled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(within(card).queryByRole("alert")).not.toBeInTheDocument();
  });
});

// A leitura da matrícula que não responde nem falha não prende a compra: em 4 s
// o botão de pagar volta (como numa falha). E a resposta atrasada de outra
// pessoa não mexe no botão de quem está na página agora.
describe("CreatorCourseDetail: o prazo da leitura da matrícula no checkout", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fixtures.auth.status = "authenticated"; fixtures.auth.user = { uid: "student-1" };
    enrollmentState.deliverLater = true;
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    enrollmentState.current = null;
    enrollmentState.deliverLater = false;
  });

  it("sem resposta em 4 s, o botão de pagar volta, como numa falha", async () => {
    render(<CreatorCourseDetail courseIdOverride="course-1" checkoutOnly hideHeader />);
    await screen.findByText("$149.00");
    expect(screen.getByRole("button", { name: "Enroll" })).toBeDisabled();

    act(() => vi.advanceTimersByTime(3_000));
    expect(screen.getByRole("button", { name: "Enroll" })).toBeDisabled();
    act(() => vi.advanceTimersByTime(1_000));
    const pay = screen.getByRole("button", { name: "Enroll — $149.00" });
    expect(pay).toBeEnabled();
    fireEvent.click(pay);
    expect(startCourseCheckout).toHaveBeenCalledWith("course-1", {});
  });

  it("a resposta em 1 s vale, e o prazo não muda nada depois", async () => {
    const armed = vi.spyOn(window, "setTimeout");
    const disarmed = vi.spyOn(window, "clearTimeout");
    render(<CreatorCourseDetail courseIdOverride="course-1" checkoutOnly hideHeader />);
    await screen.findByText("$149.00");
    const index = armed.mock.calls.findIndex(([, delay]) => delay === 4_000);
    expect(index).toBeGreaterThan(-1);
    const deadline = armed.mock.results[index].value;
    act(() => vi.advanceTimersByTime(1_000));
    act(() => enrollmentState.onNext?.({ status: "active" }));

    expect(screen.getByRole("link", { name: "Continue learning" })).toBeInTheDocument();
    // O prazo foi desarmado com a resposta, antes de vencer.
    expect(disarmed).toHaveBeenCalledWith(deadline);
    act(() => vi.advanceTimersByTime(5_000));
    expect(screen.getByRole("link", { name: "Continue learning" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Enroll/ })).not.toBeInTheDocument();
    armed.mockRestore();
    disarmed.mockRestore();
  });

  it("desmontar não deixa prazo pendente", async () => {
    const view = render(<CreatorCourseDetail courseIdOverride="course-1" checkoutOnly hideHeader />);
    await screen.findByText("$149.00");
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("trocou a pessoa com a 1ª leitura no ar: a resposta velha não mexe na de agora", async () => {
    const old: { next: ((enrollment: unknown) => void) | null } = { next: null };
    vi.mocked(subscribeToEnrollment).mockImplementationOnce((_uid, _courseId, onNext) => {
      old.next = onNext as (enrollment: unknown) => void;
      return Object.assign(() => {}, { reload: async () => {} });
    });
    const view = render(<CreatorCourseDetail courseIdOverride="course-1" checkoutOnly hideHeader />);
    await screen.findByText("$149.00");

    fixtures.auth.user = { uid: "student-2" };
    view.rerender(<CreatorCourseDetail courseIdOverride="course-1" checkoutOnly hideHeader />);
    expect(subscribeToEnrollment).toHaveBeenLastCalledWith("student-2", "course-1", expect.any(Function), expect.any(Function));
    act(() => enrollmentState.onNext?.(null));
    expect(screen.getByRole("button", { name: "Enroll — $149.00" })).toBeEnabled();

    act(() => old.next?.({ status: "active" }));
    expect(screen.getByRole("button", { name: "Enroll — $149.00" })).toBeEnabled();
    expect(screen.queryByRole("link", { name: "Continue learning" })).not.toBeInTheDocument();
  });
});
