import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { LearnEventsHub } from "@/components/learn/learn-events-hub";
import { formatEventDateTime, type CourseEvent } from "@/domain/course-event";
import type { Enrollment } from "@/domain/enrollment";

// The SAME user on every render: the enrollments subscription depends on
// `user`, and a new object on each render would resubscribe in a loop.
const mocks = vi.hoisted(() => {
  const startsAt = "2026-03-14T15:30:00.000Z";
  const base = {
    courseId: "course-1",
    courseSlug: "demo-course",
    courseTitle: "Demo course",
    ownerId: "teacher-1",
    description: "",
    type: "live_class" as const,
    status: "scheduled" as const,
    externalUrl: "https://meet.example.com/live",
    recordingAssetId: null,
  };
  const enrollment: Enrollment = {
    id: "enrollment-1",
    userId: "student-1",
    courseId: "course-1",
    courseSlug: "demo-course",
    courseTitle: "Demo course",
    courseCategory: "Applied Psychology & Behavior",
    courseImage: "",
    status: "active",
    source: "payment",
    progressPercent: 0,
    lastLessonId: null,
  };
  const events: CourseEvent[] = [
    { ...base, id: "event-1", title: "Live Q&A", startsAt },
    { ...base, id: "event-2", title: "Sin fecha", startsAt: "not a date" },
  ];
  return {
    user: { uid: "student-1", roles: ["student"] }, startsAt, enrollment, events, base,
    rsvp: null as { status: "attending" | "not_attending" } | null,
    // The events that opened a presence channel.
    rsvpEvents: [] as string[],
    // The option the schedule reads the sessions with.
    options: undefined as unknown,
    enrollments: null as Enrollment[] | null,
  };
});

// The I18nProvider calls useRouter() for the refresh when the language changes.
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/navigation")>(),
  useRouter: () => router,
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ user: mocks.user }),
}));

vi.mock("@/lib/data/enrollments", () => ({
  subscribeToUserEnrollments: (_uid: string, onData: (rows: Enrollment[]) => void) => {
    onData(mocks.enrollments ?? [mocks.enrollment]);
    return () => undefined;
  },
}));

vi.mock("@/lib/data/course-events", () => ({
  subscribeToCourseEvents: (
    _slug: string,
    onData: (events: CourseEvent[]) => void,
    _onError: unknown,
    options?: unknown,
  ) => {
    mocks.options = options;
    // In start order, as the source returns them.
    onData([...mocks.events].sort((a, b) => a.startsAt.localeCompare(b.startsAt)));
    return () => undefined;
  },
  subscribeToCourseEventRsvp: (eventId: string, _uid: string, onData: (rsvp: unknown) => void) => {
    mocks.rsvpEvents.push(eventId);
    onData(mocks.rsvp);
    return () => undefined;
  },
  saveCourseEventRsvp: vi.fn(),
}));

// The whole hub still speaks English; only the date now follows the person's
// language, and an invalid date shows the translated text instead of "Date pending".
describe("LearnEventsHub", () => {
  it("each session's date comes out in the person's language; an invalid date becomes 'Fecha pendiente'", async () => {
    render(<I18nProvider initialLocale="es"><LearnEventsHub /></I18nProvider>);

    expect(await screen.findByText(
      formatEventDateTime(mocks.startsAt, "es"),
    )).toBeInTheDocument();
    expect(screen.getByText("Fecha pendiente")).toBeInTheDocument();
  });

  it("upcoming first; the ones that already passed go in a closed 'Past' part, with no attendance request", () => {
    const saved = mocks.events;
    const hour = 3_600_000;
    mocks.events = [
      { ...mocks.base, id: "old", title: "Old session", startsAt: "2026-03-14T15:30:00.000Z" },
      { ...mocks.base, id: "next", title: "Next session", startsAt: new Date(Date.now() + 48 * hour).toISOString() },
      // Started 1h ago: it may still be going, it stays in Upcoming with the join link.
      { ...mocks.base, id: "running", title: "Running session", startsAt: new Date(Date.now() - hour).toISOString() },
    ];
    try {
      render(<LearnEventsHub />);

      const upcoming = screen.getByRole("region", { name: "Upcoming" });
      const titles = within(upcoming).getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
      expect(titles).toEqual(["Running session", "Next session"]);

      const old = screen.getByRole("heading", { name: "Old session" });
      const past = old.closest("details") as HTMLElement;
      expect(past).not.toHaveAttribute("open");
      // Its own heading: the past cards do not sit under "Upcoming".
      expect(within(past).getByRole("heading", { level: 2, name: /Past/ })).toBeInTheDocument();
      expect(within(past).queryByRole("button", { name: "I will attend" })).not.toBeInTheDocument();
      expect(within(past).queryByRole("link", { name: "Join external session" })).not.toBeInTheDocument();
      // Not one presence channel per past card either.
      expect(mocks.rsvpEvents).not.toContain("old");
      // The one that passed says "Held" (before "Scheduled"); the one in progress, "Happening now".
      expect(within(past).getByText("Held")).toBeInTheDocument();
      expect(within(past).queryByText("Scheduled")).not.toBeInTheDocument();
      const running = screen.getByRole("heading", { name: "Running session" }).closest("article") as HTMLElement;
      expect(within(running).getByText("Happening now")).toBeInTheDocument();
    } finally {
      mocks.events = saved;
    }
  });

  it("the chosen answer is marked on the button itself (aria-pressed)", () => {
    const saved = mocks.events;
    mocks.events = [
      { ...mocks.base, id: "next", title: "Next session", startsAt: new Date(Date.now() + 48 * 3_600_000).toISOString() },
    ];
    mocks.rsvp = { status: "not_attending" };
    try {
      render(<LearnEventsHub />);

      const group = screen.getByRole("group", { name: "Attendance" });
      expect(within(group).getByRole("button", { name: "I will attend" })).toHaveAttribute("aria-pressed", "false");
      expect(within(group).getByRole("button", { name: "I cannot attend" })).toHaveAttribute("aria-pressed", "true");
      // The "Not going" text in a separate box is gone.
      expect(screen.queryByText("Not going")).not.toBeInTheDocument();
    } finally {
      mocks.events = saved;
      mocks.rsvp = null;
    }
  });

  it("the saved answer is marked right away, without waiting for realtime", async () => {
    const saved = mocks.events;
    mocks.events = [
      { ...mocks.base, id: "next", title: "Next session", startsAt: new Date(Date.now() + 48 * 3_600_000).toISOString() },
    ];
    try {
      render(<LearnEventsHub />);
      const attend = screen.getByRole("button", { name: "I will attend" });
      expect(attend).toHaveAttribute("aria-pressed", "false");

      await act(async () => {
        fireEvent.click(attend);
      });
      expect(screen.getByRole("button", { name: "I will attend" })).toHaveAttribute("aria-pressed", "true");
    } finally {
      mocks.events = saved;
    }
  });

  it("a canceled session shows as marked, with the time struck through, no link and no attendance; after 7 days it disappears", () => {
    const saved = mocks.events;
    const hour = 3_600_000;
    const startsAt = new Date(Date.now() + 24 * hour).toISOString();
    mocks.events = [
      { ...mocks.base, id: "cancelled", title: "Cancelled session", status: "cancelled", startsAt },
      { ...mocks.base, id: "gone", title: "Old cancelled", status: "cancelled", startsAt: new Date(Date.now() - 8 * 24 * hour).toISOString() },
    ];
    mocks.rsvpEvents = [];
    try {
      render(<LearnEventsHub />);

      expect(mocks.options).toEqual({ includeCancelled: true });
      const card = screen.getByRole("heading", { name: "Cancelled session" }).closest("article") as HTMLElement;
      expect(within(card).getByText("Cancelled")).toBeInTheDocument();
      expect(card.querySelector("s")).toHaveTextContent(formatEventDateTime(startsAt, "en"));
      expect(within(card).queryByRole("link")).not.toBeInTheDocument();
      expect(within(card).queryByRole("button")).not.toBeInTheDocument();
      expect(mocks.rsvpEvents).not.toContain("cancelled");
      expect(screen.queryByText("Old cancelled")).not.toBeInTheDocument();
    } finally {
      mocks.events = saved;
    }
  });

  it("'Updated' with the date when the session changed after it was created; a deadline with no link says it is not a meeting", () => {
    const saved = mocks.events;
    const startsAt = new Date(Date.now() + 48 * 3_600_000).toISOString();
    mocks.events = [
      {
        ...mocks.base, id: "moved", title: "Moved session", startsAt,
        createdAt: "2026-11-01T10:00:00.000Z", updatedAt: "2026-11-02T10:00:00.000Z",
      },
      { ...mocks.base, id: "due", title: "Essay due", type: "deadline", externalUrl: "", startsAt },
    ];
    try {
      render(<LearnEventsHub />);

      const moved = screen.getByRole("heading", { name: "Moved session" }).closest("article") as HTMLElement;
      expect(within(moved).getByText(`Updated ${formatEventDateTime("2026-11-02T10:00:00.000Z", "en")}`)).toBeInTheDocument();
      const due = screen.getByRole("heading", { name: "Essay due" }).closest("article") as HTMLElement;
      expect(within(due).getByText("This is a due date, not a meeting: there is nothing to join.")).toBeInTheDocument();
      expect(within(due).queryByText(/Updated/)).not.toBeInTheDocument();
      expect(within(due).queryByRole("link", { name: "Join external session" })).not.toBeInTheDocument();
    } finally {
      mocks.events = saved;
    }
  });

  it("after 'I will attend': the time in the reader's time zone and the calendar (Google and .ics)", async () => {
    const saved = mocks.events;
    const startsAt = new Date(Date.now() + 48 * 3_600_000).toISOString();
    mocks.events = [{ ...mocks.base, id: "next", title: "Next session", startsAt }];
    const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => "blob:ics");
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    try {
      render(<LearnEventsHub />);
      // Before answering, no calendar.
      expect(screen.queryByRole("link", { name: "Add to Google Calendar" })).not.toBeInTheDocument();

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "I will attend" }));
      });
      expect(screen.getByText(`You're going: ${formatEventDateTime(startsAt, "en")}`)).toBeInTheDocument();
      const google = screen.getByRole("link", { name: "Add to Google Calendar" });
      expect(google.getAttribute("href")).toMatch(/^https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE&/);
      expect(google).toHaveAttribute("target", "_blank");
      expect(screen.getByText("The calendar entry lasts 60 minutes: the session has no set end time.")).toBeInTheDocument();

      // The file address is only revoked 1 s later (on iPad the download
      // starts after the click). Fake clock: no timer is left pending.
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      fireEvent.click(screen.getByRole("button", { name: "Download calendar file (.ics)" }));
      expect(click).toHaveBeenCalledOnce();
      expect(revokeObjectURL).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1000);
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:ics");
      vi.useRealTimers();
      const blob = createObjectURL.mock.calls[0][0];
      expect(blob.type).toBe("text/calendar;charset=utf-8");
      const text = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.readAsText(blob);
      });
      expect(text).toContain("UID:course-event-next@skillsetmind.com");
      expect(text).toContain("URL:https://meet.example.com/live");
    } finally {
      vi.useRealTimers();
      mocks.events = saved;
      URL.createObjectURL = original.create;
      URL.revokeObjectURL = original.revoke;
      click.mockRestore();
    }
  });

  // A deadline is not a meeting: "Due:" and "Open link"; once overdue it goes to "Past" right
  // away (not 3 h later) and says "Due date passed", never "Happening now".
  it("a deadline: due date and 'Open link'; overdue, in Past as 'Due date passed'", () => {
    const saved = mocks.events;
    const startsAt = new Date(Date.now() + 48 * 3_600_000).toISOString();
    mocks.events = [
      { ...mocks.base, id: "due", title: "Essay due", type: "deadline", startsAt },
      { ...mocks.base, id: "late", title: "Quiz due", type: "deadline", startsAt: new Date(Date.now() - 30 * 60_000).toISOString() },
    ];
    try {
      render(<LearnEventsHub />);

      const due = screen.getByRole("heading", { name: "Essay due" }).closest("article") as HTMLElement;
      expect(within(due).getByText(`Due: ${formatEventDateTime(startsAt, "en")}`)).toBeInTheDocument();
      expect(within(due).getByRole("link", { name: "Open link" })).toHaveAttribute("href", "https://meet.example.com/live");
      expect(within(due).queryByRole("link", { name: "Join external session" })).not.toBeInTheDocument();

      const late = screen.getByRole("heading", { name: "Quiz due" }).closest("article") as HTMLElement;
      expect(late.closest("details")).not.toBeNull();
      expect(within(late).getByText("Due date passed")).toBeInTheDocument();
      expect(screen.queryByText("Happening now")).not.toBeInTheDocument();
    } finally {
      mocks.events = saved;
    }
  });

  it("an enrollment that ended: says the access ended, not 'no sessions scheduled'", () => {
    const saved = mocks.events;
    mocks.events = [];
    mocks.enrollments = [{ ...mocks.enrollment, status: "refunded" }];
    try {
      render(<LearnEventsHub />);

      expect(screen.getByRole("heading", { level: 2, name: "Your course access ended." })).toBeInTheDocument();
      expect(screen.getByText("Sessions from Demo course no longer appear here because your access ended.")).toBeInTheDocument();
      expect(screen.queryByText("No live sessions are scheduled yet.")).not.toBeInTheDocument();
    } finally {
      mocks.events = saved;
      mocks.enrollments = null;
    }
  });
});
