import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ClassroomLoading } from "@/components/learn/classroom-loading";

// The panel's "Continue" (?lesson=) went through three shapes in a single wait: the
// route file and the Suspense fallback with the tall cover block (~400px),
// then the workspace with 52px, then the real header. Now whoever reads the
// address passes `short` through by lesson; whoever does not read it stays on the short one (the most
// common path), and the wait has ONE shape until the header arrives.
const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

function topBlock(container: HTMLElement) {
  return container.querySelector("section > div") as HTMLElement;
}

describe("the classroom wait has a single shape", () => {
  it("short: the top block has the height of the short header", () => {
    const { container } = render(<ClassroomLoading label="Loading course..." short />);
    expect(topBlock(container)).toHaveClass("h-[52px]");
    expect(screen.getByRole("status")).toHaveTextContent("Loading course...");
  });

  it("without `short`: the top block has the height of the cover", () => {
    const { container } = render(<ClassroomLoading label="Loading course..." />);
    expect(topBlock(container).className).toContain("min-h-[clamp(300px,min(43vw,48svh),520px)]");
  });

  it("whoever does not read the address uses the short form; the workspaces decide by the lesson in the address", () => {
    expect(source("src/app/learn/courses/[slug]/loading.tsx")).toMatch(/<ClassroomLoading label=\{[^}]+\} short \/>/);
    expect(source("src/components/learn/learn-course-page.tsx")).toMatch(/<ClassroomLoading label=\{[^}]+\} short \/>/);
    expect(source("src/components/learn/creator-course-workspace.tsx")).toContain(
      'short={Boolean(searchParams.get("lesson")) && tab !== "about"}',
    );
    expect(source("src/components/learn/enrolled-course-workspace.tsx")).toContain(
      'short={Boolean(lessonParam) && !previewMode && tab !== "about"}',
    );
  });
});
