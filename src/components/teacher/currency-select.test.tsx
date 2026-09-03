import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { CurrencySelect } from "@/components/teacher/currency-select";
import { supportedStripeCurrencies } from "@/lib/payments/currencies";

// O seletor de moeda saía do cartão: a coluna era 140px fixos e um <select>
// nunca fica mais estreito que a sua opção mais larga. E em Gerenciar → Preços
// a moeda era um campo de texto livre de três letras.

describe("CurrencySelect", () => {
  it("oferece exatamente as moedas que o Stripe aceita, nenhuma a mais", () => {
    render(<CurrencySelect value="USD" onChange={() => {}} />);

    const options = screen
      .getAllByRole("option")
      .map((option) => (option as HTMLOptionElement).value);

    expect(new Set(options)).toEqual(new Set(supportedStripeCurrencies));
    expect(options).toHaveLength(supportedStripeCurrencies.length);
  });

  it("encolhe junto com a coluna em vez de empurrar a borda do cartao", () => {
    render(<CurrencySelect value="USD" onChange={() => {}} />);

    const select = screen.getByRole("combobox");
    expect(select.className).toMatch(/\bw-full\b/);
    expect(select.className).toMatch(/\bmin-w-0\b/);
  });

  it("fechado mostra so o codigo; as outras opcoes trazem codigo + nome", () => {
    // Um <select> fechado exibe o texto da opcao selecionada: com
    // "USD - US Dollar" ali, a moeda escolhida chegava cortada no meio do nome
    // numa coluna estreita.
    render(<CurrencySelect value="USD" onChange={() => {}} />);

    const options = screen.getAllByRole("option") as HTMLOptionElement[];
    const chosen = options.find((option) => option.value === "USD");
    expect(chosen?.textContent).toBe("USD");

    const other = options.find((option) => option.value === "BRL");
    expect(other?.textContent).toBe("BRL - Brazilian Real");
  });

  it("trocar de moeda move o rotulo curto junto — a nova e que fica so o codigo", () => {
    const { rerender } = render(<CurrencySelect value="USD" onChange={() => {}} />);
    rerender(<CurrencySelect value="BRL" onChange={() => {}} />);

    const options = screen.getAllByRole("option") as HTMLOptionElement[];
    expect(options.find((option) => option.value === "BRL")?.textContent).toBe("BRL");
    expect(options.find((option) => option.value === "USD")?.textContent).toBe(
      "USD - US Dollar",
    );
  });

  it("devolve o codigo escolhido", () => {
    const onChange = vi.fn();
    render(<CurrencySelect value="USD" onChange={onChange} />);

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "BRL" } });

    expect(onChange).toHaveBeenCalledWith("BRL");
  });
});

describe("a grade de preco e moeda do construtor", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/components/teacher/course-builder-studio.tsx"),
    "utf8",
  );

  it("usa minmax(0, ...) nas duas colunas, nunca 140px fixos", () => {
    expect(source).not.toContain("md:grid-cols-[1fr_140px]");
    expect(source).toContain("md:grid-cols-[minmax(0,1fr)_minmax(0,200px)]");
  });

  it("usa o mesmo seletor que Gerenciar -> Precos e ofertas", () => {
    const offers = readFileSync(
      path.join(process.cwd(), "src/components/teacher/course-offers-panel.tsx"),
      "utf8",
    );

    expect(source).toContain("<CurrencySelect");
    expect(offers).toContain("<CurrencySelect");
    // O campo de texto livre de tres letras foi embora.
    expect(offers).not.toContain("toUpperCase().slice(0, 3)");
  });
});
