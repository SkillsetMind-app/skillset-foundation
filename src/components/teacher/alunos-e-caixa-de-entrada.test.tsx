import { cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TeacherInboxQuestions } from "@/components/teacher/teacher-inbox-questions";
import { TeacherStudentsList } from "@/components/teacher/teacher-students-list";
import { useTeacherInboxCount } from "@/components/teacher/use-teacher-inbox-count";
import { countThreadsAwaitingReply } from "@/domain/course-message";

// As duas paginas novas do professor: Alunos (todos os alunos de todos os
// produtos) e a Caixa de entrada (perguntas da comunidade + mensagens), com o
// numero de pendentes que aparece na barra. As consultas em si (colunas,
// ordem, filtros) estao em src/lib/data/caixa-de-entrada-leituras.test.ts.

const mocks = vi.hoisted(() => ({
  getMyCourseSummaries: vi.fn(),
  getOpenCommunityQuestions: vi.fn(),
  getCommunityPostsByIds: vi.fn(),
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
vi.mock("@/lib/data/community-posts", () => ({
  getOpenCommunityQuestions: mocks.getOpenCommunityQuestions,
  getCommunityPostsByIds: mocks.getCommunityPostsByIds,
}));
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

const enrollment = (id: string, courseId: string, uid: string, name: string, status: string) => ({
  enrollmentId: id,
  courseId,
  courseTitle: courseId === "c-1" ? "Leadership" : "Public speaking",
  uid,
  displayName: name,
  email: "",
  photoUrl: "",
  status,
  source: "payment",
  progressPercent: 0,
  enrolledAt: `2026-09-0${id.slice(-1)}T00:00:00Z`,
});

beforeEach(() => {
  mocks.getMyCourseSummaries.mockResolvedValue(courses);
  mocks.getOpenCommunityQuestions.mockResolvedValue(["p-1", "p-2"]);
  mocks.getCommunityPostsByIds.mockResolvedValue([question, { ...question, id: "p-2" }]);
  mocks.countThreadsAwaitingTeacher.mockResolvedValue(1);
  mocks.getMyCourseStudents.mockResolvedValue([
    enrollment("e-1", "c-1", "s-1", "Ana", "active"),
    enrollment("e-2", "c-2", "s-1", "Ana", "active"),
    enrollment("e-3", "c-2", "s-2", "Bruno", "completed"),
  ]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Alunos: todos os produtos numa lista", () => {
  it("conta pessoas, nao matriculas, e leva para a lista do produto e para a comunidade", async () => {
    render(<TeacherStudentsList />);

    expect(await screen.findByText("2 active students")).toBeInTheDocument();
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);

    const ana = rows.find((row) => within(row).queryByText("Leadership"))!;
    // O proprio nome e o link (sem a parede de botoes iguais em toda linha).
    expect(within(ana).getByRole("link", { name: /^Ana: See in product/ })).toHaveAttribute(
      "href",
      "/teach/courses/c-1/manage?section=students",
    );
    expect(within(ana).getByRole("link", { name: /Community/ })).toHaveAttribute("href", "/teach/courses/c-1/community");

    // Produto sem comunidade: sem o link que daria numa caixa vazia.
    const bruno = rows.find((row) => within(row).queryByText("Bruno"))!;
    expect(within(bruno).queryByRole("link", { name: /Community/ })).toBeNull();
  });

  // Antes, quem pediu reembolso continuava contando como aluno, sem marca.
  it("reembolsado, removido e expirado aparecem com a situacao e nao contam como alunos", async () => {
    mocks.getMyCourseStudents.mockResolvedValue([
      enrollment("e-1", "c-1", "s-1", "Ana", "active"),
      enrollment("e-2", "c-2", "s-2", "Bruno", "completed"),
      enrollment("e-3", "c-1", "s-3", "Carla", "refunded"),
      enrollment("e-4", "c-1", "s-4", "Dani", "revoked"),
      enrollment("e-5", "c-2", "s-5", "Edu", "expired"),
    ]);
    render(<TeacherStudentsList />);

    expect(await screen.findByText("2 active students")).toBeInTheDocument();
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(5);
    const statusOf = (name: string) => rows.find((row) => within(row).queryByText(name))!;
    expect(within(statusOf("Ana")).getByText("Active")).toBeInTheDocument();
    expect(within(statusOf("Bruno")).getByText("Completed")).toBeInTheDocument();
    expect(within(statusOf("Carla")).getByText("Refunded")).toBeInTheDocument();
    expect(within(statusOf("Dani")).getByText("Revoked")).toBeInTheDocument();
    expect(within(statusOf("Edu")).getByText("Expired")).toBeInTheDocument();
  });

  // Antes nao havia como achar uma pessoa: era rolar a tabela inteira. A busca
  // filtra o que ja veio (nome, e-mail, produto), sem consulta nova.
  it("busca por nome, e-mail ou produto no que ja carregou, e diz quando nada bate", async () => {
    mocks.getMyCourseStudents.mockResolvedValue([
      enrollment("e-1", "c-1", "s-1", "Ana", "active"),
      { ...enrollment("e-2", "c-2", "s-2", "Bruno", "completed"), email: "bruno@example.com" },
    ]);
    render(<TeacherStudentsList />);

    const search = await screen.findByLabelText("Search students by name, e-mail or product");
    const bodyRows = () => screen.getAllByRole("row").slice(1);
    fireEvent.change(search, { target: { value: "BRUNO@" } });
    expect(bodyRows()).toHaveLength(1);
    expect(bodyRows()[0]).toHaveTextContent("Bruno");
    fireEvent.change(search, { target: { value: "leader" } });
    expect(bodyRows()).toHaveLength(1);
    expect(bodyRows()[0]).toHaveTextContent("Ana");
    fireEvent.change(search, { target: { value: "nobody" } });
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("No student matches this search or filter.");
    // A contagem e de todos, nao do recorte da busca.
    expect(screen.getByText("2 active students")).toBeInTheDocument();
    expect(mocks.getMyCourseStudents).toHaveBeenCalledTimes(1);
  });

  it("so com matriculas encerradas, a conta diz zero", async () => {
    mocks.getMyCourseStudents.mockResolvedValue([enrollment("e-1", "c-1", "s-1", "Ana", "refunded")]);
    render(<TeacherStudentsList />);

    expect(await screen.findByText("0 active students")).toBeInTheDocument();
    expect(within(screen.getAllByRole("row")[1]).getByText("Refunded")).toBeInTheDocument();
  });

  // O filtro de acesso da lista por produto, tambem so sobre o que ja veio.
  it("filtra por acesso sem ler de novo, e a contagem continua a de todos", async () => {
    mocks.getMyCourseStudents.mockResolvedValue([
      enrollment("e-1", "c-1", "s-1", "Ana", "active"),
      enrollment("e-2", "c-2", "s-2", "Bruno", "completed"),
      enrollment("e-3", "c-1", "s-3", "Carla", "refunded"),
    ]);
    render(<TeacherStudentsList />);

    const access = await screen.findByRole("combobox", { name: "Filter by access" });
    const bodyRows = () => screen.getAllByRole("row").slice(1);
    expect(bodyRows()).toHaveLength(3);
    fireEvent.change(access, { target: { value: "refunded" } });
    expect(bodyRows()).toHaveLength(1);
    expect(bodyRows()[0]).toHaveTextContent("Carla");
    fireEvent.change(access, { target: { value: "expired" } });
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("No student matches this search or filter.");
    expect(screen.getByText("2 active students")).toBeInTheDocument();
    expect(mocks.getMyCourseStudents).toHaveBeenCalledTimes(1);
  });

  // Antes a tabela mostrava todas as matriculas de uma vez, sem limite.
  it("mostra 50 por vez e 'Show N more' abre as proximas, sem ler de novo", async () => {
    mocks.getMyCourseStudents.mockResolvedValue(
      Array.from({ length: 120 }, (_, index) => ({
        ...enrollment(`e-${index}`, "c-1", `s-${index}`, `Aluno ${index}`, "active"),
        enrolledAt: new Date(Date.UTC(2026, 0, 1) + index * 60_000).toISOString(),
      })),
    );
    render(<TeacherStudentsList />);

    expect(await screen.findByText("120 active students")).toBeInTheDocument();
    const bodyRows = () => screen.getAllByRole("row").slice(1);
    expect(bodyRows()).toHaveLength(50);
    fireEvent.click(screen.getByRole("button", { name: "Show 50 more" }));
    expect(bodyRows()).toHaveLength(100);
    fireEvent.click(screen.getByRole("button", { name: "Show 20 more" }));
    expect(bodyRows()).toHaveLength(120);
    expect(screen.queryByRole("button", { name: /Show \d+ more/ })).toBeNull();
    expect(mocks.getMyCourseStudents).toHaveBeenCalledTimes(1);
  });

  it("sem alunos, um estado vazio que explica", async () => {
    mocks.getMyCourseStudents.mockResolvedValue([]);
    render(<TeacherStudentsList />);

    expect(await screen.findByRole("heading", { name: /No students yet/ })).toBeInTheDocument();
  });

  // Falha nao e "nenhum aluno": o erro com "Try again", que pede a mesma
  // leitura de novo.
  it("leitura que falha mostra o erro e Try again le de novo", async () => {
    mocks.getMyCourseStudents.mockRejectedValueOnce(new Error("down"));
    render(<TeacherStudentsList />);

    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't load your students.");
    expect(screen.queryByRole("heading", { name: /No students yet/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("2 active students")).toBeInTheDocument();
    expect(mocks.getMyCourseStudents).toHaveBeenCalledTimes(2);
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
    // Curso com a comunidade desligada fica de fora da busca.
    expect(mocks.getOpenCommunityQuestions).toHaveBeenCalledWith(["c-1"], "teacher-1");
    // O texto so e lido para as perguntas que esperam.
    expect(mocks.getCommunityPostsByIds).toHaveBeenCalledWith(["p-1", "p-2"]);
  });

  it("nada esperando: diz isso", async () => {
    mocks.getOpenCommunityQuestions.mockResolvedValue([]);
    mocks.getCommunityPostsByIds.mockResolvedValue([]);
    render(<TeacherInboxQuestions />);

    expect(await screen.findByText(/No questions waiting/)).toBeInTheDocument();
  });

  // Enquanto le, o cartao mostra a forma das linhas (antes ficava so o titulo);
  // falha nao e "nada esperando": erro com "Try again".
  it("carregando mostra a espera; falha mostra o erro e Try again le de novo", async () => {
    mocks.getOpenCommunityQuestions.mockRejectedValueOnce(new Error("down"));
    render(<TeacherInboxQuestions />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading questions...");
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't load the questions.");
    expect(screen.queryByText(/No questions waiting/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findAllByRole("link", { name: /Answer/ })).toHaveLength(2);
  });

  // Na pagina Inbox a casca (numero da barra) e a lista pedem juntas: uma
  // leitura so de cursos, perguntas e conversas.
  it("na pagina Inbox, o numero da barra e a lista dividem a mesma leitura", async () => {
    function InboxPage() {
      const count = useTeacherInboxCount("teacher-1");
      return (
        <>
          <p data-testid="nav-count">{count ?? ""}</p>
          <TeacherInboxQuestions />
        </>
      );
    }
    render(<InboxPage />);

    await waitFor(() => expect(screen.getByTestId("nav-count")).toHaveTextContent("3"));
    await screen.findAllByRole("link", { name: /Answer/ });
    expect(mocks.getMyCourseSummaries).toHaveBeenCalledOnce();
    expect(mocks.getOpenCommunityQuestions).toHaveBeenCalledOnce();
    expect(mocks.countThreadsAwaitingTeacher).toHaveBeenCalledOnce();
  });
});

describe("o numero de pendentes da barra", () => {
  it("soma perguntas sem resposta (so de comunidades ligadas) e conversas em que o aluno falou por ultimo", async () => {
    const { result } = renderHook(() => useTeacherInboxCount("teacher-1"));

    await waitFor(() => expect(result.current).toBe(3));
    expect(mocks.getOpenCommunityQuestions).toHaveBeenCalledWith(["c-1"], "teacher-1");
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
    await waitFor(() => expect(mocks.getOpenCommunityQuestions).toHaveBeenCalled());
    expect(result.current).toBeUndefined();
  });

  it("a conversa espera o professor quando a ultima mensagem e do aluno, em qualquer ordem", () => {
    const message = (studentId: string, senderId: string, minute: number) => ({
      courseId: "c-1",
      studentId,
      senderId,
      createdAt: `2026-10-01T10:${String(minute).padStart(2, "0")}:00Z`,
    });

    expect(
      countThreadsAwaitingReply(
        [
          message("s-2", "s-2", 3),
          message("s-1", "teacher-1", 2),
          message("s-1", "s-1", 1),
          message("s-2", "teacher-1", 1),
        ],
        "teacher-1",
      ),
    ).toBe(1);
  });
});
