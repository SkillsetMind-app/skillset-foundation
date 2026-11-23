import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { CourseBuilderStudio } from "@/components/teacher/course-builder-studio";
import { stubDialogs } from "@/components/teacher/confirm-test-helpers";
import { LessonUploadProvider } from "@/components/teacher/lesson-upload-provider";
import type { CourseAsset } from "@/domain/course-asset";
import type { TeacherCourse } from "@/domain/teacher-course";
import { syncLessonPreviewAssets } from "@/lib/data/course-assets";

// A aula de amostra se escolhe em quatro lugares: a página da aula, o seletor
// da aba Pricing, o menu da linha e a caixa de aula nova. Só a página da aula
// sincronizava os vídeos (is_preview): nos outros três a loja dizia "Video
// unavailable" para a amostra e, trocando de A para B, os vídeos de A seguiam
// marcados como amostra e os de B não. Agora os quatro passam pela mesma
// função (course-builder-studio.tsx, chooseFreePreviewLesson).

const mocks = vi.hoisted(() => ({
  course: null as TeacherCourse | null,
  assets: [] as CourseAsset[],
  user: { uid: "teacher-1" },
  router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
  searchParams: new URLSearchParams("courseId=course-1&tab=content"),
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
  fetchCreatorActivationBlocked: () => Promise.resolve(false),
}));

vi.mock("@/lib/data/course-assets", () => ({
  CourseAssetUploadCancelled: class CourseAssetUploadCancelled extends Error {},
  deleteCourseAsset: vi.fn(),
  fetchCourseAssets: vi.fn(() => Promise.resolve(mocks.assets)),
  subscribeToCourseAssets: (_id: string, onAssets: (assets: CourseAsset[]) => void) => {
    onAssets(mocks.assets);
    return Object.assign(() => undefined, { reload: async () => {} });
  },
  syncLessonPreviewAssets: vi.fn(() => Promise.resolve()),
  uploadCourseAsset: vi.fn(),
  uploadLessonVideoToBunny: vi.fn(),
}));

vi.mock("@/lib/bunny/config", () => ({ isBunnyConfigured: false }));
vi.mock("@/lib/data/lesson-video-selection", () => ({ activateUploadedLessonVideo: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ getSupabaseBrowserClient: () => ({ auth: {
  onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
} }) }));
vi.mock("@/components/teacher/course-asset-uploader", () => ({ CourseAssetUploader: () => null }));
vi.mock("@/components/courses/bunny-video-player", () => ({ BunnyVideoPlayer: () => null }));
vi.mock("@/components/shared/protected-asset-preview", () => ({ ProtectedAssetPreview: () => null }));
vi.mock("@/components/learn/trusted-embed-player", () => ({ TrustedEmbedPlayer: () => null }));

const sync = vi.mocked(syncLessonPreviewAssets);
const title = "Clinical performance foundations";

function courseFixture(): TeacherCourse {
  return {
    id: "course-1",
    ownerId: "teacher-1",
    title,
    summary: "Build a repeatable practice for evidence-informed performance work.",
    category: "Applied Psychology & Behavior",
    categories: ["Applied Psychology & Behavior"],
    status: "draft",
    modules: [
      {
        id: "m1",
        title: "Start here",
        lessons: [
          { id: "l1", title: "Welcome", type: "text", description: "", contentText: "Read this first." },
          { id: "l2", title: "Intro", type: "text", description: "", contentText: "Then this." },
        ],
      },
    ],
    lessonCount: 2,
    priceAmountMinor: 9700,
    currency: "USD",
    paymentType: "one_time",
  };
}

function openAt(query: string) {
  mocks.searchParams = new URLSearchParams(query);
}

async function renderBuilder() {
  render(
    <I18nProvider initialLocale="en">
      <LessonUploadProvider><CourseBuilderStudio /></LessonUploadProvider>
    </I18nProvider>,
  );
  await screen.findByRole("heading", { name: title, level: 1 });
}

const card = () => document.querySelector("#builder-sec-modules") as HTMLElement;

describe("aula de amostra: as quatro portas sincronizam os vídeos", () => {
  let restoreDialogs = () => {};
  beforeEach(() => {
    vi.clearAllMocks();
    sync.mockImplementation(() => Promise.resolve());
    mocks.course = courseFixture();
    mocks.assets = [];
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ offers: [] }) })));
    restoreDialogs = stubDialogs();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    restoreDialogs();
  });

  it("página da aula: marcar sincroniza a aula, desmarcar sincroniza nenhuma", async () => {
    openAt("courseId=course-1&tab=content&module=m1&lesson=l1");
    await renderBuilder();
    fireEvent.click(screen.getByRole("button", { name: /^Settings/ }));
    const toggle = () => screen.getByRole("button", { name: "Use this lesson as the free preview" });

    fireEvent.click(toggle());
    expect(sync).toHaveBeenCalledExactlyOnceWith("course-1", "l1");
    expect(toggle()).toHaveAttribute("aria-pressed", "true");

    // A mesma aula de novo: limpa, nunca sincroniza "l1" uma segunda vez.
    fireEvent.click(toggle());
    expect(sync.mock.calls).toEqual([["course-1", "l1"], ["course-1", ""]]);
  });

  // O "mesmo valor não sincroniza" não se prova aqui: o React não dispara o
  // onChange do <select> quando o valor não muda. Nas duas chaves (página da
  // aula e menu da linha) ele se prova: escolher a amostra que já é a amostra
  // limpa (uma sincronia com ""), nunca uma segunda sincronia com a mesma aula.
  it("seletor da aba Pricing: troca sincroniza, vazio limpa", async () => {
    openAt("courseId=course-1&tab=pricing");
    await renderBuilder();
    const select = await screen.findByRole("combobox", { name: "Free preview lesson" });

    fireEvent.change(select, { target: { value: "l2" } });
    expect(sync).toHaveBeenCalledExactlyOnceWith("course-1", "l2");

    fireEvent.change(select, { target: { value: "l1" } });
    expect(sync).toHaveBeenLastCalledWith("course-1", "l1");

    fireEvent.change(select, { target: { value: "" } });
    expect(sync.mock.calls).toEqual([["course-1", "l2"], ["course-1", "l1"], ["course-1", ""]]);
  });

  it("menu da linha: marca e desmarca pela mesma função; falha na sincronia não derruba nada", async () => {
    openAt("courseId=course-1&tab=content&module=m1");
    await renderBuilder();
    fireEvent.click(within(card()).getByRole("button", { name: 'More actions for "Welcome"' }));

    sync.mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(within(card()).getByRole("button", { name: "Mark free preview" }));
    expect(sync).toHaveBeenCalledExactlyOnceWith("course-1", "l1");
    // A promessa recusada é engolida: a tela segue de pé, com a marca.
    await Promise.resolve();
    expect(within(card()).getByRole("button", { name: "Free preview selected" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: title, level: 1 })).toBeInTheDocument();

    // A mesma aula de novo: limpa, nunca sincroniza "l1" uma segunda vez.
    fireEvent.click(within(card()).getByRole("button", { name: "Free preview selected" }));
    expect(sync.mock.calls).toEqual([["course-1", "l1"], ["course-1", ""]]);
  });

  it("caixa de aula nova com a amostra marcada: sincroniza a aula nova", async () => {
    openAt("courseId=course-1&tab=content&module=m1");
    await renderBuilder();
    fireEvent.click(screen.getByRole("button", { name: "Add lesson to module 1" }));
    const form = screen.getByRole("button", { name: "Add lesson" }).closest("form")!;
    fireEvent.change(within(form).getByRole("textbox", { name: "Lesson title" }), { target: { value: "Bonus" } });
    fireEvent.click(within(form).getByRole("checkbox", { name: "Make this lesson the public free preview." }));
    fireEvent.click(within(form).getByRole("button", { name: "Add lesson" }));

    expect(sync).toHaveBeenCalledOnce();
    const [courseId, lessonId] = sync.mock.calls[0];
    expect(courseId).toBe("course-1");
    expect(lessonId).not.toBe("");
    expect(["l1", "l2"]).not.toContain(lessonId);
  });
});
