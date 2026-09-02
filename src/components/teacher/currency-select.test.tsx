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
