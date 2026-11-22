import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CourseAsset } from "@/domain/course-asset";
import type { TeacherCourse } from "@/domain/teacher-course";

const state = vi.hoisted(() => ({
  assets: [] as CourseAsset[],
  // "data": chega na hora; "pending": ainda nao chegou; "error": falhou.
  assetsMode: "data" as "data" | "pending" | "error",
  coursesFail: false,
  emitAssets: (() => undefined) as (assets: CourseAsset[]) => void,
  assetReloads: 0,
  courseReloads: 0,
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
    onError: (error: Error) => void,
  ) => {
    const read = () => {
      if (state.coursesFail) onError(new Error("offline"));
      else onData([{ id: "course-1", title: "Curso 1", status: "published" } as unknown as TeacherCourse]);
    };
    read();
    return Object.assign(() => {}, {
      reload: async () => {
        state.courseReloads += 1;
        read();
      },
    });
  },
}));

vi.mock("@/lib/data/course-assets", () => ({
  subscribeToCourseAssets: (
    _courseId: string,
    onAssets: (assets: CourseAsset[]) => void,
    onError: (error: Error) => void,
  ) => {
    state.emitAssets = onAssets;
    if (state.assetsMode === "data") onAssets(state.assets);
    if (state.assetsMode === "error") onError(new Error("offline"));
    // Como a de verdade: a releitura que da certo entrega a lista.
    return Object.assign(() => {}, {
      reload: async () => {
        state.assetReloads += 1;
        onAssets(state.assets);
      },
    });
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
    state.assetsMode = "data";
    state.coursesFail = false;
    state.assetReloads = 0;
    state.courseReloads = 0;
  });

  it("antes de os arquivos chegarem mostra carregando, nao 'no files'", () => {
    state.assetsMode = "pending";
    render(<TeacherMediaLibrary />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading this course's files...");
    expect(screen.queryByText("Upload from the builder.")).toBeNull();

    act(() => state.emitAssets([]));
    expect(screen.getByText("Upload from the builder.")).toBeInTheDocument();
  });

  it("falha nos arquivos: erro com 'Try again', que le de novo pelo mesmo canal", async () => {
    state.assetsMode = "error";
    state.assets = [asset({})];
    render(<TeacherMediaLibrary />);

    expect(screen.getByRole("alert")).toHaveTextContent("We could not load assets for this course.");
    expect(screen.queryByText("Upload from the builder.")).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });
    expect(state.assetReloads).toBe(1);
    expect(state.courseReloads).toBe(0);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("IMG_4821.jpg")).toBeInTheDocument();
  });

  it("falha nos cursos nao diz 'crie seu primeiro curso'", async () => {
    state.coursesFail = true;
    render(<TeacherMediaLibrary />);

    expect(screen.getByRole("alert")).toHaveTextContent("We could not load your courses.");
    expect(screen.queryByText("Create a course before uploading files.")).toBeNull();

    state.coursesFail = false;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });
    expect(state.courseReloads).toBe(1);
    expect(screen.queryByRole("alert")).toBeNull();
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
