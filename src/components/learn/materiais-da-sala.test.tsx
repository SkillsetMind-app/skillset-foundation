import { act, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EnrolledCourseWorkspace } from "@/components/learn/enrolled-course-workspace";
import { groupReleasedMaterials } from "@/components/learn/course-materials-panel";
import type { CourseAsset } from "@/domain/course-asset";
import type { Course } from "@/domain/learning";
import { getProtectedCourseAssetObjectUrl } from "@/lib/data/course-assets";

/**
 * Materiais na sala do aluno:
 *   - a aba Materiais lista os arquivos de TODAS as aulas já liberadas, por
 *     módulo e aula, na ordem do professor; aula trancada não entra;
 *   - aula só de arquivo mostra o arquivo com um botão grande de baixar, não
 *     "Media not attached yet";
 *   - "Download" usa o link assinado com o nome do arquivo; sem link (aula
 *     trancada, ou o storage recusou) não há botão que baixe.
 */

const mocks = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
  completed: [] as string[],
  assets: [] as CourseAsset[],
  // O mesmo objeto a cada chamada, como o provider de verdade: um `user` novo
  // a cada render reinscreve a matrícula sem fim e estoura a memória.
  auth: {
    status: "authenticated",
    user: { uid: "student-1", email: "student@example.com", roles: ["student"] },
  },
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => mocks.searchParams,
  usePathname: () => "/learn/courses/demo-course",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => mocks.auth,
}));

vi.mock("@/lib/data/enrollments", () => ({
  subscribeToEnrollment: vi.fn((_uid: string, _slug: string, onNext: (enrollment: unknown) => void) => {
    onNext({
      id: "enr-1", userId: "student-1", courseId: "course-1", courseSlug: "demo-course",
      courseTitle: "Demo course", courseCategory: "Leadership", courseImage: "",
      status: "active", source: "admin", progressPercent: 0, lastLessonId: null,
    });
    return vi.fn();
  }),
}));

vi.mock("@/lib/data/lesson-progress", () => ({
  recordLessonProgress: vi.fn(),
  subscribeToCompletedLessons: vi.fn((_enrollmentId: string, onNext: (lessonIds: string[]) => void) => {
    onNext(mocks.completed);
    return vi.fn();
  }),
}));

vi.mock("@/lib/data/lesson-content", () => ({
  subscribeToLessonContent: vi.fn((_courseId, onNext) => {
    onNext(new Map());
    return vi.fn();
  }),
  resolveLessonContent: vi.fn(() => ({})),
}));

vi.mock("@/lib/data/course-assets", () => ({
  subscribeToCourseAssets: vi.fn((_courseId: string, onNext: (assets: CourseAsset[]) => void) => {
    onNext(mocks.assets);
    return Object.assign(vi.fn(), { reload: vi.fn(async () => undefined) });
  }),
  // O link de baixar se distingue do de abrir pelo nome no fim.
  getProtectedCourseAssetObjectUrl: vi.fn(async (asset: CourseAsset, options?: { download?: boolean }) =>
    `https://storage.test/${asset.id}${options?.download ? `?download=${encodeURIComponent(asset.fileName)}` : ""}`),
}));

vi.mock("@/lib/data/course-events", () => ({
  subscribeToCourseEvents: vi.fn((_slug: string, onNext: (events: unknown[]) => void) => {
    onNext([]);
    return vi.fn();
  }),
}));

vi.mock("@/lib/data/community-posts", () => ({
  countOpenCommunityQuestions: vi.fn(() => new Promise<number>(() => {})),
  subscribeToCommunityPosts: vi.fn(() => vi.fn()),
  subscribeToCourseCommunityComments: vi.fn(() => vi.fn()),
  createCommunityPost: vi.fn(),
}));

vi.mock("@/lib/data/course-reviews", () => ({
  submitCourseReview: vi.fn(),
  subscribeToUserCourseReview: vi.fn((_courseId: string, _uid: string, onNext: (review: null) => void) => {
    onNext(null);
    return vi.fn();
  }),
}));

vi.mock("@/lib/posthog/events", () => ({
  track: new Proxy({}, { get: () => vi.fn() }),
}));

// Sequencial: a aula 1 abre já; a 2 depois de concluir a 1; a 3 depois da 2.
const course = {
  id: "course-1", slug: "demo-course", title: "Demo course", category: "Leadership",
  summary: "", image: null, membersTheme: "light", communityEnabled: false,
  dripStrategy: "sequential_progress",
  modules: [
    { id: "m1", title: "Getting started", summary: "", lessons: [
      { id: "l1", title: "Welcome", type: "video", duration: "", isPreview: false },
      { id: "l2", title: "Planning", type: "video", duration: "", isPreview: false },
    ] },
    { id: "m2", title: "Going deeper", summary: "", lessons: [
      { id: "l3", title: "Advanced", type: "video", duration: "", isPreview: false },
    ] },
  ],
} as unknown as Course;

function file(id: string, lessonId: string | null, fileName: string, extra: Partial<CourseAsset> = {}): CourseAsset {
  return {
    id, courseId: "course-1", ownerId: "teacher-1", kind: "lesson_material", fileName,
    contentType: "application/pdf", size: 2048, storagePath: `courses/course-1/assets/teacher-1/${id}/f.pdf`,
    isPreview: false, lessonId, ...extra,
  };
}

const assets = [
  file("workbook", "l1", "wb-final-v3.pdf", { title: "Workbook", position: 1 }),
  file("slides", "l1", "zz-slides.pdf", { title: "Slides", position: 0 }),
  file("plan", "l2", "plan.pdf", { position: 0 }),
  file("secret", "l3", "advanced.pdf", { position: 0 }),
  file("syllabus", null, "Syllabus.pdf"),
  file("thumb", "l1", "thumb.png", { kind: "lesson_thumbnail", contentType: "image/png" }),
];

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  mocks.searchParams = new URLSearchParams();
  mocks.completed = ["l1"];
  mocks.assets = assets;
  vi.mocked(getProtectedCourseAssetObjectUrl).mockClear();
});

describe("aba Materiais", () => {
  it("agrupa só o que está liberado, por módulo e aula, na ordem do professor", () => {
    const released = new Set(["l1", "l2"]);
    const groups = groupReleasedMaterials(course.modules, assets, (id) => released.has(id));

    expect(groups.count).toBe(4);
    expect(groups.courseFiles.map((asset) => asset.id)).toEqual(["syllabus"]);
    expect(groups.modules.map((entry) => entry.module.id)).toEqual(["m1"]);
    expect(groups.modules[0].lessons.map((entry) => [entry.lesson.id, entry.files.map((asset) => asset.id)]))
      .toEqual([["l1", ["slides", "workbook"]], ["l2", ["plan"]]]);
  });

  it("na sala, lista os arquivos liberados com botão de baixar e esconde a aula trancada", async () => {
    render(<EnrolledCourseWorkspace course={course} tab="materials" enableFirestoreAssets />);

    const panel = screen.getByRole("heading", { level: 2, name: "Files to download from your lessons" }).closest("section")!;
    expect(screen.getByRole("link", { name: /^Materials\s*4$/ })).toBeInTheDocument();
    expect(within(panel).getByRole("heading", { level: 3, name: "Getting started" })).toBeInTheDocument();
    expect(within(panel).getByRole("heading", { level: 4, name: "Welcome" })).toBeInTheDocument();
    expect(within(panel).getByRole("heading", { level: 3, name: "Course files" })).toBeInTheDocument();
    // Ordem do professor: Slides (posição 0) antes de Workbook (1).
    const names = within(panel).getAllByText(/^(Slides|Workbook|plan\.pdf|Syllabus\.pdf)$/).map((node) => node.textContent);
    expect(names).toEqual(["Syllabus.pdf", "Slides", "Workbook", "plan.pdf"]);
    // A aula 3 (trancada) não aparece: nem o módulo, nem o arquivo, nem um link.
    expect(within(panel).queryByText("Going deeper")).toBeNull();
    expect(within(panel).queryByText("advanced.pdf")).toBeNull();
    expect(within(panel).queryByText("thumb.png")).toBeNull();

    const download = await within(panel).findByRole("link", { name: "Download Workbook" });
    expect(download).toHaveAttribute("href", "https://storage.test/workbook?download=wb-final-v3.pdf");
    await waitFor(() => expect(getProtectedCourseAssetObjectUrl).toHaveBeenCalledTimes(4));
    expect(vi.mocked(getProtectedCourseAssetObjectUrl).mock.calls.every(([, options]) => options?.download)).toBe(true);
    expect(vi.mocked(getProtectedCourseAssetObjectUrl).mock.calls.map(([asset]) => asset.id)).not.toContain("secret");
  });

  it("sem arquivo liberado, diz que ainda não há o que baixar", () => {
    mocks.assets = [file("secret", "l3", "advanced.pdf")];
    mocks.completed = [];
    render(<EnrolledCourseWorkspace course={course} tab="materials" enableFirestoreAssets />);

    expect(screen.getByText("No files to download yet.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Download/ })).toBeNull();
  });
});

describe("aula só de arquivo", () => {
  it("mostra o arquivo com um botão grande de baixar, sem 'Media not attached yet'", async () => {
    mocks.searchParams = new URLSearchParams("lesson=l2");
    render(<EnrolledCourseWorkspace course={course} enableFirestoreAssets />);

    const download = await screen.findByRole("link", { name: "Download plan.pdf" });
    expect(download).toHaveAttribute("href", "https://storage.test/plan?download=plan.pdf");
    expect(download).toHaveClass("button-lg");
    expect(screen.getByText("This lesson is a file. Download it to read on your phone or computer.")).toBeInTheDocument();
    expect(screen.queryByText("Media not attached yet")).toBeNull();
  });

  it("aula ainda trancada não entrega link de baixar", async () => {
    mocks.searchParams = new URLSearchParams("lesson=l3");
    render(<EnrolledCourseWorkspace course={course} enableFirestoreAssets />);

    expect(document.querySelector(".member-video-empty h5")).toHaveTextContent("Lesson locked");
    expect(screen.queryByText("This lesson is a file. Download it to read on your phone or computer.")).toBeNull();
    await act(async () => {});
    expect(screen.queryByRole("link", { name: /Download/ })).toBeNull();
    expect(vi.mocked(getProtectedCourseAssetObjectUrl).mock.calls.map(([asset]) => asset.id)).not.toContain("secret");
  });

  it("quando o storage recusa o link, não há botão que baixe", async () => {
    vi.mocked(getProtectedCourseAssetObjectUrl).mockRejectedValueOnce(new Error("denied"));
    mocks.searchParams = new URLSearchParams("lesson=l2");
    render(<EnrolledCourseWorkspace course={course} enableFirestoreAssets />);

    expect(await screen.findByText("Asset access is protected. Try again after refreshing your session.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Download/ })).toBeNull();
  });
});
