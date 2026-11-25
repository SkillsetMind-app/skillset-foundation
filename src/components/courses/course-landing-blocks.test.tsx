import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CourseLandingBlocks } from "@/components/courses/course-landing-blocks";
import type { CourseLandingBlock } from "@/domain/course-landing";

afterEach(cleanup);

const blocks: CourseLandingBlock[] = [
  { kind: "hero", heading: "Stress Reset Program", subheading: "One line on who this is for.", imageUrl: null },
  { kind: "method", heading: "How I teach this", body: "Short daily practices." },
  { kind: "faq", heading: "Questions", items: [{ question: "How long does it take?", answer: "Ten minutes a day." }] },
  { kind: "cta", heading: "Ready to start?", body: "", buttonLabel: "Enrol now" },
];

// The opening block was a second h1 of up to 60px, bigger than the page
// title; the button was made by hand and the question used the browser triangle.
describe("CourseLandingBlocks: the site pieces, below the page title", () => {
  it.each(["classic", "bold"] as const)("in template %s, no block opens a second h1 or uses the display serif", (template) => {
    const { container } = render(<CourseLandingBlocks blocks={blocks} template={template} />);

    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 2 }).map((node) => node.textContent)).toEqual([
      "Stress Reset Program",
      "How I teach this",
      "Questions",
      "Ready to start?",
    ]);
    expect(container.querySelector("h2.display-title")).toBeNull();
  });

  it("the final block's button is the house button and still leads to the purchase", () => {
    const onEnrol = vi.fn();
    render(<CourseLandingBlocks blocks={blocks} template="classic" onEnrol={onEnrol} />);

    const button = screen.getByRole("button", { name: "Enrol now" });
    expect(button).toHaveClass("button-solid", "button-lg");
    // The teacher's label (up to 200 characters) wraps into lines that do not touch.
    expect(button).toHaveClass("whitespace-normal", "text-center", "leading-snug");
    fireEvent.click(button);
    expect(onEnrol).toHaveBeenCalledTimes(1);
  });

  it("the question opens and closes like the ones on /pricing, with the arrow in place of the triangle", () => {
    const { container } = render(<CourseLandingBlocks blocks={blocks} template="bold" />);

    const summary = screen.getByText("How long does it take?").closest("summary")!;
    expect(summary).toHaveClass("list-none");
    expect(summary.querySelector("svg")).not.toBeNull();
    expect(container.querySelector("details")).toHaveClass("[&_summary::-webkit-details-marker]:hidden");
  });
});
