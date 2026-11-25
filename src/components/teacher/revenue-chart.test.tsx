import { readFileSync } from "node:fs";

import { cleanup, render, screen, within } from "@testing-library/react";
import postcss from "postcss";
import { afterEach, describe, expect, it } from "vitest";

import { niceStep, RevenueChart } from "@/components/teacher/revenue-chart";

// What the person suffered: with no sales, Reports showed the "No revenue in
// this period" box pushed into the bottom right corner of the chart, on top of the
// X axis labels, and the "$0" label of the last point on top of the box
// (visual QA in production, Sep 8).

const points = [
  { key: "2026-09-01", label: "Sep 1", grossMinor: 0 },
  { key: "2026-09-02", label: "Sep 2", grossMinor: 0 },
];

function renderChart(
  totalMinor: number,
  totalLabel: string,
  chartPoints = points,
  extra: { currency?: string; note?: string; unavailableLabel?: string } = {},
) {
  return render(
    <RevenueChart
      points={chartPoints}
      currency={extra.currency ?? "USD"}
      note={extra.note}
      unavailableLabel={extra.unavailableLabel}
      totalMinor={totalMinor}
      totalLabel={totalLabel}
      title="Revenue"
      subtitle="Last 30 days"
      ariaLabel="Revenue chart"
      emptyTitle="No revenue in this period"
      emptyDetail="Pick a longer period."
    />,
  );
}

afterEach(cleanup);

describe("revenue chart with no sales", () => {
  // Loading or with an error, "no revenue" would claim zero: only the label.
  it("with unavailable data it shows the label, never 'no revenue'", () => {
    renderChart(0, "$0", points, { unavailableLabel: "Unavailable" });

    expect(screen.getByRole("status")).toHaveTextContent("Unavailable");
    expect(screen.queryByText("No revenue in this period")).toBeNull();
  });

  it("does not repeat the total when the box already says there is no revenue", () => {
    renderChart(0, "$0.00");

    expect(screen.getByText("No revenue in this period")).toBeInTheDocument();
    expect(screen.queryByText("$0.00")).toBeNull();
  });

  it("shows the label again as soon as there is revenue", () => {
    renderChart(1500, "$15.00");

    expect(screen.getByText("$15.00")).toBeInTheDocument();
    expect(screen.queryByText("No revenue in this period")).toBeNull();
  });

  it("centers the empty box in the canvas instead of pushing it against the axis", () => {
    const css = postcss.parse(readFileSync("src/app/globals.css", "utf8"));
    const declarations: Record<string, string> = {};
    css.walkRules(".studio-chart-empty", (rule) => {
      // The phone rule (position: static, inside the @media) does not count.
      if (rule.parent?.type === "atrule") return;
      rule.walkDecls((decl) => {
        declarations[decl.prop] = decl.value;
      });
    });

    expect(declarations.inset).toBe("0");
    expect(declarations.margin).toBe("auto");
    expect(declarations.right).toBeUndefined();
    expect(declarations.bottom).toBeUndefined();
  });
});

// With $490, $980, $1,470 and $2,450, the axis wrote "$613", "$1k" for 1,225 and
// "$2k" twice, with the text inside the SVG (~4px on a phone).
describe("revenue chart axis", () => {
  const sales = [49000, 98000, 147000, 245000].map((grossMinor, index) => ({
    key: `2026-0${index + 1}`,
    label: ["Jan", "Feb", "Mar", "Apr"][index],
    grossMinor,
  }));

  it("raises the top to a round value and writes each line once, through the formatter", () => {
    renderChart(539000, "$5,390", sales);

    const axis = ["$0", "$1K", "$2K", "$3K"];
    for (const label of axis) expect(screen.getAllByText(label)).toHaveLength(1);
    expect(screen.queryByText(/\$613|\$2k/)).toBeNull();
  });

  it("writes the labels outside the SVG, in 12px HTML", () => {
    renderChart(539000, "$5,390", sales);

    const chart = screen.getByRole("img", { name: "Revenue chart" });
    expect(chart.querySelectorAll("text")).toHaveLength(0);
    expect(screen.getByText("$1K")).toHaveClass("text-xs");
    expect(screen.getByText("Feb")).toHaveClass("text-xs");
    expect(chart).toHaveAttribute("preserveAspectRatio", "none");
  });

  // The axis was fixed to USD: whoever sells in reais saw "$" on the axis.
  it("writes the axis in the chart currency and the note line below", () => {
    renderChart(539000, "R$5,390", sales, {
      currency: "BRL",
      note: "Other currencies are not in this chart: $20.",
    });

    for (const label of ["R$0", "R$1K", "R$2K", "R$3K"]) {
      expect(screen.getAllByText(label)).toHaveLength(1);
    }
    expect(screen.queryByText("$1K")).toBeNull();
    expect(screen.getByText("Other currencies are not in this chart: $20.")).toBeInTheDocument();
  });

  // Old row with no currency: Intl refuses "UNSPECIFIED"; the axis falls back to plain
  // text instead of bringing down Home.
  it("with an unknown currency the axis falls back to plain text, without breaking", () => {
    renderChart(539000, "UNSPECIFIED 5390.00", sales, { currency: "UNSPECIFIED" });

    expect(screen.getByRole("img", { name: "Revenue chart" })).toBeInTheDocument();
    expect(screen.getByText("UNSPECIFIED 1000.00")).toBeInTheDocument();
  });

  it.each([
    [612.5, 1000],
    [375, 500],
    [2500, 2500],
    [5000, 5000],
    [130, 200],
  ])("round step for %d: %d", (value, expected) => {
    expect(niceStep(value)).toBe(expected);
  });
});

describe("revenue total without clipping", () => {
  const paidPoints = [
    { key: "2026-09-01", label: "Sep 1", grossMinor: 5000 },
    { key: "2026-09-02", label: "Sep 2", grossMinor: 20000 },
  ];
  const money = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

  it("keeps the elements inside the SVG when the last point is the peak", () => {
    renderChart(25000, "$250", paidPoints);

    const chart = screen.getByRole("img", { name: "Revenue chart" });
    const canvas = chart.closest<HTMLElement>(".studio-chart-canvas")!;
    const percentOf = (value: string) => Number(value.replace("%", ""));

    // The original label went from y=-20 to 4 and from x=585 to 663 in a 640x240 SVG.
    // Now points and labels are HTML positioned in % of the drawing area:
    // jsdom does not paint, so the proof is the emitted position (0% to 100%).
    expect(chart.querySelectorAll("circle, text, rect")).toHaveLength(0);
    const dots = [...canvas.querySelectorAll<HTMLElement>("span.rounded-full")];
    expect(dots).toHaveLength(paidPoints.length);
    for (const dot of dots) {
      expect.soft(percentOf(dot.style.left)).toBeGreaterThanOrEqual(0);
      expect.soft(percentOf(dot.style.left)).toBeLessThanOrEqual(100);
      expect.soft(percentOf(dot.style.top)).toBeGreaterThanOrEqual(0);
      expect.soft(percentOf(dot.style.top)).toBeLessThanOrEqual(100);
    }
    // The last point (the peak) is the gold one.
    expect(dots.at(-1)).toHaveClass("bg-[var(--color-accent)]");

    // Y axis labels: inside the height and without repeating text.
    const yLabels = [...canvas.querySelectorAll<HTMLElement>("span.tabular-nums")];
    expect(yLabels.length).toBeGreaterThan(1);
    expect(new Set(yLabels.map((label) => label.textContent)).size).toBe(yLabels.length);
    for (const label of yLabels) {
      expect.soft(percentOf(label.style.top)).toBeGreaterThanOrEqual(0);
      expect.soft(percentOf(label.style.top)).toBeLessThanOrEqual(100);
    }
    // X axis labels: one per point here (two points), in series order.
    expect(within(canvas).getByText("Sep 1")).toBeInTheDocument();
    expect(within(canvas).getByText("Sep 2")).toBeInTheDocument();

    // The total cannot be resolved by shrinking or shifting the series. With the
    // axis written outside the drawing, the series takes the full width (0 to 640) and the
    // peak (US$200, already a round top) reaches the ceiling.
    expect(chart.querySelector('path[stroke]')).toHaveAttribute("d", "M0,148 L640,10");
    expect(screen.getByText("$250")).toBeVisible();
  });

  it.each([
    ["valor comum", 25000],
    ["maior inteiro de 32 bits", 2147483647],
    ["maior inteiro seguro", Number.MAX_SAFE_INTEGER],
    ["maior número finito", Number.MAX_VALUE],
  ] as const)("preserves the full total in the header: %s", (_case, amountMinor) => {
    const totalLabel = money.format(amountMinor / 100);
    renderChart(amountMinor, totalLabel, paidPoints);

    const total = screen.getByText(totalLabel);
    const heading = screen.getByRole("heading", { name: "Revenue" });
    expect(total).toBeVisible();
    expect(total.closest("svg")).toBeNull();
    expect(heading.parentElement).toContainElement(total);
    expect(total).toHaveTextContent(totalLabel);
    expect(screen.queryByText("No revenue in this period")).toBeNull();
  });
});
