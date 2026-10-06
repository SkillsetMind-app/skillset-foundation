import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import { InstructorsDirectory } from "./instructors-directory";
import { InstructorProfileView } from "./instructor-profile-view";
import { CookieConsent } from "@/components/site/cookie-consent";
import { RealCoursesProvider } from "@/components/site/real-courses";
import { PrivacyChoicesButton } from "@/components/site/privacy-choices-button";
import type { PublicProfile } from "@/domain/user-profile";
import type { CreatorCourse } from "@/lib/data/server/public-profile";
import { listPublicProfiles } from "@/lib/data/user-profiles";

const fixture = vi.hoisted(() => ({
  directory: "loaded",
  profile: { uid: "teacher", displayName: "Original Author", username: "author", photoURL: null, bio: "Original author biography", credentials: [] },
}));
const course: CreatorCourse = {
  id: "course", href: "/courses/original-course", title: "Original course title", coverImageUrl: null,
  free: true, priceAmountMinor: null, currency: "USD", ratingAverage: 0, ratingCount: 0, enrollmentCount: 0,
};
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/shared/user-avatar", () => ({ UserAvatar: () => null }));
vi.mock("@/lib/data/user-profiles", () => ({
  listPublicProfiles: vi.fn(async () => {
    if (fixture.directory === "error") throw new Error("backend");
    return fixture.directory === "empty" ? [] : [fixture.profile];
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
afterEach(() => { cleanup(); fixture.directory = "loaded"; vi.clearAllMocks(); });

it("translates a loaded directory without fetching again or translating author data", async () => {
  show(<InstructorsDirectory />);
  await screen.findByRole("link", { name: "View profile" });
  fireEvent.click(screen.getByText("ES"));
  expect(screen.getByRole("link", { name: "Ver perfil" })).toBeInTheDocument();
  expect(screen.getByText("Original author biography")).toBeInTheDocument();
  expect(listPublicProfiles).toHaveBeenCalledTimes(1);
});

// O diretório leva ao perfil pelo @ (o endereço canônico), não pelo uid.
it("links each directory card to the @handle address", async () => {
  show(<InstructorsDirectory />);
  expect(await screen.findByRole("link", { name: "View profile" })).toHaveAttribute("href", "/@author");
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

// Diretório vazio só leva à loja quando ela tem curso real; o perfil do
// professor não leva nunca (é o link da bio dele).
it.each([[true, 1], [false, 0]])("links the store only while it has a real course (%s)", async (value, count) => {
  fixture.directory = "empty";
  render(
    <I18nProvider initialLocale="en">
      <RealCoursesProvider value={value}>
        <InstructorsDirectory />
        <InstructorProfileView profile={fixture.profile as PublicProfile} courses={[course]} />
      </RealCoursesProvider>
    </I18nProvider>,
  );
  await screen.findByText("Public instructor profiles appear after review.");

  expect(document.querySelectorAll('a[href="/courses"]')).toHaveLength(count);
});

it("translates profile labels at render time without touching author data", () => {
  show(<InstructorProfileView profile={fixture.profile as PublicProfile} courses={[course]} />);
  expect(screen.getByRole("heading", { name: "Courses" })).toBeInTheDocument();
  fireEvent.click(screen.getByText("ES"));
  expect(screen.getByRole("heading", { name: "Cursos" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Sobre Original Author" })).toBeInTheDocument();
  expect(screen.getByText("Gratis")).toBeInTheDocument();
  expect(screen.getByText("Leer más")).toBeInTheDocument();
  expect(screen.getByText("Original author biography")).toBeInTheDocument();
  // Botão principal e linha do curso.
  expect(screen.getAllByText("Original course title")).toHaveLength(2);
});

it("translates the course error at render time", () => {
  show(<InstructorProfileView profile={fixture.profile as PublicProfile} courses={null} />);
  expect(screen.getByText("Instructor courses could not load right now.")).toBeInTheDocument();
  fireEvent.click(screen.getByText("ES"));
  expect(screen.getByText("No se pudieron cargar los cursos del instructor en este momento.")).toBeInTheDocument();
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
