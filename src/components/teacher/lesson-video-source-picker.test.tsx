import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LessonVideoSourcePicker } from "@/components/teacher/lesson-video-source-picker";

describe("LessonVideoSourcePicker", () => {
  it("renders exactly two source options and reflects the active source", () => {
    const { rerender } = render(
      <LessonVideoSourcePicker value="youtube" onChange={() => undefined} />,
    );

    const youtubeOption = screen.getByRole("button", { name: /YouTube link/i });
    const uploadOption = screen.getByRole("button", { name: /Video upload/i });

    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(youtubeOption).toHaveAttribute("aria-pressed", "true");
    expect(youtubeOption).toHaveClass("is-active");
    expect(uploadOption).toHaveAttribute("aria-pressed", "false");
    expect(uploadOption).not.toHaveClass("is-active");

    rerender(
      <LessonVideoSourcePicker value="upload" onChange={() => undefined} />,
    );

    expect(youtubeOption).toHaveAttribute("aria-pressed", "false");
    expect(youtubeOption).not.toHaveClass("is-active");
    expect(uploadOption).toHaveAttribute("aria-pressed", "true");
    expect(uploadOption).toHaveClass("is-active");
  });

  it("leaves both options inactive when no source is selected", () => {
    render(<LessonVideoSourcePicker value={null} onChange={() => undefined} />);

    expect(screen.getByRole("button", { name: /YouTube link/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: /Video upload/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("reports the selected source", () => {
    const onChange = vi.fn();
    render(<LessonVideoSourcePicker value={null} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: /YouTube link/i }));
    fireEvent.click(screen.getByRole("button", { name: /Video upload/i }));

    expect(onChange).toHaveBeenNthCalledWith(1, "youtube");
    expect(onChange).toHaveBeenNthCalledWith(2, "upload");
  });

  it("disables both options without reporting changes", () => {
    const onChange = vi.fn();
    render(
      <LessonVideoSourcePicker value="youtube" disabled onChange={onChange} />,
    );

    const options = screen.getAllByRole("button");
    expect(options).toHaveLength(2);

    for (const option of options) {
      expect(option).toBeDisabled();
      fireEvent.click(option);
    }

    expect(onChange).not.toHaveBeenCalled();
  });
});
