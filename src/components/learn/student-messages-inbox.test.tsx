import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { StudentMessagesInbox } from "@/components/learn/student-messages-inbox";
import { platformNav } from "@/data/site";
import type { CourseMessage } from "@/domain/course-message";
import { sendCourseMessage } from "@/lib/data/course-messages";

/**
 * Re-analysis item 12 — the learner's message inbox. Before, replying to the
 * teacher meant scrolling to the bottom of every lesson page; with three courses,
 * three places, and no list. Here: one conversation per course, the open one in the
 * address (?course=), and the way back always in the top left corner.
 */

const mocks = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
  push: vi.fn(),
  messages: [] as unknown[],
  // "data": the read arrives right away; "pending": it has not arrived yet; "error": it failed.
  mode: "data" as "data" | "pending" | "error",
  subscriptions: 0,
  // What the channel delivers once subscribed: a new read (real time) or a failure.
  emit: (() => undefined) as (messages: unknown[]) => void,
  fail: (() => undefined) as () => void,
  // One user object for the whole session (a new object per render
  // resubscribes the effect and loops).
  auth: { status: "authenticated", user: { uid: "student-1", email: "s@example.com", roles: ["student"] } },
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => mocks.searchParams,
  usePathname: () => "/learn/messages",
  useRouter: () => ({ push: mocks.push, replace: vi.fn() }),
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => mocks.auth,
}));

vi.mock("@/lib/data/course-messages", () => ({
  subscribeToStudentMessages: vi.fn(
    (_studentId: string, onNext: (messages: unknown[]) => void, onError: (error: Error) => void) => {
      mocks.subscriptions += 1;
      if (mocks.subscriptions > 20) {
        throw new Error("subscribeToStudentMessages called more than 20 times: render loop");
      }
      const read = () => {
        if (mocks.mode === "data") onNext(mocks.messages);
        if (mocks.mode === "error") onError(new Error("offline"));
      };
      mocks.emit = onNext;
      mocks.fail = () => onError(new Error("offline"));
      read();
      // Like the real one: turn the channel off, and `reload`, which reads again without touching it.
      return Object.assign(vi.fn(), { reload: vi.fn(async () => read()) });
    },
  ),
  sendCourseMessage: vi.fn(() => Promise.resolve({ success: true, messageId: "m-new" })),
}));

function message(overrides: Partial<CourseMessage>): CourseMessage {
  return {
    id: "m",
    courseId: "course-1",
    courseTitle: "Leadership",
    studentId: "student-1",
    studentName: "Student",
    teacherId: "teacher-1",
    senderId: "teacher-1",
    body: "hello",
    createdAt: "2026-09-01T10:00:00.000Z",
    ...overrides,
  };
}

const twoCourses = [
  message({ id: "m1", body: "Welcome to Leadership", createdAt: "2026-09-01T10:00:00.000Z" }),
  message({ id: "m2", senderId: "student-1", body: "Thanks!", createdAt: "2026-09-01T11:00:00.000Z" }),
  message({
    id: "m3",
    courseId: "course-2",
    courseTitle: "Communication",
    body: "Any questions about module 2?",
    createdAt: "2026-09-02T09:00:00.000Z",
  }),
];

function renderInbox(search = "", messages: unknown[] = twoCourses) {
  mocks.searchParams = new URLSearchParams(search);
  mocks.messages = messages;
  return render(<StudentMessagesInbox />);
}

describe("learner's message inbox", () => {
  beforeEach(() => {
    mocks.push.mockReset();
    mocks.subscriptions = 0;
    mocks.mode = "data";
    vi.mocked(sendCourseMessage).mockClear();
  });

  it("before the first read it shows loading, not 'No conversations yet'", () => {
    mocks.mode = "pending";
    renderInbox("", []);

    expect(screen.getByRole("status")).toHaveTextContent("Loading your conversations...");
    expect(screen.queryByText("No conversations yet")).not.toBeInTheDocument();
  });

  it("if the first read fails: an error with 'Try again' instead of the empty state, and the retry reads again", async () => {
    mocks.mode = "error";
    renderInbox("", []);

    expect(screen.getByRole("alert")).toHaveTextContent("We could not load your messages.");
    expect(screen.queryByText("No conversations yet")).not.toBeInTheDocument();

    mocks.mode = "data";
    mocks.messages = twoCourses;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Conversations" })).toBeInTheDocument();
  });

  it("'Try again' does not reconnect the channel: a message that arrives later in real time enters the list", async () => {
    mocks.mode = "error";
    renderInbox("", []);
    mocks.mode = "data";
    mocks.messages = twoCourses;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });
    // Reconnecting with the same name returned the old channel, on its way out: nothing else arrived.
    expect(mocks.subscriptions).toBe(1);

    act(() => mocks.emit([
      ...twoCourses,
      message({ id: "m4", courseId: "course-3", courseTitle: "Mindset", body: "New reply", createdAt: "2026-09-03T09:00:00.000Z" }),
    ]));
    const list = screen.getByRole("navigation", { name: "Conversations" });
    expect(within(list).getByText("Mindset")).toBeInTheDocument();
  });

  it("a re-read that fails with the list on screen: a visible notice with no conversation open, which goes away on the next read", () => {
    renderInbox();

    act(() => mocks.fail());
    expect(screen.getByRole("alert")).toHaveTextContent("We could not load your messages.");
    expect(screen.getByRole("navigation", { name: "Conversations" })).toBeInTheDocument();

    act(() => mocks.emit(twoCourses));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("on the phone, with a conversation open, the list goes away (it only comes back on the computer)", () => {
    renderInbox("course=course-1");

    const list = screen.getByRole("navigation", { name: "Conversations", hidden: true });
    expect(list).toHaveClass("hidden", "lg:grid");
    expect(screen.getByRole("region", { name: "Conversation: Leadership" })).toBeInTheDocument();
  });

  it("one conversation per course, the most recent first, saying who spoke last", () => {
    renderInbox();

    const list = screen.getByRole("navigation", { name: "Conversations" });
    const items = within(list).getAllByRole("button");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Communication");
    expect(items[0]).toHaveTextContent("Teacher: Any questions about module 2?");
    expect(items[1]).toHaveTextContent("Leadership");
    expect(items[1]).toHaveTextContent("You: Thanks!");
  });

  it("opening a conversation writes the course to the address", () => {
    renderInbox();

    fireEvent.click(screen.getByRole("button", { name: /Communication/ }));

    expect(mocks.push).toHaveBeenCalledWith("/learn/messages?course=course-2");
  });

  it("?course= opens that conversation, with the way back leading to the list", () => {
    renderInbox("course=course-1");

    const thread = screen.getByRole("region", { name: "Conversation: Leadership" });
    expect(within(thread).getByText("Welcome to Leadership")).toBeInTheDocument();
    expect(within(thread).getByText("Thanks!")).toBeInTheDocument();
    expect(within(thread).queryByText(/module 2/)).toBeNull();

    expect(screen.getByRole("link", { name: /All conversations/ })).toHaveAttribute(
      "href",
      "/learn/messages",
    );
  });

  it("on the list, the way back leads to the dashboard", () => {
    renderInbox();

    expect(screen.getByRole("link", { name: /Back/ })).toHaveAttribute("href", "/learn");
  });

  it("replying sends through the same path as the lesson: the learner themselves, in that course", async () => {
    renderInbox("course=course-2");

    fireEvent.change(screen.getByLabelText("Your message"), {
      target: { value: "Yes — about the exercise." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(sendCourseMessage).toHaveBeenCalledWith({
        courseId: "course-2",
        studentId: "student-1",
        body: "Yes — about the exercise.",
      }),
    );
  });

  it("no conversation: a one-line empty state, with the way back", () => {
    renderInbox("", []);

    expect(screen.getByText("No conversations yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Back/ })).toHaveAttribute("href", "/learn");
  });

  // The list and the conversation called the time formatter without `t` or `locale`:
  // in Spanish the time came out in English ("5m ago").
  it("shows the conversation time in the person's language", () => {
    mocks.searchParams = new URLSearchParams("course=course-1");
    mocks.messages = [
      message({ id: "m-es", createdAt: new Date(Date.now() - 5 * 60_000).toISOString() }),
    ];
    render(
      <I18nProvider initialLocale="es">
        <StudentMessagesInbox />
      </I18nProvider>,
    );

    // Once in the conversation list, once in the open message.
    expect(screen.getAllByText(/Hace 5 min/)).toHaveLength(2);
  });
});

// Messages moved up to the learner's pinned items (before, it lived in the Account group,
// which came closed for someone in "Learn"). Below stay only purchases and
// settings; notices arrive through the bell.
describe("Messages among the learner's pinned items", () => {
  it("Messages stays in the pinned section, for the learner only", () => {
    const item = platformNav.find((entry) => entry.href === "/learn/messages");

    expect(item).toMatchObject({ sectionKey: "learn", contexts: ["learner"] });
  });

  it("purchases and settings stay below, in the account section", () => {
    for (const href of ["/account", "/account/billing"]) {
      const item = platformNav.find((entry) => entry.href === href);
      expect(item?.contexts, href).toContain("learner");
      expect(item?.sectionKey, href).toBe("account");
    }
  });
});
