import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CourseStudentRosterView } from "@/components/teacher/course-student-roster";
import type { CourseStudent } from "@/lib/data/enrollments";

const mocks = vi.hoisted(() => ({
  sendCourseMessage: vi.fn(() => Promise.resolve({ success: true as const, messageId: "m1" })),
  downloads: [] as { filename: string; content: string }[],
}));

vi.mock("@/lib/data/course-messages", () => ({
  sendCourseMessage: mocks.sendCourseMessage,
}));

const NOW = new Date("2026-09-03T12:00:00.000Z");

function daysAgo(days: number) {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

const student = {
  enrollmentId: "learner-1__course-1",
  courseId: "course-1",
  courseTitle: "Clinical Focus",
  uid: "learner-1",
  displayName: "Maria Silva",
  email: "maria@example.com",
  photoUrl: "",
  status: "active",
  source: "payment",
  progressPercent: 42,
  enrolledAt: "2026-07-15T10:00:00.000Z",
} as CourseStudent;

const refunded = {
  ...student,
  enrollmentId: "learner-2__course-1",
  uid: "learner-2",
  displayName: "Joao Costa",
  email: "joao@example.com",
  status: "refunded",
  source: "admin",
  progressPercent: 0,
} as CourseStudent;

const finished = {
  ...student,
  enrollmentId: "learner-3__course-1",
  uid: "learner-3",
  displayName: "Ana Souza",
  email: "ana@example.com",
  status: "active",
  progressPercent: 100,
  enrolledAt: daysAgo(2),
} as CourseStudent;

function renderRoster(students: CourseStudent[]) {
  return render(
    <CourseStudentRosterView
      state="ready"
      students={students}
      courseId="course-1"
      now={NOW}
    />,
  );
}

beforeEach(() => {
  mocks.sendCourseMessage.mockClear();
});

afterEach(cleanup);

describe("CourseStudentRosterView", () => {
  it("lists the student with the identity a plain enrollments read cannot return", () => {
    renderRoster([student]);

    const table = within(screen.getByRole("table"));
    expect(table.getByText("Maria Silva")).toBeInTheDocument();
    expect(table.getByText("maria@example.com")).toBeInTheDocument();
    expect(table.getByText("42%")).toBeInTheDocument();
    expect(table.getByText("One-time purchase")).toBeInTheDocument();
  });

  it("keeps refunded students visible — support needs them, entitlement does not", () => {
    renderRoster([student, refunded]);

    expect(screen.getByText("Joao Costa")).toBeInTheDocument();
    expect(screen.getByText("Granted by support")).toBeInTheDocument();
    // 2 enrolled, but only the active one still has access.
    expect(screen.getByText(/2 enrolled/)).toBeInTheDocument();
    expect(screen.getByText(/1 with active access/)).toBeInTheDocument();
  });

  it("says nobody is enrolled instead of inventing a placeholder row", () => {
    renderRoster([]);

    expect(screen.getByRole("heading", { name: "When someone joins, you'll see them here." })).toBeInTheDocument();
    // The "no learners yet" scene, hidden from the screen reader.
    expect(document.querySelector('svg[data-scene="noStudents"]')).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    // Without a published product there is no page to send to anyone.
    expect(screen.queryByRole("button", { name: "Copy my page link" })).toBeNull();
  });

  it("offers the page link when the product is published", () => {
    render(<CourseStudentRosterView state="ready" students={[]} courseId="course-1" share={{ title: "Group Work" }} />);

    expect(screen.getByRole("button", { name: "Copy my page link" })).toBeInTheDocument();
  });

  it("reports a failed read rather than rendering an empty roster", () => {
    render(<CourseStudentRosterView state="error" students={[]} courseId="course-1" />);

    expect(screen.getByText(/could not load the roster/)).toBeInTheDocument();
    expect(screen.queryByText("When someone joins, you'll see them here.")).not.toBeInTheDocument();
  });

  // F-11: the failure is announced and has a way out; while it reads again, the button locks.
  it("announces the failed read and offers Try again, locked while it runs", () => {
    const onRetry = vi.fn();
    const { rerender } = render(<CourseStudentRosterView state="error" students={[]} courseId="course-1" onRetry={onRetry} />);

    expect(screen.getByRole("alert")).toHaveTextContent(/could not load the roster/);
    // The sentence no longer tells you to reload the page: the button is beside it.
    expect(screen.getByRole("alert")).not.toHaveTextContent(/reload/i);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    rerender(<CourseStudentRosterView state="error" students={[]} courseId="course-1" onRetry={onRetry} retrying />);
    expect(screen.getByRole("button", { name: "Try again" })).toBeDisabled();
    // The same name on both faces; the ring goes in the spot already kept.
    expect(screen.getByRole("button", { name: "Try again" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Try again" }).querySelectorAll('[class*="grid-area"]')).toHaveLength(2);
  });

  it("sums the class up before the table so the numbers are not counted by hand", () => {
    renderRoster([student, refunded, finished]);

    const summary = within(screen.getByTestId("roster-summary"));
    const enrolled = summary.getByText("Enrolled").closest("div");
    const newThisWeek = summary.getByText("New this week").closest("div");
    const completed = summary.getByText("Completed").closest("div");
    const average = summary.getByText("Average progress").closest("div");

    expect(enrolled).toHaveTextContent("3");
    // Only Ana joined in the last 7 days.
    expect(newThisWeek).toHaveTextContent("1");
    expect(completed).toHaveTextContent("1");
    expect(average).toHaveTextContent("47%");
  });

  it("finds one person by name or e-mail in a roster too long to scan", () => {
    renderRoster([student, refunded, finished]);

    fireEvent.change(screen.getByLabelText(/Search students/), {
      target: { value: "joao@" },
    });

    expect(screen.getByText("Joao Costa")).toBeInTheDocument();
    expect(screen.queryByText("Maria Silva")).toBeNull();
    expect(screen.queryByText("Ana Souza")).toBeNull();
  });

  it("separates who finished from who never started, and who lost access", () => {
    renderRoster([student, refunded, finished]);

    fireEvent.change(screen.getByLabelText(/Filter by progress/), {
      target: { value: "completed" },
    });
    expect(screen.getByText("Ana Souza")).toBeInTheDocument();
    expect(screen.queryByText("Maria Silva")).toBeNull();

    fireEvent.change(screen.getByLabelText(/Filter by progress/), {
      target: { value: "not_started" },
    });
    expect(screen.getByText("Joao Costa")).toBeInTheDocument();
    expect(screen.queryByText("Ana Souza")).toBeNull();

    fireEvent.change(screen.getByLabelText(/Filter by progress/), {
      target: { value: "all" },
    });
    fireEvent.change(screen.getByLabelText(/Filter by access/), {
      target: { value: "refunded" },
    });
    expect(screen.getByText("Joao Costa")).toBeInTheDocument();
    expect(screen.queryByText("Maria Silva")).toBeNull();
  });

  it("says so when the filters match nobody, instead of showing a blank table", () => {
    renderRoster([student]);

    fireEvent.change(screen.getByLabelText(/Filter by access/), {
      target: { value: "revoked" },
    });

    expect(screen.getByText(/No student matches this search and filter/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows who is ready for a certificate — the only part the teacher can read", () => {
    renderRoster([student, finished]);

    const table = within(screen.getByRole("table"));
    expect(table.getByText("Ready to issue")).toBeInTheDocument();
    expect(table.getByText("In progress")).toBeInTheDocument();
  });

  it("messages one student through the same gated door the student writes back on", async () => {
    renderRoster([student]);

    fireEvent.click(screen.getByRole("button", { name: /Message Maria Silva/ }));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Welcome aboard!" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() =>
      expect(mocks.sendCourseMessage).toHaveBeenCalledWith({
        courseId: "course-1",
        studentId: "learner-1",
        body: "Welcome aboard!",
      }),
    );
    expect(await screen.findByText(/Message sent to Maria Silva/)).toBeInTheDocument();
    // The "Send" is gone: focus goes to "Close", and Esc still closes.
    const close = screen.getByRole("button", { name: "Close" });
    await waitFor(() => expect(close).toHaveFocus());
    fireEvent.keyDown(close, { key: "Escape" });
    expect(screen.queryByText(/Message sent to Maria Silva/)).toBeNull();
    expect(screen.getByRole("button", { name: /Message Maria Silva/ })).toHaveFocus();
  });

  // Before, the box opened INSIDE the name cell: the row grew ~170px and,
  // on a phone, the box was half hidden behind the side scroll.
  it("opens the composer in its own row below the student, focused, and Esc closes it", () => {
    renderRoster([student, finished]);

    const toggle = screen.getByRole("button", { name: /Message Maria Silva/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);

    const box = screen.getByRole("textbox");
    expect(box).toHaveFocus();
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const cell = box.closest("td")!;
    expect(cell).toHaveAttribute("colspan", "7");
    // The box row comes right after Maria's row, not inside it.
    const studentRow = within(screen.getByRole("table")).getByText("Maria Silva").closest("tr")!;
    expect(studentRow.nextElementSibling).toBe(cell.closest("tr"));
    expect(toggle).toHaveAttribute("aria-controls", cell.closest("tr")!.id);

    fireEvent.keyDown(box, { key: "Escape" });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(toggle).toHaveFocus();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("refuses to send an empty message", () => {
    renderRoster([student]);

    fireEvent.click(screen.getByRole("button", { name: /Message Maria Silva/ }));

    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  });

  it("exports exactly the rows on screen, not the whole roster", () => {
    renderRoster([student, refunded, finished]);

    fireEvent.change(screen.getByLabelText(/Filter by access/), {
      target: { value: "refunded" },
    });

    const created: HTMLAnchorElement[] = [];
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const element = realCreate(tag);
      if (tag === "a") created.push(element as HTMLAnchorElement);
      return element;
    });
    const blobs: string[] = [];
    vi.stubGlobal(
      "Blob",
      class {
        constructor(parts: string[]) {
          blobs.push(parts.join(""));
        }
      },
    );
    vi.stubGlobal("URL", { createObjectURL: () => "blob:x", revokeObjectURL: () => undefined });

    fireEvent.click(screen.getByRole("button", { name: /Export/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Export as CSV" }));

    expect(blobs[0]).toContain("joao@example.com");
    expect(blobs[0]).not.toContain("maria@example.com");
    expect(created[0]?.download).toMatch(/^students-course-1-/);

    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
});
