import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import { CreatorCourseWorkspace } from "@/components/learn/creator-course-workspace";
import { StudentMessagesInbox } from "@/components/learn/student-messages-inbox";
import { LearnCommunityHub } from "@/components/learn/learn-community-hub";
import { LearnEventsHub } from "@/components/learn/learn-events-hub";
import { LearnerWishlist } from "@/components/learn/learner-wishlist";
import { CommunityLeaderboard } from "@/components/learn/community-leaderboard";
import type { Enrollment } from "@/domain/enrollment";
import { formatEventDateTime, type CourseEvent, type CourseEventRsvp } from "@/domain/course-event";
import type { CourseMessage } from "@/domain/course-message";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";

const mocks = vi.hoisted(() => ({
  user: { uid: "student-es" }, params: new URLSearchParams(),
  router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
  config: vi.fn(), enrollment: vi.fn(), enrollments: vi.fn(), course: vi.fn(),
  messages: vi.fn(), send: vi.fn(), events: vi.fn(), rsvp: vi.fn(), saveRsvp: vi.fn(),
  wishlist: vi.fn(), published: vi.fn(), remove: vi.fn(), leaderboard: vi.fn(),
  publicCourse: vi.fn(), signOut: vi.fn(), communityIds: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router, useSearchParams: () => mocks.params,
  usePathname: () => "/learn/messages",
}));
vi.mock("@/components/auth/auth-provider", () => ({ useAuth: () => ({ user: mocks.user, signOut: mocks.signOut }) }));
vi.mock("@/lib/supabase/config", () => ({ getSupabaseClientConfig: mocks.config }));
vi.mock("@/lib/data/enrollments", () => ({ subscribeToEnrollment: mocks.enrollment, subscribeToUserEnrollments: mocks.enrollments, getCommunityCourseIds: mocks.communityIds }));
vi.mock("@/lib/data/teacher-courses", () => ({ subscribeToTeacherCourse: mocks.course }));
vi.mock("@/lib/data/published-courses", () => ({
  teacherCourseToLearningCourse: (course: unknown) => course,
  subscribeToPublishedTeacherCourses: mocks.published,
  subscribeToViewableTeacherCourse: mocks.publicCourse,
  teacherCourseToCourseCard: (course: unknown) => course,
}));
vi.mock("@/lib/data/catalog", () => ({ getFeaturedCourseCards: () => [] }));
vi.mock("@/lib/posthog/page-trackers", () => ({
  CourseViewedTracker: () => null,
  PurchaseCompletedTracker: ({ course_id }: { course_id: string }) => (
    <i data-testid="purchase-completed-tracker" data-course={course_id} />
  ),
}));
vi.mock("@/components/learn/enrolled-course-workspace", () => ({
  EnrolledCourseWorkspace: ({ course, enrollment, focusTitleOnOpen }: { course: { title: string }; enrollment?: { id: string }; focusTitleOnOpen?: boolean }) => (
    <h1 data-enrollment={enrollment?.id} data-focus-title={String(Boolean(focusTitleOnOpen))}>{course.title}</h1>
  ),
}));
vi.mock("@/lib/data/course-messages", () => ({ subscribeToStudentMessages: mocks.messages, sendCourseMessage: mocks.send }));
vi.mock("@/lib/data/course-events", () => ({
  subscribeToCourseEvents: mocks.events, subscribeToCourseEventRsvp: mocks.rsvp, saveCourseEventRsvp: mocks.saveRsvp,
}));
vi.mock("@/lib/data/wishlist", () => ({ subscribeToUserWishlist: mocks.wishlist, toggleWishlistCourse: mocks.remove }));
vi.mock("@/lib/data/gamification", () => ({ subscribeToLeaderboard: mocks.leaderboard }));

function ChangeLanguage() {
  const { locale, setLocale } = useTranslation();
  return <button onClick={() => setLocale(locale === "es" ? "en" : "es")}>Change language</button>;
}
function show(children: ReactNode) {
  return render(<I18nProvider initialLocale="es"><ChangeLanguage />{children}</I18nProvider>);
}
function changeLanguage() { fireEvent.click(screen.getByRole("button", { name: "Change language" })); }
const enrollment: Enrollment = {
  id: "enrollment-es", userId: "student-es", courseId: "course-es", courseSlug: "course-es",
  courseTitle: "Original course $&", courseCategory: "Original category", courseImage: "",
  status: "active", source: "payment", progressPercent: 0, lastLessonId: null,
};
const event: CourseEvent = {
  id: "event-es", courseId: "course-es", courseSlug: "course-es", courseTitle: enrollment.courseTitle,
  ownerId: "teacher", title: "Original session $&", description: "Original event text",
  // Futura: sessao que ja passou vai para a parte "Past", fechada e sem presenca.
  type: "live_class", status: "scheduled", startsAt: new Date(Date.now() + 3 * 24 * 3_600_000).toISOString(),
  externalUrl: "https://example.test/live", recordingAssetId: null,
};
const message: CourseMessage = {
  id: "message-es", courseId: "course-es", courseTitle: enrollment.courseTitle,
  studentId: "student-es", studentName: "Original student", teacherId: "teacher",
  senderId: "teacher", body: "Original message $&", createdAt: "2026-09-10T12:00:00Z",
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.params = new URLSearchParams();
  mocks.config.mockReturnValue({});
  mocks.enrollment.mockImplementation((_uid, _id, next) => { next(null); return () => {}; });
  mocks.enrollments.mockImplementation((_uid, next) => { next([]); return () => {}; });
  mocks.course.mockImplementation((_id, next) => { next(null); return () => {}; });
  mocks.messages.mockImplementation((_uid, next) => { next([]); return () => {}; });
  mocks.events.mockImplementation((_id, next) => { next([event]); return () => {}; });
  mocks.rsvp.mockImplementation((_event, _uid, next) => { next(null); return () => {}; });
  mocks.wishlist.mockImplementation((_uid, next) => { next([]); return () => {}; });
  mocks.published.mockImplementation((next) => { next([]); return () => {}; });
  mocks.leaderboard.mockImplementation((_window, next) => { next(null); return () => {}; });
  mocks.publicCourse.mockImplementation((_ref, next) => { next(null); return () => {}; });
  mocks.signOut.mockResolvedValue(undefined);
  mocks.communityIds.mockResolvedValue(new Set(["course-es"]));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("learner wave 2 with real provider and dictionaries", () => {
  it("requires the coordinator to integrate both real dictionaries", () => {
    expect(translate(getDictionary("es"), "learnWave2.workspace.inactive")).toBe("El acceso al curso está inactivo.");
    expect(translate(getDictionary("en"), "learnWave2.workspace.inactive")).toBe("Course access is inactive.");
  });

  it("localizes the course selection and unavailable-backend states", () => {
    const view = show(<CreatorCourseWorkspace />);
    expect(screen.getByRole("heading", { name: "No has seleccionado un curso." })).toBeVisible();
    mocks.config.mockReturnValue(null);
    view.rerender(<I18nProvider initialLocale="es"><CreatorCourseWorkspace initialCourseId="course-es" /></I18nProvider>);
    expect(screen.getByRole("heading", { name: "El acceso a los cursos no está conectado." })).toBeVisible();
  });

  it("waits on the classroom's single loading state, with no link out of the course", () => {
    mocks.enrollment.mockImplementation(() => () => {});
    show(<CreatorCourseWorkspace initialCourseId="course-es" />);
    expect(screen.getByRole("status")).toHaveTextContent("Cargando curso...");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("whitelabel: no state links back to our marketplace", () => {
    show(<CreatorCourseWorkspace initialCourseId="course-es" whitelabel />);
    expect(screen.getByRole("heading", { name: "Necesitas una matrícula." })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Abrir catálogo" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Volver a Mi aprendizaje" })).toBeVisible();
  });

  // "Enrollment required" offered only My Learning and the marketplace: no way
  // to reach this course's page, and no way out of the wrong account. The label
  // is always "See the course": the price lives in offers, and the page shows it.
  it("without access, the main button opens the course page", () => {
    show(<CreatorCourseWorkspace initialCourseId="course-es" />);

    expect(screen.getByText("Todavía no tienes acceso a este curso.")).toBeVisible();
    expect(screen.queryByText(/espacio privado/)).not.toBeInTheDocument();
    const main = screen.getByRole("link", { name: "Ver el curso" });
    expect(main).toHaveAttribute("href", "/courses/course-es");
    expect(main).toHaveClass("button-solid");
    expect(screen.getByRole("link", { name: "Volver a Mi aprendizaje" })).toHaveClass("button-outline");
    expect(mocks.publicCourse).not.toHaveBeenCalled();
    changeLanguage();
    expect(screen.getByRole("link", { name: "See the course" })).toHaveAttribute("href", "/courses/course-es");
    expect(screen.getByText("You don't have access to this course yet.")).toBeVisible();
  });

  it("without access, signing out stays on this page, which asks to sign in again", () => {
    show(<CreatorCourseWorkspace initialCourseId="course-es" />);

    fireEvent.click(screen.getByRole("button", { name: "¿Entraste con otra cuenta? Salir" }));

    expect(mocks.signOut).toHaveBeenCalledTimes(1);
    expect(mocks.router.push).not.toHaveBeenCalled();
    expect(mocks.router.replace).not.toHaveBeenCalled();
  });

  it("hands the enrollment it already has to the classroom instead of fetching it twice", () => {
    mocks.enrollment.mockImplementation((_uid, _id, next) => { next(enrollment); return () => {}; });
    mocks.course.mockImplementation((_id, next) => { next({ id: "course-es", title: enrollment.courseTitle }); return () => {}; });
    show(<CreatorCourseWorkspace initialCourseId="course-es" />);
    expect(screen.getByRole("heading", { name: enrollment.courseTitle })).toHaveAttribute("data-enrollment", enrollment.id);
  });

  it.each(["refunded", "revoked", "expired"] as const)("localizes inactive %s without opening private content", (status) => {
    mocks.enrollment.mockImplementation((_uid, _id, next) => { next({ ...enrollment, status }); return () => {}; });
    show(<CreatorCourseWorkspace initialCourseId="course-es" />);
    expect(screen.getByRole("heading", { name: "El acceso al curso está inactivo." })).toBeVisible();
    expect(screen.getByText(new RegExp({ refunded: "reembolsada", revoked: "revocada", expired: "vencida" }[status]))).toBeVisible();
    expect(mocks.course).not.toHaveBeenCalled();
    changeLanguage();
    expect(screen.getByRole("heading", { name: "Course access is inactive." })).toBeVisible();
    expect(mocks.enrollment).toHaveBeenCalledTimes(1);
  });

  // Reembolsada, cancelada, vencida ou em atraso: também não pode ser beco.
  it("an inactive enrollment still offers the course page and a way out of the wrong account", () => {
    mocks.enrollment.mockImplementation((_uid, _id, next) => { next({ ...enrollment, status: "refunded" }); return () => {}; });
    show(<CreatorCourseWorkspace initialCourseId="course-es" />);

    expect(screen.getByRole("link", { name: "Ver el curso" })).toHaveAttribute("href", "/courses/course-es");
    fireEvent.click(screen.getByRole("button", { name: "¿Entraste con otra cuenta? Salir" }));
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
  });

  it("changes checkout waiting copy at 90 seconds and keeps polling for actual enrollment", () => {
    vi.useFakeTimers();
    mocks.params = new URLSearchParams("checkout=success");
    show(<CreatorCourseWorkspace initialCourseId="course-es" />);
    expect(screen.getByRole("heading", { name: "Pago recibido: abriendo tu curso..." })).toBeVisible();
    act(() => { vi.advanceTimersByTime(90_000); });
    expect(screen.getByRole("heading", { name: "Ya casi está: la matrícula está tardando más de lo habitual." })).toBeVisible();
    changeLanguage();
    expect(screen.getByRole("heading", { name: "Almost there — enrollment is taking longer than usual." })).toBeVisible();
    mocks.enrollment.mockImplementation((_uid, _id, next) => { next(enrollment); return () => {}; });
    mocks.course.mockImplementation((_id, next) => { next({ title: enrollment.courseTitle }); return () => {}; });
    act(() => { vi.advanceTimersByTime(20_000); });
    expect(screen.getByRole("heading", { name: enrollment.courseTitle })).toBeVisible();
  });

  // PURCHASE_COMPLETED is wired only where Stripe's success_url lands AND the
  // paid enrollment has opened the course: an ordinary visit never counts a sale.
  it("mounts the purchase tracker only after a checkout return opens the course, then drops the marker", () => {
    mocks.enrollment.mockImplementation((_uid, _id, next) => { next(enrollment); return () => {}; });
    mocks.course.mockImplementation((_id, next) => { next({ id: "course-es", title: enrollment.courseTitle }); return () => {}; });
    const visit = show(<CreatorCourseWorkspace initialCourseId="course-es" />);
    expect(screen.getByRole("heading", { name: enrollment.courseTitle })).toBeVisible();
    expect(screen.queryByTestId("purchase-completed-tracker")).toBeNull();
    expect(mocks.router.replace).not.toHaveBeenCalled();
    visit.unmount();

    mocks.params = new URLSearchParams("checkout=success&lesson=l3");
    show(<CreatorCourseWorkspace initialCourseId="course-es" />);
    expect(screen.getByTestId("purchase-completed-tracker")).toHaveAttribute("data-course", "course-es");
    // The paid course is open, so the checkout marker goes (the lesson stays).
    // Left in the URL it rode into lesson links, bookmarks and new tabs, and
    // every reopen counted another sale.
    expect(mocks.router.replace).toHaveBeenCalledTimes(1);
    const [url] = mocks.router.replace.mock.calls[0];
    expect(url).toMatch(/lesson=l3/);
    expect(url).not.toMatch(/checkout/);
  });

  it("relocalizes a retained enrollment error without resubscribing", () => {
    mocks.enrollment.mockImplementation((_uid, _id, _next, fail) => { fail(new Error("Internal transport detail")); return () => {}; });
    show(<CreatorCourseWorkspace initialCourseId="course-es" />);
    expect(screen.getByText("No pudimos confirmar tu matrícula en este curso.")).toBeVisible();
    changeLanguage();
    expect(screen.getByText("We could not confirm your enrollment for this creator course.")).toBeVisible();
    expect(mocks.enrollment).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Internal transport detail")).not.toBeInTheDocument();
  });

  it("opens the paid course when an enrollment retry recovers from a transient error", () => {
    vi.useFakeTimers();
    mocks.params = new URLSearchParams("checkout=success");
    mocks.enrollment
      .mockImplementationOnce((_uid, _id, _next, fail) => {
        fail(new Error("Temporary failure"));
        return () => {};
      })
      .mockImplementation((_uid, _id, next) => { next(enrollment); return () => {}; });
    mocks.course.mockImplementation((_id, next) => {
      next({ id: "course-es", title: enrollment.courseTitle });
      return () => {};
    });
    show(<CreatorCourseWorkspace initialCourseId="course-es" />);
    expect(screen.getByText("No pudimos confirmar tu matrícula en este curso.")).toBeVisible();

    act(() => { vi.advanceTimersByTime(5_000); });

    expect(screen.getByRole("heading", { name: enrollment.courseTitle })).toBeVisible();
    expect(screen.getByTestId("purchase-completed-tracker")).toBeInTheDocument();
    expect(mocks.router.replace).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(20_000); });
    expect(mocks.enrollment).toHaveBeenCalledTimes(2);
  });

  it("opens the course when its content subscription recovers from a transient error", () => {
    mocks.enrollment.mockImplementation((_uid, _id, next) => { next(enrollment); return () => {}; });
    mocks.course.mockImplementation((_id, _next, fail) => {
      fail(new Error("Temporary failure"));
      return () => {};
    });
    show(<CreatorCourseWorkspace initialCourseId="course-es" />);
    expect(screen.queryByRole("heading", { name: enrollment.courseTitle })).not.toBeInTheDocument();

    act(() => {
      mocks.course.mock.calls[0][1]({ id: "course-es", title: enrollment.courseTitle });
    });

    expect(screen.getByRole("heading", { name: enrollment.courseTitle })).toBeVisible();
  });

  it("a successful course read cannot clear an unresolved enrollment error", () => {
    mocks.enrollment.mockImplementation((_uid, _id, next) => { next(enrollment); return () => {}; });
    mocks.course.mockImplementation(() => () => {});
    show(<CreatorCourseWorkspace initialCourseId="course-es" />);

    act(() => { mocks.enrollment.mock.calls[0][3](new Error("Enrollment unavailable")); });
    act(() => {
      mocks.course.mock.calls[0][1]({ id: "course-es", title: enrollment.courseTitle });
    });

    expect(screen.getByText("No pudimos confirmar tu matrícula en este curso.")).toBeVisible();
    expect(screen.queryByRole("heading", { name: enrollment.courseTitle })).not.toBeInTheDocument();
    expect(screen.queryByTestId("purchase-completed-tracker")).not.toBeInTheDocument();
  });

  it("a successful enrollment read cannot clear an unresolved course error", () => {
    mocks.enrollment.mockImplementation((_uid, _id, next) => { next(enrollment); return () => {}; });
    mocks.course.mockImplementation((_id, _next, fail) => {
      fail(new Error("Course unavailable"));
      return () => {};
    });
    show(<CreatorCourseWorkspace initialCourseId="course-es" />);
    const courseError = translate(getDictionary("es"), "learnWave2.workspace.courseError");
    expect(screen.getByText(courseError)).toBeVisible();

    act(() => { mocks.enrollment.mock.calls[0][2](enrollment); });

    expect(screen.getByText(courseError)).toBeVisible();
    expect(screen.queryByRole("heading", { name: enrollment.courseTitle })).not.toBeInTheDocument();
  });

  it("falha ao ler a matrícula: \"Try again\" refaz a mesma leitura uma vez, com a espera da sala, e abre o curso", async () => {
    mocks.enrollment
      .mockImplementationOnce((_uid, _id, _next, fail) => { fail(new Error("Temporary failure")); return () => {}; })
      .mockImplementation(() => () => {});
    mocks.course.mockImplementation((_id, next) => { next({ id: "course-es", title: enrollment.courseTitle }); return () => {}; });
    show(<CreatorCourseWorkspace initialCourseId="course-es" />);
    expect(screen.getByText("No pudimos confirmar tu matrícula en este curso.")).toBeVisible();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: translate(getDictionary("es"), "appErrors.retry") }));
    });

    // A mesma leitura, uma vez a mais; enquanto ela corre, só a espera (nada para clicar).
    expect(mocks.enrollment).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("status")).toHaveTextContent(translate(getDictionary("es"), "learnWave2.courseLoading.title"));
    expect(screen.queryByRole("button", { name: translate(getDictionary("es"), "appErrors.retry") })).not.toBeInTheDocument();

    act(() => { mocks.enrollment.mock.calls[1][2](enrollment); });

    const title = screen.getByRole("heading", { name: enrollment.courseTitle });
    expect(title).toHaveAttribute("data-focus-title", "true");
    expect(mocks.enrollment).toHaveBeenCalledTimes(2);
    expect(mocks.course).toHaveBeenCalledTimes(1);

    // A sala fecha (a matrícula deixa de abrir) e reabre sem "Try again": o
    // pedido de foco já foi usado e não volta.
    act(() => { mocks.enrollment.mock.calls[1][2]({ ...enrollment, status: "expired" }); });
    act(() => { mocks.enrollment.mock.calls[1][2](enrollment); });
    expect(screen.getByRole("heading", { name: enrollment.courseTitle })).toHaveAttribute("data-focus-title", "false");
  });

  it("falha ao ler o curso: \"Try again\" refaz só a leitura do curso e abre a sala", async () => {
    mocks.enrollment.mockImplementation((_uid, _id, next) => { next(enrollment); return () => {}; });
    mocks.course
      .mockImplementationOnce((_id, _next, fail) => { fail(new Error("Course unavailable")); return () => {}; })
      .mockImplementation((_id, next) => { next({ id: "course-es", title: enrollment.courseTitle }); return () => {}; });
    show(<CreatorCourseWorkspace initialCourseId="course-es" />);
    expect(screen.getByText(translate(getDictionary("es"), "learnWave2.workspace.courseError"))).toBeVisible();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: translate(getDictionary("es"), "appErrors.retry") }));
    });

    expect(mocks.course).toHaveBeenCalledTimes(2);
    expect(mocks.enrollment).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { name: enrollment.courseTitle })).toHaveAttribute("data-focus-title", "true");
  });

  it("sem acesso, sem matrícula ativa ou sem curso: nenhum \"Try again\"", () => {
    const retry = translate(getDictionary("es"), "appErrors.retry");
    const noEnrollment = show(<CreatorCourseWorkspace initialCourseId="course-es" />);
    expect(screen.getByRole("heading", { name: translate(getDictionary("es"), "learnWave2.workspace.required") })).toBeVisible();
    expect(screen.queryByRole("button", { name: retry })).not.toBeInTheDocument();
    noEnrollment.unmount();

    mocks.enrollment.mockImplementation((_uid, _id, next) => { next({ ...enrollment, status: "refunded" }); return () => {}; });
    const inactive = show(<CreatorCourseWorkspace initialCourseId="course-es" />);
    expect(screen.getByRole("heading", { name: translate(getDictionary("es"), "learnWave2.workspace.inactive") })).toBeVisible();
    expect(screen.queryByRole("button", { name: retry })).not.toBeInTheDocument();
    inactive.unmount();

    mocks.enrollment.mockImplementation((_uid, _id, next) => { next(enrollment); return () => {}; });
    show(<CreatorCourseWorkspace initialCourseId="course-es" />);
    expect(screen.getByRole("heading", { name: translate(getDictionary("es"), "learnWave2.workspace.missing") })).toBeVisible();
    expect(screen.queryByRole("button", { name: retry })).not.toBeInTheDocument();
  });

  it("preserves authored messages, ARIA interpolation and draft during pending send and errors", async () => {
    mocks.params = new URLSearchParams("course=course-es");
    mocks.messages.mockImplementation((_uid, next) => { next([message]); return () => {}; });
    let reject!: (error: Error) => void;
    mocks.send.mockReturnValue(new Promise((_resolve, rejectSend) => { reject = rejectSend; }));
    show(<StudentMessagesInbox />);
    const region = screen.getByRole("region", { name: "Conversación: Original course $&" });
    expect(within(region).getByText(message.body)).toBeVisible();
    fireEvent.change(screen.getByRole("textbox", { name: "Tu mensaje" }), { target: { value: "Untranslated draft $&" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    expect(screen.getByRole("button", { name: "Enviando..." })).toBeDisabled();
    expect(mocks.send).toHaveBeenCalledWith({ courseId: "course-es", studentId: "student-es", body: "Untranslated draft $&" });
    changeLanguage();
    expect(screen.getByRole("button", { name: "Sending..." })).toBeDisabled();
    await act(async () => { reject(new Error("Internal transport detail")); });
    expect(screen.getByRole("alert")).toHaveTextContent("We could not send your message. Try again.");
    changeLanguage();
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos enviar tu mensaje. Inténtalo de nuevo.");
    expect(screen.getByRole("textbox", { name: "Tu mensaje" })).toHaveValue("Untranslated draft $&");
    expect(mocks.messages).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Internal transport detail")).not.toBeInTheDocument();
  });

  it("localizes generated community copy without changing course titles; one community has no search box", async () => {
    mocks.enrollments.mockImplementation((_uid, next) => { next([enrollment]); return () => {}; });
    show(<LearnCommunityHub />);
    expect(await screen.findByRole("heading", { name: "Comunidad de Original course $&" })).toBeVisible();
    // O cartão é o curso e a entrada: sem as quatro linhas iguais em todo cartão.
    expect(screen.getByRole("article").textContent).toBe("Comunidad de Original course $&Abrir comunidad");
    expect(mocks.communityIds).toHaveBeenCalledExactlyOnceWith(["course-es"]);
    expect(screen.getByRole("link", { name: "Abrir comunidad" })).toHaveAttribute("href", "/learn/courses/course-es/community");
    // Uma comunidade cabe na tela: a busca (um cartão inteiro) só aparece a partir de 3.
    expect(screen.queryByRole("searchbox")).toBeNull();
  });

  it("from 3 communities, searches the translated category and keeps the query across languages", async () => {
    const many = Array.from({ length: 3 }, (_, index) => ({
      ...enrollment, id: `enrollment-${index}`, courseId: `course-${index}`, courseSlug: `course-${index}`, courseTitle: `Course ${index} $&`,
    }));
    mocks.communityIds.mockResolvedValue(new Set(many.map((row) => row.courseId)));
    mocks.enrollments.mockImplementation((_uid, next) => { next(many); return () => {}; });
    show(<LearnCommunityHub />);
    expect(await screen.findByRole("heading", { name: "Comunidad de Course 0 $&" })).toBeVisible();
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar en las comunidades de tus cursos" }), { target: { value: "comunidad" } });
    expect(screen.getAllByRole("link", { name: "Abrir comunidad" })).toHaveLength(3);
    expect(screen.getByText("3 de 3 comunidades visibles")).toBeVisible();
    changeLanguage();
    expect(screen.getByRole("searchbox", { name: "Search enrolled communities" })).toHaveValue("comunidad");
    expect(screen.getByText("No communities match this filter.")).toBeVisible();
    expect(mocks.enrollments).toHaveBeenCalledTimes(1);
  });

  // Com a busca digitada e a lista caindo para 2, a caixa some: o texto não
  // pode seguir filtrando, senão o aluno fica em "nenhuma comunidade" sem ter
  // onde limpar.
  it("a busca escondida não filtra: caindo para 2 comunidades, as duas aparecem", async () => {
    const many = Array.from({ length: 3 }, (_, index) => ({
      ...enrollment, id: `enrollment-${index}`, courseId: `course-${index}`, courseSlug: `course-${index}`, courseTitle: `Course ${index} $&`,
    }));
    mocks.communityIds.mockResolvedValue(new Set(many.map((row) => row.courseId)));
    let deliver!: (rows: Enrollment[]) => void;
    mocks.enrollments.mockImplementation((_uid, next) => { deliver = next; next(many); return () => {}; });
    show(<LearnCommunityHub />);
    expect(await screen.findByRole("heading", { name: "Comunidad de Course 0 $&" })).toBeVisible();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "nada parecido" } });
    expect(screen.queryAllByRole("article")).toHaveLength(0);
    await act(async () => { deliver(many.slice(0, 2)); });
    expect(await screen.findAllByRole("article")).toHaveLength(2);
    expect(screen.queryByRole("searchbox")).toBeNull();
  });

  it("se as comunidades não carregam, 'Intentar de nuevo' lê de novo sem religar o canal", async () => {
    const reload = vi.fn();
    mocks.enrollments.mockImplementation((_uid, next) => {
      next([enrollment]);
      return Object.assign(() => {}, { reload: async () => { reload(); next([enrollment]); } });
    });
    mocks.communityIds.mockRejectedValueOnce(new Error("offline"));
    show(<LearnCommunityHub />);
    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos cargar las comunidades de tus cursos.");
    fireEvent.click(screen.getByRole("button", { name: "Intentar de nuevo" }));
    expect(await screen.findByRole("heading", { name: "Comunidad de Original course $&" })).toBeVisible();
    expect(reload).toHaveBeenCalledOnce();
    expect(mocks.enrollments).toHaveBeenCalledTimes(1);
    expect(mocks.communityIds).toHaveBeenCalledTimes(2);
  });

  it("hides the card of a course whose community is turned off", async () => {
    const quiet: Enrollment = { ...enrollment, id: "enrollment-quiet", courseId: "course-quiet", courseSlug: "course-quiet", courseTitle: "Quiet course" };
    mocks.enrollments.mockImplementation((_uid, next) => { next([enrollment, quiet]); return () => {}; });
    show(<LearnCommunityHub />);
    expect(await screen.findByRole("heading", { name: "Comunidad de Original course $&" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: /Quiet course/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(mocks.communityIds).toHaveBeenCalledExactlyOnceWith(["course-es", "course-quiet"]);
  });

  it("localizes event types, attendance, dates and pending RSVP without changing the request", async () => {
    mocks.enrollments.mockImplementation((_uid, next) => { next([enrollment]); return () => {}; });
    let reject!: (error: Error) => void;
    mocks.saveRsvp.mockReturnValue(new Promise((_resolve, fail) => { reject = fail; }));
    show(<LearnEventsHub />);
    expect(screen.getByRole("heading", { name: event.title })).toBeVisible();
    expect(screen.getByText("Clase en vivo")).toBeVisible();
    expect(screen.getByText("Programada")).toBeVisible();
    expect(screen.getByText(formatEventDateTime(event.startsAt, "es"))).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Asistiré" }));
    expect(mocks.saveRsvp).toHaveBeenCalledWith({ eventId: event.id, courseSlug: event.courseSlug, status: "attending", user: mocks.user });
    expect(screen.getByRole("button", { name: "Guardando..." })).toBeDisabled();
    changeLanguage();
    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
    await act(async () => { reject(new Error("Internal detail")); });
    expect(screen.getByRole("alert")).toHaveTextContent("We could not save your RSVP.");
    changeLanguage();
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos guardar tu confirmación de asistencia.");
    expect(mocks.events).toHaveBeenCalledTimes(1);
  });

  it.each(["attending", "not_attending"] as CourseEventRsvp["status"][])("localizes saved attendance %s", (status) => {
    mocks.enrollments.mockImplementation((_uid, next) => { next([enrollment]); return () => {}; });
    mocks.rsvp.mockImplementation((_event, _uid, next) => { next({ status }); return () => {}; });
    show(<LearnEventsHub />);
    // A resposta salva aparece no proprio botao (aria-pressed), nao num quadro de texto.
    expect(screen.getByRole("button", { name: "Asistiré" })).toHaveAttribute("aria-pressed", String(status === "attending"));
    expect(screen.getByRole("button", { name: "No puedo asistir" })).toHaveAttribute("aria-pressed", String(status === "not_attending"));
    expect(screen.getByRole("link", { name: "Unirse a la sesión externa" })).toHaveAttribute("href", event.externalUrl);
  });

  it("localizes removal of an unavailable saved course and keeps IDs intact", async () => {
    mocks.wishlist.mockImplementation((_uid, next) => { next([{ id: "saved", courseId: "course-es", courseSlug: "course-es" }]); return () => {}; });
    mocks.remove.mockRejectedValue(new Error("Internal detail"));
    show(<LearnerWishlist />);
    expect(screen.getByRole("heading", { name: "Curso guardado no disponible." })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Quitar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo actualizar tu lista de favoritos. Inténtalo de nuevo.");
    expect(mocks.remove).toHaveBeenCalledWith({ userId: "student-es", courseId: "course-es", courseSlug: "course-es" });
    changeLanguage();
    expect(screen.getByRole("alert")).toHaveTextContent("Could not update your wishlist. Please try again.");
  });

  // A falha de leitura era um beco: "Try again" relê pelo mesmo canal, trava
  // enquanto lê, e o vazio não aparece junto do erro.
  it("a falha da lista de desejos oferece Try again, que relê sem reinscrever", async () => {
    const reload = vi.fn(async () => undefined);
    let next: (items: unknown[]) => void = () => {};
    mocks.wishlist.mockImplementation((_uid, onData, onError) => {
      next = onData;
      onError(new Error("network"));
      return Object.assign(() => {}, { reload });
    });
    show(<LearnerWishlist />);

    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos cargar tus cursos guardados.");
    expect(screen.queryByRole("heading", { name: "Elige tus favoritos antes de matricularte." })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Intentar de nuevo" }));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(mocks.wishlist).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Intentando de nuevo..." })).toBeDisabled();
    expect(screen.getByRole("alert")).toBeInTheDocument();

    await act(async () => next([{ id: "saved", courseId: "course-es", courseSlug: "course-es" }]));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Curso guardado no disponible." })).toBeVisible();
    // O botão sumiu: o foco ficou na moldura da lista, não no <body>.
    expect(document.activeElement).toHaveAttribute("tabindex", "-1");
  });

  it("localizes leaderboard windows, singular progress and badge tooltip without changing the selected window", () => {
    mocks.leaderboard.mockImplementation((window, next) => {
      next({ window, entries: [{ rank: 1, displayName: "Original member $&", level: 3, points: 20 }] });
      return () => {};
    });
    show(<CommunityLeaderboard currentUserStats={{ uid: "student-es", displayName: "Me", level: 1, points: 4, totalLikesReceived: 4 }} />);
    expect(screen.getByText("Original member $&")).toBeVisible();
    expect(screen.getByText("1 punto para el nivel 2")).toBeVisible();
    expect(screen.getByRole("progressbar", { name: "Nivel 1, 80% hacia el nivel 2" })).toHaveAttribute("aria-valuenow", "80");
    expect(screen.getByTitle("Nivel 3: obtenido por los Me gusta en publicaciones de la comunidad")).toHaveTextContent("Nv 3");
    fireEvent.click(screen.getByRole("button", { name: "Este mes" }));
    expect(mocks.leaderboard.mock.lastCall?.[0]).toBe("30d");
    changeLanguage();
    expect(screen.getByText("1 pt to Level 2")).toBeVisible();
    expect(mocks.leaderboard).toHaveBeenCalledTimes(2);
  });

  // F-03 / F-11: a espera tem a forma das linhas; a falha não diz "vazio" e tem saída.
  it("leaderboard waits with row shapes, and a failed read offers Try again", () => {
    let fail!: (error: Error) => void;
    mocks.leaderboard.mockImplementationOnce((_window, _next, onError) => { fail = onError; return () => {}; });
    show(<CommunityLeaderboard currentUserStats={null} />);
    expect(screen.getByRole("status")).toHaveTextContent("Cargando clasificación...");

    act(() => fail(new Error("offline")));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(/Todavía no hay puntos/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Intentar de nuevo" }));
    expect(mocks.leaderboard).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each([
    ["community", "La comunidad se abre después de matricularte."],
    ["events", "Los eventos se abren después de matricularte."],
    ["wishlist", "Elige tus favoritos antes de matricularte."],
    ["messages", "Todavía no hay conversaciones"],
  ])("localizes the empty %s surface", (kind, heading) => {
    show(kind === "community" ? <LearnCommunityHub /> : kind === "events" ? <LearnEventsHub /> : kind === "wishlist" ? <LearnerWishlist /> : <StudentMessagesInbox />);
    expect(screen.getByRole("heading", { name: heading })).toBeVisible();
  });
});

describe("agenda do aluno: erro de leitura", () => {
  // A falha das matrículas era um beco; o "Try again" relê pelo mesmo canal.
  it("a falha das matrículas oferece Try again, e a agenda volta sem reinscrever", () => {
    const reload = vi.fn(async () => undefined);
    let next: (rows: Enrollment[]) => void = () => {};
    mocks.enrollments.mockImplementation((_uid, onData, onError) => {
      next = onData;
      onError(new Error("network"));
      return Object.assign(() => {}, { reload });
    });
    show(<LearnEventsHub />);

    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos cargar los cursos en los que estás matriculado.");
    fireEvent.click(screen.getByRole("button", { name: "Intentar de nuevo" }));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(mocks.enrollments).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // O botão some com o clique: o foco fica na moldura da agenda, não no <body>.
    const frame = document.activeElement as HTMLElement;
    expect(frame).not.toBe(document.body);
    expect(frame).toHaveAttribute("tabindex", "-1");

    act(() => next([enrollment]));
    expect(screen.getByRole("heading", { name: event.title })).toBeVisible();
    expect(document.activeElement).toBe(frame);
    expect(frame).toContainElement(screen.getByRole("heading", { name: event.title }));
  });

  // As agendas agora têm releitura: "Try again" relê só a agenda que falhou,
  // e até a resposta vale o "carregando", nunca a agenda vazia.
  it("a falha de uma agenda oferece Try again, que relê só aquela agenda", () => {
    const enrollmentsReload = vi.fn(async () => undefined);
    const eventsReload = vi.fn(async () => undefined);
    let deliver: (events: CourseEvent[]) => void = () => {};
    mocks.enrollments.mockImplementation((_uid, next) => {
      next([enrollment]);
      return Object.assign(() => {}, { reload: enrollmentsReload });
    });
    mocks.events.mockImplementation((_slug, next, onError) => {
      deliver = next;
      onError(new Error("network"));
      return Object.assign(() => {}, { reload: eventsReload });
    });
    show(<LearnEventsHub />);

    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos cargar una o más agendas de los cursos.");
    fireEvent.click(screen.getByRole("button", { name: "Intentar de nuevo" }));
    expect(eventsReload).toHaveBeenCalledTimes(1);
    expect(enrollmentsReload).not.toHaveBeenCalled();
    expect(mocks.events).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("Todavía no hay sesiones en vivo programadas.")).not.toBeInTheDocument();
    expect(document.activeElement).toHaveTextContent("Cargando tu agenda de eventos...");

    act(() => deliver([event]));
    expect(screen.getByRole("heading", { name: event.title })).toBeVisible();
  });
});
