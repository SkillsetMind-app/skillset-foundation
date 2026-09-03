import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CourseBuilderStudio } from "@/components/teacher/course-builder-studio";
import { CourseManageHub } from "@/components/teacher/course-manage-hub";
import { getCourseReadiness } from "@/domain/course-readiness";
import type { TeacherCourse } from "@/domain/teacher-course";

const mocks = vi.hoisted(() => {
  // Fusivel: um laco de render nao estoura o timeout do vitest, come memoria
  // ate matar o processo. Contamos as inscricoes e explodimos cedo.
  function fused<A extends unknown[]>(name: string, impl: (...args: A) => () => void) {
    let calls = 0;
    return (...args: A) => {
      calls += 1;
      if (calls > 20) {
        throw new Error(`${name} inscrito ${calls} vezes: laco de render`);
      }
      return impl(...args);
    };
  }

  // Mesmo curso para as duas telas: titulo, resumo, categoria e um modulo
  // prontos; sem aula e sem preco. Venda avulsa sem parcelamento.
  const course: TeacherCourse = {
    id: "course-1",
    ownerId: "teacher-1",
    title: "Clinical performance foundations",
    summary: "Build a repeatable practice for evidence-informed performance work.",
    category: "Applied Psychology & Behavior",
    categories: ["Applied Psychology & Behavior"],
    status: "draft",
    modules: [{ id: "m1", title: "Start here", lessons: [] }],
    lessonCount: 0,
    priceAmountMinor: null,
    currency: "USD",
    paymentType: "one_time",
  };

  return {
    fused,
    course,
    // O MESMO objeto em todo render: um usuario novo por render reinscreve
    // os efeitos e entra em laco.
    user: { uid: "teacher-1" },
    router: { push: vi.fn(), replace: vi.fn() },
    searchParams: new URLSearchParams("courseId=course-1"),
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  useSearchParams: () => mocks.searchParams,
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ user: mocks.user }),
}));

vi.mock("@/lib/data/teacher-courses", () => ({
  subscribeToTeacherCourse: mocks.fused(
    "subscribeToTeacherCourse",
    (_id: string, onData: (course: TeacherCourse) => void) => {
      onData(mocks.course);
      return () => undefined;
    },
  ),
  subscribeToTeacherCourses: mocks.fused(
    "subscribeToTeacherCourses",
    (_uid: string, onData: (courses: TeacherCourse[]) => void) => {
      onData([mocks.course]);
      return () => undefined;
    },
  ),
  publishTeacherCourse: vi.fn(),
  updateTeacherCourseBuilder: vi.fn(),
  setOwnCourseFeatured: vi.fn(),
}));

vi.mock("@/lib/data/user-profiles", () => ({
  subscribeToUserProfile: mocks.fused(
    "subscribeToUserProfile",
    (_uid: string, onData: (profile: unknown) => void) => {
      onData({ creatorVerificationStatus: "none", currentPlanId: "free" });
      return () => undefined;
    },
  ),
}));

vi.mock("@/lib/data/creator-verification", () => ({
  fetchRequireCreatorVerification: () => Promise.resolve(false),
}));

vi.mock("@/lib/data/course-assets", () => ({
  fetchCourseAssets: () => Promise.resolve([]),
  subscribeToCourseAssets: () => () => undefined,
  syncLessonPreviewAssets: () => Promise.resolve(),
  uploadCourseAsset: vi.fn(),
}));

// Upload de capa depende de APIs de browser que o jsdom nao tem e nao entra
// na conta de readiness.
vi.mock("@/components/teacher/course-asset-uploader", () => ({
  CourseAssetUploader: () => null,
}));

// O painel do produto (numeros, atividade, manutencao) le pedidos, matriculas,
// cupons, avaliacoes e perguntas. Nada disso muda a porcentagem que este
// arquivo mede, e tem prova propria em course-overview-panel.test.tsx.
vi.mock("@/components/teacher/course-overview-panel", () => ({
  CourseOverviewPanel: () => null,
}));

// O professor via, para o mesmo curso, 71% no chip do construtor, 40% na
// barra logo abaixo do chip e 50% no Manage. Cada tela tinha regra propria.
// Agora as tres leem a mesma funcao e mostram o mesmo numero.
describe("o que falta para publicar: um numero so em todas as telas", () => {
  afterEach(() => {
    cleanup();
  });

  const expected = getCourseReadiness(mocks.course);

  it("a funcao pura e a referencia: 4 de 6 checks, 67%", () => {
    expect(expected.doneCount).toBe(4);
    expect(expected.total).toBe(6);
    expect(expected.percent).toBe(67);
  });

  it("construtor: chip, barra, texto do stepper e rodape mostram 67%", async () => {
    render(<CourseBuilderStudio />);

    await screen.findByRole("heading", { name: "Clinical performance foundations" });

    // Chip no cabecalho e "% ready" do rodape.
    const chips = screen.getAllByText(`${expected.percent}% ready`);
    expect(chips.length).toBeGreaterThanOrEqual(2);

    // Texto do stepper e a barra logo abaixo dele.
    expect(screen.getByText(`Publish readiness ${expected.percent}%`)).toBeInTheDocument();
    expect(
      screen.getByText(`${expected.doneCount} of ${expected.total} checks ready`),
    ).toBeInTheDocument();
    expect(screen.getByTestId("publish-readiness-bar")).toHaveStyle({
      width: `${expected.percent}%`,
    });

    // O proximo passo e o rodape vem da mesma lista.
    expect(screen.getAllByText("Add at least one lesson.").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Set a paid price greater than $0, or choose Free.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish product" })).toBeDisabled();
  });

  it("Manage: barra e contagem mostram os mesmos 67% e as mesmas pendencias", async () => {
    render(<CourseManageHub courseId="course-1" />);

    await screen.findByText("Publish checklist");

    expect(
      screen.getByText(
        `${expected.doneCount} of ${expected.total} required steps done · ${expected.percent}% ready`,
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("publish-readiness-bar")).toHaveStyle({
      width: `${expected.percent}%`,
    });

    const list = screen.getByText("Publish checklist").closest("section") ?? document.body;
    expect(within(list).getByText("Add at least one lesson.")).toBeInTheDocument();
    expect(
      within(list).getByText("Set a paid price greater than $0, or choose Free."),
    ).toBeInTheDocument();
  });
});
