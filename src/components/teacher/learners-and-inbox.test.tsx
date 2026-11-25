import { cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TeacherInboxQuestions } from "@/components/teacher/teacher-inbox-questions";
import { TeacherStudentsList } from "@/components/teacher/teacher-students-list";
import { useTeacherInboxCount } from "@/components/teacher/use-teacher-inbox-count";
import { countThreadsAwaitingReply } from "@/domain/course-message";

// The two new teacher pages: Students (all learners of all
// products) and the Inbox (community questions + messages), with the
// number of pending items shown in the bar. The queries themselves (columns,
// order, filters) are in src/lib/data/caixa-de-entrada-leituras.test.ts.

const mocks = vi.hoisted(() => ({
  getMyCourseSummaries: vi.fn(),
  getOpenCommunityQuestions: vi.fn(),
  getCommunityPostsByIds: vi.fn(),
  getMyCourseStudents: vi.fn(),
  countThreadsAwaitingTeacher: vi.fn(),
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    status: "authenticated",
    user: { uid: "teacher-1", email: "t@example.com", displayName: "T", emailVerified: true, photoURL: null, roles: ["teacher"] },
  }),
}));
vi.mock("@/lib/data/teacher-courses", () => ({ getMyCourseSummaries: mocks.getMyCourseSummaries }));
vi.mock("@/lib/data/community-posts", () => ({
  getOpenCommunityQuestions: mocks.getOpenCommunityQuestions,
  getCommunityPostsByIds: mocks.getCommunityPostsByIds,
}));
vi.mock("@/lib/data/enrollments", () => ({ getMyCourseStudents: mocks.getMyCourseStudents }));
vi.mock("@/lib/data/course-messages", () => ({ countThreadsAwaitingTeacher: mocks.countThreadsAwaitingTeacher }));

const courses = [
  { id: "c-1", title: "Leadership", communityEnabled: true },
  { id: "c-2", title: "Public speaking", communityEnabled: false },
];

const question = {
  id: "p-1",
  courseSlug: "c-1",
  authorId: "s-1",
  authorName: "Ana",
  category: "question",
  title: "How do I start module 2?",
  body: "I finished module 1.",
  createdAt: new Date().toISOString(),
};

const enrollment = (id: string, courseId: string, uid: string, name: string, status: string) => ({
  enrollmentId: id,
  courseId,
  courseTitle: courseId === "c-1" ? "Leadership" : "Public speaking",
  uid,
  displayName: name,
  email: "",
  photoUrl: "",
  status,
  source: "payment",
  progressPercent: 0,
  enrolledAt: `2026-09-0${id.slice(-1)}T00:00:00Z`,
});

beforeEach(() => {
  mocks.getMyCourseSummaries.mockResolvedValue(courses);
  mocks.getOpenCommunityQuestions.mockResolvedValue(["p-1", "p-2"]);
  mocks.getCommunityPostsByIds.mockResolvedValue([question, { ...question, id: "p-2" }]);
  mocks.countThreadsAwaitingTeacher.mockResolvedValue(1);
  mocks.getMyCourseStudents.mockResolvedValue([
    enrollment("e-1", "c-1", "s-1", "Ana", "active"),
    enrollment("e-2", "c-2", "s-1", "Ana", "active"),
    enrollment("e-3", "c-2", "s-2", "Bruno", "completed"),
  ]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Students: all products in one list", () => {
  it("counts people, not enrollments, and links to the product list and to the community", async () => {
    render(<TeacherStudentsList />);

    expect(await screen.findByText("2 active students")).toBeInTheDocument();
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);

    const ana = rows.find((row) => within(row).queryByText("Leadership"))!;
    // The name itself is the link (no wall of identical buttons on every row).
    expect(within(ana).getByRole("link", { name: /^Ana: See in product/ })).toHaveAttribute(
      "href",
      "/teach/courses/c-1/manage?section=students",
    );
    expect(within(ana).getByRole("link", { name: /Community/ })).toHaveAttribute("href", "/teach/courses/c-1/community");

    // Product without a community: no link that would lead to an empty inbox.
    const bruno = rows.find((row) => within(row).queryByText("Bruno"))!;
    expect(within(bruno).queryByRole("link", { name: /Community/ })).toBeNull();
  });

  // Before, someone who asked for a refund kept counting as a learner, with no mark.
  it("refunded, removed and expired appear with their status and do not count as learners", async () => {
    mocks.getMyCourseStudents.mockResolvedValue([
      enrollment("e-1", "c-1", "s-1", "Ana", "active"),
      enrollment("e-2", "c-2", "s-2", "Bruno", "completed"),
      enrollment("e-3", "c-1", "s-3", "Carla", "refunded"),
      enrollment("e-4", "c-1", "s-4", "Dani", "revoked"),
      enrollment("e-5", "c-2", "s-5", "Edu", "expired"),
    ]);
    render(<TeacherStudentsList />);

    expect(await screen.findByText("2 active students")).toBeInTheDocument();
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(5);
    const statusOf = (name: string) => rows.find((row) => within(row).queryByText(name))!;
    expect(within(statusOf("Ana")).getByText("Active")).toBeInTheDocument();
    expect(within(statusOf("Bruno")).getByText("Completed")).toBeInTheDocument();
    expect(within(statusOf("Carla")).getByText("Refunded")).toBeInTheDocument();
    expect(within(statusOf("Dani")).getByText("Revoked")).toBeInTheDocument();
    expect(within(statusOf("Edu")).getByText("Expired")).toBeInTheDocument();
  });

  // Before, there was no way to find a person: you had to scroll the whole table. The search
  // filters what has already loaded (name, e-mail, product), with no new query.
  it("searches by name, e-mail or product in what has already loaded, and says when nothing matches", async () => {
    mocks.getMyCourseStudents.mockResolvedValue([
      enrollment("e-1", "c-1", "s-1", "Ana", "active"),
      { ...enrollment("e-2", "c-2", "s-2", "Bruno", "completed"), email: "bruno@example.com" },
    ]);
    render(<TeacherStudentsList />);

    const search = await screen.findByLabelText("Search students by name, e-mail or product");
    const bodyRows = () => screen.getAllByRole("row").slice(1);
    // The live region already exists, empty, before no one is left: inserted
    // already containing the text, many screen readers did not announce it.
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    fireEvent.change(search, { target: { value: "BRUNO@" } });
    expect(bodyRows()).toHaveLength(1);
    expect(bodyRows()[0]).toHaveTextContent("Bruno");
    fireEvent.change(search, { target: { value: "leader" } });
    expect(bodyRows()).toHaveLength(1);
    expect(bodyRows()[0]).toHaveTextContent("Ana");
    fireEvent.change(search, { target: { value: "nobody" } });
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("No student matches this search or filter.");
    // The count is of everyone, not of the search subset.
    expect(screen.getByText("2 active students")).toBeInTheDocument();
    expect(mocks.getMyCourseStudents).toHaveBeenCalledTimes(1);
  });

  it("with only ended enrollments, the count says zero", async () => {
    mocks.getMyCourseStudents.mockResolvedValue([enrollment("e-1", "c-1", "s-1", "Ana", "refunded")]);
    render(<TeacherStudentsList />);

    expect(await screen.findByText("0 active students")).toBeInTheDocument();
    expect(within(screen.getAllByRole("row")[1]).getByText("Refunded")).toBeInTheDocument();
  });

  // The access filter of the per-product list, also only over what has already loaded.
  it("filters by access without reading again, and the count stays the one for everyone", async () => {
    mocks.getMyCourseStudents.mockResolvedValue([
      enrollment("e-1", "c-1", "s-1", "Ana", "active"),
      enrollment("e-2", "c-2", "s-2", "Bruno", "completed"),
      enrollment("e-3", "c-1", "s-3", "Carla", "refunded"),
    ]);
    render(<TeacherStudentsList />);

    const access = await screen.findByRole("combobox", { name: "Filter by access" });
    const bodyRows = () => screen.getAllByRole("row").slice(1);
    expect(bodyRows()).toHaveLength(3);
    fireEvent.change(access, { target: { value: "refunded" } });
    expect(bodyRows()).toHaveLength(1);
    expect(bodyRows()[0]).toHaveTextContent("Carla");
    fireEvent.change(access, { target: { value: "expired" } });
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("No student matches this search or filter.");
    expect(screen.getByText("2 active students")).toBeInTheDocument();
    expect(mocks.getMyCourseStudents).toHaveBeenCalledTimes(1);
  });

  // Before, the table showed all enrollments at once, with no limit.
  it("shows 50 at a time and 'Show N more' opens the next ones, without reading again", async () => {
    mocks.getMyCourseStudents.mockResolvedValue(
      Array.from({ length: 120 }, (_, index) => ({
        ...enrollment(`e-${index}`, "c-1", `s-${index}`, `Student ${index}`, "active"),
        enrolledAt: new Date(Date.UTC(2026, 0, 1) + index * 60_000).toISOString(),
      })),
    );
    render(<TeacherStudentsList />);

    expect(await screen.findByText("120 active students")).toBeInTheDocument();
    const bodyRows = () => screen.getAllByRole("row").slice(1);
    expect(bodyRows()).toHaveLength(50);
    fireEvent.click(screen.getByRole("button", { name: "Show 50 more" }));
    expect(bodyRows()).toHaveLength(100);
    // Focus moves to the first new row, where reading continues.
    expect(bodyRows()[50]).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Show 20 more" }));
    expect(bodyRows()).toHaveLength(120);
    // The last click removes the button; focus does not fall to the body.
    expect(screen.queryByRole("button", { name: /Show \d+ more/ })).toBeNull();
    expect(bodyRows()[100]).toHaveFocus();
    expect(mocks.getMyCourseStudents).toHaveBeenCalledTimes(1);
  });

  // Going back and forth on the filter (or searching) restarts at the first 50: before, after
  // opening everything, all 120 came back at once.
  it("a new filter or search restarts at the first 50", async () => {
    mocks.getMyCourseStudents.mockResolvedValue(
      Array.from({ length: 120 }, (_, index) => ({
        ...enrollment(`e-${index}`, "c-1", `s-${index}`, `Student ${index}`, "active"),
        enrolledAt: new Date(Date.UTC(2026, 0, 1) + index * 60_000).toISOString(),
      })),
    );
    render(<TeacherStudentsList />);

    await screen.findByText("120 active students");
    const bodyRows = () => screen.getAllByRole("row").slice(1);
    fireEvent.click(screen.getByRole("button", { name: "Show 50 more" }));
    fireEvent.click(screen.getByRole("button", { name: "Show 20 more" }));
    expect(bodyRows()).toHaveLength(120);
    const access = screen.getByRole("combobox", { name: "Filter by access" });
    fireEvent.change(access, { target: { value: "refunded" } });
    fireEvent.change(access, { target: { value: "all" } });
    expect(bodyRows()).toHaveLength(50);
    fireEvent.click(screen.getByRole("button", { name: "Show 50 more" }));
    expect(bodyRows()).toHaveLength(100);
    fireEvent.change(screen.getByLabelText("Search students by name, e-mail or product"), { target: { value: "Student" } });
    expect(bodyRows()).toHaveLength(50);
    expect(screen.getByRole("button", { name: "Show 50 more" })).toBeInTheDocument();
  });

  // T-18: the list had no Export. It takes the whole subset of the search and
  // filter (not just the 50 open), without reading again.
  it("Export takes everything the search and filter find, not just the open rows", async () => {
    mocks.getMyCourseStudents.mockResolvedValue([
      ...Array.from({ length: 60 }, (_, index) => ({
        ...enrollment(`e-${index}`, "c-1", `s-${index}`, `Student ${index}`, "active"),
        email: `student${index}@example.com`,
      })),
      { ...enrollment("e-x", "c-2", "s-x", "Carla", "refunded"), email: "carla@example.com" },
    ]);
    render(<TeacherStudentsList />);
    await screen.findByText("60 active students");
    fireEvent.change(screen.getByRole("combobox", { name: "Filter by access" }), { target: { value: "active" } });
    expect(screen.getAllByRole("row").slice(1)).toHaveLength(50);

    const created: HTMLAnchorElement[] = [];
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const element = realCreate(tag);
      if (tag === "a") created.push(element as HTMLAnchorElement);
      return element;
    });
    const blobs: string[] = [];
    vi.stubGlobal("Blob", class {
      constructor(parts: string[]) {
        blobs.push(parts.join(""));
      }
    });
    vi.stubGlobal("URL", { createObjectURL: () => "blob:x", revokeObjectURL: () => undefined });

    fireEvent.click(screen.getByRole("button", { name: /Export/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Export as CSV" }));

    const lines = blobs[0].split("\n");
    expect(lines[0]).toBe("name,email,product,access,progressPercent,enrolledAt");
    expect(lines).toHaveLength(61);
    expect(blobs[0]).toContain("student59@example.com,Leadership,active,0,");
    expect(blobs[0]).not.toContain("carla@example.com");
    expect(created[0]?.download).toMatch(/^students-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(mocks.getMyCourseStudents).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("with no learners, an empty state that explains", async () => {
    mocks.getMyCourseStudents.mockResolvedValue([]);
    render(<TeacherStudentsList />);

    expect(await screen.findByRole("heading", { name: /No students yet/ })).toBeInTheDocument();
  });

  // A failure is not "no learners": the error with "Try again", which asks for the same
  // read again.
  it("a read that fails shows the error and Try again reads again", async () => {
    mocks.getMyCourseStudents.mockRejectedValueOnce(new Error("down"));
    render(<TeacherStudentsList />);

    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't load your students.");
    expect(screen.queryByRole("heading", { name: /No students yet/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("2 active students")).toBeInTheDocument();
    expect(mocks.getMyCourseStudents).toHaveBeenCalledTimes(2);
  });
});

describe("Inbox: questions waiting for the teacher", () => {
  it("shows how many there are and links each one to the course's community inbox", async () => {
    render(<TeacherInboxQuestions />);

    const heading = await screen.findByRole("heading", { name: /Questions waiting for you/ });
    await waitFor(() => expect(heading).toHaveTextContent("2"));
    const answers = screen.getAllByRole("link", { name: /Answer/ });
    expect(answers[0]).toHaveAttribute("href", "/teach/courses/c-1/community");
    expect(screen.getAllByText(/Leadership · Ana/)).toHaveLength(2);
    // A course with the community turned off is left out of the search.
    expect(mocks.getOpenCommunityQuestions).toHaveBeenCalledWith(["c-1"], "teacher-1");
    // The text is only read for the questions that are waiting.
    expect(mocks.getCommunityPostsByIds).toHaveBeenCalledWith(["p-1", "p-2"]);
  });

  it("nothing waiting: says so", async () => {
    mocks.getOpenCommunityQuestions.mockResolvedValue([]);
    mocks.getCommunityPostsByIds.mockResolvedValue([]);
    render(<TeacherInboxQuestions />);

    expect(await screen.findByText(/No questions waiting/)).toBeInTheDocument();
  });

  // While reading, the card shows the shape of the rows (before, only the title stayed);
  // a failure is not "nothing waiting": error with "Try again".
  it("loading shows the wait; a failure shows the error and Try again reads again", async () => {
    mocks.getOpenCommunityQuestions.mockRejectedValueOnce(new Error("down"));
    render(<TeacherInboxQuestions />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading questions...");
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't load the questions.");
    expect(screen.queryByText(/No questions waiting/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findAllByRole("link", { name: /Answer/ })).toHaveLength(2);
  });

  // On the Inbox page the shell (bar number) and the list ask together: one
  // read of just courses, questions and conversations.
  it("on the Inbox page, the bar number and the list share the same read", async () => {
    function InboxPage() {
      const count = useTeacherInboxCount("teacher-1");
      return (
        <>
          <p data-testid="nav-count">{count ?? ""}</p>
          <TeacherInboxQuestions />
        </>
      );
    }
    render(<InboxPage />);

    await waitFor(() => expect(screen.getByTestId("nav-count")).toHaveTextContent("3"));
    await screen.findAllByRole("link", { name: /Answer/ });
    expect(mocks.getMyCourseSummaries).toHaveBeenCalledOnce();
    expect(mocks.getOpenCommunityQuestions).toHaveBeenCalledOnce();
    expect(mocks.countThreadsAwaitingTeacher).toHaveBeenCalledOnce();
  });
});

describe("the pending number in the bar", () => {
  it("adds unanswered questions (only from communities that are on) and conversations where the learner spoke last", async () => {
    const { result } = renderHook(() => useTeacherInboxCount("teacher-1"));

    await waitFor(() => expect(result.current).toBe(3));
    expect(mocks.getOpenCommunityQuestions).toHaveBeenCalledWith(["c-1"], "teacher-1");
  });

  it("off outside the teacher side", () => {
    const { result } = renderHook(() => useTeacherInboxCount(null));

    expect(result.current).toBeUndefined();
    expect(mocks.getMyCourseSummaries).not.toHaveBeenCalled();
  });

  it("a read that fails only leaves the bar without a number", async () => {
    mocks.countThreadsAwaitingTeacher.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useTeacherInboxCount("teacher-1"));

    await waitFor(() => expect(mocks.countThreadsAwaitingTeacher).toHaveBeenCalled());
    await waitFor(() => expect(mocks.getOpenCommunityQuestions).toHaveBeenCalled());
    expect(result.current).toBeUndefined();
  });

  it("the conversation waits for the teacher when the last message is from the learner, in any order", () => {
    const message = (studentId: string, senderId: string, minute: number) => ({
      courseId: "c-1",
      studentId,
      senderId,
      createdAt: `2026-10-01T10:${String(minute).padStart(2, "0")}:00Z`,
    });

    expect(
      countThreadsAwaitingReply(
        [
          message("s-2", "s-2", 3),
          message("s-1", "teacher-1", 2),
          message("s-1", "s-1", 1),
          message("s-2", "teacher-1", 1),
        ],
        "teacher-1",
      ),
    ).toBe(1);
  });
});
