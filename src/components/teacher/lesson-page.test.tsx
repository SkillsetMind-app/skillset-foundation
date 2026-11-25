import { act, cleanup, fireEvent, render, screen, waitFor, within, type RenderResult } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { CourseBuilderStudio } from "@/components/teacher/course-builder-studio";
import { clickConfirm, stubDialogs } from "@/components/teacher/confirm-test-helpers";
import { LessonUploadProvider } from "@/components/teacher/lesson-upload-provider";
import type { CourseAsset } from "@/domain/course-asset";
import type { TeacherCourse } from "@/domain/teacher-course";
import { subscribeToTeacherCourse, updateTeacherCourseBuilder } from "@/lib/data/teacher-courses";
import { fetchCourseAssets, uploadCourseAsset, uploadLessonVideoToBunny } from "@/lib/data/course-assets";
import { activateUploadedLessonVideo } from "@/lib/data/lesson-video-selection";

// Lesson page: Course > Module > Lesson, in place of the modal. The lesson lives in the URL
// (?module=M&lesson=L), like the module (#373), and the browser back button works.

const youtube = "https://www.youtube.com/watch?v=abc";
const vimeo = "https://vimeo.com/123456";

const mocks = vi.hoisted(() => ({
  onAuthChange: null as ((event: string, session: { user: { id: string } } | null) => void) | null,
  bunnyConfigured: false,
  course: null as TeacherCourse | null,
  // Course file list: the builder's fetch and the studio's realtime.
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
    return () => undefined;
  },
  syncLessonPreviewAssets: () => Promise.resolve(),
  uploadCourseAsset: vi.fn(),
  uploadLessonVideoToBunny: vi.fn(),
}));

vi.mock("@/lib/bunny/config", () => ({
  get isBunnyConfigured() { return mocks.bunnyConfigured; },
}));
vi.mock("@/lib/data/lesson-video-selection", () => ({ activateUploadedLessonVideo: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ getSupabaseBrowserClient: () => ({ auth: {
  onAuthStateChange: (callback: NonNullable<typeof mocks.onAuthChange>) => {
    mocks.onAuthChange = callback;
    return { data: { subscription: { unsubscribe: () => { mocks.onAuthChange = null; } } } };
  },
} }) }));
vi.mock("@/components/teacher/course-asset-uploader", () => ({ CourseAssetUploader: () => null }));
vi.mock("@/components/courses/bunny-video-player", () => ({ BunnyVideoPlayer: () => null }));
vi.mock("@/components/shared/protected-asset-preview", () => ({ ProtectedAssetPreview: () => null }));
vi.mock("@/components/learn/trusted-embed-player", () => ({ TrustedEmbedPlayer: () => null }));

function courseFixture(): TeacherCourse {
  return {
    id: "course-1",
    ownerId: "teacher-1",
    title: "Clinical performance foundations",
    summary: "Build a repeatable practice for evidence-informed performance work.",
    category: "Applied Psychology & Behavior",
    categories: ["Applied Psychology & Behavior"],
    status: "draft",
    modules: [
      {
        id: "m1",
        title: "Start here",
        lessons: [
          { id: "l1", title: "Welcome", type: "video", description: "", videoSource: "youtube", externalUrl: youtube },
        ],
      },
      { id: "m2", title: "Deep work", lessons: [] },
    ],
    lessonCount: 1,
    priceAmountMinor: null,
    currency: "USD",
    paymentType: "one_time",
  };
}

// Course with a lesson that has no content at all (Intro): only an uploaded file counts.
function withIntro(): TeacherCourse {
  const course = courseFixture();
  course.modules[0].lessons.push({ id: "l2", title: "Intro", type: "video", description: "" });
  return course;
}

function introVideo(): CourseAsset {
  return {
    id: "asset-intro",
    courseId: "course-1",
    ownerId: "teacher-1",
    kind: "lesson_video",
    fileName: "lesson.mp4",
    contentType: "video/mp4",
    size: 1024,
    storagePath: "courses/course-1/lesson.mp4",
    isPreview: false,
    lessonId: "l2",
  };
}

const introUrl = "/teach/builder?courseId=course-1&tab=content&module=m1&lesson=l2";
const missingIntro = /Missing: Intro\./;

const moduleUrl = "/teach/builder?courseId=course-1&tab=content&module=m1";
const lessonUrl = "/teach/builder?courseId=course-1&tab=content&module=m1&lesson=l1";

let view: RenderResult;

function tree() {
  return (
    <I18nProvider initialLocale="en">
      <LessonUploadProvider><CourseBuilderStudio /></LessonUploadProvider>
    </I18nProvider>
  );
}

function openAt(url: string) {
  mocks.searchParams = new URL(url, "https://example.test").searchParams;
}

// The browser changed the URL (click, back/forward): the builder re-renders
// with the new parameters, without unmounting.
function navigateTo(url: string) {
  openAt(url);
  view.rerender(tree());
}

async function renderBuilder() {
  view = render(tree());
  await screen.findByRole("heading", { name: "Clinical performance foundations" });
}

const card = () => document.querySelector("#builder-sec-modules") as HTMLElement;
// On the lesson page there is no builder Back/Continue (the way out is "Back to
// module"): switching tabs goes through the step-by-step, the same selectTab.
const pricingStep = () =>
  within(screen.getByRole("navigation", { name: "Course creation steps" })).getByRole("button", { name: /Pricing/ });

function startUpload() {
  fireEvent.change(screen.getByLabelText("Upload a lesson video"), {
    target: { files: [new File(["video-bytes"], "lesson.mp4", { type: "video/mp4" })] },
  });
  fireEvent.click(screen.getByRole("button", { name: "Upload file" }));
}
const linkField = () => screen.getByRole("textbox", { name: "YouTube or Vimeo URL" });
const lastPayload = () => vi.mocked(updateTeacherCourseBuilder).mock.calls.at(-1)?.[1];

describe("lesson page in the builder", () => {
  let restoreDialogs = () => {};
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.bunnyConfigured = false;
    mocks.course = courseFixture();
    mocks.assets = [];
    openAt("/teach/builder?courseId=course-1&tab=content");
    restoreDialogs = stubDialogs();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    restoreDialogs();
  });

  // The notice for an upload in progress: a platform dialog (it used to be window.alert).
  const uploadNotice = () => screen.queryByRole("dialog", { name: "Upload in progress" });

  it("keeps upload status and original lesson persistence after the entire editor unmounts", async () => {
    mocks.course = withIntro();
    mocks.bunnyConfigured = true;
    let finish!: (assetId: string) => void;
    vi.mocked(uploadLessonVideoToBunny).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    openAt(introUrl);
    await renderBuilder();
    startUpload();
    view.rerender(<I18nProvider initialLocale="en"><LessonUploadProvider><h1>Another page</h1></LessonUploadProvider></I18nProvider>);
    expect(screen.queryByRole("heading", { name: "Intro" })).not.toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Lesson upload" })).toHaveTextContent("Uploading file...");
    await act(async () => finish("asset-intro"));
    expect(activateUploadedLessonVideo).toHaveBeenCalledWith("course-1", "l2", "asset-intro", expect.any(Function));
    expect(screen.getByRole("complementary", { name: "Lesson upload" })).toHaveTextContent("File saved.");
    expect(updateTeacherCourseBuilder).not.toHaveBeenCalled();
  });

  it("shows an upload error after leaving the editor", async () => {
    mocks.course = withIntro();
    mocks.bunnyConfigured = true;
    let fail!: (error: Error) => void;
    vi.mocked(uploadLessonVideoToBunny).mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
    openAt(introUrl);
    await renderBuilder();
    startUpload();
    view.rerender(<I18nProvider initialLocale="en"><LessonUploadProvider><h1>Another page</h1></LessonUploadProvider></I18nProvider>);
    await act(async () => fail(new Error("network")));
    expect(screen.getByRole("alert")).toHaveTextContent("Upload needs attention.");
    expect(activateUploadedLessonVideo).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Open lesson" })).toHaveAttribute("href", introUrl);
  });

  it.each([false, true])("bounds the panel and hides cancellation without an abort callback (Bunny entry: %s)", async (bunnyConfigured) => {
    mocks.course = withIntro();
    mocks.bunnyConfigured = bunnyConfigured;
    const transport = bunnyConfigured ? uploadLessonVideoToBunny : uploadCourseAsset;
    let finish!: (assetId: string) => void;
    vi.mocked(transport).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    openAt(introUrl);
    await renderBuilder();
    startUpload();
    const panel = screen.getByRole("complementary", { name: "Lesson upload" });
    expect(panel).toHaveClass("max-h-[calc(100svh-2rem)]", "overflow-y-auto");
    expect(screen.queryByRole("button", { name: /Cancel upload/i })).not.toBeInTheDocument();
    // C-12: with an upload running, no X that closes; canceling is a button
    // that says what it does. The X ("Dismiss upload status") only when no upload is in flight.
    expect(within(panel).queryByRole("button", { name: "Dismiss upload status" })).toBeNull();
    if (bunnyConfigured) {
      act(() => vi.mocked(uploadLessonVideoToBunny).mock.calls[0][0].onCancelAvailable?.(vi.fn()));
      expect(within(panel).getByRole("button", { name: "Cancel upload" })).toHaveTextContent("Cancel upload");
      expect(within(panel).queryByRole("button", { name: "Dismiss upload status" })).toBeNull();
    }
    await act(async () => finish("asset-intro"));
    await waitFor(() => expect(within(panel).getByRole("button", { name: "Dismiss upload status" })).toBeInTheDocument());
    expect(within(panel).queryByRole("button", { name: "Cancel upload" })).toBeNull();
  });

  it("successful connection retry clears the lesson error and file and refreshes readiness without reuploading", async () => {
    mocks.course = withIntro();
    vi.mocked(uploadCourseAsset).mockResolvedValueOnce("asset-intro");
    vi.mocked(activateUploadedLessonVideo).mockRejectedValueOnce(new Error("connection failed"));
    openAt(introUrl);
    await renderBuilder();
    startUpload();
    await waitFor(() => expect(within(card()).getByRole("alert")).toBeInTheDocument());
    const callsBeforeRetry = vi.mocked(fetchCourseAssets).mock.calls.length;
    mocks.assets = [introVideo()];
    fireEvent.click(screen.getByRole("button", { name: "Retry saving" }));
    await waitFor(() => expect(within(card()).queryByRole("alert")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.queryByText(missingIntro)).not.toBeInTheDocument());
    expect(vi.mocked(fetchCourseAssets).mock.calls.length).toBeGreaterThan(callsBeforeRetry);
    expect(screen.getByRole("button", { name: "Upload file" })).toBeDisabled();
    expect(uploadCourseAsset).toHaveBeenCalledTimes(1);
    expect(activateUploadedLessonVideo).toHaveBeenCalledTimes(2);
  });

  it("does not lock or update another course reached through history", async () => {
    mocks.course = withIntro();
    mocks.bunnyConfigured = true;
    let finish!: (assetId: string) => void;
    vi.mocked(uploadLessonVideoToBunny).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    openAt(introUrl);
    await renderBuilder();
    startUpload();
    mocks.course = { ...withIntro(), id: "course-2", title: "Another course" };
    navigateTo("/teach/builder?courseId=course-2&tab=content");
    await screen.findByRole("heading", { name: "Another course" });
    mocks.router.push.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /^Continue to/ }));
    expect(mocks.router.push).toHaveBeenCalled();
    await act(async () => finish("asset-intro"));
    expect(activateUploadedLessonVideo).toHaveBeenCalledWith("course-1", "l2", "asset-intro", expect.any(Function));
    expect(updateTeacherCourseBuilder).not.toHaveBeenCalled();
  });

  it("invalidates upload on the raw sign-out event before auth context updates", async () => {
    mocks.course = withIntro();
    mocks.bunnyConfigured = true;
    let finish!: (assetId: string) => void;
    vi.mocked(uploadLessonVideoToBunny).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    openAt(introUrl);
    await renderBuilder();
    startUpload();
    act(() => mocks.onAuthChange?.("SIGNED_OUT", null));
    expect(screen.queryByRole("complementary", { name: "Lesson upload" })).not.toBeInTheDocument();
    await act(async () => finish("asset-intro"));
    expect(activateUploadedLessonVideo).not.toHaveBeenCalled();
    expect(updateTeacherCourseBuilder).not.toHaveBeenCalled();
  });

  it.each([false, true].flatMap((bunnyConfigured) => [
    "/teach/builder",
    "/teach/builder?courseId=course-2&tab=content",
    "/teach/builder?courseId=course-1&tab=content&module=m2",
  ].map((href) => ({ bunnyConfigured, href }))))("upload blocks navigation to $href (Bunny: $bunnyConfigured)", async ({ bunnyConfigured, href }) => {
    const previousUrl = window.location.href;
    window.history.replaceState(null, "", introUrl);
    try {
      mocks.course = withIntro();
      mocks.bunnyConfigured = bunnyConfigured;
      const transport = bunnyConfigured ? uploadLessonVideoToBunny : uploadCourseAsset;
      vi.mocked(transport).mockImplementationOnce(() => new Promise<string>(() => {}));
      openAt(introUrl);
      await renderBuilder();
      startUpload();

      const leave = document.createElement("a");
      leave.href = href;
      view.container.appendChild(leave);
      expect(fireEvent.click(leave)).toBe(false);
      expect(uploadNotice()).toHaveAccessibleDescription(
        "An upload is in progress. Wait for it to finish before leaving this page.",
      );
      // A one-button notice, which works on the first tap; the page stays and the
      // upload continues.
      expect(within(uploadNotice()!).getAllByRole("button")).toHaveLength(1);
      fireEvent.click(within(uploadNotice()!).getByRole("button", { name: "OK, I'll wait" }));
      await waitFor(() => expect(uploadNotice()).toBeNull());
      expect(screen.getByRole("heading", { name: "Intro" })).toBeInTheDocument();
      expect(transport).toHaveBeenCalledTimes(1);
      expect(bunnyConfigured ? uploadCourseAsset : uploadLessonVideoToBunny).not.toHaveBeenCalled();

      leave.target = "_blank";
      expect(fireEvent.click(leave)).toBe(true);
      expect(uploadNotice()).toBeNull();
    } finally {
      window.history.replaceState(null, "", previousUrl);
    }
  });

  it("?module=M&lesson=L shows Course > Module, the lesson name once and the video tab, with no dialog", async () => {
    openAt(lessonUrl);
    await renderBuilder();

    const trail = within(card()).getByRole("navigation", { name: "Breadcrumb" });
    expect(within(trail).getByRole("link", { name: "Clinical performance foundations" }))
      .toHaveAttribute("href", "/teach/builder?courseId=course-1&tab=content");
    expect(within(trail).getByRole("link", { name: "Start here" })).toHaveAttribute("href", moduleUrl);
    // The lesson name showed up three times on screen: trail, title and the line
    // "Module 1 - ... / Lesson 1". Now only the title is visible; in the trail the lesson
    // is left for the screen reader, as the current item.
    const current = within(trail).getByText("Welcome");
    expect(current.closest("[aria-current='page']")).toBe(current);
    expect(current).toHaveClass("sr-only");
    const visible = within(card()).getAllByText("Welcome").filter((element) => !element.closest(".sr-only"));
    expect(visible).toEqual([within(card()).getByRole("heading", { name: "Welcome" })]);
    // The Curriculum tab header does not sit between the builder and the lesson.
    expect(screen.queryByRole("heading", { name: "Build the curriculum." })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(linkField()).toHaveValue(youtube);
  });

  it("a typed link with no blur yet is saved when clicking the module in the trail", async () => {
    openAt(lessonUrl);
    await renderBuilder();
    fireEvent.change(linkField(), { target: { value: vimeo } });

    const trail = within(card()).getByRole("navigation", { name: "Breadcrumb" });
    fireEvent.click(within(trail).getByRole("link", { name: "Start here" }));
    navigateTo(moduleUrl);

    await waitFor(() => expect(updateTeacherCourseBuilder).toHaveBeenCalled(), { timeout: 5000 });
    expect(lastPayload()?.modules?.[0].lessons[0]).toEqual(
      expect.objectContaining({ id: "l1", externalUrl: vimeo, videoSource: "youtube" }),
    );
  }, 10000);

  it("browser back on the lesson goes to the module page with the edit kept", async () => {
    openAt(lessonUrl);
    await renderBuilder();
    fireEvent.change(linkField(), { target: { value: vimeo } });

    // Back: the URL loses ?lesson, with no click on the page at all.
    navigateTo(moduleUrl);

    expect(within(card()).getByRole("heading", { name: "Start here" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "YouTube or Vimeo URL" })).not.toBeInTheDocument();
    await waitFor(() => expect(updateTeacherCourseBuilder).toHaveBeenCalled(), { timeout: 5000 });
    expect(lastPayload()?.modules?.[0].lessons[0]).toEqual(
      expect.objectContaining({ id: "l1", externalUrl: vimeo }),
    );
  }, 10000);

  it("the old modal's entry points open the page: the lesson button and the newly created lesson", async () => {
    let emitCourse: (course: TeacherCourse | null) => void = () => {};
    vi.mocked(subscribeToTeacherCourse).mockImplementationOnce((_id, emit) => {
      emitCourse = emit;
      emit(mocks.course);
      return Object.assign(() => {}, { reload: async () => {} });
    });
    openAt(moduleUrl);
    await renderBuilder();

    // Lesson button on the module page.
    fireEvent.click(within(card()).getByRole("button", { name: "Edit content" }));
    expect(mocks.router.push).toHaveBeenLastCalledWith(lessonUrl, { scroll: false });
    navigateTo(lessonUrl);
    expect(within(card()).getByRole("navigation", { name: "Breadcrumb" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // New lesson: when the echo confirms the save, its page opens by itself.
    navigateTo(moduleUrl);
    fireEvent.click(within(card()).getByRole("button", { name: "Add lesson to module 1" }));
    const form = card().querySelector("form") as HTMLElement;
    fireEvent.change(within(form).getByRole("textbox", { name: "Lesson title" }), { target: { value: "Fresh" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add lesson" }));
    await waitFor(() => expect(updateTeacherCourseBuilder).toHaveBeenCalled(), { timeout: 5000 });
    const saved = lastPayload();
    const freshId = saved?.modules?.[0].lessons[1]?.id;
    expect(freshId).toBeDefined();
    emitCourse({ ...(mocks.course as TeacherCourse), ...saved });
    await waitFor(() =>
      expect(mocks.router.push).toHaveBeenLastCalledWith(`${moduleUrl}&lesson=${freshId}`, { scroll: false }),
    );
  }, 10000);

  // With the modal becoming a page, back/forward or another tab unmounted the
  // studio in the middle of an upload: the upload was left with no owner and reopening the lesson
  // started another one.
  it.each([false, true])("the upload holds the lesson when parameters change in the same editor (Bunny: %s)", async (bunnyConfigured) => {
    mocks.course = withIntro();
    mocks.bunnyConfigured = bunnyConfigured;
    const transport = bunnyConfigured ? uploadLessonVideoToBunny : uploadCourseAsset;
    let finishUpload: (assetId: string) => void = () => {};
    vi.mocked(transport).mockImplementationOnce(
      () => new Promise<string>((resolve) => { finishUpload = resolve; }),
    );
    openAt(introUrl);
    await renderBuilder();

    fireEvent.change(screen.getByLabelText("Upload a lesson video"), {
      target: { files: [new File(["video-bytes"], "lesson.mp4", { type: "video/mp4" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Upload file" }));
    expect(transport).toHaveBeenCalledTimes(1);

    // Browser back in the middle of the upload: the lesson page stays.
    navigateTo(moduleUrl);
    expect(screen.getByRole("heading", { name: "Intro" })).toBeInTheDocument();

    // Switching tabs through the step-by-step also does not happen during the upload, and
    // the builder's Back/Continue does not appear on the lesson page.
    expect(screen.queryByRole("button", { name: /^Continue to/ })).toBeNull();
    mocks.router.push.mockClear();
    fireEvent.click(pricingStep());
    expect(mocks.router.push).not.toHaveBeenCalled();

    // The upload ends: the screen follows the URL again, and there is no second upload.
    await act(async () => finishUpload("asset-intro"));
    expect(within(card()).getByRole("heading", { name: "Start here" })).toBeInTheDocument();
    expect(transport).toHaveBeenCalledTimes(1);
  }, 10000);

  it("after the upload, Publish readiness sees the file, and Continue leaves without ?lesson", async () => {
    mocks.course = withIntro();
    let finishUpload: (assetId: string) => void = () => {};
    vi.mocked(uploadCourseAsset).mockImplementationOnce(
      () => new Promise<string>((resolve) => { finishUpload = resolve; }),
    );
    openAt(introUrl);
    await renderBuilder();
    expect((await screen.findAllByText(missingIntro)).length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText("Upload a lesson video"), {
      target: { files: [new File(["video-bytes"], "lesson.mp4", { type: "video/mp4" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Upload file" }));
    mocks.assets = [introVideo()];
    await act(async () => finishUpload("asset-intro"));

    await waitFor(() => expect(screen.queryByText(missingIntro)).not.toBeInTheDocument());
    fireEvent.click(pricingStep());
    const next = String(mocks.router.push.mock.calls.at(-1)?.[0]);
    expect(next).toContain("tab=pricing");
    expect(next).not.toContain("lesson=");
  }, 10000);

  // The server does not charge for lesson content: with the old list, Publish
  // published an empty lesson after deleting its only video.
  it("deleting the video on the lesson page takes the lesson out of Publish readiness", async () => {
    mocks.course = withIntro();
    mocks.assets = [introVideo()];
    openAt(introUrl);
    await renderBuilder();
    await waitFor(() => expect(fetchCourseAssets).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByText(missingIntro)).not.toBeInTheDocument();

    mocks.assets = [];
    const file = screen
      .getAllByText("lesson.mp4")
      .map((element) => element.closest("article"))
      .find((article): article is HTMLElement => article instanceof HTMLElement);
    fireEvent.click(within(file as HTMLElement).getByRole("button"));
    const asking = screen.getByRole("dialog", { name: "Delete this file?" });
    expect(asking).toHaveAccessibleDescription('Delete "lesson.mp4"? This permanently removes the file.');
    clickConfirm(asking, "Delete file");

    await waitFor(() => expect(screen.getAllByText(missingIntro).length).toBeGreaterThan(0));
    // Publish lives in the Publish tab: there, the lesson is a pending item again and the
    // button is dimmed.
    expect(screen.queryByRole("button", { name: "Publish product" })).toBeNull();
    navigateTo("/teach/builder?courseId=course-1&tab=review");
    const review = await waitFor(() => {
      const found = document.getElementById("builder-sec-review");
      if (!found) throw new Error("the Publish tab did not open");
      return found;
    });
    await waitFor(() => expect(within(review).getByText(missingIntro)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Publish product" })).toBeDisabled();
  }, 10000);

  // Without the old modal layer, the sidebar became clickable in the middle of an
  // upload: leaving unmounted the builder and the upload continued with no owner.
  it("during an upload, a link out of the builder does not navigate", async () => {
    mocks.course = withIntro();
    vi.mocked(uploadCourseAsset).mockImplementationOnce(() => new Promise<string>(() => {}));
    openAt(introUrl);
    await renderBuilder();
    startUpload();

    const leave = document.createElement("a");
    leave.href = "/teach";
    leave.textContent = "Courses";
    view.container.appendChild(leave);

    expect(fireEvent.click(leave)).toBe(false);
    expect(uploadNotice()).toBeInTheDocument();
    // Closing the notice (Esc) does not release the exit: the click already stopped.
    fireEvent(uploadNotice()!, new Event("cancel", { cancelable: true }));
    expect(uploadNotice()).toBeNull();
    expect(screen.getByRole("heading", { name: "Intro" })).toBeInTheDocument();
    expect(uploadCourseAsset).toHaveBeenCalledTimes(1);
  });

  // The error landed on the lesson page at the same moment it left the screen
  // (the URL was already on the module): the failure stayed invisible.
  it.each([false, true])("a failure after parameters change keeps the error on the lesson (Bunny: %s)", async (bunnyConfigured) => {
    mocks.course = withIntro();
    mocks.bunnyConfigured = bunnyConfigured;
    const transport = bunnyConfigured ? uploadLessonVideoToBunny : uploadCourseAsset;
    let failUpload: (error: Error) => void = () => {};
    vi.mocked(transport).mockImplementationOnce(
      () => new Promise<string>((_resolve, reject) => { failUpload = reject; }),
    );
    openAt(introUrl);
    await renderBuilder();
    startUpload();

    navigateTo(moduleUrl);
    await act(async () => failUpload(new Error("network")));

    expect(mocks.router.replace).toHaveBeenLastCalledWith(introUrl, { scroll: false });
    expect(screen.getByRole("heading", { name: "Intro" })).toBeInTheDocument();
    expect(within(card()).getByRole("alert")).toBeInTheDocument();
  });

  it("a direct link to the lesson page loads the course file list", async () => {
    mocks.course = withIntro();
    openAt(introUrl);
    await renderBuilder();

    // Without the list, the "content in every lesson" item does not even appear; with it, it charges Intro.
    expect((await screen.findAllByText(missingIntro)).length).toBeGreaterThan(0);
  });

  it("entering the lesson page focuses its title", async () => {
    openAt(moduleUrl);
    await renderBuilder();

    fireEvent.click(within(card()).getByRole("button", { name: "Edit content" }));
    navigateTo(lessonUrl);

    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Welcome" }));
  });

  it("leaving through Back to module replaces the history entry and returns focus to the lesson button", async () => {
    openAt(moduleUrl);
    await renderBuilder();
    fireEvent.click(within(card()).getByRole("button", { name: "Edit content" }));
    navigateTo(lessonUrl);

    // "Done" was also the state of the Description tab: the button says where it leads.
    expect(screen.queryByRole("button", { name: "Done" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to module" }));
    expect(mocks.router.replace).toHaveBeenLastCalledWith(moduleUrl, { scroll: false });
    navigateTo(moduleUrl);

    expect(document.activeElement).toBe(within(card()).getByRole("button", { name: "Edit content" }));
  });
});
vi.mock("@/lib/data/creator-plan", () => ({ fetchCreatorPlanRequired: async () => false }));
