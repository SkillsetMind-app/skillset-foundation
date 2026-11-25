import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { CourseBuilderStudio } from "@/components/teacher/course-builder-studio";
import type { CourseAsset } from "@/domain/course-asset";
import type { TeacherCourse, TeacherCourseModule } from "@/domain/teacher-course";
import { updateTeacherCourseBuilder } from "@/lib/data/teacher-courses";

// 06/10: Realtime refused every channel in production, and the builder only knew that
// a module was saved from its echo. The new module's cover stayed
// disabled forever ("the button does not work"). Here NO Realtime event
// arrives: what unlocks it is the builder fetching again on its own.

const MODULE_UUID = "00000000-0000-4000-8000-000000000001";
const MODULE_ID = `module-${MODULE_UUID}`;

const mocks = vi.hoisted(() => {
  const course = {
    id: "course-1",
    ownerId: "teacher-1",
    title: "Clinical performance foundations",
    summary: "Build a repeatable practice for evidence-informed performance work.",
    category: "Applied Psychology & Behavior",
    categories: ["Applied Psychology & Behavior"],
    status: "draft",
    modules: [],
    lessonCount: 0,
    priceAmountMinor: 0,
    currency: "USD",
    paymentType: "free",
  } as TeacherCourse;

  return {
    course,
    // What the server has now. It changes only when the autosave writes.
    serverModules: [] as TeacherCourseModule[],
    courseAssets: [] as CourseAsset[],
    user: { uid: "teacher-1" },
    router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
    searchParams: new URLSearchParams(),
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
    const emit = () => onData({ ...mocks.course, modules: mocks.serverModules });
    emit();
    // No Realtime event: only the standalone reload brings what the server has.
    return Object.assign(() => undefined, { reload: vi.fn(async () => emit()) });
  }),
  publishTeacherCourse: vi.fn(() => Promise.resolve()),
  updateTeacherCourseBuilder: vi.fn(async (_id: string, payload: { modules: TeacherCourseModule[] }) => {
    mocks.serverModules = payload.modules;
  }),
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
  fetchCourseAssets: () => Promise.resolve(mocks.courseAssets),
  subscribeToCourseAssets: vi.fn((_id: string, onAssets: (assets: CourseAsset[]) => void) => {
    onAssets(mocks.courseAssets);
    return Object.assign(() => undefined, { reload: vi.fn(async () => onAssets(mocks.courseAssets)) });
  }),
  syncLessonPreviewAssets: () => Promise.resolve(),
  uploadCourseAsset: vi.fn(async () => {
    mocks.courseAssets = [{
      id: "members-cover-new",
      courseId: "course-1",
      ownerId: "teacher-1",
      kind: "members_cover",
      fileName: "capa.png",
      contentType: "image/png",
      size: 3,
      storagePath: "courses/course-1/assets/teacher-1/members-cover-new/capa.png",
      downloadUrl: "/fixture-members-cover.png",
      isPreview: false,
      lessonId: null,
    }];
    return "members-cover-new";
  }),
}));

vi.mock("@/components/teacher/course-asset-uploader", () => ({
  CourseAssetUploader: () => null,
}));

vi.mock("@/components/teacher/lesson-content-modal", () => ({
  LessonContentModal: () => null,
}));

function renderBuilder(query: string) {
  mocks.searchParams = new URLSearchParams(query);
  render(
    <I18nProvider initialLocale="en">
      <CourseBuilderStudio />
    </I18nProvider>,
  );
}

describe("upload without depending on Realtime", () => {
  beforeEach(() => {
    mocks.serverModules = [];
    mocks.courseAssets = [];
    vi.mocked(updateTeacherCourseBuilder).mockClear();
    vi.spyOn(crypto, "randomUUID").mockReturnValue(MODULE_UUID);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("a module created in the session unlocks the cover upload after the autosave", async () => {
    renderBuilder(`courseId=course-1&tab=content&module=${MODULE_ID}`);
    await screen.findByRole("heading", { name: mocks.course.title });

    fireEvent.change(screen.getByLabelText("Module title"), { target: { value: "Start here" } });
    fireEvent.click(screen.getByRole("button", { name: "Create module" }));

    const coverInput = () => {
      const region = screen.getByRole("region", { name: "Module cover" });
      const input = region.querySelector<HTMLInputElement>('input[type="file"]');
      if (!input) throw new Error("the module cover has no file input");
      return input;
    };

    // Still only in draft: the upload needs the id already saved on the server.
    expect(coverInput()).toBeDisabled();

    // Real autosave (1.8 s debounce): wide margin for a loaded machine.
    await waitFor(() => expect(updateTeacherCourseBuilder).toHaveBeenCalled(), { timeout: 8000 });
    await waitFor(() => expect(coverInput()).not.toBeDisabled(), { timeout: 8000 });
  }, 20000);

  it("the members area cover shows up in the preview right after the upload", async () => {
    renderBuilder("courseId=course-1&tab=members");
    await screen.findByRole("heading", { name: mocks.course.title });

    const region = screen.getByRole("region", { name: "Members area cover" });
    expect(within(region).queryByRole("img")).not.toBeInTheDocument();
    const input = region.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error("the members area cover has no file input");
    fireEvent.change(input, { target: { files: [new File(["png"], "capa.png", { type: "image/png" })] } });

    await waitFor(() => {
      expect(within(screen.getByRole("region", { name: "Members area cover" })).getByRole("img"))
        .toHaveAttribute("src", "/fixture-members-cover.png");
    }, { timeout: 8000 });
  }, 20000);
});
vi.mock("@/lib/data/creator-plan", () => ({ fetchCreatorPlanRequired: async () => false }));
