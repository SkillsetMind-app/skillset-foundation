import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EnrolledCourseWorkspace } from "@/components/learn/enrolled-course-workspace";
import type { Course } from "@/domain/learning";

/**
 * O professor abre o preview do proprio curso e a aba martela o banco sem parar.
 *
 * A matricula do preview e montada como literal no corpo do componente, entao
 * ganhava identidade nova a cada render. Tres efeitos declaram esse OBJETO como
 * dependencia, e dois deles abrem inscricao no Supabase e gravam estado no
 * callback: estado novo -> render -> objeto novo -> cancela e reinscreve ->
 * callback -> estado novo. Laco fechado, sem condicao de parada.
 *
 * Custo real: cota de requisicoes do projeto, churn de canais realtime, aba
 * travando e bateria do celular indo embora. Nada na tela dizia o que era.
 *
 * O contrato provado aqui: no preview, cada inscricao e aberta UMA vez.
 */

const mocks = vi.hoisted(() => ({
  subscribeToLessonContent: vi.fn(),
  subscribeToCourseAssets: vi.fn(),
  subscribeToEnrollment: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/teach/courses/demo/preview",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    status: "authenticated",
    user: { uid: "teacher-1", email: "teacher@example.com", roles: ["teacher"] },
  }),
}));

vi.mock("@/lib/data/enrollments", () => ({
  subscribeToEnrollment: mocks.subscribeToEnrollment,
  subscribeToCompletedLessons: vi.fn(() => vi.fn()),
  markLessonComplete: vi.fn(),
  updateEnrollmentProgress: vi.fn(),
}));

vi.mock("@/lib/data/lesson-content", () => ({
  subscribeToLessonContent: mocks.subscribeToLessonContent,
  resolveLessonContent: vi.fn(() => null),
}));

vi.mock("@/lib/data/course-assets", () => ({
  subscribeToCourseAssets: mocks.subscribeToCourseAssets,
  getProtectedCourseAssetObjectUrl: vi.fn(),
}));

const course = {
  id: "course-1",
  slug: "demo-course",
  title: "Demo course",
  category: "Leadership",
  summary: "A demo course.",
  image: null,
  modules: [],
  membersTheme: "light",
} as unknown as Course;

// Com o defeito de volta, o laco e SINCRONO dentro do render: o teste nao
// "falha", ele trava para sempre (foi exatamente o que aconteceu na prova por
// reversao). Um fusivel converte o travamento em falha que termina.
const FUSIVEL = 20;

function comFusivel<T>(rotulo: string, entrega: T) {
  let vezes = 0;
  return (_courseId: string, onNext: (valor: T) => void) => {
    vezes += 1;
    if (vezes > FUSIVEL) {
      throw new Error(`laco: ${rotulo} reinscreveu ${vezes} vezes`);
    }
    onNext(entrega);
    return vi.fn();
  };
}

describe("preview do curso do professor nao pode entrar em laco", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // O modo de falha real: a inscricao entrega o estado atual JA no ato de
    // inscrever. E a gravacao desse estado que fecha o laco.
    mocks.subscribeToLessonContent.mockImplementation(
      comFusivel("conteudo de aula", new Map()),
    );
    mocks.subscribeToCourseAssets.mockImplementation(
      comFusivel("anexos", [] as unknown[]),
    );
    mocks.subscribeToEnrollment.mockImplementation((_uid, _slug, onNext) => {
      onNext(null);
      return vi.fn();
    });
  });

  it("abre a inscricao de conteudo de aula uma vez so", () => {
    render(<EnrolledCourseWorkspace course={course} previewMode />);

    expect(mocks.subscribeToLessonContent).toHaveBeenCalledTimes(1);
  });

  it("abre a inscricao de anexos uma vez so", () => {
    render(
      <EnrolledCourseWorkspace course={course} previewMode enableFirestoreAssets />,
    );

    expect(mocks.subscribeToCourseAssets).toHaveBeenCalledTimes(1);
  });

  it("nao reinscreve quando o componente e renderizado de novo com as mesmas props", () => {
    const { rerender } = render(
      <EnrolledCourseWorkspace course={course} previewMode />,
    );

    rerender(<EnrolledCourseWorkspace course={course} previewMode />);
    rerender(<EnrolledCourseWorkspace course={course} previewMode />);

    expect(mocks.subscribeToLessonContent).toHaveBeenCalledTimes(1);
  });
});
