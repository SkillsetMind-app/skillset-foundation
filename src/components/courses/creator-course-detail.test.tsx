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
  // true: the course subscription does not answer, like a read still on its way.
  holdCourse: false,
  // The last onNext of the course subscription, to deliver the course later.
  courseNext: null as ((course: TeacherCourse) => void) | null,
  // The last onError of the course subscription, to simulate the network dropping.
  courseError: null as ((error: Error) => void) | null,
  // The public keys (payments.checkout): on, except in the test that turns them off.
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

// Delivers the published course right away, as the real subscription would.
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
  // Returns what the lesson carries inline (the default fixture carries nothing).
  resolveLessonContent: (
    _doc: unknown,
    lesson: { contentText?: string | null; externalUrl?: string | null },
  ) => ({ contentText: lesson.contentText ?? null, externalUrl: lesson.externalUrl ?? null }),
}));

// The session date of the live event (get_live_event_session).
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
// `data-price`: the price the block receives (no attribute when it receives nothing).
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
  // With no registered offer the price falls back to the course's own field: US$ 149.
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
  it("by default draws its own header with the course title", async () => {
    render(<CreatorCourseDetail courseIdOverride="course-1" />);

    await screen.findAllByText("$149.00");
    const title = screen.getByRole("heading", { level: 1, name: "Deep Focus Systems" });
    // Clamp, not a fixed 60px.
    expect(title).toHaveClass("page-title");
    expect(title.className).not.toMatch(/text-6xl/);
  });

  // The free preview lesson shows the text on the course page: the same
  // line breaks and clickable links as the members area, with no raw HTML.
  it("free preview lesson text becomes a link and keeps the line break", async () => {
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

  it("with hideHeader does not repeat the title the page already rendered on the server", async () => {
    const { container } = render(
      <CreatorCourseDetail courseIdOverride="course-1" hideHeader />,
    );

    await screen.findAllByText("$149.00");
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(screen.queryByText("Deep Focus Systems")).not.toBeInTheDocument();
    // The rest of the interactive content stays in place.
    expect(container.querySelector("#free-preview")).not.toBeNull();
  });
});

// Loading is not an error: before, a second h1 "Loading course..." and a button that
// took the buyer off the page; after that, "Loading pricing..." at 36px
// and "Checkout not available yet" for someone who already had an account.
describe("CreatorCourseDetail: while loading", () => {
  it.each([false, true])("the course on its way shows the skeleton: no title, no exit button (purchase: %s)", (checkoutOnly) => {
    fixtures.holdCourse = true;
    render(<CreatorCourseDetail courseIdOverride="course-1" hideHeader checkoutOnly={checkoutOnly} />);

    expect(screen.getByRole("status")).toHaveTextContent(checkoutOnly ? "Loading course checkout..." : "Loading course...");
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("a real error keeps the notice, and becomes an h2 under the h1 the server already put", () => {
    render(<CreatorCourseDetail hideHeader />);

    expect(screen.getByRole("heading", { level: 2, name: "Course not selected." })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(screen.queryByText("Creator course")).not.toBeInTheDocument();
  });

  it("the price on its way holds the place, and the button of someone with an account says Enroll, disabled", async () => {
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
    // The text only for the screen reader; on screen, a bar the size of the price.
    expect(within(container.querySelector<HTMLElement>("#enroll-card")!).getByText("Loading pricing...")).toHaveClass("sr-only");
  });

  // The teacher's call-to-action block used to print "Loading pricing..." and "Pricing
  // unavailable" in 18px bold, as if they were the price.
  it("the teacher's block only receives a real price: nothing loading, nothing failed", async () => {
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

  // With the price loaded, "Offer unavailable" and "Pricing pending" are still
  // status phrases: the block also goes without the price line. Free and a real
  // price (one-time or subscription) stay as before.
  it.each([
    ["oferta do link que não existe mais", () => { fixtures.query = "offer=MISSING"; withOffers(); }, "Offer unavailable", null],
    ["preço que não se resolve", () => { fixtures.course.priceAmountMinor = -1; }, "Pricing pending", null],
    ["curso gratuito", () => { fixtures.course.priceAmountMinor = 0; }, "Free", "Free"],
    ["pagamento único", () => {}, "$149.00", "$149.00"],
    ["assinatura", () => { Object.assign(fixtures.course, { paymentType: "subscription_monthly" }); }, "$149.00 / month", "$149.00 / month"],
  ])("%s: the card says \"%s\" and the block receives %s", async (_caso, arrange, cardPrice, blockPrice) => {
    arrange();
    render(<CreatorCourseDetail courseIdOverride="course-1" hideHeader />);
    await screen.findAllByText(cardPrice);
    if (blockPrice === null) {
      expect(screen.getByTestId("landing-blocks")).not.toHaveAttribute("data-price");
    } else {
      expect(screen.getByTestId("landing-blocks")).toHaveAttribute("data-price", blockPrice);
    }
  });

  // With purchase turned off the button does not say "Enroll" only to become the notice later.
  it("with purchase turned off, the notice comes straight away, without the waiting label", async () => {
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

  it("purchase cancellation is a neutral notice, and the checkout error is announced", async () => {
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

// An empty store is not a destination: the way back and the default action of the states lead to the start.
describe("CreatorCourseDetail: links to the store", () => {
  it.each([
    [true, "Back to all courses", "/courses"],
    [false, "Go home", "/"],
  ])("the way back to the catalog, at the top of the page and outside the purchase card (store with a real course: %s)", async (value, name, href) => {
    const { container } = render(<RealCoursesProvider value={value}><CreatorCourseDetail courseIdOverride="course-1" hideHeader /></RealCoursesProvider>);

    const back = await screen.findByRole("link", { name });
    expect(back).toHaveAttribute("href", href);
    expect(back.closest("#enroll-card")).toBeNull();
    // Before the cover, the title and the sections: it is the first item of the column.
    expect(back.parentElement?.firstElementChild).toBe(back);
    expect(back.compareDocumentPosition(container.querySelector("#enroll-card")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it.each([
    [true, "Open marketplace", "/courses"],
    [false, "Go home", "/"],
  ])("the default action of a state with no course (store with a real course: %s)", (value, name, href) => {
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

describe("CreatorCourseDetail: the card that sells", () => {
  it("puts the price at the top of the purchase card, not on the fourth line of a list", async () => {
    const { container } = render(
      <CreatorCourseDetail courseIdOverride="course-1" hideHeader />,
    );

    const card = container.querySelector("#enroll-card");
    expect(card).not.toBeNull();
    expect(await screen.findAllByText("$149.00")).toHaveLength(2);

    // The price is the big number at the top, before any list.
    const price = card?.querySelector(".display-title");
    expect(price?.textContent).toContain("$149.00");
    expect(price?.textContent).toContain("one-time");
  });

  it("removes Status and Access from the list: they are internal vocabulary", async () => {
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

  // Before: an "Access" label on the price and five blocks after the button, two in
  // boxes of different colors. Now: "Price", the button and a single block of facts.
  it("labels the price as 'Price' and gathers the facts in a single block, after the button", async () => {
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
    // No colored box of its own: the refund and the seller are lines of the same list.
    const list = within(card).getByRole("list");
    expect(within(list).getByText("7-day refund guarantee.")).toBeInTheDocument();
    // The guarantee states the conditions the policy imposes and leads to the full policy.
    expect(within(list).getByRole("link", { name: "7-day refund guarantee." })).toHaveAttribute("href", "/refund-policy");
    expect(within(list).getByText(/once per course, as long as you have completed less than half of it and no certificate has been issued\./)).toBeInTheDocument();
    expect(within(list).getByText("Sold by your instructor, not by SkillsetMind.")).toBeInTheDocument();
    expect(card.querySelector('[class*="success-soft"]')).toBeNull();
    // The phone's fixed bar uses the same label as the card.
    expect(container.querySelector('a[href="#enroll-card"]')?.closest("div.fixed")).toHaveTextContent(/^Price/);
  });

  // Until the price arrives the course is not yet "free": a free course used to read
  // "Paid access opens…", the refund and the seller while the price loaded.
  it.each([
    ["carregando", () => new Promise(() => {})],
    ["com a leitura falhando", async () => ({ ok: false, json: async () => ({ error: "unavailable" }) })],
  ])("free course with price %s: no paid-purchase phrase on the card", async (_state, respond) => {
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
    // The course detail list stays in place.
    expect(within(card).getByText("Category")).toBeInTheDocument();
  });

  it("keeps the card in view: sticks on scroll and gets a fixed bar on the phone", async () => {
    const { container } = render(
      <CreatorCourseDetail courseIdOverride="course-1" hideHeader />,
    );
    await screen.findAllByText("$149.00");

    expect(container.querySelector("#enroll-card")).toHaveClass("lg:sticky");
    // Purchase bar: leads to the card. Without IntersectionObserver (jsdom), or
    // before its first notice, nothing was measured: the bar stays in view on the
    // phone, as it always was. Only the measurement hides it.
    const bar = container.querySelector('a[href="#enroll-card"]');
    expect(bar).not.toBeNull();
    expect(bar?.closest("div.fixed")).toHaveClass("lg:hidden");
    expect(bar?.closest("div.fixed")).not.toHaveClass("hidden");
  });

  it("with the card off screen the purchase bar appears (on desktop, in the corner); with the button in view, it goes away", async () => {
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
      // Before the first notice: in view on the phone.
      expect(bar()).toHaveClass("lg:hidden");
      expect(bar()).not.toHaveClass("hidden");

      act(() => notify?.([{ isIntersecting: false }]));
      expect(bar()).not.toHaveClass("hidden");
      expect(bar()).toHaveClass("lg:right-6");

      // Top of the card in view, but the button still below the fold: the bar stays.
      const cta = container.querySelector("#enroll-card [data-cta-focus]") as HTMLElement;
      const rect = vi.spyOn(cta, "getBoundingClientRect");
      rect.mockReturnValue({ top: window.innerHeight + 200, bottom: window.innerHeight + 244 } as DOMRect);
      act(() => notify?.([{ isIntersecting: true }]));
      expect(bar()).not.toHaveClass("hidden");

      // The button came onto the screen: the bar goes away at any width (display
      // none: out of the Tab order), and not only from lg up.
      rect.mockReturnValue({ top: 300, bottom: 344 } as DOMRect);
      act(() => notify?.([{ isIntersecting: true }]));
      expect(bar()).toHaveClass("hidden");
      expect(bar()).not.toHaveClass("lg:right-6");

      // Left again: the bar comes back.
      act(() => notify?.([{ isIntersecting: false }]));
      expect(bar()).not.toHaveClass("hidden");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("signs the course with who teaches, with credential, rating and duration", async () => {
    render(<CreatorCourseDetail courseIdOverride="course-1" hideHeader />);
    await screen.findAllByText("$149.00");

    expect(
      screen.getByRole("link", { name: /Ana Prado/ }),
    ).toHaveAttribute("href", "/instructors/teacher-1");
    expect(screen.getByText("PhD in cognitive science")).toBeInTheDocument();
    expect(screen.getByText("4.8")).toBeInTheDocument();
    // In the byline and in the detail list of the purchase card.
    expect(screen.getAllByText("1h 30m")).toHaveLength(2);
  });

  it("without minutes on every lesson, does not show a duration shorter than the course", async () => {
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

  // At 320 px the byline wraps: the badge goes with the name, with no
  // negative margin pulling the icon on top of another item.
  it("verified badge: only the icon, attached to the instructor's name", async () => {
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

  // Without a badge, the credential is what the teacher typed: the byline says so
  // next to it; with the badge, it does not. (The instructor card has its own test
  // in self-reported-credentials.test.tsx.)
  it("a credential without a badge comes marked in the byline", async () => {
    render(<CreatorCourseDetail courseIdOverride="course-1" hideHeader />);
    await screen.findAllByText("$149.00");

    const byline = screen.getByRole("link", { name: /Ana Prado/ }).closest("div")!;
    expect(byline).toHaveTextContent("PhD in cognitive science");
    expect(byline).toHaveTextContent("Self-reported");
  });

  it("a credential with a badge does not carry the mark", async () => {
    Object.assign(fixtures.profile, { verification: { kind: "evidence", verifiedAt: null } });
    try {
      render(<CreatorCourseDetail courseIdOverride="course-1" hideHeader />);
      await screen.findAllByText("$149.00");
      expect(screen.queryByText("Self-reported")).not.toBeInTheDocument();
    } finally {
      delete (fixtures.profile as { verification?: unknown }).verification;
    }
  });

  it("moves up the social proof: the instructor comes before the free preview", async () => {
    const { container } = render(
      <CreatorCourseDetail courseIdOverride="course-1" hideHeader />,
    );
    await screen.findAllByText("$149.00");

    const blocks = Array.from(
      container.querySelectorAll("#what-you-will-learn, #instructor, #free-preview"),
    ).map((node) => node.id);
    // After "What you'll learn", and not at the end of the sidebar.
    expect(blocks).toEqual(["what-you-will-learn", "instructor", "free-preview"]);
  });

  it("calls the visitor back to the course checkout after creating an account", async () => {
    render(<CreatorCourseDetail courseIdOverride="course-1" hideHeader />);

    const enroll = await screen.findByRole("link", {
      name: /Enroll \u2014 \$149\.00/,
    });
    expect(enroll).toHaveAttribute(
      "href",
      "/auth?mode=signup&returnTo=%2Fcourses%2Fcourse-1%2Fcheckout",
    );
  });

  it("offers the sections that exist, and only those", async () => {
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

  // EU, EEA and United Kingdom: reading the offers asks for the immediate-access
  // box; without it ticked the button does not open the purchase.
  it("a buyer who must consent to immediate access cannot open checkout until the box is ticked", async () => {
    fixtures.auth.status = "authenticated"; fixtures.auth.user = { uid: "buyer" };
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ offers: [], withdrawalConsentRequired: true }) })));
    const { container } = render(<CreatorCourseDetail courseIdOverride="course-1" />);

    const consent = await screen.findByRole("checkbox", {
      name: "I want access now and I understand I lose my 14-day withdrawal right once access starts.",
    });
    expect(consent).not.toBeChecked();

    const button = container.querySelector("#enroll-card button[data-cta-focus]") as HTMLElement;
    fireEvent.click(button);
    expect(await screen.findByText("Tick the box to confirm you want access now.")).toBeInTheDocument();
    expect(startCourseCheckout).not.toHaveBeenCalled();

    fireEvent.click(consent);
    fireEvent.click(button);
    await waitFor(() => expect(startCourseCheckout).toHaveBeenCalledWith("course-1", { withdrawalConsent: true }));
  });

  // The country changed between reading the offers and the click: the server asks for the
  // box, and it appears next to the notice (before, only the error stayed).
  it("shows the consent box when the server asks for it at the click", async () => {
    fixtures.auth.status = "authenticated"; fixtures.auth.user = { uid: "buyer" };
    vi.mocked(startCourseCheckout).mockRejectedValueOnce(
      new PaymentRequestError("Confirm that you want access now to continue.", 400, "withdrawal_consent_required"),
    );
    const { container } = render(<CreatorCourseDetail courseIdOverride="course-1" />);
    await screen.findAllByText("$149.00");
    expect(container.querySelector("[data-withdrawal-consent]")).toBeNull();

    fireEvent.click(container.querySelector("#enroll-card button[data-cta-focus]") as HTMLElement);

    expect(await screen.findByText("Tick the box to confirm you want access now.")).toBeInTheDocument();
    expect(container.querySelector("[data-withdrawal-consent]")).not.toBeNull();
  });

  it("a buyer outside those countries sees no consent box", async () => {
    fixtures.auth.status = "authenticated"; fixtures.auth.user = { uid: "buyer" };
    const { container } = render(<CreatorCourseDetail courseIdOverride="course-1" />);
    await screen.findAllByText("$149.00");
    expect(container.querySelector("[data-withdrawal-consent]")).toBeNull();
  });

  it("a signed-in buyer of a paid course still opens checkout", async () => {
    fixtures.auth.status = "authenticated"; fixtures.auth.user = { uid: "buyer" };
    render(<CreatorCourseDetail courseIdOverride="course-1" />);
    await screen.findAllByText("$149.00");

    fireEvent.click(salesCta());

    await waitFor(() => expect(startCourseCheckout).toHaveBeenCalledWith("course-1", {}));
    expect(fixtures.router.push).not.toHaveBeenCalled();
  });

  describe("no visible response", () => {
    const scrollIntoView = vi.fn();
    beforeEach(() => {
      scrollIntoView.mockClear();
      Element.prototype.scrollIntoView = scrollIntoView;
    });
    afterEach(() => {
      // @ts-expect-error jsdom does not define scrollIntoView; removes the test's stub
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

  // Creating an account always returns to the checkout; signing in returns to the page the person
  // was on. Both with the offer and the price, never the address's `returnTo`.
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
    // A single notice (the red one): the price spot does not repeat "Pricing unavailable".
    expect(await screen.findByRole("alert")).toHaveTextContent("Offers are temporarily unavailable.");
    expect(screen.queryByText("Pricing unavailable")).not.toBeInTheDocument();
    expect(screen.queryByText("Secure payment processed by Stripe.")).not.toBeInTheDocument();
  });

  it("the sales page keeps its detail list and its way back", async () => {
    const { container } = render(<CreatorCourseDetail courseIdOverride="course-1" hideHeader />);
    await screen.findAllByText("$149.00");
    expect(screen.getByText("Category")).toBeInTheDocument();
    // With no real course in the store, the way back leads to the start. It sits at the top of the
    // left column, outside the purchase card.
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

  // Subscription: the automatic renewal is stated next to the button, before Stripe.
  it("a subscription states price, interval, auto-renewal and how to cancel right before the button", async () => {
    Object.assign(fixtures.course, { paymentType: "subscription_monthly" });
    const { container } = render(<CreatorCourseDetail courseIdOverride="course-1" />);
    await waitFor(() => expect(cardAction(container)).toHaveTextContent("Subscribe — $149.00 / month"));

    const disclosure = container.querySelector("#enroll-card [data-subscription-disclosure]") as HTMLElement;
    expect(disclosure).toHaveTextContent(
      "Charged today, then $149.00 every month. Renews automatically until you cancel. Cancel anytime on your course page, under Subscription, to stop the next charge.",
    );
    const button = cardAction(container) as HTMLElement;
    expect(button.compareDocumentPosition(disclosure) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it("a one-time purchase shows no renewal notice", async () => {
    const { container } = render(<CreatorCourseDetail courseIdOverride="course-1" />);
    await waitFor(() => expect(cardAction(container)).toHaveTextContent("Enroll — $149.00"));
    expect(container.querySelector("[data-subscription-disclosure]")).toBeNull();
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

// Community, live event and e-book publish without a lesson grid. The sales
// page showed "preview still being prepared", "Enroll to open the remaining
// 0 lessons" and "Lessons: 0". Now it says what the buyer receives.
describe("CreatorCourseDetail: what each type delivers", () => {
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

  it("community: the page talks about the community, with no curriculum or 'Lessons: 0'", async () => {
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

  it("community in Spanish", async () => {
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

  it("e-book: one file to download, even with the file lesson in the product", async () => {
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

  it("live event: the session date in the teacher's time zone, with the time zone written out", async () => {
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

  it("live event with no known date says it will be announced", async () => {
    const { restore } = renderAs("live_event");
    try {
      expect(
        await screen.findByText("Live session. The date will be announced here."),
      ).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  it("course keeps the preview, curriculum and the number of lessons", async () => {
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
      // @ts-expect-error jsdom does not define scrollIntoView; removes the test's stub
      delete Element.prototype.scrollIntoView;
    }
  });
});

// The cover alone above the columns pushed the price and "Enroll" below the
// first screen. Now the server header (`lead`) is the top of the left column and
// the purchase card is the right column from the top.
describe("CreatorCourseDetail: the server header at the top of the column", () => {
  const lead = (
    <header id="overview">
      <h1>Deep Focus Systems</h1>
      <p>Server summary</p>
    </header>
  );

  it("the header opens the left column, and the purchase card is the column beside it", async () => {
    const { container } = render(<CreatorCourseDetail courseIdOverride="course-1" hideHeader lead={lead} />);
    await screen.findAllByText("$149.00");

    const title = screen.getByRole("heading", { level: 1, name: "Deep Focus Systems" });
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    const column = title.closest("section") as HTMLElement;
    // Same grid: the header column and the card are siblings.
    expect(column.nextElementSibling).toBe(container.querySelector("#enroll-card"));
    // Before the instructor byline and the section menu.
    const nav = screen.getByRole("navigation", { name: "Course sections" });
    expect(title.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("while the course loads, the header stays in view (outside the pulse and the aria-hidden)", () => {
    fixtures.holdCourse = true;
    render(<CreatorCourseDetail courseIdOverride="course-1" hideHeader lead={lead} />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading course...");
    const title = screen.getByRole("heading", { level: 1, name: "Deep Focus Systems" });
    expect(title.closest('[aria-hidden="true"]')).toBeNull();
    expect(title.closest(".animate-pulse")).toBeNull();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("when the course arrives, the header is the SAME node: it does not unmount (the cover does not flicker)", async () => {
    fixtures.holdCourse = true;
    render(<CreatorCourseDetail courseIdOverride="course-1" hideHeader lead={lead} />);
    const before = screen.getByRole("heading", { level: 1, name: "Deep Focus Systems" });

    act(() => fixtures.courseNext?.(fixtures.course));
    await screen.findAllByText("$149.00");

    expect(screen.queryByText("Loading course...")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Deep Focus Systems" })).toBe(before);
    expect(before.isConnected).toBe(true);
  });

  it("in an error state, the header stays at the top and the notice becomes an h2", () => {
    render(<CreatorCourseDetail hideHeader lead={lead} />);

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    const state = screen.getByRole("heading", { level: 2, name: "Course not selected." });
    const title = screen.getByRole("heading", { level: 1 });
    expect(title.compareDocumentPosition(state) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("CreatorCourseDetail: a price that fails and who sells", () => {
  it("with the price read failing, the card says it only once: the red notice", async () => {
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

  it("on the sales page, the seller is one line with 'Learn more'; the full sentence stays on the page", async () => {
    const { container } = render(<CreatorCourseDetail courseIdOverride="course-1" hideHeader />);
    await screen.findAllByText("$149.00");
    const card = container.querySelector("#enroll-card") as HTMLElement;

    const details = within(card).getByText("Sold by your instructor, not by SkillsetMind.").closest("details") as HTMLElement;
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute("open");
    expect(details.querySelector("summary")).toHaveTextContent("Learn more");
    // Same key, same text, without navigating to another page.
    expect(within(details).getByText(/This course is sold directly by the independent educator/)).toBeInTheDocument();
  });

  it("on the purchase page, right before paying, the seller's sentence stays whole and open", async () => {
    render(<CreatorCourseDetail courseIdOverride="course-1" checkoutOnly hideHeader />);
    await screen.findByText("$149.00");

    expect(screen.getByText(/This course is sold directly by the independent educator/).closest("details")).toBeNull();
    expect(screen.queryByText("Learn more")).not.toBeInTheDocument();
  });

  it("with the price on its way, the purchase bar holds the place with the same pulsing bar", async () => {
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

  // S-04: with the price failing, the bar shows the card's dash (and not
  // "Pricing unavailable" in title lettering) and, in place of an "Enroll" with no
  // price, the same "Try again" as the card notice: on the phone the card sits
  // at the end of the page, after the whole curriculum.
  it("with the price read failing, the purchase bar shows the dash and the card's 'Try again'", async () => {
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
    // The same 44px height as "Enroll": the bar does not shrink in this state.
    expect(retry).toHaveClass("min-h-11");
    expect(offerReads()).toBe(1);
    // Both labels already live in the button (the width is that of the larger); at rest the
    // waiting one is hidden and outside the name.
    expect(within(retry).getByText("Trying again...")).toHaveAttribute("aria-hidden", "true");
    expect(within(retry).getByText("Try again")).not.toHaveAttribute("aria-hidden");

    fireEvent.click(retry);
    fireEvent.click(within(bar).getByRole("button", { name: "Trying again..." }));

    // A single re-read, and the bar waits with the button locked: the same button,
    // now with the waiting name, and the resting label hidden in its place.
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

// A 10-module course was a huge column, everything open.
describe("CreatorCourseDetail: one module per accordion", () => {
  const mutable = fixtures.course as TeacherCourse;
  const original = mutable.modules;
  afterEach(() => {
    mutable.modules = original;
  });

  it("the first module opens by itself, the others close; lessons and duration on the module line", async () => {
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

    // Each module is a heading (navigable by headings, also in VoiceOver)
    // with the open button inside: the accordion pattern.
    const curriculum = container.querySelector("#curriculum") as HTMLElement;
    const toggles = Array.from(curriculum.querySelectorAll<HTMLButtonElement>("h2 > button[aria-expanded]"));
    expect(toggles).toHaveLength(2);
    expect(within(curriculum).getByRole("heading", { level: 2, name: /^Foundations 1 lesson · 1h 30m$/ })).toContainElement(toggles[0]);
    expect(toggles[0]).toHaveAttribute("aria-expanded", "true");
    expect(toggles[1]).toHaveAttribute("aria-expanded", "false");
    // Without minutes on every lesson, the duration does not appear (nothing is estimated).
    expect(within(toggles[1]).getByText("2 lessons")).toBeInTheDocument();
    const panel = (toggle: HTMLButtonElement) => document.getElementById(toggle.getAttribute("aria-controls")!) as HTMLElement;
    expect(panel(toggles[0])).not.toHaveAttribute("hidden");
    expect(panel(toggles[1])).toHaveAttribute("hidden");
    // Nothing leaves the page: the lessons of the closed module stay in the DOM, and the locked one
    // still opens the purchase.
    expect(within(panel(toggles[1])).getByText("Shutdown ritual").closest("button")).toHaveAttribute("aria-haspopup", "dialog");

    fireEvent.click(toggles[1]);
    expect(toggles[1]).toHaveAttribute("aria-expanded", "true");
    expect(panel(toggles[1])).not.toHaveAttribute("hidden");
    fireEvent.click(toggles[0]);
    expect(panel(toggles[0])).toHaveAttribute("hidden");
  });
});

// O-09: whoever CREATES AN ACCOUNT to buy returns to the course checkout, with the offer,
// and not to the top of the sales page. Whoever SIGNS IN (and the purchase without login) returns to
// this page, as before. A-11: the coupon is the house field.
describe("CreatorCourseDetail: the visitor who creates an account returns to the checkout", () => {
  const returnOf = (link: HTMLElement) =>
    new URL(link.getAttribute("href")!, "https://test.local").searchParams.get("returnTo");

  it("paid course, no offer: creating an account returns to the checkout; signing in, to this page", async () => {
    render(<CreatorCourseDetail courseIdOverride="course-1" />);
    const enroll = await screen.findByRole("link", { name: "Enroll — $149.00" });

    expect(enroll).toHaveAttribute("href", "/auth?mode=signup&returnTo=%2Fcourses%2Fcourse-1%2Fcheckout");
    expect(screen.getByRole("link", { name: "Sign in" }))
      .toHaveAttribute("href", "/auth?mode=signin&returnTo=%2Fcourses%2Fcourse-1");
  });

  it("paid course with ?offer=: the offer goes along in both", async () => {
    fixtures.query = "offer=LAUNCH";
    withOffers();
    render(<CreatorCourseDetail courseIdOverride="focus-slug" />);
    const enroll = await screen.findByRole("link", { name: "Enroll — $49.00" });

    expect(returnOf(enroll)).toBe("/courses/focus-slug/checkout?offer=LAUNCH");
    expect(returnOf(screen.getByRole("link", { name: "Sign in" }))).toBe("/courses/focus-slug?offer=LAUNCH");
  });

  it("free course: creating an account returns to the checkout's free sign-up card; signing in, to this page", async () => {
    Object.assign(fixtures.course, { paymentType: "free", priceAmountMinor: 0 });
    render(<CreatorCourseDetail courseIdOverride="course-1" />);
    const enroll = await screen.findByRole("link", { name: "Enroll free" });

    expect(returnOf(enroll)).toBe("/courses/course-1/checkout");
    expect(returnOf(screen.getByRole("link", { name: "Sign in" }))).toBe("/courses/course-1");
  });

  // Signing in returns to this page, and whoever already has the course sees "Continue learning".
  // The checkout now also reads the enrollment: whoever lands on it (through sign-up or
  // through the "Sign in" on the sign-up screen) sees the same, and not the pay button.
  it("whoever already has the course and signs in through the card returns to where they see 'Continue learning'", async () => {
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

  it("purchase without login (turned off today) goes to the same destination as before", async () => {
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

  it("the phone's bar still leads to the card, whose link returns to the checkout", async () => {
    const { container } = render(<CreatorCourseDetail courseIdOverride="course-1" />);
    await screen.findByRole("link", { name: "Enroll — $149.00" });

    const bar = container.querySelector("div.fixed") as HTMLElement;
    expect(Array.from(bar.querySelectorAll("a")).map((link) => link.getAttribute("href"))).toEqual(["#enroll-card"]);
    const cardLink = container.querySelector<HTMLElement>("#enroll-card a[data-cta-focus]")!;
    expect(returnOf(cardLink)).toBe("/courses/course-1/checkout");
  });

  // The usual filter (getSafeReturnTo, the same as login, the email
  // confirmation and the end of the interview) lets the checkout through whole and
  // still blocks what leads outside.
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

  it("the destination the link leads to passes the filter unchanged", async () => {
    fixtures.query = "offer=LAUNCH&priceId=price-1";
    withOffers();
    render(<CreatorCourseDetail courseIdOverride="focus-slug" />);
    const destination = returnOf(await screen.findByRole("link", { name: "Enroll — $49.00" }))!;

    expect(getSafeReturnTo(new URLSearchParams({ returnTo: destination }))).toBe(destination);
  });

  it("the coupon uses the house field and keeps the same filter as the text", async () => {
    fixtures.auth.status = "authenticated"; fixtures.auth.user = { uid: "buyer" };
    render(<CreatorCourseDetail courseIdOverride="course-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Have a coupon?" }));

    const field = screen.getByLabelText("Coupon code");
    expect(field).toHaveClass("field-input");
    expect(field).not.toHaveClass("bg-white");
    // House label: the same as Field, 14px and no uppercase.
    const label = screen.getByText("Coupon code");
    expect(label.closest("label")).toContainElement(field);
    expect(label).toHaveClass("text-sm", "text-[var(--color-ink)]");
    expect(label).not.toHaveClass("uppercase");
    expect(label).not.toHaveClass("text-xs");
    fireEvent.change(field, { target: { value: "save 25!" } });
    expect(field).toHaveValue("SAVE25");
  });
});

// The purchase page reads the enrollment, like the sales page: whoever already has the
// course sees "Continue learning". Until the read answers, the button waits; if
// it fails, the pay button from before stays (the server refuses whoever already has it).
describe("CreatorCourseDetail: the purchase page recognizes whoever already has the course", () => {
  const signIn = () => { fixtures.auth.status = "authenticated"; fixtures.auth.user = { uid: "student-1" }; };
  afterEach(() => {
    enrollmentState.current = null;
    enrollmentState.deliverLater = false;
  });

  it("whoever already has it: 'Continue learning' to the classroom, no pay button, a single read", async () => {
    signIn();
    enrollmentState.current = { status: "active" };
    render(<CreatorCourseDetail courseIdOverride="course-1" checkoutOnly hideHeader />);

    expect(await screen.findByRole("link", { name: "Continue learning" })).toHaveAttribute("href", "/learn/courses/course-1");
    expect(screen.queryByRole("button", { name: /^Enroll/ })).not.toBeInTheDocument();
    expect(startCourseCheckout).not.toHaveBeenCalled();
    expect(subscribeToEnrollment).toHaveBeenCalledTimes(1);
    expect(subscribeToEnrollment).toHaveBeenCalledWith("student-1", "course-1", expect.any(Function), expect.any(Function));
  });

  it("whoever does not: with the price on screen the button waits for the read, and only then offers to pay", async () => {
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

  it("free course: the free sign-up button also waits for the read", async () => {
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

  it("no session: nothing changes, and the enrollment is not read", async () => {
    render(<CreatorCourseDetail courseIdOverride="course-1" checkoutOnly hideHeader />);

    expect(await screen.findByRole("link", { name: "Enroll — $149.00" }))
      .toHaveAttribute("href", "/auth?mode=signup&returnTo=%2Fcourses%2Fcourse-1%2Fcheckout");
    expect(subscribeToEnrollment).not.toHaveBeenCalled();
  });

  it("the read failed: the pay button stays, as before", async () => {
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

// F-11: with a bad network, the read that fails has an exit on the page itself
// ("Try again" reads again), and never shows an invented price or pay button.
describe("CreatorCourseDetail: the read that fails has 'Try again'", () => {
  it.each([false, true])("the course did not load: notice, 'Try again' that resubscribes, and the store as a link (purchase: %s)", async (checkoutOnly) => {
    fixtures.holdCourse = true;
    render(<RealCoursesProvider value><CreatorCourseDetail courseIdOverride="course-1" hideHeader checkoutOnly={checkoutOnly} /></RealCoursesProvider>);
    act(() => fixtures.courseError?.(new Error("offline")));

    expect(screen.getByRole("alert")).toHaveTextContent("We could not load this course right now.");
    expect(screen.getByRole("link", { name: "Open marketplace" })).toHaveAttribute("href", "/courses");
    expect(screen.queryByText("$149.00")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Enroll/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(fixtures.subscriptions).toBe(2);
    // The notice stays until the response, with the button busy.
    expect(screen.getByRole("button", { name: "Trying again..." })).toHaveAttribute("aria-busy", "true");

    act(() => fixtures.courseNext?.(fixtures.course));
    expect((await screen.findAllByText("$149.00")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("a re-read that fails again brings the notice back, with no pay button", async () => {
    fixtures.holdCourse = true;
    render(<CreatorCourseDetail courseIdOverride="course-1" hideHeader />);
    act(() => fixtures.courseError?.(new Error("offline")));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    act(() => fixtures.courseError?.(new Error("offline")));

    expect(await screen.findByRole("button", { name: "Try again" })).toBeEnabled();
    expect(screen.getByRole("alert")).toHaveTextContent("We could not load this course right now.");
    expect(screen.queryByRole("button", { name: /Enroll/ })).not.toBeInTheDocument();
  });

  it("the price did not load: 'Try again' on the card reads the offers again, and the price arrives", async () => {
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

// An enrollment read that neither answers nor fails does not hold up the purchase: in 4 s
// the pay button comes back (as on a failure). And a late response from another
// person does not touch the button of whoever is on the page now.
describe("CreatorCourseDetail: the deadline for reading the enrollment at checkout", () => {
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

  it("with no response in 4 s, the pay button comes back, as on a failure", async () => {
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

  it("a response in 1 s counts, and the deadline changes nothing afterward", async () => {
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
    // The deadline was disarmed with the response, before expiring.
    expect(disarmed).toHaveBeenCalledWith(deadline);
    act(() => vi.advanceTimersByTime(5_000));
    expect(screen.getByRole("link", { name: "Continue learning" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Enroll/ })).not.toBeInTheDocument();
    armed.mockRestore();
    disarmed.mockRestore();
  });

  it("unmounting leaves no pending deadline", async () => {
    const view = render(<CreatorCourseDetail courseIdOverride="course-1" checkoutOnly hideHeader />);
    await screen.findByText("$149.00");
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("the person changed with the 1st read in flight: the old response does not touch the current one", async () => {
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
