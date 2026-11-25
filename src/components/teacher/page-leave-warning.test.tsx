import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { CourseManageHub } from "@/components/teacher/course-manage-hub";
import { CONFIRM_GUARD_MS } from "@/components/ui/confirm-dialog";
import type { TeacherCourse } from "@/domain/teacher-course";

// Manage › Page: the sales text and the page have their own Save. Leaving with
// "Unsaved changes" lost what was typed without a warning. The warning covers closing the
// tab and navigation in the panel itself (its sections and links), not the whole router.

const mocks = vi.hoisted(() => ({
  course: {
    id: "course-1",
    ownerId: "teacher-1",
    title: "Clinical performance foundations",
    summary: "Build a repeatable practice.",
    category: "Applied Psychology & Behavior",
    categories: ["Applied Psychology & Behavior"],
    status: "draft",
    modules: [{ id: "m1", title: "Start here", lessons: [] }],
    lessonCount: 0,
    priceAmountMinor: null,
    currency: "USD",
    paymentType: "one_time",
  } as TeacherCourse,
  user: { uid: "teacher-1" },
  router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
  searchParams: new URLSearchParams("section=page"),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  useSearchParams: () => mocks.searchParams,
}));
vi.mock("@/components/auth/auth-provider", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("@/lib/data/teacher-courses", () => ({
  subscribeToTeacherCourse: (_id: string, onData: (course: TeacherCourse) => void) => {
    onData(mocks.course);
    return () => undefined;
  },
  subscribeToTeacherCourses: (_uid: string, onData: (courses: TeacherCourse[]) => void) => {
    onData([mocks.course]);
    return () => undefined;
  },
  setOwnCourseFeatured: vi.fn(),
}));
vi.mock("@/lib/data/user-profiles", () => ({
  subscribeToUserProfile: (_uid: string, onData: (profile: unknown) => void) => {
    onData({ creatorVerificationStatus: "none", currentPlanId: "free" });
    return () => undefined;
  },
  getPublicProfile: async () => null,
}));
vi.mock("@/lib/data/creator-verification", () => ({
  fetchRequireCreatorVerification: () => Promise.resolve(false),
  fetchCreatorActivationBlocked: () => Promise.resolve(false),
}));
vi.mock("@/components/teacher/course-overview-panel", () => ({ CourseOverviewPanel: () => null }));
vi.mock("@/lib/data/course-assets", () => ({ fetchCourseAssets: () => Promise.resolve([]) }));
// The editors have their own proof (the "Unsaved changes" row); here only the signal.
vi.mock("@/components/teacher/sales-page-editor", () => ({
  SalesPageEditor: ({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) => (
    <button type="button" onClick={() => onDirtyChange?.(true)}>Type in sales copy</button>
  ),
}));
vi.mock("@/components/teacher/course-landing-editor", () => ({ CourseLandingEditor: () => null }));

const originalShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");

beforeEach(() => {
  mocks.router.push.mockClear();
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { if (!this.hasAttribute("open")) return; this.removeAttribute("open"); this.dispatchEvent(new Event("close")); } });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  if (originalShow) Object.defineProperty(HTMLDialogElement.prototype, "showModal", originalShow);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, "close", originalClose);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
});

function renderPage() {
  return render(
    <I18nProvider initialLocale="en">
      <CourseManageHub courseId="course-1" />
    </I18nProvider>,
  );
}

function beforeUnloadPrevented() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("Manage › Page: warning on leaving with unsaved changes", () => {
  it("with no changes, switching sections and closing the tab go straight through", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Basic info" }));
    expect(mocks.router.push).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(beforeUnloadPrevented()).toBe(false);
  });

  it("with changes, the section asks first; staying does not navigate, leaving does", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Type in sales copy" }));
    expect(beforeUnloadPrevented()).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Basic info" }));
    const dialog = screen.getByRole("dialog", { name: "Leave without saving?" });
    expect(dialog).toHaveTextContent("This course has unsaved changes. Leave and lose them?");
    fireEvent.click(within(dialog).getByRole("button", { name: "Stay on this page" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.router.push).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Basic info" }));
    vi.advanceTimersByTime(CONFIRM_GUARD_MS);
    await act(async () => {
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Leave anyway" }));
    });
    expect(mocks.router.push).toHaveBeenCalledExactlyOnceWith("/teach/courses/course-1/manage?section=basic", { scroll: false });
  });

  it("with changes, a panel link also asks before navigating", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Type in sales copy" }));

    const back = screen.getByRole("link", { name: "My products" });
    const click = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    act(() => {
      back.dispatchEvent(click);
    });

    expect(click.defaultPrevented).toBe(true);
    expect(screen.getByRole("dialog", { name: "Leave without saving?" })).toBeInTheDocument();
    expect(mocks.router.push).not.toHaveBeenCalled();
  });
});
