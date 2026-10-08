import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { ShortId, shortId } from "@/components/shared/short-id";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

/**
 * ID curto do produto e do pedido: o começo do UUID, em maiúsculas, sempre
 * igual para o mesmo id, com botão de copiar. Id que não é UUID sai inteiro.
 */
describe("ID curto", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("é o começo do UUID em maiúsculas, estável", () => {
    const id = "3f2a9c1e-7b4d-4e11-9a0b-123456789abc";
    expect(shortId(id)).toBe("3F2A9C1E");
    expect(shortId(id)).toBe(shortId(id));
  });

  it("id que não é UUID (fatura do Stripe da renovação) sai inteiro, como está", () => {
    expect(shortId("in_1MtHbELkdIwHu7ixl4OzzPMv")).toBe("in_1MtHbELkdIwHu7ixl4OzzPMv");
    expect(shortId("order-12")).toBe("order-12");
    // Começo de UUID sem o resto também não é UUID.
    expect(shortId("3f2a9c1e-7b4d")).toBe("3f2a9c1e-7b4d");
  });

  it("mostra o rótulo e o código, e copia o código curto; 'Copied' some depois de 2 segundos", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    render(
      <I18nProvider initialLocale="en">
        <ShortId id="3f2a9c1e-7b4d-4e11-9a0b-123456789abc" label="Order ID" />
      </I18nProvider>,
    );

    expect(screen.getByText("Order ID")).toBeInTheDocument();
    expect(screen.getByText("3F2A9C1E")).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Copy 3F2A9C1E" });
    // Alvo de toque de 44px, como o resto do projeto.
    expect(button).toHaveClass("min-h-11", "min-w-11");
    await act(async () => {
      fireEvent.click(button);
    });
    expect(writeText).toHaveBeenCalledExactlyOnceWith("3F2A9C1E");
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent("Copied");

    act(() => vi.advanceTimersByTime(1900));
    expect(status).toHaveTextContent("Copied");
    act(() => vi.advanceTimersByTime(200));
    expect(status).toHaveTextContent("");
  });

  it("id que não é UUID: mostra e copia o id inteiro", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    render(
      <I18nProvider initialLocale="en">
        <ShortId id="in_1MtHbELkdIwHu7ixl4OzzPMv" label="Order ID" />
      </I18nProvider>,
    );

    expect(screen.getByText("in_1MtHbELkdIwHu7ixl4OzzPMv")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy in_1MtHbELkdIwHu7ixl4OzzPMv" }));
    });
    expect(writeText).toHaveBeenCalledExactlyOnceWith("in_1MtHbELkdIwHu7ixl4OzzPMv");
  });

  it("sem área de transferência, diz como copiar à mão (em espanhol também), e o aviso fica", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: vi.fn(async () => { throw new Error("blocked"); }) } });
    render(
      <I18nProvider initialLocale="es">
        <ShortId id="3f2a9c1e-7b4d-4e11-9a0b-123456789abc" label="ID del pedido" />
      </I18nProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copiar 3F2A9C1E" }));
    });
    const message = "No se pudo copiar. Selecciona el código y cópialo a mano.";
    expect(screen.getByRole("status")).toHaveTextContent(message);
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.getByRole("status")).toHaveTextContent(message);
  });
});
