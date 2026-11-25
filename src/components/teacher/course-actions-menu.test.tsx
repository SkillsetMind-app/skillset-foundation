import { fireEvent, render, screen } from "@testing-library/react";
import { MoreHorizontal } from "lucide-react";
import { describe, expect, it, vi } from "vitest";

import { CourseActionsMenu } from "@/components/teacher/course-actions";

vi.mock("@/lib/data/teacher-courses", () => ({
  deleteOrArchiveCourse: vi.fn(),
  getCourseAudience: vi.fn(),
}));

// The ⋮ menu said role="menu", but focus stayed on the trigger and the arrows did
// nothing: only Tab moved through the items.
describe("CourseActionsMenu on the keyboard", () => {
  function renderMenu() {
    render(
      <>
        <CourseActionsMenu courseTitle="Stress Reset" icon={MoreHorizontal}>
          <a href="/edit" role="menuitem">Edit</a>
          <a href="/preview" role="menuitem">View as student</a>
          <button type="button" role="menuitem">Delete</button>
        </CourseActionsMenu>
        <button type="button">Next on the page</button>
      </>,
    );
    const trigger = screen.getByRole("button", { name: /Stress Reset/ });
    fireEvent.click(trigger);
    return trigger;
  }

  it("opens with focus on the 1st item; arrows, Home and End move and wrap around", () => {
    renderMenu();
    const [edit, preview, remove] = screen.getAllByRole("menuitem");
    expect(edit).toHaveFocus();
    fireEvent.keyDown(edit, { key: "ArrowDown" });
    expect(preview).toHaveFocus();
    fireEvent.keyDown(preview, { key: "End" });
    expect(remove).toHaveFocus();
    fireEvent.keyDown(remove, { key: "ArrowDown" });
    expect(edit).toHaveFocus();
    fireEvent.keyDown(edit, { key: "ArrowUp" });
    expect(remove).toHaveFocus();
    fireEvent.keyDown(remove, { key: "Home" });
    expect(edit).toHaveFocus();
  });

  it("Tab out of the menu closes it; moving between items does not", () => {
    const trigger = renderMenu();
    const [edit, preview] = screen.getAllByRole("menuitem");
    fireEvent.focusOut(edit, { relatedTarget: preview });
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.focusOut(preview, { relatedTarget: trigger });
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.focusOut(preview, { relatedTarget: screen.getByRole("button", { name: "Next on the page" }) });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("Esc closes and returns focus to the trigger", () => {
    const trigger = renderMenu();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
