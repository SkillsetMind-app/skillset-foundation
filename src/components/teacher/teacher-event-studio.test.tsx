import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { TeacherEventStudio } from "@/components/teacher/teacher-event-studio";
import { CONFIRM_GUARD_MS } from "@/components/ui/confirm-dialog";
import { formatEventDateTime, formatEventTimeInZones, US_PREVIEW_TIME_ZONES, type CourseEvent } from "@/domain/course-event";
import {
  cancelCourseEvent,
  createCourseEvent,
  deleteCourseEvent,
  subscribeToCourseEventRsvps,
  updateCourseEvent,
} from "@/lib/data/course-events";

const authState = vi.hoisted(() => ({
  user: { uid: "teacher-1", roles: ["teacher"] },
}));
// The schedule that the subscription delivers; each test decides what is in it.
const agenda = vi.hoisted(() => ({
  events: [] as CourseEvent[],
  params: "courseId=event-product-1&newEvent=1",
  // Modules and status of the event product: the next step depends on them.
  productModules: [] as Array<Record<string, unknown>>,
  productStatus: "draft",
  productPaymentType: "one_time",
  productFormat: undefined as string | undefined,
  // The first schedule read fails; "Try again" reads again through the channel.
  eventsFail: false,
  reload: vi.fn(),
  // The live channel: a later re-read that fails arrives through here.
  failLater: null as ((error: Error) => void) | null,
}));

// The I18nProvider calls useRouter() for the refresh when switching language.
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(agenda.params),
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => authState,
}));

vi.mock("@/lib/data/teacher-courses", () => ({
  subscribeToTeacherCourses: (
    _ownerId: string,
    onData: (courses: Array<Record<string, unknown>>) => void
  ) => {
    onData([
      {
        id: "course-1",
        ownerId: "teacher-1",
        title: "Existing course",
        summary: "Existing course summary",
        category: "Mental Health Foundations",
        status: "draft",
        modules: [],
        lessonCount: 0,
      },
      {
        id: "event-product-1",
        ownerId: "teacher-1",
        title: "Live supervision intensive",
        summary: "A paid live cohort",
        category: "Supervision & Continuing Education",
        status: agenda.productStatus,
        paymentType: agenda.productPaymentType,
        productFormat: agenda.productFormat,
        modules: agenda.productModules,
        lessonCount: 0,
      },
    ]);
    return vi.fn();
  },
}));

vi.mock("@/lib/data/course-events", () => ({
  cancelCourseEvent: vi.fn(),
  createCourseEvent: vi.fn(),
  deleteCourseEvent: vi.fn(),
  subscribeToCourseEventRsvps: vi.fn(() => vi.fn()),
  subscribeToTeacherCourseEvents: (
    _ownerId: string,
    onData: (events: CourseEvent[]) => void,
    onError: (error: Error) => void,
  ) => {
    agenda.failLater = onError;
    if (agenda.eventsFail) onError(new Error("agenda down"));
    else onData(agenda.events);
    return Object.assign(vi.fn(), { reload: agenda.reload });
  },
  updateCourseEvent: vi.fn(),
}));

describe("TeacherEventStudio", () => {
  afterEach(() => {
    agenda.events = [];
    agenda.params = "courseId=event-product-1&newEvent=1";
    agenda.productModules = [];
    agenda.productStatus = "draft";
    agenda.productPaymentType = "one_time";
    agenda.productFormat = undefined;
    agenda.eventsFail = false;
    vi.clearAllMocks();
  });

  // A read that failed is not an empty schedule: no "No sessions" with the invitation
  // to schedule one, nor "0" in the tiles. What stays is the error and "Try again".
  it("a schedule that failed to load shows the error and Try again, never the empty state", async () => {
    agenda.eventsFail = true;
    agenda.params = "";
    render(<TeacherEventStudio />);

    expect(await screen.findByRole("alert")).toHaveTextContent("We could not load your scheduled sessions.");
    expect(screen.queryByText("No sessions in this view.")).toBeNull();
    expect(screen.getAllByText("—")).toHaveLength(3);
    // Disabled export says the read failed, not "nothing to export".
    const exportButton = screen.getByRole("button", { name: "Export" });
    expect(exportButton).toBeDisabled();
    expect(exportButton).toHaveAccessibleDescription("Export is off because this data could not be loaded.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(agenda.reload).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Loading scheduled sessions...")).toBeInTheDocument();
    // The wait has the shape of the session cards, not a sentence in a card.
    expect(screen.getByText("Loading scheduled sessions...").closest('[role="status"]')).toHaveAttribute("data-skeleton", "cards");
  });

  // A re-read that fails with the schedule on screen: the sessions stay, the notice goes up and
  // "Try again" comes before the list (without going back to "loading").
  it("a re-read that fails keeps the sessions on screen, with Try again", async () => {
    agenda.params = "";
    agenda.events = [{
      id: "event-kept", courseId: "course-1", courseSlug: "course-1", courseTitle: "Existing course",
      ownerId: "teacher-1", title: "Kept session", description: "Still here.",
      type: "live_class", status: "scheduled", startsAt: "2027-03-14T15:30:00.000Z",
      externalUrl: "https://meet.example.com/live", recordingAssetId: null,
    }] as CourseEvent[];
    render(<TeacherEventStudio />);
    expect(await screen.findByText("Kept session")).toBeInTheDocument();

    act(() => agenda.failLater?.(new Error("re-read down")));

    expect(screen.getByRole("alert")).toHaveTextContent("We could not load your scheduled sessions.");
    expect(screen.getByText("Kept session")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(agenda.reload).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Kept session")).toBeInTheDocument();
    expect(screen.queryByText("Loading scheduled sessions...")).toBeNull();
  });

  // Date and time in two fields, as in the creation of the "Live event" product.
  function fillWhen(date: string, time: string) {
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: date } });
    fireEvent.change(screen.getByLabelText("Time"), { target: { value: time } });
  }

  async function scheduleSession() {
    fillWhen("2027-03-14", "15:30");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.change(screen.getByLabelText("Session title"), { target: { value: "Live workshop" } });
    fireEvent.change(screen.getByLabelText("External class link"), { target: { value: "https://meet.example.com/live" } });
    fireEvent.change(screen.getByLabelText("Session description"), { target: { value: "Practical exercises together." } });
    fireEvent.click(screen.getByRole("button", { name: "Schedule session" }));
    await waitFor(() => expect(createCourseEvent).toHaveBeenCalledTimes(1));
  }

  // After scheduling the session the person was stuck on the Schedule, with no path
  // to pricing and publishing. The server (publish_teacher_course) still requires
  // a lesson with content, so the welcome lesson shortcut comes along.
  it("after scheduling the session shows the next step: price and publish, with the welcome lesson", async () => {
    render(<TeacherEventStudio />);
    expect(screen.queryByRole("link", { name: "Set the price and publish" })).not.toBeInTheDocument();
    await scheduleSession();

    const next = await screen.findByRole("region", { name: "Session scheduled. Next: set the price and publish." });
    // The tile already says "Session scheduled": the confirmation line does not repeat it.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    const pricing = within(next).getByRole("link", { name: "Set the price and publish" });
    expect(pricing).toHaveAttribute("href", "/teach/builder?courseId=event-product-1&tab=pricing");
    expect(pricing).toHaveClass("button-solid", "button-lg");
    expect(pricing.querySelector("svg")).not.toBeNull();
    expect(within(next).getByText(/Publishing needs at least one lesson with content/)).toBeInTheDocument();
    const lesson = within(next).getByRole("link", { name: "Add a short welcome lesson" });
    expect(lesson).toHaveAttribute("href", "/teach/builder?courseId=event-product-1&tab=content&welcome=1");
    expect(lesson).toHaveClass("button-outline");
  });

  // F-04: the button does not change width when saving. "Saving..." is still written
  // and becomes the button's name; "Schedule session" stays in place, hidden.
  it("Schedule session becomes Saving... while waiting, without losing the label's place", async () => {
    let finish!: (id: string) => void;
    vi.mocked(createCourseEvent).mockReturnValueOnce(new Promise<string>((resolve) => { finish = resolve; }));
    render(<TeacherEventStudio />);
    fillWhen("2027-03-14", "15:30");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.change(screen.getByLabelText("Session title"), { target: { value: "Live workshop" } });
    fireEvent.change(screen.getByLabelText("External class link"), { target: { value: "https://meet.example.com/live" } });
    fireEvent.change(screen.getByLabelText("Session description"), { target: { value: "Practical exercises together." } });

    const submit = screen.getByRole("button", { name: "Schedule session" });
    expect(screen.getByText("Saving...")).toHaveAttribute("aria-hidden", "true");
    fireEvent.click(submit);

    expect(await screen.findByRole("button", { name: "Saving..." })).toBe(submit);
    expect(submit).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Schedule session" })).toBeNull();
    expect(screen.getByText("Schedule session")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("Saving...")).not.toHaveAttribute("aria-hidden");
    expect(screen.getByText("Saving...").parentElement).toBe(screen.getByText("Schedule session").parentElement);

    await act(async () => finish("event-1"));
  });

  it("product that already has a lesson: the next step is only price and publish", async () => {
    agenda.productModules = [{ id: "m1", title: "Welcome", lessons: [{ id: "l1", title: "Hello", type: "text", description: "" }] }];
    render(<TeacherEventStudio />);
    await scheduleSession();

    const next = await screen.findByRole("region", { name: "Session scheduled. Next: set the price and publish." });
    expect(within(next).getByRole("link", { name: "Set the price and publish" })).toBeInTheDocument();
    expect(within(next).queryByRole("link", { name: "Add a short welcome lesson" })).not.toBeInTheDocument();
  });

  // A live event publishes without a lesson (20261007010000): no welcome lesson.
  it("live event: the next step is only price and publish, no lesson", async () => {
    agenda.productFormat = "live_event";
    render(<TeacherEventStudio />);
    await scheduleSession();

    const next = await screen.findByRole("region", { name: "Session scheduled. Next: set the price and publish." });
    expect(within(next).getByRole("link", { name: "Set the price and publish" })).toBeInTheDocument();
    expect(within(next).queryByText(/Publishing needs at least one lesson with content/)).not.toBeInTheDocument();
    expect(within(next).queryByRole("link", { name: "Add a short welcome lesson" })).not.toBeInTheDocument();
  });

  // Free has no price: the shortcut sent people to the price tab, where the screen itself
  // asks "want to charge?". The step becomes just publish, in the review.
  it("free product: the next step is to publish, with no mention of price", async () => {
    agenda.productPaymentType = "free";
    render(<TeacherEventStudio />);
    await scheduleSession();

    const next = await screen.findByRole("region", { name: "Session scheduled. Next: publish." });
    const publish = within(next).getByRole("link", { name: "Review and publish" });
    expect(publish).toHaveAttribute("href", "/teach/builder?courseId=event-product-1&tab=review");
    expect(within(next).queryByRole("link", { name: "Set the price and publish" })).not.toBeInTheDocument();
    expect(within(next).getByRole("link", { name: "Add a short welcome lesson" })).toBeInTheDocument();
  });

  // In review the builder opens read-only: no shortcut to it.
  it("product under review: no next step", async () => {
    agenda.productStatus = "in_review";
    render(<TeacherEventStudio />);
    await scheduleSession();

    await waitFor(() => expect(screen.queryByLabelText("Session title")).not.toBeInTheDocument());
    expect(screen.queryByRole("region", { name: /Session scheduled/ })).not.toBeInTheDocument();
  });

  it("product already published: no next step", async () => {
    agenda.productStatus = "published";
    render(<TeacherEventStudio />);
    await scheduleSession();

    await waitFor(() => expect(screen.queryByLabelText("Session title")).not.toBeInTheDocument());
    expect(screen.queryByRole("link", { name: "Set the price and publish" })).not.toBeInTheDocument();
    // The form closed without any sentence: now it says it worked.
    expect(screen.getByRole("status")).toHaveTextContent("Session scheduled.");
  });

  it("does not silently schedule against another course when the requested course is unavailable", async () => {
    agenda.params = "courseId=deleted-course&newEvent=1";
    render(<TeacherEventStudio />);
    const course = screen.getByRole("combobox", { name: "Course" });
    expect(course).toHaveValue("");
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    // Disabled says why (F-12).
    expect(screen.getByRole("button", { name: "Continue" })).toHaveAccessibleDescription("Choose an available course");
    fillWhen("2027-03-14", "15:30");
    const form = course.closest("form");
    if (!form) throw new Error("Event form not found");
    fireEvent.submit(form);
    await waitFor(() => expect(createCourseEvent).not.toHaveBeenCalled());
    fireEvent.change(course, { target: { value: "event-product-1" } });
    expect(course).toHaveValue("event-product-1");
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  });

  it("still defaults to the first course when no course was requested", () => {
    agenda.params = "newEvent=1";
    render(<TeacherEventStudio />);
    expect(screen.getByRole("combobox", { name: "Course" })).toHaveValue("course-1");
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  });

  it("reveals details only after a valid date, preserves both steps, and saves only at the end", async () => {
    render(<TeacherEventStudio />);
    expect(screen.queryByLabelText("Session title")).not.toBeInTheDocument();
    const date = screen.getByLabelText("Date");
    const form = date.closest("form")!;
    fireEvent.submit(form);
    expect(screen.queryByLabelText("Session title")).not.toBeInTheDocument();
    expect(createCourseEvent).not.toHaveBeenCalled();
    fillWhen("2027-03-14", "15:30");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("heading", { name: "Session details" })).toHaveFocus();
    expect(screen.queryByLabelText("Date")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Session title"), { target: { value: "Live workshop" } });
    fireEvent.change(screen.getByLabelText("External class link"), { target: { value: "https://meet.example.com/live" } });
    fireEvent.change(screen.getByLabelText("Session description"), { target: { value: "Practical exercises together." } });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByLabelText("Date")).toHaveValue("2027-03-14");
    expect(screen.getByLabelText("Time")).toHaveValue("15:30");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByLabelText("Session title")).toHaveValue("Live workshop");
    expect(createCourseEvent).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Schedule session" }));
    await waitFor(() => expect(createCourseEvent).toHaveBeenCalledTimes(1));
    expect(createCourseEvent).toHaveBeenCalledWith(expect.objectContaining({
      courseId: "event-product-1", title: "Live workshop", externalUrl: "https://meet.example.com/live",
      startsAt: new Date("2027-03-14T15:30").toISOString(),
    }));
    await waitFor(() => expect(screen.queryByLabelText("Session title")).not.toBeInTheDocument());
  });

  it("preselects the product created by the event workflow", async () => {
    render(<TeacherEventStudio />);

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Course" })).toHaveValue("event-product-1");
    });
  });

  it("keeps edit values and failed saves on the details step for retry", async () => {
    agenda.params = "";
    agenda.events = [{
      id: "event-edit", courseId: "course-1", courseSlug: "course-1", courseTitle: "Existing course",
      ownerId: "teacher-1", title: "Existing session", description: "An existing description.",
      type: "live_class", status: "scheduled", startsAt: "2027-03-14T15:30:00.000Z",
      externalUrl: "https://meet.example.com/live", recordingAssetId: null,
    }];
    vi.mocked(updateCourseEvent).mockRejectedValueOnce(new Error("Save unavailable"));
    render(<TeacherEventStudio />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("combobox", { name: "Course" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Course" })).toHaveAccessibleDescription(
      "The course of a scheduled session can't be changed.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByLabelText("Session title")).toHaveValue("Existing session");
    fireEvent.click(screen.getByRole("button", { name: "Update session" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByLabelText("Session title")).toHaveValue("Existing session");
    expect(createCourseEvent).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Update session" }));
    await waitFor(() => expect(updateCourseEvent).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByLabelText("Session title")).not.toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent("Session updated.");
  });

  // The whole studio still speaks English; only the date now follows the language of the
  // person, and the invalid date shows the translated text instead of "Date pending".
  it("in the schedule, the session date comes out in the person's language and an invalid date becomes 'Fecha pendiente'", async () => {
    // Date in the future: the schedule opens on the "Upcoming" filter, so a past
    // session would not be in the list. What this test proves (date in the language of the
    // person and the fallback of the invalid date) does not change because of that.
    const startsAt = "2027-03-14T15:30:00.000Z";
    const base = {
      courseId: "course-1",
      courseSlug: "existing-course",
      courseTitle: "Existing course",
      ownerId: "teacher-1",
      description: "",
      type: "live_class" as const,
      status: "scheduled" as const,
      externalUrl: "https://meet.example.com/live",
      recordingAssetId: null,
    };
    agenda.events = [
      { ...base, id: "event-1", title: "Live Q&A", startsAt },
      { ...base, id: "event-2", title: "Sin fecha", startsAt: "not a date" },
    ];
    render(<I18nProvider initialLocale="es"><TeacherEventStudio /></I18nProvider>);

    expect(await screen.findByText(
      formatEventDateTime(startsAt, "es"),
    )).toBeInTheDocument();
    expect(screen.getByText("Fecha pendiente")).toBeInTheDocument();
  });

  // The teacher typed "7:00 PM" without knowing whose time it was, and the learners
  // are in several US time zones.
  it("says whose time it is and shows the preview in the four US time zones before saving", () => {
    const real = Intl.DateTimeFormat.prototype.resolvedOptions;
    const zone = vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementation(function (
      this: Intl.DateTimeFormat,
    ) {
      return { ...real.call(this), timeZone: "America/Chicago" };
    });
    render(<TeacherEventStudio />);

    // The time zone name, with the id's city only in parentheses: someone who lives in
    // Dallas does not read "Chicago" as if it were their place.
    const line = "Time zone: Central Time (Chicago), from this computer";
    expect(screen.getByText(line)).toBeInTheDocument();
    expect(screen.getByLabelText("Date")).toHaveAccessibleDescription(line);
    expect(screen.getByLabelText("Time")).toHaveAccessibleDescription(line);
    // Larger fields, with the right keyboard for each one.
    expect(screen.getByLabelText("Date")).toHaveAttribute("type", "date");
    expect(screen.getByLabelText("Time")).toHaveAttribute("type", "time");
    expect(screen.getByLabelText("Date")).toHaveClass("field-input", "min-h-12", "text-base!");
    zone.mockRestore();

    fillWhen("2027-03-14", "15:30");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const instant = new Date("2027-03-14T15:30").toISOString();
    const preview = screen.getByText(/^In US time zones: /);
    expect(preview.textContent).toBe(
      `In US time zones: ${formatEventTimeInZones(instant, "en", US_PREVIEW_TIME_ZONES).join(" · ")}`,
    );
    expect(preview.textContent?.replace(/\s+/g, " ")).toMatch(/ ET · .+ CT · .+ MT · .+ PT$/);
  });

  it("a date and time that have already passed block before saving, with the sentence tied to the fields", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2027, 2, 14, 12, 0));
    try {
      render(<TeacherEventStudio />);
      fillWhen("2027-03-14", "09:00");
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));

      expect(screen.queryByLabelText("Session title")).not.toBeInTheDocument();
      const date = screen.getByLabelText("Date");
      expect(date).toHaveAttribute("aria-invalid", "true");
      expect(date).toHaveAccessibleDescription(/Choose a date and time that has not passed yet\./);
      expect(screen.getByLabelText("Time")).toHaveAttribute("aria-invalid", "true");
      expect(screen.getAllByRole("alert")).toHaveLength(1);
      expect(date).toHaveAttribute("min", "2027-03-14");

      fireEvent.change(screen.getByLabelText("Time"), { target: { value: "13:00" } });
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
      expect(screen.getByLabelText("Session title")).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  // A deadline is not a meeting: asking for a Zoom link for it made no sense.
  it("deadline (Deadline) saves without a link; the other types still ask for one", async () => {
    render(<TeacherEventStudio />);
    fireEvent.change(screen.getByRole("combobox", { name: "Session type" }), { target: { value: "deadline" } });
    fillWhen("2027-03-14", "15:30");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const link = screen.getByLabelText("External class link");
    expect(link).not.toBeRequired();
    expect(link).toHaveAccessibleDescription("Optional for a deadline: it is a due date, not a meeting.");
    fireEvent.change(screen.getByLabelText("Session title"), { target: { value: "Final essay due" } });
    fireEvent.change(screen.getByLabelText("Session description"), { target: { value: "Send the essay before this time." } });
    fireEvent.click(screen.getByRole("button", { name: "Schedule session" }));
    await waitFor(() => expect(createCourseEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "deadline", externalUrl: "" })));

    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    fillWhen("2027-03-14", "15:30");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByLabelText("External class link")).toBeRequired();
  });

  it("the link opens the address keyboard and gets the missing https:// when leaving the field", async () => {
    render(<TeacherEventStudio />);
    fillWhen("2027-03-14", "15:30");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const link = screen.getByLabelText("External class link");
    // Without type="url": the browser validation would block "zoom.us/j/123" before
    // the https:// of the submit. The address keyboard comes from inputmode.
    expect(link).not.toHaveAttribute("type", "url");
    expect(link).toHaveAttribute("inputmode", "url");
    expect(link).toHaveAttribute("autocapitalize", "none");
    expect(link).toHaveAttribute("autocorrect", "off");
    expect(link).toHaveAttribute("spellcheck", "false");
    fireEvent.change(link, { target: { value: "zoom.us/j/123" } });
    fireEvent.blur(link);
    expect(link).toHaveValue("https://zoom.us/j/123");
    fireEvent.change(screen.getByLabelText("Session title"), { target: { value: "Live workshop" } });
    fireEvent.change(screen.getByLabelText("Session description"), { target: { value: "Practical exercises together." } });
    fireEvent.click(screen.getByRole("button", { name: "Schedule session" }));
    await waitFor(() => expect(createCourseEvent).toHaveBeenCalledWith(expect.objectContaining({ externalUrl: "https://zoom.us/j/123" })));
  });

  // Enter in the field (or a tap on iOS that does not drop focus) submits without blur: the
  // https:// goes into the submit anyway.
  it("a link without a scheme submitted with Enter, without leaving the field, is saved with https://", async () => {
    render(<TeacherEventStudio />);
    fillWhen("2027-03-14", "15:30");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.change(screen.getByLabelText("Session title"), { target: { value: "Live workshop" } });
    fireEvent.change(screen.getByLabelText("Session description"), { target: { value: "Practical exercises together." } });
    const link = screen.getByLabelText("External class link");
    fireEvent.change(link, { target: { value: "zoom.us/j/456" } });
    fireEvent.submit(link.closest("form")!);
    await waitFor(() => expect(createCourseEvent).toHaveBeenCalledWith(expect.objectContaining({ externalUrl: "https://zoom.us/j/456" })));
  });

  // A session created together with the product starts with an empty description: a
  // teacher who only wants to add the link cannot be blocked by the 12 letters.
  it("a session that already had an empty description saves with only the link; a new session requires the description", async () => {
    agenda.params = "";
    agenda.events = [{
      id: "event-bare", courseId: "event-product-1", courseSlug: "event-product-1", courseTitle: "Live supervision intensive",
      ownerId: "teacher-1", title: "Live supervision intensive", description: "",
      type: "live_class", status: "scheduled", startsAt: "2027-03-14T15:30:00.000Z",
      externalUrl: "", recordingAssetId: null,
    }];
    render(<TeacherEventStudio />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByLabelText("Session description")).not.toBeRequired();
    fireEvent.change(screen.getByLabelText("External class link"), { target: { value: "https://meet.example.com/live" } });
    fireEvent.click(screen.getByRole("button", { name: "Update session" }));
    await waitFor(() => expect(updateCourseEvent).toHaveBeenCalledWith("event-bare", expect.objectContaining({
      description: "", externalUrl: "https://meet.example.com/live",
    })));

    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    fillWhen("2027-03-14", "15:30");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByLabelText("Session description")).toBeRequired();
  });

  // Weekly group: they used to retype everything every week.
  it("scheduling another like it opens the form filled in a week later and only saves on confirm", async () => {
    agenda.params = "";
    agenda.events = [{
      id: "event-weekly", courseId: "course-1", courseSlug: "course-1", courseTitle: "Existing course",
      ownerId: "teacher-1", title: "Weekly group", description: "Our weekly group call.",
      type: "mentorship", status: "scheduled", startsAt: new Date(2027, 2, 14, 15, 30).toISOString(),
      externalUrl: "https://meet.example.com/weekly", recordingAssetId: null,
    }];
    render(<TeacherEventStudio />);
    fireEvent.click(screen.getByRole("button", { name: "Schedule another like this" }));

    expect(screen.getByRole("combobox", { name: "Course" })).toHaveValue("course-1");
    expect(screen.getByRole("combobox", { name: "Course" })).toBeEnabled();
    expect(screen.getByRole("combobox", { name: "Session type" })).toHaveValue("mentorship");
    expect(screen.getByLabelText("Date")).toHaveValue("2027-03-21");
    expect(screen.getByLabelText("Time")).toHaveValue("15:30");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByLabelText("Session title")).toHaveValue("Weekly group");
    expect(screen.getByLabelText("External class link")).toHaveValue("https://meet.example.com/weekly");
    expect(screen.getByLabelText("Session description")).toHaveValue("Our weekly group call.");
    expect(createCourseEvent).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Schedule session" }));
    await waitFor(() => expect(createCourseEvent).toHaveBeenCalledWith(expect.objectContaining({
      courseId: "course-1", type: "mentorship", title: "Weekly group",
      startsAt: new Date(2027, 2, 21, 15, 30).toISOString(),
    })));
    expect(updateCourseEvent).not.toHaveBeenCalled();
  });

  it("copied from an old session, the next one lands on the first week that has not passed yet", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2027, 2, 30, 12, 0));
    try {
      agenda.params = "";
      agenda.events = [{
        id: "event-old", courseId: "course-1", courseSlug: "course-1", courseTitle: "Existing course",
        ownerId: "teacher-1", title: "Weekly group", description: "Our weekly group call.",
        type: "mentorship", status: "scheduled", startsAt: new Date(2027, 2, 14, 15, 30).toISOString(),
        externalUrl: "https://meet.example.com/weekly", recordingAssetId: null,
      }];
      render(<TeacherEventStudio />);
      fireEvent.change(screen.getByLabelText("Filter sessions"), { target: { value: "past" } });
      fireEvent.click(screen.getByRole("button", { name: "Schedule another like this" }));
      expect(screen.getByLabelText("Date")).toHaveValue("2027-04-04");
      expect(screen.getByLabelText("Time")).toHaveValue("15:30");
    } finally {
      vi.useRealTimers();
    }
  });

  // F-14: cancel and delete opened the browser's gray box ("OK /
  // Cancel") and, after deleting, nothing said it had worked.
  describe("cancel and delete ask in the platform dialog", () => {
    const session: CourseEvent = {
      id: "event-live", courseId: "course-1", courseSlug: "course-1", courseTitle: "Existing course",
      ownerId: "teacher-1", title: "Live $& session", description: "", type: "live_class",
      status: "scheduled", startsAt: "2027-03-14T15:30:00.000Z",
      externalUrl: "https://meet.example.com/live", recordingAssetId: null,
    };
    // jsdom does not have showModal/close: the stub does the minimum that the browser does.
    const originalShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
    const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");

    beforeEach(() => {
      agenda.params = "";
      agenda.events = [session];
      // Only Date is fake: the confirm ignores clicks in the first 500ms.
      vi.useFakeTimers({ toFake: ["Date"] });
      Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.setAttribute("open", ""); } });
      Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { if (!this.hasAttribute("open")) return; this.removeAttribute("open"); this.dispatchEvent(new Event("close")); } });
    });
    afterEach(() => {
      vi.useRealTimers();
      if (originalShow) Object.defineProperty(HTMLDialogElement.prototype, "showModal", originalShow);
      else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
      if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, "close", originalClose);
      else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
    });

    it.each([
      {
        trigger: "Cancel session", title: "Cancel this session?", confirm: "Cancel session", action: cancelCourseEvent,
        // The sentence says what is true: the learner sees the session marked as
        // canceled, in the schedule and on the room tab, until a week after the date,
        // and nobody is notified automatically.
        sentence: "Cancel \"Live $& session\"? Learners see it marked as cancelled in their live sessions agenda and in the course's Live sessions tab until a week after its date. They are not notified automatically, so let them know.", notice: "Session cancelled.",
      },
      {
        trigger: "Delete", title: "Delete this session?", confirm: "Delete session", action: deleteCourseEvent,
        sentence: "Permanently delete \"Live $& session\"? This cannot be undone.", notice: "Session deleted.",
      },
    ])("$trigger: shows the phrase, nothing happens without confirming and confirming runs once", async ({ trigger, title, confirm, action, sentence, notice }) => {
      const nativeConfirm = vi.spyOn(window, "confirm");
      vi.mocked(action).mockResolvedValue(undefined);
      render(<TeacherEventStudio />);

      // (a) the usual sentence, now in the platform dialog;
      fireEvent.click(screen.getByRole("button", { name: trigger }));
      const dialog = screen.getByRole("dialog", { name: title });
      expect(dialog).toHaveTextContent(sentence);
      expect(nativeConfirm).not.toHaveBeenCalled();
      // (b) giving up does nothing;
      fireEvent.click(within(dialog).getByRole("button", { name: "Keep session" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(action).not.toHaveBeenCalled();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();

      // (c) confirming calls the action once, with the same session. A click
      // stuck to the opening (double tap) is discarded.
      fireEvent.click(screen.getByRole("button", { name: trigger }));
      const again = screen.getByRole("dialog", { name: title });
      fireEvent.click(within(again).getByRole("button", { name: confirm }));
      expect(action).not.toHaveBeenCalled();
      vi.advanceTimersByTime(CONFIRM_GUARD_MS);
      fireEvent.click(within(again).getByRole("button", { name: confirm }));
      expect(action).toHaveBeenCalledExactlyOnceWith("event-live");
      // and says it worked.
      expect(await screen.findByRole("status")).toHaveTextContent(notice);
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(action).toHaveBeenCalledOnce();
      nativeConfirm.mockRestore();
    });

    it("the success notice disappears when the person edits the schedule again", async () => {
      render(<TeacherEventStudio />);
      fireEvent.click(screen.getByRole("button", { name: "Cancel session" }));
      vi.advanceTimersByTime(CONFIRM_GUARD_MS);
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel session" }));
      expect(await screen.findByRole("status")).toHaveTextContent("Session cancelled.");

      // Editing something else: the old "Session cancelled." does not stay next to the
      // form (nor next to a new error from it).
      fireEvent.click(screen.getByRole("button", { name: "Edit" }));
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    // Name and email already arrived in the responses read, but the screen only
    // showed "3 going". And deleting erased the responses without saying anything.
    it("shows who responded, exports name, email and response, and delete says how many lose their response", async () => {
      const rsvp = { eventId: "event-live", courseSlug: "course-1", userId: "u" };
      vi.mocked(subscribeToCourseEventRsvps).mockImplementationOnce((_eventId, onData) => {
        onData([
          { ...rsvp, id: "r1", attendeeName: "Ana Lima", attendeeEmail: "ana@example.com", status: "attending" },
          { ...rsvp, id: "r2", attendeeName: "Bruno", attendeeEmail: null, status: "not_attending" },
          { ...rsvp, id: "r3", attendeeName: "Carla", attendeeEmail: "carla@example.com", status: "attending" },
        ]);
        return vi.fn();
      });
      const created: Blob[] = [];
      Object.defineProperty(URL, "createObjectURL", { configurable: true, value: (blob: Blob) => { created.push(blob); return "blob:x"; } });
      Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: () => undefined });
      const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
      render(<TeacherEventStudio />);

      expect(screen.getByText("2 going")).toBeInTheDocument();
      const answers = screen.getByText("See who answered").closest("details")!;
      fireEvent.click(screen.getByText("See who answered"));
      // Those who are going first, then those who are not.
      expect(within(answers).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
        "Ana Lima · Going",
        "Carla · Going",
        "Bruno · Not going",
      ]);
      const group = within(answers).getByRole("group", { name: "Export attendees" });
      fireEvent.click(within(group).getByRole("button", { name: "Export" }));
      fireEvent.click(screen.getByRole("menuitem", { name: "Export as CSV" }));
      expect(created).toHaveLength(1);
      const csv = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.readAsText(created[0]);
      });
      expect(csv).toBe(
        "name,email,answer\nAna Lima,ana@example.com,Going\nCarla,carla@example.com,Going\nBruno,,Not going",
      );

      fireEvent.click(screen.getByRole("button", { name: "Delete" }));
      expect(screen.getByRole("dialog", { name: "Delete this session?" })).toHaveTextContent(
        "2 people said they will attend. Deleting erases their answers and nobody is notified. Cancel session keeps the record instead.",
      );
      click.mockRestore();
      Reflect.deleteProperty(URL, "createObjectURL");
      Reflect.deleteProperty(URL, "revokeObjectURL");
    });

    it("when delete fails, the error appears where it already did and there is no success notice", async () => {
      vi.mocked(deleteCourseEvent).mockRejectedValueOnce(new Error("Delete unavailable"));
      render(<TeacherEventStudio />);

      fireEvent.click(screen.getByRole("button", { name: "Delete" }));
      vi.advanceTimersByTime(CONFIRM_GUARD_MS);
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete session" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("We could not delete this session.");
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      expect(deleteCourseEvent).toHaveBeenCalledOnce();
    });
  });

  // The repeated hour of November: 09:30Z on Nov 1, 2026 is 1:30 AM PST in Los
  // Angeles, and "01:30" read back becomes 1:30 AM PDT (08:30Z). Editing only the title
  // saved the session an hour earlier. It goes last in the file: the process
  // time zone changes.
  it("editing without touching the date returns the stored instant, even on the repeated hour of November", async () => {
    vi.stubEnv("TZ", "America/Los_Angeles");
    try {
      expect(new Date("2026-11-01T09:30:00.000Z").getTimezoneOffset()).toBe(480);
      agenda.params = "";
      agenda.events = [{
        id: "event-dst", courseId: "course-1", courseSlug: "course-1", courseTitle: "Existing course",
        ownerId: "teacher-1", title: "Early bird", description: "A very early session.",
        type: "live_class", status: "scheduled", startsAt: "2026-11-01T09:30:00.000Z",
        externalUrl: "https://meet.example.com/live", recordingAssetId: null,
      }];
      render(<TeacherEventStudio />);
      fireEvent.change(screen.getByLabelText("Filter sessions"), { target: { value: "all" } });
      fireEvent.click(screen.getByRole("button", { name: "Edit" }));
      expect(screen.getByLabelText("Time")).toHaveValue("01:30");
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
      fireEvent.change(screen.getByLabelText("Session title"), { target: { value: "Early bird club" } });
      fireEvent.click(screen.getByRole("button", { name: "Update session" }));
      await waitFor(() => expect(updateCourseEvent).toHaveBeenCalledWith("event-dst", expect.objectContaining({
        title: "Early bird club", startsAt: "2026-11-01T09:30:00.000Z",
      })));
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
