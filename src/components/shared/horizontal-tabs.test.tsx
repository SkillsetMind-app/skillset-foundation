import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { HorizontalTabs } from "@/components/shared/horizontal-tabs";

// Em /ops, tres cartoes de metrica ficavam entre as abas e o conteudo, sem
// mudar com a aba. Viraram contadores ao lado do nome da fila.

describe("HorizontalTabs — contador por aba", () => {
  it("mostra o numero ao lado do nome quando a fila tem contagem, e nada quando nao tem", () => {
    render(
      <HorizontalTabs
        tabs={[
          { value: "verification", label: "Creator verification", count: 3 },
          { value: "catalog", label: "Published catalog" },
          { value: "support", label: "Support tickets", count: 0 },
        ]}
        activeValue="verification"
        onChange={() => {}}
        ariaLabel="Operations queues"
      />,
    );

    expect(
      screen.getByRole("tab", { name: /Creator verification\s*3/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: /^Published catalog$/ }),
    ).toBeInTheDocument();
    // Zero e informacao (fila vazia), nao ausencia: aparece, mas sem destaque.
    const support = screen.getByRole("tab", { name: /Support tickets\s*0/ });
    const badge = support.querySelector("span");
    expect(badge).not.toBeNull();
    expect(badge?.className).not.toMatch(/color-accent\)/);
  });

  it("nao mostra contador enquanto a contagem ainda nao chegou (undefined)", () => {
    render(
      <HorizontalTabs
        tabs={[{ value: "verification", label: "Creator verification", count: undefined }]}
        activeValue="verification"
        onChange={() => {}}
        ariaLabel="Operations queues"
      />,
    );

    expect(
      screen.getByRole("tab", { name: /^Creator verification$/ }),
    ).toBeInTheDocument();
  });
});

// O leitor de tela não sabia qual aba estava ativa (aria-pressed num grupo de
// botões), o Tab parava em cada aba, a ativa era sublinhada em latão e o hover
// pintava a mesma cor da ativa.
describe("HorizontalTabs — aba ativa", () => {
  function renderTabs(onChange = () => {}) {
    render(
      <HorizontalTabs
        tabs={[
          { value: "overview", label: "Overview" },
          { value: "purchases", label: "Purchases" },
          { value: "methods", label: "Payment methods" },
        ]}
        activeValue="purchases"
        onChange={onChange}
        ariaLabel="Billing sections"
      />,
    );
  }

  it("anuncia a ativa e só ela entra no Tab", () => {
    renderTabs();
    expect(screen.getByRole("tablist", { name: "Billing sections" })).toBeInTheDocument();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["false", "true", "false"]);
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([-1, 0, -1]);
  });

  it("ativa em navy, e o hover das outras não copia a ativa", () => {
    renderTabs();
    const active = screen.getByRole("tab", { name: "Purchases" });
    const other = screen.getByRole("tab", { name: "Overview" });
    expect(active.className).toContain("border-[var(--color-primary)]");
    expect(active.className).not.toContain("accent");
    expect(other.className).toContain("border-transparent");
    expect(other.className).toContain("hover:text-[var(--color-ink)]");
    expect(other.className).not.toContain("hover:text-[var(--color-primary)]");
  });

  it("as setas levam o foco e ativam a vizinha", () => {
    const onChange = vi.fn();
    renderTabs(onChange);
    fireEvent.keyDown(screen.getByRole("tab", { name: "Purchases" }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Payment methods" })).toHaveFocus();
    expect(onChange).toHaveBeenCalledWith("methods");
  });
});
