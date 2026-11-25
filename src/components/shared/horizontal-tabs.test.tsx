import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { HorizontalTabs } from "@/components/shared/horizontal-tabs";

// On /ops, three metric cards sat between the tabs and the content, without
// changing with the tab. They became counters next to the queue name.

describe("HorizontalTabs — contador por aba", () => {
  it("shows the number next to the name when the queue has a count, and nothing when it does not", () => {
    render(
      <HorizontalTabs
        tabs={[
          { value: "verification", label: "Creator verification", count: 3 },
          { value: "catalog", label: "Published catalog" },
          { value: "support", label: "Support tickets", count: 0 },
        ]}
        activeValue="verification"
        onChange={() => {}}
        ariaLabel="Operations queues"
      />,
    );

    expect(
      screen.getByRole("tab", { name: /Creator verification\s*3/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: /^Published catalog$/ }),
    ).toBeInTheDocument();
    // Zero is information (empty queue), not absence: it shows, but without emphasis.
    const support = screen.getByRole("tab", { name: /Support tickets\s*0/ });
    const badge = support.querySelector("span");
    expect(badge).not.toBeNull();
    expect(badge?.className).not.toMatch(/color-accent\)/);
  });

  it("does not show a counter while the count has not arrived yet (undefined)", () => {
    render(
      <HorizontalTabs
        tabs={[{ value: "verification", label: "Creator verification", count: undefined }]}
        activeValue="verification"
        onChange={() => {}}
        ariaLabel="Operations queues"
      />,
    );

    expect(
      screen.getByRole("tab", { name: /^Creator verification$/ }),
    ).toBeInTheDocument();
  });
});

// The screen reader did not know which tab was active (aria-pressed on a group of
// buttons), Tab stopped at every tab, the active one was underlined in brass and the hover
// painted the same color as the active one.
describe("HorizontalTabs — aba ativa", () => {
  function renderTabs(onChange = () => {}) {
    render(
      <HorizontalTabs
        tabs={[
          { value: "overview", label: "Overview" },
          { value: "purchases", label: "Purchases" },
          { value: "methods", label: "Payment methods" },
        ]}
        activeValue="purchases"
        onChange={onChange}
        ariaLabel="Billing sections"
      />,
    );
  }

  it("announces the active one and only it enters the Tab order", () => {
    renderTabs();
    expect(screen.getByRole("tablist", { name: "Billing sections" })).toBeInTheDocument();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["false", "true", "false"]);
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([-1, 0, -1]);
  });

  it("active in navy, and the hover on the others does not copy the active", () => {
    renderTabs();
    const active = screen.getByRole("tab", { name: "Purchases" });
    const other = screen.getByRole("tab", { name: "Overview" });
    expect(active.className).toContain("border-[var(--color-primary)]");
    expect(active.className).not.toContain("accent");
    expect(other.className).toContain("border-transparent");
    expect(other.className).toContain("text-[var(--color-ink-muted)]");
    expect(other.className).toContain("hover:text-[var(--color-ink)]");
    expect(other.className).not.toContain("hover:text-[var(--color-primary)]");
  });

  it("the arrows move focus and activate the neighbor", () => {
    const onChange = vi.fn();
    renderTabs(onChange);
    fireEvent.keyDown(screen.getByRole("tab", { name: "Purchases" }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Payment methods" })).toHaveFocus();
    expect(onChange).toHaveBeenCalledWith("methods");
  });

  it("Home and End go to the first and the last tab", () => {
    const onChange = vi.fn();
    renderTabs(onChange);
    const active = screen.getByRole("tab", { name: "Purchases" });
    fireEvent.keyDown(active, { key: "Home" });
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveFocus();
    expect(onChange).toHaveBeenLastCalledWith("overview");
    fireEvent.keyDown(active, { key: "End" });
    expect(screen.getByRole("tab", { name: "Payment methods" })).toHaveFocus();
    expect(onChange).toHaveBeenLastCalledWith("methods");
  });
});
