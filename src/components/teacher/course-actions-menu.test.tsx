import { fireEvent, render, screen } from "@testing-library/react";
import { MoreHorizontal } from "lucide-react";
import { describe, expect, it, vi } from "vitest";

import { CourseActionsMenu } from "@/components/teacher/course-actions";

vi.mock("@/lib/data/teacher-courses", () => ({
  deleteOrArchiveCourse: vi.fn(),
  getCourseAudience: vi.fn(),
}));

// O menu ⋮ dizia role="menu", mas o foco ficava no gatilho e as setas não
// faziam nada: só o Tab andava pelos itens.
describe("CourseActionsMenu no teclado", () => {
  function renderMenu() {
    render(
      <CourseActionsMenu courseTitle="Stress Reset" icon={MoreHorizontal}>
        <a href="/edit" role="menuitem">Edit</a>
        <a href="/preview" role="menuitem">View as student</a>
        <button type="button" role="menuitem">Delete</button>
      </CourseActionsMenu>,
    );
    const trigger = screen.getByRole("button", { name: /Stress Reset/ });
    fireEvent.click(trigger);
    return trigger;
  }

  it("abre com o foco no 1º item; setas, Home e End andam e dão a volta", () => {
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

  it("Esc fecha e devolve o foco ao gatilho", () => {
    const trigger = renderMenu();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
