import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CourseAsset } from "@/domain/course-asset";
import type { TeacherCourse } from "@/domain/teacher-course";

const state = vi.hoisted(() => ({
  assets: [] as CourseAsset[],
  // Objeto estável: o componente depende de `[user]` num efeito, e um objeto
  // novo a cada render vira loop infinito de inscrição.
  user: { uid: "teacher-1" },
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ user: state.user }),
}));

vi.mock("@/lib/data/teacher-courses", () => ({
  subscribeToTeacherCourses: (
    _uid: string,
    onData: (courses: TeacherCourse[]) => void,
  ) => {
    onData([
      { id: "course-1", title: "Curso 1", status: "published" } as unknown as TeacherCourse,
    ]);
    return () => {};
  },
}));

vi.mock("@/lib/data/course-assets", () => ({
  subscribeToCourseAssets: (
    _courseId: string,
    onAssets: (assets: CourseAsset[]) => void,
  ) => {
    onAssets(state.assets);
    return () => {};
  },
}));

const { TeacherMediaLibrary } = await import(
  "@/components/teacher/teacher-media-library"
);

function asset(overrides: Partial<CourseAsset>): CourseAsset {
  return {
    id: "asset-1",
    courseId: "course-1",
    ownerId: "teacher-1",
    kind: "course_cover",
    fileName: "IMG_4821.jpg",
    contentType: "image/jpeg",
    size: 2048,
    storagePath: "courses/course-1/assets/teacher-1/asset-1/img_4821.jpg",
    downloadUrl: "https://media.example/public-media/img_4821.jpg",
    isPreview: false,
    lessonId: null,
    ...overrides,
  };
}

describe("TeacherMediaLibrary", () => {
  afterEach(() => {
    cleanup();
    state.assets = [];
  });

  // Três capas chamadas IMG_xxxx.jpg eram três quadrados idênticos escritos
  // "image". A URL pública já estava na linha e não era usada.
  it("mostra a miniatura da capa em vez da palavra 'image'", async () => {
    state.assets = [asset({})];

    render(<TeacherMediaLibrary />);

    const thumbnail = await screen.findByRole("img", {
      name: "Course cover: IMG_4821.jpg",
    });
    expect(thumbnail).toHaveAttribute(
      "src",
      "https://media.example/public-media/img_4821.jpg",
    );
    expect(screen.queryByText("image")).not.toBeInTheDocument();
  });

  it("mantém o rótulo de tipo para arquivos sem URL pública", async () => {
    state.assets = [
      asset({
        id: "asset-2",
        kind: "lesson_material",
        fileName: "apostila.pdf",
        contentType: "application/pdf",
        downloadUrl: null,
        lessonId: "lesson-1",
      }),
    ];

    render(<TeacherMediaLibrary />);

    expect(await screen.findByText("application")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
