import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { TeacherEventStudio } from "@/components/teacher/teacher-event-studio";
import type { CourseEvent } from "@/domain/course-event";

// What the person suffered at /teach/events: the screen opened in two columns with the
// registration form on the LEFT and always open - seven fields before
// reaching the schedule. No number, no filter, no search, no
// count, and the empty state was a paragraph with no way out.

const HOUR = 60 * 60 * 1000;

function makeEvent(overrides: Partial<CourseEvent>): CourseEvent {
  return {
    id: "event-1",
    courseId: "course-1",
    courseSlug: "course-1",
    courseTitle: "Clinical supervision",
    ownerId: "teacher-1",
    title: "Live Q&A",
    description: "Bring your hardest case.",
    type: "live_class",
    status: "scheduled",
    startsAt: new Date(Date.now() + 24 * HOUR).toISOString(),
    externalUrl: "https://meet.example.com/live",
    recordingAssetId: null,
    ...overrides,
  };
}

const mocks = vi.hoisted(() => ({
  // The SAME object on every render: a new user per render resubscribes the
  // effects and enters a loop.
  user: { uid: "teacher-1", roles: ["teacher"] },
  router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
  searchParams: new URLSearchParams(""),
  events: [] as unknown[],
  rsvpFails: false,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  useSearchParams: () => mocks.searchParams,
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ user: mocks.user }),
}));

vi.mock("@/lib/data/teacher-courses", () => ({
  subscribeToTeacherCourses: (
    _ownerId: string,
    onData: (courses: Array<Record<string, unknown>>) => void,
  ) => {
    onData([
      {
        id: "course-1",
        ownerId: "teacher-1",
        title: "Clinical supervision",
        summary: "A live cohort",
        category: "Supervision & Continuing Education",
        status: "draft",
        modules: [],
        lessonCount: 0,
      },
    ]);
    return () => undefined;
  },
}));

vi.mock("@/lib/data/course-events", () => ({
  cancelCourseEvent: vi.fn(),
  createCourseEvent: vi.fn(),
  deleteCourseEvent: vi.fn(),
  subscribeToCourseEventRsvps: (_id: string, onData: (rsvps: unknown[]) => void, onError?: (error: Error) => void) => {
    if (mocks.rsvpFails) onError?.(new Error("rsvp read failed"));
    else onData([]);
    return () => undefined;
  },
  subscribeToTeacherCourseEvents: (
    _ownerId: string,
    onData: (events: unknown[]) => void,
  ) => {
    onData(mocks.events);
    return () => undefined;
  },
  updateCourseEvent: vi.fn(),
}));

function renderStudio() {
  return render(
    <I18nProvider initialLocale="en">
      <TeacherEventStudio />
    </I18nProvider>,
  );
}

// The tile box: the support text is unique on the screen, so the big number is its
// sibling inside the same card.
function tile(hint: string) {
  const card = screen.getByText(hint).closest("div");
  if (!card) {
    throw new Error(`tile not found for "${hint}"`);
  }
  return within(card);
}

describe("events schedule in the house standard", () => {
  beforeEach(() => {
    mocks.searchParams = new URLSearchParams("");
    mocks.events = [];
    mocks.rsvpFails = false;
  });

  // One RSVP summary per card: with the read failing, eight events were
  // eight assertive alerts interrupting the screen reader. Now it is a notice.
  it("an RSVP summary failure warns without interrupting (status, never alert)", () => {
    mocks.rsvpFails = true;
    mocks.events = [makeEvent({ id: "a" }), makeEvent({ id: "b", title: "Case clinic" })];
    renderStudio();

    const notes = screen.getAllByText("RSVP summary unavailable.");
    expect(notes).toHaveLength(2);
    for (const note of notes) {
      expect(note.closest('[role="status"]')).not.toBeNull();
    }
    expect(screen.queryByRole("alert")).toBeNull();
  });

  afterEach(() => {
    cleanup();
  });

  it("opens with the list and ZERO forms; the form only appears after the request", () => {
    mocks.events = [makeEvent({ id: "event-1", title: "Live Q&A" })];
    renderStudio();

    expect(screen.getByText("Live Q&A")).toBeInTheDocument();
    expect(screen.queryByLabelText("Session title")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("External class link")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "New session" }));

    expect(screen.getByLabelText("Date")).toBeInTheDocument();
    expect(screen.getByLabelText("Time")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Course" })).toBeInTheDocument();
  });

  it("compact summary and form with no stacked frames preserve the controls", () => {
    const { container } = renderStudio();
    const summary = container.querySelector("dl");
    // The house number box (MetricCard), three side by side from
    // 480px; on the phone the uppercase label did not fit in a third of the screen.
    expect(summary).toHaveClass("min-[480px]:grid-cols-3");
    expect(summary?.querySelectorAll("dt")).toHaveLength(3);
    expect(summary?.querySelectorAll("dt + dd.num")).toHaveLength(3);
    expect(container.querySelector(".studio-kpi-card")).toBeNull();
    expect(container.querySelector(".settings-section-card")).toBeNull();
    const trigger = screen.getByRole("button", { name: "New session" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    const panel = document.getElementById(trigger.getAttribute("aria-controls")!);
    expect(panel).toContainElement(screen.getByLabelText("Date"));
    expect(panel).toHaveClass("border-b");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByLabelText("Session title")).not.toBeInTheDocument();
  });

  it("three tiles count what is upcoming, what is past and what was canceled", () => {
    mocks.events = [
      makeEvent({ id: "a", startsAt: new Date(Date.now() + 24 * HOUR).toISOString() }),
      makeEvent({ id: "b", startsAt: new Date(Date.now() + 48 * HOUR).toISOString() }),
      makeEvent({ id: "c", startsAt: new Date(Date.now() - 24 * HOUR).toISOString() }),
      makeEvent({ id: "d", status: "cancelled" }),
    ];
    renderStudio();

    expect(tile("Still ahead on the agenda").getByText("2")).toBeInTheDocument();
    expect(tile("Already happened").getByText("1")).toBeInTheDocument();
    // The old sentence promised that whoever confirmed would "see" the cancellation; today the
    // learner sees the session marked as canceled up to a week after the date.
    expect(tile("Called off — learners see it marked as cancelled until a week after its date").getByText("1")).toBeInTheDocument();
  });

  // The read comes from oldest to newest; in the past, what matters
  // is the most recent session. In "All", the upcoming ones (the next at the top) and then
  // the past ones (the most recent first).
  it("Past shows the most recent first; All puts the next one at the top and then the past", () => {
    mocks.events = [
      makeEvent({ id: "old", title: "Two days ago", startsAt: new Date(Date.now() - 48 * HOUR).toISOString() }),
      makeEvent({ id: "recent", title: "Yesterday", startsAt: new Date(Date.now() - 24 * HOUR).toISOString() }),
      makeEvent({ id: "soon", title: "Tomorrow", startsAt: new Date(Date.now() + 24 * HOUR).toISOString() }),
      makeEvent({ id: "later", title: "In two days", startsAt: new Date(Date.now() + 48 * HOUR).toISOString() }),
    ];
    renderStudio();
    const titles = () => screen.getAllByRole("heading", { level: 4 }).map((heading) => heading.textContent);

    expect(titles()).toEqual(["Tomorrow", "In two days"]);
    fireEvent.change(screen.getByLabelText("Filter sessions"), { target: { value: "past" } });
    expect(titles()).toEqual(["Yesterday", "Two days ago"]);
    fireEvent.change(screen.getByLabelText("Filter sessions"), { target: { value: "all" } });
    expect(titles()).toEqual(["Tomorrow", "In two days", "Yesterday", "Two days ago"]);
  });

  it("the frame (filter, search, export) and the count say which slice the list is about", () => {
    mocks.events = [
      makeEvent({ id: "a", title: "Live Q&A" }),
      makeEvent({ id: "b", title: "Case clinic" }),
      makeEvent({ id: "c", title: "Old class", startsAt: new Date(Date.now() - 24 * HOUR).toISOString() }),
    ];
    renderStudio();

    expect(screen.getByLabelText("Filter sessions")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export" })).toBeInTheDocument();
    expect(screen.getByText("2 sessions · Upcoming")).toBeInTheDocument();

    // Same frame as Sales: the search needs a minimum width so it does not
    // shrink to 35 px on the phone.
    expect(screen.getByLabelText("Search sessions by title or course")).toHaveClass(
      "min-w-[12rem]",
    );
    fireEvent.change(screen.getByLabelText("Search sessions by title or course"), {
      target: { value: "case" },
    });

    expect(screen.getByText("1 session · Upcoming")).toBeInTheDocument();
    expect(screen.queryByText("Live Q&A")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Filter sessions"), {
      target: { value: "past" },
    });

    expect(screen.getByText("0 sessions · Past")).toBeInTheDocument();
  });

  it("with no sessions, the empty state has two lines and a button that opens the form", () => {
    renderStudio();

    expect(screen.getByText("No sessions in this view.")).toBeInTheDocument();
    expect(
      screen.getByText(/Nothing matches this filter and search/),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Session title")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Schedule a session" }));

    expect(screen.getByLabelText("Date")).toBeInTheDocument();
  });
});
