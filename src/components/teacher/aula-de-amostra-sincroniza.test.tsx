import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { CourseBuilderStudio } from "@/components/teacher/course-builder-studio";
import { stubDialogs } from "@/components/teacher/confirm-test-helpers";
import { LessonUploadProvider } from "@/components/teacher/lesson-upload-provider";
import type { CourseAsset } from "@/domain/course-asset";
import type { TeacherCourse } from "@/domain/teacher-course";
import { syncLessonPreviewAssets } from "@/lib/data/course-assets";

// The sample lesson is chosen in four places: the lesson page, the picker
// on the Pricing tab, the row menu and the new-lesson box. Only the lesson page
// synced the videos (is_preview): in the other three the storefront said "Video
// unavailable" for the sample and, when switching from A to B, A's videos stayed
// marked as sample and B's did not. Now all four go through the same
// function (course-builder-studio.tsx, chooseFreePreviewLesson).

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

describe("sample lesson: the four entry points sync the videos", () => {
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

  it("lesson page: checking syncs the lesson, unchecking syncs none", async () => {
    openAt("courseId=course-1&tab=content&module=m1&lesson=l1");
    await renderBuilder();
    fireEvent.click(screen.getByRole("tab", { name: /^Settings/ }));
    const toggle = () => screen.getByRole("switch", { name: "Use this lesson as the free preview" });

    fireEvent.click(toggle());
    expect(sync).toHaveBeenCalledExactlyOnceWith("course-1", "l1");
    expect(toggle()).toHaveAttribute("aria-checked", "true");

    // The same lesson again: it clears, and never syncs "l1" a second time.
    fireEvent.click(toggle());
    expect(sync.mock.calls).toEqual([["course-1", "l1"], ["course-1", ""]]);
  });

  // The "same value does not sync" case is not proved here: React does not fire the
  // onChange of the <select> when the value does not change. In the two toggles (lesson page
  // and row menu) it is proved: choosing the sample that already is the sample
  // clears it (a sync with ""), never a second sync with the same lesson.
  it("Pricing tab picker: switching syncs, empty clears", async () => {
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

  it("row menu: marks and unmarks through the same function; a sync failure does not break anything", async () => {
    openAt("courseId=course-1&tab=content&module=m1");
    await renderBuilder();
    fireEvent.click(within(card()).getByRole("button", { name: 'More actions for "Welcome"' }));

    sync.mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(within(card()).getByRole("button", { name: "Mark free preview" }));
    expect(sync).toHaveBeenCalledExactlyOnceWith("course-1", "l1");
    // The rejected promise is swallowed: the screen stays up, with the mark.
    await Promise.resolve();
    expect(within(card()).getByRole("button", { name: "Free preview selected" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: title, level: 1 })).toBeInTheDocument();

    // The same lesson again: it clears, and never syncs "l1" a second time.
    fireEvent.click(within(card()).getByRole("button", { name: "Free preview selected" }));
    expect(sync.mock.calls).toEqual([["course-1", "l1"], ["course-1", ""]]);
  });

  it("new-lesson box with the sample checked: syncs the new lesson", async () => {
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
