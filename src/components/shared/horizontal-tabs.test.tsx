import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

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
      screen.getByRole("button", { name: /Creator verification\s*3/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^Published catalog$/ }),
    ).toBeInTheDocument();
    // Zero e informacao (fila vazia), nao ausencia: aparece, mas sem destaque.
    const support = screen.getByRole("button", { name: /Support tickets\s*0/ });
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
      screen.getByRole("button", { name: /^Creator verification$/ }),
    ).toBeInTheDocument();
  });
});
