import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  CourseCover,
  CourseUnlockModal,
} from "@/components/learn/course-unlock-modal";
import type { TeacherCourse } from "@/domain/teacher-course";

function course(overrides: Partial<TeacherCourse> = {}): TeacherCourse {
  return {
    id: "course-1",
    ownerId: "teacher-1",
    title: "Deep Focus Systems",
    summary: "Build a repeatable focus practice.",
    category: "Performance",
    status: "published",
    modules: [],
    lessonCount: 12,
    ...overrides,
  };
}

describe("CourseUnlockModal", () => {
  it("renders nothing until a locked course is picked", () => {
    const { container } = render(
      <CourseUnlockModal course={null} onClose={() => {}} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("sends the student to the course purchase page, priced", () => {
    render(
      <CourseUnlockModal
        course={course({ priceAmountMinor: 24900, currency: "USD" })}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText("Deep Focus Systems")).toBeInTheDocument();
    // The popup owns no checkout logic — /courses/[id] does.
    const cta = screen.getByRole("link", { name: /Unlock course/ });
    expect(cta).toHaveAttribute("href", "/courses/course-1");
    expect(cta).toHaveTextContent("$249.00");
  });

  it("with an anchor ctaHref it stays on the page: closes, then scrolls to the target", () => {
    const onClose = vi.fn();
    const target = document.createElement("aside");
    target.id = "enroll-card";
    target.scrollIntoView = vi.fn();
    document.body.appendChild(target);
    const frame = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 0;
    });
    render(
      <CourseUnlockModal
        course={course()}
        onClose={onClose}
        ctaHref="#enroll-card"
        secondaryLink={{ href: "/learn", label: "Back to my learning" }}
      />,
    );

    const cta = screen.getByRole("link", { name: /Unlock course/ });
    expect(cta).toHaveAttribute("href", "#enroll-card");
    fireEvent.click(cta);
    expect(onClose).toHaveBeenCalledOnce();
    expect(target.scrollIntoView).toHaveBeenCalledOnce();
    expect(screen.getByRole("link", { name: "Back to my learning" })).toHaveAttribute("href", "/learn");

    frame.mockRestore();
    target.remove();
  });

  it("closes on Escape so the dashboard is never trapped behind it", () => {
    const onClose = vi.fn();
    render(<CourseUnlockModal course={course()} onClose={onClose} />);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalled();
  });
});

describe("CourseCover", () => {
  it("falls back to a designed placeholder when the course has no artwork", () => {
    const { container } = render(
      <CourseCover course={course({ coverImageUrl: null })} sizes="240px" />,
    );

    expect(container.querySelector("img")).toBeNull();
    // Course initial, so a row of coverless courses still reads as curated.
    expect(screen.getByText("D")).toBeInTheDocument();
  });
});
