import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { CourseOverviewPanel } from "@/components/teacher/course-overview-panel";
import type { TeacherCourse } from "@/domain/teacher-course";
import { getMyCourseStudents } from "@/lib/data/enrollments";

// Reading the learners failed silently (log only): the panel skeleton
// pulsed forever. Now the failure becomes an error with "Try again", which reads again.

// Changing the user object rereads the learners (the effect depends on it).
const viewer = vi.hoisted(() => ({ current: { uid: "teacher-1" } }));
vi.mock("@/components/auth/auth-provider", () => ({ useAuth: () => ({ user: viewer.current }) }));
vi.mock("@/components/teacher/studio-recent-activity", () => ({ StudioRecentActivity: () => null }));
vi.mock("@/lib/data/orders", () => ({ subscribeToTeacherOrders: () => () => undefined }));
vi.mock("@/lib/data/course-commerce", () => ({ subscribeToCourseCoupons: () => () => undefined }));
vi.mock("@/lib/data/course-assets", () => ({ fetchCourseAssets: async () => [] }));
vi.mock("@/lib/data/enrollments", () => ({ getMyCourseStudents: vi.fn() }));

const course = { id: "course-1", title: "Hypnosis Basics", status: "published", modules: [] } as unknown as TeacherCourse;
const emptyLine = "No one has bought this product yet.";

beforeEach(() => {
  vi.mocked(getMyCourseStudents).mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(cleanup);

it("a failed students read ends in an error with Try again, never an endless skeleton", async () => {
  vi.mocked(getMyCourseStudents).mockRejectedValueOnce(new Error("network"));
  render(<CourseOverviewPanel course={course} />);

  expect(await screen.findByRole("alert")).toHaveTextContent("Could not load your students");
  expect(screen.queryByTestId("course-overview-loading")).toBeNull();

  vi.mocked(getMyCourseStudents).mockResolvedValueOnce([]);
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText(emptyLine)).toBeInTheDocument();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(getMyCourseStudents).toHaveBeenCalledTimes(2);
});

// A good read clears the previous failure, and a reread that fails does not replace
// the numbers already on the screen with the error.
it("a later good read clears the error, and a later failed read keeps the numbers", async () => {
  vi.mocked(getMyCourseStudents).mockRejectedValueOnce(new Error("network"));
  const { rerender } = render(<CourseOverviewPanel course={course} />);
  await screen.findByRole("alert");

  vi.mocked(getMyCourseStudents).mockResolvedValueOnce([]);
  viewer.current = { uid: "teacher-1" };
  rerender(<CourseOverviewPanel course={course} />);
  expect(await screen.findByText(emptyLine)).toBeInTheDocument();
  expect(screen.queryByRole("alert")).toBeNull();

  vi.mocked(getMyCourseStudents).mockRejectedValueOnce(new Error("network"));
  viewer.current = { uid: "teacher-1" };
  rerender(<CourseOverviewPanel course={course} />);
  await waitFor(() => expect(getMyCourseStudents).toHaveBeenCalledTimes(3));
  await act(async () => undefined);
  expect(screen.getByText(emptyLine)).toBeInTheDocument();
  expect(screen.queryByRole("alert")).toBeNull();
});
