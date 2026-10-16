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
import type { CourseEvent, CourseEventRsvp } from "@/domain/course-event";
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
  EnrolledCourseWorkspace: ({ course, enrollment }: { course: { title: string }; enrollment?: { id: string } }) => (
    <h1 data-enrollment={enrollment?.id}>{course.title}</h1>
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
  type: "live_class", status: "scheduled", startsAt: "2026-09-10T12:00:00Z",
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

  it("localizes generated community copy and searches the translated category without changing course titles", async () => {
    mocks.enrollments.mockImplementation((_uid, next) => { next([enrollment]); return () => {}; });
    show(<LearnCommunityHub />);
    expect(await screen.findByRole("heading", { name: "Comunidad de Original course $&" })).toBeVisible();
    expect(mocks.communityIds).toHaveBeenCalledExactlyOnceWith(["course-es"]);
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar en las comunidades de tus cursos" }), { target: { value: "comunidad" } });
    expect(screen.getByRole("link", { name: "Abrir comunidad" })).toHaveAttribute("href", "/learn/courses/course-es/community");
    expect(screen.getByText("1 de 1 comunidades visibles")).toBeVisible();
    changeLanguage();
    expect(screen.getByRole("searchbox", { name: "Search enrolled communities" })).toHaveValue("comunidad");
    expect(screen.getByText("No communities match this filter.")).toBeVisible();
    expect(mocks.enrollments).toHaveBeenCalledTimes(1);
  });

  it("hides the card of a course whose community is turned off", async () => {
    const quiet: Enrollment = { ...enrollment, id: "enrollment-quiet", courseId: "course-quiet", courseSlug: "course-quiet", courseTitle: "Quiet course" };
    mocks.enrollments.mockImplementation((_uid, next) => { next([enrollment, quiet]); return () => {}; });
    show(<LearnCommunityHub />);
    expect(await screen.findByRole("heading", { name: "Comunidad de Original course $&" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: /Quiet course/ })).not.toBeInTheDocument();
    expect(screen.getByText("1 de 1 comunidades visibles")).toBeVisible();
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
    expect(screen.getByText(new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" }).format(new Date(event.startsAt)))).toBeVisible();
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
    expect(screen.getByText(status === "attending" ? "Asistirás" : "No asistirás")).toBeVisible();
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
