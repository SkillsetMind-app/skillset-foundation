"use client";

import type { ReactNode } from "react";

import type { RevenuePoint } from "@/domain/creator-reports";

/**
 * O grafico de receita que so existia na home. Agora e um componente so, usado
 * pela home e pela pagina de relatorios; quem chama decide o periodo, os
 * rotulos e o que vai no canto direito do cabecalho (as abas de periodo).
 */
export function RevenueChart({
  points,
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
  totalMinor: number;
  totalLabel: string;
  title: string;
  subtitle: string;
  ariaLabel: string;
  emptyTitle: string;
  emptyDetail: string;
  headerAction?: ReactNode;
}) {
  const chart = buildChart(points);
  // 90 baldes diarios (ou 24 mensais) escreviam 90 rotulos em 640px e viravam
  // borrao. Um a cada N mantem no maximo ~12 legiveis em qualquer periodo.
  const labelEvery = Math.max(1, Math.ceil(points.length / 12));

  return (
    <div className="studio-chart-card dash-card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="display-title text-2xl text-[var(--color-primary)]">
            {title}
          </h3>
          <p className="mt-1 text-sm leading-6 text-[var(--color-ink-soft)]">
            {subtitle}
          </p>
        </div>
        {headerAction}
      </div>

      <div className="studio-chart-canvas">
        <svg
          viewBox={`0 0 ${chart.width} ${chart.height}`}
          role="img"
          aria-label={ariaLabel}
          className="h-full w-full"
        >
          <defs>
            <linearGradient id="studioRevenueArea" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#1a365d" stopOpacity="0.2" />
              <stop offset="100%" stopColor="#1a365d" stopOpacity="0" />
            </linearGradient>
          </defs>
          {chart.gridLines.map((line) => (
            <line
              key={line.y}
              x1={chart.padLeft}
              x2={chart.width - chart.padRight}
              y1={line.y}
              y2={line.y}
              stroke="var(--color-line)"
              strokeDasharray={line.major ? "0" : "4 6"}
            />
          ))}
          {chart.yLabels.map((label) => (
            <text
              key={label.text}
              x={chart.padLeft - 8}
              y={label.y + 4}
              textAnchor="end"
              fontSize="10"
              fill="var(--color-ink-muted)"
              fontWeight="700"
            >
              {label.text}
            </text>
          ))}
          {points.map((point, index) =>
            index % labelEvery === 0 ? (
              // A chave era o rotulo: em 24 meses "Sep" aparecia duas vezes e
              // o React reclamava de chave repetida.
              <text
                key={point.key}
                x={chart.points[index]?.[0] ?? 0}
                y={chart.height - 8}
                textAnchor="middle"
                fontSize="10"
                fill="var(--color-ink-muted)"
                fontWeight="700"
              >
                {point.label}
              </text>
            ) : null,
          )}
          <path d={chart.areaPath} fill="url(#studioRevenueArea)" />
          <path
            d={chart.linePath}
            stroke="var(--color-primary)"
            strokeWidth="3"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {chart.points.map((point, index) => (
            <circle
              key={`${point[0]}-${point[1]}`}
              cx={point[0]}
              cy={point[1]}
              r={index === chart.points.length - 1 ? 5 : 2.5}
              fill={
                index === chart.points.length - 1
                  ? "var(--color-accent)"
                  : "var(--color-primary)"
              }
            />
          ))}
          {chart.lastPoint ? (
            <g>
              <rect
                x={chart.lastPoint[0] - 39}
                y={chart.lastPoint[1] - 38}
                rx="6"
                width="78"
                height="24"
                fill="#0f2744"
              />
              <text
                x={chart.lastPoint[0]}
                y={chart.lastPoint[1] - 21}
                textAnchor="middle"
                fontSize="11"
                fontWeight="800"
                fill="#fff"
              >
                {totalLabel}
              </text>
            </g>
          ) : null}
        </svg>

        {!totalMinor ? (
          <div className="studio-chart-empty">
            <p>{emptyTitle}</p>
            <span>{emptyDetail}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function buildChart(points: RevenuePoint[]) {
  const width = 640;
  const height = 240;
  const padLeft = 48;
  const padRight = 16;
  const padTop = 18;
  const padBottom = 32;
  const innerWidth = width - padLeft - padRight;
  const innerHeight = height - padTop - padBottom;
  const maxGross = Math.max(...points.map((point) => point.grossMinor), 10000);
  const stepX = innerWidth / Math.max(1, points.length - 1);
  const plotted = points.map((point, index) => {
    const x = padLeft + index * stepX;
    const y = padTop + innerHeight - (point.grossMinor / maxGross) * innerHeight;

    return [x, y] as [number, number];
  });
  const linePath = plotted
    .map((point, index) => `${index === 0 ? "M" : "L"}${point[0]},${point[1]}`)
    .join(" ");
  const baseline = padTop + innerHeight;
  const areaPath = `${linePath} L${plotted[plotted.length - 1]?.[0] ?? padLeft},${baseline} L${plotted[0]?.[0] ?? padLeft},${baseline} Z`;
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((position, index) => ({
    y: padTop + innerHeight - position * innerHeight,
    major: index === 0,
  }));
  const yLabels = [0, 0.25, 0.5, 0.75, 1].map((position) => ({
    y: padTop + innerHeight - position * innerHeight,
    text: formatAxisLabel(maxGross * position),
  }));

  return {
    width,
    height,
    padLeft,
    padRight,
    points: plotted,
    linePath,
    areaPath,
    gridLines,
    yLabels,
    lastPoint: plotted.at(-1) ?? null,
  };
}

function formatAxisLabel(amountMinor: number) {
  const dollars = amountMinor / 100;

  if (dollars >= 1000) {
    return `$${Math.round(dollars / 1000)}k`;
  }

  return `$${Math.round(dollars)}`;
}
