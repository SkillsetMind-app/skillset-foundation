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
// Aqui: `w-full min-w-0` deixa o select encolher junto com a coluna, e as duas
// telas passam a oferecer exatamente a lista que o Stripe aceita.
//
// E a opção ESCOLHIDA mostra só o código. Um <select> fechado exibe o texto da
// opção selecionada: com "USD - US Dollar" ali, a moeda escolhida chegava
// cortada no meio do nome ("USD - US Dol…") numa coluna estreita. Mostrando só
// "USD" ela cabe inteira. As demais opções seguem com código + nome — que é o
// que a pessoa precisa ler para ESCOLHER; a que ela já escolheu, não.
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
            {optionLabel(item, value)}
          </option>
        ))}
      </optgroup>
      <optgroup label="Other supported currencies">
        {secondaryCurrencies.map((item) => (
          <option key={item} value={item}>
            {optionLabel(item, value)}
          </option>
        ))}
      </optgroup>
    </select>
  );
}

/** Fechado, o <select> mostra o texto da opção escolhida — então ela é só o
 *  código. Todas as outras trazem código + nome. */
function optionLabel(item: string, selected: string): string {
  return item === selected ? item : `${item} - ${getCurrencyLabel(item)}`;
}
