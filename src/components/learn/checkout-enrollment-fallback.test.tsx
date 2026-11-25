import { render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EnrolledCourseWorkspace } from "@/components/learn/enrolled-course-workspace";
import type { Course } from "@/domain/learning";

/**
 * The post-payment screen promises, in so many words: "Keep this page open: it
 * opens automatically the moment your enrollment is confirmed."
 *
 * The ONLY thing able to keep that promise was `postgres_changes` — a
 * WebSocket. A phone tab in the background, a corporate proxy or unstable
 * wi-fi silently drop that socket: the channel stays "subscribed" and
 * never fires. The promise became a lie and the buyer — who already paid —
 * was left there forever, not knowing that reloading was enough.
 *
 * These tests hold the safety net: while the enrollment has not arrived, the
 * subscription is re-issued periodically, BOTH BEFORE and AFTER the 90s grace period.
 */

const mocks = vi.hoisted(() => ({
  subscribeToEnrollment: vi.fn(),
  searchParams: new URLSearchParams("checkout=success"),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => mocks.searchParams,
  usePathname: () => "/learn/courses/demo",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    status: "authenticated",
    user: { uid: "buyer-1", email: "buyer@example.com", roles: ["student"] },
  }),
}));

vi.mock("@/lib/data/enrollments", () => ({
  subscribeToEnrollment: mocks.subscribeToEnrollment,
  subscribeToCompletedLessons: vi.fn(() => vi.fn()),
  markLessonComplete: vi.fn(),
  updateEnrollmentProgress: vi.fn(),
}));

const course = {
  id: "course-1",
  slug: "demo-course",
  title: "Demo course",
  category: "Leadership",
  summary: "A demo course.",
  image: null,
  modules: [],
  membersTheme: "light",
} as unknown as Course;

describe("safety net between paying and the enrollment showing up", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.subscribeToEnrollment.mockReset();
    // A "live" socket that delivers the current state (no enrollment yet) and
    // then never fires again — exactly the real failure mode: the channel
    // stays subscribed and the webhook never reaches it.
    mocks.subscribeToEnrollment.mockImplementation((_uid, _slug, onNext) => {
      onNext(null);
      return vi.fn();
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("re-subscribes while the enrollment has not arrived", () => {
    render(<EnrolledCourseWorkspace course={course} />);

    const initialCalls = mocks.subscribeToEnrollment.mock.calls.length;
    expect(initialCalls).toBeGreaterThan(0);

    act(() => {
      vi.advanceTimersByTime(11_000);
    });

    // Two 5s cycles inside the grace period.
    expect(mocks.subscribeToEnrollment.mock.calls.length).toBeGreaterThan(
      initialCalls,
    );
  });

  it("does NOT give up after the 90s grace period", () => {
    render(<EnrolledCourseWorkspace course={course} />);

    act(() => {
      vi.advanceTimersByTime(95_000);
    });

    // The grace period expired: the copy changes, but the fallback must keep going. Passing
    // 90s is precisely the sign that the WebSocket did not deliver — turning off the
    // poll aqui deixaria o socket morto como único caminho restante.
    expect(
      screen.getByText(/taking longer than usual/i),
    ).toBeInTheDocument();

    const callsAtGrace = mocks.subscribeToEnrollment.mock.calls.length;

    act(() => {
      vi.advanceTimersByTime(45_000);
    });

    expect(mocks.subscribeToEnrollment.mock.calls.length).toBeGreaterThan(
      callsAtGrace,
    );
  });
});
