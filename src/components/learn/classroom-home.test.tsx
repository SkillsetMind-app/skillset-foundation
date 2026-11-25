import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EnrolledCourseWorkspace } from "@/components/learn/enrolled-course-workspace";
import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import type { ClassroomTab } from "@/domain/classroom-tabs";
import type { Course } from "@/domain/learning";
import type { CourseAsset } from "@/domain/course-asset";
import { subscribeToCourseAssets, getProtectedCourseAssetObjectUrl } from "@/lib/data/course-assets";
import { countOpenCommunityQuestions } from "@/lib/data/community-posts";
import { formatEventDateTime } from "@/domain/course-event";
import { subscribeToCourseEvents } from "@/lib/data/course-events";
import { recordLessonProgress, subscribeToCompletedLessons } from "@/lib/data/lesson-progress";
import { subscribeToEnrollment } from "@/lib/data/enrollments";
import { subscribeToLessonContent } from "@/lib/data/lesson-content";

// The subscriptions return the unsubscribe function with `reload` (the "Try again").
const unsubscribable = () => Object.assign(vi.fn(), { reload: vi.fn(async () => undefined) });

/**
 * Re-analysis item 8, really rendered (real enrollment, not preview):
 *   - the full cover is the course's HOME PAGE (first visit: no lesson in the
 *     address and no progress). In every lesson, a short header;
 *   - the playlist sits beside the video, with the current lesson highlighted;
 *   - there is ONE single complete button in the whole classroom (under the video). In the list, the
 *     check of the completed lesson undoes it — through the same path.
 */

const mocks = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
  pathname: "/learn/courses/demo-course",
  replace: vi.fn(),
  completed: [] as string[],
  // ONE user object for the whole session. The enrollment subscription
  // depends on `user`; a new object on every render re-subscribed, the subscription
  // delivered the enrollment (setState), the next render brought another object...
  // and the test ate 4 GB of memory instead of failing. The real provider emits
  // only when the content changes (#134); the mock needs the same contract.
  auth: {
    status: "authenticated",
    user: { uid: "student-1", email: "student@example.com", roles: ["student"] },
  },
  enrollmentSubscriptions: 0,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => mocks.searchParams,
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: vi.fn(), replace: mocks.replace, refresh: vi.fn() }),
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => mocks.auth,
}));

vi.mock("@/lib/data/enrollments", () => ({
  // Delivers the enrollment right away, whatever the function's signature.
  subscribeToEnrollment: vi.fn((...args: unknown[]) => {
    // Fuse: a subscription loop is synchronous inside render — not even the
    // vitest timeout reaches it. It becomes a failure that ends, not a hang.
    mocks.enrollmentSubscriptions += 1;
    if (mocks.enrollmentSubscriptions > 20) {
      throw new Error("subscribeToEnrollment called more than 20 times: render loop");
    }
    const onNext = args.find((arg) => typeof arg === "function") as (
      enrollment: unknown,
    ) => void;
    onNext({
      id: "enr-1",
      userId: "student-1",
      courseId: "course-1",
      courseSlug: "demo-course",
      courseTitle: "Demo course",
      courseCategory: "Leadership",
      courseImage: "",
      status: "active",
      source: "admin",
      progressPercent: 0,
      lastLessonId: null,
    });
    return vi.fn();
  }),
  markLessonComplete: vi.fn(),
  updateEnrollmentProgress: vi.fn(),
}));

// The teacher's public name, for the community feed.
vi.mock("@/lib/data/user-profiles", () => ({
  subscribeToPublicProfile: vi.fn(
    (uid: string, onNext: (profile: unknown) => void) => {
      onNext({ uid, displayName: "Ana Prof", username: "ana", photoURL: null, bio: null, credentials: [] });
      return vi.fn();
    },
  ),
}));

vi.mock("@/lib/data/lesson-progress", () => ({
  recordLessonProgress: vi.fn(() => Promise.resolve()),
  subscribeToCompletedLessons: vi.fn(
    (_enrollmentId: string, onNext: (lessonIds: string[]) => void) => {
      onNext(mocks.completed);
      return vi.fn();
    },
  ),
}));

vi.mock("@/lib/data/lesson-content", () => ({
  subscribeToLessonContent: vi.fn((_courseId, onNext) => {
    onNext(new Map());
    return vi.fn();
  }),
  resolveLessonContent: vi.fn(() => ({})),
}));

vi.mock("@/lib/data/course-assets", () => ({
  subscribeToCourseAssets: vi.fn(() => vi.fn()),
  getProtectedCourseAssetObjectUrl: vi.fn(),
}));

// The Community tab's counter: one read when the classroom opens. By default it
// never comes back — and that is the real state of almost every test here (the classroom renders
// before the number arrives) and avoids a stray setState outside act(). The tests
// of the counter say what the read returns.
vi.mock("@/lib/data/community-posts", () => ({
  countOpenCommunityQuestions: vi.fn(() => new Promise<number>(() => {})),
  // Lesson comments under the player (P3) open the same subscriptions as the feed.
  // Here they never answer: the classroom renders before the feed arrives, and the target
  // of this file is the classroom, not the list (lesson-comments.test.tsx).
  subscribeToCommunityPosts: vi.fn(() => vi.fn()),
  subscribeToCourseCommunityComments: vi.fn(() => vi.fn()),
  createCommunityPost: vi.fn(),
}));

vi.mock("@/lib/data/course-events", () => ({
  subscribeToCourseEvents: vi.fn(() => vi.fn()),
}));

vi.mock("@/lib/posthog/events", () => ({
  track: new Proxy({}, { get: () => vi.fn() }),
}));

// Outside preview, messages and review open a subscription to the real
// Supabase ("Supabase client configuration is missing" in jsdom). They are not the
// target of this test: they become empty boxes.
vi.mock("@/components/learn/course-messages-panel", () => ({
  CourseMessagesPanel: () => <div data-testid="messages-panel" />,
}));
vi.mock("@/components/learn/course-review-panel", () => ({
  CourseReviewPanel: () => <div data-testid="review-panel" />,
}));
// A aba Community renderiza o feed simplificado (community-feed.tsx).
vi.mock("@/components/learn/community-feed", () => ({
  CommunityFeed: (props: { instructorName?: string | null; instructorIds?: string[] }) => (
    <div
      data-testid="community-feed"
      data-instructor={props.instructorName ?? ""}
      data-instructor-ids={(props.instructorIds ?? []).join(",")}
    />
  ),
}));

const course = {
  id: "course-1",
  slug: "demo-course",
  title: "Demo course",
  category: "Leadership",
  summary: "A demo course.",
  durationLabel: "2h",
  image: null,
  membersTheme: "light",
  communityEnabled: true,
  instructorId: "teacher-1",
  modules: [
    {
      id: "m1",
      title: "Module one",
      summary: "",
      lessons: [
        { id: "l1", title: "Lesson one", type: "text", duration: "5 min", isPreview: true, contentText: "One" },
        { id: "l2", title: "Lesson two", type: "text", duration: "7 min", isPreview: false, contentText: "Two" },
      ],
    },
  ],
} as unknown as Course;

function liveEvent(startsAt: string) {
  return {
    id: "event-1",
    courseId: "course-1",
    courseSlug: "demo-course",
    courseTitle: "Demo course",
    ownerId: "teacher-1",
    title: "Live Q&A",
    description: "",
    type: "live_class" as const,
    status: "scheduled" as const,
    startsAt,
    externalUrl: "https://meet.example.com/live",
    recordingAssetId: null,
  };
}

function ChangeLanguage() {
  const { locale, setLocale } = useTranslation();
  return <button onClick={() => setLocale(locale === "en" ? "es" : "en")}>Change language</button>;
}

function renderClassroom(
  search: string,
  completed: string[] = [],
  tab: ClassroomTab = "lesson",
) {
  mocks.searchParams = new URLSearchParams(search);
  mocks.pathname =
    tab === "lesson" ? "/learn/courses/demo-course" : `/learn/courses/demo-course/${tab}`;
  mocks.completed = completed;
  return render(<EnrolledCourseWorkspace course={course} tab={tab} />);
}

describe("classroom with a real enrollment", () => {
  beforeEach(() => {
    mocks.replace.mockReset();
    mocks.enrollmentSubscriptions = 0;
    vi.mocked(recordLessonProgress).mockClear();
    Element.prototype.scrollIntoView = vi.fn();
    window.requestAnimationFrame = (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    };
  });

  it("translates the lesson body, completion controls and compact header without changing the lesson or progress", () => {
    mocks.searchParams = new URLSearchParams("lesson=l1&campaign=literal");
    mocks.pathname = "/learn/courses/demo-course";
    mocks.completed = [];
    render(<I18nProvider initialLocale="es"><EnrolledCourseWorkspace course={course} /></I18nProvider>);
    expect(screen.getByRole("link", { name: "← Área de miembros de Ana Prof" })).toHaveAttribute("href", "/learn/areas/@ana");
    expect(screen.getByRole("progressbar", { name: "0% completado" })).toBeInTheDocument();
    expect(screen.getByText("Lección de texto")).toBeInTheDocument();
    expect(screen.getByText("Contenido de la lección")).toBeInTheDocument();
    expect(screen.getByText("Vista previa gratuita")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Comentarios de la lección" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Marcar como completada y continuar" })).toBeInTheDocument();
    expect(screen.getByText("One")).toBeInTheDocument();
    expect(mocks.searchParams.toString()).toBe("lesson=l1&campaign=literal");
    expect(recordLessonProgress).not.toHaveBeenCalled();
  });

  it("translates loading and a later enrollment failure without reconnecting on locale change", () => {
    mocks.searchParams = new URLSearchParams();
    mocks.completed = [];
    let fail!: (error: Error) => void;
    vi.mocked(subscribeToEnrollment).mockClear();
    vi.mocked(subscribeToEnrollment).mockImplementationOnce((_uid, _slug, _next, onError) => {
      fail = onError;
      return unsubscribable();
    });
    render(<I18nProvider initialLocale="en"><ChangeLanguage /><EnrolledCourseWorkspace course={course} /></I18nProvider>);
    expect(screen.getByRole("status")).toHaveTextContent("Loading course...");
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("status")).toHaveTextContent("Cargando curso...");
    act(() => fail(new Error("private enrollment detail")));
    expect(screen.getByText("No pudimos confirmar tu inscripción en este curso.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Abrir página del curso" })).toHaveAttribute("href", "/courses/demo-course");
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByText("We could not confirm your enrollment for this course.")).toBeInTheDocument();
    expect(subscribeToEnrollment).toHaveBeenCalledTimes(1);
    expect(recordLessonProgress).not.toHaveBeenCalled();
  });

  // The error card was a dead end (only the links out): "Try again" re-reads the
  // enrollment through the same channel and the classroom opens, with focus on its title.
  it("the enrollment failure offers Try again, which re-reads without resubscribing and opens the classroom", async () => {
    mocks.searchParams = new URLSearchParams("lesson=l1");
    mocks.completed = [];
    let deliver!: Parameters<typeof subscribeToEnrollment>[2];
    const reload = vi.fn(async () => deliver({
      id: "enr-1", userId: "student-1", courseId: "course-1", courseSlug: "demo-course",
      courseTitle: "Demo course", courseCategory: "Leadership", courseImage: "",
      status: "active", source: "admin", progressPercent: 0, lastLessonId: null,
    }));
    vi.mocked(subscribeToEnrollment).mockClear();
    vi.mocked(subscribeToEnrollment).mockImplementationOnce((_uid, _slug, next, onError) => {
      deliver = next;
      onError(new Error("down"));
      return Object.assign(vi.fn(), { reload });
    });
    render(<I18nProvider initialLocale="en"><EnrolledCourseWorkspace course={course} /></I18nProvider>);
    expect(screen.getByRole("alert")).toHaveTextContent("We could not confirm your enrollment for this course.");
    expect(screen.getByRole("link", { name: "Back to my learning" })).toBeInTheDocument();

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Try again" })));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(subscribeToEnrollment).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("One")).toBeInTheDocument();
    expect(document.activeElement?.tagName).toBe("H1");
  });

  // One failure per read: the classroom never opens with empty progress or without the
  // materials that the failed read left in place.
  function failProgressAndAssets() {
    type Read<T> = { next: (value: T) => void; fail: (error: Error) => void; reload: () => Promise<void> };
    const progress: Read<string[]> = { next: () => {}, fail: () => {}, reload: vi.fn(async () => undefined) };
    const assets: Read<CourseAsset[]> = { next: () => {}, fail: () => {}, reload: vi.fn(async () => undefined) };
    vi.mocked(subscribeToCompletedLessons).mockImplementationOnce((_id, next, fail) => {
      Object.assign(progress, { next, fail });
      return Object.assign(vi.fn(), { reload: progress.reload });
    });
    vi.mocked(subscribeToCourseAssets).mockImplementationOnce((_id, next, fail) => {
      Object.assign(assets, { next, fail });
      return Object.assign(vi.fn(), { reload: assets.reload });
    });
    mocks.searchParams = new URLSearchParams("lesson=l1");
    mocks.completed = [];
    render(<I18nProvider initialLocale="en"><EnrolledCourseWorkspace course={course} enableFirestoreAssets /></I18nProvider>);
    return { progress, assets };
  }

  it.each(["progress", "assets"] as const)("failure of %s first and then the other: the card stays until both come back, and Try again re-reads both", async (first) => {
    const { progress, assets } = failProgressAndAssets();
    act(() => {
      if (first === "progress") {
        progress.fail(new Error("down"));
        assets.fail(new Error("down"));
      } else {
        assets.fail(new Error("down"));
        progress.fail(new Error("down"));
      }
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Try again" })));
    expect(progress.reload).toHaveBeenCalledTimes(1);
    expect(assets.reload).toHaveBeenCalledTimes(1);

    // Only the first one that failed came back: the classroom stays closed.
    act(() => (first === "progress" ? progress.next(["l1"]) : assets.next([])));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("One")).not.toBeInTheDocument();

    act(() => (first === "progress" ? assets.next([]) : progress.next(["l1"])));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("One")).toBeInTheDocument();
    expect(document.activeElement?.tagName).toBe("H1");
  });

  it("a good re-read of the materials through the channel, with no click, does not open the classroom with the progress that failed", () => {
    const { progress, assets } = failProgressAndAssets();
    act(() => {
      progress.fail(new Error("down"));
      assets.fail(new Error("down"));
    });
    // The materials channel re-reads on its own and succeeds: progress keeps failing.
    act(() => assets.next([]));
    expect(screen.getByRole("alert")).toHaveTextContent("We could not load lesson progress for this course.");
    expect(screen.queryByText("One")).not.toBeInTheDocument();
    expect(progress.reload).not.toHaveBeenCalled();
  });

  it("a Try again that fails again disarms the focus: the good read that comes afterwards does not pull it", async () => {
    const { progress, assets } = failProgressAndAssets();
    act(() => {
      assets.next([]);
      progress.fail(new Error("down"));
    });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Try again" })));
    act(() => progress.fail(new Error("still down")));
    expect(screen.getByRole("alert")).toBeInTheDocument();

    act(() => progress.next(["l1"]));
    expect(screen.getByText("One")).toBeInTheDocument();
    expect(document.activeElement?.tagName).not.toBe("H1");
  });

  it("whitelabel: the enrollment error does not link to our public course page", () => {
    mocks.searchParams = new URLSearchParams();
    vi.mocked(subscribeToEnrollment).mockImplementationOnce((_uid, _slug, _next, onError) => {
      onError(new Error("down"));
      return unsubscribable();
    });
    render(<EnrolledCourseWorkspace course={course} whitelabel />);
    expect(screen.getByText("We could not confirm your enrollment for this course.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open course page" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to my learning" })).toHaveAttribute("href", "/learn");
  });

  it("with the enrollment handed down by the parent, the classroom opens without fetching it again", () => {
    mocks.searchParams = new URLSearchParams("lesson=l1");
    mocks.completed = [];
    render(<EnrolledCourseWorkspace course={course} enrollment={{
      id: "enr-1", userId: "student-1", courseId: "course-1", courseSlug: "demo-course",
      courseTitle: "Demo course", courseCategory: "Leadership", courseImage: "",
      status: "active", source: "admin", progressPercent: 0, lastLessonId: null,
    }} />);
    expect(screen.getByText("One")).toBeInTheDocument();
    expect(mocks.enrollmentSubscriptions).toBe(0);
  });

  it("localizes course resource loading, kind, count and empty state with the existing asset contract", () => {
    mocks.searchParams = new URLSearchParams("lesson=l1");
    mocks.completed = [];
    let emit!: (assets: CourseAsset[]) => void;
    vi.mocked(subscribeToCourseAssets).mockImplementationOnce((_id, callback) => {
      emit = callback;
      return Object.assign(vi.fn(), { reload: vi.fn(async () => undefined) });
    });
    render(<I18nProvider initialLocale="es"><EnrolledCourseWorkspace course={course} tab="materials" enableFirestoreAssets /></I18nProvider>);
    expect(screen.getByText("Cargando recursos del curso...")).toBeInTheDocument();
    act(() => emit([{ id: "file-test", courseId: course.id, ownerId: "teacher-1", lessonId: null,
      kind: "lesson_material", fileName: "Worksheet $$50 $&.pdf", contentType: "application/pdf",
      size: 512, storagePath: "courses/course-1/assets/file-test.pdf", isPreview: false }]));
    // The localized count stays on the tab; the panel does not repeat "1 archivo".
    expect(screen.getByRole("link", { name: /^Materiales\s*1$/ })).toBeInTheDocument();
    expect(screen.queryByText("1 archivo")).not.toBeInTheDocument();
    expect(screen.getByText("Worksheet $$50 $&.pdf")).toBeInTheDocument();
    // A file with no lesson (for the whole course) goes in its own group.
    expect(screen.getByRole("heading", { name: "Archivos del curso" })).toBeInTheDocument();
    act(() => emit([]));
    expect(screen.getByText("Todavía no hay archivos para descargar.")).toBeInTheDocument();
  });

  it.each([false, true])("keeps the members cover in the hero, not Materials (preview=%s)", async (previewMode) => {
    mocks.searchParams = new URLSearchParams();
    mocks.pathname = previewMode ? "/teach/builder/course-1/preview/materials" : "/learn/courses/demo-course/materials";
    mocks.completed = [];
    let emit!: (assets: CourseAsset[]) => void;
    vi.mocked(subscribeToCourseAssets).mockImplementationOnce((_id, callback) => {
      emit = callback;
      return Object.assign(vi.fn(), { reload: vi.fn(async () => undefined) });
    });
    vi.mocked(getProtectedCourseAssetObjectUrl).mockImplementation(async (asset) => `blob:${asset.id}`);
    const cover: CourseAsset = {
      id: "members-art", courseId: course.id, ownerId: "teacher-1", lessonId: null,
      kind: "members_cover", fileName: "identity-only.png", contentType: "image/png",
      size: 512, storagePath: "courses/course-1/assets/identity-only.png", isPreview: false,
    };
    const material: CourseAsset = {
      ...cover, id: "worksheet", kind: "lesson_material", fileName: "Worksheet.png",
      storagePath: "courses/course-1/assets/worksheet.png",
    };
    const withCover = { ...course, membersCoverAssetId: cover.id };
    const workspace = (tab: ClassroomTab) => <I18nProvider initialLocale="en">
      <EnrolledCourseWorkspace course={withCover} tab={tab} previewMode={previewMode} enableFirestoreAssets />
    </I18nProvider>;
    const { rerender, container } = render(workspace("materials"));
    await act(async () => emit([
      cover, material,
      { ...cover, id: "course-art", kind: "course_cover", fileName: "course-art.png" },
      { ...material, id: "lesson-only", lessonId: "l1", fileName: "lesson-only.png" },
      { ...material, id: "module-only", moduleId: "m1", fileName: "module-only.png" },
    ]));
    // Materials also lists the file of the unlocked lesson (l1), not just the course's.
    // The count stays only on the tab ("Materials 2"); the panel's "2 files" badge is gone.
    expect(screen.getByRole("link", { name: /^Materials\s*2$/ })).toBeInTheDocument();
    expect(screen.queryByText("2 files")).not.toBeInTheDocument();
    expect(screen.getByText("Worksheet.png")).toBeInTheDocument();
    expect(screen.getByText("lesson-only.png")).toBeInTheDocument();
    for (const name of ["identity-only.png", "course-art.png", "module-only.png"]) {
      expect(screen.queryByText(name)).not.toBeInTheDocument();
    }

    await act(async () => emit([cover]));
    expect(screen.getByRole("link", { name: /^Materials$/ })).toBeInTheDocument();
    expect(screen.getByText("No files to download yet.")).toBeInTheDocument();

    rerender(workspace("lesson"));
    await waitFor(() => expect(container.querySelector(".members-hero__cover")).toHaveAttribute("src", "blob:members-art"));
    expect(recordLessonProgress).not.toHaveBeenCalled();
  });

  it("localizes the certificate link without changing its destination", () => {
    mocks.searchParams = new URLSearchParams("lesson=l2");
    mocks.completed = ["l1", "l2"];
    render(<I18nProvider initialLocale="es"><EnrolledCourseWorkspace course={course} /></I18nProvider>);
    // In the tab bar and, on the last completed lesson, in the button under the lesson.
    const links = screen.getAllByRole("link", { name: "Obtener certificado" });
    expect(links).toHaveLength(2);
    for (const link of links) expect(link).toHaveAttribute("href", "/learn/credentials");
    expect(recordLessonProgress).not.toHaveBeenCalled();
  });

  it("translates the sequential lock reason while keeping protected content and completion unavailable", () => {
    mocks.searchParams = new URLSearchParams("lesson=l2");
    mocks.completed = [];
    render(<I18nProvider initialLocale="es"><EnrolledCourseWorkspace
      course={{ ...course, dripStrategy: "sequential_progress" }} /></I18nProvider>);
    expect(screen.getByRole("heading", { name: "Lección bloqueada" })).toBeInTheDocument();
    // The screen says which lesson to complete and takes you to it (before: only "Completa la
    // lección anterior para desbloquearla").
    expect(screen.getByText('Termina "Lesson one" primero')).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ir a esa lección" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lección bloqueada" })).toBeDisabled();
    expect(screen.queryByText("Two")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(recordLessonProgress).not.toHaveBeenCalled();
  });

  it("passes the translated mini-player label without replacing the real iframe or resetting dismissal", () => {
    mocks.searchParams = new URLSearchParams("lesson=l1");
    mocks.completed = [];
    let observe!: IntersectionObserverCallback;
    const disconnect = vi.fn();
    vi.stubGlobal("IntersectionObserver", class {
      constructor(callback: IntersectionObserverCallback) { observe = callback; }
      observe() {}
      disconnect() { disconnect(); }
    });
    try {
      const videoCourse = { ...course, modules: course.modules.map((module) => ({ ...module,
        lessons: module.lessons.map((lesson) => lesson.id === "l1" ? {
          ...lesson, type: "video" as const, videoSource: "youtube" as const,
          externalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        } : lesson),
      })) };
      const { container, unmount } = render(<I18nProvider initialLocale="en"><ChangeLanguage />
        <EnrolledCourseWorkspace course={videoCourse} />
      </I18nProvider>);
      const iframe = container.querySelector("iframe");
      expect(iframe).not.toBeNull();
      act(() => observe([{ isIntersecting: false, boundingClientRect: { top: -400, height: 200 } } as IntersectionObserverEntry], {} as IntersectionObserver));
      fireEvent.click(screen.getByRole("button", { name: "Change language" }));
      const close = screen.getByRole("button", { name: "Cerrar mini reproductor" });
      expect(container.querySelector("iframe")).toBe(iframe);
      expect(container.querySelector(".member-video-dock")).toHaveAttribute("data-mini", "true");
      fireEvent.click(close);
      fireEvent.click(screen.getByRole("button", { name: "Change language" }));
      expect(container.querySelector(".member-video-dock")).toHaveAttribute("data-mini", "false");
      expect(container.querySelector("iframe")).toBe(iframe);
      expect(disconnect).not.toHaveBeenCalled();
      expect(recordLessonProgress).not.toHaveBeenCalled();
      unmount();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("translates all seven shared tab labels without changing routes or authored lesson names", () => {
    mocks.searchParams = new URLSearchParams("lesson=l2");
    mocks.pathname = "/learn/courses/demo-course";
    mocks.completed = [];
    const authoredTitle = "Lección $$50; código literal $&.";
    const localizedCourse = {
      ...course,
      communityEnabled: true,
      modules: course.modules.map((module) => ({ ...module, lessons: module.lessons.map((lesson) => lesson.id === "l1" ? { ...lesson, title: authoredTitle } : lesson) })),
    };
    vi.mocked(subscribeToCourseEvents).mockImplementationOnce((_courseId, onData) => {
      onData([liveEvent(new Date(Date.now() + 60 * 60 * 1000).toISOString())]);
      return unsubscribable();
    });
    render(<I18nProvider initialLocale="es"><EnrolledCourseWorkspace course={localizedCourse} enableFirestoreAssets /></I18nProvider>);
    const tabs = screen.getByRole("navigation", { name: "Secciones del curso" });
    for (const [tab, label] of [["lesson", "Lección"], ["materials", "Materiales"], ["lives", "Sesiones en vivo"], ["community", "Comunidad"], ["messages", "Mensajes"], ["review", "Reseña"], ["about", "Acerca del curso"]]) {
      expect(within(tabs).getByRole("link", { name: label })).toHaveAttribute("href", `/learn/courses/demo-course${tab === "lesson" ? "" : `/${tab}`}?lesson=l2`);
    }
    expect(screen.getByRole("button", { name: `Lección anterior: ${authoredTitle}` })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Todas las lecciones (2)" })).toBeInTheDocument();
    expect(mocks.enrollmentSubscriptions).toBe(1);
    expect(recordLessonProgress).not.toHaveBeenCalled();
  });

  // Old course: the text comes in the curriculum, but the video link only arrives with the
  // protected content. Deciding "text only" before that made the page jump.
  it("text lesson: while the protected content loads, the player box waits", () => {
    let emit!: Parameters<typeof subscribeToLessonContent>[1];
    vi.mocked(subscribeToLessonContent).mockImplementationOnce((_courseId, onNext) => {
      emit = onNext;
      return Object.assign(vi.fn(), { reload: vi.fn(async () => undefined) });
    });
    renderClassroom("lesson=l1");

    expect(document.querySelector("#member-lesson-player .member-video-stage")).not.toBeNull();
    expect(screen.getByText("Loading lesson content...")).toBeInTheDocument();
    // F-02: the panel stays busy and "loading" is a single notice, the stage's.
    expect(document.querySelector(".member-lesson-panel")).toHaveAttribute("aria-busy", "true");
    expect(screen.getAllByRole("status").filter((status) => /Loading/.test(status.textContent ?? ""))).toHaveLength(1);

    act(() => emit(new Map()));
    expect(document.querySelector("#member-lesson-player .member-video-stage")).toBeNull();
    expect(document.querySelector(".member-lesson-panel")).not.toHaveAttribute("aria-busy");
  });

  it("text lesson: no video box, and the text comes before the comments", () => {
    renderClassroom("lesson=l1");

    expect(document.querySelector("#member-lesson-player .member-video-stage")).toBeNull();
    const body = screen.getByText("One");
    const comments = screen.getByRole("region", { name: "Lesson comments" });
    expect(body.compareDocumentPosition(comments) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("first visit (no ?lesson=, no progress): the full cover, no short header", () => {
    renderClassroom("");

    expect(document.querySelector(".members-hero")).not.toBeNull();
    expect(document.querySelector(".member-classroom-head")).toBeNull();
  });

  it("renders explicit and deterministic legacy module posters using only safe course images", () => {
    mocks.searchParams = new URLSearchParams("lesson=l1");
    mocks.pathname = "/learn/courses/demo-course";
    mocks.completed = [];
    vi.mocked(subscribeToCourseAssets).mockClear();
    vi.mocked(getProtectedCourseAssetObjectUrl).mockClear();
    let emit!: (assets: CourseAsset[]) => void;
    vi.mocked(subscribeToCourseAssets).mockImplementationOnce((_id, callback) => {
      emit = callback;
      return Object.assign(vi.fn(), { reload: vi.fn(async () => undefined) });
    });
    const withPosters: Course = { ...course, modules: [
      { ...course.modules[0], coverAssetId: "old" },
      { id: "m2", title: "Legacy module", summary: "", lessons: [] },
    ] };
    const cover = (patch: Partial<CourseAsset>): CourseAsset => ({
      id: "old", courseId: course.id, ownerId: "teacher-1", lessonId: null, moduleId: "m1",
      kind: "module_cover", fileName: "z-old.png", contentType: "image/png", size: 123,
      storagePath: "courses/course-1/assets/old.png", downloadUrl: "/old.png", isPreview: false,
      createdAt: "2026-09-01", ...patch,
    });
    const assets = [
      cover({}),
      cover({ id: "new", createdAt: "2026-09-02", fileName: "a-new.png", downloadUrl: "/new.png" }),
      cover({ id: "legacy-old", moduleId: "m2", downloadUrl: "/legacy-old.png" }),
      cover({ id: "legacy-new", moduleId: "m2", createdAt: "2026-09-02", downloadUrl: "/legacy-new.png" }),
      cover({ id: "tracker", createdAt: "2026-09-03", downloadUrl: "https://tracker.invalid/secret.png" }),
      cover({ id: "private", moduleId: "m2", createdAt: "2026-09-03", downloadUrl: null }),
      cover({ id: "other-course", courseId: "other", moduleId: "m2", createdAt: "2026-09-03", downloadUrl: "/other.png" }),
      cover({ id: "material", kind: "lesson_material", createdAt: "2026-09-03", downloadUrl: "/material.png" }),
      cover({ id: "not-image", contentType: "application/pdf", createdAt: "2026-09-03", downloadUrl: "/document.pdf" }),
    ];
    const { rerender } = render(<I18nProvider initialLocale="en">
      <EnrolledCourseWorkspace course={withPosters} enableFirestoreAssets />
    </I18nProvider>);
    // With no cover yet (subscription with no answer), there is no poster strip.
    expect(screen.queryByRole("navigation", { name: "Modules" })).toBeNull();
    act(() => emit(assets));
    const rail = screen.getByRole("navigation", { name: "Modules" });
    expect(rail.closest("aside")).toHaveClass("member-classroom-sidebar");
    const firstPoster = within(rail).getByRole("button", { name: "Open module: Module one" });
    expect(firstPoster).toHaveClass("w-[120px]", "sm:w-[160px]");
    expect(firstPoster).toHaveAttribute("aria-current", "true");
    const image = firstPoster.querySelector("img")!;
    expect(image).toHaveAttribute("src", "/old.png");
    expect(image).toHaveAttribute("alt", "");
    expect(image).toHaveClass("object-cover");
    expect(image.parentElement).toHaveClass("aspect-[2/3]");
    expect(Array.from(rail.querySelectorAll("img"), (img) => img.getAttribute("src")))
      .toEqual(["/old.png", "/legacy-new.png"]);
    act(() => emit([...assets].reverse()));
    expect(firstPoster.querySelector("img")).toHaveAttribute("src", "/old.png");
    expect(within(rail).getByRole("button", { name: "Open module: Legacy module" }).querySelector("img"))
      .toHaveAttribute("src", "/legacy-new.png");
    rerender(<I18nProvider initialLocale="en"><EnrolledCourseWorkspace course={{ ...withPosters,
      modules: withPosters.modules.map((module) => ({ ...module, coverAssetId: "tracker" })),
    }} enableFirestoreAssets /></I18nProvider>);
    expect(firstPoster.querySelector("img")).toHaveAttribute("src", "/new.png");
    // With no module art, the strip would only repeat the playlist groups: it goes away.
    act(() => emit([]));
    expect(screen.queryByRole("navigation", { name: "Modules" })).toBeNull();
    act(() => emit(assets));
    expect(subscribeToCourseAssets).toHaveBeenCalledTimes(1);
    expect(getProtectedCourseAssetObjectUrl).not.toHaveBeenCalled();
    rerender(<I18nProvider initialLocale="en"><EnrolledCourseWorkspace
      course={{ ...withPosters, id: "other", slug: "other" }} enableFirestoreAssets /></I18nProvider>);
    expect(document.querySelector('img[src="/new.png"]')).toBeNull();
    expect(document.querySelector('img[src="/legacy-new.png"]')).toBeNull();
  });

  it("module posters navigate to pending lessons without bypassing drip or recording progress", () => {
    mocks.searchParams = new URLSearchParams("lesson=l1&campaign=literal");
    mocks.pathname = "/learn/courses/demo-course";
    mocks.completed = ["l1"];
    let emit!: (assets: CourseAsset[]) => void;
    vi.mocked(subscribeToCourseAssets).mockImplementationOnce((_id, callback) => {
      emit = callback;
      return Object.assign(vi.fn(), { reload: vi.fn(async () => undefined) });
    });
    const withModules: Course = { ...course, dripStrategy: "sequential_progress", modules: [
      { ...course.modules[0], summary: "First module description" },
      { id: "m2", title: "Module $$2 $&", summary: "Second module description", lessons: [
        { id: "l3", title: "Lesson three", type: "text", duration: "", isPreview: false, contentText: "Locked body" },
      ] },
      { id: "m3", title: "Empty module", summary: "", lessons: [] },
    ] };
    const { rerender } = render(<I18nProvider initialLocale="en"><EnrolledCourseWorkspace course={withModules} enableFirestoreAssets /></I18nProvider>);
    // The posters only show up when some module has art.
    act(() => emit([{
      id: "cover-m1", courseId: course.id, ownerId: "teacher-1", lessonId: null, moduleId: "m1",
      kind: "module_cover", fileName: "m1.png", contentType: "image/png", size: 1,
      storagePath: "courses/course-1/assets/m1.png", downloadUrl: "/m1.png", isPreview: false,
    }]));
    const rail = screen.getByRole("navigation", { name: "Modules" });
    expect(rail.closest("aside")).toHaveClass("min-w-0");
    expect(within(rail).getByRole("list")).toHaveClass("overflow-x-scroll", "[scrollbar-width:auto]");
    expect(within(rail).getByText("First module description").tagName).toBe("P");
    expect(within(rail).queryByText("Second module description")).not.toBeInTheDocument();
    fireEvent.click(within(rail).getByRole("button", { name: "Open module: Module one" }));
    expect(mocks.replace).toHaveBeenLastCalledWith("/learn/courses/demo-course?lesson=l2&campaign=literal", { scroll: false });
    expect(screen.getByText("Two")).toBeInTheDocument();
    const second = within(rail).getByRole("button", { name: "Open module: Module $$2 $&" });
    fireEvent.click(second);
    expect(mocks.replace).toHaveBeenLastCalledWith("/learn/courses/demo-course?lesson=l3&campaign=literal", { scroll: false });
    expect(second).toHaveAttribute("aria-current", "true");
    expect(within(rail).getByText("Second module description").tagName).toBe("P");
    expect(within(rail).queryByText("First module description")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Lesson locked" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lesson locked" })).toBeDisabled();
    expect(screen.queryByText("Locked body")).not.toBeInTheDocument();
    expect(within(rail).getByRole("button", { name: "Open module: Empty module" })).toBeDisabled();
    expect(document.getElementById("member-lesson-player")?.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(recordLessonProgress).not.toHaveBeenCalled();
    rerender(<I18nProvider initialLocale="en"><EnrolledCourseWorkspace course={{ ...withModules,
      modules: withModules.modules.map((module) => ({ ...module, summary: "  " })),
    }} enableFirestoreAssets /></I18nProvider>);
    expect(rail.querySelector("p")).toBeNull();
  });

  it("no module art: no poster strip, but the current module's description stays", () => {
    mocks.searchParams = new URLSearchParams("lesson=l1");
    mocks.completed = [];
    render(<EnrolledCourseWorkspace course={{ ...course, modules: [
      { ...course.modules[0], summary: "What this module covers" },
    ] }} />);

    expect(screen.queryByRole("navigation", { name: "Modules" })).toBeNull();
    expect(screen.getByText("What this module covers")).toBeInTheDocument();
  });

  // jsdom does not apply media queries: the proof is the class that hides the button
  // from 1181px up, where the playlist is already beside the video (the layout becomes
  // one column at max-width: 1180px).
  it("'All lessons' disappears where the list is already visible next to the video", () => {
    renderClassroom("lesson=l1");

    expect(screen.getByRole("button", { name: "All lessons (2)" })).toHaveClass("min-[1181px]:hidden");
  });

  it("does not subscribe to module covers or show posters without an enrollment", () => {
    mocks.searchParams = new URLSearchParams("lesson=l1");
    mocks.completed = [];
    vi.mocked(subscribeToCourseAssets).mockClear();
    vi.mocked(subscribeToEnrollment).mockImplementationOnce((_uid, _slug, onNext) => {
      onNext(null);
      return unsubscribable();
    });
    render(<I18nProvider initialLocale="en"><EnrolledCourseWorkspace course={course} enableFirestoreAssets /></I18nProvider>);
    expect(screen.queryByRole("navigation", { name: "Modules" })).not.toBeInTheDocument();
    expect(subscribeToCourseAssets).not.toHaveBeenCalled();
    expect(recordLessonProgress).not.toHaveBeenCalled();
  });

  it("uses subscribed lesson thumbnails in both lists without signing private content", () => {
    mocks.searchParams = new URLSearchParams("lesson=l1");
    mocks.completed = [];
    vi.mocked(subscribeToCourseAssets).mockClear();
    vi.mocked(getProtectedCourseAssetObjectUrl).mockClear();
    let emit!: (assets: CourseAsset[]) => void;
    vi.mocked(subscribeToCourseAssets).mockImplementationOnce((_id, callback) => {
      emit = callback;
      return Object.assign(vi.fn(), { reload: vi.fn(async () => undefined) });
    });
    const { container, rerender } = render(<EnrolledCourseWorkspace course={course} enableFirestoreAssets />);
    const thumbnail = (patch: Partial<CourseAsset>): CourseAsset => ({
      id: "old", courseId: course.id, ownerId: "teacher-1", lessonId: "l1",
      kind: "lesson_thumbnail", fileName: "z-old.png", contentType: "image/png", size: 123,
      storagePath: "courses/course-1/assets/old.png", downloadUrl: "/old.png", isPreview: false,
      createdAt: "2026-09-01", ...patch,
    });
    act(() => emit([
      thumbnail({}),
      thumbnail({ id: "new", fileName: "a-new.png", createdAt: "2026-09-02", downloadUrl: "/new.png" }),
      thumbnail({ id: "tracker", createdAt: "2026-09-03", downloadUrl: "https://tracker.invalid/secret.png" }),
      thumbnail({ id: "private", lessonId: "l2", storagePath: "private.png", downloadUrl: null }),
      thumbnail({ id: "other-course", courseId: "other", lessonId: "l2", downloadUrl: "/other-course.png" }),
    ]));
    expect(container.querySelector('img[src="/new.png"]')).not.toBeNull();
    expect(container.querySelector('img[src="/old.png"]')).toBeNull();
    expect(container.querySelector('img[src="/other-course.png"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /All lessons/ }));
    const overlay = screen.getByRole("dialog", { name: "All lessons" });
    expect(overlay.querySelector('img[src="/new.png"]')).not.toBeNull();
    act(() => emit([]));
    expect(container.querySelector('img[src="/new.png"]')).toBeNull();
    act(() => emit([thumbnail({})]));
    expect(container.querySelector('img[src="/old.png"]')).not.toBeNull();
    expect(subscribeToCourseAssets).toHaveBeenCalledTimes(1);
    expect(getProtectedCourseAssetObjectUrl).not.toHaveBeenCalled();
    rerender(<EnrolledCourseWorkspace course={{ ...course, id: "other", slug: "other" }} enableFirestoreAssets />);
    expect(container.querySelector('img[src="/old.png"]')).toBeNull();
  });

  it("in a lesson (?lesson=): short header with the back button in place of the cover", () => {
    renderClassroom("lesson=l2");

    expect(document.querySelector(".members-hero")).toBeNull();
    // The teacher has a public profile: the back button takes you to their area.
    expect(screen.getByRole("link", { name: "← Ana Prof's members area" })).toHaveAttribute("href", "/learn/areas/@ana");
    expect(screen.getByRole("progressbar", { name: /complete/ })).toBeInTheDocument();
  });

  it("anyone with progress does not see the cover again, even without ?lesson=", () => {
    renderClassroom("", ["l1"]);

    expect(document.querySelector(".members-hero")).toBeNull();
    expect(document.querySelector(".member-classroom-head")).not.toBeNull();
  });

  it("the playlist sits on the side, with the current lesson highlighted — and there is ONE single complete button", () => {
    renderClassroom("lesson=l2");

    const playlist = screen.getByRole("navigation", { name: "Lessons" });
    expect(playlist.closest("aside")).toHaveClass("member-classroom-sidebar");
    expect(within(playlist).getByRole("button", { name: /Lesson two/ })).toHaveAttribute(
      "aria-current",
      "true",
    );

    // Before: one under the video AND one in each grid card, all for the same lesson.
    expect(screen.getAllByRole("button", { name: /^Mark (complete|incomplete)$/ })).toHaveLength(1);
  });

  it("in the list, the check of the completed lesson undoes it through the same path as the button under the video", async () => {
    renderClassroom("lesson=l2", ["l1"]);

    fireEvent.click(screen.getByRole("button", { name: 'Mark "Lesson one" incomplete' }));

    await waitFor(() => expect(recordLessonProgress).toHaveBeenCalled());
    expect(JSON.stringify(vi.mocked(recordLessonProgress).mock.calls[0])).toContain("l1");
  });
});

/**
 * Re-analysis item 9: the classroom tabs have their own address. Materials,
 * community, messages and review lived in the same scroll as the lesson, with no
 * address — no sharing and no going back. And the "Lesson tools" strip had three
 * buttons that only SCROLLED the page.
 */
describe("classroom tabs with their own address", () => {
  beforeEach(() => {
    mocks.replace.mockReset();
    mocks.enrollmentSubscriptions = 0;
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("in a lesson: the tab bar carries the current lesson along, and only the lesson renders", () => {
    renderClassroom("lesson=l2");

    const tabs = screen.getByRole("navigation", { name: "Course sections" });
    expect(within(tabs).getByRole("link", { name: "Lesson" })).toHaveAttribute(
      "href",
      "/learn/courses/demo-course?lesson=l2",
    );
    expect(within(tabs).getByRole("link", { name: "Lesson" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(tabs).getByRole("link", { name: "Community" })).toHaveAttribute(
      "href",
      "/learn/courses/demo-course/community?lesson=l2",
    );

    expect(document.querySelector("#member-lesson-player")).not.toBeNull();
    expect(screen.queryByTestId("community-feed")).toBeNull();
    expect(screen.queryByTestId("messages-panel")).toBeNull();
    expect(screen.queryByTestId("review-panel")).toBeNull();
  });

  it("the buttons that only scrolled the page are gone", () => {
    renderClassroom("lesson=l2");

    expect(screen.queryByRole("button", { name: /Current lesson/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Resources/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Discussion$/ })).toBeNull();
  });

  it("on the Community tab: the feed knows who the teacher is — id and public name", () => {
    renderClassroom("lesson=l2", [], "community");

    const feed = screen.getByTestId("community-feed");
    expect(feed).toHaveAttribute("data-instructor-ids", "teacher-1");
    expect(feed).toHaveAttribute("data-instructor", "Ana Prof");
  });

  it("on the Community tab: the feed shows, the player does not, and 'Lesson' returns the SAME lesson", () => {
    renderClassroom("lesson=l2", [], "community");

    expect(screen.getByTestId("community-feed")).toBeInTheDocument();
    expect(document.querySelector("#member-lesson-player")).toBeNull();

    const tabs = screen.getByRole("navigation", { name: "Course sections" });
    expect(within(tabs).getByRole("link", { name: "Community" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(tabs).getByRole("link", { name: "Lesson" })).toHaveAttribute(
      "href",
      "/learn/courses/demo-course?lesson=l2",
    );
  });

  it("Messages and Review are tabs, each renders only its own panel", () => {
    const { unmount } = renderClassroom("lesson=l2", [], "messages");
    expect(screen.getByTestId("messages-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("review-panel")).toBeNull();
    unmount();

    renderClassroom("lesson=l2", [], "review");
    expect(screen.getByTestId("review-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("messages-panel")).toBeNull();
  });

  // The live tab always existed and, with no session scheduled, opened an empty page.
  it("with no live session scheduled, the 'Live sessions' tab does not appear", () => {
    vi.mocked(subscribeToCourseEvents).mockImplementationOnce((_courseId, onData) => {
      onData([liveEvent(new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString())]);
      return unsubscribable();
    });
    renderClassroom("lesson=l2");

    const tabs = screen.getByRole("navigation", { name: "Course sections" });
    expect(within(tabs).queryByRole("link", { name: /live/i })).toBeNull();
  });

  it("with a session scheduled, the tab is called 'Live sessions' and shows the session", () => {
    vi.mocked(subscribeToCourseEvents).mockImplementation((_courseId, onData) => {
      onData([liveEvent(new Date(Date.now() + 60 * 60 * 1000).toISOString())]);
      return unsubscribable();
    });
    try {
      const { unmount } = renderClassroom("lesson=l2");
      const tabs = screen.getByRole("navigation", { name: "Course sections" });
      expect(within(tabs).getByRole("link", { name: "Live sessions" })).toHaveAttribute(
        "href",
        "/learn/courses/demo-course/lives?lesson=l2",
      );
      unmount();

      renderClassroom("lesson=l2", [], "lives");
      expect(screen.getByText("Live Q&A")).toBeInTheDocument();
    } finally {
      vi.mocked(subscribeToCourseEvents).mockImplementation(() => unsubscribable());
    }
  });

  it("the live tab opened by address, with no session, says there is none", () => {
    let emit!: (events: ReturnType<typeof liveEvent>[]) => void;
    vi.mocked(subscribeToCourseEvents).mockImplementationOnce((_courseId, onData) => {
      emit = onData;
      return unsubscribable();
    });
    renderClassroom("lesson=l2", [], "lives");

    const tabs = screen.getByRole("navigation", { name: "Course sections" });
    expect(within(tabs).getByRole("link", { name: "Live sessions" })).toHaveAttribute("aria-current", "page");
    // Before the first read we do not know: no "no sessions" yet.
    expect(screen.queryByText("No live sessions are scheduled right now.")).not.toBeInTheDocument();

    act(() => emit([]));
    expect(screen.getByText("No live sessions are scheduled right now.")).toBeInTheDocument();
  });

  it("the About tab is the whole cover, even for anyone who already has progress", () => {
    renderClassroom("lesson=l2", ["l1"], "about");

    expect(document.querySelector(".members-hero")).not.toBeNull();
    expect(document.querySelector("#member-lesson-player")).toBeNull();
  });
});

/**
 * Back goes up ONE level. Inside a tab, the "←" went straight to "My courses":
 * someone who opened the community to ask a question about the lesson was thrown out of the
 * whole course and had to find the course, the lesson and their place again.
 */
describe("the classroom back button goes up one level", () => {
  beforeEach(() => {
    mocks.replace.mockReset();
    mocks.enrollmentSubscriptions = 0;
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("in the lesson, goes back to the creator's area (a single exit, no course list beside it)", () => {
    renderClassroom("lesson=l2");

    expect(screen.getByRole("link", { name: "← Ana Prof's members area" })).toHaveAttribute("href", "/learn/areas/@ana");
    expect(screen.queryByRole("link", { name: "← My courses" })).toBeNull();
  });

  it("on a tab, goes back to the LESSON — the same one, via ?lesson=", () => {
    const { unmount } = renderClassroom("lesson=l2", [], "community");

    const back = screen.getByRole("link", { name: "← Lesson" });
    expect(back).toHaveAttribute("href", "/learn/courses/demo-course?lesson=l2");
    expect(screen.queryByRole("link", { name: "← My courses" })).toBeNull();
    unmount();

    renderClassroom("lesson=l2", [], "materials");
    expect(screen.getByRole("link", { name: "← Lesson" })).toHaveAttribute(
      "href",
      "/learn/courses/demo-course?lesson=l2",
    );
  });

  it("on the About tab (which is the cover), the cover also returns the lesson", () => {
    renderClassroom("lesson=l2", ["l1"], "about");

    expect(document.querySelector(".members-hero__back")).toHaveAttribute(
      "href",
      "/learn/courses/demo-course?lesson=l2",
    );
    expect(document.querySelector(".members-hero__back")).toHaveTextContent("Lesson");
  });
});

/**
 * The Community tab gave no signal: someone in the lesson had no way of knowing
 * that a question was waiting for an answer. The tab bar already knew how to show
 * a number (Materials shows one) — Community never got one.
 */
describe("the open questions counter on the Community tab", () => {
  beforeEach(() => {
    mocks.replace.mockReset();
    mocks.enrollmentSubscriptions = 0;
    Element.prototype.scrollIntoView = vi.fn();
    vi.mocked(countOpenCommunityQuestions).mockClear();
  });

  it("shows how many course questions are still unanswered", async () => {
    vi.mocked(countOpenCommunityQuestions).mockResolvedValueOnce(3);

    renderClassroom("lesson=l2");

    const tabs = screen.getByRole("navigation", { name: "Course sections" });
    expect(await within(tabs).findByRole("link", { name: /Community\s*3/ })).toBeInTheDocument();
    // Reads by the SAME key the feed uses (course.id, not the route slug).
    expect(countOpenCommunityQuestions).toHaveBeenCalledWith("course-1");
  });

  it("with no open question, no number appears", async () => {
    vi.mocked(countOpenCommunityQuestions).mockResolvedValueOnce(0);

    renderClassroom("lesson=l2");

    const tabs = screen.getByRole("navigation", { name: "Course sections" });
    await waitFor(() => expect(countOpenCommunityQuestions).toHaveBeenCalled());
    expect(within(tabs).getByRole("link", { name: "Community" })).toBeInTheDocument();
    expect(tabs.querySelector(".member-classroom-tabs__count")).toBeNull();
  });

  it("on the En vivo tab, the session date is shown in the person's language", () => {
    const startsAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
    vi.mocked(subscribeToCourseEvents).mockImplementationOnce((_courseId, onData) => {
      onData([{
        id: "event-1",
        courseId: course.id,
        courseSlug: course.slug,
        courseTitle: course.title,
        ownerId: "teacher-1",
        title: "Live Q&A",
        description: "",
        type: "live_class",
        status: "scheduled",
        startsAt,
        externalUrl: "https://meet.example.com/live",
        recordingAssetId: null,
      }]);
      return unsubscribable();
    });
    mocks.searchParams = new URLSearchParams("lesson=l1");
    mocks.pathname = "/learn/courses/demo-course/lives";
    mocks.completed = [];
    render(<I18nProvider initialLocale="es"><EnrolledCourseWorkspace course={course} tab="lives" /></I18nProvider>);

    expect(screen.getByText(
      formatEventDateTime(startsAt, "es"),
    )).toBeInTheDocument();
  });
});

/**
 * At the crucial moment the join button slipped away: the lessons tab gave no signal and the
 * "now" of the sessions tab stopped at the moment the list arrived. Now a
 * strip on ALL tabs, with the clock running; the canceled one shows up marked; and
 * the read that fails says it failed, with "Try again".
 */
describe("live sessions in the classroom", () => {
  const NOW = Date.parse("2026-11-25T20:50:00.000Z");
  const status = (text: string) =>
    screen.getAllByText(text).find((element) => element.getAttribute("role") === "status");

  beforeEach(() => {
    mocks.replace.mockReset();
    mocks.enrollmentSubscriptions = 0;
    Element.prototype.scrollIntoView = vi.fn();
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(subscribeToCourseEvents).mockImplementation(() => unsubscribable());
  });

  it("10 min before, the strip with Join shows on the lessons tab; the notice only changes when it goes 'live'", () => {
    vi.mocked(subscribeToCourseEvents).mockImplementation((_courseId, onData) => {
      onData([liveEvent(new Date(NOW + 10 * 60_000).toISOString())]);
      return unsubscribable();
    });
    renderClassroom("lesson=l2");

    expect(screen.getByText("Starts in 10 min: Live Q&A")).toBeInTheDocument();
    expect(status("Starting soon: Live Q&A")).toBeTruthy();
    // The link's name carries the title (the visible line stays outside the tree).
    expect(screen.getByRole("link", { name: "Join: Live Q&A" })).toHaveAttribute("href", "https://meet.example.com/live");

    // The count moves; the screen reader announcement does not.
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByText("Starts in 9 min: Live Q&A")).toBeInTheDocument();
    expect(status("Starting soon: Live Q&A")).toBeTruthy();

    act(() => vi.advanceTimersByTime(10 * 60_000));
    expect(status("Live now: Live Q&A")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Join: Live Q&A" })).toBeInTheDocument();
  });

  // Webinar at 6:00 and office hours at 7:30: at 7:20 the strip opened the webinar's room
  // (the first in the list still "live"); now the one with the nearest start counts.
  it.each([
    ["7:20", 80, "Starts in 10 min: Office hours", "https://meet.example.com/office"],
    ["6:10", 10, "Live now: Webinar", "https://meet.example.com/webinar"],
  ])("two sessions 90 min apart, at %s: the strip shows the one closest to now", (_label, offset, text, href) => {
    const webinarStart = NOW - offset * 60_000;
    vi.mocked(subscribeToCourseEvents).mockImplementation((_courseId, onData) => {
      onData([
        { ...liveEvent(new Date(webinarStart).toISOString()), id: "webinar", title: "Webinar", externalUrl: "https://meet.example.com/webinar" },
        { ...liveEvent(new Date(webinarStart + 90 * 60_000).toISOString()), id: "office", title: "Office hours", externalUrl: "https://meet.example.com/office" },
      ]);
      return unsubscribable();
    });
    renderClassroom("lesson=l2");

    // The visible line (live, it and the notice have the same text).
    expect(screen.getAllByText(text).some((element) => element.getAttribute("role") !== "status")).toBe(true);
    const title = text.split(": ")[1];
    expect(screen.getByRole("link", { name: `Join: ${title}` })).toHaveAttribute("href", href);
  });

  it("a deadline on the sessions tab: due date and 'Open link', never 'Join now'; once expired, it is removed", () => {
    vi.mocked(subscribeToCourseEvents).mockImplementation((_courseId, onData) => {
      onData([
        { ...liveEvent(new Date(NOW + 5 * 60_000).toISOString()), id: "due", title: "Essay due", type: "deadline" },
        { ...liveEvent(new Date(NOW - 30 * 60_000).toISOString()), id: "late", title: "Quiz due", type: "deadline" },
      ]);
      return unsubscribable();
    });
    renderClassroom("lesson=l2", [], "lives");

    const due = screen.getByText("Essay due").closest("li") as HTMLElement;
    expect(within(due).getByText(/^Due: /)).toBeInTheDocument();
    expect(within(due).getByRole("link", { name: "Open link" })).toBeInTheDocument();
    expect(within(due).queryByText("Happening now")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Join now" })).not.toBeInTheDocument();
    expect(screen.queryByText("Quiz due")).not.toBeInTheDocument();
    // A deadline does not become a "live" strip.
    expect(screen.queryByText(/Starts in|Live now/)).not.toBeInTheDocument();
  });

  it("the strip also appears on the other tabs; a distant session shows no strip", () => {
    vi.mocked(subscribeToCourseEvents).mockImplementation((_courseId, onData) => {
      onData([liveEvent(new Date(NOW - 30 * 60_000).toISOString())]);
      return unsubscribable();
    });
    const { unmount } = renderClassroom("lesson=l2", [], "community");
    expect(status("Live now: Live Q&A")).toBeTruthy();
    unmount();

    vi.mocked(subscribeToCourseEvents).mockImplementation((_courseId, onData) => {
      onData([liveEvent(new Date(NOW + 2 * 60 * 60_000).toISOString())]);
      return unsubscribable();
    });
    renderClassroom("lesson=l2");
    expect(screen.queryByText(/Starts in|Live now/)).not.toBeInTheDocument();
  });

  it("on the sessions tab: the canceled one is marked and has no link; the next one has the calendar", () => {
    vi.mocked(subscribeToCourseEvents).mockImplementation((_courseId, onData) => {
      onData([
        { ...liveEvent(new Date(NOW + 24 * 60 * 60_000).toISOString()), id: "cancelled", title: "Called off", status: "cancelled" },
        { ...liveEvent(new Date(NOW + 48 * 60 * 60_000).toISOString()), id: "next", title: "Next Q&A" },
      ]);
      return unsubscribable();
    });
    renderClassroom("lesson=l2", [], "lives");

    expect(subscribeToCourseEvents).toHaveBeenLastCalledWith(
      "course-1", expect.any(Function), expect.any(Function), { includeCancelled: true },
    );
    const cancelled = screen.getByText("Called off").closest("li") as HTMLElement;
    expect(within(cancelled).getByText("Cancelled")).toBeInTheDocument();
    expect(cancelled.querySelector("s")).not.toBeNull();
    expect(within(cancelled).queryByRole("link")).not.toBeInTheDocument();
    const next = screen.getByText("Next Q&A").closest("li") as HTMLElement;
    expect(within(next).getByRole("link", { name: "Open session link" })).toBeInTheDocument();
    expect(within(next).getByRole("link", { name: "Add to Google Calendar" })).toBeInTheDocument();
    // The canceled one does not become a strip.
    expect(screen.queryByText(/Starts in|Live now/)).not.toBeInTheDocument();
  });

  it("reading the sessions fails: error and Try again, never 'no sessions'", async () => {
    let deliver!: (events: ReturnType<typeof liveEvent>[]) => void;
    const reload = vi.fn(async () => deliver([liveEvent(new Date(NOW + 60 * 60_000).toISOString())]));
    vi.mocked(subscribeToCourseEvents).mockImplementation((_courseId, onData, onError) => {
      deliver = onData;
      onError(new Error("offline"));
      return Object.assign(vi.fn(), { reload });
    });
    renderClassroom("lesson=l2", [], "lives");

    expect(screen.getByText("We could not load the live sessions for this course.")).toBeInTheDocument();
    expect(screen.queryByText("No live sessions are scheduled right now.")).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });
    expect(reload).toHaveBeenCalledOnce();
    expect(screen.getByText("Live Q&A")).toBeInTheDocument();
    expect(screen.queryByText("We could not load the live sessions for this course.")).not.toBeInTheDocument();
  });
});
