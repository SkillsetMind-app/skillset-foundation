import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";
import type { TeacherCourse } from "@/domain/teacher-course";
import { CourseMarketplace } from "./course-marketplace";

const state = vi.hoisted(() => ({ locale: "en" as "en" | "es", query: new URLSearchParams("cat=Performance&q=focus&offer=SPRING"), replace: vi.fn(), subscribe: vi.fn() }));
vi.mock("@/components/i18n/i18n-provider", () => ({ useTranslation: () => ({ locale: state.locale, t: (key: string) => translate(getDictionary(state.locale), key) }) }));
vi.mock("@/components/auth/auth-provider", () => ({ useAuth: () => ({ status: "unauthenticated", user: null }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/courses", useSearchParams: () => state.query, useRouter: () => ({ replace: state.replace }) }));
vi.mock("@/lib/supabase/config", () => ({ getSupabaseClientConfig: () => ({}) }));
vi.mock("@/components/courses/use-instructor-names", () => ({ useInstructorNames: () => new Map() }));
vi.mock("@/lib/data/published-courses", async (original) => ({ ...(await original<typeof import("@/lib/data/published-courses")>()), subscribeToPublishedTeacherCourses: state.subscribe }));

beforeEach(() => {
  vi.clearAllMocks();
  state.locale = "en";
  state.query = new URLSearchParams("cat=Performance&q=focus&offer=SPRING");
});
afterEach(cleanup);

it("keeps loaded courses, filter IDs, search and URL offer when switching to Spanish", async () => {
  state.subscribe.mockImplementation((next: (courses: TeacherCourse[]) => void) => {
    next([{ id: "focus", ownerId: "teacher", title: "Deep focus", summary: "Author's own words", category: "Performance", status: "published", modules: [], lessonCount: 3, priceAmountMinor: 9900, currency: "USD" }]);
    return () => {};
  });
  const { rerender } = render(<CourseMarketplace />);
  await screen.findByRole("link", { name: "Deep focus" });
  fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "price-asc" } });
  state.locale = "es";
  rerender(<CourseMarketplace />);
  expect(screen.getByPlaceholderText("Busca una habilidad, categoría o resultado")).toHaveValue("focus");
  expect(screen.getByLabelText("Ordenar por")).toHaveValue("price-asc");
  expect(screen.getByRole("button", { name: /Performance/ })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByText("Performance · 3 lecciones")).toBeInTheDocument();
  expect(screen.getByText("Author's own words")).toBeInTheDocument();
  expect(state.subscribe).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: /Todos los cursos/ }));
  const destination = new URL(state.replace.mock.lastCall![0], "https://skillset.test");
  expect(destination.searchParams.get("cat")).toBeNull();
  expect(destination.searchParams.get("q")).toBe("focus");
  expect(destination.searchParams.get("offer")).toBe("SPRING");
});

it("keeps a category search result across EN to ES and also searches its translated label", async () => {
  state.query = new URLSearchParams("q=Personal+Development&offer=SPRING");
  state.subscribe.mockImplementation((next: (courses: TeacherCourse[]) => void) => {
    next([{ id: "focus", ownerId: "teacher", title: "Deep focus", summary: "Author's own words", category: "Personal Development", status: "published", modules: [], lessonCount: 3, priceAmountMinor: 9900, currency: "USD" }]);
    return () => {};
  });
  const { rerender } = render(<CourseMarketplace />);
  await screen.findByRole("link", { name: "Deep focus" });

  state.locale = "es";
  rerender(<CourseMarketplace />);

  const search = screen.getByPlaceholderText("Busca una habilidad, categoría o resultado");
  expect(search).toHaveValue("Personal Development");
  expect(screen.getByRole("link", { name: "Deep focus" })).toBeInTheDocument();
  expect(screen.getByText("Desarrollo personal · 3 lecciones")).toBeInTheDocument();
  fireEvent.change(search, { target: { value: "desarrollo personal" } });
  expect(await screen.findByRole("link", { name: "Deep focus" })).toBeInTheDocument();
  expect(state.subscribe).toHaveBeenCalledTimes(1);
  const destination = new URL(state.replace.mock.lastCall![0], "https://skillset.test");
  expect(destination.searchParams.get("q")).toBe("desarrollo personal");
  expect(destination.searchParams.get("offer")).toBe("SPRING");
});

it("keeps a Spanish category search result when switching back to English", async () => {
  state.locale = "es";
  state.query = new URLSearchParams("cat=Personal+Development&q=Desarrollo+personal&offer=SPRING");
  state.subscribe.mockImplementation((next: (courses: TeacherCourse[]) => void) => {
    next([{ id: "focus", ownerId: "teacher", title: "Deep focus", summary: "Author's own words", category: "Personal Development", status: "published", modules: [], lessonCount: 3, priceAmountMinor: 9900, currency: "USD" }]);
    return () => {};
  });
  const { rerender } = render(<CourseMarketplace />);
  await screen.findByRole("link", { name: "Deep focus" });

  state.locale = "en";
  rerender(<CourseMarketplace />);

  expect(screen.getByPlaceholderText("Search skill, category, or outcome")).toHaveValue("Desarrollo personal");
  expect(screen.getByRole("link", { name: "Deep focus" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Personal Development/ })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByText("Personal Development · 3 lessons")).toBeInTheDocument();
  expect(state.subscribe).toHaveBeenCalledTimes(1);
  expect(state.replace).not.toHaveBeenCalled();
  expect(state.query.get("cat")).toBe("Personal Development");
  expect(state.query.get("q")).toBe("Desarrollo personal");
  expect(state.query.get("offer")).toBe("SPRING");
});
