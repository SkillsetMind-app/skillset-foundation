import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MetricCard } from "@/components/teacher/metric-card";

// The studio's single-number card: number in fixed-width digits,
// "Unavailable" without looking like a number, and dt/dd when it lives in a <dl>.
describe("MetricCard", () => {
  it("writes the number in .num and the hint below", () => {
    render(<MetricCard label="Paid sales" value="3" hint="Last 30 days" />);
    const value = screen.getByText("3");
    expect(value).toHaveClass("num");
    expect(screen.getByText("Paid sales").closest("article")).toContainElement(value);
    expect(screen.getByText("Last 30 days")).toBeInTheDocument();
  });

  it("'Unavailable' does not use the number style", () => {
    render(<MetricCard label="Revenue" value="Unavailable" unavailable />);
    expect(screen.getByText("Unavailable")).not.toHaveClass("num");
  });

  it("inside a <dl> it becomes dt/dd, with the skeleton while loading", () => {
    const { container } = render(
      <dl>
        <MetricCard labelAs="dt" label="Upcoming" value={2} hint="Still ahead" srOnlyHint loading />
      </dl>,
    );
    expect(container.querySelector("dl > div > dt")).toHaveTextContent("Upcoming");
    expect(container.querySelector("dt + dd.animate-pulse")).not.toBeNull();
    expect(screen.getByText("Still ahead")).toHaveClass("sr-only");
    expect(screen.queryByText("2")).toBeNull();
  });
});
