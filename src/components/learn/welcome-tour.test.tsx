import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WelcomeTour } from "@/components/learn/welcome-tour";

const mocks = vi.hoisted(() => ({ dismiss: vi.fn() }));

// The hook decides whether the tour opens (and records that it was seen); here
// only the dialog is tested. The "seen" rule does not change in this file.
vi.mock("@/lib/ui/use-welcome-tour", () => ({
  useWelcomeTour: () => ({ open: true, dismiss: mocks.dismiss }),
}));

describe("learner WelcomeTour", () => {
  beforeEach(() => {
    mocks.dismiss.mockReset();
  });

  it("has a single skip control; Skip closes it", () => {
    render(<WelcomeTour userId="u-1" firstName="Ana" />);

    expect(screen.getAllByRole("button", { name: /skip/i })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(mocks.dismiss).toHaveBeenCalledTimes(1);
  });

  // Before, the text swapped and the dialog grew or shrank at every step, and
  // the buttons moved out from under the mouse. Now the four steps occupy the
  // same cell (the height is that of the longest) and only the current one is read.
  it("all steps reserve the height; only the current one shows, and focus goes to its title", () => {
    render(<WelcomeTour userId="u-1" firstName="Ana" />);

    expect(screen.getByText("Manage your account")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "Welcome, Ana" })).toBeInTheDocument();
    // On open, the dialog is what animates in; the 1st step's text does not animate again.
    expect(screen.getByRole("heading", { level: 2, name: "Welcome, Ana" }).parentElement).not.toHaveClass("motion-panel-in");

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    const second = screen.getByRole("heading", { level: 2, name: "Pick up where you left off" });
    expect(second).toHaveFocus();
    expect(second.parentElement).toHaveClass("motion-panel-in");
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "Pick up where you left off" })).toBeInTheDocument();

    // Going back to the 1st step removes "Back" from the screen: focus is not lost on it.
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: "Welcome, Ana" })).toHaveFocus();
  });
});
