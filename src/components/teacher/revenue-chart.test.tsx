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

function renderChart(totalMinor: number, totalLabel: string) {
  return render(
    <RevenueChart
      points={points}
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
  it("nao desenha a etiqueta do ultimo ponto quando o total e zero", () => {
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
