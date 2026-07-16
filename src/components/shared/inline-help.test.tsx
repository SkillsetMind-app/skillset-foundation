import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { InlineHelp } from "@/components/shared/inline-help";

describe("InlineHelp", () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function close() {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    };
  });

  it("opens contextual guidance in a labelled modal and restores trigger focus", () => {
    render(
      <InlineHelp topic="Course categories" href="/help#course-categories">
        Choose the subjects learners will use to find this course.
      </InlineHelp>,
    );

    const trigger = screen.getByRole("button", {
      name: "Help about Course categories",
    });
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Course categories" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveTextContent(
      "Choose the subjects learners will use to find this course.",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Close contextual help" }),
    );

    expect(
      screen.queryByRole("dialog", { name: "Course categories" }),
    ).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
