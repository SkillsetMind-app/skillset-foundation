import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EnrolledCourseWorkspace } from "@/components/learn/enrolled-course-workspace";
import type { Course } from "@/domain/learning";

/**
 * Aula sem capa própria (lesson_thumbnail) e com link do YouTube aparecia sem
 * miniatura na playlist. Agora a sala usa a capa do próprio YouTube
 * (i.ytimg.com/vi/<id>/hqdefault.jpg), só para a aula ABERTA: o link de uma
 * aula trancada nunca chega à página, e a sala não inventa capa para ela.
 */

const mocks = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => mocks.searchParams,
  usePathname: () => "/learn/courses/demo-course",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    status: "authenticated",
    user: { uid: "teacher-1", email: "teacher@example.test", roles: ["teacher"] },
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

// O texto e o link da aula chegam pelo mesmo caminho da sala de verdade
// (resolveLessonContent); só a assinatura do banco é dublada.
vi.mock("@/lib/data/lesson-content", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data/lesson-content")>()),
  subscribeToLessonContent: vi.fn((_courseId, onNext) => {
    onNext(new Map());
    return vi.fn();
  }),
}));

vi.mock("@/lib/data/course-assets", () => ({
  subscribeToCourseAssets: vi.fn((_courseId, onNext) => {
    onNext([]);
    return vi.fn();
  }),
  getProtectedCourseAssetObjectUrl: vi.fn(),
}));

vi.mock("@/lib/data/course-events", () => ({
  subscribeToCourseEvents: vi.fn(() => vi.fn()),
}));

vi.mock("@/lib/posthog/events", () => ({
  track: new Proxy({}, { get: () => vi.fn() }),
}));

// Sequencial: aula 1 aberta, aula 2 trancada. As duas com link do YouTube e
// nenhuma com capa própria.
const course = {
  id: "course-1",
  slug: "demo-course",
  title: "Demo course",
  category: "Leadership",
  summary: "A demo course.",
  durationLabel: "2h",
  image: null,
  membersTheme: "light",
  dripStrategy: "sequential_progress",
  modules: [
    {
      id: "m1",
      title: "Module one",
      summary: "",
      lessons: [
        {
          id: "l1",
          title: "Lesson one",
          type: "video",
          videoSource: "youtube",
          duration: "5 min",
          isPreview: false,
          externalUrl: "https://youtu.be/openVideo01",
        },
        {
          id: "l2",
          title: "Lesson two",
          type: "video",
          videoSource: "youtube",
          duration: "7 min",
          isPreview: false,
          externalUrl: "https://youtu.be/lockedVid02",
        },
      ],
    },
  ],
} as unknown as Course;

describe("a capa da aula cai na do YouTube", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    window.requestAnimationFrame = (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    };
  });

  it("aula aberta sem capa usa a do YouTube; a trancada fica sem", () => {
    mocks.searchParams = new URLSearchParams("lesson=l1");
    render(<EnrolledCourseWorkspace course={course} previewMode enableFirestoreAssets />);

    expect(
      document.querySelector('img[src="https://i.ytimg.com/vi/openVideo01/hqdefault.jpg"]'),
    ).not.toBeNull();
    expect(document.querySelector('img[src*="lockedVid02"]')).toBeNull();
  });
});
