import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { CourseOverviewPanel } from "@/components/teacher/course-overview-panel";
import type { TeacherCourse } from "@/domain/teacher-course";
import { getMyCourseStudents } from "@/lib/data/enrollments";

// A leitura dos alunos falhava em silencio (so log): o esqueleto do painel
// pulsava para sempre. Agora a falha vira erro com "Try again", que le de novo.

const user = { uid: "teacher-1" };
vi.mock("@/components/auth/auth-provider", () => ({ useAuth: () => ({ user }) }));
vi.mock("@/components/teacher/studio-recent-activity", () => ({ StudioRecentActivity: () => null }));
vi.mock("@/lib/data/orders", () => ({ subscribeToTeacherOrders: () => () => undefined }));
vi.mock("@/lib/data/course-commerce", () => ({ subscribeToCourseCoupons: () => () => undefined }));
vi.mock("@/lib/data/course-assets", () => ({ fetchCourseAssets: async () => [] }));
vi.mock("@/lib/data/enrollments", () => ({ getMyCourseStudents: vi.fn() }));

const course = { id: "course-1", title: "Hypnosis Basics", status: "published", modules: [] } as unknown as TeacherCourse;

afterEach(cleanup);

it("a failed students read ends in an error with Try again, never an endless skeleton", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.mocked(getMyCourseStudents).mockRejectedValueOnce(new Error("network"));
  render(<CourseOverviewPanel course={course} />);

  expect(await screen.findByRole("alert")).toHaveTextContent("Could not load your students");
  expect(screen.queryByTestId("course-overview-loading")).toBeNull();

  vi.mocked(getMyCourseStudents).mockResolvedValueOnce([]);
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("No one has bought this product yet.")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(getMyCourseStudents).toHaveBeenCalledTimes(2);
});
