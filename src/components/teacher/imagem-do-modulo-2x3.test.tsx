import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { CourseBuilderStudio } from "@/components/teacher/course-builder-studio";
import type { TeacherCourse } from "@/domain/teacher-course";
import { uploadCourseAsset } from "@/lib/data/course-assets";

// Decisão: a capa do módulo é vertical 2:3 e comprimida no navegador (10 MB
// entram, uns 300 KB saem). A capa da área de membros não muda. jsdom não tem
// createImageBitmap nem canvas de verdade: os dois são dublados.

const mocks = vi.hoisted(() => {
  const course: TeacherCourse = {
    id: "course-1",
    ownerId: "teacher-1",
    title: "Clinical performance foundations",
    summary: "Build a repeatable practice for evidence-informed performance work.",
    category: "Applied Psychology & Behavior",
    categories: ["Applied Psychology & Behavior"],
    status: "draft",
    modules: [
      { id: "m1", title: "Start here", lessons: [] },
      { id: "m2", title: "Deep work", summary: "Protect the hours that matter.", lessons: [] },
    ],
    lessonCount: 0,
    priceAmountMinor: null,
    currency: "USD",
    paymentType: "one_time",
  };

  return {
    course,
    user: { uid: "teacher-1" },
    router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
    searchParams: new URLSearchParams("courseId=course-1&tab=content&module=m2"),
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
  subscribeToTeacherCourse: vi.fn((_id: string, onData: (course: TeacherCourse) => void) => {
    onData(mocks.course);
    return () => undefined;
  }),
  publishTeacherCourse: vi.fn(() => Promise.resolve()),
  updateTeacherCourseBuilder: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/lib/data/user-profiles", () => ({
  subscribeToUserProfile: (_uid: string, onData: (profile: unknown) => void) => {
    onData({ creatorVerificationStatus: "none", currentPlanId: "free" });
    return () => undefined;
  },
}));

vi.mock("@/lib/data/creator-verification", () => ({
  fetchRequireCreatorVerification: () => Promise.resolve(false),
}));

vi.mock("@/lib/data/course-assets", () => ({
  fetchCourseAssets: () => Promise.resolve([]),
  subscribeToCourseAssets: vi.fn(() => () => undefined),
  syncLessonPreviewAssets: () => Promise.resolve(),
  uploadCourseAsset: vi.fn(() => Promise.resolve("cover-new")),
}));

vi.mock("@/components/teacher/course-asset-uploader", () => ({
  CourseAssetUploader: () => null,
}));

vi.mock("@/components/teacher/lesson-content-modal", () => ({
  LessonContentModal: () => null,
}));

async function moduleCoverInput() {
  render(
    <I18nProvider initialLocale="en">
      <CourseBuilderStudio />
    </I18nProvider>,
  );
  await screen.findByRole("heading", { name: mocks.course.title });
  const card = document.querySelector("#builder-sec-modules");
  if (!card) throw new Error("a aba de conteudo nao abriu");
  const region = within(card as HTMLElement).getByRole("region", { name: "Module cover" });
  const input = region.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("o campo da capa do modulo nao tem input de arquivo");
  return input;
}

function choose(input: HTMLInputElement, file: File) {
  fireEvent.change(input, { target: { files: [file] } });
}

describe("capa do módulo: 2:3 comprimida no navegador", () => {
  beforeEach(() => {
    vi.mocked(uploadCourseAsset).mockClear();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 3000, height: 2000, close: vi.fn() })),
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      (callback: BlobCallback, type?: string) => {
        callback(new Blob(["comprimido"], { type }));
      },
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sobe a imagem comprimida em WebP, como capa do módulo", async () => {
    const input = await moduleCoverInput();
    choose(input, new File(["foto grande"], "capa.png", { type: "image/png" }));

    await waitFor(() => expect(uploadCourseAsset).toHaveBeenCalledTimes(1));
    const sent = vi.mocked(uploadCourseAsset).mock.calls[0][0];
    expect(sent.kind).toBe("module_cover");
    expect(sent.moduleId).toBe("m2");
    expect(sent.file.type).toBe("image/webp");
    expect(sent.file.name).toBe("capa.webp");
  });

  it("recusa arquivo de 11 MB e mostra o erro, sem subir nada", async () => {
    const input = await moduleCoverInput();
    const big = new File(["x"], "enorme.jpg", { type: "image/jpeg" });
    Object.defineProperty(big, "size", { value: 11 * 1024 * 1024 });
    choose(input, big);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This image is over 10 MB. Choose a smaller one.",
    );
    expect(uploadCourseAsset).not.toHaveBeenCalled();
  });

  it("se o navegador não abre a imagem (HEIC), sobe o original sem mexer", async () => {
    vi.mocked(createImageBitmap).mockRejectedValueOnce(new Error("formato não suportado"));
    const input = await moduleCoverInput();
    const heic = new File(["original"], "foto.heic", { type: "image/heic" });
    choose(input, heic);

    await waitFor(() => expect(uploadCourseAsset).toHaveBeenCalledTimes(1));
    expect(vi.mocked(uploadCourseAsset).mock.calls[0][0].file).toBe(heic);
  });
});
