import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { LearnDashboard } from "@/components/learn/learn-dashboard";
import { formatEventDateTime, type CourseEvent } from "@/domain/course-event";
import type { Enrollment } from "@/domain/enrollment";
import type { Course } from "@/domain/learning";
import type { AppNotification } from "@/domain/notification";

/**
 * What the person went through when entering /learn: two welcomes (the shell
 * headline and the "Welcome back"), three metric cards saying "1 · 0 · 0" and only
 * then the courses, each with "Open" and "Request refund" side by side. The
 * "Continue" opened the course COVER, not the lesson where they stopped. What had arrived
 * new only showed in the bell.
 *
 * These tests RENDER the dashboard with fake enrollments and prove the new
 * design: one greeting, resume straight into the lesson, a course filter, and
 * no refund on the card.
 */

// The SAME user object on every render: a new object per render
// resubscribes the effects that depend on `user` and goes into a loop.
const { mockUser, fixtures, fuse } = vi.hoisted(() => {
  const mockUser = {
    uid: "student-1",
    displayName: "Patrick Simon",
    roles: ["student"],
  };

  const course: Course = {
    id: "course-ec",
    slug: "effective-communication",
    title: "Effective Communication",
    category: "Soft Skills",
    durationLabel: "4 weeks",
    status: "published",
    statusLabel: "Popular",
    summary: "Summary",
    detail: "Detail",
    image: "/covers/ec.jpg",
    level: "Foundation",
    priceLabel: "$79",
    priceAmountMinor: 7900,
    currency: "USD",
    platformFeeBps: 800,
    freePreviewLabel: "Free preview",
    outcomes: [],
    communityEnabled: true,
    modules: [
      {
        id: "m1",
        title: "Foundations",
        summary: "",
        lessons: [
          { id: "l1", title: "Welcome", type: "video", duration: "8 min", isPreview: true },
          { id: "l2", title: "Framework", type: "video", duration: "12 min", isPreview: false },
        ],
      },
      {
        id: "m2",
        title: "Practice",
        summary: "",
        lessons: [
          { id: "l3", title: "Exercise", type: "video", duration: "35 min", isPreview: false },
          { id: "l4", title: "Wrap-up", type: "video", duration: "10 min", isPreview: false },
        ],
      },
    ],
  };

  const inProgress: Enrollment = {
    id: "enrollment-1",
    userId: "student-1",
    courseId: "course-ec",
    courseSlug: "effective-communication",
    courseTitle: "Effective Communication",
    courseCategory: "Soft Skills",
    courseImage: "/covers/ec.jpg",
    status: "active",
    source: "payment",
    progressPercent: 50,
    // The lesson where the person stopped: that is where the card has to point.
    lastLessonId: "l3",
    updatedAt: "2026-09-01T10:00:00.000Z",
  };

  const completed: Enrollment = {
    id: "enrollment-2",
    userId: "student-1",
    courseId: "course-bd",
    courseSlug: "brand-design",
    courseTitle: "Brand Design Atelier",
    courseCategory: "Design",
    courseImage: "/covers/bd.jpg",
    status: "completed",
    source: "payment",
    progressPercent: 100,
    lastLessonId: null,
    updatedAt: "2026-08-20T10:00:00.000Z",
  };

  const liveEvent: CourseEvent = {
    id: "event-1",
    courseId: "course-ec",
    courseSlug: "effective-communication",
    courseTitle: "Effective Communication",
    ownerId: "teacher-1",
    title: "Live Q&A",
    description: "",
    type: "live_class",
    status: "scheduled",
    startsAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
    externalUrl: "https://meet.example.com/live",
    recordingAssetId: null,
  };

  // Already ordered from newest to oldest, as the source returns them.
  const notifications: AppNotification[] = [
    {
      id: "n1",
      type: "community_reply",
      title: "Ana replied to your post",
      body: "",
      read: false,
      link: "/learn/community/effective-communication?post=1",
      createdAt: "2026-09-02T08:00:00.000Z",
    },
    {
      id: "n2",
      type: "course_message",
      title: "Message from your teacher",
      body: "",
      read: false,
      link: "/learn/courses/effective-communication",
      createdAt: "2026-09-01T08:00:00.000Z",
    },
    {
      id: "n3",
      type: "certificate",
      title: "Certificate issued",
      body: "",
      read: true,
      link: "/learn/credentials",
      createdAt: "2026-08-30T08:00:00.000Z",
    },
    {
      id: "n4",
      type: "enrollment",
      title: "Older notification",
      body: "",
      read: true,
      link: null,
      createdAt: "2026-08-01T08:00:00.000Z",
    },
  ];

  const fixtures = {
    course,
    base: [inProgress, completed],
    enrollments: [inProgress, completed],
    notifications,
    liveEvent,
    events: [liveEvent] as CourseEvent[],
    // Real courses the database returns when the dashboard asks by id.
    realCourses: [] as Course[],
    fetchedIds: [] as string[][],
    emitEnrollments: (() => undefined) as (next: Enrollment[]) => void,
    enrollmentsFail: false,
    reloads: 0,
    calls: 0,
  };

  // Fuse: a synchronous render loop does not trip the vitest timeout, it eats
  // memory until the process dies. Above 20 subscriptions in one test the mock
  // blows up with a readable message instead of vanishing.
  function fuse() {
    fixtures.calls += 1;
    if (fixtures.calls > 20) {
      throw new Error("subscription loop: more than 20 subscribe calls in one test");
    }
  }

  return { mockUser, fixtures, fuse };
});

// The I18nProvider calls useRouter() for the refresh when the language changes.
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/navigation")>(),
  useRouter: () => router,
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ user: mockUser, status: "authenticated" }),
}));

vi.mock("@/components/learn/welcome-tour", () => ({
  WelcomeTour: () => null,
}));

// Shows what the dashboard passes down to the rows: the course list is a single one.
vi.mock("@/components/learn/learning-paths-rows", () => ({
  LearningPathsRows: ({ enrolledCourses }: { enrolledCourses: { id: string }[] }) => (
    <div>Learning paths: {enrolledCourses.map((course) => course.id).join(",")}</div>
  ),
}));

vi.mock("@/lib/data/catalog", () => ({
  getCourseBySlug: (slug: string) =>
    slug === fixtures.course.slug ? fixtures.course : undefined,
}));

vi.mock("@/lib/data/published-courses", () => ({
  fetchCoursesByIds: async (ids: string[]) => {
    fuse();
    fixtures.fetchedIds.push(ids);
    return fixtures.realCourses.filter((course) => ids.includes(course.id));
  },
  teacherCourseToLearningCourse: (course: unknown) => course,
}));

vi.mock("@/lib/data/enrollments", () => ({
  subscribeToUserEnrollments: (
    _uid: string,
    onData: (enrollments: Enrollment[]) => void,
    onError: (error: Error) => void,
  ) => {
    fuse();
    fixtures.emitEnrollments = onData;
    const read = () => {
      if (fixtures.enrollmentsFail) onError(new Error("offline"));
      else onData(fixtures.enrollments);
    };
    read();
    // Like the real one: `reload` reads again without touching the channel.
    return Object.assign(() => undefined, {
      reload: async () => {
        fixtures.reloads += 1;
        read();
      },
    });
  },
}));

// Extra active enrollments, older than the Effective Communication one.
function extraEnrollments(count: number): Enrollment[] {
  return Array.from({ length: count }, (_, index) => ({
    ...fixtures.base[0],
    id: `extra-${index}`,
    courseId: `extra-${index}`,
    courseSlug: `extra-${index}`,
    courseTitle: `Extra Course ${index}`,
    lastLessonId: null,
    updatedAt: "2026-07-01T10:00:00.000Z",
  }));
}

vi.mock("@/lib/data/notifications", () => ({
  subscribeToNotifications: (
    _uid: string,
    onData: (notifications: AppNotification[]) => void,
  ) => {
    fuse();
    onData(fixtures.notifications);
    return () => undefined;
  },
}));

vi.mock("@/lib/data/course-events", () => ({
  subscribeToCourseEvents: (
    courseSlug: string,
    onData: (events: CourseEvent[]) => void,
  ) => {
    fuse();
    onData(fixtures.events.filter((event) => event.courseSlug === courseSlug));
    return () => undefined;
  },
}));

describe("LearnDashboard", () => {
  beforeEach(() => {
    fixtures.calls = 0;
    fixtures.events = [fixtures.liveEvent];
    fixtures.enrollments = fixtures.base;
    fixtures.realCourses = [];
    fixtures.fetchedIds = [];
    fixtures.enrollmentsFail = false;
    fixtures.reloads = 0;
  });

  it("if the enrollments do not load: an announced error and 'Try again' as the main action, which reads again", async () => {
    fixtures.enrollmentsFail = true;
    render(<LearnDashboard />);

    expect(await screen.findByRole("alert")).toHaveTextContent("We could not load your enrolled courses.");
    const retry = screen.getByRole("button", { name: "Try again" });
    expect(retry).toHaveClass("button-solid");
    expect(screen.getByRole("link", { name: "Explore courses" })).toHaveClass("button-outline");

    fixtures.enrollmentsFail = false;
    await act(async () => {
      fireEvent.click(retry);
    });
    expect(fixtures.reloads).toBe(1);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(await screen.findByRole("heading", { name: "My courses" })).toBeInTheDocument();
  });

  it("greets once only: one h1 and no 'Welcome back'", async () => {
    render(<LearnDashboard />);

    const headings = await screen.findAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent("Hi, Patrick");
    expect(screen.queryByText(/welcome back/i)).not.toBeInTheDocument();
    // The three metrics became one line of text.
    expect(
      screen.getByText("1 course in progress · 1 live session this week"),
    ).toBeInTheDocument();
  });

  it("a section title does not use the display serif — Manrope 600, card size", async () => {
    // Cormorant is a DISPLAY serif: at 24px, inside a card, it
    // disappears — it becomes "almost the body text", only lighter.
    fixtures.enrollments = [...fixtures.base, ...extraEnrollments(2)];
    render(<LearnDashboard />);

    for (const name of ["Continue watching", "My courses"]) {
      const heading = await screen.findByRole("heading", { name });
      expect(heading).not.toHaveClass("display-title");
      expect(heading.className).toContain("font-semibold");
    }
  });

  it("'Continue watching' opens on the lesson after the last completed one — the same destination as the card in 'My courses'", async () => {
    fixtures.enrollments = [...fixtures.base, ...extraEnrollments(2)];
    render(<LearnDashboard />);

    const region = await screen.findByRole("region", { name: "Continue watching" });
    const link = within(region).getByRole("link", { name: /Effective Communication/ });
    // lastLessonId = l3 is the last COMPLETED lesson; resume is l4. Before, the
    // card opened l3 again — the person rewatched what they had just finished.
    expect(link).toHaveAttribute(
      "href",
      "/learn/courses/effective-communication?lesson=l4",
    );
    // l4 is the second lesson of module 2; only it is left (10).
    expect(
      within(region).getByText("Module 2 · Lesson 2 · 10 min left"),
    ).toBeInTheDocument();
    // A completed course does not enter the resume queue.
    expect(within(region).queryByText("Brand Design Atelier")).not.toBeInTheDocument();

    // The same course in "My courses" leads to the same place, not the cover.
    const card = within(screen.getByRole("region", { name: "My courses" }))
      .getByRole("heading", { level: 3, name: "Effective Communication" })
      .closest("a") as HTMLElement;
    expect(card).toHaveAttribute(
      "href",
      "/learn/courses/effective-communication?lesson=l4",
    );
  });

  it("with up to 3 courses, 'Continue watching' does not repeat what 'My courses' already shows", async () => {
    render(<LearnDashboard />);

    const region = await screen.findByRole("region", { name: "My courses" });
    expect(
      screen.queryByRole("region", { name: "Continue watching" }),
    ).not.toBeInTheDocument();
    // The "My courses" card inherits the resume destination.
    const card = within(region)
      .getByRole("heading", { level: 3, name: "Effective Communication" })
      .closest("a") as HTMLElement;
    expect(card).toHaveAttribute(
      "href",
      "/learn/courses/effective-communication?lesson=l4",
    );
  });

  it("the whole card is the link: no 'Open' button, progress said once, a badge only when out of the ordinary", async () => {
    render(<LearnDashboard />);

    const region = await screen.findByRole("region", { name: "My courses" });
    // Before: a full "Open" button per card.
    expect(within(region).queryByRole("link", { name: "Open" })).not.toBeInTheDocument();

    const active = within(region)
      .getByRole("heading", { level: 3, name: "Effective Communication" })
      .closest("a") as HTMLElement;
    // "50%" once (the number next to the bar), with no visible "50% COMPLETE".
    expect(within(active).getAllByText("50%")).toHaveLength(1);
    // Active is the normal state: no "Active" badge; in its place, where the person stopped.
    expect(within(active).queryByText("Active")).not.toBeInTheDocument();
    expect(within(active).getByText("Module 2 · Lesson 2")).toBeInTheDocument();

    const done = within(region)
      .getByRole("heading", { level: 3, name: "Brand Design Atelier" })
      .closest("a") as HTMLElement;
    expect(within(done).getByText("Completed")).toBeInTheDocument();
  });

  it("a refunded enrollment does not become a link: a stopped card with the status badge", async () => {
    fixtures.enrollments = [{ ...fixtures.base[0], status: "refunded" }];
    render(<LearnDashboard />);

    const region = await screen.findByRole("region", { name: "My courses" });
    const title = within(region).getByRole("heading", { level: 3, name: "Effective Communication" });
    expect(title.closest("a")).toBeNull();
    expect(within(title.closest("article") as HTMLElement).getByText("Refunded")).toBeInTheDocument();
  });

  it("an empty 'What's new' does not show and does not push 'My courses' down", async () => {
    const saved = fixtures.notifications;
    fixtures.notifications = [];
    try {
      render(<LearnDashboard />);
      await screen.findByRole("region", { name: "My courses" });
      expect(screen.queryByRole("region", { name: "What's new" })).not.toBeInTheDocument();
      expect(screen.queryByText("Nothing new yet.")).not.toBeInTheDocument();
    } finally {
      fixtures.notifications = saved;
    }
  });

  it("a course outside the public catalog still resumes on the lesson: the dashboard fetches only the person's courses, by id, once", async () => {
    // Unpublished, or beyond the 200 the catalog downloaded: before, the card
    // never found the course and opened the generic cover.
    const purchase: Enrollment = {
      ...fixtures.base[0],
      id: "enrollment-real",
      courseId: "course-real",
      // The Stripe webhook writes the id in course_slug.
      courseSlug: "course-real",
      courseTitle: "Private Coaching Lab",
      lastLessonId: "r1",
    };
    fixtures.enrollments = [purchase];
    fixtures.realCourses = [
      {
        ...fixtures.course,
        id: "course-real",
        slug: "course-real",
        modules: [
          {
            id: "rm",
            title: "Only module",
            summary: "",
            lessons: [
              { id: "r1", title: "One", type: "video", duration: "5 min", isPreview: false },
              { id: "r2", title: "Two", type: "video", duration: "5 min", isPreview: false },
            ],
          },
        ],
      },
    ];
    render(<LearnDashboard />);

    const region = await screen.findByRole("region", { name: "My courses" });
    await waitFor(() =>
      expect(within(region).getByRole("link", { name: /Private Coaching Lab/ })).toHaveAttribute(
        "href",
        "/learn/courses/course-real?lesson=r2",
      ),
    );
    expect(fixtures.fetchedIds).toEqual([["course-real"]]);
    // The same list goes down to the rows below, with no second fetch.
    expect(screen.getByText("Learning paths: course-real")).toBeInTheDocument();

    // Saved progress re-emits the enrollments; the courses are the same, so
    // nothing is downloaded again.
    act(() => fixtures.emitEnrollments([{ ...purchase, progressPercent: 60 }]));
    expect(fixtures.fetchedIds).toEqual([["course-real"]]);
  });

  it("with few courses there is no search or filter, and the completed one shows together", async () => {
    render(<LearnDashboard />);

    const region = await screen.findByRole("region", { name: "My courses" });
    expect(within(region).queryByRole("group", { name: "Filter courses" })).not.toBeInTheDocument();
    expect(within(region).queryByRole("searchbox")).not.toBeInTheDocument();
    for (const name of ["Effective Communication", "Brand Design Atelier"]) {
      expect(
        within(region).getByRole("heading", { level: 3, name }),
      ).toBeInTheDocument();
    }
  });

  it("the Completed filter hides the in-progress one, and In progress is the default", async () => {
    // Search and filter only show with more than 6 courses.
    fixtures.enrollments = [...fixtures.base, ...extraEnrollments(5)];
    render(<LearnDashboard />);

    const region = await screen.findByRole("region", { name: "My courses" });
    expect(within(region).getByRole("searchbox")).toBeInTheDocument();
    expect(
      within(region).getByRole("heading", { level: 3, name: "Effective Communication" }),
    ).toBeInTheDocument();
    expect(
      within(region).queryByRole("heading", { level: 3, name: "Brand Design Atelier" }),
    ).not.toBeInTheDocument();

    fireEvent.click(within(region).getByRole("button", { name: "Completed" }));

    expect(
      within(region).getByRole("heading", { level: 3, name: "Brand Design Atelier" }),
    ).toBeInTheDocument();
    expect(
      within(region).queryByRole("heading", { level: 3, name: "Effective Communication" }),
    ).not.toBeInTheDocument();
    // A filter, not tabs: the choice goes on the button itself (aria-pressed).
    expect(within(region).getByRole("button", { name: "Completed" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("no 'Request refund' on the card, and the refund notice does not show on every visit", async () => {
    render(<LearnDashboard />);

    await screen.findByRole("region", { name: "My courses" });
    expect(screen.queryByRole("button", { name: /refund/i })).not.toBeInTheDocument();
    // No purchase inside the refund window: nothing to say.
    expect(
      screen.queryByRole("link", { name: "My purchases" }),
    ).not.toBeInTheDocument();
  });

  it("with a purchase still inside the refund window, it points to My purchases", async () => {
    fixtures.enrollments = [
      ...fixtures.base,
      {
        ...extraEnrollments(1)[0],
        progressPercent: 10,
        createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      },
    ];
    render(<LearnDashboard />);

    const region = await screen.findByRole("region", { name: "My courses" });
    expect(
      within(region).getByRole("link", { name: "My purchases" }),
    ).toHaveAttribute("href", "/account/billing?tab=purchases");
  });

  it("a recent subscription does not show the notice: it generates no order, there is nothing to refund in Purchases", async () => {
    fixtures.enrollments = [
      ...fixtures.base,
      {
        ...extraEnrollments(1)[0],
        source: "subscription",
        progressPercent: 10,
        createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      },
    ];
    render(<LearnDashboard />);

    await screen.findByRole("region", { name: "My courses" });
    expect(
      screen.queryByRole("link", { name: "My purchases" }),
    ).not.toBeInTheDocument();
  });

  it("a completed course opens on the members area cover, not on the last lesson", async () => {
    fixtures.enrollments = [
      {
        ...fixtures.base[0],
        status: "completed",
        progressPercent: 100,
        lastLessonId: "l4",
      },
    ];
    render(<LearnDashboard />);

    const region = await screen.findByRole("region", { name: "My courses" });
    expect(within(region).getByRole("link", { name: /Effective Communication/ })).toHaveAttribute(
      "href",
      "/learn/courses/effective-communication",
    );
  });

  it("shows the next live with 'Join' and the last three news items with a destination", async () => {
    render(<LearnDashboard />);

    const lives = await screen.findByRole("region", { name: "Upcoming lives" });
    expect(within(lives).getByText("Live Q&A")).toBeInTheDocument();
    expect(within(lives).getByRole("link", { name: "Join" })).toHaveAttribute(
      "href",
      "https://meet.example.com/live",
    );

    const news = screen.getByRole("region", { name: "What's new" });
    expect(
      within(news).getByRole("link", { name: /Ana replied to your post/ }),
    ).toHaveAttribute("href", "/learn/community/effective-communication?post=1");
    // The same destination as the bell (notificationHref): the teacher's message
    // opens the conversation, not the whole classroom.
    expect(
      within(news).getByRole("link", { name: /Message from your teacher/ }),
    ).toHaveAttribute("href", "/learn/messages?course=effective-communication");
    expect(within(news).getByText("Certificate issued")).toBeInTheDocument();
    // The fourth is left for the bell and the inbox.
    expect(within(news).queryByText("Older notification")).not.toBeInTheDocument();
  });

  it("with no live scheduled, the column disappears instead of spending half a line saying so, and the metric disappears", async () => {
    fixtures.events = [];
    render(<LearnDashboard />);

    await screen.findByRole("region", { name: "What's new" });
    expect(
      screen.queryByRole("region", { name: "Upcoming lives" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("1 course in progress")).toBeInTheDocument();
  });

  it.each(["javascript:void(0)", "data:text/plain,not-a-session", "ftp://example.com/live", "not a URL", ""])(
    "keeps the upcoming live details without a join link for invalid URL %j",
    async (externalUrl) => {
      fixtures.events = [{ ...fixtures.liveEvent, externalUrl }];
      render(<I18nProvider initialLocale="es"><LearnDashboard /></I18nProvider>);
      const lives = await screen.findByRole("region", { name: "Próximas sesiones en vivo" });
      expect(lives).toHaveTextContent("Live Q&A");
      expect(within(lives).queryByRole("link")).not.toBeInTheDocument();
      expect(lives).toHaveTextContent("Todavía no se agregó el enlace para entrar. Contacta a tu instructor.");
    },
  );

  // Before, the live left the dashboard the minute it started, taking the "Join" with it.
  it("a live that is happening stays on the dashboard, with 'Happening now' and 'Join'; one that ended leaves", async () => {
    fixtures.events = [
      { ...fixtures.liveEvent, id: "running", title: "Running Q&A", startsAt: new Date(Date.now() - 30 * 60_000).toISOString() },
      { ...fixtures.liveEvent, id: "over", title: "Finished Q&A", startsAt: new Date(Date.now() - 4 * 60 * 60_000).toISOString() },
    ];
    render(<LearnDashboard />);

    const lives = await screen.findByRole("region", { name: "Upcoming lives" });
    expect(within(lives).getByText("Running Q&A")).toBeInTheDocument();
    expect(within(lives).getByText("Happening now")).toBeInTheDocument();
    expect(within(lives).getByRole("link", { name: "Join" })).toHaveAttribute("href", "https://meet.example.com/live");
    expect(within(lives).queryByText("Finished Q&A")).not.toBeInTheDocument();
  });

  it("a deadline with no link says it is a due date, not 'link unavailable'", async () => {
    fixtures.events = [{ ...fixtures.liveEvent, type: "deadline", externalUrl: "" }];
    render(<LearnDashboard />);

    const lives = await screen.findByRole("region", { name: "Upcoming lives" });
    expect(lives).toHaveTextContent("This is a due date, not a meeting: there is nothing to join.");
    expect(lives).not.toHaveTextContent("The join link has not been added yet.");
  });

  // A deadline is not a live: no "Happening now" for 3 h after it is overdue.
  it("a deadline with a link: 'Due:' and 'Open link'; overdue, it leaves the dashboard without 'Happening now'", async () => {
    fixtures.events = [
      { ...fixtures.liveEvent, id: "due", title: "Essay due", type: "deadline" },
      { ...fixtures.liveEvent, id: "late", title: "Quiz due", type: "deadline", startsAt: new Date(Date.now() - 30 * 60_000).toISOString() },
    ];
    render(<LearnDashboard />);

    const lives = await screen.findByRole("region", { name: "Upcoming lives" });
    expect(within(lives).getByText(`Due: ${formatEventDateTime(fixtures.liveEvent.startsAt, "en")}`)).toBeInTheDocument();
    expect(within(lives).getByRole("link", { name: "Open link" })).toHaveAttribute("href", "https://meet.example.com/live");
    expect(within(lives).queryByRole("link", { name: "Join" })).not.toBeInTheDocument();
    expect(within(lives).queryByText("Quiz due")).not.toBeInTheDocument();
    expect(within(lives).queryByText("Happening now")).not.toBeInTheDocument();
  });

  it("preserves a valid HTTP upcoming link and trims surrounding whitespace", async () => {
    fixtures.events = [{ ...fixtures.liveEvent, externalUrl: "  http://example.com/live  " }];
    render(<LearnDashboard />);
    const lives = await screen.findByRole("region", { name: "Upcoming lives" });
    const join = within(lives).getByRole("link", { name: "Join" });
    expect(join).toHaveAttribute("href", "http://example.com/live");
    expect(join).toHaveAttribute("target", "_blank");
    expect(join).toHaveAttribute("rel", "noreferrer");
  });

  // The schedule left the student's sidebar (four fixed items); the path
  // to it sits at the top of My courses, in the same tab, with or without a live scheduled:
  // the lives that already passed are in /learn/events.
  it.each([
    ["com live marcada", true],
    ["sem live marcada", false],
  ])("the link to the whole schedule is always in view (%s)", async (_label, hasLive) => {
    if (!hasLive) fixtures.events = [];
    render(<LearnDashboard />);

    await screen.findByRole("region", { name: "What's new" });
    const all = screen.getByRole("link", { name: "See all live sessions" });
    expect(all).toHaveAttribute("href", "/learn/events");
    expect(all).not.toHaveAttribute("target");
    expect(Boolean(screen.queryByRole("region", { name: "Upcoming lives" }))).toBe(hasLive);
  });

  it("the next live's date comes out in the person's language", async () => {
    render(<I18nProvider initialLocale="es"><LearnDashboard /></I18nProvider>);

    expect(await screen.findByText(
      formatEventDateTime(fixtures.liveEvent.startsAt, "es"),
    )).toBeInTheDocument();
  });

  it("a name with $& in the greeting shows up literally, without becoming '{name}'", async () => {
    // In a replace without a callback, "$&" becomes the matched text ("{name}") and "$'" the
    // rest of the sentence. The name comes from the sign-up: it is the person's text, not ours.
    mockUser.displayName = "Mc$&Donald Simon";
    try {
      render(<LearnDashboard />);

      expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(
        "Hi, Mc$&Donald",
      );
    } finally {
      mockUser.displayName = "Patrick Simon";
    }
  });
});
