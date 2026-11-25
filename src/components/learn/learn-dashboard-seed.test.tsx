import { act, cleanup, render, screen } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { LearnDashboard } from "@/components/learn/learn-dashboard";
import type { Enrollment } from "@/domain/enrollment";
import type { EnrollmentSeed } from "@/lib/data/server/learner-enrollments";

// /learn used to leave the server as a skeleton and read the enrollments in the
// browser, so the courses were the last thing on the page. The server now sends
// the rows with the page. Proved here: the first HTML already has the courses,
// hydrating it is clean, and rows are never drawn where they are not the truth:
// for another account, or again when the page comes back from the cache.

const state = vi.hoisted(() => ({
  user: { uid: "student-1", displayName: "Patrick Simon", roles: ["student"] },
  subscribed: [] as string[],
  // The browser's own read: the tests decide when, and what, it answers.
  deliver: (() => undefined) as (rows: unknown[]) => void,
  fail: (() => undefined) as () => void,
  eventSubscriptions: [] as string[],
}));

vi.mock("next/navigation", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/navigation")>(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ user: state.user, status: "authenticated" }),
}));
vi.mock("@/components/learn/welcome-tour", () => ({ WelcomeTour: () => null }));
vi.mock("@/components/learn/learning-paths-rows", () => ({ LearningPathsRows: () => null }));
vi.mock("@/lib/data/catalog", () => ({ getCourseBySlug: () => undefined }));
vi.mock("@/lib/data/published-courses", () => ({
  fetchCoursesByIds: async () => [],
  teacherCourseToLearningCourse: (course: unknown) => course,
}));
vi.mock("@/lib/data/notifications", () => ({ subscribeToNotifications: () => () => undefined }));
vi.mock("@/lib/data/course-events", () => ({
  subscribeToCourseEvents: (courseSlug: string) => {
    state.eventSubscriptions.push(courseSlug);
    return () => undefined;
  },
}));
// The real mapper, and a browser read the tests control.
vi.mock("@/lib/data/enrollments", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/data/enrollments")>();
  return {
    ...real,
    subscribeToUserEnrollments: (
      uid: string,
      onData: (enrollments: Enrollment[]) => void,
      onError: (error: Error) => void,
    ) => {
      state.subscribed.push(uid);
      state.deliver = (rows) => onData((rows as Parameters<typeof real.rowToEnrollment>[0][]).map(real.rowToEnrollment));
      state.fail = () => onError(new Error("offline"));
      return Object.assign(() => undefined, { reload: async () => undefined });
    },
  };
});

function row(id: string, title: string, image: string, progress = 40) {
  return {
    id,
    user_id: "student-1",
    course_id: `course-${id}`,
    course_slug: `course-${id}`,
    course_title: title,
    course_category: "Soft Skills",
    course_image: image,
    status: "active",
    source: "payment",
    subscription_id: null,
    creator_grant_id: null,
    progress_percent: progress,
    last_lesson_id: null,
    created_at: "2026-09-01T10:00:00.000Z",
    updated_at: "2026-09-02T10:00:00.000Z",
  };
}

// In the order the server sends them (already sorted by title).
const rows = [row("a", "Brand Design Atelier", "/covers/bd.jpg"), row("b", "Effective Communication", "/covers/ec.jpg")];

// A new read every time, as each page load is.
let reads = 0;
function seed(overrides: Partial<{ uid: string; rows: unknown[] }> = {}) {
  reads += 1;
  return { id: `read-${reads}`, uid: "student-1", rows, ...overrides } as unknown as EnrollmentSeed;
}

function page(value: EnrollmentSeed | null) {
  return (
    <I18nProvider initialLocale="en">
      <LearnDashboard seed={value} />
    </I18nProvider>
  );
}

beforeEach(() => {
  state.user = { uid: "student-1", displayName: "Patrick Simon", roles: ["student"] };
  state.subscribed = [];
  state.eventSubscriptions = [];
});

afterEach(cleanup);

describe("LearnDashboard with enrollments sent by the server", () => {
  it("the server HTML already has the courses, in the order sent, and no skeleton", () => {
    const html = renderToString(page(seed()));

    expect(html).not.toContain('aria-busy="true"');
    expect(html.indexOf("Brand Design Atelier")).toBeGreaterThan(-1);
    expect(html.indexOf("Effective Communication")).toBeGreaterThan(html.indexOf("Brand Design Atelier"));
  });

  it("only the first cover is fetched first; the rest stay lazy", () => {
    const container = document.createElement("div");
    container.innerHTML = renderToString(page(seed()));
    const covers = [...container.querySelectorAll("img")];

    expect(covers).toHaveLength(2);
    expect(covers[0]).toHaveAttribute("fetchpriority", "high");
    expect(covers[0]).toHaveAttribute("loading", "eager");
    expect(covers[1]).not.toHaveAttribute("fetchpriority");
    expect(covers[1]).toHaveAttribute("loading", "lazy");
  });

  it("with nothing from the server it is the skeleton, as before", () => {
    const html = renderToString(page(null));

    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain("Brand Design Atelier");
  });

  it("an empty list from the server is the empty state, not a skeleton", () => {
    const html = renderToString(page(seed({ rows: [] })));

    expect(html).not.toContain('aria-busy="true"');
    expect(html).toContain("Explore programs");
  });

  it("never draws rows that were read for another account", () => {
    state.user = { uid: "student-2", displayName: "Someone Else", roles: ["student"] };
    const html = renderToString(page(seed()));

    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain("Brand Design Atelier");
    expect(html).not.toContain("Effective Communication");
  });

  it("hydrates the server HTML cleanly and still opens the live read for the same person", async () => {
    const value = seed();
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = renderToString(page(value));

    const recoverable: unknown[] = [];
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(container, page(value), {
        onRecoverableError: (error) => recoverable.push(error),
      });
    });

    expect(recoverable).toEqual([]);
    expect(errors).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Brand Design Atelier");
    // The seed replaces the first paint only: the subscription still runs.
    expect(state.subscribed).toEqual(["student-1"]);

    await act(async () => root.unmount());
    errors.mockRestore();
    container.remove();
  });

  // The Back button restores the page from the router's cache with the SAME
  // seed. By then it is out of date: a lesson watched since, a course bought
  // since. That mount must read fresh, behind the skeleton, as it always did.
  it("draws a given read once: the same page restored later starts from the skeleton", async () => {
    const value = seed();
    let first!: ReturnType<typeof render>;
    await act(async () => {
      first = render(page(value));
    });
    expect(screen.getByText("Brand Design Atelier")).toBeTruthy();
    await act(async () => first.unmount());

    await act(async () => {
      render(page(value));
    });
    expect(screen.queryByText("Brand Design Atelier")).toBeNull();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();

    // And the fresh read is what it then shows.
    await act(async () => state.deliver([row("a", "Brand Design Atelier", "/covers/bd.jpg", 90)]));
    expect(screen.getByText("Brand Design Atelier")).toBeTruthy();
    expect(screen.queryByText("Effective Communication")).toBeNull();
  });

  it("when the browser reads the same rows, nothing runs twice", async () => {
    await act(async () => {
      render(page(seed()));
    });
    expect(state.eventSubscriptions).toEqual(["course-a", "course-b"]);

    await act(async () => state.deliver(rows));

    // One subscription per course, not a second round for an identical list.
    expect(state.eventSubscriptions).toEqual(["course-a", "course-b"]);
    expect(screen.getByText("Brand Design Atelier")).toBeTruthy();
  });

  it("when the browser reads something newer, that is what stays on screen", async () => {
    await act(async () => {
      render(page(seed()));
    });

    await act(async () => state.deliver([...rows, row("c", "Zen for Teams", "/covers/zen.jpg")]));

    expect(screen.getByText("Zen for Teams")).toBeTruthy();
  });

  it("a re-read that fails does not take away the courses the server just sent", async () => {
    await act(async () => {
      render(page(seed()));
    });

    await act(async () => state.fail());

    expect(screen.getByText("Brand Design Atelier")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("without a seed, a failed read is still the error with 'Try again', as before", async () => {
    await act(async () => {
      render(page(null));
    });

    await act(async () => state.fail());

    expect(screen.getByRole("alert")).toHaveTextContent("We could not load your enrolled courses.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("after the browser has answered once, a later failure is the error again", async () => {
    await act(async () => {
      render(page(seed()));
    });
    await act(async () => state.deliver(rows));

    await act(async () => state.fail());

    expect(screen.getByRole("alert")).toHaveTextContent("We could not load your enrolled courses.");
  });
});
