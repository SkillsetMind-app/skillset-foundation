import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  free: true, priceAmountMinor: null, currency: "USD", ratingAverage: 0, ratingCount: 0,
};
const routerRefresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: routerRefresh }) }));
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
  await screen.findByText("View profile");
  fireEvent.click(screen.getByText("ES"));
  expect(screen.getByText("Ver perfil")).toBeInTheDocument();
  expect(screen.getByText("Original author biography")).toBeInTheDocument();
  expect(listPublicProfiles).toHaveBeenCalledTimes(1);
});

// The directory leads to the profile by the @ (the canonical address), not by the uid.
it("links each directory card to the @handle address", async () => {
  show(<InstructorsDirectory />);
  expect(await screen.findByRole("link", { name: "Original Author" })).toHaveAttribute("href", "/@author");
});

// The whole card is the destination: a single link, on the name, stretched by the
// .marketplace-card__link; the "View profile" stays written, without being another link.
it("makes the whole directory card one stretched link on the name", async () => {
  show(<InstructorsDirectory />);
  const link = await screen.findByRole("link", { name: "Original Author" });
  const card = link.closest("article")!;
  expect(link).toHaveClass("marketplace-card__link");
  expect(card).toHaveClass("relative", "motion-hover-lift");
  expect(card.querySelectorAll("a")).toHaveLength(1);
  expect(screen.getByText("View profile").closest("a")).toBeNull();
});

it.each([
  ["empty", "Public instructor profiles appear once creators finish setup.", "Los perfiles públicos de los instructores aparecen cuando el creador completa su configuración."],
  ["error", "Instructor profiles could not load right now.", "No se pudieron cargar los perfiles de instructores en este momento."],
])("translates an existing directory %s state", async (mode, en, es) => {
  fixture.directory = mode;
  show(<InstructorsDirectory />);
  await screen.findByText(en);
  fireEvent.click(screen.getByText("ES"));
  expect(screen.getByText(es)).toBeInTheDocument();
  expect(listPublicProfiles).toHaveBeenCalledTimes(1);
});

// The error was a dead end: "Try again" calls the same read, and the notice only clears
// when it comes back with the profiles.
it("a directory failure offers Try again, which reads again and shows the profiles", async () => {
  fixture.directory = "error";
  show(<InstructorsDirectory />);
  await screen.findByText("Instructor profiles could not load right now.");

  fixture.directory = "loaded";
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("link", { name: "Original Author" })).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(listPublicProfiles).toHaveBeenCalledTimes(2);
  // The button is gone: focus stayed on the directory frame, not on <body>.
  expect(document.activeElement).not.toBe(document.body);
  expect(document.activeElement).toHaveAttribute("tabindex", "-1");
});

it("two clicks on the directory's Try again before it redraws open a single re-read", async () => {
  fixture.directory = "error";
  show(<InstructorsDirectory />);
  await screen.findByText("Instructor profiles could not load right now.");

  fixture.directory = "loaded";
  const button = screen.getByRole("button", { name: "Try again" });
  act(() => {
    button.click();
    button.click();
  });
  expect(await screen.findByRole("link", { name: "Original Author" })).toBeInTheDocument();
  expect(listPublicProfiles).toHaveBeenCalledTimes(2);
});

it("a profile whose courses did not load offers Try again, which asks for the page again", () => {
  show(<InstructorProfileView profile={fixture.profile as PublicProfile} courses={null} />);
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(routerRefresh).toHaveBeenCalledTimes(1);
});

// An empty directory only leads to the store when it has a real course; the teacher's
// profile never does (it is their bio link).
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
  await screen.findByText("Public instructor profiles appear once creators finish setup.");

  expect(document.querySelectorAll('a[href="/courses"]')).toHaveLength(count);
});

it("translates profile labels at render time without touching author data", () => {
  // A long bio (more than 180 characters): it is the one that gets "Read more".
  const bio = "Original author biography. ".repeat(8).trim();
  show(<InstructorProfileView profile={{ ...(fixture.profile as PublicProfile), bio }} courses={[course]} />);
  expect(screen.getByRole("heading", { name: "Courses" })).toBeInTheDocument();
  fireEvent.click(screen.getByText("ES"));
  expect(screen.getByRole("heading", { name: "Cursos" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Sobre Original Author" })).toBeInTheDocument();
  expect(screen.getByText("Gratis")).toBeInTheDocument();
  expect(screen.getByText("Leer más")).toBeInTheDocument();
  expect(screen.getByText(bio)).toBeInTheDocument();
  // Main button and the course row.
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
