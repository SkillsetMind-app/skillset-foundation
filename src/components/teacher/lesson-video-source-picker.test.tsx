import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LessonVideoSourcePicker } from "@/components/teacher/lesson-video-source-picker";

type PickerProps = Parameters<typeof LessonVideoSourcePicker>[0];

function renderPicker(overrides: Partial<PickerProps> = {}) {
  const props: PickerProps = {
    value: null,
    accept: "video/*",
    externalUrl: "",
    embedStatus: "Paste a link when the video already lives outside SkillsetMind.",
    onChange: vi.fn(),
    onSelectFile: vi.fn(),
    onExternalUrlChange: vi.fn(),
    ...overrides,
  };

  render(<LessonVideoSourcePicker {...props} />);
  return props;
}

function videoFile(name = "lesson.mp4") {
  return new File(["video-bytes"], name, { type: "video/mp4" });
}

describe("LessonVideoSourcePicker", () => {
  it("renders the dropzone and the URL field immediately, with no source-choice step", () => {
    renderPicker();

    expect(screen.getByLabelText("Upload a lesson video")).toBeInTheDocument();
    expect(screen.getByText(/Drag & drop your video here/i)).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("https://www.youtube.com/watch?v=..."),
    ).toBeInTheDocument();
  });

  it("selects a dropped video file and switches the source to upload", () => {
    const props = renderPicker();
    const file = videoFile();

    fireEvent.drop(screen.getByText(/Drag & drop your video here/i), {
      dataTransfer: { files: [file] },
    });

    expect(props.onChange).toHaveBeenCalledWith("upload");
    expect(props.onSelectFile).toHaveBeenCalledWith(file);
  });

  it("ignores dropped non-video files", () => {
    const props = renderPicker();

    fireEvent.drop(screen.getByText(/Drag & drop your video here/i), {
      dataTransfer: {
        files: [new File(["x"], "notes.pdf", { type: "application/pdf" })],
      },
    });

    expect(props.onChange).not.toHaveBeenCalled();
    expect(props.onSelectFile).not.toHaveBeenCalled();
  });

  it("selects a browsed file through the hidden input", () => {
    const props = renderPicker();
    const file = videoFile();

    fireEvent.change(screen.getByLabelText("Upload a lesson video"), {
      target: { files: [file] },
    });

    expect(props.onChange).toHaveBeenCalledWith("upload");
    expect(props.onSelectFile).toHaveBeenCalledWith(file);
  });

  it("reports URL typing and switches the source to youtube only when needed", () => {
    const props = renderPicker();
    const urlInput = screen.getByPlaceholderText(
      "https://www.youtube.com/watch?v=...",
    );

    fireEvent.change(urlInput, {
      target: { value: "https://www.youtube.com/watch?v=abc" },
    });

    expect(props.onChange).toHaveBeenCalledWith("youtube");
    expect(props.onExternalUrlChange).toHaveBeenCalledWith(
      "https://www.youtube.com/watch?v=abc",
    );

    const activeProps = renderPicker({ value: "youtube" });
    const inputs = screen.getAllByPlaceholderText(
      "https://www.youtube.com/watch?v=...",
    );
    fireEvent.change(inputs[inputs.length - 1], {
      target: { value: "https://vimeo.com/123" },
    });

    expect(activeProps.onChange).not.toHaveBeenCalled();
    expect(activeProps.onExternalUrlChange).toHaveBeenCalledWith(
      "https://vimeo.com/123",
    );
  });

  it("shows the embed status label", () => {
    renderPicker({ embedStatus: "YouTube embed detected." });

    expect(screen.getByText("YouTube embed detected.")).toBeInTheDocument();
  });

  it("disables both inputs and ignores drops when disabled", () => {
    const props = renderPicker({ disabled: true });

    expect(screen.getByLabelText("Upload a lesson video")).toBeDisabled();
    expect(
      screen.getByPlaceholderText("https://www.youtube.com/watch?v=..."),
    ).toBeDisabled();

    fireEvent.drop(screen.getByText(/Drag & drop your video here/i), {
      dataTransfer: { files: [videoFile()] },
    });

    expect(props.onChange).not.toHaveBeenCalled();
    expect(props.onSelectFile).not.toHaveBeenCalled();
  });
});
