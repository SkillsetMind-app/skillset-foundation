import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { CourseBuilderStudio } from "@/components/teacher/course-builder-studio";
import type { CourseAsset } from "@/domain/course-asset";
import type { CourseEvent } from "@/domain/course-event";
import type { TeacherCourse, TeacherCourseProductFormat } from "@/domain/teacher-course";

// O construtor se adapta ao tipo gravado na criacao (courses.product_format):
// comunidade com aula opcional, evento com a sessao no lugar da aula, e-book
// so com o arquivo. Curso continua igual.

const mocks = vi.hoisted(() => ({
  course: null as TeacherCourse | null,
  assets: [] as CourseAsset[],
  sessions: [] as CourseEvent[],
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
  subscribeToTeacherCourse: (_id: string, onData: (course: TeacherCourse | null) => void) => {
    onData(mocks.course);
    return () => undefined;
  },
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
    return () => undefined;
  },
  syncLessonPreviewAssets: () => Promise.resolve(),
  uploadCourseAsset: vi.fn(),
  uploadLessonVideoToBunny: vi.fn(),
}));

vi.mock("@/lib/data/course-events", () => ({
  subscribeToTeacherCourseEvents: (_uid: string, onEvents: (events: CourseEvent[]) => void) => {
    onEvents(mocks.sessions);
    return () => undefined;
  },
}));

vi.mock("@/lib/bunny/config", () => ({ isBunnyConfigured: false }));
vi.mock("@/lib/data/lesson-video-selection", () => ({ activateUploadedLessonVideo: vi.fn() }));
vi.mock("@/components/teacher/course-asset-uploader", () => ({ CourseAssetUploader: () => null }));
vi.mock("@/components/courses/bunny-video-player", () => ({ BunnyVideoPlayer: () => null }));
vi.mock("@/components/shared/protected-asset-preview", () => ({ ProtectedAssetPreview: () => null }));
vi.mock("@/components/learn/trusted-embed-player", () => ({ TrustedEmbedPlayer: () => null }));

function product(productFormat: TeacherCourseProductFormat, lessons: boolean): TeacherCourse {
  return {
    id: "course-1",
    ownerId: "teacher-1",
    title: "Clinical performance foundations",
    summary: "Build a repeatable practice for evidence-informed performance work.",
    category: "Applied Psychology & Behavior",
    categories: ["Applied Psychology & Behavior"],
    status: "draft",
    productFormat,
    modules: lessons
      ? [{ id: "m1", title: "Download", lessons: [{ id: "l1", title: "Workbook", type: "download", description: "" }] }]
      : [],
    lessonCount: lessons ? 1 : 0,
    priceAmountMinor: 0,
    currency: "USD",
    paymentType: "free",
  };
}

function session(): CourseEvent {
  return {
    id: "event-1",
    courseId: "course-1",
    courseSlug: "course-1",
    courseTitle: "Clinical performance foundations",
    ownerId: "teacher-1",
    title: "Clinical performance foundations",
    description: "",
    type: "live_class",
    status: "scheduled",
    startsAt: "2026-11-20T22:30:00.000Z",
    externalUrl: "",
    recordingAssetId: null,
  };
}

function material(): CourseAsset {
  return {
    id: "asset-1",
    courseId: "course-1",
    ownerId: "teacher-1",
    kind: "lesson_material",
    fileName: "workbook.pdf",
    contentType: "application/pdf",
    size: 1024,
    storagePath: "courses/course-1/workbook.pdf",
    isPreview: false,
    lessonId: "l1",
  };
}

function renderBuilder(tab: string) {
  mocks.searchParams.set("tab", tab);
  return render(
    <I18nProvider initialLocale="en">
      <CourseBuilderStudio />
    </I18nProvider>,
  );
}

// Itens obrigatorios da lista "o que falta para publicar".
async function requiredChecklist() {
  renderBuilder("review");
  const groups = await screen.findAllByText(/^(Content saved|Page prepared|Sale available)/);
  return groups.map((group) => group.closest("section") as HTMLElement);
}

beforeEach(() => {
  mocks.assets = [];
  mocks.sessions = [];
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("comunidade: aulas opcionais", () => {
  it("a aba de conteudo diz que aula e opcional e continua deixando criar modulo", async () => {
    mocks.course = product("community", false);
    renderBuilder("content");

    expect(await screen.findByText("Optional: add lessons or files.")).toBeInTheDocument();
    expect(screen.getByText("Add your first module")).toBeInTheDocument();
  });

  it("publicar nao cobra modulo nem aula", async () => {
    mocks.course = product("community", false);
    const [content] = await requiredChecklist();

    expect(within(content).queryByText("Module")).toBeNull();
    expect(within(content).queryByText("Lesson")).toBeNull();
  });
});

describe("evento ao vivo: a sessao e o conteudo", () => {
  it("sem sessao: diz que falta e leva a Agenda com o formulario aberto", async () => {
    mocks.course = product("live_event", false);
    renderBuilder("content");

    expect(await screen.findByText("No session scheduled yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Schedule the session" })).toHaveAttribute(
      "href",
      "/teach/events?courseId=course-1&newEvent=1",
    );
    expect(screen.getByRole("heading", { name: "Live session" })).toBeInTheDocument();
    expect(screen.getByText("Replay (optional)")).toBeInTheDocument();
  });

  it("com sessao: mostra a data, avisa do link que falta e leva a Agenda para editar", async () => {
    mocks.course = product("live_event", false);
    mocks.sessions = [session()];
    renderBuilder("content");

    expect(await screen.findByText("Link not added yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Edit in the Agenda" })).toHaveAttribute(
      "href",
      "/teach/events?courseId=course-1",
    );
  });

  it("publicar cobra a sessao, nao a aula", async () => {
    mocks.course = product("live_event", false);
    const [content] = await requiredChecklist();

    expect(within(content).getByText("Live session")).toBeInTheDocument();
    expect(within(content).queryByText("Lesson")).toBeNull();
  });
});

describe("e-book: so o arquivo", () => {
  it("a aba de conteudo mostra o envio de arquivo, sem modulo, aula nem video", async () => {
    mocks.course = product("ebook", true);
    renderBuilder("content");

    expect(await screen.findByRole("heading", { name: "File to download" })).toBeInTheDocument();
    expect(screen.queryByText("Add your first module")).toBeNull();
    expect(screen.queryByRole("button", { name: /Add module/i })).toBeNull();
    expect(screen.queryByRole("navigation", { name: /Lesson setup/i })).toBeNull();
    expect(screen.queryByText("Workbook")).toBeNull();
    expect(screen.queryByText(/1 module/i)).toBeNull();
  });

  it("publicar cobra um arquivo e fica pronto quando ele chega", async () => {
    mocks.course = product("ebook", true);
    const [content] = await requiredChecklist();
    expect(within(content).getByText("File to download")).toBeInTheDocument();
    expect(within(content).queryByText("Lesson content")).toBeNull();
    cleanup();

    mocks.assets = [material()];
    const [ready] = await requiredChecklist();
    await waitFor(() => {
      expect(within(ready).getByText(/^Content saved/).closest("p")).toHaveTextContent(/2 of 2/);
    });
  });
});

describe("curso: igual a antes", () => {
  it("publicar cobra modulo e aula", async () => {
    mocks.course = product("course", false);
    const [content] = await requiredChecklist();

    expect(within(content).getByText("Module")).toBeInTheDocument();
    expect(within(content).getByText("Lesson")).toBeInTheDocument();
  });
});
