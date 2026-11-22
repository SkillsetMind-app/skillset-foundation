"use client";

import type { ReactNode } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { SpotArt } from "@/components/ui/spot-art";
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
  const { locale } = useTranslation();
  const chart = buildChart(points);
  // Eixo pelo formatador da lingua ("$1.5K"): o "$2k" feito a mao arredondava
  // $1.500 para $2k e escrevia "$2k" em duas linhas.
  const axisMoney = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  });
  // 90 baldes diarios (ou 24 mensais) escreviam 90 rotulos e viravam borrao.
  // Um a cada N mantem no maximo ~12 em qualquer periodo (~4 no celular).
  const labelEvery = Math.max(1, Math.ceil(points.length / 12));
  const percent = (value: number, total: number) => `${(value / total) * 100}%`;
  const yTexts = chart.yLabels.map((label) => axisMoney.format(label.amountMinor / 100));
  // A coluna do eixo tem a largura do maior rotulo: "2,5 mil US$" em espanhol
  // e bem mais largo que "$2.5K" e seria cortado numa coluna fixa.
  const axisWidth = `${Math.max(1, ...yTexts.map((text) => text.length)) + 1}ch`;

  return (
    <div className="studio-chart-card dash-card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-full">
          {/* O total e o numero que o professor veio ver: ele e o destaque, e
              "Revenue" vira o rotulo. */}
          <h3 className="text-sm font-semibold text-[var(--color-ink-soft)]">
            {title}
          </h3>
          {/* O total é agregado, não o valor do último ponto. Fora do SVG,
              ele pode quebrar linha sem ser cortado. */}
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
        {/* O texto do eixo morava DENTRO do SVG, que escala com o cartao: 10
            unidades viravam ~9px no computador e ~4px no celular. Agora os
            rotulos sao HTML em volta do desenho e ficam sempre em 12px; o
            desenho estica (preserveAspectRatio none) e o traco nao engorda. */}
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
            {/* Os pontos sao HTML: com o desenho esticado, um circulo do SVG
                viraria elipse. */}
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
              // A chave era o rotulo: em 24 meses "Sep" aparecia duas vezes e
              // o React reclamava de chave repetida. O 1o e o ultimo rotulo
              // encostam na borda em vez de vazar dela.
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

        {!totalMinor ? (
          <div className="studio-chart-empty">
            {/* A cena do recibo, sem moeda: nada aqui sugere quanto vai entrar. */}
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
  // Os rotulos ficam fora do desenho: sem margem lateral para eles.
  const width = 640;
  const height = 200;
  const padTop = 10;
  const padBottom = 6;
  const innerHeight = height - padTop - padBottom;
  // O topo era o maior mes exato: o ponto encostava no teto e o eixo escrevia
  // valores quebrados. Agora sobe para um passo redondo (1, 2, 2.5 ou 5 x 10^n).
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

// Menor passo "redondo" (1, 2, 2.5 ou 5 vezes uma potencia de 10) que cobre o
// valor pedido. Exportado so para o teste.
export function niceStep(value: number) {
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const factor = [1, 2, 2.5, 5, 10].find((candidate) => candidate * magnitude >= value) ?? 10;
  return factor * magnitude;
}
