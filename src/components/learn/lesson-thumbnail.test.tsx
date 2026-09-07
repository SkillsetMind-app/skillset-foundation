import { fireEvent, render } from "@testing-library/react";
import { expect, it } from "vitest";
import { LessonThumbnail } from "@/components/learn/lesson-thumbnail";

it("removes a failed decorative image and tries a replacement URL", () => {
  const { container, rerender } = render(<LessonThumbnail src="/first.png" />);
  const image = container.querySelector("img")!;
  expect(image).toHaveAttribute("alt", "");
  fireEvent.error(image);
  expect(container.querySelector("img")).toBeNull();
  rerender(<LessonThumbnail src="/second.png" />);
  expect(container.querySelector("img")).toHaveAttribute("src", "/second.png");
});
