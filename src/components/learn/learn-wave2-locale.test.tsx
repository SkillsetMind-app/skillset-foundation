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
}));
vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router, useSearchParams: () => mocks.params,
  usePathname: () => "/learn/messages",
}));
vi.mock("@/components/auth/auth-provider", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("@/lib/supabase/config", () => ({ getSupabaseClientConfig: mocks.config }));
vi.mock("@/lib/data/enrollments", () => ({ subscribeToEnrollment: mocks.enrollment, subscribeToUserEnrollments: mocks.enrollments }));
vi.mock("@/lib/data/teacher-courses", () => ({ subscribeToTeacherCourse: mocks.course }));
vi.mock("@/lib/data/published-courses", () => ({
  teacherCourseToLearningCourse: (course: unknown) => course,
  subscribeToPublishedTeacherCourses: mocks.published,
  teacherCourseToCourseCard: (course: unknown) => course,
}));
vi.mock("@/lib/data/catalog", () => ({ getFeaturedCourseCards: () => [] }));
vi.mock("@/lib/posthog/page-trackers", () => ({ CourseViewedTracker: () => null }));
vi.mock("@/components/learn/enrolled-course-workspace", () => ({
  EnrolledCourseWorkspace: ({ course }: { course: { title: string } }) => <h1>{course.title}</h1>,
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

  it("localizes generated community copy and searches the translated category without changing course titles", () => {
    mocks.enrollments.mockImplementation((_uid, next) => { next([enrollment]); return () => {}; });
    show(<LearnCommunityHub />);
    expect(screen.getByRole("heading", { name: "Comunidad de Original course $&" })).toBeVisible();
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar en las comunidades de tus cursos" }), { target: { value: "comunidad" } });
    expect(screen.getByRole("link", { name: "Abrir comunidad" })).toHaveAttribute("href", "/learn/courses/course-es/community");
    expect(screen.getByText("1 de 1 comunidades visibles")).toBeVisible();
    changeLanguage();
    expect(screen.getByRole("searchbox", { name: "Search enrolled communities" })).toHaveValue("comunidad");
    expect(screen.getByText("No communities match this filter.")).toBeVisible();
    expect(mocks.enrollments).toHaveBeenCalledTimes(1);
  });

  it("localizes event types, attendance, dates and pending RSVP without changing the request", async () => {
    mocks.enrollments.mockImplementation((_uid, next) => { next([enrollment]); return () => {}; });
    let reject!: (error: Error) => void;
    mocks.saveRsvp.mockReturnValue(new Promise((_resolve, fail) => { reject = fail; }));
    show(<LearnEventsHub />);
    expect(screen.getByRole("heading", { name: event.title })).toBeVisible();
    expect(screen.getByText(translate(getDictionary("es"), "platform.events.type.live_class"))).toBeVisible();
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
    expect(screen.getByText("1 pto para el nivel 2")).toBeVisible();
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
