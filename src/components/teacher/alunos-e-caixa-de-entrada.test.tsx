import { cleanup, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TeacherInboxQuestions } from "@/components/teacher/teacher-inbox-questions";
import { TeacherStudentsList } from "@/components/teacher/teacher-students-list";
import { useTeacherInboxCount } from "@/components/teacher/use-teacher-inbox-count";
import { threadsAwaitingReply, type CourseMessage } from "@/domain/course-message";

// As duas paginas novas do professor: Alunos (todos os alunos de todos os
// produtos) e a Caixa de entrada (perguntas da comunidade + mensagens), com o
// numero de pendentes que aparece na barra.

const mocks = vi.hoisted(() => ({
  getMyCourseSummaries: vi.fn(),
  getOpenCommunityQuestions: vi.fn(),
  getMyCourseStudents: vi.fn(),
  countThreadsAwaitingTeacher: vi.fn(),
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    status: "authenticated",
    user: { uid: "teacher-1", email: "t@example.com", displayName: "T", emailVerified: true, photoURL: null, roles: ["teacher"] },
  }),
}));
vi.mock("@/lib/data/teacher-courses", () => ({ getMyCourseSummaries: mocks.getMyCourseSummaries }));
vi.mock("@/lib/data/community-posts", () => ({ getOpenCommunityQuestions: mocks.getOpenCommunityQuestions }));
vi.mock("@/lib/data/enrollments", () => ({ getMyCourseStudents: mocks.getMyCourseStudents }));
vi.mock("@/lib/data/course-messages", () => ({ countThreadsAwaitingTeacher: mocks.countThreadsAwaitingTeacher }));

const courses = [
  { id: "c-1", title: "Leadership", communityEnabled: true },
  { id: "c-2", title: "Public speaking", communityEnabled: false },
];

const question = {
  id: "p-1",
  courseSlug: "c-1",
  authorId: "s-1",
  authorName: "Ana",
  category: "question",
  title: "How do I start module 2?",
  body: "I finished module 1.",
  createdAt: new Date().toISOString(),
};

beforeEach(() => {
  mocks.getMyCourseSummaries.mockResolvedValue(courses);
  mocks.getOpenCommunityQuestions.mockResolvedValue([question, { ...question, id: "p-2" }]);
  mocks.countThreadsAwaitingTeacher.mockResolvedValue(1);
  mocks.getMyCourseStudents.mockResolvedValue([
    { enrollmentId: "e-1", courseId: "c-1", courseTitle: "Leadership", uid: "s-1", displayName: "Ana", email: "ana@example.com", photoUrl: "", status: "active", source: "payment", progressPercent: 40, enrolledAt: "2026-09-01T00:00:00Z" },
    { enrollmentId: "e-2", courseId: "c-2", courseTitle: "Public speaking", uid: "s-1", displayName: "Ana", email: "ana@example.com", photoUrl: "", status: "active", source: "payment", progressPercent: 0, enrolledAt: "2026-09-02T00:00:00Z" },
    { enrollmentId: "e-3", courseId: "c-2", courseTitle: "Public speaking", uid: "s-2", displayName: "Bruno", email: "", photoUrl: "", status: "active", source: "free_course", progressPercent: 100, enrolledAt: "2026-09-03T00:00:00Z" },
  ]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Alunos: todos os produtos numa lista", () => {
  it("conta pessoas, nao matriculas, e leva para a lista do produto e para a comunidade", async () => {
    render(<TeacherStudentsList />);

    expect(await screen.findByText("2 students")).toBeInTheDocument();
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);

    const ana = rows.find((row) => within(row).queryByText("Leadership"))!;
    expect(within(ana).getByRole("link", { name: /See in product/ })).toHaveAttribute(
      "href",
      "/teach/courses/c-1/manage?section=students",
    );
    expect(within(ana).getByRole("link", { name: /Community/ })).toHaveAttribute("href", "/teach/courses/c-1/community");

    // Produto sem comunidade: sem o link que daria numa caixa vazia.
    const bruno = rows.find((row) => within(row).queryByText("Bruno"))!;
    expect(within(bruno).queryByRole("link", { name: /Community/ })).toBeNull();
  });

  it("sem alunos, um estado vazio que explica", async () => {
    mocks.getMyCourseStudents.mockResolvedValue([]);
    render(<TeacherStudentsList />);

    expect(await screen.findByRole("heading", { name: /No students yet/ })).toBeInTheDocument();
  });
});

describe("Caixa de entrada: perguntas que esperam pelo professor", () => {
  it("mostra quantas sao e leva cada uma para a caixa da comunidade do curso", async () => {
    render(<TeacherInboxQuestions />);

    const heading = await screen.findByRole("heading", { name: /Questions waiting for you/ });
    await waitFor(() => expect(heading).toHaveTextContent("2"));
    const answers = screen.getAllByRole("link", { name: /Answer/ });
    expect(answers[0]).toHaveAttribute("href", "/teach/courses/c-1/community");
    expect(screen.getAllByText(/Leadership · Ana/)).toHaveLength(2);
    expect(mocks.getOpenCommunityQuestions).toHaveBeenCalledWith(["c-1", "c-2"], "teacher-1");
  });

  it("nada esperando: diz isso", async () => {
    mocks.getOpenCommunityQuestions.mockResolvedValue([]);
    render(<TeacherInboxQuestions />);

    expect(await screen.findByText(/No questions waiting/)).toBeInTheDocument();
  });
});

describe("o numero de pendentes da barra", () => {
  it("soma perguntas sem resposta e conversas em que o aluno falou por ultimo", async () => {
    const { result } = renderHook(() => useTeacherInboxCount("teacher-1"));

    await waitFor(() => expect(result.current).toBe(3));
  });

  it("desligado fora do lado do professor", () => {
    const { result } = renderHook(() => useTeacherInboxCount(null));

    expect(result.current).toBeUndefined();
    expect(mocks.getMyCourseSummaries).not.toHaveBeenCalled();
  });

  it("uma leitura que falha so deixa a barra sem numero", async () => {
    mocks.countThreadsAwaitingTeacher.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useTeacherInboxCount("teacher-1"));

    await waitFor(() => expect(mocks.countThreadsAwaitingTeacher).toHaveBeenCalled());
    expect(result.current).toBeUndefined();
  });

  it("a conversa espera o professor quando a ultima mensagem e do aluno", () => {
    const message = (id: string, studentId: string, senderId: string, minute: number): CourseMessage => ({
      id,
      courseId: "c-1",
      courseTitle: "Leadership",
      studentId,
      studentName: studentId,
      teacherId: "teacher-1",
      senderId,
      body: "hi",
      createdAt: `2026-10-01T10:${String(minute).padStart(2, "0")}:00Z`,
    });

    const waiting = threadsAwaitingReply(
      [
        message("1", "s-1", "s-1", 1),
        message("2", "s-1", "teacher-1", 2),
        message("3", "s-2", "teacher-1", 1),
        message("4", "s-2", "s-2", 3),
      ],
      "teacher-1",
    );

    expect(waiting.map((thread) => thread.studentId)).toEqual(["s-2"]);
  });
});
