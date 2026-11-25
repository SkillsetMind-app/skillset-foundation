import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TeacherCourseStudio } from "@/components/teacher/teacher-course-studio";
import type { TeacherCourse } from "@/domain/teacher-course";

const authState = vi.hoisted(() => ({
  user: { uid: "teacher-1", roles: ["teacher"] },
}));

const mocks = vi.hoisted(() => ({
  deleteOrArchiveCourse: vi.fn(),
  getCourseAudience: vi.fn(),
  getMyCoursesBeingDeleted: vi.fn(),
  push: vi.fn(),
  subscribeCalls: 0,
  failNextReads: 0,
  params: {} as Record<string, string>,
}));

const courses: TeacherCourse[] = [
  {
    id: "course-1",
    ownerId: "teacher-1",
    title: "Facilitation foundations",
    summary: "Build a dependable practice for leading productive group sessions.",
    category: "Facilitation & Group Work",
    status: "draft",
    modules: [],
    lessonCount: 0,
    paymentType: "one_time",
    enrollmentCount: 12,
  },
  {
    id: "course-2",
    ownerId: "teacher-1",
    title: "Mentoring essentials",
    summary: "Create a clear and repeatable framework for meaningful mentoring conversations.",
    category: "Mentorship & Professional Growth",
    status: "draft",
    modules: [],
    lessonCount: 0,
    paymentType: "free",
    enrollmentCount: 5,
  },
  {
    id: "course-3",
    ownerId: "teacher-1",
    title: "Community leadership",
    summary: "Shape a welcoming member space with useful rituals and sustainable participation.",
    category: "Leadership & Management",
    status: "draft",
    modules: [],
    lessonCount: 0,
    paymentType: "subscription_monthly",
    communityEnabled: true,
  },
];

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
  useSearchParams: () => ({ get: (key: string) => mocks.params[key] ?? null }),
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => authState,
}));

vi.mock("@/lib/data/teacher-courses", () => ({
  deleteOrArchiveCourse: mocks.deleteOrArchiveCourse,
  getCourseAudience: mocks.getCourseAudience,
  subscribeToTeacherCourses: (
    _ownerId: string,
    onData: (nextCourses: TeacherCourse[]) => void,
    onError?: (error: Error) => void,
  ) => {
    mocks.subscribeCalls += 1;
    if (mocks.subscribeCalls > 20) {
      throw new Error("subscribeToTeacherCourses went into a render loop");
    }
    // failNextReads > 0: the read fails (on the channel or on reload) before it succeeds.
    const read = () => {
      if (mocks.failNextReads > 0) {
        mocks.failNextReads -= 1;
        onError?.(new Error("read failed"));
      } else {
        onData(courses);
      }
    };
    read();
    return Object.assign(vi.fn(), { reload: async () => read() });
  },
}));

vi.mock("@/lib/data/course-deletions", () => ({
  getMyCoursesBeingDeleted: mocks.getMyCoursesBeingDeleted,
}));

async function renderStudio() {
  render(<TeacherCourseStudio />);
  return screen.findByRole("table", { name: "Products" });
}

describe("TeacherCourseStudio — product list", () => {
  beforeEach(() => {
    mocks.deleteOrArchiveCourse.mockReset();
    mocks.deleteOrArchiveCourse.mockResolvedValue({ outcome: "deleted" });
    mocks.getCourseAudience.mockReset();
    mocks.getCourseAudience.mockResolvedValue({ enrollments: 0, orders: 0, subscriptions: 0 });
    mocks.push.mockReset();
    mocks.getMyCoursesBeingDeleted.mockReset();
    mocks.getMyCoursesBeingDeleted.mockResolvedValue([]);
    mocks.subscribeCalls = 0;
    mocks.failNextReads = 0;
    mocks.params = {};
  });

  // F-11: the read that failed only had "Please refresh". Now "Try again" reads
  // again through the same channel, and the error goes away when the list arrives.
  it("offers Try again after a failed read and clears the error when the list arrives", async () => {
    mocks.failNextReads = 1;
    render(<TeacherCourseStudio />);

    expect(await screen.findByRole("alert")).toHaveTextContent("We could not load your products.");
    // With no list read, "No products yet" would claim what is not known.
    expect(screen.queryByText("No products yet")).toBeNull();
    expect(screen.queryByRole("link", { name: /Create product/ })).toBeNull();
    // The sentence no longer tells people to reload the page: the button is next to it.
    expect(screen.getByRole("alert")).not.toHaveTextContent(/refresh/i);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("table", { name: "Products" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(mocks.subscribeCalls).toBe(1);
  });

  // The re-read that fails again: the button waits with the ring in the spot that the
  // wait face already reserved, with the same name, and goes back to rest.
  it("Try again keeps its name and the ring's place while it reads again", async () => {
    mocks.failNextReads = 2;
    render(<TeacherCourseStudio />);
    const retry = await screen.findByRole("button", { name: "Try again" });
    expect(retry.querySelectorAll('[class*="grid-area"]')).toHaveLength(2);

    fireEvent.click(retry);
    expect(screen.getByRole("button", { name: "Try again" })).toBe(retry);
    expect(retry).toHaveAttribute("aria-busy", "true");
    await waitFor(() => expect(retry).not.toHaveAttribute("aria-busy"));
    expect(screen.getByRole("alert")).toHaveTextContent("We could not load your products.");
  });

  // The teacher's top search ("Search your products") used to reload Home
  // the same. Now it lands here with ?q= and the list arrives already filtered; a new search
  // with the list open changes the filter without remounting the screen.
  it("arrives filtered by the ?q= from the top search and follows a new search", async () => {
    mocks.params = { q: "mentoring" };
    const { rerender } = render(<TeacherCourseStudio />);
    const table = await screen.findByRole("table", { name: "Products" });

    expect(screen.getByRole("searchbox")).toHaveValue("mentoring");
    expect(within(table).getAllByRole("row").slice(1)).toHaveLength(1);
    expect(within(table).getByText("Mentoring essentials")).toBeInTheDocument();

    mocks.params = { q: "community" };
    rerender(<TeacherCourseStudio />);

    expect(screen.getByRole("searchbox")).toHaveValue("community");
    expect(within(table).getByText("Community leadership")).toBeInTheDocument();
    expect(within(table).queryByText("Mentoring essentials")).toBeNull();
  });

  // The person got three unnamed columns and forty buttons across ten products.
  // The header and the single primary action make each row readable and stable.
  it("shows desktop column headers and keeps one primary action per course", async () => {
    const table = await renderStudio();

    expect(within(table).getByRole("columnheader", { name: "Product" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Status" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Access" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Students" })).toBeInTheDocument();

    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    rows.forEach((row) => {
      expect(within(row).getAllByRole("link", { name: "Open" })).toHaveLength(1);
      expect(within(row).queryByRole("link", { name: "Edit" })).not.toBeInTheDocument();
      expect(within(row).getByRole("button", { name: /More actions for/i })).toBeInTheDocument();
    });

    fireEvent.click(
      within(rows[0]).getByRole("button", { name: "More actions for Facilitation foundations" }),
    );
    const menu = screen.getByRole("menu", { name: "Actions for Facilitation foundations" });
    expect(within(menu).getByRole("menuitem", { name: "Edit" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "View as student" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Delete" })).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: "Duplicate" })).not.toBeInTheDocument();
  });

  // Confirming in place of the buttons made the row change width and pushed
  // the rest of the table. The destructive decision now lives in its own dialog.
  it("opens delete confirmation in a dialog without replacing row actions", async () => {
    const table = await renderStudio();
    const courseRow = within(table).getByRole("row", { name: /Facilitation foundations/i });
    const menuTrigger = within(courseRow).getByRole("button", {
      name: "More actions for Facilitation foundations",
    });

    fireEvent.click(menuTrigger);
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));

    const dialog = screen.getByRole("dialog", { name: "Delete Facilitation foundations" });
    expect(dialog).toBeInTheDocument();
    expect(within(courseRow).getByRole("link", { name: "Open" })).toBeInTheDocument();
    expect(
      within(courseRow).getByRole("button", {
        name: "More actions for Facilitation foundations",
      }),
    ).toBeInTheDocument();
    expect(within(courseRow).queryByRole("button", { name: /Confirm delete/i })).toBeNull();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(menuTrigger).toHaveFocus();
  });

  // The navigation shortcuts took the first strip and hid the subject
  // of the page. In the DOM, the list has to come before them for reading and keyboard.
  // Wave G2b: the deleted product leaves the table right away, but files and videos
  // are removed starting a day later, in batches. Until then (pending queue) it
  // shows up outside the table, with the badge.
  it("shows products still being deleted with the chip, outside the table and not clickable", async () => {
    mocks.getMyCoursesBeingDeleted.mockResolvedValue([
      { courseId: "gone-1", title: "Old workshop", requestedAt: "2026-10-08T10:00:00Z" },
    ]);
    const table = await renderStudio();

    const list = await screen.findByRole("list", { name: "Products being deleted" });
    expect(within(list).getByText("Old workshop")).toBeInTheDocument();
    expect(within(list).getByText("Being deleted")).toHaveClass("status-chip--warning");
    expect(
      within(list).getByText("Files and videos are removed in hourly batches, starting about a day after deletion."),
    ).toBeInTheDocument();
    expect(within(list).queryByRole("link")).toBeNull();
    expect(within(list).queryByRole("button")).toBeNull();
    expect(within(table).queryByText("Old workshop")).toBeNull();
  });

  it.each([
    ["nothing is being deleted", () => Promise.resolve([])],
    ["the read fails", () => Promise.reject(new Error("offline"))],
  ])("shows no being-deleted list when %s", async (_label, read) => {
    mocks.getMyCoursesBeingDeleted.mockImplementation(read);
    await renderStudio();

    await waitFor(() => expect(mocks.getMyCoursesBeingDeleted).toHaveBeenCalled());
    expect(screen.queryByRole("list", { name: "Products being deleted" })).toBeNull();
  });

  it("places workspace shortcuts after the product list", async () => {
    const table = await renderStudio();
    const shortcuts = screen.getByRole("navigation", { name: "Product workspace shortcuts" });

    expect(table.compareDocumentPosition(shortcuts) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
