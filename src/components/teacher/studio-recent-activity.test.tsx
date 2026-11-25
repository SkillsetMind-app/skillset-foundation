import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StudioRecentActivity } from "@/components/teacher/studio-recent-activity";
import type { TeacherCourse } from "@/domain/teacher-course";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";

// "What happened while I was not looking?" had no answer on Home: there were
// next steps, products and metrics, and no timeline. Here the
// four sources that already exist (sales, enrollments, reviews and questions)
// go into a single list, most recent first.

const mocks = vi.hoisted(() => ({
  orders: [] as unknown[],
  students: [] as unknown[],
  reviews: [] as unknown[],
  questions: [] as unknown[],
  locale: "en" as "en" | "es",
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ user: { uid: "teacher-1" } }),
}));

// The activity sentences stay fixed in English; the rest (the relative time)
// comes from the chosen language's dictionary, as in the real provider.
vi.mock("@/components/i18n/i18n-provider", () => ({
  useTranslation: () => ({
    locale: mocks.locale,
    t: (key: string) =>
      ({
        "teach.activity.title": "Recent activity",
        "teach.activity.sale": "New sale in {course}",
        "teach.activity.enrollment": "{name} enrolled in {course}",
        "teach.activity.review": "New {rating}-star review in {course}",
        "teach.activity.question": "{name} asked a question in {course}",
        "teach.activity.emptyTitle": "Nothing has happened yet.",
      })[key] ?? translate(getDictionary(mocks.locale), key),
  }),
}));

vi.mock("@/lib/data/orders", () => ({
  subscribeToTeacherOrders: (_uid: string, onData: (orders: unknown[]) => void) => {
    onData(mocks.orders);
    return () => undefined;
  },
}));

vi.mock("@/lib/data/enrollments", () => ({
  getMyCourseStudents: () => Promise.resolve(mocks.students),
}));

vi.mock("@/lib/data/course-reviews", () => ({
  getRecentCourseReviews: () => Promise.resolve(mocks.reviews),
}));

vi.mock("@/lib/data/community-posts", () => ({
  getRecentCommunityQuestions: () => Promise.resolve(mocks.questions),
}));

const courses = [
  { id: "course-1", title: "Hypnosis Basics", status: "published" },
] as TeacherCourse[];

function isoDaysAgo(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

beforeEach(() => {
  mocks.orders = [];
  mocks.students = [];
  mocks.reviews = [];
  mocks.questions = [];
  mocks.locale = "en";
});

afterEach(cleanup);

describe("Recent activity on the teacher Home", () => {
  it("a new teacher sees an honest empty state, not a grid of zeros", async () => {
    render(<StudioRecentActivity courses={[]} />);

    expect(await screen.findByText("Nothing has happened yet.")).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).toBeNull();
  });

  it("puts sale, enrollment, review and question in the same list, most recent first", async () => {
    mocks.orders = [
      {
        id: "order-1",
        status: "paid",
        courseId: "course-1",
        courseTitle: "Hypnosis Basics",
        paidAt: isoDaysAgo(3),
      },
      // An unpaid order is not an event: nobody bought anything.
      {
        id: "order-2",
        status: "pending",
        courseId: "course-1",
        courseTitle: "Hypnosis Basics",
        paidAt: isoDaysAgo(1),
      },
    ];
    mocks.students = [
      {
        enrollmentId: "enr-1",
        courseId: "course-1",
        courseTitle: "Hypnosis Basics",
        displayName: "Ana",
        enrolledAt: isoDaysAgo(1),
      },
    ];
    mocks.reviews = [
      { id: "rev-1", courseId: "course-1", rating: 5, createdAt: isoDaysAgo(4) },
    ];
    mocks.questions = [
      {
        id: "post-1",
        courseSlug: "course-1",
        authorName: "Bruno",
        createdAt: isoDaysAgo(2),
      },
    ];

    render(<StudioRecentActivity courses={courses} />);

    const items = await screen.findAllByRole("listitem");
    const lines = items.map((item) => item.textContent);

    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain("Ana enrolled in Hypnosis Basics");
    expect(lines[1]).toContain("Bruno asked a question in Hypnosis Basics");
    expect(lines[2]).toContain("New sale in Hypnosis Basics");
    expect(lines[3]).toContain("New 5-star review in Hypnosis Basics");
    expect(screen.queryByText("Nothing has happened yet.")).toBeNull();
  });

  it("each row leads to the screen that answers for that event", async () => {
    mocks.orders = [
      {
        id: "order-1",
        status: "paid",
        courseId: "course-1",
        courseTitle: "Hypnosis Basics",
        paidAt: isoDaysAgo(1),
      },
    ];

    render(<StudioRecentActivity courses={courses} />);

    expect(await screen.findByRole("link", { name: /New sale/ })).toHaveAttribute(
      "href",
      "/teach/sales/order-1",
    );
  });

  // The panel of ONE product gets the same list with a single course. Without the filter,
  // the sale and the enrollment of another product showed up in its activity: both
  // reads bring the whole store, only the reviews and the questions already came
  // filtered by course.
  it("shows only what happened in the courses it received, never in the whole store", async () => {
    mocks.orders = [
      {
        id: "order-2",
        status: "paid",
        courseId: "course-2",
        courseTitle: "Outro Produto",
        paidAt: isoDaysAgo(1),
      },
    ];
    mocks.students = [
      {
        enrollmentId: "enr-2",
        courseId: "course-2",
        courseTitle: "Outro Produto",
        displayName: "Ana",
        enrolledAt: isoDaysAgo(1),
      },
      {
        enrollmentId: "enr-1",
        courseId: "course-1",
        courseTitle: "Hypnosis Basics",
        displayName: "Bruno",
        enrolledAt: isoDaysAgo(2),
      },
    ];

    render(<StudioRecentActivity courses={courses} />);

    const items = await screen.findAllByRole("listitem");
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toContain("Bruno enrolled in Hypnosis Basics");
  });

  // The row called the time formatter without `t` or `locale`: in Spanish the
  // time of each event came out in English ("1d ago").
  it("shows the time of each event in the person's language", async () => {
    mocks.locale = "es";
    mocks.students = [
      {
        enrollmentId: "enr-1",
        courseId: "course-1",
        courseTitle: "Hypnosis Basics",
        displayName: "Ana",
        enrolledAt: isoDaysAgo(1),
      },
    ];

    render(<StudioRecentActivity courses={courses} />);

    const [item] = await screen.findAllByRole("listitem");
    expect(item).toHaveTextContent("Hace 1 d");
  });

  // In a replace without a callback, "$&" becomes the matched text ("{name}", "{course}")
  // and "$'" the rest of the sentence. A learner's name and a course title are the
  // person's text, not ours.
  it("a name or title with $& appears literally, without turning into '{name}' or '{course}'", async () => {
    mocks.students = [
      {
        enrollmentId: "enr-1",
        courseId: "course-1",
        courseTitle: "Hyp$&nosis",
        displayName: "Mc$&Donald",
        enrolledAt: isoDaysAgo(1),
      },
    ];

    render(<StudioRecentActivity courses={courses} />);

    const [item] = await screen.findAllByRole("listitem");
    expect(item).toHaveTextContent("Mc$&Donald enrolled in Hyp$&nosis");
  });
});
