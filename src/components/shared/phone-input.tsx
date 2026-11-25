"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { moveFocusByKey } from "@/lib/a11y/menu-keys";

type CountryOption = {
  code: string;
  dialCode: string;
  minDigits: number;
  maxDigits: number;
};

const countries: CountryOption[] = [
  { code: "US", dialCode: "+1", minDigits: 10, maxDigits: 10 },
  { code: "BR", dialCode: "+55", minDigits: 10, maxDigits: 11 },
  { code: "GB", dialCode: "+44", minDigits: 10, maxDigits: 10 },
  { code: "GY", dialCode: "+592", minDigits: 7, maxDigits: 7 },
  { code: "MX", dialCode: "+52", minDigits: 10, maxDigits: 10 },
];

type PhoneInputProps = {
  value: string;
  onChange: (value: string) => void;
  label?: string;
};

function digitsOnly(value: string) {
  return value.replace(/\D/g, "");
}

function findCountryForValue(value: string) {
  return countries.find((country) => value.startsWith(country.dialCode)) ?? countries[0];
}

function getNationalDigits(value: string, country: CountryOption) {
  return digitsOnly(value.replace(country.dialCode, ""));
}

export function isValidE164Phone(value: string) {
  if (!value) {
    return true;
  }

  const country = findCountryForValue(value);
  const nationalDigits = getNationalDigits(value, country);

  return (
    value.startsWith(country.dialCode)
    && nationalDigits.length >= country.minDigits
    && nationalDigits.length <= country.maxDigits
  );
}

export function PhoneInput({ value, onChange, label }: PhoneInputProps) {
  const { locale, t } = useTranslation();
  const inputId = useId();
  const listId = useId();
  const countryNames = useMemo(() => new Intl.DisplayNames([locale], { type: "region" }), [locale]);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const selectedCountry = findCountryForValue(value);
  const nationalDigits = getNationalDigits(value, selectedCountry);

  useEffect(() => {
    if (!open) {
      return;
    }

    // When open, the list starts at the chosen country: the arrows move from it.
    listRef.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.focus({ preventScroll: true });

    function handleMouseDown(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function handleCountryChange(country: CountryOption) {
    const existingNationalDigits = nationalDigits.slice(0, country.maxDigits);
    onChange(existingNationalDigits ? `${country.dialCode}${existingNationalDigits}` : "");
    setOpen(false);
    triggerRef.current?.focus();
  }

  function handleNumberChange(nextValue: string) {
    const nextDigits = digitsOnly(nextValue).slice(0, selectedCountry.maxDigits);
    onChange(nextDigits ? `${selectedCountry.dialCode}${nextDigits}` : "");
  }

  return (
    <div className="grid grid-cols-1 gap-2 text-sm font-semibold text-[var(--color-ink)]">
      <label htmlFor={inputId}>{label ?? t("phoneInput.label")}</label>
      <div
        ref={wrapperRef}
        // Focus now enters the list: a Tab from there led to the field below
        // with the list still open on top of it. Focus left the box, it closes.
        onBlur={(event) => {
          const next = event.relatedTarget;
          if (open && next instanceof Node && !event.currentTarget.contains(next)) {
            setOpen(false);
          }
        }}
        className="phone-field relative flex h-11 rounded-md border-[1.5px] border-[var(--color-field-border)] bg-[var(--color-surface-soft)] focus-within:border-[var(--color-primary)] focus-within:bg-[var(--color-surface)]"
      >
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-label={t("phoneInput.countryAria")
            .replace("{code}", () => selectedCountry.code)
            .replace("{country}", () => countryNames.of(selectedCountry.code) ?? selectedCountry.code)
            .replace("{dialCode}", () => selectedCountry.dialCode)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          className="flex w-24 shrink-0 items-center justify-center gap-1 border-r border-[var(--color-line)] bg-[var(--color-surface-soft)] px-3 text-xs font-bold text-[var(--color-primary)] transition hover:bg-[var(--color-surface-strong)]"
        >
          {selectedCountry.code} {selectedCountry.dialCode}
          <ChevronDown
            aria-hidden="true"
            size={12}
            strokeWidth={1.8}
            className={open ? "rotate-180 transition" : "transition"}
          />
        </button>
        <input
          id={inputId}
          type="tel"
          aria-describedby={`${inputId}-hint`}
          value={nationalDigits}
          onChange={(event) => handleNumberChange(event.target.value)}
          placeholder={t("phoneInput.placeholder")}
          className="min-w-0 flex-1 border-0 bg-transparent px-4 text-sm font-normal outline-none"
        />

        {open ? (
          // List of options like the language one: says which country is chosen
          // (before none was marked) and moves with the arrows.
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={t("phoneInput.countryList")}
            onKeyDown={(event) => moveFocusByKey(event, '[role="option"]')}
            className="motion-drop-in absolute left-0 top-[calc(100%+8px)] z-50 max-h-72 w-72 max-w-full overflow-y-auto rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-1.5 shadow-[var(--shadow-strong)]"
          >
            {countries.map((country) => {
              const selected = country.code === selectedCountry.code;
              return (
                <button
                  key={country.code}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  tabIndex={-1}
                  onClick={() => handleCountryChange(country)}
                  aria-label={`${countryNames.of(country.code) ?? country.code} ${country.dialCode}`}
                  className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-3 text-left text-sm font-semibold transition hover:bg-[var(--color-surface-soft)] hover:text-[var(--color-primary)] ${selected ? "text-[var(--color-primary)]" : "text-[var(--color-ink-soft)]"}`}
                >
                  <span>{countryNames.of(country.code) ?? country.code}</span>
                  <span className="inline-flex items-center gap-2">
                    {country.dialCode}
                    <Check aria-hidden="true" size={16} strokeWidth={2.2} className={selected ? undefined : "invisible"} />
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
      <span id={`${inputId}-hint`} className="text-xs font-normal leading-5 text-[var(--color-ink-soft)]">
        {t("phoneInput.hint")}
      </span>
    </div>
  );
}
