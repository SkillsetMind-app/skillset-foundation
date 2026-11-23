import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MetricCard } from "@/components/teacher/metric-card";

// O quadro de numero unico do estudio: numero em algarismos de largura fixa,
// "Unavailable" sem cara de numero, e dt/dd quando mora num <dl>.
describe("MetricCard", () => {
  it("escreve o numero em .num e a dica embaixo", () => {
    render(<MetricCard label="Paid sales" value="3" hint="Last 30 days" />);
    const value = screen.getByText("3");
    expect(value).toHaveClass("num");
    expect(screen.getByText("Paid sales").closest("article")).toContainElement(value);
    expect(screen.getByText("Last 30 days")).toBeInTheDocument();
  });

  it("'Unavailable' nao usa o estilo de numero", () => {
    render(<MetricCard label="Revenue" value="Unavailable" unavailable />);
    expect(screen.getByText("Unavailable")).not.toHaveClass("num");
  });

  it("dentro de um <dl> vira dt/dd, com o esqueleto enquanto carrega", () => {
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
