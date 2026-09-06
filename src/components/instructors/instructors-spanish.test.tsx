import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import { InstructorsDirectory } from "./instructors-directory";
import { InstructorProfileView } from "./instructor-profile-view";
import { CookieConsent } from "@/components/site/cookie-consent";
import { PrivacyChoicesButton } from "@/components/site/privacy-choices-button";
import type { PublicProfile } from "@/domain/user-profile";
import type { TeacherCourse } from "@/domain/teacher-course";
import { listPublicProfiles, subscribeToPublicProfile } from "@/lib/data/user-profiles";
import { subscribeToPublishedTeacherCoursesByOwner } from "@/lib/data/published-courses";

const fixture = vi.hoisted(() => ({
  directory: "loaded",
  courseError: false,
  profileError: false,
  profile: { uid: "teacher", displayName: "Original Author", username: "author", photoURL: null, bio: "Original author biography", credentials: [] },
  course: { id: "course", ownerId: "teacher", title: "Original course title", summary: "Original course summary", category: "Original category", status: "published", lessonCount: 2, paymentType: "free", freePreviewLessonId: "lesson", modules: [] },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/shared/user-avatar", () => ({ UserAvatar: () => null }));
vi.mock("@/components/courses/course-tile", () => ({ CourseTile: (p: { title: string; meta: string; badge: string; priceLabel: string }) => <article>{p.title} {p.meta} {p.badge} {p.priceLabel}</article> }));
vi.mock("@/lib/supabase/config", () => ({ getSupabaseClientConfig: () => ({}) }));
vi.mock("@/lib/data/user-profiles", () => ({
  listPublicProfiles: vi.fn(async () => {
    if (fixture.directory === "error") throw new Error("backend");
    return fixture.directory === "empty" ? [] : [fixture.profile];
  }),
  subscribeToPublicProfile: vi.fn((_uid: string, next: (p: PublicProfile) => void, fail: () => void) => {
    if (fixture.profileError) fail(); else next(fixture.profile as PublicProfile);
    return () => {};
  }),
}));
vi.mock("@/lib/data/published-courses", () => ({
  isInternalSmokeCourse: () => false,
  subscribeToPublishedTeacherCoursesByOwner: vi.fn((_uid: string, next: (p: TeacherCourse[]) => void, fail: () => void) => {
    if (fixture.courseError) fail(); else next([fixture.course as TeacherCourse]);
    return () => {};
  }),
}));
vi.mock("@/lib/consent/cookie-consent", () => ({
  subscribeCookieConsent: () => () => {}, shouldShowCookieBanner: () => true,
  setStoredCookieConsent: vi.fn(), reopenCookieConsent: vi.fn(),
}));
vi.mock("@/lib/posthog/client", () => ({ applyAnalyticsConsent: vi.fn() }));
function Switch() {
  const { setLocale } = useTranslation();
  return <button onClick={() => setLocale("es")}>ES</button>;
}
function show(children: React.ReactNode) {
  return render(<I18nProvider initialLocale="en"><Switch />{children}</I18nProvider>);
}
afterEach(() => { cleanup(); fixture.directory = "loaded"; fixture.courseError = false; fixture.profileError = false; vi.clearAllMocks(); });

it("translates a loaded directory without fetching again or translating author data", async () => {
  show(<InstructorsDirectory />);
  await screen.findByRole("link", { name: "View profile" });
  fireEvent.click(screen.getByText("ES"));
  expect(screen.getByRole("link", { name: "Ver perfil" })).toBeInTheDocument();
  expect(screen.getByText("Original author biography")).toBeInTheDocument();
  expect(listPublicProfiles).toHaveBeenCalledTimes(1);
});

it.each([
  ["empty", "Public instructor profiles appear after review.", "Los perfiles públicos de los instructores aparecen después de la revisión."],
  ["error", "Instructor profiles could not load right now.", "No se pudieron cargar los perfiles de instructores en este momento."],
])("translates an existing directory %s state", async (mode, en, es) => {
  fixture.directory = mode;
  show(<InstructorsDirectory />);
  await screen.findByText(en);
  fireEvent.click(screen.getByText("ES"));
  expect(screen.getByText(es)).toBeInTheDocument();
  expect(listPublicProfiles).toHaveBeenCalledTimes(1);
});

it("translates loaded profile metrics and course labels without restarting subscriptions", async () => {
  show(<InstructorProfileView uid="teacher" />);
  await screen.findByText(/2 lessons/);
  fireEvent.click(screen.getByText("ES"));
  expect(screen.getByText(/2 lecciones/)).toHaveTextContent("Vista previa gratuita Inscripción gratuita");
  expect(screen.getByText("Cursos publicados")).toBeInTheDocument();
  expect(screen.getByText("Original author biography")).toBeInTheDocument();
  expect(subscribeToPublicProfile).toHaveBeenCalledTimes(1);
  expect(subscribeToPublishedTeacherCoursesByOwner).toHaveBeenCalledTimes(1);
});

it("translates an already stored course error at render time", async () => {
  fixture.courseError = true;
  show(<InstructorProfileView uid="teacher" />);
  await screen.findByText("Instructor courses could not load right now.");
  fireEvent.click(screen.getByText("ES"));
  expect(screen.getByText("No se pudieron cargar los cursos del instructor en este momento.")).toBeInTheDocument();
  expect(subscribeToPublishedTeacherCoursesByOwner).toHaveBeenCalledTimes(1);
});

it("translates the open cookie dialog and privacy control while preserving the legal destination", () => {
  show(<><CookieConsent /><PrivacyChoicesButton /></>);
  expect(screen.getByRole("dialog", { name: "Cookie preferences" })).toBeInTheDocument();
  fireEvent.click(screen.getByText("ES"));
  expect(screen.getByRole("dialog", { name: "Preferencias de cookies" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Aceptar todas" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Rechazar las no esenciales" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Tus opciones de privacidad" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Política de privacidad" })).toHaveAttribute("href", "/legal/privacy");
});
