import { readFileSync } from "node:fs";

import { cleanup, render, screen } from "@testing-library/react";
import postcss from "postcss";
import { afterEach, describe, expect, it } from "vitest";

import { RevenueChart } from "@/components/teacher/revenue-chart";

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

    // O total não pode ser resolvido encolhendo ou deslocando a série.
    expect(chart.querySelector('path[stroke]')).toHaveAttribute("d", "M48,160.5 L624,18");
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
