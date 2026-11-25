"use client";

import { useTranslation } from "@/components/i18n/i18n-provider";

import {
  getCurrencyLabel,
  supportedStripeCurrencies,
  topSkillsetCurrencies,
} from "@/lib/payments/currencies";

// A single currency select for the builder and for Manage → Prices and offers.
//
// POR QUE ISTO EXISTE
//
// The builder had a <select> with "USD - US Dollar", "BRL - Brazilian Real"…
// in a fixed 140px column. A select is never narrower than its widest option,
// so it pushed the border out and left the card on medium and
// large screens. And in Manage → Prices the currency was a free text field of three
// letters: it accepted "ABC", which Stripe rejects at charge time.
//
// Here: `w-full min-w-0` lets the select shrink along with the column, and both
// screens now offer exactly the list Stripe accepts.
//
// And the CHOSEN option shows only the code. A closed <select> displays the text of the
// selected option: with "USD - US Dollar" there, the chosen currency arrived
// cut off in the middle of the name ("USD - US Dol…") in a narrow column. Showing only
// "USD" it fits whole. The other options keep code + name — which is what
// the person needs to read to CHOOSE; the one already chosen, not.
const secondaryCurrencies = supportedStripeCurrencies.filter(
  (currency) => !(topSkillsetCurrencies as readonly string[]).includes(currency),
);

// The house field; dimmed like the other locked .field-input fields.
export const currencySelectClassName =
  "field-input w-full min-w-0 disabled:cursor-not-allowed disabled:opacity-60";

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
  const { locale, t } = useTranslation();
  return (
    <select
      id={id}
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      className={className}
    >
      <optgroup label={t("creatorEditor.currencySelect.mostUsed")}>
        {topSkillsetCurrencies.map((item) => (
          <option key={item} value={item}>
            {optionLabel(item, value, locale)}
          </option>
        ))}
      </optgroup>
      <optgroup label={t("creatorEditor.currencySelect.other")}>
        {secondaryCurrencies.map((item) => (
          <option key={item} value={item}>
            {optionLabel(item, value, locale)}
          </option>
        ))}
      </optgroup>
    </select>
  );
}

/** Closed, the <select> shows the text of the chosen option — so it is only the
 *  code. All the others carry code + name. */
function optionLabel(item: string, selected: string, locale: string): string {
  return item === selected ? item : `${item} - ${getCurrencyLabel(item, locale)}`;
}
