import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LessonListOverlay } from "@/components/learn/lesson-list-overlay";
import type { LessonUnlockState } from "@/domain/drip-policy";
import type { CourseModule, Lesson } from "@/domain/learning";

function lesson(id: string, title: string): Lesson {
  return {
    id,
    title,
    type: "video",
    duration: "10 min",
    isPreview: false,
  };
}

const modules: CourseModule[] = [
  {
    id: "m1",
    title: "Foundations",
    summary: "",
    lessons: [lesson("l1", "Welcome"), lesson("l2", "Setting the frame")],
  },
  {
    id: "m2",
    title: "Practice",
    summary: "",
    lessons: [lesson("l3", "First session"), lesson("l4", "Debrief")],
  },
];

const unlocked: LessonUnlockState = {
  unlocked: true,
  unlocksAt: null,
  reason: "available",
};

function renderOverlay(overrides: { onSelect?: () => void; onClose?: () => void } = {}) {
  const onSelect = overrides.onSelect ?? vi.fn();
  const onClose = overrides.onClose ?? vi.fn();

  render(
    <LessonListOverlay
      modules={modules}
      selectedLessonId="l1"
      completedLessonIds={["l1"]}
      unlockStateById={
        new Map(modules.flatMap((m) => m.lessons).map((l) => [l.id, unlocked]))
      }
      onSelect={onSelect}
      onClose={onClose}
    />,
  );

  return { onSelect, onClose };
}

describe("LessonListOverlay", () => {
  it("keeps thumbnails and locked labels while filtering and selecting a lesson", () => {
    const onSelect = vi.fn();
    const { container } = render(<LessonListOverlay
      modules={modules} selectedLessonId="l1" completedLessonIds={[]}
      unlockStateById={new Map([["l3", { ...unlocked, unlocked: false }]])}
      thumbnailUrlByLessonId={new Map([["l3", "/lesson-three.png"]])}
      onSelect={onSelect} onClose={() => {}}
    />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "First session" } });
    expect(container.querySelector('img[src="/lesson-three.png"]')).toHaveAttribute("alt", "");
    const lesson = screen.getByRole("button", { name: /First session/ });
    expect(lesson).toHaveTextContent("Locked");
    fireEvent.click(lesson);
    expect(onSelect).toHaveBeenCalledWith("l3");
  });
  it("lists every module's lessons, not just the active one", () => {
    renderOverlay();

    expect(screen.getByRole("dialog", { name: "All lessons" })).toBeInTheDocument();
    expect(screen.getByText("Debrief")).toBeInTheDocument();
    expect(screen.getByText("4 lessons in this course")).toBeInTheDocument();
  });

  it("keeps absolute lesson numbers while the search filters the list", () => {
    renderOverlay();

    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "debrief" },
    });

    expect(screen.queryByText("Welcome")).not.toBeInTheDocument();
    // "Debrief" is the 4th lesson of the course, and stays the 4th after filtering.
    expect(screen.getByRole("button", { name: /Debrief/ })).toHaveTextContent("4");
  });

  it("selects the lesson and closes", () => {
    const { onSelect, onClose } = renderOverlay();

    fireEvent.click(screen.getByRole("button", { name: /First session/ }));

    expect(onSelect).toHaveBeenCalledWith("l3");
    expect(onClose).toHaveBeenCalled();
  });
});
