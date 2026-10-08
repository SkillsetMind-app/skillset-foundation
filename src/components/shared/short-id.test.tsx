import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { ShortId, shortId } from "@/components/shared/short-id";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

/**
 * ID curto do produto e do pedido: o começo do UUID, em maiúsculas, sempre
 * igual para o mesmo id, com botão de copiar.
 */
describe("ID curto", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("é o começo do UUID em maiúsculas, estável", () => {
    const id = "3f2a9c1e-7b4d-4e11-9a0b-123456789abc";
    expect(shortId(id)).toBe("3F2A9C1E");
    expect(shortId(id)).toBe(shortId(id));
    expect(shortId("order-12")).toBe("ORDER12");
  });

  it("mostra o rótulo e o código, e copia o código curto", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    render(
      <I18nProvider initialLocale="en">
        <ShortId id="3f2a9c1e-7b4d-4e11-9a0b-123456789abc" label="Order ID" />
      </I18nProvider>,
    );

    expect(screen.getByText("Order ID")).toBeInTheDocument();
    expect(screen.getByText("3F2A9C1E")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy 3F2A9C1E" }));
    });
    expect(writeText).toHaveBeenCalledExactlyOnceWith("3F2A9C1E");
    expect(screen.getByRole("status")).toHaveTextContent("Copied");
  });

  it("sem área de transferência, diz como copiar à mão (em espanhol também)", async () => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: vi.fn(async () => { throw new Error("blocked"); }) } });
    render(
      <I18nProvider initialLocale="es">
        <ShortId id="3f2a9c1e-7b4d" label="ID del pedido" />
      </I18nProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copiar 3F2A9C1E" }));
    });
    expect(screen.getByRole("status")).toHaveTextContent("No se pudo copiar. Selecciona el código y cópialo a mano.");
  });
});
