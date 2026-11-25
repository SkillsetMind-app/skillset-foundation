import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { CurrencySelect } from "@/components/teacher/currency-select";
import { I18nProvider, useTranslation } from "@/components/i18n/i18n-provider";
import { supportedStripeCurrencies } from "@/lib/payments/currencies";

const localeRouter = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => localeRouter }));

function SwitchLanguage() {
  const { locale, setLocale } = useTranslation();
  return <button onClick={() => setLocale(locale === "en" ? "es" : "en")}>Switch language</button>;
}

// The currency select left the card: the column was a fixed 140px and a <select>
// is never narrower than its widest option. And in Manage → Prices
// the currency was a free text field of three letters.

describe("CurrencySelect", () => {
  it("keeps the selected code and options while names and groups follow the locale", () => {
    const onChange = vi.fn();
    render(
      <I18nProvider initialLocale="en">
        <SwitchLanguage />
        <CurrencySelect value="USD" onChange={onChange} aria-label="Currency" />
      </I18nProvider>,
    );
    const select = screen.getByRole("combobox");
    const originalCodes = screen.getAllByRole("option").map((option) => (option as HTMLOptionElement).value);
    fireEvent.click(screen.getByRole("button", { name: "Switch language" }));
    expect(screen.getByRole("group", { name: "Más usadas" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Otras monedas admitidas" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "BRL - real brasileño" })).toHaveValue("BRL");
    expect(screen.getByRole("option", { name: "USD" })).toHaveProperty("selected", true);
    expect(screen.getByRole("combobox")).toBe(select);
    expect(screen.getAllByRole("option").map((option) => (option as HTMLOptionElement).value)).toEqual(originalCodes);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(select, { target: { value: "MXN" } });
    expect(onChange).toHaveBeenCalledExactlyOnceWith("MXN");
  });

  it("offers exactly the currencies Stripe accepts, none more", () => {
    render(<CurrencySelect value="USD" onChange={() => {}} />);

    const options = screen
      .getAllByRole("option")
      .map((option) => (option as HTMLOptionElement).value);

    expect(new Set(options)).toEqual(new Set(supportedStripeCurrencies));
    expect(options).toHaveLength(supportedStripeCurrencies.length);
  });

  it("shrinks along with the column instead of pushing the card border", () => {
    render(<CurrencySelect value="USD" onChange={() => {}} />);

    const select = screen.getByRole("combobox");
    expect(select.className).toMatch(/\bw-full\b/);
    expect(select.className).toMatch(/\bmin-w-0\b/);
  });

  it("closed shows only the code; the other options carry code + name", () => {
    // A closed <select> shows the text of the selected option: with
    // "USD - US Dollar" there, the chosen currency arrived cut off in the middle of the name
    // in a narrow column.
    render(<CurrencySelect value="USD" onChange={() => {}} />);

    const options = screen.getAllByRole("option") as HTMLOptionElement[];
    const chosen = options.find((option) => option.value === "USD");
    expect(chosen?.textContent).toBe("USD");

    const other = options.find((option) => option.value === "BRL");
    expect(other?.textContent).toBe("BRL - Brazilian Real");
  });

  it("changing currency moves the short label along — the new one is the one that shows only the code", () => {
    const { rerender } = render(<CurrencySelect value="USD" onChange={() => {}} />);
    rerender(<CurrencySelect value="BRL" onChange={() => {}} />);

    const options = screen.getAllByRole("option") as HTMLOptionElement[];
    expect(options.find((option) => option.value === "BRL")?.textContent).toBe("BRL");
    expect(options.find((option) => option.value === "USD")?.textContent).toBe(
      "USD - US Dollar",
    );
  });

  it("returns the chosen code", () => {
    const onChange = vi.fn();
    render(<CurrencySelect value="USD" onChange={onChange} />);

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "BRL" } });

    expect(onChange).toHaveBeenCalledWith("BRL");
  });
});

describe("the builder's price and currency grid", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/components/teacher/course-builder-studio.tsx"),
    "utf8",
  );

  it("uses minmax(0, ...) on both columns, never a fixed 140px", () => {
    expect(source).not.toContain("md:grid-cols-[1fr_140px]");
    expect(source).toContain("md:grid-cols-[minmax(0,1fr)_minmax(0,200px)]");
  });

  it("uses the same select as Manage -> Prices and offers", () => {
    const offers = readFileSync(
      path.join(process.cwd(), "src/components/teacher/course-offers-panel.tsx"),
      "utf8",
    );

    expect(source).toContain("<CurrencySelect");
    expect(offers).toContain("<CurrencySelect");
    // The free three-letter text field is gone.
    expect(offers).not.toContain("toUpperCase().slice(0, 3)");
  });
});
