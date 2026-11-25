import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CreatorMarketingHub } from "@/components/teacher/creator-marketing-hub";
import type { CourseMessage } from "@/domain/course-message";
import type { TeacherCourse } from "@/domain/teacher-course";

// What the person suffered: Marketing was a five-row list with no
// state — you could not tell if the storefront was live, how many messages
// were waiting for a reply or how many files were in media without opening each screen.
// These tests cover the real states of the cards and the case where the data does not
// exist: the card shows with no number, never with an invented number.

const mocks = vi.hoisted(() => {
  const course = (id: string, status: TeacherCourse["status"]): TeacherCourse => ({
    id,
    ownerId: "teacher-1",
    title: `Curso ${id}`,
    summary: "",
    category: "Facilitation & Group Work",
    categories: ["Facilitation & Group Work"],
    status,
    modules: [],
    lessonCount: 0,
    priceAmountMinor: null,
    currency: "USD",
    paymentType: "one_time",
  });

  const message = (id: string, senderId: string): CourseMessage => ({
    id,
    courseId: `course-${id}`,
    courseTitle: "Curso",
    studentId: `student-${id}`,
    studentName: "Aluna",
    teacherId: "teacher-1",
    senderId,
    body: "Ola",
    createdAt: "2026-09-01T10:00:00.000Z",
  });

  return {
    course,
    message,
    // The SAME object on every render: a new user per render resubscribes the
    // effects and loops.
    user: { uid: "teacher-1", displayName: "Ana", roles: ["teacher"] },
    subscribeToTeacherCourses: vi.fn(),
    subscribeToTeacherMessages: vi.fn(),
    countCourseAssets: vi.fn(),
    publicProfile: null as { username: string | null } | null,
  };
});

vi.mock("@/lib/data/user-profiles", () => ({
  getPublicProfile: async () => mocks.publicProfile,
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ user: mocks.user, status: "authenticated" }),
}));

vi.mock("@/lib/data/teacher-courses", () => ({
  subscribeToTeacherCourses: mocks.subscribeToTeacherCourses,
}));

vi.mock("@/lib/data/course-messages", () => ({
  subscribeToTeacherMessages: mocks.subscribeToTeacherMessages,
}));

vi.mock("@/lib/data/course-assets", () => ({
  countCourseAssets: mocks.countCourseAssets,
}));

function cardNamed(title: string) {
  return screen.getByRole("heading", { name: title, level: 3 }).closest("article")!;
}

describe("CreatorMarketingHub", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    mocks.subscribeToTeacherCourses.mockReset();
    mocks.subscribeToTeacherMessages.mockReset();
    mocks.countCourseAssets.mockReset();
  });

  function givenCourses(courses: TeacherCourse[]) {
    mocks.subscribeToTeacherCourses.mockImplementation(
      (_uid: string, onData: (list: TeacherCourse[]) => void) => {
        onData(courses);
        return vi.fn();
      },
    );
  }

  function givenMessages(messages: CourseMessage[]) {
    mocks.subscribeToTeacherMessages.mockImplementation(
      (_uid: string, onData: (list: CourseMessage[]) => void) => {
        onData(messages);
        return vi.fn();
      },
    );
  }

  it("shows the four cards with the real state of each one", async () => {
    givenCourses([mocks.course("c1", "published"), mocks.course("c2", "draft")]);
    // Two conversations: the learner's waits for a reply, the one the teacher answered does not.
    givenMessages([
      mocks.message("a", "student-a"),
      mocks.message("b", "teacher-1"),
    ]);
    mocks.countCourseAssets.mockResolvedValue(12);

    render(<CreatorMarketingHub />);

    expect(await screen.findByText("12 files")).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(4);

    const storefront = cardNamed("Storefront & product pages");
    expect(within(storefront).getByText("Published")).toBeInTheDocument();
    expect(
      within(storefront).getByRole("link", { name: /Open public page/ }),
    ).toHaveAttribute("href", "/instructors/teacher-1");

    expect(
      within(cardNamed("Buyer messages")).getByText("1 awaiting reply"),
    ).toBeInTheDocument();
    // Coupon lives in each product: the card leads to the product list and says
    // so on the button, instead of going through /teach/coupons (which only redirects).
    const coupons = cardNamed("Coupons & promotions");
    expect(within(coupons).getByText("Set per product")).toBeInTheDocument();
    expect(within(coupons).getByRole("link", { name: /Open your products/ })).toHaveAttribute("href", "/teach/builder");
    // "Integrations — See what's planned" used to land on Earnings: gone.
    expect(screen.queryByRole("heading", { name: "Integrations" })).toBeNull();
    expect(document.querySelector('a[href="/teach/integrations"], a[href="/teach/coupons"]')).toBeNull();
  });

  it("at zero, says the storefront is not published and that nothing is waiting for a reply", async () => {
    givenCourses([mocks.course("c1", "draft")]);
    givenMessages([]);
    mocks.countCourseAssets.mockResolvedValue(0);

    render(<CreatorMarketingHub />);

    expect(await screen.findByText("0 files")).toBeInTheDocument();
    expect(
      within(cardNamed("Storefront & product pages")).getByText("Not published yet"),
    ).toBeInTheDocument();
    expect(
      within(cardNamed("Buyer messages")).getByText("No reply pending"),
    ).toBeInTheDocument();
  });

  it("without the data, the card shows no number instead of inventing one", async () => {
    givenCourses([mocks.course("c1", "published")]);
    // The subscription fails: the error callback zeroes the loaded messages.
    mocks.subscribeToTeacherMessages.mockImplementation(
      (_uid: string, _onData: unknown, onError: () => void) => {
        onError();
        return vi.fn();
      },
    );
    mocks.countCourseAssets.mockRejectedValue(new Error("without permission"));

    render(<CreatorMarketingHub />);

    // The storefront card answers, so the screen has already rendered the state.
    expect(await screen.findByText("Published")).toBeInTheDocument();
    expect(screen.queryByText(/file(s)?$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/awaiting reply/)).not.toBeInTheDocument();
    expect(screen.queryByText("No reply pending")).not.toBeInTheDocument();
    // The card stays in the grid, just without a number.
    expect(cardNamed("Media library")).toBeInTheDocument();
    expect(cardNamed("Buyer messages")).toBeInTheDocument();
  });
  // The storefront link is what the creator pastes in the bio: /@user when there is an @.
  it("opens the storefront at the creator's @handle when the public profile has one", async () => {
    mocks.publicProfile = { username: "ana.souza" };
    givenCourses([mocks.course("c1", "published")]);
    givenMessages([]);
    mocks.countCourseAssets.mockResolvedValue(0);

    render(<CreatorMarketingHub />);

    const storefront = cardNamed("Storefront & product pages");
    await waitFor(() =>
      expect(within(storefront).getByRole("link", { name: /Open public page/ })).toHaveAttribute("href", "/@ana.souza"),
    );
    mocks.publicProfile = null;
  });
});
