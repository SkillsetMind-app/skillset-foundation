import { readFileSync } from "node:fs";

import { cleanup, render, screen } from "@testing-library/react";
import postcss from "postcss";
import { afterEach, describe, expect, it } from "vitest";

import { niceStep, RevenueChart } from "@/components/teacher/revenue-chart";

// O que a pessoa sofria: sem venda, Relatorios mostrava a caixa "No revenue in
// this period" encostada no canto inferior direito do grafico — em cima dos
// rotulos do eixo X — e a etiqueta "$0" do ultimo ponto por cima da caixa
// (QA visual em producao, 08/09).

const points = [
  { key: "2026-09-01", label: "Sep 1", grossMinor: 0 },
  { key: "2026-09-02", label: "Sep 2", grossMinor: 0 },
];

function renderChart(totalMinor: number, totalLabel: string, chartPoints = points) {
  return render(
    <RevenueChart
      points={chartPoints}
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

describe("grafico de receita sem venda", () => {
  it("nao repete o total quando a caixa ja informa que nao ha receita", () => {
    renderChart(0, "$0.00");

    expect(screen.getByText("No revenue in this period")).toBeInTheDocument();
    expect(screen.queryByText("$0.00")).toBeNull();
  });

  it("volta a mostrar a etiqueta assim que ha receita", () => {
    renderChart(1500, "$15.00");

    expect(screen.getByText("$15.00")).toBeInTheDocument();
    expect(screen.queryByText("No revenue in this period")).toBeNull();
  });

  it("centra a caixa de vazio no canvas em vez de encosta-la no eixo", () => {
    const css = postcss.parse(readFileSync("src/app/globals.css", "utf8"));
    const declarations: Record<string, string> = {};
    css.walkRules(".studio-chart-empty", (rule) => {
      // A regra de celular (position: static, dentro do @media) nao entra.
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

// Com $490, $980, $1.470 e $2.450, o eixo escrevia "$613", "$1k" para 1.225 e
// "$2k" duas vezes, com o texto dentro do SVG (~4px no celular).
describe("eixo do grafico de receita", () => {
  const sales = [49000, 98000, 147000, 245000].map((grossMinor, index) => ({
    key: `2026-0${index + 1}`,
    label: ["Jan", "Feb", "Mar", "Apr"][index],
    grossMinor,
  }));

  it("sobe o topo para um valor redondo e escreve cada linha uma vez, pelo formatador", () => {
    renderChart(539000, "$5,390", sales);

    const axis = ["$0", "$1K", "$2K", "$3K"];
    for (const label of axis) expect(screen.getAllByText(label)).toHaveLength(1);
    expect(screen.queryByText(/\$613|\$2k/)).toBeNull();
  });

  it("escreve os rotulos fora do SVG, em HTML de 12px", () => {
    renderChart(539000, "$5,390", sales);

    const chart = screen.getByRole("img", { name: "Revenue chart" });
    expect(chart.querySelectorAll("text")).toHaveLength(0);
    expect(screen.getByText("$1K")).toHaveClass("text-xs");
    expect(screen.getByText("Feb")).toHaveClass("text-xs");
    expect(chart).toHaveAttribute("preserveAspectRatio", "none");
  });

  it.each([
    [612.5, 1000],
    [375, 500],
    [2500, 2500],
    [5000, 5000],
    [130, 200],
  ])("passo redondo para %d: %d", (value, expected) => {
    expect(niceStep(value)).toBe(expected);
  });
});

describe("total de receita sem recortes", () => {
  const paidPoints = [
    { key: "2026-09-01", label: "Sep 1", grossMinor: 5000 },
    { key: "2026-09-02", label: "Sep 2", grossMinor: 20000 },
  ];
  const money = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

  it("mantém os elementos dentro do SVG quando o último ponto é o pico", () => {
    renderChart(25000, "$250", paidPoints);

    const chart = screen.getByRole("img", { name: "Revenue chart" });
    const [, , width, height] = chart.getAttribute("viewBox")!.split(" ").map(Number);

    // A etiqueta original ia de y=-20 a 4 e de x=585 a 663 em um SVG
    // 640x240. jsdom não pinta: estes limites medem a geometria emitida;
    // a legibilidade do texto e a quebra de linha exigem QA no navegador.
    for (const rect of chart.querySelectorAll("rect")) {
      const x = Number(rect.getAttribute("x"));
      const y = Number(rect.getAttribute("y"));
      expect.soft(x).toBeGreaterThanOrEqual(0);
      expect.soft(y).toBeGreaterThanOrEqual(0);
      expect.soft(x + Number(rect.getAttribute("width"))).toBeLessThanOrEqual(width!);
      expect.soft(y + Number(rect.getAttribute("height"))).toBeLessThanOrEqual(height!);
    }
    for (const circle of chart.querySelectorAll("circle")) {
      const x = Number(circle.getAttribute("cx"));
      const y = Number(circle.getAttribute("cy"));
      const radius = Number(circle.getAttribute("r"));
      expect.soft(x - radius).toBeGreaterThanOrEqual(0);
      expect.soft(y - radius).toBeGreaterThanOrEqual(0);
      expect.soft(x + radius).toBeLessThanOrEqual(width!);
      expect.soft(y + radius).toBeLessThanOrEqual(height!);
    }
    for (const label of chart.querySelectorAll("text")) {
      expect.soft(Number(label.getAttribute("y"))).toBeGreaterThanOrEqual(0);
      expect.soft(Number(label.getAttribute("y"))).toBeLessThanOrEqual(height!);
    }

    // O total não pode ser resolvido encolhendo ou deslocando a série. Com o
    // eixo escrito fora do desenho, a série ocupa a largura toda (0 a 640) e o
    // pico (US$200, já um topo redondo) chega ao teto.
    expect(chart.querySelector('path[stroke]')).toHaveAttribute("d", "M0,148 L640,10");
    expect(screen.getByText("$250")).toBeVisible();
  });

  it.each([
    ["valor comum", 25000],
    ["maior inteiro de 32 bits", 2147483647],
    ["maior inteiro seguro", Number.MAX_SAFE_INTEGER],
    ["maior número finito", Number.MAX_VALUE],
  ] as const)("preserva o total completo no cabeçalho: %s", (_case, amountMinor) => {
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
