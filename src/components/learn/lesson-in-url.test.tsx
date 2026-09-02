import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EnrolledCourseWorkspace } from "@/components/learn/enrolled-course-workspace";
import type { Course } from "@/domain/learning";

/**
 * A aula selecionada nao estava no endereco: recarregar a pagina ou voltar no
 * navegador abria a "primeira aula nao concluida", nao a que a pessoa estava
 * vendo; um link compartilhado nunca abria a mesma aula. E a troca de aula
 * podia acontecer fora da tela (o aluno rolava ate a discussao, o video
 * acabava, a proxima entrava la em cima).
 *
 * Contrato: ?lesson=<id> abre aquela aula; toda selecao grava o endereco e
 * rola ate o player; mudar o endereco por fora (voltar/avancar) muda a aula.
 */

const mocks = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => mocks.searchParams,
  usePathname: () => "/learn/courses/demo-course",
  useRouter: () => ({ push: vi.fn(), replace: mocks.replace }),
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    status: "authenticated",
    user: { uid: "teacher-1", email: "teacher@example.com", roles: ["teacher"] },
  }),
}));

vi.mock("@/lib/data/enrollments", () => ({
  subscribeToEnrollment: vi.fn(() => vi.fn()),
  subscribeToCompletedLessons: vi.fn(() => vi.fn()),
  markLessonComplete: vi.fn(),
  updateEnrollmentProgress: vi.fn(),
}));

vi.mock("@/lib/data/lesson-progress", () => ({
  recordLessonProgress: vi.fn(),
  subscribeToCompletedLessons: vi.fn(() => vi.fn()),
}));

vi.mock("@/lib/data/lesson-content", () => ({
  subscribeToLessonContent: vi.fn((_courseId, onNext) => {
    onNext(new Map());
    return vi.fn();
  }),
  resolveLessonContent: vi.fn(() => ({})),
}));

vi.mock("@/lib/data/course-assets", () => ({
  subscribeToCourseAssets: vi.fn(() => vi.fn()),
  getProtectedCourseAssetObjectUrl: vi.fn(),
}));

vi.mock("@/lib/data/course-events", () => ({
  subscribeToCourseEvents: vi.fn(() => vi.fn()),
}));

vi.mock("@/lib/data/lesson-comments", () => ({
  subscribeToLessonComments: vi.fn(() => vi.fn()),
  addLessonComment: vi.fn(),
  deleteLessonComment: vi.fn(),
}));

vi.mock("@/lib/posthog/events", () => ({
  track: new Proxy({}, { get: () => vi.fn() }),
}));

const course = {
  id: "course-1",
  slug: "demo-course",
  title: "Demo course",
  category: "Leadership",
  summary: "A demo course.",
  durationLabel: "2h",
  image: null,
  membersTheme: "light",
  modules: [
    {
      id: "m1",
      title: "Module one",
      summary: "",
      lessons: [
        { id: "l1", title: "Lesson one", type: "text", duration: "5 min", isPreview: true, contentText: "One" },
        { id: "l2", title: "Lesson two", type: "text", duration: "7 min", isPreview: false, contentText: "Two" },
      ],
    },
  ],
} as unknown as Course;

// O titulo da aula aberta e o h4 do cabecalho do painel da aula, dentro do
// player (a secao tem outros h4: o cartao "continuar", a lista de aulas).
function playerHeading() {
  return document
    .getElementById("member-lesson-player")
    ?.querySelector(".member-lesson-panel__head h4")?.textContent;
}

describe("a aula atual vive no endereco", () => {
  const scrollIntoView = vi.fn();

  beforeEach(() => {
    mocks.replace.mockReset();
    scrollIntoView.mockReset();
    Element.prototype.scrollIntoView = scrollIntoView;
    // jsdom sem requestAnimationFrame em alguns ambientes: roda na hora.
    window.requestAnimationFrame = (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    };
  });

  it("abre a aula do ?lesson= em vez da primeira", () => {
    mocks.searchParams = new URLSearchParams("lesson=l2");
    render(<EnrolledCourseWorkspace course={course} previewMode />);

    expect(playerHeading()).toBe("Lesson two");
  });

  it("ao escolher uma aula, grava o endereco e rola ate o player", () => {
    mocks.searchParams = new URLSearchParams();
    render(<EnrolledCourseWorkspace course={course} previewMode />);
    expect(playerHeading()).toBe("Lesson one");

    fireEvent.click(screen.getByRole("button", { name: /Lesson two/ }));

    expect(playerHeading()).toBe("Lesson two");
    expect(mocks.replace).toHaveBeenCalledWith(
      expect.stringMatching(/\/learn\/courses\/demo-course\?.*lesson=l2/),
      { scroll: false },
    );
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it("voltar no navegador (endereco muda por fora) muda a aula", () => {
    mocks.searchParams = new URLSearchParams("lesson=l2");
    const { rerender } = render(
      <EnrolledCourseWorkspace course={course} previewMode />,
    );
    expect(playerHeading()).toBe("Lesson two");

    mocks.searchParams = new URLSearchParams("lesson=l1");
    rerender(<EnrolledCourseWorkspace course={course} previewMode />);

    expect(playerHeading()).toBe("Lesson one");
  });
});
