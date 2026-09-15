import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EnrolledCourseWorkspace } from "@/components/learn/enrolled-course-workspace";
import type { Course } from "@/domain/learning";

/**
 * A RLS só entrega o texto, o link e o material da aula que já abriu
 * (migration 20260915020000). A aula com prazo que vence com a sala aberta
 * aparecia "liberada" (o desbloqueio é recalculado com o relógio da tela) mas
 * vazia, sem vídeo, texto nem material, até recarregar a página: nada no banco
 * muda no momento do prazo, então o realtime não acorda.
 *
 * Contrato: a sala recarrega o conteúdo e o material quando o próximo prazo
 * vence, quando a aba volta a ficar visível e quando o conjunto de aulas
 * concluídas muda (mesmo com o mesmo tamanho).
 */

// Objetos estáveis: um `user` ou uma matrícula novos a cada render reinscrevem
// os efeitos que dependem deles, e o modo aluno entra em laço dentro do render.
const mocks = vi.hoisted(() => ({
  subscribeToLessonContent: vi.fn(),
  subscribeToCourseAssets: vi.fn(),
  completed: null as null | ((ids: string[]) => void),
  auth: {
    status: "authenticated",
    user: { uid: "student-1", email: "student@example.test", roles: ["student"] },
  },
  enrollment: {
    id: "student-1__course-1",
    userId: "student-1",
    courseId: "course-1",
    courseSlug: "demo-course",
    courseTitle: "Demo course",
    courseCategory: "Leadership",
    courseImage: "",
    status: "active",
    source: "payment",
    progressPercent: 0,
    lastLessonId: null,
    createdAt: "2026-03-01T12:00:00.000Z",
  },
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/learn/courses/demo-course",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => mocks.auth,
}));

vi.mock("@/lib/data/enrollments", () => ({
  subscribeToEnrollment: vi.fn((_uid: string, _slug: string, onNext: (value: unknown) => void) => {
    onNext(mocks.enrollment);
    return vi.fn();
  }),
}));

vi.mock("@/lib/data/lesson-progress", () => ({
  recordLessonProgress: vi.fn(),
  subscribeToCompletedLessons: vi.fn((_id: string, onNext: (ids: string[]) => void) => {
    mocks.completed = onNext;
    onNext([]);
    return vi.fn();
  }),
}));

vi.mock("@/lib/data/lesson-content", () => ({
  subscribeToLessonContent: mocks.subscribeToLessonContent,
  resolveLessonContent: vi.fn(() => ({})),
}));

vi.mock("@/lib/data/course-assets", () => ({
  subscribeToCourseAssets: mocks.subscribeToCourseAssets,
  getProtectedCourseAssetObjectUrl: vi.fn(),
}));

vi.mock("@/lib/data/course-events", () => ({
  subscribeToCourseEvents: vi.fn(() => vi.fn()),
}));

vi.mock("@/lib/posthog/events", () => ({
  track: new Proxy({}, { get: () => vi.fn() }),
}));

// Aula 2 abre um dia depois da matrícula (time_drip_lesson, intervalo 1).
const course = {
  id: "course-1",
  slug: "demo-course",
  title: "Demo course",
  category: "Leadership",
  summary: "A demo course.",
  durationLabel: "2h",
  image: null,
  membersTheme: "light",
  dripStrategy: "time_drip_lesson",
  dripIntervalDays: 1,
  modules: [
    {
      id: "m1",
      title: "Module one",
      summary: "",
      lessons: [
        { id: "l1", title: "Lesson one", type: "text", duration: "5 min", isPreview: false },
        { id: "l2", title: "Lesson two", type: "text", duration: "7 min", isPreview: false },
      ],
    },
  ],
} as unknown as Course;

const minute = 60 * 1000;
const day = 24 * 60 * minute;

function mount() {
  render(<EnrolledCourseWorkspace course={course} enableFirestoreAssets />);
  return {
    content: mocks.subscribeToLessonContent.mock.calls.length,
    assets: mocks.subscribeToCourseAssets.mock.calls.length,
  };
}

describe("a sala recarrega o conteúdo quando uma aula é liberada", () => {
  beforeEach(() => {
    // Só o relógio e o setTimeout: o player com marca d'água arma setInterval
    // curtos, e avançar 24h com eles falsos roda dezenas de milhares de
    // renders (o teste travava em vez de reprovar).
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(new Date("2026-03-01T12:00:00.000Z"));
    mocks.subscribeToLessonContent.mockReset().mockImplementation(
      (_courseId: string, onNext: (value: Map<string, unknown>) => void) => {
        onNext(new Map());
        return vi.fn();
      },
    );
    mocks.subscribeToCourseAssets.mockReset().mockImplementation(
      (_courseId: string, onNext: (value: unknown[]) => void) => {
        onNext([]);
        return vi.fn();
      },
    );
    window.requestAnimationFrame = (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    };
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("busca de novo o texto e o material quando o prazo da próxima aula vence", () => {
    const before = mount();

    act(() => {
      vi.advanceTimersByTime(day - minute);
    });
    expect(mocks.subscribeToLessonContent).toHaveBeenCalledTimes(before.content);
    expect(mocks.subscribeToCourseAssets).toHaveBeenCalledTimes(before.assets);

    act(() => {
      vi.advanceTimersByTime(2 * minute);
    });
    expect(mocks.subscribeToLessonContent).toHaveBeenCalledTimes(before.content + 1);
    expect(mocks.subscribeToCourseAssets).toHaveBeenCalledTimes(before.assets + 1);
  });

  it("busca de novo quando a aba volta a ficar visível", () => {
    const before = mount();

    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(mocks.subscribeToLessonContent).toHaveBeenCalledTimes(before.content + 1);
    expect(mocks.subscribeToCourseAssets).toHaveBeenCalledTimes(before.assets + 1);
  });

  it("busca de novo quando o conjunto de aulas concluídas muda com o mesmo tamanho", () => {
    mount();
    act(() => {
      mocks.completed?.(["l1"]);
    });
    const afterFirst = mocks.subscribeToLessonContent.mock.calls.length;

    act(() => {
      mocks.completed?.(["l2"]);
    });

    expect(mocks.subscribeToLessonContent).toHaveBeenCalledTimes(afterFirst + 1);
  });
});
