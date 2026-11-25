"use client";

import type { ReactNode } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { SpotArt } from "@/components/ui/spot-art";
import type { RevenuePoint } from "@/domain/creator-reports";
import { formatMoney } from "@/lib/format-money";

/**
 * The revenue chart that used to live only on the home page. Now it is a single component, used
 * by the home page and the reports page; the caller decides the period, the
 * labels and what goes in the right corner of the header (the period tabs).
 * It draws ONE currency (`currency`): the caller picks which one and says in `note` what
 * was left out, instead of adding different currencies together.
 */
export function RevenueChart({
  points,
  currency,
  note,
  unavailableLabel,
  totalMinor,
  totalLabel,
  title,
  subtitle,
  ariaLabel,
  emptyTitle,
  emptyDetail,
  headerAction,
}: {
  points: RevenuePoint[];
  currency: string;
  /** A line under the chart (e.g. the other currencies, which are not in it). */
  note?: string;
  /**
   * Data still loading or a read that failed: instead of "no revenue"
   * (which would claim zero), only this label.
   */
  unavailableLabel?: string;
  totalMinor: number;
  totalLabel: string;
  title: string;
  subtitle: string;
  ariaLabel: string;
  emptyTitle: string;
  emptyDetail: string;
  headerAction?: ReactNode;
}) {
  const { locale } = useTranslation();
  const chart = buildChart(points);
  // Axis through the locale formatter ("$1.5K"): the hand-made "$2k" rounded
  // $1,500 up to $2k and wrote "$2k" on two lines. The minimum number of decimals is
  // explicit: without it, ICU versions write "$1.0K" and "$0.0". The currency is the
  // chart's (it used to be fixed USD, even for people who sell in reais).
  const axisMoney = (amountMinor: number) =>
    formatMoney(amountMinor, currency, locale, {
      notation: "compact",
      minimumFractionDigits: 0,
      maximumFractionDigits: 1,
    });
  // 90 daily buckets (or 24 monthly ones) wrote 90 labels and turned into a blur.
  // One in every N keeps at most ~12 in any period (~4 on a phone).
  const labelEvery = Math.max(1, Math.ceil(points.length / 12));
  const percent = (value: number, total: number) => `${(value / total) * 100}%`;
  const yTexts = chart.yLabels.map((label) => axisMoney(label.amountMinor));
  // The axis column is as wide as the widest label: "2,5 mil US$" in Spanish
  // is much wider than "$2.5K" and would be cut off in a fixed-width column.
  const axisWidth = `${Math.max(1, ...yTexts.map((text) => text.length)) + 1}ch`;

  return (
    <div className="studio-chart-card dash-card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-full">
          {/* The total is the number the teacher came to see: it is the highlight, and
              "Revenue" becomes the label. */}
          <h3 className="text-sm font-semibold text-[var(--color-ink-soft)]">
            {title}
          </h3>
          {/* The total is the aggregate, not the value of the last point. Outside the SVG,
              it can wrap to a new line without being cut off. */}
          {points.length > 0 && totalMinor ? (
            <strong className="num mt-1 block max-w-full break-all text-3xl font-bold text-[var(--color-primary)]">
              {totalLabel}
            </strong>
          ) : null}
          <p className="mt-1 text-sm leading-6 text-[var(--color-ink-soft)]">
            {subtitle}
          </p>
        </div>
        {headerAction}
      </div>

      <div className="studio-chart-canvas">
        {/* The axis text used to live INSIDE the SVG, which scales with the card: 10
            units became ~9px on a computer and ~4px on a phone. Now the
            labels are HTML around the drawing and always stay at 12px; the
            drawing stretches (preserveAspectRatio none) and the stroke does not get thicker. */}
        <div className="flex h-[200px] gap-2">
          <div className="relative shrink-0 text-xs" style={{ width: axisWidth }} aria-hidden="true">
            {chart.yLabels.map((label, index) => (
              <span
                key={index}
                className="absolute right-0 -translate-y-1/2 whitespace-nowrap text-xs font-semibold tabular-nums text-[var(--color-ink-muted)]"
                style={{ top: percent(label.y, chart.height) }}
              >
                {yTexts[index]}
              </span>
            ))}
          </div>
          <div className="relative min-w-0 flex-1">
            <svg
              viewBox={`0 0 ${chart.width} ${chart.height}`}
              preserveAspectRatio="none"
              role="img"
              aria-label={ariaLabel}
              className="absolute inset-0 h-full w-full overflow-visible"
            >
              <defs>
                <linearGradient id="studioRevenueArea" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="#1a365d" stopOpacity="0.2" />
                  <stop offset="100%" stopColor="#1a365d" stopOpacity="0" />
                </linearGradient>
              </defs>
              {chart.gridLines.map((line, index) => (
                <line
                  key={index}
                  x1={0}
                  x2={chart.width}
                  y1={line.y}
                  y2={line.y}
                  stroke="var(--color-line)"
                  strokeDasharray={line.major ? "0" : "4 6"}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              <path d={chart.areaPath} fill="url(#studioRevenueArea)" />
              <path
                d={chart.linePath}
                stroke="var(--color-primary)"
                strokeWidth="3"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            {/* The points are HTML: with the drawing stretched, an SVG circle
                would turn into an ellipse. */}
            {chart.points.map(([x, y], index) => {
              const last = index === chart.points.length - 1;
              return (
                <span
                  key={index}
                  aria-hidden="true"
                  className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full ${
                    last ? "size-2.5 bg-[var(--color-accent)]" : "size-1.5 bg-[var(--color-primary)]"
                  }`}
                  style={{ left: percent(x, chart.width), top: percent(y, chart.height) }}
                />
              );
            })}
          </div>
        </div>
        <div
          className="relative mt-2 h-4 text-xs"
          style={{ marginLeft: `calc(${axisWidth} + 0.5rem)` }}
          aria-hidden="true"
        >
          {points.map((point, index) =>
            index % labelEvery === 0 ? (
              // The key was the label: over 24 months "Sep" showed up twice and
              // React complained about a repeated key. The first and the last label
              // hug the edge instead of spilling over it.
              <span
                key={point.key}
                className={`absolute top-0 whitespace-nowrap text-xs font-semibold text-[var(--color-ink-muted)] ${
                  index === 0
                    ? ""
                    : index === points.length - 1
                      ? "-translate-x-full"
                      : "-translate-x-1/2"
                } ${index % (labelEvery * 3) === 0 ? "" : "max-sm:hidden"}`}
                style={{ left: percent(chart.points[index]?.[0] ?? 0, chart.width) }}
              >
                {point.label}
              </span>
            ) : null,
          )}
        </div>
        {note ? (
          <p className="mt-3 text-xs leading-5 text-[var(--color-ink-soft)]">{note}</p>
        ) : null}

        {unavailableLabel ? (
          <div className="studio-chart-empty" role="status">
            <p>{unavailableLabel}</p>
          </div>
        ) : !totalMinor ? (
          <div className="studio-chart-empty">
            {/* The receipt scene, without currency: nothing here hints at how much will come in. */}
            <SpotArt scene="noSales" className="spot-art-in mx-auto mb-2 max-w-[6.5rem]" />
            <p>{emptyTitle}</p>
            <span>{emptyDetail}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function buildChart(points: RevenuePoint[]) {
  // The labels sit outside the drawing: no side margin for them.
  const width = 640;
  const height = 200;
  const padTop = 10;
  const padBottom = 6;
  const innerHeight = height - padTop - padBottom;
  // The top used to be the exact largest month: the point touched the ceiling and the axis wrote
  // broken values. Now it rounds up to a round step (1, 2, 2.5 or 5 x 10^n).
  const peak = Math.max(...points.map((point) => point.grossMinor), 10000);
  const step = niceStep(peak / 4);
  const intervals = Math.max(1, Math.ceil(peak / step));
  const maxGross = step * intervals;
  const stepX = width / Math.max(1, points.length - 1);
  const plotted = points.map((point, index) => {
    const x = index * stepX;
    const y = padTop + innerHeight - (point.grossMinor / maxGross) * innerHeight;

    return [x, y] as [number, number];
  });
  const linePath = plotted
    .map((point, index) => `${index === 0 ? "M" : "L"}${point[0]},${point[1]}`)
    .join(" ");
  const baseline = padTop + innerHeight;
  const areaPath = `${linePath} L${plotted[plotted.length - 1]?.[0] ?? 0},${baseline} L${plotted[0]?.[0] ?? 0},${baseline} Z`;
  const ticks = Array.from({ length: intervals + 1 }, (_, index) => ({
    y: padTop + innerHeight - (index / intervals) * innerHeight,
    amountMinor: step * index,
  }));
  const gridLines = ticks.map((tick, index) => ({ y: tick.y, major: index === 0 }));

  return {
    width,
    height,
    points: plotted,
    linePath,
    areaPath,
    gridLines,
    yLabels: ticks,
  };
}

// Smallest "round" step (1, 2, 2.5 or 5 times a power of 10) that covers the
// requested value. Exported only for the test.
export function niceStep(value: number) {
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const factor = [1, 2, 2.5, 5, 10].find((candidate) => candidate * magnitude >= value) ?? 10;
  return factor * magnitude;
}
