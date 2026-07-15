import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CreateCourseStart } from "@/components/teacher/create-course-start";

const mocks = vi.hoisted(() => ({
  createTeacherCourse: vi.fn(),
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("@/lib/data/teacher-courses", () => ({
  createTeacherCourse: mocks.createTeacherCourse,
}));

describe("CreateCourseStart", () => {
  beforeEach(() => {
    mocks.createTeacherCourse.mockReset();
    mocks.createTeacherCourse.mockResolvedValue("course-123");
    mocks.push.mockReset();
  });

  it.each([
    ["Monthly", "subscription_monthly"],
    ["Yearly", "subscription_yearly"],
  ])("creates a %s subscription product and opens pricing", async (interval, paymentType) => {
    render(<CreateCourseStart ownerId="teacher-1" />);

    expect(screen.getAllByText("Product format")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: /Subscription/i }));
    fireEvent.click(screen.getByRole("button", { name: interval }));
    fireEvent.change(screen.getByLabelText("Course title"), {
      target: { value: "Clinical performance foundations" },
    });
    fireEvent.change(screen.getByLabelText(/Course promise/), {
      target: {
        value: "Build a repeatable practice for evidence-informed performance work.",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: /Create and set pricing/i }));

    await waitFor(() => {
      expect(mocks.createTeacherCourse).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerId: "teacher-1",
          paymentType,
        }),
      );
    });
    expect(mocks.push).toHaveBeenCalledWith(
      "/teach/builder?courseId=course-123&tab=pricing",
    );
  });

  it("keeps free products out of the pricing step", async () => {
    render(<CreateCourseStart ownerId="teacher-1" />);

    fireEvent.click(screen.getByRole("button", { name: /Free course/i }));
    fireEvent.change(screen.getByLabelText("Course title"), {
      target: { value: "Open clinical toolkit" },
    });
    fireEvent.change(screen.getByLabelText(/Course promise/), {
      target: { value: "Use a practical set of open exercises with your clients." },
    });
    fireEvent.click(screen.getByRole("button", { name: /Create and add content/i }));

    await waitFor(() => {
      expect(mocks.createTeacherCourse).toHaveBeenCalledWith(
        expect.objectContaining({ paymentType: "free" }),
      );
    });
    expect(mocks.push).toHaveBeenCalledWith(
      "/teach/builder?courseId=course-123&tab=content",
    );
  });
});
