import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import { CourseManageHub } from "@/components/teacher/course-manage-hub";
import { TeacherCourseStudio } from "@/components/teacher/teacher-course-studio";
import { TeacherStudioDashboard } from "@/components/teacher/teacher-studio-dashboard";
import type { TeacherCourse } from "@/domain/teacher-course";
import type { UserProfile } from "@/domain/user-profile";
import type {
  setOwnCourseFeatured,
  subscribeToTeacherCourse,
  subscribeToTeacherCourses,
} from "@/lib/data/teacher-courses";
import type { subscribeToUserProfile } from "@/lib/data/user-profiles";
import { LOCALE_COOKIE } from "@/lib/i18n/config";

// What the person suffered: with the language in Spanish, the product panel, the
// product list and the creator Home stayed in English. These tests
// render the three screens inside the I18nProvider in "es" and check a few
// labels per screen. The authored content (course title) stays as it is.

const mocks = vi.hoisted(() => {
  const course: TeacherCourse = {
    id: "course-1",
    ownerId: "teacher-1",
    title: "Fundamentos de facilitación",
    summary: "Una práctica repetible para conducir sesiones de grupo productivas.",
    category: "Facilitation & Group Work",
    categories: ["Facilitation & Group Work"],
    status: "draft",
    modules: [{ id: "m1", title: "Empieza aquí", lessons: [] }],
    lessonCount: 0,
    priceAmountMinor: null,
    currency: "USD",
    paymentType: "one_time",
  };
  const profile: UserProfile = {
    uid: "teacher-1",
    email: null,
    displayName: "Patricia Simón",
    photoURL: null,
    roles: ["teacher"],
    onboardingCompleted: false,
    creatorVerificationStatus: "none",
    currentPlanId: "free",
    createdAt: "2026-09-01T12:00:00.000Z",
    updatedAt: "2026-09-01T12:00:00.000Z",
    lastLoginAt: "2026-09-01T12:00:00.000Z",
  };

  return {
    defaultCourse: course,
    defaultProfile: profile,
    course,
    courses: [course],
    profile,
    onCourse: null as Parameters<typeof subscribeToTeacherCourse>[1] | null,
    onCourses: null as Parameters<typeof subscribeToTeacherCourses>[1] | null,
    onProfile: null as Parameters<typeof subscribeToUserProfile>[1] | null,
    subscribeToTeacherCourse: vi.fn<typeof subscribeToTeacherCourse>(),
    subscribeToTeacherCourses: vi.fn<typeof subscribeToTeacherCourses>(),
    subscribeToUserProfile: vi.fn<typeof subscribeToUserProfile>(),
    setOwnCourseFeatured: vi.fn<typeof setOwnCourseFeatured>(),
    // The SAME object on every render: a new user per render resubscribes the
    // effects and loops.
    user: { uid: "teacher-1", displayName: "Patricia Simón", roles: ["teacher"] },
    router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
    searchParams: new URLSearchParams(),
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  usePathname: () => "/teach",
  useSearchParams: () => mocks.searchParams,
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ user: mocks.user, status: "authenticated" }),
}));

vi.mock("@/lib/data/course-deletions", () => ({
  getMyCoursesBeingDeleted: () => Promise.resolve([]),
}));

vi.mock("@/lib/data/teacher-courses", () => ({
  subscribeToTeacherCourse: mocks.subscribeToTeacherCourse,
  subscribeToTeacherCourses: mocks.subscribeToTeacherCourses,
  deleteOrArchiveCourse: vi.fn(),
  getCourseAudience: () => Promise.resolve({ enrollments: 0, orders: 0, subscriptions: 0 }),
  setOwnCourseFeatured: mocks.setOwnCourseFeatured,
}));

vi.mock("@/lib/data/user-profiles", () => ({
  claimWelcomeTour: vi.fn(async () => false),
  subscribeToUserProfile: mocks.subscribeToUserProfile,
}));

vi.mock("@/lib/data/creator-verification", () => ({
  fetchRequireCreatorVerification: () => Promise.resolve(false),
  fetchCreatorActivationBlocked: () => Promise.resolve(false),
}));

vi.mock("@/lib/data/orders", () => ({
  subscribeToTeacherOrders: (_uid: string, onData: (orders: unknown[]) => void) => {
    onData([]);
    return () => undefined;
  },
}));

vi.mock("@/lib/data/enrollments", () => ({
  getMyCourseStudents: () => Promise.resolve([]),
}));

vi.mock("@/lib/data/course-assets", () => ({
  fetchCourseAssets: () => Promise.resolve([]),
  subscribeToCourseAssets: () => () => undefined,
  syncLessonPreviewAssets: () => Promise.resolve(),
  uploadCourseAsset: vi.fn(),
}));

vi.mock("@/lib/data/course-commerce", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  subscribeToCourseCoupons: (_id: string, onData: (coupons: unknown[]) => void) => {
    onData([]);
    return () => undefined;
  },
}));

vi.mock("@/lib/data/course-reviews", () => ({
  getRecentCourseReviews: () => Promise.resolve([]),
}));

vi.mock("@/lib/data/community-posts", () => ({
  getRecentCommunityQuestions: () => Promise.resolve([]),
}));

vi.mock("@/lib/data/payout-ledger", () => ({
  subscribeToTeacherPayoutLedger: (_uid: string, onData: (entries: unknown[]) => void) => {
    onData([]);
    return () => undefined;
  },
}));

vi.mock("@/components/teacher/teacher-overview-metrics", () => ({
  TeacherOverviewMetrics: () => null,
}));

vi.mock("@/components/teacher/teacher-studio-insights", () => ({
  TeacherStudioInsights: () => null,
}));

function LanguageControls() {
  const { setLocale } = useTranslation();
  return <>
    <button type="button" onClick={() => setLocale("en")}>Use EN</button>
    <button type="button" onClick={() => setLocale("es")}>Use ES</button>
  </>;
}

function renderEs(ui: ReactElement) {
  return render(<I18nProvider initialLocale="es">
    <LanguageControls />
    {ui}
  </I18nProvider>);
}

async function changeLocale(locale: "en" | "es") {
  fireEvent.click(screen.getByRole("button", { name: `Use ${locale.toUpperCase()}` }));
  await act(async () => {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  });
}

function highlightCard(locale: "en" | "es") {
  const card = screen.getByRole("heading", {
    level: 3,
    name: locale === "es" ? "Destacado en el marketplace" : "Marketplace highlight",
  }).closest("section");
  if (!card) throw new Error("Missing marketplace highlight card");
  return within(card);
}

function expectFreeHighlight(locale: "en" | "es") {
  const card = highlightCard(locale);
  expect(card.getByText(locale === "es"
    ? "Los destacados en el marketplace requieren un plan de creador compatible."
    : "Marketplace highlights require an eligible creator plan."
  )).toBeInTheDocument();
  expect(card.queryByText(/Not included|Unlimited|\b\d+\s+(?:of|de)\s/)).not.toBeInTheDocument();
  return card;
}

function subscriptionCounts() {
  return [
    mocks.subscribeToTeacherCourse.mock.calls.length,
    mocks.subscribeToTeacherCourses.mock.calls.length,
    mocks.subscribeToUserProfile.mock.calls.length,
  ];
}

let previousHtmlLang: string | null;
let previousLocaleCookie: string | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.course = { ...mocks.defaultCourse };
  mocks.courses = [mocks.course];
  mocks.profile = { ...mocks.defaultProfile };
  mocks.searchParams = new URLSearchParams();
  mocks.onCourse = null;
  mocks.onCourses = null;
  mocks.onProfile = null;
  mocks.subscribeToTeacherCourse.mockImplementation((_id, onData) => {
    mocks.onCourse = onData;
    onData(mocks.course);
    return Object.assign(() => undefined, { reload: async () => {} });
  });
  mocks.subscribeToTeacherCourses.mockImplementation((_uid, onData) => {
    mocks.onCourses = onData;
    onData(mocks.courses);
    return Object.assign(() => undefined, { reload: async () => {} });
  });
  mocks.subscribeToUserProfile.mockImplementation((_uid, onData) => {
    mocks.onProfile = onData;
    onData(mocks.profile);
    return Object.assign(() => undefined, { reload: async () => {} });
  });
  mocks.setOwnCourseFeatured.mockReset().mockResolvedValue(undefined);
  previousHtmlLang = document.documentElement.getAttribute("lang");
  previousLocaleCookie = document.cookie.split("; ").find((cookie) =>
    cookie.startsWith(`${LOCALE_COOKIE}=`)
  );
});

afterEach(() => {
  cleanup();
  if (previousHtmlLang === null) document.documentElement.removeAttribute("lang");
  else document.documentElement.lang = previousHtmlLang;
  document.cookie = previousLocaleCookie
    ? `${previousLocaleCookie}; path=/; samesite=lax`
    : `${LOCALE_COOKIE}=; path=/; max-age=0`;
});

describe("creator panel in Spanish", () => {
  it("product panel: menu, publish list and featured placement speak Spanish", async () => {
    renderEs(<CourseManageHub courseId="course-1" />);

    const menu = await screen.findByRole("navigation", {
      name: "Secciones de gestión del curso",
    });
    expect(within(menu).getByRole("button", { name: "Enlaces de promoción" })).toBeInTheDocument();
    expect(within(menu).getByRole("button", { name: "Precios y ofertas" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Mis productos" })).toHaveAttribute(
      "href",
      "/teach/builder",
    );
    expect(screen.getByRole("heading", { name: "Lista de publicación" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Destacar este curso" })).toBeInTheDocument();
    // Course title and authored content: stays as the teacher wrote it.
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Fundamentos de facilitación",
    );
    const initialSubscriptions = subscriptionCounts();
    expectFreeHighlight("es");

    await changeLocale("en");
    expectFreeHighlight("en");
    expect(screen.getByRole("heading", {
      level: 1, name: "Fundamentos de facilitación",
    })).toBeInTheDocument();

    await changeLocale("es");
    expectFreeHighlight("es");
    expect(screen.getByRole("heading", {
      level: 1, name: "Fundamentos de facilitación",
    })).toBeInTheDocument();
    expect(subscriptionCounts()).toEqual(initialSubscriptions);
    expect(mocks.setOwnCourseFeatured).not.toHaveBeenCalled();
  });

  it("how the product is doing: the numbers and the empty state speak Spanish", async () => {
    renderEs(<CourseManageHub courseId="course-1" />);

    expect(
      await screen.findByRole("heading", { name: "Cómo va este producto" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("Todavía nadie ha comprado este producto."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver página pública" })).toHaveAttribute(
      "href",
      "/courses/course-1",
    );
    expect(screen.getByRole("link", { name: "Ver como alumno" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Revisar y publicar" }).length).toBeGreaterThan(0);
  });

  it("product list: header, columns, actions and filters speak Spanish", async () => {
    renderEs(<TeacherCourseStudio />);

    const table = await screen.findByRole("table", { name: "Productos" });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Mis productos");
    expect(screen.getByRole("link", { name: "Nuevo producto" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Producto" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Alumnos" })).toBeInTheDocument();
    expect(within(table).getByText("Pago único")).toBeInTheDocument();
    expect(within(table).getByRole("link", { name: "Abrir" })).toBeInTheDocument();
    expect(
      within(table).getByRole("button", { name: "Más acciones para Fundamentos de facilitación" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Borradores" })).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Atajos del espacio de productos" }),
    ).toBeInTheDocument();
  });

  it("creator home: next steps, products, formats and milestones speak Spanish", async () => {
    const view = renderEs(<TeacherStudioDashboard />);

    const steps = await screen.findByRole("list", { name: "Próximos pasos del creador" });
    expect(
      screen.getByRole("heading", { name: "Prepárate para tu primera venta" }),
    ).toBeInTheDocument();
    expect(within(steps).getByText("Crea un producto")).toBeInTheDocument();
    // One-time sale draft: Stripe is a publish blocker.
    // The open step brings its own button, with the same name as the step.
    expect(within(steps).getByText("Conectar Stripe", { selector: "strong" })).toBeInTheDocument();
    expect(within(steps).getByRole("link", { name: /Conectar Stripe/ })).toHaveClass("button-solid");
    expect(within(steps).getByText("Publica tu producto")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Productos en tu espacio" })).toBeInTheDocument();
    // A filter, not tabs: the segmented selector (buttons with aria-pressed).
    expect(screen.getByRole("button", { name: "Borradores" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "En venta" })).toBeInTheDocument();
    // The test looks only at the formats section: the four kinds of creation.
    const formats = screen
      .getByRole("heading", { name: "Elige un formato de producto" })
      .closest("section") as HTMLElement;
    expect(within(formats).getByRole("link", { name: /^Curso/ })).toHaveAttribute(
      "href",
      "/teach/builder?newCourse=1&format=course",
    );
    expect(within(formats).getByRole("link", { name: /Evento en vivo/ })).toHaveAttribute(
      "href",
      "/teach/builder?newCourse=1&format=live_event",
    );
    expect(within(formats).queryByRole("link", { name: /Programa guiado/ })).toBeNull();
    // The milestones repeated the step list: they are gone, before and after publish.
    expect(screen.queryByRole("heading", { name: "Hitos del creador" })).toBeNull();
    view.unmount();

    mocks.courses = [{ ...mocks.course, status: "published" }];
    renderEs(<TeacherStudioDashboard />);
    expect(await screen.findByRole("heading", { name: "Productos en tu espacio" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Hitos del creador" })).toBeNull();
  });

  it.each([
    // Full: Starter points to the plans; Pro (top of the offer) and the retired
    // Plus point to "Contact us", never to a dead end.
    { planId: "starter", planName: "Starter", limit: 1, next: "plans" },
    { planId: "pro", planName: "Pro", limit: 5, next: "contact" },
    { planId: "plus", planName: "Enterprise", limit: 5, next: "contact" },
  ] as const)("featured placements on $planName: quota and language follow the data without writes", async ({
    planId, planName, limit, next,
  }) => {
    const literalTitle = "LOCAL QA $& $$ {plan} — Autor";
    mocks.course = { ...mocks.course, title: literalTitle, status: "published", featured: false };
    mocks.courses = [mocks.course];
    mocks.profile = { ...mocks.profile, currentPlanId: planId };
    renderEs(<CourseManageHub courseId="course-1" />);

    expect(await screen.findByText(
      `0 de ${limit} destacados usados en el plan ${planName}`
    )).toBeInTheDocument();
    expect(highlightCard("es").getByRole("button", { name: "Destacar este curso" })).toBeEnabled();
    expect(screen.getByRole("heading", { level: 1, name: literalTitle })).toBeInTheDocument();
    const initialSubscriptions = subscriptionCounts();

    await changeLocale("en");
    expect(highlightCard("en").getByText(
      `0 of ${limit} highlights used on the ${planName} plan`
    )).toBeInTheDocument();
    expect(highlightCard("en").getByRole("button", { name: "Highlight this course" })).toBeEnabled();
    expect(screen.getByRole("heading", { level: 1, name: literalTitle })).toBeInTheDocument();

    const fullCourses = [mocks.course, ...Array.from({ length: limit }, (_, index) => ({
      ...mocks.course,
      id: `other-course-${index + 1}`,
      title: `LOCAL QA destaque ${index + 1}`,
      featured: true,
    }))];
    const onCourses = mocks.onCourses;
    if (!onCourses) throw new Error("Missing owner courses subscription");
    act(() => {
      mocks.courses = fullCourses;
      onCourses(fullCourses);
    });

    expect(highlightCard("en").getByText(
      `${limit} of ${limit} highlights used on the ${planName} plan`
    )).toBeInTheDocument();
    expect(highlightCard("en").getByText(
      `You're using all ${limit} highlights on your plan. Remove one from another course first.`
    )).toBeInTheDocument();
    expect(highlightCard("en").getByRole("link", { name: next === "contact" ? "Contact us for more" : "See plans" }))
      .toHaveAttribute("href", next === "contact" ? "/contact" : "/account/plans");
    expect(highlightCard("en").getByRole("button", { name: "Highlight this course" })).toBeDisabled();

    await changeLocale("es");
    expect(highlightCard("es").getByText(
      `${limit} de ${limit} destacados usados en el plan ${planName}`
    )).toBeInTheDocument();
    expect(highlightCard("es").getByText(
      `Estás usando los ${limit} destacados de tu plan. Quita uno de otro curso primero.`
    )).toBeInTheDocument();
    expect(highlightCard("es").getByRole("button", { name: "Destacar este curso" })).toBeDisabled();
    expect(screen.getByRole("heading", { level: 1, name: literalTitle })).toBeInTheDocument();
    expect(subscriptionCounts()).toEqual(initialSubscriptions);
    expect(mocks.setOwnCourseFeatured).not.toHaveBeenCalled();
  });

  it("downgrade to Free allows removing featured placement and waits for the stream during the language switch", async () => {
    const literalTitle = "LOCAL QA $& $$ {plan} — Autor";
    mocks.course = { ...mocks.course, title: literalTitle, status: "published", featured: true };
    mocks.courses = [mocks.course];
    mocks.profile = { ...mocks.profile, currentPlanId: "plus" };
    renderEs(<CourseManageHub courseId="course-1" />);

    expect(await screen.findByText("1 de 5 destacados usados en el plan Enterprise")).toBeInTheDocument();
    expect(highlightCard("es").getByRole("button", { name: "Quitar destacado" })).toBeEnabled();
    expect(screen.getByRole("heading", { level: 1, name: literalTitle })).toBeInTheDocument();
    const initialSubscriptions = subscriptionCounts();
    const onProfile = mocks.onProfile;
    if (!onProfile) throw new Error("Missing profile subscription");
    act(() => {
      mocks.profile = { ...mocks.profile, currentPlanId: "free" };
      onProfile(mocks.profile);
    });

    const freeCard = expectFreeHighlight("es");
    expect(freeCard.getByRole("button", { name: "Quitar destacado" })).toBeEnabled();
    let completeRemoval!: () => void;
    const removal = new Promise<void>((resolve) => { completeRemoval = resolve; });
    mocks.setOwnCourseFeatured.mockReturnValueOnce(removal);
    fireEvent.click(freeCard.getByRole("button", { name: "Quitar destacado" }));
    expect(mocks.setOwnCourseFeatured).toHaveBeenCalledExactlyOnceWith("course-1", false);
    expect(highlightCard("es").getByRole("button", { name: "Guardando..." })).toBeDisabled();

    await changeLocale("en");
    expectFreeHighlight("en");
    expect(highlightCard("en").getByRole("button", { name: "Saving..." })).toBeDisabled();
    expect(screen.getByRole("heading", { level: 1, name: literalTitle })).toBeInTheDocument();
    expect(mocks.setOwnCourseFeatured).toHaveBeenCalledTimes(1);

    await act(async () => {
      completeRemoval();
      await removal;
    });
    expect(highlightCard("en").getByRole("button", { name: "Remove highlight" })).toBeEnabled();
    expect(highlightCard("en").getByText("Highlighted in the marketplace")).toBeInTheDocument();
    const onCourse = mocks.onCourse;
    if (!onCourse) throw new Error("Missing course subscription");
    act(() => {
      mocks.course = { ...mocks.course, featured: false };
      // The wide list still holds the earlier flag: the individual update applies.
      onCourse(mocks.course);
    });
    expectFreeHighlight("en");
    expect(highlightCard("en").getByText("Not highlighted")).toBeInTheDocument();
    expect(highlightCard("en").getByRole("button", { name: "Highlight this course" })).toBeDisabled();

    await changeLocale("es");
    expectFreeHighlight("es");
    expect(highlightCard("es").getByText("No destacado")).toBeInTheDocument();
    expect(highlightCard("es").getByRole("button", { name: "Destacar este curso" })).toBeDisabled();
    expect(screen.getByRole("heading", { level: 1, name: literalTitle })).toBeInTheDocument();
    expect(subscriptionCounts()).toEqual(initialSubscriptions);
    expect(mocks.setOwnCourseFeatured).toHaveBeenCalledExactlyOnceWith("course-1", false);
  });

  // The database's refusal came raw, in developer English, even in Spanish.
  // Now: the house sentence with what to do; the raw text only in the collapsed part.
  it.each([
    [
      "You are using all 5 marketplace highlights included in your plan. Remove one first, or request an expansion.",
      "Estás usando todos los destacados de tu plan. Quita uno de otro curso primero.",
    ],
    ["Sign in to manage your marketplace highlights.", "Tu sesión expiró. Vuelve a iniciar sesión para gestionar tus destacados."],
    ["Only a published course can be highlighted in the marketplace.", "Solo un curso publicado puede destacarse. Publica este curso primero."],
    ["That course was not found in your account.", "Recarga la página e inténtalo de nuevo. Si continúa, contacta con soporte."],
  ])("the refusal '%s' comes out in the translated sentence, with the raw text collapsed", async (raw, sentence) => {
    mocks.course = { ...mocks.course, status: "published", featured: false };
    mocks.courses = [mocks.course];
    mocks.profile = { ...mocks.profile, currentPlanId: "pro" };
    // As supabase-js returns it: an object with message, not an Error.
    mocks.setOwnCourseFeatured.mockRejectedValueOnce({ message: raw, code: "P0001" });
    renderEs(<CourseManageHub courseId="course-1" />);

    fireEvent.click(await highlightCardButton("Destacar este curso"));
    const alert = await highlightCard("es").findByRole("alert");
    expect(alert).toHaveTextContent("No se pudo actualizar el destacado del marketplace.");
    expect(alert).toHaveTextContent(sentence);
    expect(alert).not.toHaveTextContent(raw);
    const details = highlightCard("es").getByText("Detalles para soporte").closest("details")!;
    expect(details).not.toHaveAttribute("open");
    expect(details).toHaveTextContent(raw);
  });
});

async function highlightCardButton(name: string) {
  await screen.findByRole("button", { name });
  return highlightCard("es").getByRole("button", { name });
}
vi.mock("@/lib/data/creator-plan", () => ({ fetchCreatorPlanRequired: async () => false }));
