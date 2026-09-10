import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import { EnrolledCourseWorkspace } from "@/components/learn/enrolled-course-workspace";
import { LessonListOverlay } from "@/components/learn/lesson-list-overlay";
import type { CommunitySpace, Course } from "@/domain/learning";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";

const mocks = vi.hoisted(() => ({
  user: { uid: "student-es" }, params: new URLSearchParams("lesson=lesson-es"),
  router: { refresh: vi.fn(), replace: vi.fn() }, events: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router, useSearchParams: () => mocks.params,
  usePathname: () => "/learn/courses/course-es/lives",
}));
vi.mock("@/components/auth/auth-provider", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("@/lib/data/enrollments", () => ({ subscribeToEnrollment: (_uid: string, _course: string, next: (value: unknown) => void) => {
  next({ id: "enrollment-es", courseId: "course-es", courseSlug: "course-es", status: "active", source: "payment", progressPercent: 0 });
  return () => {};
} }));
vi.mock("@/lib/data/lesson-progress", () => ({
  subscribeToCompletedLessons: (_id: string, next: (ids: string[]) => void) => { next([]); return () => {}; },
  recordLessonProgress: vi.fn(),
}));
vi.mock("@/lib/data/lesson-content", () => ({
  subscribeToLessonContent: (_id: string, next: (content: Map<string, unknown>) => void) => { next(new Map()); return () => {}; },
  resolveLessonContent: () => ({}),
}));
vi.mock("@/lib/data/community-posts", () => ({ countOpenCommunityQuestions: () => new Promise(() => {}) }));
vi.mock("@/lib/data/course-events", () => ({ subscribeToCourseEvents: mocks.events }));
vi.mock("@/lib/data/user-profiles", () => ({ subscribeToPublicProfile: () => () => {} }));
vi.mock("@/lib/posthog/events", () => ({ track: { lessonStarted: vi.fn() } }));
vi.mock("@/components/learn/lesson-comments", () => ({ LessonComments: () => null }));
vi.mock("@/components/learn/community-feed", () => ({
  CommunityFeed: ({ space }: { space: CommunitySpace }) => <div><h2>{space.name}</h2><p>{space.description}</p></div>,
}));

const course = {
  id: "course-es", slug: "course-es", title: "Original course $&", category: "Original category",
  summary: "Original summary", image: null, membersTheme: "dark", communityEnabled: true,
  modules: [{ id: "module-es", title: "Original module $&", summary: "", lessons: [
    { id: "lesson-es", title: "Original lesson $&", type: "text", duration: "5 min", contentText: "Original body", isPreview: false },
  ] }],
} as unknown as Course;
function ChangeLanguage() {
  const { locale, setLocale } = useTranslation();
  return <button onClick={() => setLocale(locale === "es" ? "en" : "es")}>Change language</button>;
}
beforeEach(() => { vi.clearAllMocks(); });
afterEach(cleanup);

describe("remaining classroom copy uses real dictionaries", () => {
  it("localizes live agenda actions and preserves event names and links during a locale switch", () => {
    mocks.events.mockImplementation((_course, next) => {
      next([{ id: "event", title: "Original session $&", type: "live_class", startsAt: new Date(Date.now() - 60_000).toISOString(), externalUrl: "https://example.test/live" }]);
      return () => {};
    });
    render(<I18nProvider initialLocale="es"><ChangeLanguage /><EnrolledCourseWorkspace course={course} tab="lives" /></I18nProvider>);
    expect(screen.getByText("Próximas sesiones de este curso")).toBeVisible();
    expect(screen.getByText("En vivo ahora")).toBeVisible();
    expect(screen.getByText("Original session $&")).toBeVisible();
    expect(screen.getByRole("link", { name: "Unirse ahora" })).toHaveAttribute("href", "https://example.test/live");
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("link", { name: "Join now" })).toHaveAttribute("href", "https://example.test/live");
    expect(mocks.events).toHaveBeenCalledTimes(1);
  });

  it("localizes only generated community metadata, preserving the course title literally", () => {
    render(<I18nProvider initialLocale="es"><ChangeLanguage /><EnrolledCourseWorkspace course={course} tab="community" /></I18nProvider>);
    expect(screen.getByRole("heading", { name: "Comunidad de Original course $&" })).toBeVisible();
    expect(screen.getByText("Un espacio del curso para anuncios, preguntas, recursos y conversaciones entre estudiantes.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Change language" }));
    expect(screen.getByRole("heading", { name: "Original course $& community" })).toBeVisible();
  });

  it("keeps the real curriculum search, module names and locked/completed labels localized", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const t = (key: string) => translate(getDictionary("es"), key);
    render(<I18nProvider initialLocale="es"><LessonListOverlay
      modules={course.modules} selectedLessonId="lesson-es" completedLessonIds={["lesson-es"]}
      unlockStateById={new Map([["lesson-es", { unlocked: false, unlocksAt: null, reason: "previous_lesson_required" }]])}
      onSelect={onSelect} onClose={onClose}
    /></I18nProvider>);
    expect(screen.getByRole("dialog", { name: t("learn.classroom.curriculum.all") })).toBeVisible();
    const search = screen.getByRole("searchbox", { name: t("learn.classroom.curriculum.search") });
    fireEvent.change(search, { target: { value: "$&" } });
    expect(screen.getByText("Original lesson $&")).toBeVisible();
    expect(screen.getByText(/Original module \$&/)).toBeVisible();
    expect(screen.getByText(new RegExp(t("learn.classroom.curriculum.completed")))).toHaveTextContent(t("learn.classroom.curriculum.locked"));
    fireEvent.click(screen.getByRole("button", { name: /Original lesson \$&/ }));
    expect(onSelect).toHaveBeenCalledWith("lesson-es");
    expect(onClose).toHaveBeenCalledOnce();
  });
});
