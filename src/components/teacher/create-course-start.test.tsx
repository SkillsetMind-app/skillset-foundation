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

function selectPrimaryCategory() {
  fireEvent.click(screen.getByRole("button", { name: /Select up to 5 categories/i }));
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: "Clinical Psychology & Approaches",
    })
  );
}

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

    fireEvent.click(screen.getByRole("button", { name: /Subscription/i }));
    fireEvent.click(screen.getByRole("button", { name: interval }));
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    fireEvent.change(screen.getByLabelText("Product title"), {
      target: { value: "Clinical performance foundations" },
    });
    fireEvent.change(screen.getByLabelText(/Product promise/), {
      target: {
        value: "Build a repeatable practice for evidence-informed performance work.",
      },
    });
    selectPrimaryCategory();
    fireEvent.click(screen.getByRole("button", { name: /Create and set pricing/i }));

    await waitFor(() => {
      expect(mocks.createTeacherCourse).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerId: "teacher-1",
          paymentType,
        })
      );
    });
    expect(mocks.push).toHaveBeenCalledWith("/teach/builder?courseId=course-123&tab=pricing");
  });

  it("keeps free products out of the pricing step", async () => {
    render(<CreateCourseStart ownerId="teacher-1" />);

    fireEvent.click(screen.getByRole("button", { name: /Free program/i }));
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    fireEvent.change(screen.getByLabelText("Product title"), {
      target: { value: "Open clinical toolkit" },
    });
    fireEvent.change(screen.getByLabelText(/Product promise/), {
      target: { value: "Use a practical set of open exercises with your clients." },
    });
    selectPrimaryCategory();
    fireEvent.click(screen.getByRole("button", { name: /Create and add content/i }));

    await waitFor(() => {
      expect(mocks.createTeacherCourse).toHaveBeenCalledWith(
        expect.objectContaining({ paymentType: "free" })
      );
    });
    expect(mocks.push).toHaveBeenCalledWith("/teach/builder?courseId=course-123&tab=content");
  });

  it("creates a recurring community product with its members community enabled", async () => {
    render(<CreateCourseStart ownerId="teacher-1" />);

    fireEvent.click(screen.getByRole("button", { name: /Community/i }));
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    fireEvent.change(screen.getByLabelText("Product title"), {
      target: { value: "Clinical supervision community" },
    });
    fireEvent.change(screen.getByLabelText(/Product promise/), {
      target: {
        value: "Create a protected peer space for recurring clinical supervision.",
      },
    });
    selectPrimaryCategory();
    fireEvent.click(screen.getByRole("button", { name: /Create and set pricing/i }));

    await waitFor(() => {
      expect(mocks.createTeacherCourse).toHaveBeenCalledWith(
        expect.objectContaining({
          paymentType: "subscription_monthly",
          communityEnabled: true,
        })
      );
    });
    expect(mocks.push).toHaveBeenCalledWith("/teach/builder?courseId=course-123&tab=pricing");
  });

  it("creates an event product before opening its linked scheduling form", async () => {
    render(<CreateCourseStart ownerId="teacher-1" initialFormat="event" />);

    expect(screen.getByRole("button", { name: /Online event/i })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    fireEvent.change(screen.getByLabelText("Product title"), {
      target: { value: "Live clinical supervision intensive" },
    });
    fireEvent.change(screen.getByLabelText(/Product promise/), {
      target: { value: "Practice advanced supervision methods in a live facilitated cohort." },
    });
    selectPrimaryCategory();
    fireEvent.click(screen.getByRole("button", { name: /Create and schedule event/i }));

    await waitFor(() => {
      expect(mocks.createTeacherCourse).toHaveBeenCalledWith(
        expect.objectContaining({
          paymentType: "one_time",
          communityEnabled: false,
        })
      );
    });
    expect(mocks.push).toHaveBeenCalledWith("/teach/events?courseId=course-123&newEvent=1");
  });

  it("creates a guided program as a structured paid-content preset", async () => {
    render(<CreateCourseStart ownerId="teacher-1" />);

    fireEvent.click(screen.getByRole("button", { name: /Guided program/i }));
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    fireEvent.change(screen.getByLabelText("Product title"), {
      target: { value: "Eight-week resilience program" },
    });
    fireEvent.change(screen.getByLabelText(/Product promise/), {
      target: { value: "Follow a sequenced eight-week path of learning, practice, and reflection." },
    });
    selectPrimaryCategory();
    fireEvent.click(screen.getByRole("button", { name: /Create and set pricing/i }));

    await waitFor(() => {
      expect(mocks.createTeacherCourse).toHaveBeenCalledWith(
        expect.objectContaining({ paymentType: "one_time" }),
      );
    });
    expect(mocks.push).toHaveBeenCalledWith("/teach/builder?courseId=course-123&tab=pricing");
  });

  it("starts on format selection and keeps categories collapsed", () => {
    render(<CreateCourseStart ownerId="teacher-1" initialFormat="subscription" />);

    expect(screen.getByRole("button", { name: /Subscription/i })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.queryByRole("group", { name: /Course categories/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));

    expect(screen.getByRole("heading", { name: /Add the essential information/i })).toHaveFocus();

    const categoryTrigger = screen.getByRole("button", {
      name: /Select up to 5 categories/i,
    });
    expect(categoryTrigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(categoryTrigger);
    expect(screen.getByRole("group", { name: /Course categories/i })).toBeInTheDocument();
  });
});
