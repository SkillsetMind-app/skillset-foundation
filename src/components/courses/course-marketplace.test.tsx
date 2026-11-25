import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";
import type { TeacherCourse } from "@/domain/teacher-course";
import { CourseMarketplace } from "./course-marketplace";

const state = vi.hoisted(() => ({
  locale: "en" as "en" | "es", query: new URLSearchParams("cat=Performance&q=focus&offer=SPRING"), replace: vi.fn(), subscribe: vi.fn(),
  auth: { status: "unauthenticated", user: null } as { status: string; user: { uid: string } | null },
  wishlist: vi.fn(), toggle: vi.fn(),
}));
vi.mock("@/components/i18n/i18n-provider", () => ({ useTranslation: () => ({ locale: state.locale, t: (key: string) => translate(getDictionary(state.locale), key) }) }));
vi.mock("@/components/auth/auth-provider", () => ({ useAuth: () => state.auth }));
vi.mock("@/lib/data/wishlist", () => ({ subscribeToUserWishlistCourseIds: state.wishlist, toggleWishlistCourse: state.toggle }));
vi.mock("@/lib/data/enrollments", () => ({ subscribeToUserEnrollments: () => () => {} }));
vi.mock("next/navigation", () => ({ usePathname: () => "/courses", useSearchParams: () => state.query, useRouter: () => ({ replace: state.replace }) }));
vi.mock("@/lib/supabase/config", () => ({ getSupabaseClientConfig: () => ({}) }));
vi.mock("@/components/courses/use-instructor-names", () => ({ useInstructorNames: () => new Map() }));
vi.mock("@/lib/data/published-courses", async (original) => ({ ...(await original<typeof import("@/lib/data/published-courses")>()), subscribeToPublishedTeacherCourses: state.subscribe }));

beforeEach(() => {
  vi.clearAllMocks();
  state.locale = "en";
  state.query = new URLSearchParams("cat=Performance&q=focus&offer=SPRING");
  state.auth = { status: "unauthenticated", user: null };
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

it("a title with $& in the wishlist label appears literally, without becoming '{title}'", async () => {
  // In a replace with no callback, "$&" becomes the matched piece ("{title}"). The title is
  // the teacher's text, not ours.
  state.subscribe.mockImplementation((next: (courses: TeacherCourse[]) => void) => {
    next([{ id: "focus", ownerId: "teacher", title: "Deep $& focus", summary: "Author's own words", category: "Performance", status: "published", modules: [], lessonCount: 3, priceAmountMinor: 9900, currency: "USD" }]);
    return () => {};
  });
  render(<CourseMarketplace />);
  expect(await screen.findByRole("button", { name: "Save Deep $& focus to wishlist" })).toBeInTheDocument();
});

// "All courses 0" while the list loaded read as an empty store; and the waiting cards
// had no price row, so the page jumped on load.
it("while loading, the category has no number and the waiting cards have the real card's footer", () => {
  state.query = new URLSearchParams("");
  state.subscribe.mockImplementation(() => () => {});
  const { container } = render(<CourseMarketplace />);

  expect(screen.getByRole("button", { name: "All courses" })).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Loading courses...");
  expect(container.querySelectorAll(".marketplace-card")).toHaveLength(6);
  expect(container.querySelectorAll(".marketplace-card .marketplace-card__footer")).toHaveLength(6);
});

it("the failure to load the list is announced to the screen reader", () => {
  state.subscribe.mockImplementation((_next: unknown, onError: () => void) => {
    onError();
    return () => {};
  });
  render(<CourseMarketplace />);

  expect(screen.getByRole("alert")).toHaveTextContent(translate(getDictionary("en"), "publicCourses.loadCoursesError"));
});

// The failure was a dead end ("Refresh the page"): now "Try again" reads again through the same
// subscription, and the "Marketplace opening soon" empty state does not appear next to the error.
it("the list failure offers Try again, which reads again without resubscribing and only removes the notice when the courses arrive", async () => {
  state.query = new URLSearchParams("");
  let next: (courses: TeacherCourse[]) => void = () => {};
  let finish: () => void = () => {};
  const reload = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
  state.subscribe.mockImplementation((onData: (courses: TeacherCourse[]) => void, onError: () => void) => {
    next = onData;
    onError();
    return Object.assign(() => {}, { reload });
  });
  render(<CourseMarketplace />);

  expect(screen.getByRole("alert")).toHaveTextContent("Courses could not load right now.");
  expect(screen.queryByText("Marketplace opening soon")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(reload).toHaveBeenCalledTimes(1);
  expect(state.subscribe).toHaveBeenCalledTimes(1);
  // Locked while reading; the notice stays until the response.
  const busy = screen.getByRole("button", { name: "Trying again..." });
  expect(busy).toBeDisabled();
  expect(busy).toHaveAttribute("aria-busy", "true");
  expect(screen.getByRole("alert")).toBeInTheDocument();

  await act(async () => {
    next([{ id: "focus", ownerId: "teacher", title: "Deep focus", summary: "", category: "Performance", status: "published", modules: [], lessonCount: 3, priceAmountMinor: 9900, currency: "USD" }]);
    finish();
  });
  expect(await screen.findByRole("link", { name: "Deep focus" })).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  // The button disappeared: focus stayed on the catalog section, not on <body>.
  expect(document.activeElement).toHaveClass("marketplace-section");
});

// Saving a favorite used to clear the SAME notice: the failure to read favorites vanished
// with the "Try again", without the favorites having arrived.
it("the failure to save a favorite does not erase the failure to read favorites, nor its Try again", async () => {
  state.query = new URLSearchParams("");
  state.auth = { status: "authenticated", user: { uid: "u-1" } };
  state.subscribe.mockImplementation((next: (courses: TeacherCourse[]) => void) => {
    next([{ id: "focus", ownerId: "teacher", title: "Deep focus", summary: "", category: "Performance", status: "published", modules: [], lessonCount: 3, priceAmountMinor: 9900, currency: "USD" }]);
    return Object.assign(() => {}, { reload: vi.fn(async () => undefined) });
  });
  const reload = vi.fn(async () => undefined);
  state.wishlist.mockImplementation((_uid: string, _next: unknown, onError: (error: Error) => void) => {
    onError(new Error("offline"));
    return Object.assign(() => {}, { reload });
  });
  state.toggle.mockRejectedValue(new Error("offline"));
  render(<CourseMarketplace />);

  expect(screen.getByText("Your wishlist could not load right now.")).toBeInTheDocument();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save Deep focus to wishlist" })));
  expect(screen.getByText("Could not update your saved courses. Please try again.")).toBeInTheDocument();
  expect(screen.getByText("Your wishlist could not load right now.")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(reload).toHaveBeenCalledTimes(1);
  expect(state.wishlist).toHaveBeenCalledTimes(1);
});

// On the phone, header and open filters took about 800px before the first
// course. The filters stay behind a button (CSS only hides them below
// 640px) and the button says how many are in effect; each filter keeps working.
it("the filters stay behind a button that opens and closes and says how many are in effect", () => {
  state.subscribe.mockImplementation(() => () => {});
  render(<CourseMarketplace />);

  const toggle = screen.getByRole("button", { name: /^Filters/ });
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(toggle).toHaveAccessibleName("Filters Active filters: 2");
  const panel = document.getElementById(toggle.getAttribute("aria-controls")!)!;
  expect(panel).not.toHaveClass("is-open");

  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(panel).toHaveClass("is-open");

  fireEvent.click(within(panel).getByRole("button", { name: "All courses" }));
  expect(toggle).toHaveAccessibleName("Filters Active filters: 1");
  fireEvent.change(within(panel).getByPlaceholderText("Search skill, category, or outcome"), { target: { value: "" } });
  expect(toggle).toHaveAccessibleName("Filters");
});
