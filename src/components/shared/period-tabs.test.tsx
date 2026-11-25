import { readFileSync } from "node:fs";
import { join } from "node:path";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PeriodTabs } from "@/components/shared/period-tabs";

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

function rule(selector: string, from = 0): string {
  const start = css.indexOf(`${selector} {`, from);
  expect(start, `${selector} not found`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("}", start));
}

const options = ["monthly", "yearly"] as const;

describe("PeriodTabs — seletor segmentado", () => {
  it("marks the choice on the button itself and only wraps the line when asked", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <PeriodTabs options={options} value="monthly" onChange={onChange} label="Billing cycle" renderLabel={(o) => o} />,
    );
    const group = screen.getByRole("group", { name: "Billing cycle" });
    expect(group).toHaveClass("studio-range-tabs");
    expect(group).not.toHaveClass("studio-range-tabs--wrap");
    expect(screen.getByRole("button", { name: "monthly" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "yearly" }));
    expect(onChange).toHaveBeenCalledWith("yearly");

    rerender(
      <PeriodTabs options={options} value="monthly" onChange={onChange} label="Billing cycle" renderLabel={(o) => o} wrap />,
    );
    expect(screen.getByRole("group", { name: "Billing cycle" })).toHaveClass("studio-range-tabs", "studio-range-tabs--wrap");
  });

  // The 4px frame belongs to the group: touching it chooses nothing. On touch the
  // button needs the full 44px (55+ audience on the phone).
  it("gives the button 44px on a touch screen", () => {
    const touch = css.indexOf("@media (pointer: coarse) {");
    expect(touch).toBeGreaterThan(css.indexOf(".studio-range-tabs button {"));
    expect(rule(".studio-range-tabs button", touch)).toContain("min-height: 44px;");
    expect(css.indexOf(".studio-range-tabs button {", touch)).toBeLessThan(css.indexOf("}", touch));
  });

  // Credentials: four filters with a number. Scrolling inside, "En curso N"
  // was hidden at 360px; the variant wraps the line within the same frame.
  it("the --wrap variant wraps the line instead of scrolling inside", () => {
    const wrap = rule(".studio-range-tabs--wrap");
    expect(wrap).toContain("flex-wrap: wrap;");
    expect(wrap).toContain("overflow-x: visible;");
    expect(css.indexOf(".studio-range-tabs--wrap {")).toBeGreaterThan(css.indexOf(".studio-range-tabs {"));
  });
});
