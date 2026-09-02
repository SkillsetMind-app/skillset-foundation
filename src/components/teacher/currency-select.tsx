"use client";

import {
  getCurrencyLabel,
  supportedStripeCurrencies,
  topSkillsetCurrencies,
} from "@/lib/payments/currencies";

// Um só seletor de moeda para o construtor e para Gerenciar → Preços e ofertas.
//
// POR QUE ISTO EXISTE
//
// O construtor tinha um <select> com "USD - US Dollar", "BRL - Brazilian Real"…
// numa coluna fixa de 140px. Um select nunca fica mais estreito que a sua opção
// mais larga, então ele empurrava a borda e saía do cartão em telas médias e
// grandes. E em Gerenciar → Preços a moeda era um campo de texto livre de três
// letras: aceitava "ABC", que o Stripe recusa na hora de cobrar.
//
// Aqui: `w-full min-w-0` deixa o select encolher junto com a coluna (o texto
// da opção escolhida é cortado pelo navegador, não pela borda do cartão), e as
// duas telas passam a oferecer exatamente a lista que o Stripe aceita.
const secondaryCurrencies = supportedStripeCurrencies.filter(
  (currency) => !(topSkillsetCurrencies as readonly string[]).includes(currency),
);

export const currencySelectClassName =
  "w-full min-w-0 rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)] disabled:bg-[var(--color-surface-soft)]";

type CurrencySelectProps = {
  value: string;
  onChange: (currency: string) => void;
  disabled?: boolean;
  className?: string;
  id?: string;
  "aria-label"?: string;
};

export function CurrencySelect({
  value,
  onChange,
  disabled = false,
  className = currencySelectClassName,
  id,
  "aria-label": ariaLabel,
}: CurrencySelectProps) {
  return (
    <select
      id={id}
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      className={className}
    >
      <optgroup label="Most used">
        {topSkillsetCurrencies.map((item) => (
          <option key={item} value={item}>
            {item} - {getCurrencyLabel(item)}
          </option>
        ))}
      </optgroup>
      <optgroup label="Other supported currencies">
        {secondaryCurrencies.map((item) => (
          <option key={item} value={item}>
            {item} - {getCurrencyLabel(item)}
          </option>
        ))}
      </optgroup>
    </select>
  );
}
