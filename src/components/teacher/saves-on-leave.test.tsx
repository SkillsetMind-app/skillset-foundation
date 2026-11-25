import { act, cleanup, fireEvent, render, screen, waitFor, type RenderResult } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { CourseBuilderStudio } from "@/components/teacher/course-builder-studio";
import type { CourseAsset } from "@/domain/course-asset";
import type { TeacherCourse, TeacherLesson } from "@/domain/teacher-course";
import { updateTeacherCourseBuilder } from "@/lib/data/teacher-courses";

// Leaving through the browser back/forward (App Router popstate), a trackpad
// gesture or Alt+Left unmounts the builder without a link click. What was still in
// the autosave's 1.8 s debounce was lost, and so was a link typed in the
// studio without blur. beforeunload does not fire on this navigation.

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
  fetchCreatorActivationBlocked: () => Promise.resolve(false),
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

// The lesson opens as a page (?lesson=L): it follows the last URL the builder asked for,
// as the browser would.
function followPush(view: RenderResult) {
  const href = String(mocks.router.push.mock.calls.at(-1)?.[0]);
  mocks.searchParams = new URL(href, "https://example.test").searchParams;
  view.rerender(
    <I18nProvider initialLocale="en">
      <CourseBuilderStudio />
    </I18nProvider>,
  );
}

const moduleName = () => screen.getByRole("textbox", { name: "Module 1" });
const lastPayload = () => vi.mocked(updateTeacherCourseBuilder).mock.calls.at(-1)?.[1];
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("the builder saves the pending draft on exit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.course = courseWith();
    mocks.searchParams = new URLSearchParams("courseId=course-1&tab=content&module=m1");
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    Reflect.deleteProperty(document, "visibilityState");
  });

  it("leaving (unmounting) before 1.8 s saves the edit only once", async () => {
    const { unmount } = await renderBuilder();
    fireEvent.change(moduleName(), { target: { value: "Start here, renamed" } });

    unmount();

    expect(updateTeacherCourseBuilder).toHaveBeenCalledTimes(1);
    expect(lastPayload()?.modules?.[0].title).toBe("Start here, renamed");
    // The debounce died with the flush: no second save.
    await wait(2200);
    expect(updateTeacherCourseBuilder).toHaveBeenCalledTimes(1);
  }, 10000);

  it("pagehide and a hidden tab save right away, with no repeated save", async () => {
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

  it("with no pending edit, leaving saves nothing", async () => {
    const { unmount } = await renderBuilder();

    window.dispatchEvent(new Event("pagehide"));
    unmount();

    expect(updateTeacherCourseBuilder).not.toHaveBeenCalled();
  });

  it("a link typed in the studio with no blur yet is saved along on exit", async () => {
    mocks.course = courseWith([
      { id: "l1", title: "Welcome", type: "video", description: "", videoSource: "youtube", externalUrl: youtube },
    ]);
    const view = await renderBuilder();
    const { unmount } = view;
    fireEvent.click(screen.getByRole("button", { name: "Edit content" }));
    followPush(view);
    fireEvent.change(screen.getByRole("textbox", { name: "YouTube or Vimeo URL" }), {
      target: { value: vimeo },
    });

    unmount();

    expect(updateTeacherCourseBuilder).toHaveBeenCalledTimes(1);
    expect(lastPayload()?.modules?.[0].lessons[0]).toEqual(
      expect.objectContaining({ id: "l1", externalUrl: vimeo, videoSource: "youtube" }),
    );
  });

  it("leaving never opens a confirmation: a link that would ask for one is not saved", async () => {
    mocks.course = courseWith([
      { id: "l1", title: "Welcome", type: "video", description: "", externalUrl: drive },
    ]);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const view = await renderBuilder();
    const { unmount } = view;
    fireEvent.click(screen.getByRole("button", { name: "Add video" }));
    followPush(view);
    fireEvent.click(screen.getByRole("button", { name: "Replace with link" }));
    fireEvent.change(screen.getByRole("textbox", { name: "YouTube or Vimeo URL" }), {
      target: { value: vimeo },
    });

    unmount();

    expect(confirm).not.toHaveBeenCalled();
    // The question lives in the platform dialog (<dialog>), no longer in
    // window.confirm: the silent flush does not open any.
    expect(document.querySelector("dialog")).toBeNull();
    expect(updateTeacherCourseBuilder).not.toHaveBeenCalled();
  });

  // Switching apps or tabs and coming back: the silent flush used to refuse the link
  // (it asked for confirmation) and cleared the field with the builder still mounted.
  it("a hidden tab and pagehide do not erase the typed link that would ask for confirmation", async () => {
    mocks.course = courseWith([
      { id: "l1", title: "Welcome", type: "video", description: "", externalUrl: drive },
    ]);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const view = await renderBuilder();
    fireEvent.click(screen.getByRole("button", { name: "Add video" }));
    followPush(view);
    fireEvent.click(screen.getByRole("button", { name: "Replace with link" }));
    const field = () => screen.getByRole("textbox", { name: "YouTube or Vimeo URL" });
    fireEvent.change(field(), { target: { value: vimeo } });

    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    Reflect.deleteProperty(document, "visibilityState");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(field()).toHaveValue(vimeo);

    // pagehide (the bfcache may bring the page back): refuses without asking
    // and without erasing what was typed.
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(field()).toHaveValue(vimeo);
    expect(confirm).not.toHaveBeenCalled();
    // With the builder still mounted, a question opened here would show up: the
    // silent flush does not open the platform dialog (<dialog>).
    expect(document.querySelector("dialog")).toBeNull();
    expect(updateTeacherCourseBuilder).not.toHaveBeenCalled();
  });

  // Two different full swaps in flight at the same time: the flush does not start
  // a second one; the in-flight save and the normal autosave carry the new edit.
  it("with a save in flight, leaving does not start a second save", async () => {
    let finishFirst = () => {};
    vi.mocked(updateTeacherCourseBuilder).mockImplementationOnce(
      () => new Promise<void>((resolve) => { finishFirst = resolve; }),
    );
    await renderBuilder();
    fireEvent.change(moduleName(), { target: { value: "Start here, v1" } });
    await waitFor(() => expect(updateTeacherCourseBuilder).toHaveBeenCalledTimes(1), { timeout: 5000 });

    fireEvent.change(moduleName(), { target: { value: "Start here, v2" } });
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(updateTeacherCourseBuilder).toHaveBeenCalledTimes(1);

    await act(async () => finishFirst());
    await waitFor(() => expect(updateTeacherCourseBuilder).toHaveBeenCalledTimes(2), { timeout: 5000 });
    expect(lastPayload()?.modules?.[0].title).toBe("Start here, v2");
  }, 15000);

  it("a descarga cancela o timer do debounce que estava correndo", async () => {
    const setTimeoutSpy = vi.spyOn(window, "setTimeout");
    const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");
    await renderBuilder();
    fireEvent.change(moduleName(), { target: { value: "Start here, renamed" } });
    const debounceCalls = setTimeoutSpy.mock.calls.flatMap((call, index) => (call[1] === 1800 ? [index] : []));
    const handle = setTimeoutSpy.mock.results[debounceCalls.at(-1) ?? -1]?.value;
    expect(handle).toBeDefined();
    expect(clearTimeoutSpy).not.toHaveBeenCalledWith(handle);

    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });

    expect(clearTimeoutSpy).toHaveBeenCalledWith(handle);
    expect(updateTeacherCourseBuilder).toHaveBeenCalledTimes(1);
  });

  // With the flush save still in flight, the effect schedules a new timer with the
  // SAME payload (the person edited and went back to what was already sent). It must not
  // resend the same save.
  it("a new timer with the same payload does not resend the unload save that is still in flight", async () => {
    let finishFlush = () => {};
    vi.mocked(updateTeacherCourseBuilder).mockImplementationOnce(
      () => new Promise<void>((resolve) => { finishFlush = resolve; }),
    );
    await renderBuilder();
    fireEvent.change(moduleName(), { target: { value: "Start here, renamed" } });
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(updateTeacherCourseBuilder).toHaveBeenCalledTimes(1);

    fireEvent.change(moduleName(), { target: { value: "Start here, other" } });
    fireEvent.change(moduleName(), { target: { value: "Start here, renamed" } });
    await wait(2200);
    expect(updateTeacherCourseBuilder).toHaveBeenCalledTimes(1);

    await act(async () => finishFlush());
  }, 10000);
});
vi.mock("@/lib/data/creator-plan", () => ({ fetchCreatorPlanRequired: async () => false }));
