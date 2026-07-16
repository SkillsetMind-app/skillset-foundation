import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CourseCategorySelect } from "@/components/teacher/course-category-select";

const options = [
  "Clinical Psychology & Approaches",
  "Hypnotherapy",
  "Mental Health Foundations",
] as const;

describe("CourseCategorySelect", () => {
  it("opens on demand, reports selections, and closes on Escape", () => {
    const onToggle = vi.fn();
    render(
      <CourseCategorySelect
        options={options}
        selected={["Hypnotherapy"]}
        onToggle={onToggle}
      />,
    );

    const trigger = screen.getByRole("button", { name: /Hypnotherapy/i });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("group", { name: "Course categories" })).toBeNull();

    fireEvent.click(trigger);
    expect(screen.getByRole("group", { name: "Course categories" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Hypnotherapy" })).toBeDisabled();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Mental Health Foundations" }),
    );
    expect(onToggle).toHaveBeenCalledWith("Mental Health Foundations");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("group", { name: "Course categories" })).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("keeps legacy selections removable and enforces the selection cap", () => {
    const onToggle = vi.fn();
    render(
      <CourseCategorySelect
        options={options}
        selected={["Psychology", "Hypnotherapy"]}
        onToggle={onToggle}
        max={2}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Psychology/i }));

    expect(screen.getByRole("checkbox", { name: "Psychology" })).toBeEnabled();
    expect(
      screen.getByRole("checkbox", { name: "Clinical Psychology & Approaches" }),
    ).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", { name: "Psychology" }));
    expect(onToggle).toHaveBeenCalledWith("Psychology");
  });
});
