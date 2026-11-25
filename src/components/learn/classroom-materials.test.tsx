import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import { EnrolledCourseWorkspace } from "@/components/learn/enrolled-course-workspace";
import { groupReleasedMaterials } from "@/components/learn/course-materials-panel";
import type { CourseAsset } from "@/domain/course-asset";
import type { Course } from "@/domain/learning";
import { getProtectedCourseAssetObjectUrl } from "@/lib/data/course-assets";

/**
 * Materials in the learner's classroom:
 *   - the Materials tab lists the files of ALL lessons already released, by
 *     module and lesson, in the teacher's order; a locked lesson is not included;
 *   - a file-only lesson shows the file with a big download button, not
 *     "Media not attached yet";
 *   - "Download" asks for the signed link (with the file name) ON CLICK, not
 *     when the tab opens; a locked lesson has no button, and a refusal from storage becomes
 *     a notice, not a download;
 *   - in a lesson with a video, the attachment list shows the name given by the teacher,
 *     with no "Preview" badge on material, and says which program opens .xmind.
 */

const mocks = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
  completed: [] as string[],
  assets: [] as CourseAsset[],
  // The same object on every call, like the real provider: a new `user`
  // on every render resubscribes the enrollment endlessly and blows up memory.
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
  // The download link is distinguished from the open link by the name at the end.
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

// Sequential: lesson 1 opens right away; lesson 2 after finishing 1; lesson 3 after 2.
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

// The button tells the browser to download by clicking an <a> with the signed link.
let linkClicks: MockInstance<HTMLAnchorElement["click"]>;
const downloadsStarted = () => linkClicks.mock.contexts.map((link) => (link as HTMLAnchorElement).href);
const signedAssetIds = () => vi.mocked(getProtectedCourseAssetObjectUrl).mock.calls.map(([asset]) => asset.id);

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  mocks.searchParams = new URLSearchParams();
  mocks.completed = ["l1"];
  mocks.assets = assets;
  vi.mocked(getProtectedCourseAssetObjectUrl).mockClear();
  linkClicks = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});

afterEach(() => linkClicks.mockRestore());

describe("Materials tab", () => {
  it("groups only what is released, by module and lesson, in the teacher's order", () => {
    const released = new Set(["l1", "l2"]);
    const groups = groupReleasedMaterials(course.modules, assets, (id) => released.has(id));

    expect(groups.count).toBe(4);
    expect(groups.courseFiles.map((asset) => asset.id)).toEqual(["syllabus"]);
    expect(groups.modules.map((entry) => entry.module.id)).toEqual(["m1"]);
    expect(groups.modules[0].lessons.map((entry) => [entry.lesson.id, entry.files.map((asset) => asset.id)]))
      .toEqual([["l1", ["slides", "workbook"]], ["l2", ["plan"]]]);
  });

  it("in the classroom, lists the released files with a download button and hides the locked lesson", async () => {
    render(<EnrolledCourseWorkspace course={course} tab="materials" enableFirestoreAssets />);

    const panel = screen.getByRole("heading", { level: 2, name: "Files to download from your lessons" }).closest("section")!;
    expect(screen.getByRole("link", { name: /^Materials\s*4$/ })).toBeInTheDocument();
    expect(within(panel).getByRole("heading", { level: 3, name: "Getting started" })).toBeInTheDocument();
    expect(within(panel).getByRole("heading", { level: 4, name: "Welcome" })).toBeInTheDocument();
    expect(within(panel).getByRole("heading", { level: 3, name: "Course files" })).toBeInTheDocument();
    // Teacher's order: Slides (position 0) before Workbook (1).
    const names = within(panel).getAllByText(/^(Slides|Workbook|plan\.pdf|Syllabus\.pdf)$/).map((node) => node.textContent);
    expect(names).toEqual(["Syllabus.pdf", "Slides", "Workbook", "plan.pdf"]);
    // Lesson 3 (locked) does not show up: not the module, not the file, not a link.
    expect(within(panel).queryByText("Going deeper")).toBeNull();
    expect(within(panel).queryByText("advanced.pdf")).toBeNull();
    expect(within(panel).queryByText("thumb.png")).toBeNull();

    // Opening the tab does not request any link (there used to be 4 requests here, one per file).
    await act(async () => {});
    expect(getProtectedCourseAssetObjectUrl).not.toHaveBeenCalled();
    expect(within(panel).getAllByRole("button", { name: /^Download / })).toHaveLength(4);

    await act(async () => {
      fireEvent.click(within(panel).getByRole("button", { name: "Download Workbook" }));
    });
    expect(vi.mocked(getProtectedCourseAssetObjectUrl).mock.calls).toEqual([
      [expect.objectContaining({ id: "workbook" }), { download: true }],
    ]);
    expect(downloadsStarted()).toEqual(["https://storage.test/workbook?download=wb-final-v3.pdf"]);
    expect(signedAssetIds()).not.toContain("secret");
  });

  it("while the link is on its way, the button shows it is loading and ignores another click", async () => {
    let finish!: (url: string) => void;
    vi.mocked(getProtectedCourseAssetObjectUrl).mockImplementationOnce(
      () => new Promise<string>((resolve) => { finish = resolve; }),
    );
    render(<EnrolledCourseWorkspace course={course} tab="materials" enableFirestoreAssets />);
    const button = screen.getByRole("button", { name: "Download Slides" });

    await act(async () => {
      fireEvent.click(button);
    });
    expect(button).toHaveAttribute("aria-busy", "true");
    fireEvent.click(button);
    expect(getProtectedCourseAssetObjectUrl).toHaveBeenCalledOnce();

    await act(async () => finish("https://storage.test/slides?download=zz-slides.pdf"));
    expect(button).toHaveAttribute("aria-busy", "false");
    expect(downloadsStarted()).toEqual(["https://storage.test/slides?download=zz-slides.pdf"]);
  });

  it("with no released file, says there is nothing to download yet", () => {
    mocks.assets = [file("secret", "l3", "advanced.pdf")];
    mocks.completed = [];
    render(<EnrolledCourseWorkspace course={course} tab="materials" enableFirestoreAssets />);

    expect(screen.getByText("No files to download yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Download/ })).toBeNull();
  });
});

describe("file-only lesson", () => {
  it("shows the file with a big download button, without 'Media not attached yet'", async () => {
    mocks.searchParams = new URLSearchParams("lesson=l2");
    render(<EnrolledCourseWorkspace course={course} enableFirestoreAssets />);

    const download = await screen.findByRole("button", { name: "Download plan.pdf" });
    expect(download).toHaveClass("button-lg");
    expect(screen.getByText("This lesson is a file. Download it to open or save it on your phone or computer.")).toBeInTheDocument();
    expect(screen.queryByText("Media not attached yet")).toBeNull();

    await act(async () => {
      fireEvent.click(download);
    });
    expect(downloadsStarted()).toEqual(["https://storage.test/plan?download=plan.pdf"]);
  });

  it("a lesson that is still locked does not hand out a download link", async () => {
    mocks.searchParams = new URLSearchParams("lesson=l3");
    render(<EnrolledCourseWorkspace course={course} enableFirestoreAssets />);

    expect(document.querySelector(".member-video-empty h3")).toHaveTextContent("Lesson locked");
    expect(screen.queryByText(/^This lesson is a file\./)).toBeNull();
    await act(async () => {});
    expect(screen.queryByRole("button", { name: /Download/ })).toBeNull();
    expect(signedAssetIds()).not.toContain("secret");
  });

  it("when storage refuses the link, the notice appears and nothing is downloaded", async () => {
    vi.mocked(getProtectedCourseAssetObjectUrl).mockRejectedValueOnce(new Error("denied"));
    mocks.searchParams = new URLSearchParams("lesson=l2");
    render(<EnrolledCourseWorkspace course={course} enableFirestoreAssets />);

    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Download plan.pdf" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Asset access is protected. Try again after refreshing your session.");
    expect(screen.queryByText("denied")).toBeNull();
    expect(downloadsStarted()).toEqual([]);
  });
});

describe("attachments of a lesson with a video", () => {
  it("show the name given by the teacher, with no 'Preview' on material, and the mind map program", async () => {
    mocks.searchParams = new URLSearchParams("lesson=l1");
    mocks.assets = [
      file("video", "l1", "lesson-1.mp4", { kind: "lesson_video", contentType: "video/mp4" }),
      file("slides", "l1", "zz-slides.pdf", { title: "Slides", position: 0 }),
      // Marked as "preview" back when the old box existed: it stays enrolled-only.
      file("map", "l1", "map.xmind", { position: 1, isPreview: true, contentType: "application/vnd.xmind.workbook" }),
      file("freemind", "l1", "ideas.mm", { position: 2, contentType: "application/x-freemind" }),
    ];
    render(<EnrolledCourseWorkspace course={course} enableFirestoreAssets />);

    const slides = (await screen.findByText("Slides")).closest("div.rounded-lg") as HTMLElement;
    expect(within(slides).queryByText("zz-slides.pdf")).toBeNull();
    const map = screen.getByText("map.xmind").closest("div.rounded-lg") as HTMLElement;
    // Neither "Enrolled" (it applied to every attachment) nor the "Preview" badge on material.
    // A mind map has no preview: it stays as it was, "Open file" and "Download".
    expect(within(map).queryByText("Enrolled")).toBeNull();
    expect(within(map).queryByText("Preview")).toBeNull();
    expect(await within(map).findByRole("link", { name: "Open file" })).toBeInTheDocument();
    expect(within(map).getByRole("button", { name: "Download" })).toBeInTheDocument();
    expect(within(map).getByText("To open it, use the free app XMind.")).toBeInTheDocument();
    expect(screen.getByText("To open it, use the free app FreeMind or Freeplane.")).toBeInTheDocument();
  });

  it("the attachment preview only mounts when the person asks: opening the lesson does not request a link per file", async () => {
    mocks.searchParams = new URLSearchParams("lesson=l1");
    mocks.assets = [
      file("video", "l1", "lesson-1.mp4", { kind: "lesson_video", contentType: "video/mp4" }),
      file("slides", "l1", "zz-slides.pdf", { title: "Slides", position: 0 }),
    ];
    render(<EnrolledCourseWorkspace course={course} enableFirestoreAssets />);

    const preview = await screen.findByRole("button", { name: "Preview Slides" });
    await act(async () => {});
    expect(signedAssetIds()).not.toContain("slides");
    expect(preview).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "Download Slides" })).toHaveClass("button-outline");

    await act(async () => {
      fireEvent.click(preview);
    });
    expect(signedAssetIds()).toContain("slides");
    // The SAME button swaps its label (keyboard focus is not lost), with the file name.
    const hide = screen.getByRole("button", { name: "Hide preview of Slides" });
    expect(hide).toBe(preview);
    expect(hide).toHaveAttribute("aria-expanded", "true");
  });

  it("audio in the lesson gets 'Preview', which opens 'Open file' to play in the browser", async () => {
    mocks.searchParams = new URLSearchParams("lesson=l1");
    mocks.assets = [
      file("video", "l1", "lesson-1.mp4", { kind: "lesson_video", contentType: "video/mp4" }),
      file("talk", "l1", "talk.mp3", { contentType: "audio/mpeg" }),
    ];
    render(<EnrolledCourseWorkspace course={course} enableFirestoreAssets />);

    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Preview talk.mp3" }));
    });
    expect(await screen.findByRole("link", { name: "Open file" })).toBeInTheDocument();
  });
});
