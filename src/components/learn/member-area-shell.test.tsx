import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MemberAreaShell } from "@/components/learn/member-area-shell";

describe("MemberAreaShell", () => {
  it("puts the members theme on its own root so the --ma-* tokens cover the page", () => {
    const { container } = render(
      <MemberAreaShell theme="dark">
        <p>Lesson</p>
      </MemberAreaShell>,
    );

    expect(
      container.querySelector('[data-members-theme="dark"]'),
    ).not.toBeNull();
  });

  it("hides every route back into the platform when the teacher is branded", () => {
    const { container } = render(
      <MemberAreaShell brand={{ name: "Atelier Curie" }}>
        <p>Lesson</p>
      </MemberAreaShell>,
    );

    expect(screen.getByText("Atelier Curie")).toBeInTheDocument();
    expect(screen.queryByText("Exit to dashboard")).toBeNull();
    expect(container.querySelector('a[href="/"]')).toBeNull();
  });

  it("only lets a sanitized hex accent reach the CSS custom property", () => {
    const { container, rerender } = render(
      <MemberAreaShell brand={{ name: "Atelier", accentColor: "#123456" }}>
        <p>Lesson</p>
      </MemberAreaShell>,
    );

    const root = () =>
      container.querySelector<HTMLElement>("[data-members-theme]");

    expect(root()?.style.getPropertyValue("--ma-accent")).toBe("#123456");

    rerender(
      <MemberAreaShell brand={{ name: "Atelier", accentColor: "javascript:x" }}>
        <p>Lesson</p>
      </MemberAreaShell>,
    );

    expect(root()?.style.getPropertyValue("--ma-accent")).toBe("");
  });
});
