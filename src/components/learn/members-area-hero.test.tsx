import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MembersAreaHero } from "@/components/learn/members-area-hero";

describe("MembersAreaHero", () => {
  it("renders the title and reflects the theme prop", () => {
    const { container } = render(
      <MembersAreaHero theme="light" title="Brand Design Atelier" />,
    );

    expect(screen.getByText("Brand Design Atelier")).toBeInTheDocument();
    expect(
      container.querySelector('[data-members-theme="light"]'),
    ).not.toBeNull();
  });

  it("renders fallback art (not a broken img) when no cover is set", () => {
    const { container } = render(
      <MembersAreaHero
        theme="dark"
        title="Untitled"
        studioName="Marie Curie Studio"
      />,
    );

    expect(container.querySelector(".members-hero__cover")).toBeNull();
    expect(container.querySelector(".members-hero__art")).not.toBeNull();
    expect(screen.getByText("MC")).toBeInTheDocument();
  });

  it("omits the progress bar when progressPercent is null", () => {
    const { container, rerender } = render(
      <MembersAreaHero theme="dark" title="Course" progressPercent={null} />,
    );
    expect(container.querySelector(".members-hero__prog")).toBeNull();

    rerender(
      <MembersAreaHero theme="dark" title="Course" progressPercent={42} />,
    );
    expect(container.querySelector(".members-hero__prog")).not.toBeNull();
    expect(screen.getByText("42%")).toBeInTheDocument();
  });
});
