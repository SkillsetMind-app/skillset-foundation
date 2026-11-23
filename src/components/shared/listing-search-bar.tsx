"use client";

import { Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { cn } from "@/lib/cn";

type ListingSearchBarProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
  debounceMs?: number;
};

export function ListingSearchBar({
  value,
  onChange,
  placeholder,
  className,
  debounceMs = 200,
}: ListingSearchBarProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(value);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  function queueChange(nextValue: string) {
    setDraft(nextValue);

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      onChange(nextValue);
    }, debounceMs);
  }

  function clearSearch() {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    setDraft("");
    onChange("");
  }

  return (
    <label
      className={cn(
        "relative flex h-11 w-full max-w-[360px] items-center overflow-hidden rounded-md border border-[var(--color-line)] bg-[var(--color-surface-soft)]",
        className,
      )}
    >
      <span className="sr-only">{placeholder}</span>
      <Search
        aria-hidden="true"
        size={16}
        strokeWidth={1.8}
        className="ml-3 text-[var(--color-ink-soft)]"
      />
      <input
        type="search"
        value={draft}
        onChange={(event) => queueChange(event.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 border-0 bg-transparent px-3 pr-11 text-sm text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-soft)]"
      />
      {draft ? (
        <button
          type="button"
          onClick={clearSearch}
          aria-label={t("platform.clearSearch")}
          // O "limpar" tinha 24px; agora ocupa a ponta inteira da busca, que
          // subiu de 40 para 44px e ficou da altura dos filtros ao lado.
          className="button-icon listing-search-clear absolute right-0"
        >
          <X aria-hidden="true" size={14} strokeWidth={1.8} />
        </button>
      ) : null}
    </label>
  );
}
