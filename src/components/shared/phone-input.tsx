"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";

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
  const countryNames = useMemo(() => new Intl.DisplayNames([locale], { type: "region" }), [locale]);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const selectedCountry = findCountryForValue(value);
  const nationalDigits = getNationalDigits(value, selectedCountry);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleMouseDown(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
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
        className="relative flex h-11 rounded-[10px] border border-[var(--color-line)] bg-white focus-within:border-[var(--color-primary-light)]"
      >
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-label={t("phoneInput.countryAria")
            .replace("{code}", () => selectedCountry.code)
            .replace("{country}", () => countryNames.of(selectedCountry.code) ?? selectedCountry.code)
            .replace("{dialCode}", () => selectedCountry.dialCode)}
          aria-haspopup="menu"
          aria-expanded={open}
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
          className="min-w-0 flex-1 border-0 px-4 text-sm font-normal outline-none"
        />

        {open ? (
          <div className="absolute left-0 top-[calc(100%+8px)] z-50 w-72 max-w-full rounded-[12px] border border-[var(--color-line)] bg-white p-1.5 shadow-[var(--shadow-strong)]">
            {countries.map((country) => (
              <button
                key={country.code}
                type="button"
                onClick={() => handleCountryChange(country)}
                aria-label={`${countryNames.of(country.code) ?? country.code} ${country.dialCode}`}
                className="flex w-full items-center justify-between rounded-[8px] px-3 py-2 text-left text-sm font-semibold text-[var(--color-ink-soft)] transition hover:bg-[var(--color-surface-soft)] hover:text-[var(--color-primary)]"
              >
                <span>{countryNames.of(country.code) ?? country.code}</span>
                <span>{country.dialCode}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <span id={`${inputId}-hint`} className="text-xs font-normal leading-5 text-[var(--color-ink-soft)]">
        {t("phoneInput.hint")}
      </span>
    </div>
  );
}
