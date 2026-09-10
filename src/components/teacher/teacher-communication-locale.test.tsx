import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import { TeacherMessagesInbox } from "@/components/teacher/teacher-messages-inbox";
import { TeacherCommunityInbox } from "@/components/teacher/teacher-community-inbox";
import type { CourseMessage } from "@/domain/course-message";
import type { CommunityPost, CommunityComment } from "@/domain/community-post";
import { sendCourseMessage } from "@/lib/data/course-messages";
import { createCommunityComment, createCommunityPost, setCommunityPostAcceptedAnswer, setCommunityPostPinned } from "@/lib/data/community-posts";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";

const NOW = Date.parse("2026-09-10T12:00:00Z");
const state = vi.hoisted(() => ({
  user: { uid: "teacher", displayName: "Teacher $&", email: "teacher@example.test", roles: ["teacher"] },
  messages: [] as CourseMessage[], posts: [] as CommunityPost[], comments: [] as CommunityComment[],
  messagesError: false, courseError: false, postsError: false,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/auth/auth-provider", () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock("@/lib/data/course-messages", () => ({
  sendCourseMessage: vi.fn(),
  subscribeToTeacherMessages: vi.fn((_uid, next, error) => {
    if (state.messagesError) error(new Error("Raw load failure")); else next(state.messages);
    return vi.fn();
  }),
}));
vi.mock("@/lib/data/teacher-courses", () => ({
  subscribeToTeacherCourse: vi.fn((_id, next, error) => {
    if (state.courseError) error(new Error("Raw course failure"));
    else next({ id: "course/$&", ownerId: "teacher", title: "Original course $&", enrollmentCount: 12345 });
    return vi.fn();
  }),
}));
vi.mock("@/lib/data/community-posts", () => ({
  subscribeToCommunityPosts: vi.fn((_id, next, error) => {
    if (state.postsError) error(new Error("Raw posts failure")); else next(state.posts);
    return vi.fn();
  }),
  subscribeToCourseCommunityComments: vi.fn((_id, next) => { next(state.comments); return vi.fn(); }),
  createCommunityComment: vi.fn(), createCommunityPost: vi.fn(),
  setCommunityPostAcceptedAnswer: vi.fn(), setCommunityPostPinned: vi.fn(),
}));
function Language() {
  const { setLocale } = useTranslation();
  return <><button onClick={() => setLocale("en")}>EN</button><button onClick={() => setLocale("es")}>ES</button></>;
}
function mount(children: ReactNode, locale: "en" | "es" = "es") {
  return render(<I18nProvider initialLocale={locale}><Language />{children}</I18nProvider>);
}
const message: CourseMessage = {
  id: "message", courseId: "course/$&", courseTitle: "Original course $&",
  studentId: "student", studentName: "Student $&", teacherId: "teacher", senderId: "teacher",
  body: "Original message $&", createdAt: new Date(NOW - 300000).toISOString(),
};
const question: CommunityPost = {
  id: "question", courseSlug: "course/$&", authorId: "student", authorName: "Student $&",
  authorRole: "student", category: "question", title: "Original question $&",
  body: "Original body", createdAt: new Date(NOW - 48 * 3600000).toISOString(),
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  state.messages = []; state.posts = []; state.comments = [];
  state.messagesError = false; state.courseError = false; state.postsError = false;
  vi.mocked(sendCourseMessage).mockResolvedValue({ success: true, messageId: "new" });
  vi.mocked(createCommunityComment).mockResolvedValue({ id: "answer" });
  vi.mocked(createCommunityPost).mockResolvedValue({ id: "update" });
  vi.mocked(setCommunityPostAcceptedAnswer).mockResolvedValue(undefined);
  vi.mocked(setCommunityPostPinned).mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("ES-11 communication with real locale state", () => {
  it("requires both real communication dictionaries", () => {
    expect(translate(getDictionary("es"), "teacherMessages.send")).toBe("Enviar respuesta");
    expect(translate(getDictionary("es"), "teacherCommunity.title")).toBe("Comunidad");
  });

  it("localizes empty inbox and relocalizes its load error", () => {
    state.messagesError = true;
    mount(<TeacherMessagesInbox />);
    expect(screen.getByText("Aún no hay mensajes de alumnos")).toBeInTheDocument();
    expect(screen.getByText("No pudimos cargar los mensajes de tus alumnos.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "EN" }));
    expect(screen.getByText("We could not load your student messages.")).toBeInTheDocument();
  });

  it("preserves names, message, draft, payload and pending state when language changes", async () => {
    state.messages = [message];
    let reject!: (reason: Error) => void;
    vi.mocked(sendCourseMessage).mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    mount(<TeacherMessagesInbox />, "en");
    const composer = screen.getByRole("textbox", { name: "Reply to Student $&..." });
    fireEvent.change(composer, { target: { value: "Reply draft $&" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));
    fireEvent.click(screen.getByRole("button", { name: "ES" }));
    expect(screen.getByRole("navigation", { name: "Conversaciones con alumnos" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Responder a Student $&..." })).toHaveValue("Reply draft $&");
    expect(screen.getByRole("button", { name: "Enviando..." })).toBeDisabled();
    expect(screen.getByText(/Tú · Hace 5 min/)).toBeInTheDocument();
    expect(screen.getAllByText("Original message $&")).toHaveLength(2);
    expect(sendCourseMessage).toHaveBeenCalledWith({ courseId: "course/$&", studentId: "student", body: "Reply draft $&" });
    await act(async () => reject(new Error("Internal send failure")));
    expect(screen.getByText("No pudimos enviar tu respuesta. Inténtalo de nuevo.")).toBeInTheDocument();
    expect(screen.queryByText("Internal send failure")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "EN" }));
    expect(screen.getByText("We could not send your reply. Try again.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));
    await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue(""));
  });

  it("explains an inactive enrollment instead of asking to try again", async () => {
    state.messages = [message];
    vi.mocked(sendCourseMessage).mockRejectedValueOnce(new Error("This enrollment cannot send messages."));
    mount(<TeacherMessagesInbox />);
    fireEvent.change(screen.getByRole("textbox", { name: "Responder a Student $&..." }), { target: { value: "Reply" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar respuesta" }));
    expect(await screen.findByText("Esta inscripción no permite enviar mensajes.")).toBeInTheDocument();
    expect(screen.queryByText("No pudimos enviar tu respuesta. Inténtalo de nuevo.")).not.toBeInTheDocument();
  });

  it("localizes community queue, waiting duration, counts, reply form and accepted-answer action", async () => {
    state.posts = [question];
    state.comments = [{
      id: "student-reply", postId: question.id, courseSlug: question.courseSlug,
      authorId: "other", authorName: "Other student", authorRole: "student",
      body: "Original reply", createdAt: new Date(NOW - 300000).toISOString(),
    }];
    mount(<TeacherCommunityInbox courseId="course/$&" />);
    const queue = await screen.findByRole("region", { name: /Esperando respuesta/ });
    expect(screen.getByRole("link", { name: "Volver a Original course $&" }))
      .toHaveAttribute("href", "/teach/courses/course%2F%24%26/manage");
    expect(screen.getByText(/12\.345 miembros/)).toBeInTheDocument();
    expect(screen.getByText("1 publicación")).toBeInTheDocument();
    expect(within(queue).getByText("esperando 2 días")).toHaveClass("font-bold");
    expect(within(queue).getByText(/1 respuesta de alumnos hasta ahora/)).toHaveTextContent("Hace 5 min");
    fireEvent.click(within(queue).getByRole("button", { name: "Responder" }));
    fireEvent.change(screen.getByLabelText("Tu respuesta"), { target: { value: "Authored answer $&" } });
    fireEvent.click(screen.getByRole("button", { name: "EN" }));
    expect(screen.getByLabelText("Your answer")).toHaveValue("Authored answer $&");
    fireEvent.click(screen.getByRole("button", { name: "Post answer" }));
    await waitFor(() => expect(setCommunityPostAcceptedAnswer).toHaveBeenCalledWith("question", "answer"));
    expect(createCommunityComment).toHaveBeenCalledWith(expect.objectContaining({
      postId: "question", courseSlug: "course/$&", body: "Authored answer $&",
    }));
  });

  it.each([
    [30000, "esperando 1 min"], [3600000, "esperando 1 hora"],
    [5 * 3600000, "esperando 5 horas"], [24 * 3600000, "esperando 1 día"],
  ])("formats wait %s in the selected language", async (age, expected) => {
    state.posts = [{ ...question, createdAt: new Date(NOW - age).toISOString() }];
    mount(<TeacherCommunityInbox courseId="course/$&" />);
    expect(await screen.findByText(expected)).toBeInTheDocument();
  });

  it("retains update drafts, localizes validation and keeps pinning unchanged", async () => {
    mount(<TeacherCommunityInbox courseId="course/$&" />);
    fireEvent.click(await screen.findByRole("button", { name: "Publicar una novedad" }));
    const form = screen.getByRole("form", { name: "Publicar una novedad" });
    fireEvent.submit(form);
    expect(screen.getByText("Escribe un poco más antes de publicar la novedad.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Tu novedad"), { target: { value: "Original announcement $&" } });
    fireEvent.click(screen.getByRole("button", { name: "EN" }));
    expect(screen.getByText("Write a little more before posting the update.")).toBeInTheDocument();
    expect(screen.getByLabelText("Your update")).toHaveValue("Original announcement $&");
    fireEvent.click(screen.getByRole("button", { name: "Post update" }));
    await waitFor(() => expect(setCommunityPostPinned).toHaveBeenCalledWith("update", true));
    expect(createCommunityPost).toHaveBeenCalledWith(expect.objectContaining({
      courseSlug: "course/$&", category: "announcement", body: "Original announcement $&",
    }));
  });

  it.each(["courseError", "postsError"] as const)("localizes and relocalizes %s", async (failure) => {
    state[failure] = true;
    mount(<TeacherCommunityInbox courseId="course/$&" />);
    const es = failure === "courseError" ? "No pudimos cargar este curso." : "No pudimos cargar las publicaciones de la comunidad.";
    const en = failure === "courseError" ? "We could not load this course." : "We could not load community posts.";
    expect(await screen.findByText(es)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "EN" }));
    expect(screen.getByText(en)).toBeInTheDocument();
  });
});
