import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { TeacherMessagesInbox } from "@/components/teacher/teacher-messages-inbox";
import type { CourseMessage } from "@/domain/course-message";

// Same mold as student-messages-inbox.test.tsx: one user object for the
// whole session and the subscription returning the messages right away.
const mocks = vi.hoisted(() => ({
  messages: [] as unknown[],
  // "data": the read arrives right away; "pending": has not arrived yet; "error": failed.
  mode: "data" as "data" | "pending" | "error",
  emit: (() => undefined) as (messages: unknown[]) => void,
  fail: (() => undefined) as () => void,
  unsubscribe: vi.fn(),
  reloads: 0,
  auth: {
    status: "authenticated",
    user: { uid: "teacher-1", email: "t@example.com", roles: ["teacher"] },
  },
}));

// The I18nProvider calls useRouter() for the refresh when the language changes.
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/navigation")>(),
  useRouter: () => router,
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => mocks.auth,
}));

vi.mock("@/lib/data/course-messages", () => ({
  subscribeToTeacherMessages: vi.fn(
    (_teacherId: string, onNext: (messages: unknown[]) => void, onError: (error: Error) => void) => {
      const read = () => {
        if (mocks.mode === "data") onNext(mocks.messages);
        if (mocks.mode === "error") onError(new Error("offline"));
      };
      mocks.emit = onNext;
      mocks.fail = () => onError(new Error("offline"));
      read();
      // Like the real one: turn off the channel, and `reload` re-reads without touching it.
      return Object.assign(mocks.unsubscribe, {
        reload: vi.fn(async () => {
          mocks.reloads += 1;
          read();
        }),
      });
    },
  ),
  sendCourseMessage: vi.fn(() => Promise.resolve({ success: true, messageId: "m-new" })),
}));

const fromStudent: CourseMessage = {
  id: "m1",
  courseId: "course-1",
  courseTitle: "Leadership",
  studentId: "student-1",
  studentName: "Ana",
  teacherId: "teacher-1",
  senderId: "student-1",
  body: "Hello!",
  createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
};

function show() {
  return render(
    <I18nProvider initialLocale="en">
      <TeacherMessagesInbox />
    </I18nProvider>,
  );
}

beforeEach(() => {
  mocks.messages = [];
  mocks.mode = "data";
  mocks.reloads = 0;
  mocks.unsubscribe.mockClear();
});
afterEach(cleanup);

describe("teacher inbox before, during and after the read", () => {
  it("before the first read it shows loading, not 'No student messages yet'", () => {
    mocks.mode = "pending";
    show();
    expect(screen.getByRole("status")).toHaveTextContent("Loading your student messages...");
    expect(screen.queryByText("No student messages yet")).toBeNull();

    act(() => mocks.emit([]));
    expect(screen.getByText("No student messages yet")).toBeTruthy();
  });

  it("if the first read fails: error with 'Try again', which re-reads through the same channel", async () => {
    mocks.mode = "error";
    show();
    expect(screen.getByRole("alert")).toHaveTextContent("We could not load your student messages.");
    expect(screen.queryByText("No student messages yet")).toBeNull();

    mocks.mode = "data";
    mocks.messages = [fromStudent];
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });
    expect(mocks.reloads).toBe(1);
    expect(mocks.unsubscribe).not.toHaveBeenCalled();
    expect(screen.getByRole("navigation", { name: "Student threads" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a re-read that fails with the list on screen: the list stays, and the notice carries 'Try again'", async () => {
    mocks.messages = [fromStudent];
    show();
    act(() => mocks.fail());
    expect(screen.getByRole("alert")).toHaveTextContent("We could not load your student messages.");
    expect(screen.getByRole("navigation", { name: "Student threads" })).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });
    expect(mocks.reloads).toBe(1);
    expect(mocks.unsubscribe).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("teacher messages inbox", () => {
  // The list and the conversation called the time formatter without `t` or `locale`:
  // in Spanish the time came out in English ("5m ago").
  it("shows the conversation time in the person's language", () => {
    mocks.messages = [fromStudent];
    render(
      <I18nProvider initialLocale="es">
        <TeacherMessagesInbox />
      </I18nProvider>,
    );

    // Once in the learner list, once in the open message (the first
    // conversation already comes open).
    expect(screen.getAllByText(/Hace 5 min/)).toHaveLength(2);
  });
});
