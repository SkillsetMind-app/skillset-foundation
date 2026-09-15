import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { CourseBuilderStudio } from "@/components/teacher/course-builder-studio";
import type { CourseAsset } from "@/domain/course-asset";
import type { TeacherCourse, TeacherLesson } from "@/domain/teacher-course";
import { updateTeacherCourseBuilder } from "@/lib/data/teacher-courses";

// Sair pelo voltar/avancar do navegador (popstate do App Router), gesto do
// trackpad ou Alt+Esquerda desmonta o builder sem clique em link. O que ainda
// estava no debounce de 1,8 s do autosave se perdia, e o link digitado no
// estudio sem blur tambem. beforeunload nao dispara nessa navegacao.

const youtube = "https://www.youtube.com/watch?v=abc";
const vimeo = "https://vimeo.com/123456";
const drive = "https://drive.example.test/file/d/abc/view";

const mocks = vi.hoisted(() => ({
  course: null as TeacherCourse | null,
  user: { uid: "teacher-1" },
  router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
  searchParams: new URLSearchParams("courseId=course-1&tab=content&module=m1"),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  useSearchParams: () => mocks.searchParams,
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ user: mocks.user }),
}));

vi.mock("@/lib/data/teacher-courses", () => ({
  subscribeToTeacherCourse: vi.fn((_id: string, onData: (course: TeacherCourse | null) => void) => {
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
  CourseAssetUploadCancelled: class CourseAssetUploadCancelled extends Error {},
  deleteCourseAsset: vi.fn(),
  fetchCourseAssets: () => Promise.resolve([]),
  subscribeToCourseAssets: (_id: string, onAssets: (assets: CourseAsset[]) => void) => {
    onAssets([]);
    return () => undefined;
  },
  syncLessonPreviewAssets: () => Promise.resolve(),
  uploadCourseAsset: vi.fn(),
  uploadLessonVideoToBunny: vi.fn(),
}));

vi.mock("@/lib/bunny/config", () => ({ isBunnyConfigured: false }));
vi.mock("@/components/teacher/course-asset-uploader", () => ({ CourseAssetUploader: () => null }));
vi.mock("@/components/courses/bunny-video-player", () => ({ BunnyVideoPlayer: () => null }));
vi.mock("@/components/shared/protected-asset-preview", () => ({ ProtectedAssetPreview: () => null }));
vi.mock("@/components/learn/trusted-embed-player", () => ({ TrustedEmbedPlayer: () => null }));

function courseWith(lessons: TeacherLesson[] = []): TeacherCourse {
  return {
    id: "course-1",
    ownerId: "teacher-1",
    title: "Clinical performance foundations",
    summary: "Build a repeatable practice for evidence-informed performance work.",
    category: "Applied Psychology & Behavior",
    categories: ["Applied Psychology & Behavior"],
    status: "draft",
    modules: [{ id: "m1", title: "Start here", lessons }],
    lessonCount: lessons.length,
    priceAmountMinor: null,
    currency: "USD",
    paymentType: "one_time",
  };
}

async function renderBuilder() {
  const view = render(
    <I18nProvider initialLocale="en">
      <CourseBuilderStudio />
    </I18nProvider>,
  );
  await screen.findByRole("heading", { name: "Clinical performance foundations" });
  return view;
}

const moduleName = () => screen.getByRole("textbox", { name: "Module 1" });
const lastPayload = () => vi.mocked(updateTeacherCourseBuilder).mock.calls.at(-1)?.[1];
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("builder grava o rascunho pendente ao sair", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.course = courseWith();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    Reflect.deleteProperty(document, "visibilityState");
  });

  it("sair (desmontar) antes dos 1,8 s grava a edicao uma vez so", async () => {
    const { unmount } = await renderBuilder();
    fireEvent.change(moduleName(), { target: { value: "Start here, renamed" } });

    unmount();

    expect(updateTeacherCourseBuilder).toHaveBeenCalledTimes(1);
    expect(lastPayload()?.modules?.[0].title).toBe("Start here, renamed");
    // O debounce morreu com a descarga: nada de segundo save.
    await wait(2200);
    expect(updateTeacherCourseBuilder).toHaveBeenCalledTimes(1);
  }, 10000);

  it("pagehide e aba escondida gravam na hora, sem save repetido", async () => {
    const { unmount } = await renderBuilder();
    fireEvent.change(moduleName(), { target: { value: "Start here, renamed" } });

    window.dispatchEvent(new Event("pagehide"));
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));

    expect(updateTeacherCourseBuilder).toHaveBeenCalledTimes(1);
    expect(lastPayload()?.modules?.[0].title).toBe("Start here, renamed");
    await wait(2200);
    unmount();
    expect(updateTeacherCourseBuilder).toHaveBeenCalledTimes(1);
  }, 10000);

  it("sem edicao pendente, sair nao grava nada", async () => {
    const { unmount } = await renderBuilder();

    window.dispatchEvent(new Event("pagehide"));
    unmount();

    expect(updateTeacherCourseBuilder).not.toHaveBeenCalled();
  });

  it("link digitado no estudio e ainda sem blur vai junto ao sair", async () => {
    mocks.course = courseWith([
      { id: "l1", title: "Welcome", type: "video", description: "", videoSource: "youtube", externalUrl: youtube },
    ]);
    const { unmount } = await renderBuilder();
    fireEvent.click(screen.getByRole("button", { name: "Edit content" }));
    fireEvent.change(screen.getByRole("textbox", { name: "YouTube or Vimeo URL" }), {
      target: { value: vimeo },
    });

    unmount();

    expect(updateTeacherCourseBuilder).toHaveBeenCalledTimes(1);
    expect(lastPayload()?.modules?.[0].lessons[0]).toEqual(
      expect.objectContaining({ id: "l1", externalUrl: vimeo, videoSource: "youtube" }),
    );
  });

  it("sair nunca abre confirmacao: link que pediria uma nao e gravado", async () => {
    mocks.course = courseWith([
      { id: "l1", title: "Welcome", type: "video", description: "", externalUrl: drive },
    ]);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { unmount } = await renderBuilder();
    fireEvent.click(screen.getByRole("button", { name: "Add video" }));
    fireEvent.click(screen.getByRole("button", { name: "Replace with link" }));
    fireEvent.change(screen.getByRole("textbox", { name: "YouTube or Vimeo URL" }), {
      target: { value: vimeo },
    });

    unmount();

    expect(confirm).not.toHaveBeenCalled();
    expect(updateTeacherCourseBuilder).not.toHaveBeenCalled();
  });
});
