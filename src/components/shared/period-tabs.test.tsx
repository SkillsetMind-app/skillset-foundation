import { readFileSync } from "node:fs";
import { join } from "node:path";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PeriodTabs } from "@/components/shared/period-tabs";

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

function rule(selector: string, from = 0): string {
  const start = css.indexOf(`${selector} {`, from);
  expect(start, `${selector} nao encontrado`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("}", start));
}

const options = ["monthly", "yearly"] as const;

describe("PeriodTabs — seletor segmentado", () => {
  it("marca a escolha no proprio botao e so quebra a linha quando pedido", () => {
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

  // A moldura de 4px e do grupo: tocar nela nao escolhe nada. No toque o
  // botao precisa dos 44px inteiros (publico de 55+ no celular).
  it("da 44px ao botao em tela de toque", () => {
    const touch = css.indexOf("@media (pointer: coarse) {");
    expect(touch).toBeGreaterThan(css.indexOf(".studio-range-tabs button {"));
    expect(rule(".studio-range-tabs button", touch)).toContain("min-height: 44px;");
    expect(css.indexOf(".studio-range-tabs button {", touch)).toBeLessThan(css.indexOf("}", touch));
  });

  // Credenciais: quatro filtros com numero. Rolando por dentro, "En curso N"
  // ficava escondido a 360px; a variante quebra a linha na mesma moldura.
  it("a variante --wrap quebra a linha em vez de rolar por dentro", () => {
    const wrap = rule(".studio-range-tabs--wrap");
    expect(wrap).toContain("flex-wrap: wrap;");
    expect(wrap).toContain("overflow-x: visible;");
    expect(css.indexOf(".studio-range-tabs--wrap {")).toBeGreaterThan(css.indexOf(".studio-range-tabs {"));
  });
});
